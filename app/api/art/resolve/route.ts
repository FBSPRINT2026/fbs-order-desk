import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Printavo Art Resolution Center (Oct 20, Nick: "if you had an issue bringing in the art from Printavo, pop up… the
 * Printavo Art Resolution Center… we can AI talk through it and you should be able to create it"). Staff and the AI
 * talk through an old job's art: the AI looks at the old job's files (pictures and PDFs) and the print being made,
 * answers, and offers steps the window can take with a click: use one of the files as the art (with or without its
 * background), search the customer's Dropbox film folder, upload the art, or make the order without it for now.
 *   POST { customer, job, print, files: [{ name, path }], messages: [{ role, text }] } → { reply, actions }
 */
type Msg = { role: "staff" | "ai"; text: string };
export type ArtAction = { kind: "use_file"; file: number; background: boolean; label: string } | { kind: "search_film"; query: string; label: string } | { kind: "upload"; label: string } | { kind: "skip"; label: string };

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { customer?: string; job?: string; print?: string; files?: { name: string; path: string }[]; messages?: Msg[]; film?: string };
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const { data: cust } = b.customer ? await admin.from("customers").select("company, name").eq("id", b.customer).maybeSingle() : { data: null };
  const files = (b.files || []).slice(0, 6).filter((f) => typeof f.path === "string" && f.path.startsWith("printavo/"));
  const images: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string; label: string }[] = [];
  const documents: { data: string; label: string }[] = [];
  const listing: string[] = [];
  for (const [i, f] of files.entries()) {
    const { data: blob } = await admin.storage.from("proofs").download(f.path).then((r) => r, () => ({ data: null }));
    const buf = blob ? Buffer.from(await blob.arrayBuffer()) : null;
    const kind = /\.pdf$/i.test(f.path) ? "PDF" : /\.(png|jpe?g|gif|webp)$/i.test(f.path) ? "picture" : "file";
    listing.push(`F${i + 1}: ${f.name} (${kind}${buf ? `, ${Math.round(buf.length / 1024)} KB` : ", couldn't be opened"})`);
    if (!buf || buf.length > 4.5 * 1024 * 1024) continue;
    if (kind === "PDF") documents.push({ data: buf.toString("base64"), label: `F${i + 1}` });
    else if (kind === "picture") images.push({ media_type: /\.png$/i.test(f.path) ? "image/png" : /\.webp$/i.test(f.path) ? "image/webp" : /\.gif$/i.test(f.path) ? "image/gif" : "image/jpeg", data: buf.toString("base64"), label: `F${i + 1}` });
  }
  const msgs = (b.messages || []).slice(-16);
  const r = await askClaude<{ reply: string; actions?: { kind: string; file?: number; background?: boolean; query?: string; label?: string }[] }>({
    task: "art_resolve", model: st.settings.assistant.ai.model, maxTokens: 1200, timeoutMs: 45_000, admin, images, documents,
    ctx: { customer_id: b.customer || null, by: v.email || "staff" },
    system: `You help a screen print shop bring an old Printavo job's print art into its new system, for a reorder. Old jobs kept their art in every way imaginable: a vector PDF, a picture of the design on a colored background, a mockup sheet with shirt photos, a label or barcode sheet, a proof with notes around the art. Look at the files (F numbers) and work out which one is the print art and what has to happen to it: used as it is, its flat background taken off, or it's not there at all (then the film in their Dropbox, or ask for the art). Be short and plain, like a coworker: 1-3 sentences, then 1-3 steps as actions. Never invent files. A barcode or label sheet is never the art.`,
    prompt: `Customer: ${cust?.company || cust?.name || "?"}. The reorder of ${b.job || "an old job"}, print: ${b.print || "?"}.
Files on the old job:
${listing.join("\n") || "(none)"}
${b.film ? `\nDropbox film search: ${b.film}` : ""}
Conversation so far:
${msgs.map((m) => `${m.role === "staff" ? "Staff" : "You"}: ${m.text}`).join("\n") || "(just opened: say what you see and what you'd do)"}`,
    tool: { name: "answer", description: "Your answer and the steps staff can take with a click.", input_schema: { type: "object", properties: {
      reply: { type: "string" },
      actions: { type: "array", items: { type: "object", properties: {
        kind: { type: "string", enum: ["use_file", "search_film", "upload", "skip"] },
        file: { type: "number", description: "use_file: the F number" },
        background: { type: "boolean", description: "use_file: true = take the flat background off; false = use it as it is" },
        query: { type: "string", description: "search_film: the words to search the film folder for" },
        label: { type: "string", description: "button text, 2-6 words" },
      }, required: ["kind", "label"] } },
    }, required: ["reply"] } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const actions: ArtAction[] = [];
  for (const x of (Array.isArray(r.data.actions) ? r.data.actions : []).slice(0, 3)) {
    const label = String(x.label || "").slice(0, 60);
    if (x.kind === "use_file" && x.file && files[x.file - 1]) actions.push({ kind: "use_file", file: Math.floor(x.file), background: x.background !== false, label: label || `Use F${x.file}` });
    else if (x.kind === "search_film") actions.push({ kind: "search_film", query: String(x.query || "").slice(0, 80), label: label || "Search the film folder" });
    else if (x.kind === "upload") actions.push({ kind: "upload", label: label || "Upload the art" });
    else if (x.kind === "skip") actions.push({ kind: "skip", label: label || "Without art for now" });
  }
  return NextResponse.json({ reply: String(r.data.reply || "").slice(0, 1500), actions });
}
