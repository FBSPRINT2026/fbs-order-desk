import "server-only";

/**
 * A PDF's words on the server (pdf.js, the legacy build for Node: the same way app/api/tools/pdf-images loads it, so
 * Vercel packs the worker with the function). Pages joined by spaces; "" when it can't be read (a scan, a broken file).
 */
type Doc = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> };
export async function pdfTextServer(buf: Uint8Array, maxPages = 8): Promise<string> {
  try {
    const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<Doc> } };
    const doc = await m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
    const out: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map((x) => x.str || "").join(" "));
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
    const { sizeGrid, sizeGridText } = await import("@/lib/sizeGrid");
    const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<PDoc> } };
    const doc = await m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
    const items: { str: string; x: number; y: number; w: number; page: number }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      for (const it of (await (await doc.getPage(n)).getTextContent()).items) {
        if (!it.str || !it.transform) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, page: n });
      }
    }
    return sizeGridText(sizeGrid(items));
  } catch { return ""; }
}
