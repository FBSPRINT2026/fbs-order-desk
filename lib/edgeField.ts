/**
 * Where an anti-aliased plate's edge really runs, to a small fraction of a pixel.
 *
 * A soft edge pixel's coverage (how much of it is ink) plus the direction the edge faces (the gradient around it)
 * pins down the straight edge line through that pixel: the method signed-distance font rendering uses (Gustavson &
 * Strand, "Anti-aliased Euclidean distance transform", 2011). Films and traced outlines follow those lines instead
 * of a straight blend between pixel centers, so a curve drawn at 150–250 ppi comes out smooth at 1200 dpi (5–12×
 * fewer wrong film pixels than bilinear in our tests) — without redrawing anything: art with hard pixel edges (no
 * soft pixels) has no edge lines to read and stays exactly as drawn.
 *
 * Streams row by row (films and the tracer both go top to bottom), so it never holds a full-size field in memory.
 */
export type EdgeRow = { sd: Float32Array; nx: Float32Array; ny: Float32Array; /** raw rows: 1 where the pixel has its own edge line */ e?: Uint8Array };

/** distance (px) from a pixel's center to the edge line through it, for coverage a (0–1) and gradient (gx, gy);
 *  positive when the center is outside the ink */
export function edgedf(gx: number, gy: number, a: number): number {
  if (a <= 0 || a >= 1 || !gx || !gy) return 0.5 - a;
  const L = Math.hypot(gx, gy); let X = Math.abs(gx / L), Y = Math.abs(gy / L);
  if (X < Y) { const t = X; X = Y; Y = t; }
  const a1 = (0.5 * Y) / X;
  if (a < a1) return 0.5 * (X + Y) - Math.sqrt(2 * X * Y * a);
  if (a < 1 - a1) return (0.5 - a) * X;
  return -0.5 * (X + Y) + Math.sqrt(2 * X * Y * (1 - a));
}

/**
 * Row y of the plate's edge field: for every pixel, the signed distance from its center to the edge (px, negative
 * inside the ink) and the edge's outward normal. Soft pixels carry their own edge line; a full or empty pixel next to
 * one borrows its neighbor's line (kept on the right side of the edge); pixels away from any edge get ±2 and no normal.
 * The signed distance anywhere is then Σ bilinear weight · (sd + n · offset from that pixel).
 */
export function edgeRows(a: Uint8Array, w: number, h: number): (y: number) => EdgeRow {
  const raw = new Map<number, EdgeRow>(), full = new Map<number, EdgeRow>();
  let top = 0;
  const A = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  const rawRow = (y: number): EdgeRow => {
    let r = raw.get(y); if (r) return r;
    r = { sd: new Float32Array(w).fill(NaN), nx: new Float32Array(w), ny: new Float32Array(w), e: new Uint8Array(w) };
    if (y >= 0 && y < h) for (let x = 0; x < w; x++) {
      const v = a[y * w + x]; if (v === 0 || v === 255) continue;
      const gx = A(x + 1, y - 1) + 2 * A(x + 1, y) + A(x + 1, y + 1) - A(x - 1, y - 1) - 2 * A(x - 1, y) - A(x - 1, y + 1);
      const gy = A(x - 1, y + 1) + 2 * A(x, y + 1) + A(x + 1, y + 1) - A(x - 1, y - 1) - 2 * A(x, y - 1) - A(x + 1, y - 1);
      // a real edge, not the slight ripple inside a flat area (a full edge gives ~1020; a 16-level ripple ~64): without
      // this, a flat 90% area would grow edge lines in its middle and the film would get pinholes
      const L = Math.hypot(gx, gy); if (L < 160) continue;
      r.sd[x] = edgedf(gx, gy, v / 255); r.nx[x] = -gx / L; r.ny[x] = -gy / L; r.e![x] = 1;
    }
    raw.set(y, r); return r;
  };
  return (y: number): EdgeRow => {
    let r = full.get(y); if (r) return r;
    if (y > top) { top = y; for (const k of [...full.keys()]) if (k < y - 3) full.delete(k); for (const k of [...raw.keys()]) if (k < y - 4) raw.delete(k); }
    const rows = [rawRow(y - 1), rawRow(y), rawRow(y + 1)], me = rows[1];
    r = { sd: new Float32Array(w), nx: new Float32Array(w), ny: new Float32Array(w) };
    const e0 = rows[0].e!, e1 = rows[1].e!, e2 = rows[2].e!, base = y >= 0 && y < h ? y * w : -1;
    for (let x = 0; x < w; x++) {
      if (e1[x]) { r.sd[x] = me.sd[x]; r.nx[x] = me.nx[x]; r.ny[x] = me.ny[x]; continue; }
      const v = base >= 0 ? a[base + x] : 0;
      // no edge pixel around: clearly in or out
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      if (!(e0[xl] | e0[x] | e0[xr] | e1[xl] | e1[xr] | e2[xl] | e2[x] | e2[xr])) { r.sd[x] = v >= 128 ? -2 : 2; continue; }
      // the neighbor edge pixel closest to half covered (the most certain line), nearest first on ties
      let bd = 9, bx = 0, by = 0, br: EdgeRow | null = null;
      for (let dy = -1; dy <= 1; dy++) {
        const rr = rows[dy + 1], yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w || Number.isNaN(rr.sd[xx])) continue;
          const d = Math.abs(a[yy * w + xx] / 255 - 0.5) + 0.01 * (dx * dx + dy * dy);
          if (d < bd) { bd = d; bx = xx; by = yy; br = rr; }
        }
      }
      if (br) {
        let s = br.sd[bx] + br.nx[bx] * (x - bx) + br.ny[bx] * (y - by);
        // a full pixel's center is at least half a pixel inside; an empty one's half a pixel outside
        if (v >= 128 && s > -0.5) s = -0.5; else if (v < 128 && s < 0.5) s = 0.5;
        r.sd[x] = s; r.nx[x] = br.nx[bx]; r.ny[x] = br.ny[bx];
      } else r.sd[x] = v >= 128 ? -2 : 2;
    }
    full.set(y, r); return r;
  };
}
