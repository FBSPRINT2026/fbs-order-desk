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
 * If the image has no transparency and its edges are one solid color (the white box around a JPG logo),
 * make that background see-through everywhere — including inside letters (the holes in e, d, p, ®).
 * Edge pixels that are part logo / part background get partial see-through and their color "un-mixed"
 * from the background, so there's no white halo on dark shirts.
 * Returns null when there's nothing to remove (already transparent, or a busy photo edge).
 */
export function knockOut(img: HTMLImageElement, opts: { keepInside?: boolean } = {}): { url: string; bg: string } | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  // work at up to 2000px; the result is used for mockups, not production files
  const k = Math.min(1, 2000 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const { c, x } = canvasOf(img, w, h);
  let data: ImageData;
  try { data = x.getImageData(0, 0, w, h); } catch { return null; }
  const d = data.data;
  // already has see-through pixels? leave it alone
  let clear = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { clear++; if (clear > 20) return null; }
  // the background color = the (mostly one) color around the edge
  const border: number[] = [];
  for (let X = 0; X < w; X += Math.max(1, Math.floor(w / 300))) border.push(X, (h - 1) * w + X);
  for (let Y = 0; Y < h; Y += Math.max(1, Math.floor(h / 300))) border.push(Y * w, Y * w + w - 1);
  const bg = [0, 0, 0];
  border.forEach((p) => { bg[0] += d[p * 4]; bg[1] += d[p * 4 + 1]; bg[2] += d[p * 4 + 2]; });
  bg.forEach((_, i) => { bg[i] /= border.length; });
  const far = (p: number) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]);
  const same = border.filter((p) => far(p) <= 40).length / border.length;
  if (same < 0.85) return null; // busy edges: probably a photo, keep it as is
  // how far each channel can move away from the background (to black or to white), for un-mixing
  const room = bg.map((v) => Math.max(v, 255 - v) || 1);
  const smooth = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  // how much of a pixel is "logo" rather than background (0..1)
  const mixOf = (p: number) => { const i = p * 4; return Math.max(Math.abs(d[i] - bg[0]) / room[0], Math.abs(d[i + 1] - bg[1]) / room[1], Math.abs(d[i + 2] - bg[2]) / room[2]); };
  // "keep white inside the logo": only background connected to the outside edge is removed
  let outside: Uint8Array | null = null;
  if (opts.keepInside) {
    outside = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (p: number) => { if (!outside![p] && mixOf(p) < 0.32) { outside![p] = 1; stack[sp++] = p; } };
    for (let X = 0; X < w; X++) { push(X); push((h - 1) * w + X); }
    for (let Y = 0; Y < h; Y++) { push(Y * w); push(Y * w + w - 1); }
    while (sp) {
      const p = stack[--sp], X = p % w;
      if (X > 0) push(p - 1);
      if (X < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < w * (h - 1)) push(p + w);
    }
  }
  let removed = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (outside && !outside[p]) continue; // inside the logo: keep as is
    const mix = mixOf(p);
    // JPEG noise near the background is dropped; anything clearly logo is solid
    const a = smooth(0.07, 0.32, mix);
    if (a <= 0) { d[i + 3] = 0; removed++; continue; }
    if (a < 1 && mix > 0.001) {
      // un-mix the background out of edge pixels so they keep the logo's own color
      for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, Math.round(bg[ch] + (d[i + ch] - bg[ch]) / Math.min(1, mix / 0.32))));
    }
    d[i + 3] = Math.round(255 * a);
  }
  if (removed < w * h * 0.05) return null;
  x.putImageData(data, 0, 0);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return { url: c.toDataURL("image/png"), bg: `#${hex(bg[0])}${hex(bg[1])}${hex(bg[2])}` };
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
    if (/postscript|eps/i.test(file.type) || /\.eps$/i.test(file.name)) {
      // Illustrator EPS (flat colors and gradients): read its shapes, draw them as a PNG with a clear background
      const { parseEps, vartSvg } = await import("./epsVector");
      const v = parseEps(await file.text());
      if (!v.shapes.length) return null;
      const url = URL.createObjectURL(new Blob([vartSvg(v)], { type: "image/svg+xml" }));
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const k = 2400 / Math.max(v.w, v.h), c = document.createElement("canvas");
        c.width = Math.round(v.w * k); c.height = Math.round(v.h * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        return canvasToFile(c, `${base}.png`);
      } finally { URL.revokeObjectURL(url); }
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
