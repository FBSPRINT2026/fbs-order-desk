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

export type Px = { w: number; h: number; data: Uint8ClampedArray | Uint8Array };
export type PlateKind = "underbase" | "color" | "highlight";
export type Plate = { key: string; name: string; hex: string; kind: PlateKind; alpha: Uint8Array; coverage: number; mesh: number };
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
export function findColors(px: Px, max = 8, merge = 9, minShare = 0.004): Found[] {
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
  let res = out.filter((c) => c.n / total >= minShare).map((c) => ({ hex: c.hex, share: c.n / total }));
  // a small color that sits on the line between two bigger ones is their blend (an edge), not an ink
  const L = (h: string) => labOf(...rgbOf(h));
  res = res.filter((c, i) => {
    if (c.share > 0.08) return true;
    const p = L(c.hex);
    for (let a = 0; a < res.length; a++) for (let b = a + 1; b < res.length; b++) {
      if (a === i || b === i || res[a].share < c.share || res[b].share < c.share) continue;
      const A = L(res[a].hex), B = L(res[b].hex), AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], AP = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
      const len = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2; if (!len) continue;
      const tt = (AP[0] * AB[0] + AP[1] * AB[1] + AP[2] * AB[2]) / len; if (tt < 0.1 || tt > 0.9) continue;
      const d = Math.sqrt((AP[0] - tt * AB[0]) ** 2 + (AP[1] - tt * AB[1]) ** 2 + (AP[2] - tt * AB[2]) ** 2);
      if (d < 7) return false;
    }
    return true;
  });
  // still too many: join the closest pair until it fits
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

/** pull a coverage mask in by r pixels (min filter, done across then down) */
export function choke(a: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return a;
  const tmp = new Uint8Array(a.length), out = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = -r; k <= r; k++) { const xx = x + k; const v = xx < 0 || xx >= w ? 0 : a[y * w + xx]; if (v < m) m = v; } tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = -r; k <= r; k++) { const yy = y + k; const v = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]; if (v < m) m = v; } out[y * w + x] = m; }
  return out;
}

const MESH = { underbase: 156, color: 230, sim: 305, highlight: 230 };

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
    // nearest ink per color, looked up once per (5-bit) color
    const labs = inks.map((k) => labOf(...rgbOf(k.hex)));
    const lut = new Int16Array(32768).fill(-1);
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = data[o + 3]; if (a < 8) continue;
      const q = Q(data[o], data[o + 1], data[o + 2]);
      let b = lut[q];
      if (b < 0) { const l = labOf(...unQ(q)); let bd = Infinity; b = 0; for (let c = 0; c < labs.length; c++) { const d = d2(l, labs[c]); if (d < bd) { bd = d; b = c; } } lut[q] = b; }
      cover[b][i] = a;
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
  const mk = (key: string, name: string, hex: string, kind: PlateKind, alpha: Uint8Array): Plate => {
    let sum = 0; for (let i = 0; i < n; i++) sum += alpha[i];
    return { key, name, hex, kind, alpha, coverage: sum / (255 * n), mesh: kind === "underbase" ? MESH.underbase : kind === "highlight" ? MESH.highlight : s.method === "sim" ? MESH.sim : MESH.color };
  };
  const colorPlates = print.map((k) => ({ k, a: cover[inks.indexOf(k)] }));
  if (dark) {
    // underbase: under every ink that isn't near-black (black ink doesn't need white under it) and under the white, choked
    const ub = new Uint8Array(n);
    const add = (a: Uint8Array) => { for (let i = 0; i < n; i++) { const v = ub[i] + a[i]; ub[i] = v > 255 ? 255 : v; } };
    for (const { k, a } of colorPlates) if (lightness(k.hex) >= 22) add(a);
    if (white) add(white);
    plates.push(mk("ub", "Underbase White", "#FFFFFF", "underbase", choke(ub, w, h, Math.max(0, Math.round(s.choke)))));
  }
  const body = colorPlates.filter(({ k }) => !(dark && s.highlight && isWhite(k.hex)));
  body.sort((x, y) => lightness(y.k.hex) - lightness(x.k.hex));
  for (const { k, a } of body) plates.push(mk("c" + k.hex.slice(1), k.name, k.hex, "color", a));
  // highlight white: the art's white (and, in simulated process, the white left over after the inks)
  if (dark && (s.highlight || white)) {
    const hw = new Uint8Array(n);
    for (const { k, a } of colorPlates) if (isWhite(k.hex)) for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + a[i]);
    if (white) for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + white[i]);
    if (s.highlight) plates.push(mk("hw", "Highlight White", "#FFFFFF", "highlight", hw));
  }
  return { plates: plates.filter((p) => p.coverage > 0.0005), w, h, underbase: dark, dropped };
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
    let r = 0, gg = 0, b = 0, tot = 0;
    for (const k of inks) { const f = k.a[i] / 255; if (!f) continue; tot += f; r += f * k.c[0]; gg += f * k.c[1]; b += f * k.c[2]; }
    if (tot > 1) { r /= tot; gg /= tot; b /= tot; tot = 1; }
    const white = Math.max(0, u - tot), shirt = 1 - Math.max(u, tot);
    r += white + shirt * g[0]; gg += white + shirt * g[1]; b += white + shirt * g[2];
    const o = i * 4; out[o] = back(Math.max(0, Math.min(1, r))); out[o + 1] = back(Math.max(0, Math.min(1, gg))); out[o + 2] = back(Math.max(0, Math.min(1, b))); out[o + 3] = 255;
  }
  return out;
}

/* ---------- films ---------- */
/**
 * A plate as film at `dpi` for a print `widthIn` wide: 1 = black (ink). Spot plates are solid (edges at 50%);
 * simulated-process plates are halftoned: round dots at `lpi`, angled `angle`°, sized by the ink coverage.
 */
export function filmBits(p: Plate, w: number, h: number, widthIn: number, dpi: number, halftone: boolean, lpi = 55, angle = 22.5): { W: number; H: number; bits: Uint8Array } {
  const W = Math.max(1, Math.round(widthIn * dpi)), H = Math.max(1, Math.round(W * (h / w))), rowBytes = Math.ceil(W / 8);
  const bits = new Uint8Array(rowBytes * H), sx = w / W, sy = h / H;
  const cell = dpi / lpi, rad = (angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  for (let y = 0; y < H; y++) {
    const srcY = Math.min(h - 1, Math.floor(y * sy)) * w;
    for (let x = 0; x < W; x++) {
      const v = p.alpha[srcY + Math.min(w - 1, Math.floor(x * sx))] / 255;
      let on: boolean;
      if (!halftone) on = v >= 0.5;
      else if (v <= 0.02) on = false;
      else if (v >= 0.98) on = true;
      else {
        // position inside the rotated halftone cell, -0.5..0.5; round dot that fills area v
        const u = (x * cs + y * sn) / cell, t = (-x * sn + y * cs) / cell;
        const fu = u - Math.floor(u) - 0.5, ft = t - Math.floor(t) - 0.5;
        const r2 = fu * fu + ft * ft;
        // up to 50%: a black dot of area v in the cell; past 50%: white holes of area 1 − v at the cell corners
        if (v <= 0.5) on = r2 <= v / Math.PI;
        else { const cr2 = (0.5 - Math.abs(fu)) ** 2 + (0.5 - Math.abs(ft)) ** 2; on = cr2 > (1 - v) / Math.PI; }
      }
      if (on) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { W, H, bits };
}
