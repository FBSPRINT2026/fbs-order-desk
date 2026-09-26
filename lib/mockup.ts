/**
 * Mockup geometry. Garment photos from S&S are 1000 x 1250 (front and back, flat).
 * Everything here is in that 1000-wide coordinate space.
 * Calibrated on the Gildan 5000 photos (shirt on a form): print areas land where they do on a real shirt at ~34 px per inch.
 */
export const PHOTO_W = 1000;
export const PHOTO_H = 1250;
export const PX_PER_IN = 34;
export const CENTER_X = 499;
export const COLLAR_Y = { front: 128, back: 100 } as const;

export type View = "front" | "back";
type Half = { x: number; y: number; rot: number; show: "left" | "right" };
type Loc = { view: View; dx?: number; drop?: number; /** art starts at the top of the print area instead of the middle */ top?: boolean; abs?: { x: number; y: number }; rot?: number; defW: number; maxW: number; maxH: number;
  /** sleeve prints wrap over the sleeve: part shows on the front photo, the rest on the back photo */
  wrap?: { front: Half; back: Half } };

/** Where each order-form location sits (dx = inches right of center as you look at the shirt; drop = inches below the collar). */
export const LOCATION_SPOTS: Record<string, Loc> = {
  // max print areas from the FBS apparel placement guide (width x height)
  "Full Front": { view: "front", dx: 0, drop: 4, top: true, defW: 11, maxW: 12, maxH: 14 },
  "Medium Front": { view: "front", dx: 0, drop: 3, defW: 8, maxW: 8, maxH: 8 },
  "Center Chest": { view: "front", dx: 0, drop: 3, defW: 4.5, maxW: 5, maxH: 5 },
  "Across Chest": { view: "front", dx: 0, drop: 3, defW: 11, maxW: 12, maxH: 4 },
  "Left Chest": { view: "front", dx: 3.5, drop: 3, defW: 3.5, maxW: 5, maxH: 5 },
  "Right Chest": { view: "front", dx: -3.5, drop: 3, defW: 3.5, maxW: 5, maxH: 5 },
  Pocket: { view: "front", dx: 4.5, drop: 5, defW: 3, maxW: 4, maxH: 4 },
  // wearer's left sleeve is on the right of the front photo and the left of the back photo
  // Measured on the S&S photos: the sleeve's outer edge (the fold between front and back) runs at ~35° and the hem is square to it.
  // x/y is the center of the 3.5" x 3.5" max print area: right on the fold, with the bottom of the area ~0.5" above the sleeve hem.
  "Left Sleeve": { view: "front", defW: 3, maxW: 3.5, maxH: 3.5, wrap: { front: { x: 912, y: 343, rot: -35, show: "left" }, back: { x: 92, y: 343, rot: 35, show: "right" } } },
  "Right Sleeve": { view: "front", defW: 3, maxW: 3.5, maxH: 3.5, wrap: { front: { x: 88, y: 343, rot: 35, show: "right" }, back: { x: 908, y: 343, rot: -35, show: "left" } } },
  "Left Vertical": { view: "front", dx: 4.5, drop: 4, defW: 4, maxW: 5, maxH: 14 },
  "Right Vertical": { view: "front", dx: -4.5, drop: 4, defW: 4, maxW: 5, maxH: 14 },
  "Front Bottom Left": { view: "front", dx: 4.5, drop: 21.5, defW: 4.5, maxW: 5, maxH: 6 },
  "Front Bottom Right": { view: "front", dx: -4.5, drop: 21.5, defW: 4.5, maxW: 5, maxH: 6 },
  "Full Back": { view: "back", dx: 0, drop: 4, top: true, defW: 12, maxW: 12, maxH: 14 },
  "Medium Back": { view: "back", dx: 0, drop: 4, defW: 8, maxW: 8, maxH: 8 },
  "Upper Back (Yoke)": { view: "back", dx: 0, drop: 2, defW: 3.5, maxW: 4, maxH: 4 },
  "Across Shoulders": { view: "back", dx: 0, drop: 2.5, defW: 12, maxW: 14, maxH: 4 },
};
/**
 * How one garment photo lines up with the reference (Gildan 5000 black). S&S scales every photo so the sleeve tips touch the edges,
 * and each color is shot on a slightly different form, so the shirt's size, height and sleeve angle change from photo to photo.
 * s = size vs the reference, cx = body center, top = top of the collar; sleeves = where each sleeve print sits on this photo.
 */
export type Fit = { s: number; cx: number; top: number; /** PNG data URL: opaque where the shirt is, clear on the background */ mask: string; sleeve: { left: { x: number; y: number; rot: number }; right: { x: number; y: number; rot: number } } };
const REF = { front: { top: 106, bodyW: 517, h: 1036 }, back: { top: 93, bodyW: 476, h: 1063 } } as const;
/** Center of the sleeve print area: this far (reference px) up the fold from the sleeve tip, i.e. area bottom ~0.5" above the hem. */
const SLEEVE_UP = 76.5;

/** Measure the shirt outline on a photo (white background). Returns null when it can't find a clean outline (e.g. drawn tee). */
export function measureGarment(img: HTMLImageElement, view: View): Fit | null {
  const W = PHOTO_W, H = PHOTO_H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(img, 0, 0, W, H);
  let d: Uint8ClampedArray;
  try { d = x.getImageData(0, 0, W, H).data; } catch { return null; }
  // background = near-white pixels connected to the photo's border (flood fill), so white shirts with bright spots still count as shirt
  const bg = new Uint8Array(W * H);
  const light = (p: number) => Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) >= 250;
  const stack = new Int32Array(W * H);
  let sp = 0;
  const push = (p: number) => { if (!bg[p] && light(p)) { bg[p] = 1; stack[sp++] = p; } };
  for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const p = stack[--sp], X = p % W;
    if (X > 0) push(p - 1);
    if (X < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < W * (H - 1)) push(p + W);
  }
  const md = x.createImageData(W, H);
  for (let p = 0; p < W * H; p++) { md.data[p * 4 + 3] = bg[p] ? 0 : 255; }
  const mc = document.createElement("canvas");
  mc.width = W; mc.height = H;
  mc.getContext("2d")!.putImageData(md, 0, 0);
  const mask = mc.toDataURL("image/png");

  const L = new Int16Array(H).fill(-1), R = new Int16Array(H).fill(-1);
  let T = -1, B = -1;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let X = 0; X < W; X++) {
      if (!bg[y * W + X]) { n++; if (L[y] < 0) L[y] = X; R[y] = X; }
    }
    if (n > 10) { if (T < 0) T = y; B = y; } else { L[y] = -1; R[y] = -1; }
  }
  if (T < 0 || B - T < 600) return null;
  const yy = Math.round(T + 0.55 * (B - T));
  const bodyW = R[yy] - L[yy];
  if (bodyW < 300) return null;
  const ref = REF[view];
  const s = (bodyW / ref.bodyW + (B - T) / ref.h) / 2;
  const cx = (L[yy] + R[yy]) / 2;
  const sleeve = (side: "left" | "right") => {
    const edge = side === "right" ? R : L;
    const better = (a: number, b: number) => (side === "right" ? a > b : a < b);
    // sleeve tip: the outermost point in the top half of the shirt
    let best = side === "right" ? -1 : W + 1;
    const lim = Math.round(T + 0.5 * (B - T));
    for (let y = T; y < lim; y++) if (edge[y] >= 0 && better(edge[y], best)) best = edge[y];
    let sy = 0, n = 0;
    for (let y = T; y < lim; y++) if (edge[y] >= 0 && Math.abs(edge[y] - best) <= 1) { sy += y; n++; }
    const tipY = sy / (n || 1), tip = { x: best, y: tipY };
    // the fold: straight line fit of the outer edge above the tip
    let n2 = 0, my = 0, mx = 0, syy = 0, sxy = 0;
    for (let y = Math.round(tipY - 150 * s); y <= Math.round(tipY - 15 * s); y++) {
      if (y < 0 || edge[y] < 0) continue;
      n2++; my += y; mx += edge[y]; syy += y * y; sxy += y * edge[y];
    }
    const b = n2 > 5 ? (sxy - (mx * my) / n2) / (syy - (my * my) / n2) : side === "right" ? 0.7 : -0.7;
    const len = Math.hypot(b, 1), u = { x: b / len, y: 1 / len };
    const out = side === "right" ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    return { x: tip.x - SLEEVE_UP * s * u.x + 2 * out.x, y: tip.y - SLEEVE_UP * s * u.y + 2 * out.y, rot: (-Math.atan(b) * 180) / Math.PI };
  };
  let left = sleeve("left"), right = sleeve("right");
  // sanity: a sleeve fold runs ~25-45°; if one side reads wrong, mirror the other side's angle
  const ok = (r: number) => Math.abs(r) >= 22 && Math.abs(r) <= 48;
  if (!ok(left.rot) && ok(right.rot)) left = { ...left, rot: -right.rot };
  if (!ok(right.rot) && ok(left.rot)) right = { ...right, rot: -left.rot };
  if (!ok(left.rot) && !ok(right.rot)) { left = { ...left, rot: 35 }; right = { ...right, rot: -35 }; }
  return { s, cx, top: T, mask, sleeve: { left, right } };
}

/** Which garment photos a location shows on. */
export const viewsFor = (location: string): View[] => { const s = spotFor(location); return s.wrap ? ["front", "back"] : [s.view]; };
/** Largest width (inches) that fits the location's max print area for a design of this height/width ratio. */
export function maxWidthFor(location: string, ratio: number) { const s = spotFor(location); return ratio ? Math.min(s.maxW, s.maxH / ratio) : s.maxW; }
export const spotFor = (location: string): Loc => LOCATION_SPOTS[location] || { view: "front", dx: 0, drop: 3, defW: 4, maxW: 12, maxH: 14 };

/**
 * A small design on a big location usually belongs on a smaller one (a 3.5" logo marked Full Front is really a left chest).
 * Returns the better locations, best first (by where it sits: dxIn = inches right of center as you look at the shirt), or [] if it fits.
 */
export function smallerSpot(location: string, wIn: number, hIn: number, dxIn = 0): string[] {
  if (!wIn) return [];
  const front = location === "Full Front" ? 5 : location === "Medium Front" ? 4 : 0;
  if (front && wIn <= front && (!hIn || hIn <= 5)) {
    const first = dxIn < -2 ? "Right Chest" : "Left Chest";
    return [first, ...["Left Chest", "Center Chest"].filter((x) => x !== first)];
  }
  const back = location === "Full Back" ? 4 : location === "Medium Back" ? 3.5 : 0;
  if (back && wIn <= back && (!hIn || hIn <= 4)) return ["Upper Back (Yoke)"];
  return [];
}

/** Bigger locations a print could move to when it's grown past this location's max area (smallest that fits first). */
export function biggerSpot(location: string, wIn: number, hIn: number): string[] {
  const spot = spotFor(location);
  if (spot.wrap) return [];
  const opts = spot.view === "back" ? ["Medium Back", "Full Back"] : ["Medium Front", "Full Front"];
  return opts.filter((z) => z !== location && LOCATION_SPOTS[z].maxW >= wIn && LOCATION_SPOTS[z].maxH >= (hIn || 0) && LOCATION_SPOTS[z].maxW > spot.maxW);
}

/** Width in inches from the imprint's print size ("11\" wide", "4\" tall", "MAX wide") and the design's proportions. */
export function printWidth(size: string, location: string, ratio: number): number {
  const spot = spotFor(location);
  const s = (size || "").trim();
  // MAX: as big as fits the location's max print area
  if (/^max/i.test(s)) return ratio ? Math.min(spot.maxW, spot.maxH / ratio) : spot.maxW;
  const m = s.match(/^([\d.]+)/);
  if (!m) return spot.defW;
  const v = +m[1];
  const w = /tall/i.test(s) ? (ratio ? v / ratio : v) : v;
  // never bigger than the location's max print area
  return Math.min(w, maxWidthFor(location, ratio));
}

/** Top-left of a design on the photo, before any hand adjustment. With a Fit, it's placed on that photo's measured shirt. */
export function basePlacement(location: string, wIn: number, ratio: number, dropIn: number | null, scale: number, view?: View, fit?: Fit | null) {
  const spot = spotFor(location);
  const k = fit?.s || 1;
  if (spot.wrap) {
    // centered on the sleeve's outer fold; half of it shows on this photo
    const hf = spot.wrap[view || "front"];
    const pt = fit ? fit.sleeve[hf.x > PHOTO_W / 2 ? "right" : "left"] : hf;
    const ppi0 = PX_PER_IN * scale * k, w0 = wIn * ppi0, h0 = ratio ? w0 * ratio : w0, a0 = spot.maxW * ppi0, b0 = spot.maxH * ppi0;
    return { view: view || "front", x: pt.x - w0 / 2, y: pt.y - h0 / 2, w: w0, h: h0, rot: pt.rot, clip: hf.show, area: { x: pt.x - a0 / 2, y: pt.y - b0 / 2, w: a0, h: b0 }, k };
  }
  const ppi = PX_PER_IN * scale;
  const w = wIn * ppi;
  const h = ratio ? w * ratio : w;
  const aw = spot.maxW * ppi, ah = spot.maxH * ppi;
  const cx = CENTER_X + (spot.dx || 0) * ppi;
  const top = COLLAR_Y[spot.view] + (dropIn ?? spot.drop ?? 3) * ppi;
  // art sits in the middle of the print area; full front/back (or a set drop) start at the top instead
  const artY = dropIn != null || spot.top ? top : top + Math.max(0, (ah - h) / 2);
  // move from the reference photo onto this photo's shirt
  const mx = (v: number) => (fit ? fit.cx + (v - CENTER_X) * k : v), my = (v: number) => (fit ? fit.top + (v - REF[spot.view].top) * k : v);
  return { view: spot.view, x: mx(cx - w / 2), y: my(artY), w: w * k, h: h * k, rot: 0, clip: "" as "" | "left" | "right", area: { x: mx(cx - aw / 2), y: my(top), w: aw * k, h: ah * k }, k };
}

const NAMED: Record<string, string> = {
  black: "#1b1b1b", white: "#f7f7f5", navy: "#1f2a44", red: "#c8102e", royal: "#1d4f9c", maroon: "#6b1f33", "forest green": "#1f3d2b",
  "sport grey": "#b9bcbf", "dark heather": "#4b4d52", charcoal: "#44464a", gold: "#f1a91c", orange: "#f26522", purple: "#4b2a7b",
  "irish green": "#1f9a4f", "kelly green": "#1f9a4f", "light blue": "#a9c9e8", "carolina blue": "#77a7d8", sand: "#d8c9a8", natural: "#efe6d2", ash: "#dcdcd8",
};
export const guessHex = (color: string) => NAMED[(color || "").toLowerCase().trim()] || "#9aa1ab";

/** Plain tee outline for garments without S&S photos. */
export function teeSvg(hex: string, view: View) {
  const neck = view === "front" ? "M420 110 Q500 175 580 110" : "M430 100 Q500 130 570 100";
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1250"><rect width="1000" height="1250" fill="#ffffff"/><path d="M405 105 L250 150 L60 390 L180 470 L245 410 L245 1120 L755 1120 L755 410 L820 470 L940 390 L750 150 L595 105 Q500 ${view === "front" ? 175 : 130} 405 105 Z" fill="${hex}" stroke="#00000033" stroke-width="4"/><path d="${neck}" fill="none" stroke="#00000044" stroke-width="6"/></svg>`)}`;
}

/** Same-origin link to an S&S photo (so it can be drawn into the saved mockup). */
export const ssImg = (path: string) => (path ? `/api/ss/img?p=${encodeURIComponent(path.replace(/^https?:\/\/[^/]+\//, ""))}` : "");
