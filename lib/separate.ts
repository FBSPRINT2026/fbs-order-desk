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
export type Plate = { key: string; name: string; hex: string; kind: PlateKind; alpha: Uint8Array; coverage: number; mesh: number; /** needs halftones (a mixed color, or simulated process) */ tonal?: boolean };
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
  /** spot color: how far (px of the working image) each color spreads under the darker colors printed after it, so
   *  neighbors overlap instead of just touching (no gaps, and room for registration). Default 1. */
  trap?: number;
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

/**
 * Grow (max) or shrink (min) a coverage mask by r pixels with a round (octagon) brush, the same distance in every
 * direction, so a round dot stays round and a diagonal edge moves as far as a straight one. The octagon is a square
 * of half-width 0.414·r followed by a diamond of radius 0.586·r (their sum reaches r along the axes and diagonals).
 */
function morph(src: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  if (r <= 0) return src;
  const sq = Math.round(r * 0.414), dm = Math.max(0, Math.round(r) - sq), n = w * h;
  let a = src;
  // (the loops are written out for grow and shrink: this runs over millions of pixels at full size)
  if (sq > 0) {
    // square: across, then down (outside the image counts as empty)
    const tmp = new Uint8Array(n), out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = x - sq, x1 = x + sq;
        let m = grow ? 0 : (x0 < 0 || x1 >= w ? 0 : 255);
        const lo = x0 < 0 ? 0 : x0, hi = x1 >= w ? w - 1 : x1;
        if (grow) { for (let k = lo; k <= hi; k++) { const v = a[row + k]; if (v > m) m = v; } }
        else if (m) { for (let k = lo; k <= hi; k++) { const v = a[row + k]; if (v < m) m = v; } }
        tmp[row + x] = m;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = y - sq, y1 = y + sq, lo = y0 < 0 ? 0 : y0, hi = y1 >= h ? h - 1 : y1, edge = y0 < 0 || y1 >= h;
      for (let x = 0; x < w; x++) {
        let m = grow ? 0 : (edge ? 0 : 255);
        if (grow) { for (let k = lo; k <= hi; k++) { const v = tmp[k * w + x]; if (v > m) m = v; } }
        else if (m) { for (let k = lo; k <= hi; k++) { const v = tmp[k * w + x]; if (v < m) m = v; } }
        out[y * w + x] = m;
      }
    }
    a = out;
  }
  // diamond: dm passes of the 3×3 plus
  for (let it = 0; it < dm; it++) {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w, top = y > 0, bot = y < h - 1;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let m = a[i];
        const l = x > 0 ? a[i - 1] : 0, rr = x < w - 1 ? a[i + 1] : 0, u = top ? a[i - w] : 0, d = bot ? a[i + w] : 0;
        if (grow) { if (l > m) m = l; if (rr > m) m = rr; if (u > m) m = u; if (d > m) m = d; }
        else { if (l < m) m = l; if (rr < m) m = rr; if (u < m) m = u; if (d < m) m = d; }
        out[i] = m;
      }
    }
    a = out;
  }
  return a;
}
/** the pixel offsets inside a disc of radius r (a round brush), nearest first, as typed arrays */
function disc(r: number, w: number): { dx: Int32Array; dy: Int32Array; off: Int32Array; R: number } {
  const list: [number, number, number][] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d = dx * dx + dy * dy; if (d && d <= r * r + 0.25) list.push([dx, dy, d]); }
  list.sort((a, b) => a[2] - b[2]);
  return { dx: Int32Array.from(list, (v) => v[0]), dy: Int32Array.from(list, (v) => v[1]), off: Int32Array.from(list, (v) => v[1] * w + v[0]), R };
}
/** the most (grow) or least (shrink) of `a` within the disc around pixel i; outside the image counts as 0 */
function discPick(a: Uint8Array, i: number, w: number, h: number, D: ReturnType<typeof disc>, grow: boolean, start: number): number {
  const x = i % w, y = (i - x) / w, K = D.off.length, inside = x >= D.R && y >= D.R && x < w - D.R && y < h - D.R;
  let m = start;
  if (grow) {
    if (inside) { for (let k = 0; k < K; k++) { const v = a[i + D.off[k]]; if (v > m) { m = v; if (m === 255) break; } } }
    else for (let k = 0; k < K; k++) { const X = x + D.dx[k], Y = y + D.dy[k]; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const v = a[i + D.off[k]]; if (v > m) { m = v; if (m === 255) break; } }
  } else {
    if (inside) { for (let k = 0; k < K; k++) { const v = a[i + D.off[k]]; if (v < m) { m = v; if (!m) break; } } }
    else for (let k = 0; k < K; k++) { const X = x + D.dx[k], Y = y + D.dy[k]; const v = X < 0 || Y < 0 || X >= w || Y >= h ? 0 : a[i + D.off[k]]; if (v < m) { m = v; if (!m) break; } }
  }
  return m;
}
/** push a coverage mask out by r pixels (round brush) */
export function spread(a: Uint8Array, w: number, h: number, r: number): Uint8Array { return morph(a, w, h, r, true); }
/** pull a coverage mask in by r pixels (round brush) */
export function choke(a: Uint8Array, w: number, h: number, r: number): Uint8Array { return morph(a, w, h, r, false); }

const MESH = { underbase: 156, color: 230, sim: 305, highlight: 230 };

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
    return { key, name, hex, kind, alpha, coverage: sum / (255 * n), tonal, mesh: kind === "underbase" ? MESH.underbase : kind === "highlight" ? MESH.highlight : s.method === "sim" || tonal ? MESH.sim : MESH.color };
  };
  const colorPlates = print.map((k) => ({ k, a: cover[inks.indexOf(k)] }));
  if (dark) {
    // underbase: under every ink that gets base (by default not black or dark colors like navy; each can be switched)
    // and under the white.
    // Choked only where it meets the bare shirt (so white can't peek out past the art); where it meets black ink it
    // stays full, since black prints over it (pulling it back there would leave the colors next to every black line
    // without white under them, printing dull on a dark shirt; Separo doesn't pull back there either)
    const ub = new Uint8Array(n), inked = new Uint8Array(n);
    const add = (t: Uint8Array, a: Uint8Array) => { for (let i = 0; i < n; i++) { const v = t[i] + a[i]; t[i] = v > 255 ? 255 : v; } };
    for (const { k, a } of colorPlates) { if (!neverBase(k.hex) && (s.baseFor?.["c" + k.hex.slice(1)] ?? baseByDefault(k.hex))) add(ub, a); add(inked, a); }
    if (white) { add(ub, white); add(inked, white); }
    const r = Math.max(0, Math.round(s.choke));
    if (r > 0) {
      // under base only: no more base than the least-inked spot within r px (bare shirt nearby pulls it back)
      const D = disc(r, w);
      for (let i = 0; i < n; i++) {
        if (!ub[i]) continue;
        const m = discPick(inked, i, w, h, D, false, inked[i]);
        if (ub[i] > m) ub[i] = m;
      }
    }
    plates.push(mk("ub", "Underbase White", "#FFFFFF", "underbase", ub));
  }
  const body = colorPlates.filter(({ k }) => !(dark && s.highlight && isWhite(k.hex)));
  body.sort((x, y) => lightness(y.k.hex) - lightness(x.k.hex));
  // highlight white: the art's white (and, in simulated process, the white left over after the inks)
  // (spot color: only when white is one of the chosen inks, as Separo counts it; the white left over in mixes is
  // already in the underbase. Simulated process: the leftover white is the highlight.)
  let hw: Uint8Array | null = null;
  if (dark && s.highlight && (s.method !== "spot" || print.some((k) => isWhite(k.hex)))) {
    hw = new Uint8Array(n);
    for (const { k, a } of colorPlates) if (isWhite(k.hex)) for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + a[i]);
    if (white && s.method !== "spot") for (let i = 0; i < n; i++) hw[i] = Math.min(255, hw[i] + white[i]);
  }
  // print order after the base: colors light → dark, the highlight white, then black-ish inks last (like Separo:
  // Base, 107 C, 143 C, 171 C, White, Black), so the darkest ink crisps up every edge it touches
  const blackish = (hex: string) => lightness(hex) < 25;
  type Step = { key: string; name: string; hex: string; kind: PlateKind; a: Uint8Array };
  const seq: Step[] = [
    ...body.filter(({ k }) => !blackish(k.hex)).map(({ k, a }) => ({ key: "c" + k.hex.slice(1), name: k.name, hex: k.hex, kind: "color" as PlateKind, a })),
    ...(hw ? [{ key: "hw", name: "Highlight White", hex: "#FFFFFF", kind: "highlight" as PlateKind, a: hw }] : []),
    ...body.filter(({ k }) => blackish(k.hex)).map(({ k, a }) => ({ key: "c" + k.hex.slice(1), name: k.name, hex: k.hex, kind: "color" as PlateKind, a })),
  ];
  // trap: each color spreads a little under the colors printed after it (never out onto the bare shirt), so
  // neighbors overlap instead of just touching: no gaps, and a little room for registration
  const tonals = seq.map((x) => tonalOf(x.a));
  const trap = Math.max(0, Math.round(s.trap ?? 1));
  if (s.method === "spot" && trap > 0 && seq.length > 1) {
    const later = new Uint8Array(n);
    for (let j = seq.length - 1; j >= 0; j--) {
      const a = seq[j].a, orig = a.slice();
      if (j < seq.length - 1) {
        // only where a later ink prints and this one isn't already solid: the most of this ink within `trap` px
        const D = disc(trap, w);
        for (let i = 0; i < n; i++) {
          if (!later[i] || a[i] === 255) continue;
          const g = discPick(orig, i, w, h, D, true, orig[i]);
          if (g > a[i]) a[i] = Math.min(g, Math.max(a[i], later[i]));
        }
      }
      for (let i = 0; i < n; i++) { const v = later[i] + orig[i]; later[i] = v > 255 ? 255 : v; }
    }
  }
  seq.forEach((st, j) => plates.push(mk(st.key, st.name, st.hex, st.kind, st.a, tonals[j])));
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
/**
 * A plate as film at `dpi` for a print `widthIn` wide: 1 = black (ink). Spot plates are solid (edges at 50%);
 * simulated-process plates are halftoned: round dots at `lpi`, angled `angle`°, sized by the ink coverage.
 */
export function filmBits(p: Plate, w: number, h: number, widthIn: number, dpi: number, halftone: boolean, lpi = 55, angle = 22.5, gain = 0): { W: number; H: number; bits: Uint8Array } {
  const W = Math.max(1, Math.round(widthIn * dpi)), H = Math.max(1, Math.round(W * (h / w))), rowBytes = Math.ceil(W / 8);
  const bits = new Uint8Array(rowBytes * H), sx = w / W, sy = h / H;
  const cell = dpi / lpi, rad = (angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  // the plate is sampled smoothly (bilinear) between its pixels, so a solid edge on film follows the art's soft
  // edge at film resolution instead of stepping in plate-pixel blocks
  const A = p.alpha;
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    const r0 = y0 * w, r1 = y1 * w;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const top = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * tx, bot = A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * tx;
      let v = (top + (bot - top) * ty) / 255;
      // halftones: dots smaller than the screen can hold print nothing, nearly-solid prints solid (4% / 96%), and
      // dot gain is taken off ahead of time (a dot grows about gain·4·v·(1−v) on the shirt: 20% at a 50% dot)
      if (halftone && v > 0.02 && v < 0.98) {
        if (gain > 0) { const G4 = 4 * gain; v = ((1 + G4) - Math.sqrt((1 + G4) ** 2 - 4 * G4 * v)) / (2 * G4); }
        if (v < 0.04) v = 0; else if (v > 0.96) v = 1;
      }
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
