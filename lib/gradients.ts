/**
 * Gradients in art: one color fading into another. A color picker sees a gradient as a long row of in-between colors;
 * a printer sees two (or three, four…) inks: the fullest color at each end of the fade, printed as halftones that
 * overlap across it. This finds those fades among the colors found in a picture and keeps only their ends, set to the
 * truest color at each end (not an average that's already partway into the fade).
 *
 * How a fade is told apart from flat colors that just happen to sit between two others (the sun's gold, between its
 * yellow and orange): in a fade, the art's pixels fill the whole way from one end to the other (nearly every step
 * along the line between the two colors has pixels); flat colors leave the line mostly empty with a few bumps.
 */
export type RampColor = { lab: number[]; rgb: number[]; share: number; gradient?: boolean };

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * `cols`: the colors found (Lab + sRGB + share of the art). `pts` / `rgbs`: the pixels sampled (Lab / sRGB).
 * Returns the colors with each fade's in-between colors taken out (their share goes to the nearer end) and its two
 * ends marked `gradient` and moved to the truest color at that end. A three-color fade (yellow → orange → red that
 * bends at orange) comes back as two fades sharing orange.
 */
export function collapseRamps(cols: RampColor[], pts: number[][], rgbs: number[][]): RampColor[] {
  let out = cols.map((c) => ({ ...c }));
  const done = new Set<string>();
  const key = (a: RampColor, b: RampColor) => [a.rgb.join(","), b.rgb.join(",")].sort().join("|");
  for (let round = 0; round < 6; round++) {
    let best: { i: number; j: number; len: number; near: number[] } | null = null;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const A = out[i].lab, B = out[j].lab, AB = sub(B, A), L2 = dot(AB, AB), L = Math.sqrt(L2);
      if (L < 25 || done.has(key(out[i], out[j]))) continue;
      const tol = Math.max(6, 0.1 * L), bins = new Array(20).fill(0), near: number[] = [];
      for (let k = 0; k < pts.length; k++) {
        const AP = sub(pts[k], A), t = dot(AP, AB) / L2;
        if (t < -0.06 || t > 1.06) continue;
        const d2 = dot(AP, AP) - t * t * L2;
        if (d2 > tol * tol) continue;
        near.push(k); bins[Math.max(0, Math.min(19, Math.floor(t * 20)))]++;
      }
      // the fade must be a real part of the art, and fill the way from end to end
      if (near.length < 0.12 * pts.length) continue;
      let filled = 0; for (let b = 2; b < 18; b++) if (bins[b] >= Math.max(2, near.length * 0.006)) filled++;
      if (filled < 13) continue;
      if (!best || L > best.len) best = { i, j, len: L, near };
    }
    if (!best) break;
    const { i, j, near } = best, A = out[i].lab, B = out[j].lab, AB = sub(B, A), L2 = dot(AB, AB), L = Math.sqrt(L2);
    // the truest color at each end: follow the fade past the two colors found (they're averages, already partway in)
    // as long as the art keeps going along the same line, then take the pixels in the last 3% of the way
    const tolE = Math.max(6, 0.1 * L), BW = 0.025, B0 = 40, cnt = new Array(121).fill(0);
    const all: { k: number; t: number }[] = [];
    for (let k = 0; k < pts.length; k++) {
      const AP = sub(pts[k], A), t = dot(AP, AB) / L2;
      if (t < -1 || t > 2 || dot(AP, AP) - t * t * L2 > tolE * tolE) continue;
      all.push({ k, t }); cnt[Math.max(0, Math.min(120, B0 + Math.floor(t / BW)))]++;
    }
    const minC = Math.max(2, all.length * 0.002);
    let bl = B0, bh = B0 + Math.round(1 / BW) - 1;
    while (bl > 0 && cnt[bl - 1] >= minC) bl--;
    while (bh < 120 && cnt[bh + 1] >= minC) bh++;
    const tLo = (bl - B0) * BW, tHi = (bh - B0 + 1) * BW;
    const ts = all.filter((x) => x.t >= tLo && x.t <= tHi).sort((a, b) => a.t - b.t);
    const endOf = (from: number, to: number) => { const r = [0, 0, 0]; let n = 0; for (let q = from; q < to; q++) { const c = rgbs[ts[q].k]; r[0] += c[0]; r[1] += c[1]; r[2] += c[2]; n++; } return n ? r.map((v) => v / n) : null; };
    const m = Math.max(1, Math.floor(ts.length * 0.03));
    const lo = endOf(0, m), hi = endOf(ts.length - m, ts.length);
    // in-between colors: on the line, between the ends
    const tol = Math.max(8, 0.12 * L), gone: number[] = [];
    out.forEach((c, k) => {
      if (k === i || k === j) return;
      const AP = sub(c.lab, A), t = dot(AP, AB) / L2;
      if (t > 0.04 && t < 0.96 && dot(AP, AP) - t * t * L2 < tol * tol) { gone.push(k); if (t < 0.5) out[i].share += c.share; else out[j].share += c.share; }
    });
    done.add(key(out[i], out[j]));
    out[i].gradient = out[j].gradient = true;
    if (lo) out[i] = { ...out[i], rgb: lo, lab: labOfRgb(lo) };
    if (hi) out[j] = { ...out[j], rgb: hi, lab: labOfRgb(hi) };
    done.add(key(out[i], out[j]));
    out = out.filter((_, k) => !gone.includes(k));
  }
  return out;
}

/** sRGB (0–255) → CIE Lab (D65) */
export function labOfRgb(c: number[]): number[] {
  const [r, g, b] = c.map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/**
 * Where a color sits between two inks it fades between: t (0 = at `a`, 1 = at `b`) and how far off the line it is
 * (sRGB units). Used to repaint a fade with the chosen inks instead of cutting it in two.
 */
export function onLine(p: number[], a: number[], b: number[]): { t: number; d: number } {
  const AB = sub(b, a), L2 = dot(AB, AB); if (!L2) return { t: 0, d: Infinity };
  const AP = sub(p, a), t = dot(AP, AB) / L2, tc = Math.max(0, Math.min(1, t));
  const q = [a[0] + tc * AB[0], a[1] + tc * AB[1], a[2] + tc * AB[2]];
  return { t: tc, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) };
}
