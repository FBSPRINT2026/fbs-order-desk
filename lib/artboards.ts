"use client";

/**
 * A file with several logos on it (Oct 27, Nick: "CIRCULAR K BUG LOGOS.ai… a document with multiple pages… this one has
 * three different logos… do a pop-up and say, which logo are you trying to use? right now you're just defaulting to page
 * one or artboard one"). Before a PDF or Illustrator file with more than one page (artboard) is saved as a logo, the
 * person picks the one they mean in <ArtboardPrompt/>; that page alone becomes the file (still vector: a one-page PDF).
 * One page, a picture, or nowhere to ask (no prompt on the page): the file goes on as it is.
 */
export type ArtboardAsk = { fileName: string; pages: string[]; /** said above the pictures (an EPS that only shows its first artboard) */ note?: string; resolve: (page: number | null) => void };
const listeners = new Set<(a: ArtboardAsk) => void>();
export function onArtboard(f: (a: ArtboardAsk) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

const isPdfLike = (f: File) => /pdf|illustrator|postscript/i.test(f.type) || /\.(pdf|ai|eps)$/i.test(f.name);
const isPs = (head: string) => head.startsWith("%!PS") || head.charCodeAt(0) === 0xc5; // an EPS (plain, or with a preview header)

/** the file to save: the one artboard picked, or the file as it is. Throws "Upload canceled." when they close it. */
export async function pickArtboard(file: File): Promise<File> {
  if (!listeners.size || !isPdfLike(file)) return file;
  let pages: string[] = [];
  const buf = await file.arrayBuffer();
  const text = new TextDecoder("latin1").decode(new Uint8Array(buf));
  // how many artboards Illustrator says the document has (its XMP: xmpTPg:NPages)
  const boards = +(text.match(/<xmpTPg:NPages>\s*(\d+)\s*</)?.[1] || 0);
  if (isPs(text.slice(0, 4))) return pickFromArt(file, text, boards);
  try {
    const { pdfPicture, pdfPageCount } = await import("@/lib/printavoArt");
    const n = await pdfPageCount(buf.slice(0));
    // one page, but Illustrator says several artboards: the others may be art lying off the page
    if (n < 2) return boards > 1 ? pickFromArt(file, buf, boards) : file;
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

type Shape = import("@/lib/svgVector").VShape;
/** the bounds of a shape's outline ("x y m / x y l / x1 y1 x2 y2 x3 y3 c / h" lines) */
function boxOf(ops: string): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of ops.split("\n")) { const n = l.trim().split(/\s+/).slice(0, -1).map(Number); for (let i = 0; i + 1 < n.length; i += 2) { if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i]; if (n[i + 1] < y0) y0 = n[i + 1]; if (n[i + 1] > y1) y1 = n[i + 1]; } }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
/**
 * The artboards as groups of art (Oct 28, Nick on PSWM's logo EPS: "the customer had multiple art boards… when we
 * downloaded the file you can only see the one art board… when you detect multiple [artboards] you can just select
 * one"): an EPS, or a one-page .ai, keeps the other artboards' art beside the first one; the art falls into groups with
 * clear space between them, one per artboard. Each is offered as its own logo (an SVG of just its shapes, still vector).
 * When the other artboards' art isn't in the file (an EPS saved with only the first), it says so.
 */
async function pickFromArt(file: File, src: string | ArrayBuffer, boards: number): Promise<File> {
  let v: import("@/lib/svgVector").VArt;
  try {
    if (typeof src === "string") { const { parseEps } = await import("@/lib/epsVector"); v = parseEps(src); }
    else { const { parsePdf, browserInflate } = await import("@/lib/pdfVector"); v = await parsePdf(new Uint8Array(src.slice(0)), browserInflate, { strokes: true }); }
  } catch { return file; }
  // art it can't fully read (placed pictures, live text): no guessing at groups
  if (!v.ok) return boards > 1 ? onlyFirst(file, boards) : file;
  const items = v.shapes.map((sh) => ({ sh, b: boxOf(sh.ops) })).filter((x): x is { sh: Shape; b: [number, number, number, number] } => !!x.b);
  if (!items.length) return boards > 1 ? onlyFirst(file, boards) : file;
  // group shapes whose boxes come within a gap of each other (letters of one logo touch; artboards have room between)
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const { b } of items) { X0 = Math.min(X0, b[0]); Y0 = Math.min(Y0, b[1]); X1 = Math.max(X1, b[2]); Y1 = Math.max(Y1, b[3]); }
  const gap = Math.max(18, 0.04 * Math.max(X1 - X0, Y1 - Y0));
  const up = items.map((_, i) => i);
  const root = (i: number): number => (up[i] === i ? i : (up[i] = root(up[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].b, c = items[j].b;
    if (a[0] - gap <= c[2] && c[0] - gap <= a[2] && a[1] - gap <= c[3] && c[1] - gap <= a[3]) up[root(i)] = root(j);
  }
  const groups = new Map<number, typeof items>();
  items.forEach((it, i) => { const r = root(i); groups.set(r, [...(groups.get(r) || []), it]); });
  const list = [...groups.values()].map((g) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { b, sh } of g) { const e = (sh.stroke?.w || 0) / 2; x0 = Math.min(x0, b[0] - e); y0 = Math.min(y0, b[1] - e); x1 = Math.max(x1, b[2] + e); y1 = Math.max(y1, b[3] + e); }
    return { shapes: g.map((x) => x.sh), x: x0, y: y0, w: Math.max(0.1, x1 - x0), h: Math.max(0.1, y1 - y0) };
  })
    // a stray dot or crop mark isn't an artboard
    .filter((g, _i, all) => g.w * g.h >= 0.02 * Math.max(...all.map((z) => z.w * z.h)))
    .sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
  // art off the first artboard only counts when Illustrator says there are several, or it lies outside the page
  const outside = v.w > 0 && list.some((g) => g.x > v.w || g.y > v.h || g.x + g.w < 0 || g.y + g.h < 0);
  if (list.length < 2 || !(boards > 1 || outside)) return boards > 1 ? onlyFirst(file, boards) : file;
  const { vartSvg } = await import("@/lib/epsVector");
  const svgs = list.slice(0, 12).map((g) => vartSvg({ ok: true, x: g.x, y: g.y, w: g.w, h: g.h, shapes: g.shapes }));
  let pages = svgs.map((t) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}`);
  const page = await new Promise<number | null>((resolve) => { listeners.forEach((f) => f({ fileName: file.name, pages, resolve })); });
  pages = [];
  if (page == null) throw new Error("Upload canceled.");
  const base = file.name.replace(/\.[^.]+$/, "") || "logo";
  return new File([svgs[page - 1]], `${base} (${page}).svg`, { type: "image/svg+xml" });
}
/** Illustrator says it has several artboards, but only the first is in the file: said, and the first is used */
async function onlyFirst(file: File, boards: number): Promise<File> {
  const page = await new Promise<number | null>((resolve) => { listeners.forEach((f) => f({ fileName: file.name, pages: [""], note: `Illustrator says this file has ${boards} artboards, but only the first one was saved in a form we can read (an EPS keeps just one). To use another, open it in Illustrator and save it as .ai or PDF, then upload that.`, resolve })); });
  if (page == null) throw new Error("Upload canceled.");
  return file;
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
