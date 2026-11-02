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
 * POST { name, pdf?: base64, images?: [{ media_type, data }] } → { source, lines: [{ style, color, sizes }] }.
 * An S&S / SanMar / alphabroder confirmation PDF is read by code, exactly (lib/supplierConfirm.ts); anything else (a
 * snip, a picture, the customer's PO or size sheet) by the AI from its pictures. Nothing is changed here.
 */
type Line = { style: string; color: string; sizes: Record<string, number> };
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { name?: string; pdf?: string; pdfs?: string[]; count?: number; images?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string }[] };
  const name = String(b.name || "the file").slice(0, 160);
  // several files at once (Nov 2, Nick: "drag them in one at a time… there's all the files, now read"): every supplier
  // confirmation read by code, their quantities added together; if any file isn't one, the AI reads them all
  const pdfs = [...(b.pdfs || []), ...(b.pdf ? [b.pdf] : [])].slice(0, 8);
  if (pdfs.length && pdfs.length >= (b.count || 1)) {
    try {
      const { pdfTextServer } = await import("@/lib/pdfTextServer");
      const sum = new Map<string, Line>(), sources: string[] = [];
      let all = true, pieces = 0;
      for (const p of pdfs) {
        const text = await pdfTextServer(new Uint8Array(Buffer.from(p, "base64")), 8);
        const cf = text ? supplierConfirms([text]) : null;
        if (!cf?.rows) { all = false; break; }
        const m = confirmMeta(text);
        const who = m.supplier === "ss" ? "S&S" : m.supplier === "sanmar" ? "SanMar" : m.supplier === "alpha" ? "alphabroder" : "Supplier";
        sources.push(`${who}${m.order ? ` #${m.order}` : ""}`); pieces += cf.pieces;
        for (const l of cf.lines) {
          const style = (l.product.split(" - ").pop() || "").trim(), k = `${style}|${l.color}`.toLowerCase();
          const x = sum.get(k) || { style, color: l.color, sizes: {} };
          for (const [z, n] of Object.entries(l.sizes)) if (+(n || 0) > 0) x.sizes[z] = (x.sizes[z] || 0) + +(n || 0);
          sum.set(k, x);
        }
      }
      if (all && sum.size) return NextResponse.json({ source: sources.length > 1 ? `${sources.length} order confirmations (${sources.join(", ")})` : `${sources[0]} order confirmation`, pieces, lines: [...sum.values()], exact: true });
    } catch { /* the AI reads them below */ }
  }
  const images = (b.images || []).slice(0, 10);
  if (!images.length) return NextResponse.json({ error: "Couldn't read any sizes from that file." }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const r = await askClaude<{ source?: string; lines?: Line[] }>({
    task: "reorder_sizes", model: st.settings.assistant.ai.model, maxTokens: 2500, timeoutMs: 50_000, admin, images, ctx: { by: v.email || "staff" },
    system: `You read garment quantities off a file a print shop got for a reorder: a supplier's order confirmation (S&S, SanMar, alphabroder), the customer's PO, a size sheet or a snip of one. List every style and color with its quantity in each size, exactly as the file shows them. Skip totals and subtotals. Sizes: ${SIZES.join(", ")} (XXL / 2X → 2XL, Youth M → YM). Never make numbers up.`,
    prompt: (b.count || 1) > 1 ? `${b.count} files (${name}): one order split over several. Read every row on every file and add the same style, color and size together.` : `The file: ${name}. Read every row on it.`,
    tool: { name: "sizes", description: "What the file lists.", input_schema: { type: "object", properties: {
      source: { type: "string", description: 'What the file is, short: "S&S order confirmation #77356830", "Their PO 4471", "Size sheet"' },
      lines: { type: "array", items: { type: "object", properties: { style: { type: "string" }, color: { type: "string" }, sizes: { type: "object", additionalProperties: { type: "number" } } }, required: ["style", "color", "sizes"] } },
    }, required: ["lines"] } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const lines: Line[] = (r.data.lines || []).filter((l) => l && l.style).map((l) => {
    const sizes: Record<string, number> = {};
    for (const [k, q] of Object.entries(l.sizes || {})) { const z = normSize(k); const n = Math.floor(+q || 0); if (z && n > 0) sizes[z] = (sizes[z] || 0) + n; }
    return { style: String(l.style).trim(), color: String(l.color || "").trim(), sizes };
  }).filter((l) => Object.keys(l.sizes).length);
  if (!lines.length) return NextResponse.json({ error: "No sizes on that file." }, { status: 400 });
  return NextResponse.json({ source: String(r.data.source || name).slice(0, 120), pieces: lines.reduce((s, l) => s + Object.values(l.sizes).reduce((a, n) => a + n, 0), 0), lines, exact: false });
}
