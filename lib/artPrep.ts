"use client";
/**
 * Helpers for customer art that isn't clean vector: JPG / PNG / photos / PDFs.
 * - knockOut: a logo on a solid background (JPGs are always on one) gets that background made see-through.
 * - makePreview: files a browser can't show (HEIC from iPhones, PDF, AI, TIFF, BMP) become a PNG preview.
 * - effectiveDpi: how sharp a raster logo will print at a given width.
 */

export const isVector = (type: string, name = "") => /svg/i.test(type) || /\.(svg|ai|eps|pdf)$/i.test(name);

function canvasOf(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  return { c, x };
}

/**
 * If the image has no transparency and its edges are one solid color (white box, colored box),
 * make that background see-through by flooding in from the edges. Colors inside the logo that match
 * the background but aren't connected to the edge (e.g. white inside letters) are kept.
 * Returns null when there's nothing to remove.
 */
export function knockOut(img: HTMLImageElement, tolerance = 42): { url: string; bg: string } | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  // work at up to 1600px for speed; the result is used for mockups, not production files
  const k = Math.min(1, 1600 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const { c, x } = canvasOf(img, w, h);
  let data: ImageData;
  try { data = x.getImageData(0, 0, w, h); } catch { return null; }
  const d = data.data;
  // already has see-through pixels? leave it alone
  let clear = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { clear++; if (clear > 20) return null; }
  // is the border one color?
  const border: number[] = [];
  for (let X = 0; X < w; X += Math.max(1, Math.floor(w / 200))) border.push(X, (h - 1) * w + X);
  for (let Y = 0; Y < h; Y += Math.max(1, Math.floor(h / 200))) border.push(Y * w, Y * w + w - 1);
  const avg = [0, 0, 0];
  border.forEach((p) => { avg[0] += d[p * 4]; avg[1] += d[p * 4 + 1]; avg[2] += d[p * 4 + 2]; });
  avg.forEach((_, i) => { avg[i] /= border.length; });
  const dist = (p: number) => Math.hypot(d[p * 4] - avg[0], d[p * 4 + 1] - avg[1], d[p * 4 + 2] - avg[2]);
  const same = border.filter((p) => dist(p) <= tolerance).length / border.length;
  if (same < 0.9) return null; // busy edges: probably a photo, keep it as is
  // flood fill from the border
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => { if (!seen[p] && dist(p) <= tolerance) { seen[p] = 1; stack[sp++] = p; } };
  for (let X = 0; X < w; X++) { push(X); push((h - 1) * w + X); }
  for (let Y = 0; Y < h; Y++) { push(Y * w); push(Y * w + w - 1); }
  while (sp) {
    const p = stack[--sp], X = p % w;
    if (X > 0) push(p - 1);
    if (X < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  let removed = 0;
  for (let p = 0; p < w * h; p++) if (seen[p]) { d[p * 4 + 3] = 0; removed++; }
  if (removed < w * h * 0.05) return null;
  // soften the cut edge: pixels next to the removed area fade by how close they are to the background
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) continue;
    const X = p % w;
    const near = (X > 0 && seen[p - 1]) || (X < w - 1 && seen[p + 1]) || (p >= w && seen[p - w]) || (p < w * (h - 1) && seen[p + w]);
    if (near) d[p * 4 + 3] = Math.min(255, Math.round(255 * Math.min(1, dist(p) / (tolerance * 2.2))));
  }
  x.putImageData(data, 0, 0);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return { url: c.toDataURL("image/png"), bg: `#${hex(avg[0])}${hex(avg[1])}${hex(avg[2])}` };
}

/** Dots per inch a raster logo will print at, for a print width in inches. */
export const effectiveDpi = (pxWidth: number, inches: number) => (pxWidth && inches ? Math.round(pxWidth / inches) : 0);

function loadScript(src: string, globalName: string): Promise<unknown> {
  const w = window as unknown as Record<string, unknown>;
  if (w[globalName]) return Promise.resolve(w[globalName]);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res(w[globalName]);
    s.onerror = () => rej(new Error("Couldn't load a file converter."));
    document.head.appendChild(s);
  });
}

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const HEIC = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

const blobToFile = (b: Blob, name: string) => new File([b], name, { type: b.type || "image/png" });
const canvasToFile = (c: HTMLCanvasElement, name: string) => new Promise<File | null>((res) => c.toBlob((b) => res(b ? blobToFile(b, name) : null), "image/png"));

/**
 * A PNG preview for files the browser can't draw directly, so they still work in the mockup builder:
 * HEIC/HEIF (iPhone photos), PDF and AI (first page), TIFF/BMP where the browser can decode them.
 * Returns null when no preview can be made (e.g. EPS, PSD) — staff can add a preview image by hand.
 */
export async function makePreview(file: File): Promise<File | null> {
  const base = file.name.replace(/\.[^.]+$/, "") || "logo";
  try {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      const heic2any = (await loadScript(HEIC, "heic2any")) as (o: { blob: Blob; toType: string }) => Promise<Blob | Blob[]>;
      const out = await heic2any({ blob: file, toType: "image/png" });
      return blobToFile(Array.isArray(out) ? out[0] : out, `${base}.png`);
    }
    if (/pdf/i.test(file.type) || /\.(pdf|ai)$/i.test(file.name)) {
      // Illustrator files are usually saved PDF-compatible, so the same reader works for most of them
      const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> } }> }> } };
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await doc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(6, 2400 / Math.max(v1.width, v1.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // transparent page, so the logo sits on the shirt without a white box
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(0,0,0,0)" }).promise;
      return canvasToFile(c, `${base}.png`);
    }
    // anything else the browser can decode (BMP, TIFF in Safari, AVIF…) becomes a PNG
    if (/^image\//i.test(file.type) && !/^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.type)) {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const { c } = canvasOf(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      return canvasToFile(c, `${base}.png`);
    }
  } catch { /* fall through: no preview */ }
  return null;
}
