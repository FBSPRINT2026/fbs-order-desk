import "server-only";

/**
 * A PDF's words on the server (pdf.js, the legacy build for Node: the same way app/api/tools/pdf-images loads it, so
 * Vercel packs the worker with the function). Pages joined by spaces; "" when it can't be read (a scan, a broken file).
 */
/** ligatures typeset as one glyph ("ﬁ" in "Greenﬁeld", Nov 17 2026, BMWC #50081's ship-to read as "Greeneld") as plain letters */
const lig = (t: string) => t.normalize("NFKC");
type Doc = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> };
export async function pdfTextServer(buf: Uint8Array, maxPages = 8, /** in reading order, a line at a time (lib/sizeGrid.ts readingText): for checking sizes against the paperwork */ ordered = false): Promise<string> {
  if (ordered) {
    try {
      const { readingText } = await import("@/lib/sizeGrid");
      const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
      const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<PDoc> } };
      const doc = await m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
      const items: { str: string; x: number; y: number; w: number; page: number }[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) for (const it of (await (await doc.getPage(n)).getTextContent()).items) if (it.str && it.transform) items.push({ str: lig(it.str), x: it.transform[4], y: it.transform[5], w: it.width || 0, page: n });
      const t = readingText(items);
      if (t.trim()) return t;
    } catch { /* the plain way below */ }
  }
  try {
    const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<Doc> } };
    const doc = await m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
    const out: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map((x) => lig(x.str || "")).join(" "));
    return out.join(" ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

/**
 * A PDF's size grid, every number under the size header it stands beneath (lib/sizeGrid.ts; Nick, Nov 13 2026: an empty
 * size box vanished from the words above and Tiger Blue's sizes slid a column). One line per row, "" when the PDF has
 * no header row of sizes. The order reader and the AI order helper are told to use it exactly.
 */
type PDoc = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; width?: number }[] }> }> };
export async function pdfSizeGridServer(buf: Uint8Array, maxPages = 8): Promise<string> {
  try {
    const { sizeGrid, sizeGridText, sizeRows, sizeRowsText } = await import("@/lib/sizeGrid");
    const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<PDoc> } };
    const doc = await m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
    const items: { str: string; x: number; y: number; w: number; page: number }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      for (const it of (await (await doc.getPage(n)).getTextContent()).items) {
        if (!it.str || !it.transform) continue;
        items.push({ str: lig(it.str), x: it.transform[4], y: it.transform[5], w: it.width || 0, page: n });
      }
    }
    // a grid of size columns, or a table whose sizes are rows under each garment (Nine18's POs): whichever the PDF has
    const grid = sizeGridText(sizeGrid(items)), rows = sizeRowsText(sizeRows(items));
    return [grid, rows ? `Garments read row by row (each size row belongs to the garment above it; a quantity on a garment's own row is a one-size item; PERSONALIZATION rows are names on that garment's pieces):\n${rows}` : ""].filter(Boolean).join("\n");
  } catch { return ""; }
}
