"use client";

/**
 * A file with several logos on it (Oct 27, Nick: "CIRCULAR K BUG LOGOS.ai… a document with multiple pages… this one has
 * three different logos… do a pop-up and say, which logo are you trying to use? right now you're just defaulting to page
 * one or artboard one"). Before a PDF or Illustrator file with more than one page (artboard) is saved as a logo, the
 * person picks the one they mean in <ArtboardPrompt/>; that page alone becomes the file (still vector: a one-page PDF).
 * One page, a picture, or nowhere to ask (no prompt on the page): the file goes on as it is.
 */
export type ArtboardAsk = { fileName: string; pages: string[]; resolve: (page: number | null) => void };
const listeners = new Set<(a: ArtboardAsk) => void>();
export function onArtboard(f: (a: ArtboardAsk) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

const isPdfLike = (f: File) => /pdf|illustrator|postscript/i.test(f.type) || /\.(pdf|ai)$/i.test(f.name);

/** the file to save: the one artboard picked, or the file as it is. Throws "Upload canceled." when they close it. */
export async function pickArtboard(file: File): Promise<File> {
  if (!listeners.size || !isPdfLike(file)) return file;
  let pages: string[] = [];
  const buf = await file.arrayBuffer();
  try {
    const { pdfPicture, pdfPageCount } = await import("@/lib/printavoArt");
    const n = await pdfPageCount(buf.slice(0));
    if (n < 2) return file;
    for (let i = 1; i <= Math.min(n, 12); i++) {
      try { pages.push((await pdfPicture(buf.slice(0), 360, i)).toDataURL("image/png")); } catch { pages.push(""); }
    }
  } catch { return file; }
  if (pages.length < 2) return file;
  const page = await new Promise<number | null>((resolve) => { listeners.forEach((f) => f({ fileName: file.name, pages, resolve })); });
  pages = [];
  if (page == null) throw new Error("Upload canceled.");
  return onePage(file, buf, page);
}

/** page n (1-based) of the file on its own: a one-page PDF (vector kept), or a sharp picture when the file won't split */
async function onePage(file: File, buf: ArrayBuffer, n: number): Promise<File> {
  const base = file.name.replace(/\.[^.]+$/, "") || "logo";
  try {
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(buf.slice(0), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    const out = await PDFDocument.create();
    const [pg] = await out.copyPages(src, [n - 1]);
    out.addPage(pg);
    const bytes = await out.save();
    return new File([bytes as BlobPart], `${base} (${n}).pdf`, { type: "application/pdf" });
  } catch {
    const { pdfPicture } = await import("@/lib/printavoArt");
    const c = await pdfPicture(buf.slice(0), 3000, n);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) throw new Error("Couldn't open that artboard.");
    return new File([blob], `${base} (${n}).png`, { type: "image/png" });
  }
}
