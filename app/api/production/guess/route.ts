import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { PROD_KINDS, guessProdKind } from "@/lib/productionFileKinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What a production file probably is, for staff to confirm (Oct 20, Nick: "you should be able to predict what these
 * things are… if you see something that looks like a barcode, say that it's a barcode and ask me to confirm; if you see
 * a DST file, you should know that's a digitizing file"). Embroidery files by their extension; PDFs and pictures looked
 * at by the AI; the rest by their name. Never sets the label itself.
 *   POST { order }  → the order's unlabeled production files not looked at yet; saved in art_files.guess ("?" = no idea)
 *   POST { files: [{ path, name }] } → old Printavo job files (printavo/…), answered only
 * → { guesses: { [id or path]: { kind, why } } }
 */
const EMB = /\.(dst|emb|pes|exp|jef|vp3|pxf|hus|xxx|vip|sew)$/i;
type In = { key: string; name: string; path: string };

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { order?: string; files?: { path: string; name: string }[] };
  const admin = createAdminClient();
  let todo: In[] = [];
  if (b.order) {
    const { data } = await admin.from("art_files").select("id, name, file_path").eq("order_id", b.order).is("category", null).is("guess", null).limit(12);
    todo = (data || []).map((x) => ({ key: x.id as string, name: (x.name as string) || "", path: (x.file_path as string) || "" }));
  } else {
    todo = (b.files || []).filter((f) => typeof f.path === "string" && f.path.startsWith("printavo/")).slice(0, 8).map((f) => ({ key: f.path, name: String(f.name || ""), path: f.path }));
  }
  const guesses: Record<string, { kind: string; why: string }> = {};
  const look: (In & { buf: Buffer; pdf: boolean; mt: string })[] = [];
  for (const f of todo) {
    const n = `${f.name} ${f.path}`;
    if (EMB.test(f.path) || EMB.test(f.name)) { guesses[f.key] = { kind: "embroidery", why: "A digitized embroidery file" }; continue; }
    const pdf = /\.(pdf|ai)$/i.test(f.path), pic = /\.(png|jpe?g|gif|webp)$/i.test(f.path);
    if (!pdf && !pic) { const g = guessProdKind(n); guesses[f.key] = { kind: g || "?", why: g ? "From its name" : "" }; continue; }
    const { data: blob } = await admin.storage.from("proofs").download(f.path).then((r) => r, () => ({ data: null }));
    const buf = blob ? Buffer.from(await blob.arrayBuffer()) : null;
    if (!buf || buf.length > 4.5 * 1024 * 1024) { const g = guessProdKind(n); guesses[f.key] = { kind: g || "?", why: g ? "From its name" : "" }; continue; }
    look.push({ ...f, buf, pdf, mt: /\.png$/i.test(f.path) ? "image/png" : /\.webp$/i.test(f.path) ? "image/webp" : /\.gif$/i.test(f.path) ? "image/gif" : "image/jpeg" });
  }
  if (look.length) {
    const st = await aiState(admin);
    if (st.ready) {
      const r = await askClaude<{ files: { n: number; kind: string; why: string }[] }>({
        task: "production_file_guess", model: st.settings.assistant.ai.model, maxTokens: 900, timeoutMs: 45_000, admin,
        ctx: { by: v.email || "staff", order_id: b.order || null },
        images: look.filter((x) => !x.pdf).map((x) => ({ media_type: x.mt as "image/png", data: x.buf.toString("base64"), label: `F${look.indexOf(x) + 1}` })),
        documents: look.filter((x) => x.pdf).map((x) => ({ data: x.buf.toString("base64"), label: `F${look.indexOf(x) + 1}` })),
        system: `You sort a screen print shop's production files (staff only, never the customer's). For each file say what it is, as one of these keys:\n${PROD_KINDS.map((k) => `${k.k}: ${k.label} (${k.hint})`).join("\n")}\nA sheet of barcodes (UPC, FNSKU/Amazon X00… codes) or product labels is "barcodes". A design on a plain or colored background, a logo or vector art is "print_art". A picture of a garment with the design on it made by a shop is "old_mockup". A real camera photo is "photo". Say "?" when you can't tell. "why": a few plain words a coworker would say, naming what you see (e.g. "Amazon barcode labels for The Bottles onesies, 3-6 months").`,
        prompt: `Files:\n${look.map((x, i) => `F${i + 1}: ${x.name || x.path.split("/").pop()}`).join("\n")}`,
        tool: { name: "sort", description: "What each file is.", input_schema: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { n: { type: "number", description: "the F number" }, kind: { type: "string" }, why: { type: "string" } }, required: ["n", "kind"] } } }, required: ["files"] } },
      });
      if (r.ok) for (const x of Array.isArray(r.data.files) ? r.data.files : []) {
        const f = look[Math.floor(x.n) - 1];
        if (f) guesses[f.key] = { kind: PROD_KINDS.some((k) => k.k === x.kind) ? x.kind : "?", why: String(x.why || "").slice(0, 160) };
      }
    }
    for (const f of look) if (!guesses[f.key]) { const g = guessProdKind(`${f.name} ${f.path}`); guesses[f.key] = { kind: g || "?", why: g ? "From its name" : "" }; }
  }
  if (b.order) for (const [id, g] of Object.entries(guesses)) await admin.from("art_files").update({ guess: g.kind }).eq("id", id).eq("order_id", b.order);
  return NextResponse.json({ guesses });
}
