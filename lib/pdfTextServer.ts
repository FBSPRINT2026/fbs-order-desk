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
