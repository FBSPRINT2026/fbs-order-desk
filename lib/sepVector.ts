/**
 * Plates → vector shapes, for the Illustrator file. A solid (spot) plate is thresholded, its outlines are followed
 * along the pixel edges (outer edges clockwise, holes counter-clockwise, so an even-odd fill gets the holes right),
 * straight runs are merged and the stair-steps are smoothed out with Douglas–Peucker. Specks are dropped.
 */
export type Loop = number[]; // x0, y0, x1, y1, … in pixels (closed)

export function traceMask(alpha: Uint8Array, w: number, h: number, cut = 128, eps = 0.8, minArea = 6): Loop[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= cut;
  const W1 = w + 1;
  // outgoing boundary edges per lattice vertex (at most 2, at a saddle)
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = y0 * W1 + x0; const v = y1 * W1 + x1; const l = out.get(k); if (l) l.push(v); else out.set(k, [v]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Loop[] = [];
  for (const [start, list] of out) {
    while (list.length) {
      const pts: number[] = [];
      let from = start, to = list.pop()!;
      pts.push(from % W1, Math.floor(from / W1));
      for (let guard = 0; guard < 4 * (w + h) * 8 + 16 && to !== start; guard++) {
        pts.push(to % W1, Math.floor(to / W1));
        const nx = out.get(to)!;
        if (!nx || !nx.length) break;
        let pick = 0;
        if (nx.length > 1) {
          // at a saddle, turn right (keeps diagonal-touching pixels as separate shapes)
          const dx = to % W1 - from % W1, dy = Math.floor(to / W1) - Math.floor(from / W1);
          const rx = -dy, ry = dx; // right turn in y-down coordinates
          pick = nx.findIndex((v) => v % W1 - to % W1 === rx && Math.floor(v / W1) - Math.floor(to / W1) === ry);
          if (pick < 0) pick = 0;
        }
        from = to; to = nx.splice(pick, 1)[0];
      }
      if (pts.length >= 8 && Math.abs(area(pts)) >= minArea) loops.push(simplify(pts, eps));
    }
  }
  return loops.filter((l) => l.length >= 6);
}

function area(p: number[]) { let s = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; s += p[i] * p[j + 1] - p[j] * p[i + 1]; } return s / 2; }

/** Douglas–Peucker on a closed loop (split at the point farthest from the first) */
function simplify(p: number[], eps: number): number[] {
  const n = p.length / 2;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  // points strictly between a and b (going forward, wrapping); a stack instead of recursion (long outlines)
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * (b % n)], by = p[2 * (b % n) + 1];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) { const k = i % n; const d = Math.abs((bx - ax) * (ay - p[2 * k + 1]) - (ax - p[2 * k]) * (by - ay)) / L; if (d > bd) { bd = d; best = i; } }
    if (best >= 0 && bd > eps) { keep[best % n] = 1; stack.push([a, best], [best, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}
