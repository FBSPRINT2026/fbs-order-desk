/**
 * Filling a gang sheet the way a person would (Oct 26, Nick: "you should have moved the small [logos] under the other
 * small ones… or… the big logos all to be on one side… and then all the other ones fill on the right. There's ways to
 * figure out optimize"). Not fixed rows: every piece goes in the open space nearest the top of the film (then the
 * left), so small pieces drop into the holes beside and under big ones. Each piece is its size plus the gap, so there
 * is always room to cut between them.
 *
 * The film is filled in files no longer than `binH` (DTF Dallas: 250"); a piece that doesn't fit in one starts the next.
 */
export type PackItem = { piece: number; w: number; h: number; /** may it be turned a quarter */ turn: boolean; /** start turned */ rot: boolean };
export type PackRect = { piece: number; x: number; y: number; w: number; h: number; rot: boolean };
type Box = { x: number; y: number; w: number; h: number };
const E = 1e-6;

export function packFill(items: PackItem[], W: number, binH: number): { rects: PackRect[]; bins: { y: number; h: number }[] } | null {
  type Bin = { free: Box[]; used: number; rects: PackRect[] };
  const bins: Bin[] = [];
  const fresh = (): Bin => ({ free: [{ x: 0, y: 0, w: W, h: binH }], used: 0, rects: [] });
  for (const it of items) {
    const shapes: { w: number; h: number; rot: boolean }[] = [{ w: it.w, h: it.h, rot: it.rot }];
    if (it.turn && Math.abs(it.w - it.h) > E) shapes.push({ w: it.h, h: it.w, rot: !it.rot });
    if (!shapes.some((s) => s.w <= W + E && s.h <= binH + E)) return null;
    let done = false;
    for (let bi = 0; bi <= bins.length && !done; bi++) {
      if (bi === bins.length) bins.push(fresh());
      const b = bins[bi];
      // the spot whose bottom edge is highest up the film, then the leftmost; a tie keeps the shape that leaves less
      let best: { x: number; y: number; s: (typeof shapes)[number]; k: number; k2: number } | null = null;
      for (const f of b.free) for (const s of shapes) {
        if (s.w > f.w + E || s.h > f.h + E) continue;
        const k = f.y + s.h, k2 = f.x;
        if (!best || k < best.k - E || (Math.abs(k - best.k) <= E && k2 < best.k2 - E)) best = { x: f.x, y: f.y, s, k, k2 };
      }
      if (!best) { if (bi === bins.length - 1 && b.rects.length === 0) return null; continue; }
      const r: PackRect = { piece: it.piece, x: best.x, y: best.y, w: best.s.w, h: best.s.h, rot: best.s.rot };
      b.rects.push(r); b.used = Math.max(b.used, r.y + r.h);
      split(b, r);
      done = true;
    }
  }
  // the files one after another down the film
  const rects: PackRect[] = [], out: { y: number; h: number }[] = [];
  let y0 = 0;
  for (const b of bins) {
    if (!b.rects.length) continue;
    for (const r of b.rects) rects.push({ ...r, y: r.y + y0 });
    out.push({ y: y0, h: b.used });
    y0 += b.used;
  }
  return { rects, bins: out };
}

/** the open space around a placed piece: each open box it overlaps is cut into what's left on each side */
function split(b: { free: Box[] }, r: Box) {
  const next: Box[] = [];
  for (const f of b.free) {
    if (r.x >= f.x + f.w - E || r.x + r.w <= f.x + E || r.y >= f.y + f.h - E || r.y + r.h <= f.y + E) { next.push(f); continue; }
    if (r.x > f.x + E) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
    if (r.x + r.w < f.x + f.w - E) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
    if (r.y > f.y + E) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
    if (r.y + r.h < f.y + f.h - E) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
  }
  // drop boxes inside other boxes
  b.free = next.filter((a, i) => !next.some((c, j) => j !== i && a.x >= c.x - E && a.y >= c.y - E && a.x + a.w <= c.x + c.w + E && a.y + a.h <= c.y + c.h + E && (j < i || a.x !== c.x || a.y !== c.y || a.w !== c.w || a.h !== c.h)));
}
