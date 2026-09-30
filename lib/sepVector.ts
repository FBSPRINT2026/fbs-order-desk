/**
 * Plates → smooth vector shapes, for the Illustrator file.
 *
 *   1. Outline at sub-pixel precision: marching squares at the 50% level of the plate, placing each outline point
 *      where the plate's soft (anti-aliased) edge crosses 50%, not on the pixel grid, so there are no stair-steps.
 *   2. Corners: points where the outline turns sharply stay sharp (a flame's tip, a letter's corner).
 *   3. Curves: every stretch between corners is fitted with cubic Béziers (Schneider's algorithm), within a
 *      fraction of a pixel of the outline, so a round dot comes out round and a long curve as a few clean curves.
 * Holes come out as their own loops; the caller fills with even-odd. Specks under `minArea` px² are dropped.
 */
export type Loop = number[]; // x0, y0, x1, y1, … in pixels (closed)
type P = [number, number];

/** outline loops of alpha ≥ iso, sub-pixel (in pixel units, pixel centers at +0.5) */
export function contours(alpha: Uint8Array, w: number, h: number, iso = 128): P[][] {
  const W2 = w + 2;
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);
  // edge keys: horizontal edge from (x,y) to (x+1,y) and vertical from (x,y) to (x,y+1), x,y from -1
  const H = (x: number, y: number) => ((y + 1) * W2 + (x + 1)) * 2, V = (x: number, y: number) => ((y + 1) * W2 + (x + 1)) * 2 + 1;
  const pt = new Map<number, P>();
  const at = (k: number, x0: number, y0: number, x1: number, y1: number) => {
    if (pt.has(k)) return k;
    const a = v(x0, y0), b = v(x1, y1), t = a === b ? 0.5 : (iso - a) / (b - a);
    pt.set(k, [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]);
    return k;
  };
  const link = new Map<number, number[]>();
  const seg = (a: number, b: number) => { const la = link.get(a); if (la) la.push(b); else link.set(a, [b]); const lb = link.get(b); if (lb) lb.push(a); else link.set(b, [a]); };
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const tl = v(x, y) >= iso ? 8 : 0, tr = v(x + 1, y) >= iso ? 4 : 0, br = v(x + 1, y + 1) >= iso ? 2 : 0, bl = v(x, y + 1) >= iso ? 1 : 0;
    const c = tl | tr | br | bl; if (c === 0 || c === 15) continue;
    const T = () => at(H(x, y), x, y, x + 1, y), B = () => at(H(x, y + 1), x, y + 1, x + 1, y + 1);
    const L = () => at(V(x, y), x, y, x, y + 1), R = () => at(V(x + 1, y), x + 1, y, x + 1, y + 1);
    const mid = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= iso;
    switch (c) {
      case 1: case 14: seg(L(), B()); break;
      case 2: case 13: seg(B(), R()); break;
      case 3: case 12: seg(L(), R()); break;
      case 4: case 11: seg(T(), R()); break;
      case 6: case 9: seg(T(), B()); break;
      case 7: case 8: seg(L(), T()); break;
      case 5: if (mid) { seg(L(), T()); seg(B(), R()); } else { seg(T(), R()); seg(L(), B()); } break;
      case 10: if (mid) { seg(T(), R()); seg(L(), B()); } else { seg(L(), T()); seg(B(), R()); } break;
    }
  }
  // walk the links into closed loops (every crossing point joins exactly two segments)
  const loops: P[][] = [];
  const used = new Set<number>();
  for (const start of link.keys()) {
    if (used.has(start)) continue;
    const loop: P[] = []; let prev = -1, cur = start;
    for (let guard = 0; guard < 4e6; guard++) {
      used.add(cur); loop.push(pt.get(cur)!);
      const nx = link.get(cur)!; const next = nx[0] !== prev ? nx[0] : nx[1];
      if (next === undefined || next === start || used.has(next)) break;
      prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mulS = (a: P, s: number): P => [a[0] * s, a[1] * s];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const len = (a: P) => Math.hypot(a[0], a[1]);
const unit = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const area = (p: P[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

/* ---------- Bézier fitting (Philip J. Schneider, Graphics Gems, 1990) ---------- */
type Bez = [P, P, P, P];
const bez = (b: Bez, t: number): P => { const u = 1 - t; return [u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0], u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]; };
const bezD = (b: Bez, t: number): P => { const u = 1 - t; return [3 * (u * u * (b[1][0] - b[0][0]) + 2 * u * t * (b[2][0] - b[1][0]) + t * t * (b[3][0] - b[2][0])), 3 * (u * u * (b[1][1] - b[0][1]) + 2 * u * t * (b[2][1] - b[1][1]) + t * t * (b[3][1] - b[2][1]))]; };
const bezDD = (b: Bez, t: number): P => { const u = 1 - t; return [6 * (u * (b[2][0] - 2 * b[1][0] + b[0][0]) + t * (b[3][0] - 2 * b[2][0] + b[1][0])), 6 * (u * (b[2][1] - 2 * b[1][1] + b[0][1]) + t * (b[3][1] - 2 * b[2][1] + b[1][1]))]; };

function chordParams(p: P[]): number[] {
  const u = [0]; for (let i = 1; i < p.length; i++) u.push(u[i - 1] + len(sub(p[i], p[i - 1])));
  const L = u[u.length - 1] || 1; return u.map((x) => x / L);
}
function generate(p: P[], u: number[], t1: P, t2: P): Bez {
  const first = p[0], last = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const A1 = mulS(t1, b1), A2 = mulS(t2, b2);
    c00 += dot(A1, A1); c01 += dot(A1, A2); c11 += dot(A2, A2);
    const tmp = sub(p[i], add(mulS(first, b0 + b1), mulS(last, b2 + b3)));
    x0 += dot(A1, tmp); x1 += dot(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let a1 = det ? (x0 * c11 - x1 * c01) / det : 0, a2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  // handles longer than the stretch itself are a bad fit (they make spikes): fall back to a third of the chord
  let arc = 0; for (let i = 1; i < p.length; i++) arc += len(sub(p[i], p[i - 1]));
  const seg = len(sub(last, first)), eps = 1e-6 * seg;
  if (a1 < eps || a2 < eps || a1 > arc || a2 > arc) { a1 = a2 = seg / 3; }
  return [first, add(first, mulS(t1, a1)), add(last, mulS(t2, a2)), last];
}
function maxErr(p: P[], b: Bez, u: number[]): [number, number] {
  let m = 0, at = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) { const d = sub(bez(b, u[i]), p[i]); const e = dot(d, d); if (e > m) { m = e; at = i; } }
  return [m, at];
}
function reparam(p: P[], u: number[], b: Bez): number[] {
  return u.map((t, i) => { const d = sub(bez(b, t), p[i]), d1 = bezD(b, t), d2 = bezDD(b, t); const num = dot(d, d1), den = dot(d1, d1) + dot(d, d2); return den ? Math.min(1, Math.max(0, t - num / den)) : t; });
}
function fitCubic(p: P[], t1: P, t2: P, err: number, out: Bez[], depth = 0) {
  if (p.length === 2) { const d = len(sub(p[1], p[0])) / 3; out.push([p[0], add(p[0], mulS(t1, d)), add(p[1], mulS(t2, d)), p[1]]); return; }
  let u = chordParams(p), b = generate(p, u, t1, t2), [e, split] = maxErr(p, b, u);
  if (e < err) { out.push(b); return; }
  if (e < err * 16) {
    for (let i = 0; i < 6; i++) { u = reparam(p, u, b); b = generate(p, u, t1, t2); [e, split] = maxErr(p, b, u); if (e < err) { out.push(b); return; } }
  }
  if (depth > 40) { out.push(b); return; }
  split = Math.max(1, Math.min(p.length - 2, split));
  const tc = unit(sub(p[split - 1], p[split + 1]));
  fitCubic(p.slice(0, split + 1), t1, tc, err, out, depth + 1);
  fitCubic(p.slice(split), mulS(tc, -1), t2, err, out, depth + 1);
}

/** a closed outline as Béziers: corners stay sharp, everything else is fitted within `tol` px */
function fitLoop(loop: P[], tol: number): Bez[] {
  const n = loop.length;
  // corner: the outline turns more than ~55° over a few points, and more than its neighbors
  const K = 3, turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = unit(sub(loop[i], loop[(i - K + n) % n])), b = unit(sub(loop[(i + K) % n], loop[i]));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  }
  const corners: number[] = [];
  if (n > 4 * K) for (let i = 0; i < n; i++) {
    if (turn[i] < 0.95) continue;
    let top = true; for (let k = -K; k <= K; k++) if (k && turn[(i + k + n) % n] > turn[i]) { top = false; break; }
    if (top && (!corners.length || i - corners[corners.length - 1] > K)) corners.push(i);
  }
  if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] <= K) corners.pop();
  const out: Bez[] = [], err = tol * tol;
  const tanAt = (i: number) => unit(sub(loop[(i + 2) % n], loop[(i - 2 + n) % n]));
  if (!corners.length) {
    // smooth all the way round (a dot, an O): at least four curves, like a drawn circle, each fitted with the
    // outline's own tangent at the joins so the curve flows through them
    const q = [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4)];
    for (let c = 0; c < 4; c++) {
      const a = q[c], b = c === 3 ? n : q[c + 1];
      const pts: P[] = []; for (let i = a; i <= b; i++) pts.push(loop[i % n]);
      if (pts.length < 2) continue;
      fitCubic(pts, tanAt(a % n), mulS(tanAt(b % n), -1), err, out);
    }
    return out;
  }
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c], b = corners[(c + 1) % corners.length];
    const pts: P[] = []; for (let i = a; ; i = (i + 1) % n) { pts.push(loop[i]); if (i === b && pts.length > 1) break; if (pts.length > n + 1) break; }
    if (pts.length < 2) continue;
    const t1 = unit(sub(pts[Math.min(2, pts.length - 1)], pts[0])), t2 = unit(sub(pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]));
    fitCubic(pts, t1, t2, err, out);
  }
  return out;
}

/**
 * A plate as PDF path operators (m / c / h), in page units: x·s, H − y·s. `tol` is how far (in plate pixels)
 * the curves may stray from the outline.
 */
export function traceCurves(alpha: Uint8Array, w: number, h: number, s: number, H: number, tol = 0.2, minArea = 4): string {
  const f = (p: P) => `${(p[0] * s).toFixed(2)} ${(H - p[1] * s).toFixed(2)}`;
  let path = "";
  for (const loop of contours(alpha, w, h)) {
    if (Math.abs(area(loop)) < minArea) continue;
    const bz = fitLoop(loop, tol);
    if (!bz.length) continue;
    path += `${f(bz[0][0])} m\n`;
    for (const b of bz) path += `${f(b[1])} ${f(b[2])} ${f(b[3])} c\n`;
    path += "h\n";
  }
  return path;
}

/** straight-line outlines (sub-pixel), for anything that wants polygons */
export function traceMask(alpha: Uint8Array, w: number, h: number, cut = 128, _eps = 0.8, minArea = 6): Loop[] {
  void _eps;
  return contours(alpha, w, h, cut).filter((l) => Math.abs(area(l)) >= minArea).map((l) => l.flat());
}
