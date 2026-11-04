import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { SIZES } from "@/lib/pricing";
import { normSize } from "@/lib/ai/normalize";
import { confirmMeta, supplierConfirms } from "@/lib/supplierConfirm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The new sizes for a reorder, from a file dropped in its Goods (Nov 1, Nick: "I could have dragged and dropped the S&S
 * order confirmation there, right in the reorder, and said, do you want me to update to this quantity?"):
 * POST { files: [{ name, pdf?: base64, images?: [{ media_type, data }] }] } → { source, lines: [{ style, color, sizes, brand?, garment? }] }.
 * An S&S / SanMar / alphabroder confirmation PDF is read by code, exactly (lib/supplierConfirm.ts); anything else (a
 * snip, a picture, the customer's PO or size sheet) by the AI from its pictures. Nothing is changed here.
 */
type Line = { style: string; color: string; sizes: Record<string, number>; brand?: string; garment?: string; /** the paper's own words for it (brand, name), to tell two brands' same style apart */ said?: string };
type Img = { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string };
type InFile = { name: string; pdf?: string; images?: Img[]; /** words: an email's message, pasted text */ text?: string };

/**
 * A style as our catalog knows it (Nov 2, Nick on #40363: the reader wrote "5000 Unisex Heavy Cotton T-Shirt" and
 * "JZ360 JZ NuBlend Unisex Sweatshirt 562MR", so nothing matched last time's lines and the order's garments came in
 * unknown): of the numbers in what the paper says (the mill's style, a vendor's own item #, words), the one our garment
 * catalog has is the style, with its brand and name. Kept as written when none is.
 */
async function toCatalog(admin: ReturnType<typeof createAdminClient>, lines: Line[]): Promise<Line[]> {
  const toks = (t: string) => [...new Set(t.toUpperCase().split(/[^A-Z0-9-]+/).map((x) => x.replace(/^-+|-+$/g, "")).filter((x) => x.length >= 3 && /\d/.test(x)))];
  const all = [...new Set(lines.flatMap((l) => toks(l.style)))];
  if (!all.length) return lines;
  const { data } = await admin.from("garments").select("style, brand, description").in("style", all).limit(200);
  const known = (data || []) as { style: string; brand: string | null; description: string | null }[];
  return lines.map((l) => {
    if (!toks(l.style).length) { const { said: _s, ...rest } = l; void _s; return rest; }
    const hits = toks(l.style).map((t) => known.filter((g) => g.style.toUpperCase() === t)).filter((x) => x.length);
    if (!hits.length) { const { said: _s, ...rest } = l; void _s; return rest; }
    // more than one brand with that style (Gildan 5000, Bayside 5000): the one the paper names, else no brand guessed
    const text = `${l.said || ""} ${l.style}`, named = hits[0].filter((g) => g.brand && new RegExp(`\\b${g.brand.split(/\s+/)[0].replace(/[^a-z0-9]/gi, "")}`, "i").test(text));
    const pick = named[0] || (hits[0].length === 1 ? hits[0][0] : null);
    const { said: _s, ...rest } = l; void _s;
    return pick ? { ...rest, style: pick.style, brand: pick.brand || l.brand || "", garment: pick.description || "" } : { ...rest, style: hits[0][0].style };
  });
}

/** quantities of the same style and color added together */
function merge(lines: Line[]): Line[] {
  const sum = new Map<string, Line>();
  for (const l of lines) {
    const k = `${l.style}|${l.color}`.toLowerCase(), x = sum.get(k) || { ...l, sizes: {} };
    for (const [z, n] of Object.entries(l.sizes)) if (+(n || 0) > 0) x.sizes[z] = (x.sizes[z] || 0) + +(n || 0);
    sum.set(k, x);
  }
  return [...sum.values()];
}
const pcsOf = (ls: Line[]) => ls.reduce((s, l) => s + Object.values(l.sizes).reduce((a, n) => a + n, 0), 0);

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { name?: string; pdf?: string; pdfs?: string[]; count?: number; images?: Img[]; files?: InFile[];
    /** last time's garments: an email that just says "the same shirts, these sizes" is about them */ last?: { style?: string; brand?: string; color?: string; garment?: string }[] };
  const name = String(b.name || "the file").slice(0, 160);
  // each file read on its own terms (Nov 2, Nick: two S&S confirmations and a One Stop order): a supplier confirmation by
  // code, exactly; anything else by the AI from its pictures; then everything added together
  const files: InFile[] = (b.files?.length ? b.files : [{ name, pdf: b.pdf || b.pdfs?.[0], images: b.images }]).slice(0, 8);
  const admin = createAdminClient();
  const got: Line[] = [], sources: string[] = [], rest: InFile[] = [];
  let exact = true;
  const { pdfTextServer } = await import("@/lib/pdfTextServer");
  for (const f of files) {
    let done = false;
    if (f.pdf) {
      try {
        const text = await pdfTextServer(new Uint8Array(Buffer.from(f.pdf, "base64")), 8);
        const cf = text ? supplierConfirms([text]) : null;
        if (cf?.rows) {
          const m = confirmMeta(text);
          sources.push(`${m.supplier === "ss" ? "S&S" : m.supplier === "sanmar" ? "SanMar" : m.supplier === "alpha" ? "alphabroder" : "Supplier"}${m.order ? ` #${m.order}` : ""}`);
          for (const l of cf.lines) got.push({ style: (l.product.split(" - ").pop() || "").trim(), said: l.product, color: l.color, sizes: Object.fromEntries(Object.entries(l.sizes).filter(([, n]) => +(n || 0) > 0)) as Record<string, number> });
          done = true;
        }
      } catch { /* read by the AI below */ }
    }
    if (!done) rest.push(f);
  }
  if (rest.length) {
    const images = rest.flatMap((f) => f.images || []).slice(0, 10);
    const texts = rest.filter((f) => f.text?.trim()).map((f) => `--- ${f.name} ---\n${String(f.text).slice(0, 12000)}`);
    if (!images.length && !texts.length) return NextResponse.json({ error: "Couldn't read any sizes from that file." }, { status: 400 });
    const last = (b.last || []).filter((l) => l?.style).slice(0, 20).map((l) => `${[l.brand, l.style].filter(Boolean).join(" ")}${l.color ? ` ${l.color}` : ""}${l.garment ? ` (${l.garment})` : ""}`);
    const st = await aiState(admin);
    if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
    const names = rest.map((f) => f.name).join(", ");
    const r = await askClaude<{ source?: string; lines?: Line[] }>({
      task: "reorder_sizes", model: st.settings.assistant.ai.model, maxTokens: 2500, timeoutMs: 50_000, admin, images, ctx: { by: v.email || "staff" },
      system: `You read garment quantities off a file a print shop got for a reorder: a supplier's order confirmation (S&S, SanMar, alphabroder, One Stop…), the customer's PO, a size sheet or a snip of one. List every style and color with its quantity in each size, exactly as the file shows them. Skip totals and subtotals. Sizes: ${SIZES.join(", ")} (XXL / 2X → 2XL, SM → S, MD → M, LG → L, Youth M → YM). style: the garment maker's style number as written (e.g. 5000, 562MR, PC54), and when the seller uses its own item number too, write both ("JZ360 562MR"); never the description. color: the color as written. Never make numbers up. The file may be an email or text in words ("50 Small, 165 Medium, 170 Large…"): read those counts the same way. When it gives sizes without naming the garment ("a quote for these reprint quantities"), it means last time's garment: give one line for it with its style and color${last.length ? "" : " left empty"}.${last.length ? ` Last time's garments: ${last.join("; ")}. Use these styles and colors when the file doesn't name others; when last time had several and the file doesn't say which, leave style and color empty.` : ""}`,
      prompt: `${rest.length > 1 ? `${rest.length} files (${names}): one order split over several. Read every row on every file and add the same style, color and size together.` : `The file: ${names}. Read every row on it.`}${texts.length ? `\n\n${texts.join("\n\n")}` : ""}`,
      tool: { name: "sizes", description: "What the file lists.", input_schema: { type: "object", properties: {
        source: { type: "string", description: 'What the file is, short: "S&S order confirmation #77356830", "One Stop order 1-1-6878980", "Their PO 4471"' },
        lines: { type: "array", items: { type: "object", properties: { style: { type: "string" }, color: { type: "string" }, sizes: { type: "object", additionalProperties: { type: "number" } } }, required: ["style", "color", "sizes"] } },
      }, required: ["lines"] } },
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    exact = false;
    if (r.data.source) sources.push(String(r.data.source).slice(0, 80));
    for (const l of r.data.lines || []) {
      if (!l) continue;
      const sizes: Record<string, number> = {};
      for (const [k, q] of Object.entries(l.sizes || {})) { const z = normSize(k); const n = Math.floor(+q || 0); if (z && n > 0) sizes[z] = (sizes[z] || 0) + n; }
      if (Object.keys(sizes).length) got.push({ style: String(l.style || "").trim(), color: String(l.color || "").trim(), sizes });
    }
  }
  const lines = merge(await toCatalog(admin, got));
  if (!lines.length) return NextResponse.json({ error: "No sizes on that file." }, { status: 400 });
  const source = sources.length > 1 ? `${sources.length} files (${sources.join(", ")})` : sources[0] || name;
  return NextResponse.json({ source, pieces: pcsOf(lines), lines, exact });
}
