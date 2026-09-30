/**
 * Screen-print color separations, done in the browser (our own engine, the same job Separo does):
 *   1. find the art's inks: k-means in Lab over the opaque pixels, near-duplicates merged, specks dropped
 *   2. snap each to a real ink (Wilflex RFU by default, PMS if you pick one)
 *   3. split the art into one plate per ink:
 *        spot   every pixel goes to its nearest ink (solid plates; soft edges keep their alpha)
 *        sim    simulated process: each pixel is unmixed into the inks over the garment (halftone plates)
 *   4. dark garment: a white underbase under everything that isn't the shirt color or near-black, choked a
 *      little so it doesn't peek out; the art's white prints again last as the highlight white
 *   5. colors that match the shirt are dropped (the shirt shows through)
 * Plates are 0–255 ink coverage per pixel. Films come from them in lib/filmPdf.ts (solid or halftoned).
 * Everything here is plain math on RGBA arrays so it runs in the page, a worker, or a test.
 */
import { WILFLEX_HEX, PMS_HEX, deltaE } from "./inkColors";
import { edgeRows } from "./edgeField";

export type Px = { w: number; h: number; data: Uint8ClampedArray | Uint8Array };
export type PlateKind = "underbase" | "color" | "highlight";
export type Plate = { key: string; name: string; hex: string; kind: PlateKind; alpha: Uint8Array; coverage: number; mesh: number; /** needs halftones (a mixed color, or simulated process) */ tonal?: boolean;
  /** fine detail: what was added to this color to cover the base's edge (in `alpha` already; vector output adds it as a shape) */ bump?: Uint8Array };
export type SepMethod = "spot" | "sim";
export type SepSettings = {
  method: SepMethod;
  /** garment color (#hex) */
  garment: string;
  /** most inks to find (the art may need fewer) */
  maxColors: number;
  /** white underbase: "auto" = on dark garments */
  underbase: "auto" | "on" | "off";
  /** how far the underbase is pulled in from the edges, in pixels of the working image */
  choke: number;
  /** print the art's white again on top (dark garments) */
  highlight: boolean;
  /** leave out ink that matches the shirt */
  dropGarment: boolean;
  /** spot color: how far (px of the working image, fractions allowed) each color spreads under the darker colors
   *  printed after it, so neighbors overlap a hair instead of just touching. Default 0. */
  trap?: number;
  /** fine detail (small type, thin lines): parts of the underbase narrower than this (px) can't take the full choke
   *  (it would thin them to nothing). There the base is choked only `fineChoke` and the color on top is made
   *  `bump` px fatter out onto the shirt instead, so it still covers the base's edge. 0 / unset = off. */
  fine?: number;
  fineChoke?: number;
  bump?: number;
  /** dark shirt: which inks get underbase under them (plate key "c" + art hex → on/off); the rest follow
   *  `baseByDefault` (not black, not dark colors like navy) */
  baseFor?: Record<string, boolean>;
  /** inks the user fixed: palette hex → ink name (Wilflex / PMS / #hex) */
  inkNames?: Record<string, string>;
};
export const DEFAULT_SEP: SepSettings = { method: "spot", garment: "#FFFFFF", maxColors: 8, underbase: "auto", choke: 2, highlight: true, dropGarment: true };

/* ---------- color helpers ---------- */
const rgbOf = (h: string): [number, number, number] => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const hexOf = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const lin = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
const LIN = Float32Array.from({ length: 256 }, (_, i) => lin(i));
function labOf(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
export const lightness = (hex: string) => labOf(...rgbOf(hex))[0];
export const isDark = (hex: string) => lightness(hex) < 55;
const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** the standard ink closest to a color, and how close (CIEDE2000) */
export function snapInk(hex: string, lib: "wilflex" | "pms" = "wilflex") {
  const chart = lib === "pms" ? PMS_HEX : WILFLEX_HEX;
  let best = "", bd = Infinity;
  for (const [name, h] of Object.entries(chart)) { const d = deltaE(hex, h); if (d < bd) { bd = d; best = name; } }
  return { name: best, hex: chart[best], dE: bd };
}

/* ---------- 1. find the inks ---------- */
export type Found = { hex: string; share: number };
/**
 * The art's main colors: k-means++ in Lab on a sample of opaque pixels, then colors closer than `merge`
 * (CIEDE2000) are joined and anything under `minShare` of the art is dropped. Largest first.
 */
export function findColors(px: Px, max = 8, merge = 9, minShare = 0.004, garment?: string): Found[] {
  const { data } = px, n = px.w * px.h;
  const pts: [number, number, number][] = [], rgbs: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(n / 60000)), W = px.w;
  // sample flat areas only: a pixel that matches its neighbors is a real ink; the in-between pixels along edges
  // (anti-aliasing, black outlines over yellow) would otherwise become fake "colors" and pull real ones together
  const flat = (i: number) => {
    const o = i * 4, x = i % W;
    for (const j of [x > 0 ? i - 1 : i, x < W - 1 ? i + 1 : i, i >= W ? i - W : i, i + W < n ? i + W : i]) {
      const q = j * 4; if (data[q + 3] < 160 || Math.abs(data[q] - data[o]) + Math.abs(data[q + 1] - data[o + 1]) + Math.abs(data[q + 2] - data[o + 2]) > 24) return false;
    }
    return true;
  };
  for (let pass = 0; pass < 2 && pts.length < 500; pass++)
    for (let i = 0; i < n; i += step) { const o = i * 4; if (data[o + 3] < 160 || (!pass && !flat(i))) continue; rgbs.push([data[o], data[o + 1], data[o + 2]]); pts.push(labOf(data[o], data[o + 1], data[o + 2])); }
  if (!pts.length) return [];
  const k = Math.min(Math.max(max + 8, 8), 20, pts.length);
  // k-means++ seeding (deterministic: a fixed-seed random)
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const cent: number[][] = [pts[Math.floor(rnd() * pts.length)].slice()];
  const dist = new Float64Array(pts.length).fill(Infinity);
  while (cent.length < k) {
    let sum = 0; const c = cent[cent.length - 1];
    for (let i = 0; i < pts.length; i++) { const d = d2(pts[i], c); if (d < dist[i]) dist[i] = d; sum += dist[i]; }
    if (!sum) break;
    let r = rnd() * sum, j = 0; for (; j < pts.length - 1; j++) { r -= dist[j]; if (r <= 0) break; }
    cent.push(pts[j].slice());
  }
  const lab = new Uint8Array(pts.length);
  for (let it = 0; it < 14; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { let b = 0, bd = Infinity; for (let c = 0; c < cent.length; c++) { const d = d2(pts[i], cent[c]); if (d < bd) { bd = d; b = c; } } lab[i] = b; const a = acc[b]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
    for (let c = 0; c < cent.length; c++) if (acc[c][3]) cent[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
  }
  // each cluster as the average of its real pixels (sRGB), with its share
  let groups = cent.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < pts.length; i++) { const g = groups[lab[i]]; g.r += rgbs[i][0]; g.g += rgbs[i][1]; g.b += rgbs[i][2]; g.n++; }
  let list = groups.filter((g) => g.n).map((g) => ({ hex: hexOf(g.r / g.n, g.g / g.n, g.b / g.n), n: g.n }));
  // join look-alikes (biggest keeps its color)
  list.sort((a, b) => b.n - a.n);
  const out: { hex: string; n: number }[] = [];
  for (const c of list) { const hit = out.find((o) => deltaE(o.hex, c.hex) < merge); if (hit) hit.n += c.n; else out.push({ ...c }); }
  const total = pts.length;
  // small colors: kept when they're big enough, or when they're a real detail ink (a solid inside of their own,
  // like a thin tan mustache), not scattered noise
  const L0 = (h: string) => labOf(...rgbOf(h));
  const solidInside = (hex: string) => {
    const t = L0(hex); let inside = 0, near = 0; const H0 = px.h;
    const close = (j: number) => { const q = j * 4; if (data[q + 3] < 160) return false; return d2(labOf(data[q], data[q + 1], data[q + 2]), t) < 64; };
    for (let i = 0; i < n; i += step) {
      if (!close(i)) continue; near++;
      const x = i % W, y = (i - x) / W; if (x < 1 || y < 1 || x >= W - 1 || y >= H0 - 1) continue;
      let all = true; for (const dy of [-1, 0, 1]) { for (const dx of [-1, 0, 1]) if ((dx || dy) && !close(i + dy * W + dx)) { all = false; break; } if (!all) break; }
      if (all) inside++;
    }
    return near ? inside / near : 0;
  };
  let res = out.filter((c) => c.n / total >= minShare || (c.n / total >= minShare / 8 && solidInside(c.hex) > 0.3)).map((c) => ({ hex: c.hex, share: c.n / total }));
  // a small color that sits on the line between two bigger ones is their blend (an edge), not an ink, unless it has
  // a solid inside of its own: a real ink (the tan of a mustache, between orange and black) fills areas; an edge blend
  // is only ever a thin band
  const L = L0, interior = solidInside;
  res = res.filter((c, i) => {
    if (c.share > 0.08) return true;
    const p = L(c.hex);
    let blend = false;
    for (let a = 0; a < res.length; a++) for (let b = a + 1; b < res.length; b++) {
      if (a === i || b === i || res[a].share < c.share || res[b].share < c.share) continue;
      const A = L(res[a].hex), B = L(res[b].hex), AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], AP = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
      const len = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2; if (!len) continue;
      const tt = (AP[0] * AB[0] + AP[1] * AB[1] + AP[2] * AB[2]) / len; if (tt < 0.1 || tt > 0.9) continue;
      const d = Math.sqrt((AP[0] - tt * AB[0]) ** 2 + (AP[1] - tt * AB[1]) ** 2 + (AP[2] - tt * AB[2]) ** 2);
      if (d < 7) { blend = true; break; }
    }
    return !blend || interior(c.hex) > 0.3;
  });
  // still too many: drop the ink that's easiest to do without, one at a time: the one the others mix best
  // (as halftones over the shirt, or over the underbase on a dark shirt, where white comes free), weighed by how much
  // of the art it is. Separo takes the sun from yellow, gold, orange, white, black down to yellow, orange, black:
  // gold is yellow + orange, white is the underbase.
  if (res.length > max && garment) {
    const gl = rgbOf(garment).map((v) => LIN[v]), dark = labOf(...rgbOf(garment))[0] < 55, base = dark ? [1, 1, 1] : gl;
    const linOf = (h: string) => rgbOf(h).map((v) => LIN[v]);
    const cost = (i: number) => {
      const t = linOf(res[i].hex), K = res.filter((_, j) => j !== i).map((c) => linOf(c.hex)); if (dark) K.push(gl);
      const x = unmix(t, base, K); let sum = 0; const r = [0, 0, 0];
      for (let k = 0; k < K.length; k++) { sum += x[k]; for (let c = 0; c < 3; c++) r[c] += x[k] * K[k][c]; }
      const rec = r.map((v, c) => Math.max(0, v + (1 - sum) * base[c]));
      const a = labLin(rec[0], rec[1], rec[2]), b = labOf(...rgbOf(res[i].hex));
      return Math.sqrt(res[i].share) * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    while (res.length > max && res.length > 1) {
      let bi = 0, bc = Infinity;
      for (let i = 0; i < res.length; i++) { const c = cost(i); if (c < bc) { bc = c; bi = i; } }
      const gone = res[bi]; res = res.filter((x) => x !== gone);
      // its pixels go to the nearest ink left (only the shares; the plates are unmixed later)
      let nj = 0, nd = Infinity; res.forEach((c, j) => { const d = deltaE(c.hex, gone.hex); if (d < nd) { nd = d; nj = j; } }); res[nj].share += gone.share;
    }
  }
  // no shirt given: join the closest pair until it fits
  while (res.length > max) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < res.length; i++) for (let j = i + 1; j < res.length; j++) { const d = deltaE(res[i].hex, res[j].hex); if (d < bd) { bd = d; bi = i; bj = j; } }
    const [a, b] = res[bi].share >= res[bj].share ? [res[bi], res[bj]] : [res[bj], res[bi]];
    a.share += b.share; res = res.filter((x) => x !== b);
  }
  groups = [];
  return res.sort((a, b) => b.share - a.share);
}

/** Lab → #hex (clamped into sRGB) */
export function labHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz);
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const g = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  return hexOf(g(R), g(G), g(B));
}

/** Lab from linear-light RGB (0–1) */
function labLin(R: number, G: number, B: number): [number, number, number] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/**
 * Inks for simulated process. Not the average colors (those come out muddy) but strong, clean inks that halftones
 * can mix every color in the art from (how Separo picks: 3245 C aqua, 388 C yellow, 802 C green, 807 C pink,
 * 363 C dark green, 2369 C violet, 273 C indigo, black… for a rainbow tiger).
 *   - candidates: the saturated end of every hue × lightness family in the art (a bright green AND a dark green),
 *     plus black and white
 *   - picked one at a time: each round adds the candidate that best lowers the error (CIE ΔE) when every color in
 *     the art is unmixed into the chosen inks over the shirt (over the white underbase on a dark shirt, with the
 *     shirt itself free), so an ink only gets in if it earns its screen
 *   - stops at `max` inks, or earlier when another ink barely helps
 * Dark shirt: white always comes first (it's the underbase and highlight).
 */
export function findSimInks(px: Px, garment: string, max = 8): Found[] {
  const { data } = px, n = px.w * px.h, step = Math.max(1, Math.floor(n / 200000));
  const cnt = new Map<number, number>(), pts: { L: number; a: number; b: number; C: number; h: number }[] = [];
  let tot = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4; if (data[o + 3] < 160) continue; tot++;
    const q = Q(data[o], data[o + 1], data[o + 2]); cnt.set(q, (cnt.get(q) || 0) + 1);
    const [L, a, b] = labOf(data[o], data[o + 1], data[o + 2]), C = Math.hypot(a, b);
    if (C >= 18 && L >= 10) pts.push({ L, a, b, C, h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 });
  }
  if (!tot) return [];
  const g = rgbOf(garment).map((v) => LIN[v]), gL = lightness(garment), dark = gL < 55;
  const base = dark ? [1, 1, 1] : g;
  // the colors to match: the heaviest 5-bit colors, weighted by how much of the art they are
  const tg = [...cnt].sort((x, y) => y[1] - x[1]).slice(0, 600).map(([q, w]) => { const c = unQ(q), l = c.map((v) => LIN[v]); return { l, lab: labLin(l[0], l[1], l[2]), w }; });
  // candidates: the strong end (top fifth by chroma) of each 20° hue × lightness family
  const cand = new Map<string, number>();
  const bands = [[10, 38], [38, 62], [62, 101]];
  for (let hb = 0; hb < 18; hb++) for (const [lo, hi] of bands) {
    const fam = pts.filter((p) => p.L >= lo && p.L < hi && Math.floor(p.h / 20) === hb);
    if (fam.length < 0.004 * tot) continue;
    fam.sort((x, y) => y.C - x.C);
    const top = fam.slice(0, Math.max(1, Math.ceil(fam.length / 5)));
    const hex = labHex(top.reduce((s, p) => s + p.L, 0) / top.length, top.reduce((s, p) => s + p.a, 0) / top.length, top.reduce((s, p) => s + p.b, 0) / top.length);
    cand.set(hex, fam.length / tot);
  }
  if (gL > 16) cand.set("#111111", 0);
  if (!dark && gL < 95) cand.set("#FFFFFF", 0);
  const C = [...cand.keys()], CL = C.map((h) => rgbOf(h).map((v) => LIN[v]));
  // how well a set of inks rebuilds the art (weighted squared ΔE)
  const err = (set: number[]) => {
    const K = set.map((j) => CL[j]); if (dark) K.push(g);
    let e = 0;
    for (const t of tg) {
      const x = unmix(t.l, base, K);
      let s = 0; const r = [0, 1, 2].map((c) => { let v = 0; for (let k = 0; k < K.length; k++) v += x[k] * K[k][c]; return v; });
      for (let k = 0; k < x.length; k++) s += x[k];
      const rec = r.map((v, c) => Math.max(0, v + (1 - s) * base[c]));
      const lb = labLin(rec[0], rec[1], rec[2]);
      e += t.w * ((lb[0] - t.lab[0]) ** 2 + (lb[1] - t.lab[1]) ** 2 + (lb[2] - t.lab[2]) ** 2);
    }
    return e;
  };
  const out: Found[] = dark ? [{ hex: "#FFFFFF", share: 0 }] : [];
  const chosen: number[] = [];
  let cur = err([]);
  const e0 = cur;
  while (out.length + chosen.length < max && chosen.length < C.length) {
    let best = -1, be = cur;
    for (let j = 0; j < C.length; j++) { if (chosen.includes(j)) continue; const e = err([...chosen, j]); if (e < be) { be = e; best = j; } }
    if (best < 0 || cur - be < 0.001 * e0) break;
    chosen.push(best); cur = be;
  }
  for (const j of chosen) out.push({ hex: C[j], share: cand.get(C[j]) || 0 });
  return out;
}

/** How much of the art is soft gradients / photo (a hint for simulated process): share of pixels far from every found color. */
export function gradientShare(px: Px, colors: string[]): number {
  if (!colors.length) return 0;
  const labs = colors.map((h) => labOf(...rgbOf(h)));
  let far = 0, tot = 0; const n = px.w * px.h, step = Math.max(1, Math.floor(n / 40000));
  for (let i = 0; i < n; i += step) { const o = i * 4; if (px.data[o + 3] < 160) continue; tot++; const l = labOf(px.data[o], px.data[o + 1], px.data[o + 2]); let bd = Infinity; for (const c of labs) bd = Math.min(bd, d2(l, c)); if (bd > 12 * 12) far++; }
  return tot ? far / tot : 0;
}

/* ---------- 2–5. plates ---------- */
export type SepInk = { hex: string; name: string };
export type SepResult = { plates: Plate[]; w: number; h: number; underbase: boolean; dropped: string[] };

const Q = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const unQ = (q: number): [number, number, number] => [((q >> 10) & 31) * 8 + 4, ((q >> 5) & 31) * 8 + 4, (q & 31) * 8 + 4];
// finer steps for simulated process (smooth gradients)
const Q6 = (r: number, g: number, b: number) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
const unQ6 = (q: number): [number, number, number] => [((q >> 12) & 63) * 4 + 2, ((q >> 6) & 63) * 4 + 2, (q & 63) * 4 + 2];

/**
 * The ink mix that makes color c (linear light): w ≥ 0 with Σw ≤ 1 for c ≈ g + Σ w_i (ink_i − g), where g is what's
 * underneath. Solved exactly with Lawson–Hanson non-negative least squares on the inks plus g as one more "ink",
 * with a heavy extra row so the shares add up to 1 (the leftover share is g showing).
 */
function unmix(c: number[], g: number[], inks: number[][]): Float32Array {
  const cols = [...inks, g], m = cols.length, LAM = 8;
  const A = [0, 1, 2].map((r) => cols.map((k) => k[r])).concat([cols.map(() => LAM)]), b = [c[0], c[1], c[2], LAM];
  const x = nnls(A, b);
  return Float32Array.from(x.slice(0, m - 1));
}
function nnls(A: number[][], b: number[]): number[] {
  const rows = A.length, n = A[0].length, x = new Array(n).fill(0), P = new Set<number>();
  const col = (j: number) => A.map((r) => r[j]);
  const solve = (idx: number[]) => {
    // least squares on the chosen columns (normal equations, tiny)
    const k = idx.length, M = Array.from({ length: k }, () => new Array(k + 1).fill(0));
    for (let i = 0; i < k; i++) { const ci = col(idx[i]); for (let j = 0; j < k; j++) { const cj = col(idx[j]); let s = 0; for (let r = 0; r < rows; r++) s += ci[r] * cj[r]; M[i][j] = s; } let s = 0; for (let r = 0; r < rows; r++) s += ci[r] * b[r]; M[i][k] = s; }
    for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12; for (let j = i; j <= k; j++) M[i][j] /= d; for (let r = 0; r < k; r++) if (r !== i && M[r][i]) { const f = M[r][i]; for (let j = i; j <= k; j++) M[r][j] -= f * M[i][j]; } }
    return M.map((r) => r[k]);
  };
  for (let outer = 0; outer < 3 * n; outer++) {
    const res = b.map((bv, r) => bv - A[r].reduce((s, a, j) => s + a * x[j], 0));
    let best = -1, bw = 1e-10;
    for (let j = 0; j < n; j++) if (!P.has(j)) { let wj = 0; for (let r = 0; r < rows; r++) wj += A[r][j] * res[r]; if (wj > bw) { bw = wj; best = j; } }
    if (best < 0) break;
    P.add(best);
    for (let inner = 0; inner < 3 * n; inner++) {
      const idx = [...P], z = solve(idx);
      if (z.every((v) => v > 1e-10)) { idx.forEach((j, i) => (x[j] = z[i])); break; }
      let alpha = Infinity; idx.forEach((j, i) => { if (z[i] <= 1e-10) alpha = Math.min(alpha, x[j] / (x[j] - z[i])); });
      idx.forEach((j, i) => { x[j] += alpha * (z[i] - x[j]); if (x[j] <= 1e-10) { x[j] = 0; P.delete(j); } });
    }
  }
  return x;
}

/** push a coverage mask out by r pixels (round brush) */
export function spread(a: Uint8Array, w: number, h: number, r: number, only?: Uint8Array): Uint8Array { return r > 0 ? moveEdge(a, w, h, r, true, only) : a; }
/** pull a coverage mask in by r pixels (round brush) */
export function choke(a: Uint8Array, w: number, h: number, r: number): Uint8Array { return r > 0 ? moveEdge(a, w, h, r, false) : a; }

/** the most (hi) or least (lo) of `a` in the 3×3 around each pixel (outside the image counts as 0) */
function local3(a: Uint8Array, w: number, h: number, hi: boolean): Uint8Array {
  const n = w * h, t = new Uint8Array(n), o = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x, l = x > 0 ? a[i - 1] : 0, r = x < w - 1 ? a[i + 1] : 0, v = a[i];
      t[i] = hi ? (l > v ? (l > r ? l : r) : v > r ? v : r) : (l < v ? (l < r ? l : r) : v < r ? v : r);
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w, up = y > 0, dn = y < h - 1;
    for (let x = 0; x < w; x++) {
      const i = row + x, u = up ? t[i - w] : 0, d = dn ? t[i + w] : 0, v = t[i];
      o[i] = hi ? (u > v ? (u > d ? u : d) : v > d ? v : d) : (u < v ? (u < d ? u : d) : v < d ? v : d);
    }
  }
  return o;
}
/** 1 where a pixel is within `r` px (a square around it) of an edge or a gradient: a pixel that differs from a
 *  neighbor by more than a few levels (a wobble, like two inks adding up to 254 at a seam, isn't an edge) */
function nearEdges(a: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const n = w * h, R = Math.ceil(r) + 1, e = new Uint8Array(n), t = new Uint8Array(n), out = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x, v = a[i];
      if (x < w - 1) { const d = v - a[i + 1]; if (d > 6 || d < -6) { e[i] = 1; e[i + 1] = 1; } }
      if (y < h - 1) { const d = v - a[i + w]; if (d > 6 || d < -6) { e[i] = 1; e[i + w] = 1; } }
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && v > 6) e[i] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w; let last = -1e9;
    for (let x = 0; x < w; x++) { const i = row + x; if (e[i]) last = x; if (x - last <= R) t[i] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { const i = row + x; if (e[i]) last = x; if (last - x <= R) t[i] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { const i = y * w + x; if (t[i]) last = y; if (y - last <= R) out[i] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { const i = y * w + x; if (t[i]) last = y; if (last - y <= R) out[i] = 1; }
  }
  return out;
}
/** distance (×5: 5 across, 7 diagonally, within a few % of true distance) from each pixel to the nearest pixel where
 *  `on` is set; for yes/no questions (is this part thinner than…), not for moving edges */
function chamfer(on: Uint8Array, w: number, h: number): Uint16Array {
  const n = w * h, d = new Uint16Array(n).fill(65535);
  for (let i = 0; i < n; i++) if (on[i]) d[i] = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x; let v = d[i]; if (!v) continue;
      if (x > 0 && d[i - 1] + 5 < v) v = d[i - 1] + 5;
      if (y > 0) { const u = i - w; if (d[u] + 5 < v) v = d[u] + 5; if (x > 0 && d[u - 1] + 7 < v) v = d[u - 1] + 7; if (x < w - 1 && d[u + 1] + 7 < v) v = d[u + 1] + 7; }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x; let v = d[i]; if (!v) continue;
      if (x < w - 1 && d[i + 1] + 5 < v) v = d[i + 1] + 5;
      if (y < h - 1) { const u = i + w; if (d[u] + 5 < v) v = d[u] + 5; if (x < w - 1 && d[u + 1] + 7 < v) v = d[u + 1] + 7; if (x > 0 && d[u - 1] + 7 < v) v = d[u - 1] + 7; }
      d[i] = v;
    }
  }
  return d;
}
/**
 * Move a coverage mask's edges out (grow) or in (shrink) by exactly r pixels, round brush, to a fraction of a pixel.
 * A soft edge pixel's coverage says where the edge crosses it (half covered = the edge runs through its middle), so
 * the moved edge stays as smooth as the art's own (no stair steps, no rounding to whole pixels): a pixel's new
 * coverage is the most (grow) of every nearby inked pixel's coverage pushed by (r − its distance), i.e. the art's
 * edge moved r further (an empty pixel says nothing about where the edge is when growing, a full one nothing when
 * shrinking, so they're left out; within 2% of full / empty counts, so two inks meeting at a seam, which add up to
 * 254 there, don't read as an edge and put pinholes in the base). A flat tint keeps its shade: nothing grows past the most ink around where it came from (nothing
 * shrinks below the least). Only the pixels near an edge are worked out.
 */
export function moveEdge(a: Uint8Array, w: number, h: number, r: number, grow: boolean, only?: Uint8Array): Uint8Array {
  const out = a.slice();
  if (!(r > 0)) return out;
  const cap = local3(a, w, h, grow), hi = cap, lo = cap, band = nearEdges(a, w, h, r + 1.5);
  const R = Math.ceil(r + 1), offs: number[] = [], ds: number[] = [], dxs: number[] = [], dys: number[] = [];
  const list: [number, number, number][] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d = Math.hypot(dx, dy); if (d > 0 && d < r + 1) list.push([dx, dy, d]); }
  list.sort((p, q) => p[2] - q[2]);
  for (const [dx, dy, d] of list) { dxs.push(dx); dys.push(dy); offs.push(dy * w + dx); ds.push(255 * (r - d)); }
  const K = offs.length, R255 = 255 * r, off = Int32Array.from(offs), push = Float32Array.from(ds), DX = Int32Array.from(dxs), DY = Int32Array.from(dys);
  for (let y = 0; y < h; y++) {
    const inY = y >= R && y < h - R;
    for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!band[i] || (only && !only[i])) continue;
      const inside = inY && x >= R && x < w - R;
      if (grow) {
        let m: number = a[i];
        if (m > 5) { m += R255; if (m > hi[i]) m = hi[i]; }
        for (let k = 0; k < K && m < 255; k++) {
          if (!inside) { const X = x + DX[k], Y = y + DY[k]; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; }
          const j = i + off[k], aj = a[j]; if (aj <= 5) continue;
          let v = aj + push[k]; if (v > hi[j]) v = hi[j]; if (v > m) m = v;
        }
        out[i] = m > 255 ? 255 : Math.round(m);
      } else {
        let m: number = a[i];
        if (m < 250) { m -= R255; if (m < lo[i]) m = lo[i]; }
        for (let k = 0; k < K && m > 0; k++) {
          let v: number;
          if (!inside) { const X = x + DX[k], Y = y + DY[k]; if (X < 0 || Y < 0 || X >= w || Y >= h) { v = -push[k]; if (v < 0) v = 0; if (v < m) m = v; continue; } }
          const j = i + off[k], aj = a[j]; if (aj >= 250) continue;
          v = aj - push[k]; if (v < lo[j]) v = lo[j]; if (v < m) m = v;
        }
        out[i] = m < 0 ? 0 : Math.round(m);
      }
    }
  }
  return out;
}

// mesh by screen (spot: base 156, colors 230; halftones 305; simulated process prints its base and highlight white as
// halftones too, so they need a finer mesh than a spot base: 230, T-Biz's 180–230)
const MESH = { underbase: 156, color: 230, sim: 305, highlight: 230, simBase: 230 };

/** does an ink get white underbase under it by default? Not black, and not dark colors (navy, dark green, maroon…):
 *  they print over the dark shirt as they are */
export const baseByDefault = (hex: string) => lightness(hex) >= 30;
/** black never gets underbase, no matter what: black ink over white bubbles (the shop's rule) */
export const neverBase = (hex: string) => { const [L, a, b] = labOf(...rgbOf(hex)); return L < 22 && Math.hypot(a, b) < 12; };

/** a color this close (Lab distance) to an ink is that ink, printed solid (flat areas with a little noise) */
const SNAP = 5;
/** a color this close (sRGB units) to the line between two inks is an edge between them (anti-aliasing) */
const EDGE = 22;
/**
 * Spot color: the shares of each ink (and, last, of the white underbase showing) that print a color from the art.
 *   - an ink's own color is 100% that ink
 *   - a color on the line between two inks (the soft pixels along the edge where they meet, or a color made of
 *     those two) is split between them by where it sits on that line, the way the art was drawn, so each plate
 *     keeps a smooth edge and the two edges meet exactly
 *   - anything else is unmixed into all the inks (halftones), over the shirt (light shirt) or over the underbase
 *     with the shirt free to show (dark shirt); shares near 100% or 0% are rounded so flat areas stay solid
 * Also used for vector art, where a shape's fill becomes tints of the inks.
 */
export function spotMixer(inks: SepInk[], s: SepSettings): (r: number, g: number, b: number, flat?: boolean) => Float32Array {
  const gLab = labOf(...rgbOf(s.garment));
  const dark = s.underbase === "on" || (s.underbase === "auto" && gLab[0] < 55);
  const dropped = s.dropGarment ? inks.map((k) => deltaE(k.hex, s.garment) < 12) : inks.map(() => false);
  const labs = inks.map((k) => labOf(...rgbOf(k.hex))), rgb = inks.map((k) => rgbOf(k.hex));
  const g = rgbOf(s.garment).map((v) => LIN[v]), base = dark ? [1, 1, 1] : g;
  const use = inks.map((_, j) => j).filter((j) => !dropped[j]);
  const K = use.map((j) => rgbOf(inks[j].hex).map((v) => LIN[v]));
  if (dark) K.push(g);
  const m = inks.length;
  // flat: the pixel is inside an area (its neighbors match), so it's a real color to print, mixed as halftones do (in
  // light); otherwise it's a soft edge pixel the art drew between two colors, split along the line between them
  return (r, gg, b, flat = false) => {
    const out = new Float32Array(m + 1), l = labOf(r, gg, b);
    let i1 = 0, d1 = Infinity;
    for (let c = 0; c < m; c++) { const d = d2(l, labs[c]); if (d < d1) { d1 = d; i1 = c; } }
    if (d1 < SNAP * SNAP || !use.length || m === 1 && !dark) {
      if (m === 1 && !dark && d1 >= SNAP * SNAP) {
        // one ink on a light shirt: how much of it (between the shirt and the ink)
        const A = rgbOf(s.garment), B = rgb[0], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2;
        if (L2 && !dropped[0]) out[0] = Math.max(0, Math.min(1, ((r - A[0]) * AB[0] + (gg - A[1]) * AB[1] + (b - A[2]) * AB[2]) / L2));
        return out;
      }
      if (!dropped[i1]) out[i1] = 1; return out;
    }
    // the pair of inks whose line passes closest to this color
    let bi = -1, bj = -1, bt = 0, bd = Infinity;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const A = rgb[i], B = rgb[j], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2; if (!L2) continue;
      const t = Math.max(0, Math.min(1, ((r - A[0]) * AB[0] + (gg - A[1]) * AB[1] + (b - A[2]) * AB[2]) / L2));
      const d = (r - A[0] - t * AB[0]) ** 2 + (gg - A[1] - t * AB[1]) ** 2 + (b - A[2] - t * AB[2]) ** 2;
      if (d < bd) { bd = d; bi = i; bj = j; bt = t; }
    }
    if (bi >= 0 && bd < EDGE * EDGE && !flat) {
      const t = bt < 0.03 ? 0 : bt > 0.97 ? 1 : bt;
      if (!dropped[bi]) out[bi] = 1 - t;
      if (!dropped[bj]) out[bj] = t;
      return out;
    }
    const ws = unmix([LIN[r], LIN[gg], LIN[b]], base, K);
    let sum = 0; use.forEach((j, c) => { let v = ws[c]; if (v > 0.93) v = 1; else if (v < 0.04) v = 0; out[j] = v; sum += v; });
    if (sum > 1) for (const j of use) out[j] /= sum;
    if (dark) out[m] = Math.max(0, 1 - Math.min(1, sum) - ws[use.length]);
    return out;
  };
}

/**
 * Split the art into plates. `inks` are the colors to print (from findColors, maybe edited), each with the ink
 * name that goes to the press. Plates come back in print order: underbase, colors light → dark, highlight white.
 */
export function separate(px: Px, inks: SepInk[], s: SepSettings): SepResult {
  const { w, h, data } = px, n = w * h;
  const gLab = labOf(...rgbOf(s.garment));
  const dark = s.underbase === "on" || (s.underbase === "auto" && gLab[0] < 55);
  // inks that match the shirt aren't printed (the shirt shows through)
  const dropped = s.dropGarment ? inks.filter((k) => deltaE(k.hex, s.garment) < 12).map((k) => k.hex) : [];
  const print = inks.filter((k) => !dropped.includes(k.hex));
  const isWhite = (hex: string) => { const [L, a, b] = labOf(...rgbOf(hex)); return L > 90 && Math.hypot(a, b) < 10; };
  const cover = inks.map(() => new Uint8Array(n));
  // sim on a dark shirt: whatever isn't ink or shirt is the white (underbase + highlight)
  let white: Uint8Array | null = null;
  if (s.method === "spot") {
    // a color that is one of the inks prints solid; a color with no ink of its own (the gold, when only yellow and
    // orange are left) becomes a halftone mix of the inks that make it, like Separo
    const mix = spotMixer(inks, s), m1 = inks.length + 1;
    // each (6-bit) color is worked out once: slot per color in a flat table
    const slot = new Int32Array(1 << 19).fill(-1), table: number[] = [];
    if (dark) white = new Uint8Array(n);
    // a pixel is flat when its 4 neighbors are (nearly) the same color and opaque
    const flatAt = (i: number) => {
      const o = i * 4, x = i % w;
      if (x === 0 || x === w - 1 || i < w || i >= n - w) return false;
      for (const j of [i - 1, i + 1, i - w, i + w]) { const q = j * 4; if (data[q + 3] < 250 || Math.abs(data[q] - data[o]) + Math.abs(data[q + 1] - data[o + 1]) + Math.abs(data[q + 2] - data[o + 2]) > 12) return false; }
      return true;
    };
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = data[o + 3]; if (a < 8) continue;
      const f = flatAt(i) ? 1 : 0, q = (Q6(data[o], data[o + 1], data[o + 2]) << 1) | f;
      let at = slot[q];
      if (at < 0) { at = slot[q] = table.length; const [cr, cg, cb] = unQ6(q >> 1); const ws = mix(cr, cg, cb, !!f); for (let c = 0; c < m1; c++) table.push(ws[c]); }
      for (let c = 0; c < inks.length; c++) { const v = table[at + c]; if (v > 0.02) cover[c][i] = Math.round(v * a); }
      if (white) { const v = table[at + inks.length]; if (v > 0.02) white[i] = Math.round(v * a); }
    }
  } else {
    // simulated process: unmix each color into the inks (in linear light). Light shirt: over the shirt. Dark shirt:
    // over white (the underbase), with the shirt itself as a free "ink" where it should show through.
    const g = rgbOf(s.garment).map((v) => LIN[v]);
    const useInks = print.map((k) => inks.indexOf(k));
    const K = useInks.map((j) => rgbOf(inks[j].hex).map((v) => LIN[v]));
    const base = dark ? [1, 1, 1] : g;
    if (dark) { K.push(g); white = new Uint8Array(n); }
    const cache = new Map<number, Float32Array>();
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = data[o + 3]; if (a < 8) continue;
      const q = Q6(data[o], data[o + 1], data[o + 2]);
      let ws = cache.get(q);
      if (!ws) { const c = unQ6(q).map((v) => LIN[v]); ws = unmix(c, base, K); cache.set(q, ws); }
      let sum = 0;
      for (let c = 0; c < useInks.length; c++) { sum += ws[c]; if (ws[c] > 0.02) cover[useInks[c]][i] = Math.round(ws[c] * a); }
      if (white) { const rest = 1 - sum - ws[useInks.length]; if (rest > 0.02) white[i] = Math.round(rest * a); }
    }
  }
  const plates: Plate[] = [];
  // tonal: a good part of what it prints is in-between (not just soft edges): it needs halftones
  // (in-between values inside an area, not the soft rim along every edge; judged before trapping, whose rim would count)
  const tonalOf = (alpha: Uint8Array) => {
    if (s.method === "sim") return true;
    const midv = (v: number) => v > 30 && v < 225;
    let on = 0, mid = 0;
    for (let i = 0; i < n; i++) {
      const v = alpha[i]; if (v <= 8) continue; on++;
      if (!midv(v)) continue;
      const x = i % w;
      if (x > 0 && x < w - 1 && i >= w && i < n - w && midv(alpha[i - 1]) && midv(alpha[i + 1]) && midv(alpha[i - w]) && midv(alpha[i + w])) mid++;
    }
    return on > 0 && mid / on > 0.08;
  };
  const mk = (key: string, name: string, hex: string, kind: PlateKind, alpha: Uint8Array, tonalIs?: boolean): Plate => {
    let sum = 0; for (let i = 0; i < n; i++) sum += alpha[i];
    const tonal = tonalIs ?? tonalOf(alpha);
    return { key, name, hex, kind, alpha, coverage: sum / (255 * n), tonal, mesh: kind === "underbase" ? (s.method === "sim" ? MESH.simBase : MESH.underbase) : kind === "highlight" ? MESH.highlight : s.method === "sim" || tonal ? MESH.sim : MESH.color };
  };
  const colorPlates = print.map((k) => ({ k, a: cover[inks.indexOf(k)] }));
  const add = (t: Uint8Array, a: Uint8Array) => { for (let i = 0; i < n; i++) { const v = t[i] + a[i]; t[i] = v > 255 ? 255 : v; } };
  const based = (hex: string) => !neverBase(hex) && (s.baseFor?.["c" + hex.slice(1)] ?? baseByDefault(hex));
  const body = colorPlates.filter(({ k }) => !(dark && s.highlight && isWhite(k.hex)));
  // highlight white: the art's white (and, in simulated process, the white left over after the inks)
  // (spot color: only when white is one of the chosen inks, as Separo counts it; the white left over in mixes is
  // already in the underbase. Simulated process: the leftover white is the highlight.)
  let hw: Uint8Array | null = null;
  if (dark && s.highlight && (s.method !== "spot" || print.some((k) => isWhite(k.hex)))) {
    hw = new Uint8Array(n);
    for (const { k, a } of colorPlates) if (isWhite(k.hex)) for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + a[i]);
    if (white && s.method !== "spot") for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + white[i]);
  }
  // print order after the base: colors light → dark (black, the darkest, last of them), then the highlight white on
  // top: the usual order for spot color and simulated process on dark shirts (T-Biz: "light to dark… black next to
  // last… highlight white last")
  body.sort((x, y) => lightness(y.k.hex) - lightness(x.k.hex));
  type Step = { key: string; name: string; hex: string; kind: PlateKind; a: Uint8Array; base: boolean };
  const seq: Step[] = [
    ...body.map(({ k, a }) => ({ key: "c" + k.hex.slice(1), name: k.name, hex: k.hex, kind: "color" as PlateKind, a, base: dark && based(k.hex) })),
    ...(hw ? [{ key: "hw", name: "Highlight White", hex: "#FFFFFF", kind: "highlight" as PlateKind, a: hw, base: true }] : []),
  ];
  const tonals = seq.map((x) => tonalOf(x.a));

  // underbase (dark shirts): under every ink that gets base (by default not black or dark colors like navy; each can
  // be switched) and under the white.
  let ub: Uint8Array | null = null;
  const bumps = new Map<string, Uint8Array>();
  if (dark) {
    ub = new Uint8Array(n); const inked = new Uint8Array(n);
    for (const { k, a } of colorPlates) { if (based(k.hex)) add(ub, a); add(inked, a); }
    if (white) { add(ub, white); add(inked, white); }
    // choked only where it meets the bare shirt (so white can't peek out past the art); where two colors touch, or a
    // color meets black, it runs straight through (no gap in the white between yellow and orange)
    const c = Math.max(0, s.choke);
    if (c > 0) {
      const room = choke(inked, w, h, c);
      const fine = Math.max(0, s.fine || 0), fc = Math.min(c, Math.max(0, s.fineChoke ?? 0));
      let detail: Uint8Array | null = null;
      if (fine > 0) {
        // fine detail: where the fully choked base would be narrower than what's left of `fine` after the choke (or
        // gone): small type, hairlines. Found as the parts of the art that the choked base's wide parts don't reach:
        // open the choked base (shrink by q, grow back) and grow it out to the art's edge again; the grow-back is a
        // little generous (0.42 q, a pixel) so the corners of wide shapes, which an opening rounds off, don't count
        // (distance transforms: this is a yes/no question, so a few % of a pixel doesn't matter and big radii are free)
        const q = Math.max(0.5, (fine - 2 * c) / 2), out = new Uint8Array(n);
        for (let i = 0; i < n; i++) if ((ub[i] < room[i] ? ub[i] : room[i]) < 128) out[i] = 1;
        const dIn = chamfer(out, w, h), core = new Uint8Array(n), Q = 5 * q;
        for (let i = 0; i < n; i++) if (dIn[i] > Q) core[i] = 1;
        const dCore = chamfer(core, w, h), REACH = 5 * (1.42 * q + c + 1);
        detail = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (ub[i] >= 24 && dCore[i] > REACH) detail[i] = 1;
      }
      const roomFine = detail ? (fc > 0 ? choke(inked, w, h, fc) : inked) : null;
      for (let i = 0; i < n; i++) { const m = detail && detail[i] ? roomFine![i] : room[i]; if (ub[i] > m) ub[i] = m; }
      // …and there the color on top is made fatter out onto the bare shirt instead (a stroke on the top color), so it
      // still covers the edge of the white
      const b = Math.max(0, s.bump ?? 0);
      if (detail && b > 0) {
        const dD = chamfer(detail, w, h), NB = 5 * (b + 1.5), near = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (dD[i] <= NB) near[i] = 1;
        for (const st of seq) {
          if (!st.base) continue;
          const g = spread(st.a, w, h, b, near), add2 = new Uint8Array(n); let any = false;
          for (let i = 0; i < n; i++) {
            if (!near[i] || g[i] <= st.a[i]) continue;
            // onto bare shirt only (not over another ink)
            const free = 255 - (inked[i] - Math.min(inked[i], st.a[i]));
            const v = Math.min(g[i], free);
            if (v > st.a[i]) { add2[i] = v - st.a[i]; st.a[i] = v; any = true; }
          }
          if (any) bumps.set(st.key, add2);
        }
      }
    }
  }
  // trap: each color spreads a little under the colors printed after it (never out onto the bare shirt), so
  // neighbors overlap a hair instead of just touching. An ink with no base under it (black, navy…) never spreads
  // onto the white base (black on white bubbles): under the highlight white it stays where it is.
  const trap = Math.max(0, s.trap ?? 0);
  if (s.method === "spot" && trap > 0 && seq.length > 1) {
    const later = new Uint8Array(n);
    for (let j = seq.length - 1; j >= 0; j--) {
      const a = seq[j].a, orig = a.slice();
      if (j < seq.length - 1) {
        const g = spread(orig, w, h, trap, later), bare = dark && !seq[j].base && ub;
        for (let i = 0; i < n; i++) {
          if (!later[i] || g[i] <= a[i] || (bare && bare[i])) continue;
          a[i] = Math.min(g[i], Math.max(a[i], later[i]));
        }
      }
      for (let i = 0; i < n; i++) { const v = later[i] + orig[i]; later[i] = v > 255 ? 255 : v; }
    }
  }
  if (ub) plates.push(mk("ub", "Underbase White", "#FFFFFF", "underbase", ub));
  seq.forEach((st, j) => { const p = mk(st.key, st.name, st.hex, st.kind, st.a, tonals[j]); const b = bumps.get(st.key); if (b) p.bump = b; plates.push(p); });
  // drop only plates that print (almost) nothing: a small detail ink (fine text in its own color) must never vanish
  const prints = (p: Plate) => { if (p.coverage > 0.0005) return true; let c = 0; for (let i = 0; i < n; i++) if (p.alpha[i] >= 128 && ++c > 16) return true; return false; };
  return { plates: plates.filter(prints), w, h, underbase: dark, dropped };
}

/**
 * The print as it'll look (RGBA for a canvas), in linear light: each ink covers its share of the spot (halftone dots
 * sit side by side, on top of the underbase), the underbase that no ink covers shows white, the rest is the shirt.
 */
export function composite(res: { plates: Plate[]; w: number; h: number }, garment: string, show?: Set<string>): Uint8ClampedArray {
  const { w, h } = res, n = w * h, out = new Uint8ClampedArray(n * 4);
  const g = rgbOf(garment).map((v) => LIN[v]);
  const on = res.plates.filter((p) => !show || show.has(p.key));
  const ub = on.find((p) => p.kind === "underbase"), inks = on.filter((p) => p.kind !== "underbase").map((p) => ({ a: p.alpha, c: rgbOf(p.hex).map((v) => LIN[v]) }));
  const back = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  for (let i = 0; i < n; i++) {
    // the spot is split into areas: ink dots (printed on the underbase where there is one), bare underbase, bare shirt
    const u = ub ? ub.alpha[i] / 255 : 0;
    // where inks overlap (a trap, or dots that land on each other) the one printed later covers the one under it:
    // hand out the spot from the top ink down
    let r = 0, gg = 0, b = 0, tot = 0;
    for (let j = inks.length - 1; j >= 0 && tot < 1; j--) {
      const k = inks[j]; let f = k.a[i] / 255; if (!f) continue;
      if (f > 1 - tot) f = 1 - tot;
      tot += f; r += f * k.c[0]; gg += f * k.c[1]; b += f * k.c[2];
    }
    const white = Math.max(0, u - tot), shirt = 1 - Math.max(u, tot);
    r += white + shirt * g[0]; gg += white + shirt * g[1]; b += white + shirt * g[2];
    const o = i * 4; out[o] = back(Math.max(0, Math.min(1, r))); out[o + 1] = back(Math.max(0, Math.min(1, gg))); out[o + 2] = back(Math.max(0, Math.min(1, b))); out[o + 3] = 255;
  }
  return out;
}

/* ---------- films ---------- */
export type Dot = "ellipse" | "round" | "square";
export type FilmOpts = { halftone: boolean; lpi?: number; angle?: number; gain?: number; dot?: Dot; mesh?: number;
  /** whole dots (default): each dot sized by its cell's average tone, so none breaks into specks the screen can't
   *  hold; false: every film pixel against its own tone (more detail, ragged dots) */
  clean?: boolean;
  /** where the art prints at all (any ink; plate size): whole dots are cut off only at the art's own edge, not where
   *  this ink's area meets another ink's (there the dots sit side by side, as halftones do) */
  within?: Uint8Array };
/** average of each pixel's (2r+1)² square, as 0–255 floats (two running sums) */
function boxBlur(a: Uint8Array, w: number, h: number, r: number): Float32Array {
  const n = w * h, t = new Float32Array(n), o = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w; let s = 0, c = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { s += a[row + x]; c++; }
    for (let x = 0; x < w; x++) {
      t[row + x] = s / c;
      const add = x + r + 1, drop = x - r;
      if (add < w) { s += a[row + add]; c++; }
      if (drop >= 0) { s -= a[row + drop]; c--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { s += t[y * w + x]; c++; }
    for (let y = 0; y < h; y++) {
      o[y * w + x] = s / c;
      const add = y + r + 1, drop = y - r;
      if (add < h) { s += t[add * w + x]; c++; }
      if (drop >= 0) { s -= t[drop * w + x]; c--; }
    }
  }
  return o;
}
/**
 * The smallest halftone dot a screen holds, as a share of the cell: a dot has to be about 1.25 mesh threads across
 * (an opening and a thread) or it has nothing to stand on and washes out. At 55 lpi: 305 mesh 4%, 230 mesh 7%,
 * 156 mesh 15%. The same size of hole is the least a nearly-solid tone can keep open (so 96%, 93%, 85%).
 * (Mesh count should be about 4× the LPI or more: 55 lpi wants 220+.)
 */
export const minDot = (mesh: number, lpi: number) => Math.min(0.2, Math.max(0.03, (Math.PI / 4) * ((1.25 * lpi) / mesh) ** 2));
/** spot functions (PostScript's, x and y −1…1 across the cell): higher = inks first */
const SPOT: Record<Dot, (x: number, y: number) => number> = {
  // round dots that grow until they touch at 78%, then the corners fill
  round: (x, y) => 1 - (x * x + y * y),
  // Euclidean: round in the highlights, a checkerboard at 50%, round holes in the shadows
  square: (x, y) => { const a = Math.abs(x), b = Math.abs(y); return a + b > 1 ? (a - 1) ** 2 + (b - 1) ** 2 - 1 : 1 - (a * a + b * b); },
  // elliptical (Adobe's "Ellipse"): neighbors join along one axis near 40% and the other near 60%, so there's no
  // single jump in tone where all four corners join at once (screen printers' pick for smooth midtones)
  ellipse: (x, y) => {
    const a = Math.abs(y), b = Math.abs(x), w = 3 * b + 4 * a - 3;
    if (w < 0) return 1 - (b * b + (a / 0.75) ** 2) / 4;
    if (w > 1) return ((1 - b) ** 2 + ((1 - a) / 0.75) ** 2) / 4 - 1;
    return 0.5 - w;
  },
};
/** the halftone cell as thresholds: the spot at (u, v) inks once the tone passes T (the spot function's rank), so a
 *  tone covers exactly its share of the cell whatever the dot's shape */
const TN = 96, tCache = new Map<Dot, Float32Array>();
function thresholds(dot: Dot): Float32Array {
  const hit = tCache.get(dot); if (hit) return hit;
  const f = SPOT[dot], n = TN * TN, v = new Float64Array(n), idx = new Uint32Array(n);
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) { const x = ((i + 0.5) / TN) * 2 - 1, y = ((j + 0.5) / TN) * 2 - 1; v[j * TN + i] = f(x, y) + 1e-9 * (x * 0.37 + y * 0.61); idx[j * TN + i] = j * TN + i; }
  idx.sort((p, q) => v[q] - v[p]);
  const T = new Float32Array(n); for (let r = 0; r < n; r++) T[idx[r]] = (r + 0.5) / n;
  tCache.set(dot, T); return T;
}
/**
 * A plate as film at `dpi` for a print `widthIn` wide: 1 = black (ink).
 *   - Solid plates: each soft edge pixel's own edge line (lib/edgeField) is followed at film resolution, so edges are
 *     as smooth as the art drew them, with no stair steps from its pixel grid; hard-edged art stays as drawn.
 *   - Halftone plates: dots at `lpi`, angled `angle`°, in the chosen shape, sized by the ink (the tone sampled
 *     smoothly between pixels). Tones too light for the mesh to hold a dot drop out (the lightest half) or print
 *     as the smallest dot that holds; nearly solid tones the same way at the top. Dot gain is taken off first.
 */
export function filmBits(p: Plate, w: number, h: number, widthIn: number, dpi: number, o: FilmOpts): { W: number; H: number; bits: Uint8Array } {
  const halftone = o.halftone, lpi = o.lpi || 55, angle = o.angle ?? 22.5, gain = o.gain || 0;
  const W = Math.max(1, Math.round(widthIn * dpi)), H = Math.max(1, Math.round(W * (h / w))), rowBytes = Math.ceil(W / 8);
  const bits = new Uint8Array(rowBytes * H), sx = w / W, sy = h / H;
  const cell = dpi / lpi, rad = (angle * Math.PI) / 180, cs = Math.cos(rad) / cell, sn = Math.sin(rad) / cell;
  const T = thresholds(o.dot || "ellipse"), md = o.mesh ? minDot(o.mesh, lpi) : 0.04;
  const A = p.alpha, G4 = 4 * gain;
  // tone → dot: gain off, then only dots the screen can hold
  const LUT = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    let v = k / 255;
    if (v > 0 && v < 1 && gain > 0) v = ((1 + G4) - Math.sqrt((1 + G4) ** 2 - 4 * G4 * v)) / (2 * G4);
    if (v < md / 2) v = 0; else if (v < md) v = md; else if (v > 1 - md / 2) v = 1; else if (v > 1 - md) v = 1 - md;
    LUT[k] = v;
  }
  // where each film column / row falls between the plate's pixels
  const X0 = new Int32Array(W), TX = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5)); X0[x] = Math.min(w - 2, Math.floor(f)); TX[x] = f - X0[x]; if (w === 1) { X0[x] = 0; TX[x] = 0; } }
  const field = edgeRows(A, w, h);
  // a halftone plate can have solid parts too (a spot color that's solid in one place and mixed in another): where a
  // solid area meets nothing, its edge is cut sharp like a solid plate's instead of breaking into half dots
  const hiM = halftone ? local3(A, w, h, true) : null, loM = halftone ? local3(A, w, h, false) : null;
  // whole dots: the tone of each cell (the plate averaged over about a cell), read at the cell's center
  const clean = halftone && o.clean !== false, cellPx = (w / widthIn) / lpi;
  const B = clean ? boxBlur(A, w, h, Math.max(0, Math.round(cellPx / 2 - 0.5))) : null;
  const icell = 1 / (cs * cs + sn * sn); // (cs, sn) are cos/cell, sin/cell: back from cell units to film pixels
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5)), y0 = h === 1 ? 0 : Math.min(h - 2, Math.floor(fy)), ty = fy - y0, y1 = Math.min(h - 1, y0 + 1);
    const r0 = y0 * w, r1 = y1 * w, orow = y * rowBytes;
    for (let x = 0; x < W; x++) {
      const x0 = X0[x], x1 = Math.min(w - 1, x0 + 1), tx = TX[x];
      const a00 = A[r0 + x0], a01 = A[r0 + x1], a10 = A[r1 + x0], a11 = A[r1 + x1];
      let on: boolean;
      const near = r0 + (tx < 0.5 ? x0 : x1) + (ty < 0.5 ? 0 : r1 - r0);
      if (!halftone || (hiM![near] >= 245 && loM![near] <= 10)) {
        if ((a00 === 0 || a00 === 255) && a00 === a01 && a00 === a10 && a00 === a11) on = a00 === 255;
        else {
          // the signed distance to the edge here, from the edge lines of the 4 pixels around
          const R0 = field(y0), R1 = field(y1), ux = tx - 1, uy = ty - 1;
          const sd = (1 - tx) * (1 - ty) * (R0.sd[x0] + R0.nx[x0] * tx + R0.ny[x0] * ty) + tx * (1 - ty) * (R0.sd[x1] + R0.nx[x1] * ux + R0.ny[x1] * ty)
            + (1 - tx) * ty * (R1.sd[x0] + R1.nx[x0] * tx + R1.ny[x0] * uy) + tx * ty * (R1.sd[x1] + R1.nx[x1] * ux + R1.ny[x1] * uy);
          on = sd < 0;
        }
      } else {
        const top = a00 + (a01 - a00) * tx, bot = a10 + (a11 - a10) * tx, k = top + (bot - top) * ty;
        // where this film pixel sits in its (rotated) halftone cell
        const u = x * cs + y * sn, t = -x * sn + y * cs, iu = Math.floor(u), it = Math.floor(t), fu = u - iu, ft = t - it;
        let tone = k;
        if (B) {
          const nearest = o.within ? o.within[near] : k;
          if (nearest < 3) tone = 0; // outside the art: no dot spills past its edge
          else {
            // the cell's center, back in film pixels, then in plate pixels
            const cu = iu + 0.5, ct = it + 0.5, xc = (cu * cs - ct * sn) * icell, yc = (cu * sn + ct * cs) * icell;
            const px = Math.max(0, Math.min(w - 1, (xc + 0.5) * sx - 0.5)), py = Math.max(0, Math.min(h - 1, (yc + 0.5) * sy - 0.5));
            const bx = Math.min(w - 2, Math.floor(px)), by = Math.min(h - 2, Math.floor(py)), bx1 = Math.min(w - 1, bx + 1), by1 = Math.min(h - 1, by + 1), ux = px - bx, uy = py - by;
            const b0 = B[by * w + bx] + (B[by * w + bx1] - B[by * w + bx]) * ux, b1 = B[by1 * w + bx] + (B[by1 * w + bx1] - B[by1 * w + bx]) * ux;
            tone = b0 + (b1 - b0) * uy;
          }
        }
        const v = LUT[tone < 0 ? 0 : tone > 255 ? 255 : Math.round(tone)];
        if (v <= 0) on = false;
        else if (v >= 1) on = true;
        else on = v > T[((ft * TN) | 0) * TN + ((fu * TN) | 0)];
      }
      if (on) bits[orow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { W, H, bits };
}

/**
 * A plate at a bigger size W × H, for art under 400 ppi: solid plates follow each soft pixel's own edge line
 * (lib/edgeField), so the edge comes out smooth and anti-aliased at the new size instead of in the art's pixel steps
 * (nothing is redrawn: hard-edged art stays as drawn); halftone plates are blended smoothly (bilinear).
 */
export function resamplePlate(p: Plate, w: number, h: number, W: number, H: number): Uint8Array {
  const A = p.alpha, out = new Uint8Array(W * H), sx = w / W, sy = h / H, k = W / w;
  const field = p.tonal ? null : edgeRows(A, w, h);
  const X0 = new Int32Array(W), TX = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5)); X0[x] = w < 2 ? 0 : Math.min(w - 2, Math.floor(f)); TX[x] = f - X0[x]; }
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5)), y0 = h < 2 ? 0 : Math.min(h - 2, Math.floor(fy)), ty = fy - y0, y1 = Math.min(h - 1, y0 + 1);
    const r0 = y0 * w, r1 = y1 * w;
    for (let x = 0; x < W; x++) {
      const x0 = X0[x], x1 = Math.min(w - 1, x0 + 1), tx = TX[x];
      const a00 = A[r0 + x0], a01 = A[r0 + x1], a10 = A[r1 + x0], a11 = A[r1 + x1];
      if (a00 === a01 && a00 === a10 && a00 === a11 && (a00 === 0 || a00 === 255 || !field)) { out[y * W + x] = a00; continue; }
      if (!field) { const top = a00 + (a01 - a00) * tx, bot = a10 + (a11 - a10) * tx; out[y * W + x] = Math.round(top + (bot - top) * ty); continue; }
      const R0 = field(y0), R1 = field(y1), ux = tx - 1, uy = ty - 1;
      const sd = (1 - tx) * (1 - ty) * (R0.sd[x0] + R0.nx[x0] * tx + R0.ny[x0] * ty) + tx * (1 - ty) * (R0.sd[x1] + R0.nx[x1] * ux + R0.ny[x1] * ty)
        + (1 - tx) * ty * (R1.sd[x0] + R1.nx[x0] * tx + R1.ny[x0] * uy) + tx * ty * (R1.sd[x1] + R1.nx[x1] * ux + R1.ny[x1] * uy);
      // distance in new pixels → coverage of the new pixel (a one-pixel soft edge)
      const c = 0.5 - sd * k;
      out[y * W + x] = c <= 0 ? 0 : c >= 1 ? 255 : Math.round(c * 255);
    }
  }
  return out;
}
