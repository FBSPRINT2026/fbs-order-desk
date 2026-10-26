/**
 * 3D puff on part of a logo (Oct 26, Nick: "if you select 3D Puff… what are we puffing here? Is it just this part? Is it
 * all of it?… click on and say, like, hey, the cross gets puffed, but not the text"; and "there's some minimum dimension
 * requirements for 3D Puff… this is too small to do 3D Puff").
 *
 * The logo is read once at a working size: each stitched pixel gets its thread color (the nearest of the print's color
 * rows) and its shape (the connected piece of that color). What's puffed is picked by thread color, then fine-tuned by
 * clicking shapes on or off. The puffed part is measured at the print's real size: the thinnest and widest strokes
 * (from the distance to the nearest edge along each stroke's middle). Puff wants bold columns, about 1/8" to 1/2" wide
 * (Broken Arrow: 1/8"–1/4"; Printful: 0.2"–0.5"); the limits are in Production settings.
 */
export type PuffRow = { key: string; hexes: string[]; label: string };
/** what's puffed: thread colors (row keys), plus shapes clicked on / off (a point on the art, 0–1 of its width/height) */
export type PuffSel = { all?: boolean; colors?: string[]; on?: [number, number][]; off?: [number, number][] };
export type PuffMap = {
  w: number; h: number;
  /** each pixel's color row, -1 where nothing is stitched */ cls: Int16Array;
  /** each pixel's shape, -1 where nothing is stitched */ comp: Int32Array;
  compCls: number[]; compArea: number[];
  /** the art's stitched width in pixels (inches per pixel = print width ÷ this) */ artW: number;
  rgba: Uint8ClampedArray;
};

const hexRgb = (h: string) => { const x = h.replace("#", ""); return [parseInt(x.slice(0, 2), 16) || 0, parseInt(x.slice(2, 4), 16) || 0, parseInt(x.slice(4, 6), 16) || 0]; };

export function analyzeArt(img: HTMLImageElement, rows: PuffRow[], maxSide = 480): PuffMap | null {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  let px: Uint8ClampedArray;
  try { px = g.getImageData(0, 0, w, h).data; } catch { return null; }
  const pal: { r: number; g: number; b: number; i: number }[] = [];
  rows.forEach((row, i) => { for (const hx of row.hexes) { const [r, gg, b] = hexRgb(hx); pal.push({ r, g: gg, b, i }); } });
  const cls = new Int16Array(w * h).fill(-1);
  let x0 = w, x1 = -1;
  for (let p = 0; p < w * h; p++) {
    if (px[p * 4 + 3] < 128) continue;
    let best = 0, bd = Infinity;
    for (const q of pal) { const d = (px[p * 4] - q.r) ** 2 + (px[p * 4 + 1] - q.g) ** 2 + (px[p * 4 + 2] - q.b) ** 2; if (d < bd) { bd = d; best = q.i; } }
    cls[p] = pal.length ? best : 0;
    const x = p % w; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  // shapes: connected pixels of the same color
  const comp = new Int32Array(w * h).fill(-1), compCls: number[] = [], compArea: number[] = [];
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (cls[p] < 0 || comp[p] >= 0) continue;
    const id = compCls.length, c0 = cls[p]; let n = 0;
    comp[p] = id; stack.push(p);
    while (stack.length) {
      const q = stack.pop()!; n++;
      const x = q % w, y = (q / w) | 0;
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const r of nb) if (r >= 0 && comp[r] < 0 && cls[r] === c0) { comp[r] = id; stack.push(r); }
    }
    compCls.push(c0); compArea.push(n);
  }
  return { w, h, cls, comp, compCls, compArea, artW: x1 >= x0 ? x1 - x0 + 1 : w, rgba: px };
}

/** the shape at a point (0–1 of the art), looking a few pixels around when it lands between strokes */
export function shapeAt(m: PuffMap, pt: [number, number]): number {
  const cx = Math.round(pt[0] * (m.w - 1)), cy = Math.round(pt[1] * (m.h - 1));
  for (let r = 0; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    const c = m.comp[y * m.w + x]; if (c >= 0) return c;
  }
  return -1;
}

/** which shapes are puffed */
export function puffedShapes(m: PuffMap, rows: PuffRow[], sel: PuffSel): Set<number> {
  const out = new Set<number>();
  if (sel.all !== false && !sel.colors?.length && !sel.on?.length) { m.compCls.forEach((_, i) => out.add(i)); return out; }
  const cols = new Set((sel.colors || []).map((k) => rows.findIndex((r) => r.key === k)).filter((i) => i >= 0));
  m.compCls.forEach((c, i) => { if (cols.has(c)) out.add(i); });
  for (const pt of sel.off || []) { const s = shapeAt(m, pt); if (s >= 0) out.delete(s); }
  for (const pt of sel.on || []) { const s = shapeAt(m, pt); if (s >= 0) out.add(s); }
  return out;
}

/**
 * The puffed part's stroke widths at the print's real size (inches): the thinnest (10th percentile, so a stray corner
 * doesn't decide) and the widest (95th), each color on its own.
 */
export function puffWidths(m: PuffMap, shapes: Set<number>, wIn: number): { row: number; thin: number; wide: number }[] {
  const { w, h } = m, inPx = wIn > 0 ? wIn / m.artW : 0;
  if (!inPx) return [];
  const minArea = Math.max(4, (0.03 / inPx) ** 2);
  const on = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) { const c = m.comp[p]; if (c >= 0 && shapes.has(c) && m.compArea[c] >= minArea) on[p] = 1; }
  // distance to the nearest unpuffed pixel (chamfer 1 / √2)
  const D = new Float32Array(w * h), BIG = 1e6, S = Math.SQRT2;
  for (let p = 0; p < w * h; p++) D[p] = on[p] ? BIG : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (!D[p]) continue; let d = D[p];
    if (x > 0) d = Math.min(d, D[p - 1] + 1); else d = Math.min(d, 1);
    if (y > 0) { d = Math.min(d, D[p - w] + 1); if (x > 0) d = Math.min(d, D[p - w - 1] + S); if (x < w - 1) d = Math.min(d, D[p - w + 1] + S); } else d = Math.min(d, 1);
    D[p] = d; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const p = y * w + x; if (!D[p]) continue; let d = D[p];
    if (x < w - 1) d = Math.min(d, D[p + 1] + 1); else d = Math.min(d, 1);
    if (y < h - 1) { d = Math.min(d, D[p + w] + 1); if (x < w - 1) d = Math.min(d, D[p + w + 1] + S); if (x > 0) d = Math.min(d, D[p + w - 1] + S); } else d = Math.min(d, 1);
    D[p] = d; }
  // the middle of each stroke: a pixel no neighbor is farther in from the edge than
  const by = new Map<number, number[]>();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x, d = D[p]; if (!d) continue;
    if (D[p - 1] > d || D[p + 1] > d || D[p - w] > d || D[p + w] > d || D[p - w - 1] > d || D[p - w + 1] > d || D[p + w - 1] > d || D[p + w + 1] > d) continue;
    const r = m.cls[p]; if (!by.has(r)) by.set(r, []); by.get(r)!.push((2 * d - 0.5) * inPx);
  }
  const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
  return [...by.entries()].filter(([, a]) => a.length >= 3).map(([row, a]) => ({ row, thin: Math.round(pct(a, 0.1) * 100) / 100, wide: Math.round(pct(a, 0.95) * 100) / 100 }));
}

/** the logo with its puffed part raised and the rest faded, for the picker */
export function drawPuff(m: PuffMap, shapes: Set<number>, cv: HTMLCanvasElement) {
  cv.width = m.w; cv.height = m.h;
  const g = cv.getContext("2d"); if (!g) return;
  const out = g.createImageData(m.w, m.h), o = out.data, src = m.rgba;
  // a shadow under the puffed part (down and right) so it reads as raised
  const sh = Math.max(1, Math.round(m.w / 160));
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const p = y * m.w + x, c = m.comp[p];
    if (c >= 0 && !shapes.has(c)) { o[p * 4] = src[p * 4]; o[p * 4 + 1] = src[p * 4 + 1]; o[p * 4 + 2] = src[p * 4 + 2]; o[p * 4 + 3] = 70; continue; }
    if (c >= 0) { o[p * 4] = src[p * 4]; o[p * 4 + 1] = src[p * 4 + 1]; o[p * 4 + 2] = src[p * 4 + 2]; o[p * 4 + 3] = 255; continue; }
    const q = (y - sh) * m.w + (x - sh), cq = y >= sh && x >= sh ? m.comp[q] : -1;
    if (cq >= 0 && shapes.has(cq)) { o[p * 4 + 3] = 90; }
  }
  g.putImageData(out, 0, 0);
}
