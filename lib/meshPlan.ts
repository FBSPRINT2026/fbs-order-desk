/**
 * Suggested mesh per screen, from the smallest detail on it.
 *
 * Shop rule (Nicholas): 156 for almost everything, underbase included; go finer (195, 230…) only when the detail is
 * very small, and then the underbase under that detail has to be at least as fine (it prints the same dots).
 *
 * How small is too small: a detail has to sit on enough threads to print clean (a dot that fits in a couple of
 * openings prints ragged or not at all, and plastisol through a coarse mesh fills small dots in). Measured in mesh
 * pitches (one thread + one opening = 25.4 mm / mesh count):
 *   - dots: at least ~4 pitches across, plus 15% margin (≈ the size of a midtone dot in a halftone cell, from the
 *     usual mesh ≈ 4–5 × LPI rule; Screen Printing Mag: at least 3.5:1, better at 5:1): 156 → 0.75 mm, 195 → 0.60,
 *     230 → 0.51, 305 → 0.38;
 *   - lines: at least ~3 pitches wide (a line is held along its length): 156 → 0.49 mm, 195 → 0.39, 230 → 0.33.
 * Checked on the peace sun at 11" wide: its red dots measure about 1.1 mm (full-size art; the screen copy reads them a
 * little smaller), so 156 holds them; printed 6" wide they'd be about 0.6 mm and want 195.
 * The underbase isn't measured itself (its choke makes its dots smaller than the colors'); it matches the finest
 * color printed on it. Halftones keep mesh ≈ 4–5 × LPI and aren't changed here.
 */
export const SHOP_MESH = [80, 110, 156, 195, 230, 305];
const FLOOR = 156; // the shop's everyday mesh
export const pitchUm = (mesh: number) => 25400 / mesh;
/** the smallest dot / line a mesh holds well (µm) */
export const holdsUm = (mesh: number, kind: "dot" | "line" = "dot") => (kind === "dot" ? 4.6 : 3) * pitchUm(mesh);

export type Detail = { smallestUm: number; count: number; what: string; kind: "dot" | "line" };

/**
 * The smallest detail that matters on a plate: separate dots / specks (connected areas) and thin parts of bigger
 * shapes (the middle line of a stroke), measured with a distance map. "Matters" = at least a handful of them (or a
 * real share of the plate), so one stray speck doesn't push a whole screen to a finer mesh.
 */
export function smallestDetail(alpha: Uint8Array, w: number, h: number, widthIn: number): Detail | null {
  const n = w * h, umPx = (widthIn * 25400) / w;
  // distance to the nearest pixel without ink (chamfer 3-4, in px)
  const INF = 1 << 20, d = new Int32Array(n);
  for (let i = 0; i < n; i++) d[i] = alpha[i] > 127 ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); else v = Math.min(v, 3);
    if (y > 0) { v = Math.min(v, d[i - w] + 3); if (x > 0) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); } else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3); else v = Math.min(v, 3);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x > 0) v = Math.min(v, d[i + w - 1] + 4); } else v = Math.min(v, 3);
    d[i] = v;
  }
  // separate dots / specks: each connected area's widest point (2 × its deepest distance)
  const lab = new Int32Array(n), stack: number[] = [], comps: { area: number; width: number }[] = [];
  let inkPx = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (!d[s0] || lab[s0]) continue;
    const id = comps.length + 1; let deep = 0, size = 0; lab[s0] = id; stack.push(s0);
    while (stack.length) {
      const i = stack.pop()!, x = i % w; size++; if (d[i] > deep) deep = d[i];
      if (x > 0 && d[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && d[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack.push(i + 1); }
      if (i >= w && d[i - w] && !lab[i - w]) { lab[i - w] = id; stack.push(i - w); }
      if (i + w < n && d[i + w] && !lab[i + w]) { lab[i + w] = id; stack.push(i + w); }
    }
    inkPx += size;
    comps.push({ area: size, width: Math.max(1, (2 * deep) / 3 - 1) }); // width across, px
  }
  if (!comps.length) return null;
  // thin parts of shapes: ridge pixels (local maxima of the distance), their width
  const ridge: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = d[i]; if (!v) continue;
    if (v >= d[i - 1] && v >= d[i + 1] && v >= d[i - w] && v >= d[i + w] && (v > d[i - 1] || v > d[i + 1] || v > d[i - w] || v > d[i + w])) ridge.push(Math.max(1, (2 * v) / 3 - 1));
  }
  ridge.sort((a, b) => a - b);
  // dots: separate shapes big enough to be art (specks of a pixel or two from anti-aliasing don't count); the
  // smaller ones of them (20th percentile) when there are enough to matter
  // (only roundish ones count as dots: long thin slivers between outlines are lines, measured below)
  const cs = comps.filter((c) => c.area >= 5 && c.area <= 3.2 * c.width * c.width).map((c) => c.width).sort((a, b) => a - b);
  const dotPx = cs.length >= 10 ? cs[Math.floor(cs.length * 0.05)] : Infinity;
  // lines: only when thin strokes are a real part of the plate (not just the tapered tips of wider shapes): more
  // than 15% of the shapes' middle lines thinner than what 156 holds; then the typical thin width
  const thinPx = holdsUm(156, "line") / umPx, thinShare = ridge.length ? ridge.filter((v) => v < thinPx).length / ridge.length : 0;
  const lineFrac = thinShare > 0.15 ? ridge[Math.floor(ridge.length * thinShare * 0.5)] : Infinity;
  const px = Math.min(dotPx, lineFrac);
  if (!isFinite(px)) return null;
  const what = px === dotPx ? `${cs.length} separate dots/shapes, the smallest (5%) about` : `thin lines (${Math.round(thinShare * 100)}% of the strokes) about`;
  return { smallestUm: Math.max(1, px) * umPx, count: cs.length, what, kind: px === dotPx ? "dot" : "line" };
}

/** the coarsest shop mesh (156 or finer) that holds this detail */
export function meshFor(um: number, kind: "dot" | "line" = "dot"): number {
  for (const m of SHOP_MESH) if (m >= FLOOR && holdsUm(m, kind) <= um) return m;
  return SHOP_MESH[SHOP_MESH.length - 1];
}
