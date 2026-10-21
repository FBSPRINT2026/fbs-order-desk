/**
 * Mockup geometry. Garment photos from S&S are 1000 x 1250 (front and back, flat).
 * Everything here is in that 1000-wide coordinate space.
 * Calibrated on the Gildan 5000 photos (shirt on a form): print areas land where they do on a real shirt at ~34 px per inch.
 */
import { REF_BODY, type Body } from "./garmentBody";

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
  "Full Front": { view: "front", dx: 0, drop: 4, top: true, defW: 11, maxW: 13, maxH: 18 },
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
  "Full Back": { view: "back", dx: 0, drop: 4, top: true, defW: 12, maxW: 13, maxH: 18 },
  "Medium Back": { view: "back", dx: 0, drop: 4, defW: 8, maxW: 8, maxH: 8 },
  "Upper Back (Yoke)": { view: "back", dx: 0, drop: 2, defW: 3.5, maxW: 4, maxH: 4 },
  "Across Shoulders": { view: "back", dx: 0, drop: 2.5, defW: 12, maxW: 14, maxH: 4 },
};
/**
 * How one garment photo lines up with the reference (Gildan 5000 black). S&S scales every photo so the sleeve tips touch the edges,
 * and each color is shot on a slightly different form, so the shirt's size, height and sleeve angle change from photo to photo.
 * s = size vs the reference, cx = body center, top = top of the collar; sleeves = where each sleeve print sits on this photo.
 */
export type Fit = { s: number; cx: number; top: number; /** PNG data URL: opaque where the shirt is, clear on the background */ mask: string; sleeve: { left: { x: number; y: number; rot: number }; right: { x: number; y: number; rot: number } };
  /** a bag or tote (flat, no collar): its body on the photo (px) and pixels per inch from its real width */
  flat?: { cx: number; top: number; w: number; h: number; ppi: number };
  /** a shirt: its side seams across the body (px) and the bottom of the hem, as found on this photo */
  body?: { l: number; r: number; hem: number };
  /** where prints are measured from (Oct 20, Nick: "start in the same spot from the bottom of the neckline every time"):
   *  front = the bottom of the front neckline at the center, back = the top of the back neck at the center (px) */
  neck?: number };
/** the same points on the reference Gildan 5000 photos (bottom of the front collar rib; top of the back collar) */
export const REF_NECK = { front: 156, back: 95 } as const;
export const REF = { front: { top: 106, bodyW: 517, h: 1036 }, back: { top: 93, bodyW: 476, h: 1063 } } as const;
/** Center of the sleeve print area: this far (reference px) up the fold from the sleeve tip, i.e. area bottom ~0.5" above the hem. */
const SLEEVE_UP = 76.5;

/**
 * Draw a photo the way the page shows it (object-fit: contain, centered on white): S&S photos are already 4:5 and fill
 * the frame, but SanMar's aren't, and stretching them to fill made a 13" tote measure ~19% wider than it shows.
 */
function drawContained(x: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  const iw = img.naturalWidth || W, ih = img.naturalHeight || H, k = Math.min(W / iw, H / ih), dw = iw * k, dh = ih * k;
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** Measure the shirt outline on a photo (white background). Returns null when it can't find a clean outline (e.g. drawn tee). */
export function measureGarment(img: HTMLImageElement, view: View): Fit | null {
  const W = PHOTO_W, H = PHOTO_H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  drawContained(x, img, W, H);
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
  // how big the photo is drawn, against the reference Gildan 5000: its height and its body width, averaged. When they
  // disagree by more than 10% the garment's cut is different, not the photo's zoom: a fitted Bella 3001 is ~16% narrower
  // at the same height (Oct 16, Nick: "why isn't the 3001 centered like a 5000"; it was blown up 8%), and a long sleeve
  // or hoodie's arms hang beside the body and read as width. Then the height alone sets the scale (unless the photo
  // cuts the garment off at the top or bottom, when the height can't be trusted).
  const sw = bodyW / ref.bodyW, sh = (B - T) / ref.h, cut = T <= 2 || B >= H - 3;
  const s = Math.abs(sw - sh) > 0.1 && !cut ? sh : (sw + sh) / 2;
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
  // a sleeve that hangs beside the body (3/4 and long sleeves, raglans): its print goes the same distance above its own
  // cuff (Oct 20, Nick: "the imprint always in the same spot relative to the top of the hem line on the sleeve"). The
  // cuff is where the outline, coming down the outside of the sleeve, steps in sharply to the body (works whether the
  // sleeve hangs free or touches the body)
  const cuff = (side: "left" | "right", fromY: number) => {
    const edge = side === "right" ? R : L, inward = (a: number, b: number) => (side === "right" ? a - b : b - a);
    let hem = -1;
    for (let y = Math.round(fromY + 40 * s); y < Math.round(T + 0.85 * (B - T)); y++) {
      if (edge[y] < 0 || edge[y + 3] < 0) continue;
      if (inward(edge[y], edge[y + 3]) > 25 * s) { hem = y; break; }
    }
    if (hem < 0) return null;
    let best = side === "right" ? -1 : W + 1, by = hem;
    for (let y = Math.round(hem - 40 * s); y <= hem; y++) if (y > 0 && edge[y] >= 0 && (side === "right" ? edge[y] > best : edge[y] < best)) { best = edge[y]; by = y; }
    // a real hanging sleeve is still out at the side of the photo just above its cuff; a short sleeve's step is the
    // underarm, where the outline is already back at the body
    let tipX = side === "right" ? -1 : W + 1;
    for (let y = T; y < Math.round(T + 0.5 * (B - T)); y++) if (edge[y] >= 0 && (side === "right" ? edge[y] > tipX : edge[y] < tipX)) tipX = edge[y];
    if (Math.abs(best - tipX) > 60 * s) return null;
    // the outer edge above the cuff: the sleeve's direction
    let n2 = 0, my = 0, mx = 0, syy = 0, sxy = 0;
    for (let y = Math.round(by - 150 * s); y <= Math.round(by - 15 * s); y++) { if (y < 0 || edge[y] < 0) continue; n2++; my += y; mx += edge[y]; syy += y * y; sxy += y * edge[y]; }
    const b = n2 > 5 ? (sxy - (mx * my) / n2) / (syy - (my * my) / n2) : 0;
    const len = Math.hypot(b, 1), u = { x: b / len, y: 1 / len };
    const out = side === "right" ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    return { tipY: by, pt: { x: best - SLEEVE_UP * s * u.x + 2 * out.x, y: by - SLEEVE_UP * s * u.y + 2 * out.y, rot: (-Math.atan(b) * 180) / Math.PI } };
  };
  let left = sleeve("left"), right = sleeve("right");
  const lc = cuff("left", left.y), rc = cuff("right", right.y);
  // a long hanging sleeve: its cuff is far below the short-sleeve "tip"
  const longL = !!lc && lc.tipY > left.y + 120 * s, longR = !!rc && rc.tipY > right.y + 120 * s;
  if (longL) left = lc!.pt;
  if (longR) right = rc!.pt;
  // sanity: a sleeve fold runs ~25-45° (a hanging sleeve can be nearly straight down); if one side reads wrong, mirror the other side's angle
  const ok = (r: number) => (longL || longR ? Math.abs(r) <= 48 : Math.abs(r) >= 22 && Math.abs(r) <= 48);
  if (!ok(left.rot) && ok(right.rot)) left = { ...left, rot: -right.rot };
  if (!ok(right.rot) && ok(left.rot)) right = { ...right, rot: -left.rot };
  if (!ok(left.rot) && !ok(right.rot)) { left = { ...left, rot: 35 }; right = { ...right, rot: -35 }; }
  // the neckline at the center (a narrow band down the middle of the shirt)
  const band = (y: number) => { let r = 0, g = 0, bl = 0, n = 0; for (let X = Math.round(cx) - 8; X <= Math.round(cx) + 8; X++) { const p = y * W + X; if (bg[p]) continue; r += d[p * 4]; g += d[p * 4 + 1]; bl += d[p * 4 + 2]; n++; } return n >= 10 ? [r / n, g / n, bl / n] : null; };
  let neck: number | undefined;
  if (view === "back") {
    // top of the back neck: the first of the shirt down the middle
    for (let y = T; y < T + 200 * s && y < H; y++) if (band(y)) { neck = y; break; }
  } else {
    // bottom of the front neckline: where the first stretch of the body's own color starts below the collar (the rib,
    // the inside of the back, a printed tag, or the empty neck opening). When only the empty opening is seen (the rib
    // is the shirt's own color, e.g. a black Gildan 5000), the rib's ~0.75" is added
    const yb = Math.round(T + 0.3 * (B - T)); const acc = [0, 0, 0]; let m = 0; const samples: number[][] = [];
    for (let y = yb - 10; y <= yb + 10; y++) { const v = band(y); if (v) { acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2]; m++; samples.push(v); } }
    if (m) {
      const body = acc.map((v) => v / m), dist = (v: number[]) => Math.hypot(v[0] - body[0], v[1] - body[1], v[2] - body[2]);
      // a heathered or textured body varies row to row: the line between collar and chest is set above that noise
      const sd = Math.sqrt(samples.reduce((a, v) => a + dist(v) ** 2, 0) / samples.length);
      // a second, finer look when the collar is close to the body's color (an Athletic Heather onesie: grey rib, grey
      // inside of the back, nothing found the first time)
      for (const thr of [Math.max(24, 2.5 * sd + 10), Math.max(12, 1.5 * sd + 6)]) {
      if (neck != null) break;
      const off = (v: number[] | null) => !v || dist(v) > thr;
      // the first stretch of plain body below the collar (Oct 20, Nick: the Heather Mauve onesie's print sat lower than
      // the others): the last "off" row before it used to be taken, so a crease or shadow further down pushed the
      // neckline into the chest
      const end = Math.min(H, T + 170 * s), run = Math.max(8, Math.round(14 * s));
      let seenOff = false, n0 = -1, sawBg = false;
      for (let y = T; y < end; y++) {
        if (off(band(y))) { seenOff = true; continue; }
        if (!seenOff || y - T < 10 * s) continue;
        let ok = true;
        for (let k = 1; k < run && y + k < H; k++) if (off(band(y + k))) { ok = false; break; }
        if (!ok) continue;
        // ending on the empty neck opening (background) means the rib itself wasn't seen
        for (let k = 1; k <= 6 && y - k >= T; k++) if (!band(y - k)) sawBg = true;
        n0 = y + (sawBg ? Math.round(26 * s) : 0);
        break;
      }
      if (n0 >= 0 && n0 - T >= 10 * s && n0 - T <= 200 * s) neck = n0;
      }
    }
  }
  return { s, cx, top: T, mask, sleeve: { left, right }, body: { l: L[yy], r: R[yy], hem: B }, ...(neck != null ? { neck } : {}) };
}

/**
 * A bag or tote photo (white background): the body of the bag (the wide part under the handles) and its scale from the
 * bag's real width. Prints are placed on the body, centered, at real size (no shirt geometry).
 */
export function measureBag(img: HTMLImageElement, widthIn: number): Fit | null {
  const W = PHOTO_W, H = PHOTO_H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  drawContained(x, img, W, H);
  let d: Uint8ClampedArray;
  try { d = x.getImageData(0, 0, W, H).data; } catch { return null; }
  const bg = new Uint8Array(W * H);
  const light = (p: number) => Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) >= 245;
  const stack = new Int32Array(W * H);
  let sp = 0;
  const push = (p: number) => { if (!bg[p] && light(p)) { bg[p] = 1; stack[sp++] = p; } };
  for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) { const p = stack[--sp], X = p % W; if (X > 0) push(p - 1); if (X < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < W * (H - 1)) push(p + W); }
  const md = x.createImageData(W, H);
  for (let p = 0; p < W * H; p++) md.data[p * 4 + 3] = bg[p] ? 0 : 255;
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H; mc.getContext("2d")!.putImageData(md, 0, 0);
  // the bag's edges: the photos have a soft gray shadow around the bag that isn't white, so it isn't background either.
  // Count only pixels clearly darker or more colored than that shadow; a white or natural tote (nothing that strong)
  // falls back to everything that isn't the white background.
  const strong = (p: number) => { const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2]; return Math.min(r, g, b) < 205 || Math.max(r, g, b) - Math.min(r, g, b) > 28; };
  const rows = (is: (p: number) => boolean) => {
    const width = new Int16Array(H), L = new Int16Array(H).fill(-1), R = new Int16Array(H).fill(-1);
    for (let y = 0; y < H; y++) { for (let X = 0; X < W; X++) if (is(y * W + X)) { if (L[y] < 0) L[y] = X; R[y] = X; } width[y] = L[y] < 0 ? 0 : R[y] - L[y]; }
    return { width, L, R, max: Math.max(...Array.from(width)) };
  };
  let m = rows((p) => !bg[p] && strong(p));
  if (m.max < 200) m = rows((p) => !bg[p]);
  const { width, L, R, max } = m;
  if (max < 200) return null;
  // the body: rows nearly as wide as the widest (the handles are much narrower)
  let top = -1, bot = -1;
  for (let y = 0; y < H; y++) if (width[y] >= max * 0.85) { if (top < 0) top = y; bot = y; }
  if (top < 0 || bot - top < 150) return null;
  let sum = 0, n = 0;
  const ws: number[] = [];
  for (let y = top; y <= bot; y++) if (width[y] >= max * 0.85) { sum += (L[y] + R[y]) / 2; n++; ws.push(width[y]); }
  // the body's width: the typical row, not the widest (a flared opening or a soft shadow at an edge reads wider than the bag)
  ws.sort((a, b) => a - b);
  const cx = sum / n, w = ws[Math.floor(ws.length / 2)] || max, h = bot - top;
  const none = { x: cx, y: top, rot: 0 };
  return { s: 1, cx, top, mask: mc.toDataURL("image/png"), sleeve: { left: none, right: none }, flat: { cx, top, w, h, ppi: w / Math.max(4, widthIn) } };
}

/**
 * Every shirt photo shown at the same size: S&S and SanMar frame their photos differently (a PC54 sits smaller and
 * lower in its frame than a Gildan 5000), so each photo is zoomed and shifted until its measured shirt matches the
 * reference Gildan 5000 (same width, height, center and collar). Point p on the photo is drawn at z·p + t. Bags and
 * drawn tees are left as they are.
 */
export function normOf(fit: Fit | null | undefined, view: View): { z: number; tx: number; ty: number } {
  if (!fit || fit.flat || !fit.body || !(fit.s > 0)) return { z: 1, tx: 0, ty: 0 };
  const z = Math.max(0.8, Math.min(1.4, 1 / fit.s));
  return { z, tx: CENTER_X - z * fit.cx, ty: REF[view].top - z * fit.top };
}

/** Which garment photos a location shows on. */
export const viewsFor = (location: string): View[] => { const s = spotFor(location); return s.wrap ? ["front", "back"] : [s.view]; };
/** Largest width (inches) that fits the location's max print area for a design of this height/width ratio. */
export function maxWidthFor(location: string, ratio: number, b?: Body | null) { const s = spotFor(location, b); return ratio ? Math.min(s.maxW, s.maxH / ratio) : s.maxW; }

/**
 * The print areas above are for an adult Large (22" wide body, 30" long). On a smaller garment (toddler, infant,
 * youth) they scale to its body: positions move with the body (same spot on the photo), and the max print area grows
 * a bit faster than the body shrinks (prints on small garments take up more of the shirt), rounded to 1/2".
 * A 3T toddler tee (12.75" x 16.5") gets a full front of about 8.5" x 9.5".
 */
const half = (v: number) => Math.max(1, Math.round(v * 2) / 2);
const kOf = (b?: Body | null) => {
  if (!b) return null;
  const kw = b.widthIn / REF_BODY.widthIn, kl = b.lengthIn / REF_BODY.lengthIn;
  return kw >= 0.97 && kl >= 0.97 ? null : { kw, kl, gw: Math.min(1, kw * 1.2), gl: Math.min(1, kl * 1.2) };
};
function fitSpot(s: Loc, b?: Body | null): Loc {
  const k = kOf(b);
  if (!k) return s;
  const maxW = half(s.maxW * k.gw), maxH = half(s.maxH * k.gl);
  // the drop below the collar shrinks less than the shirt does: the neckline doesn't scale down with a toddler tee, so
  // a straight scale (4" × 0.55 = 2.2" on a 3T) crowds the collar. Smaller garments use the square root (~3" on a 3T).
  // A onesie's length runs down to the snaps (a 12M is 19.5" long, 9.88" wide), so its length says nothing about where
  // the chest is: an infant's drop follows its width (Oct 20, Nick: The Bottles sat in the middle of the onesie; a Full
  // Front starts about 1.75" below the collar, not 3.2").
  // (second pass, Oct 20: still ~2" low on the 12M Bottles; a onesie's full front starts about an inch below the collar)
  const dropK = b?.kind === "infant" ? k.kw * 0.6 : k.kl < 1 ? Math.sqrt(k.kl) : k.kl;
  return { ...s, dx: s.dx ? s.dx * k.kw : s.dx, drop: s.drop != null ? s.drop * dropK : s.drop, defW: Math.min(maxW, half(s.defW * k.gw)), maxW, maxH };
}
export const spotFor = (location: string, b?: Body | null): Loc => {
  const s = fitSpot(LOCATION_SPOTS[location] || { view: "front", dx: 0, drop: 3, defW: 4, maxW: 12, maxH: 14 }, b);
  // a bag or tote: never past its own print area, and centered on it (no collar to hang from)
  if (!b?.cap || s.wrap) return s;
  const maxW = Math.min(s.maxW, b.cap.maxW), maxH = Math.min(s.maxH, b.cap.maxH);
  return { ...s, maxW, maxH, defW: Math.min(s.defW, maxW), top: false };
};
/** a print's size on this garment as the adult Large it would be (the location rules are in adult inches) */
const asAdult = (b: Body | null | undefined, wIn: number, hIn: number) => { const k = kOf(b); return k ? { w: wIn / k.gw, h: hIn / k.gl, x: 1 / k.kw, y: 1 / k.kl } : { w: wIn, h: hIn, x: 1, y: 1 }; };

/**
 * A small design on a big location usually belongs on a smaller one (a 3.5" logo marked Full Front is really a left chest).
 * Returns the better locations, best first (by where it sits: dxIn = inches right of center as you look at the shirt), or [] if it fits.
 */
export function smallerSpot(location: string, wIn: number, hIn: number, dxIn = 0, b?: Body | null): string[] {
  if (!wIn) return [];
  { const a = asAdult(b, wIn, hIn); wIn = a.w; hIn = a.h; dxIn *= a.x; }
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
export function biggerSpot(location: string, wIn: number, hIn: number, b?: Body | null): string[] {
  const spot = spotFor(location, b);
  if (spot.wrap) return [];
  const opts = spot.view === "back" ? ["Medium Back", "Full Back"] : ["Medium Front", "Full Front"];
  return opts.filter((z) => { const o = spotFor(z, b); return z !== location && o.maxW >= wIn && o.maxH >= (hIn || 0) && o.maxW > spot.maxW; });
}

type Kind = "side-chest" | "center-chest" | "big" | "vertical" | "bottom" | "yoke";
const KIND: Record<string, Kind> = {
  "Left Chest": "side-chest", "Right Chest": "side-chest", Pocket: "side-chest", "Center Chest": "center-chest",
  "Full Front": "big", "Medium Front": "big", "Across Chest": "big", "Left Vertical": "vertical", "Right Vertical": "vertical",
  "Front Bottom Left": "bottom", "Front Bottom Right": "bottom", "Full Back": "big", "Medium Back": "big", "Across Shoulders": "big", "Upper Back (Yoke)": "yoke",
};
const fits = (z: string, wIn: number, hIn: number) => { const s = LOCATION_SPOTS[z]; return !!s && wIn <= s.maxW + 0.01 && hIn <= s.maxH + 0.01; };

/**
 * The location a print is, from where it sits and how big it is (no questions asked):
 * a small logo off to one side is a left/right chest, centered it's a center chest, bigger is a medium/full front, etc.
 * dxIn = inches from center to the art's middle (+ = right as you look at the shirt), topIn = inches from the collar to the art's top.
 * The current location is kept whenever it's the same kind of spot and the print still fits it (a Full Front stays a Full Front).
 */
export function autoSpot(current: string, view: View, dxIn: number, topIn: number, wIn: number, hIn: number, b?: Body | null): string {
  const cur = LOCATION_SPOTS[current];
  if (!cur || cur.wrap) return current;
  // judged in adult inches: on a toddler tee a 3" logo off to the side is still a left chest
  { const a = asAdult(b, wIn, hIn); wIn = a.w; hIn = a.h; dxIn *= a.x; topIn *= a.y; }
  const side = dxIn >= 0 ? "Left" : "Right"; // right of center as you look = the wearer's left
  const off = Math.abs(dxIn);
  let z: string;
  if (view === "back") {
    if (wIn <= 4 && hIn <= 4 && topIn < 3.5) z = "Upper Back (Yoke)";
    else if (wIn > 8 && hIn <= 4 && topIn < 4) z = "Across Shoulders";
    else if (wIn <= 8 && hIn <= 8) z = "Medium Back";
    else z = "Full Back";
  } else {
    const mid = topIn + hIn / 2;
    if (wIn <= 5 && hIn <= 6 && mid > 17 && off >= 1.75) z = `Front Bottom ${side}`;
    else if (wIn <= 5 && hIn <= 5) z = off >= 1.75 ? (current === "Pocket" && fits("Pocket", wIn, hIn) ? "Pocket" : `${side} Chest`) : "Center Chest";
    else if (wIn <= 5 && off >= 2) z = `${side} Vertical`;
    else if (wIn > 8 && hIn <= 4) z = "Across Chest";
    else if (wIn <= 8 && hIn <= 8) z = "Medium Front";
    else z = "Full Front";
  }
  // same kind of spot on the same side, and it still fits: keep what was chosen
  const sameSide = (a: string, b: string) => (/Left/.test(a) === /Left/.test(b) && /Right/.test(a) === /Right/.test(b)) || KIND[a] === "big";
  if (cur.view === view && KIND[current] === KIND[z] && sameSide(current, z) && fits(current, wIn, hIn)) return current;
  return fits(z, wIn, hIn) ? z : view === "back" ? "Full Back" : "Full Front";
}

/** The biggest a print can go on this side of the shirt (any location there), for a design of this height/width ratio. */
export function sideMaxWidth(location: string, ratio: number, b?: Body | null) {
  const s = spotFor(location, b);
  if (s.wrap) return maxWidthFor(location, ratio, b);
  return Math.max(...Object.keys(LOCATION_SPOTS).filter((z) => !LOCATION_SPOTS[z].wrap && LOCATION_SPOTS[z].view === s.view).map((z) => maxWidthFor(z, ratio, b)));
}

/** Width in inches from the imprint's print size ("11\" wide", "4\" tall", "MAX wide") and the design's proportions. */
export function printWidth(size: string, location: string, ratio: number, b?: Body | null): number {
  const spot = spotFor(location, b);
  const s = (size || "").trim();
  // MAX: as big as fits the location's max print area
  if (/^max/i.test(s)) return ratio ? Math.min(spot.maxW, spot.maxH / ratio) : spot.maxW;
  const m = s.match(/^([\d.]+)/);
  if (!m) return spot.defW;
  const v = +m[1];
  const w = /tall/i.test(s) ? (ratio ? v / ratio : v) : v;
  // never bigger than the location's max print area
  return Math.min(w, maxWidthFor(location, ratio, b));
}

/** Top-left of a design on the photo, before any hand adjustment. With a Fit, it's placed on that photo's measured shirt. */
export function basePlacement(location: string, wIn: number, ratio: number, dropIn: number | null, scale: number, view?: View, fit?: Fit | null, b?: Body | null) {
  const spot = spotFor(location, b);
  const k = fit?.s || 1;
  if (spot.wrap) {
    // centered on the sleeve's outer fold; half of it shows on this photo
    const hf = spot.wrap[view || "front"];
    const pt = fit ? fit.sleeve[hf.x > PHOTO_W / 2 ? "right" : "left"] : hf;
    const ppi0 = PX_PER_IN * scale * k, w0 = wIn * ppi0, h0 = ratio ? w0 * ratio : w0, a0 = spot.maxW * ppi0, b0 = spot.maxH * ppi0;
    return { view: view || "front", x: pt.x - w0 / 2, y: pt.y - h0 / 2, w: w0, h: h0, rot: pt.rot, clip: hf.show, area: { x: pt.x - a0 / 2, y: pt.y - b0 / 2, w: a0, h: b0 }, k };
  }
  if (fit?.flat) {
    // a bag: centered on its body (or the set drop below the body's top), at real size from the bag's width
    const f = fit.flat, p = f.ppi, w = wIn * p, h = ratio ? w * ratio : w;
    const x = f.cx - w / 2 + (spot.dx || 0) * p, y = dropIn != null ? f.top + dropIn * p : f.top + Math.max(0, (f.h - h) / 2);
    const area = { x: f.cx - f.w / 2 + p, y: f.top + p, w: Math.max(p, f.w - 2 * p), h: Math.max(p, f.h - 2 * p) };
    return { view: spot.view, x, y, w, h, rot: 0, clip: "" as "" | "left" | "right", area, k: p / (PX_PER_IN * scale) };
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
  // down from this photo's neckline when it was found (the same distance on every shirt), else from the collar top
  const mx = (v: number) => (fit ? fit.cx + (v - CENTER_X) * k : v), my = (v: number) => (fit ? (fit.neck != null ? fit.neck + (v - REF_NECK[spot.view]) * k : fit.top + (v - REF[spot.view].top) * k) : v);
  return { view: spot.view, x: mx(cx - w / 2), y: my(artY), w: w * k, h: h * k, rot: 0, clip: "" as "" | "left" | "right", area: { x: mx(cx - aw / 2), y: my(top), w: aw * k, h: ah * k }, k };
}

/**
 * Shirt colors (Gildan / Bella+Canvas / Next Level names), close to the blanks: the shirt pickers and mockups use
 * these. Grouped for the pickers.
 */
export const SHIRT_COLORS: { group: string; colors: [string, string][] }[] = [
  { group: "Whites & neutrals", colors: [["White", "#ffffff"], ["Natural", "#efe6d2"], ["Cream", "#f3ead2"], ["Sand", "#d8c9a8"], ["Tan", "#c3a77f"], ["Ash", "#dcdcd8"], ["Ice Grey", "#c9cbc9"], ["Sport Grey", "#b9bcbf"], ["Athletic Heather", "#a8aaad"], ["Graphite Heather", "#6f7175"], ["Dark Heather", "#4b4d52"], ["Charcoal", "#44464a"], ["Black", "#1b1b1b"]] },
  { group: "Yellows & oranges", colors: [["Cornsilk", "#f3e7a1"], ["Yellow Haze", "#f1df7c"], ["Daisy", "#f7d117"], ["Safety Green (neon)", "#d6ef3c"], ["Gold", "#f1a91c"], ["Old Gold", "#c4a15a"], ["Safety Orange", "#ff6a13"], ["Orange", "#f26522"], ["Texas Orange", "#bf5700"], ["Burnt Orange", "#cc5500"]] },
  { group: "Reds & pinks", colors: [["Light Pink", "#f4c6d1"], ["Azalea", "#f27aa9"], ["Safety Pink", "#ff5aa5"], ["Heliconia", "#e03c8a"], ["Coral Silk", "#f56f6c"], ["Red", "#c8102e"], ["Cherry Red", "#b5182c"], ["Cardinal Red", "#8c1d2b"], ["Antique Cherry Red", "#97233f"], ["Garnet", "#7a1d2e"], ["Maroon", "#6b1f33"]] },
  { group: "Blues", colors: [["Light Blue", "#a9c9e8"], ["Carolina Blue", "#77a7d8"], ["Sky", "#7fc3e8"], ["Sapphire", "#0f80c1"], ["Iris", "#3b6db3"], ["Royal", "#1d4f9c"], ["Indigo Blue", "#3a5a78"], ["Heather Navy", "#3b4256"], ["Navy", "#1f2a44"], ["Teal", "#00808a"], ["Jade Dome", "#14806f"]] },
  { group: "Greens", colors: [["Mint Green", "#a9dcc0"], ["Lime", "#8cc63f"], ["Electric Green", "#3dbb4a"], ["Irish Green", "#1f9a4f"], ["Kelly Green", "#1f9a4f"], ["Military Green", "#5e6145"], ["Forest Green", "#1f3d2b"]] },
  { group: "Purples & browns", colors: [["Orchid", "#c9a3cf"], ["Violet", "#8a74b5"], ["Purple", "#4b2a7b"], ["Brown Savana", "#8b6f56"], ["Russet", "#6d3b2b"], ["Dark Chocolate", "#3b2a24"]] },
];
const NAMED: Record<string, string> = Object.fromEntries(SHIRT_COLORS.flatMap((g) => g.colors.map(([n, h]) => [n.toLowerCase(), h])));
const NAMED_LONGEST = () => Object.keys(NAMED).sort((a, b) => b.length - a.length);
/** a color name's color: exact, then without "heather"/(…), then any known color named inside it ("True Royal" → Royal) */
export const guessHex = (color: string): string => {
  // two-tone names ("White/ Royal", "White - Kelly", "Heather/Navy"): the body is the first color, the trim the second
  // (Oct 20: a White/ Royal raglan's close-ups were drawn on royal blue)
  const parts = (color || "").split(/\s*(?:\/|\s-\s)\s*/).filter(Boolean);
  if (parts.length > 1) return guessHex(parts[0]);
  const c = (color || "").toLowerCase().trim().replace(/([a-z])([A-Z])/g, "$1 $2");
  const spaced = (color || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return NAMED[c] || NAMED[spaced] || NAMED[spaced.replace(/\s*\(.*\)|heather\s*/g, "").trim()]
    || NAMED[NAMED_LONGEST().find((k) => new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(spaced)) || ""] || "#9aa1ab";
};
/** a shirt color name's color, when it's one we know (else null) */
export const shirtHex = (color: string): string | null => NAMED[(color || "").toLowerCase().trim()] || null;

/**
 * Heathered shirt colors (Oct 16, Nick: "athletic heather should look like it's heathered"): blends of white or dark
 * fibers with the color (Athletic Heather, Sport Grey, Ash, Heather Navy, tri-blends, oatmeal…). Drawn with fine
 * light and dark flecks over the color, the way the knit looks.
 */
export const isHeather = (color: string) => /heather|\bhthr\b|athletic|sport gr[ae]y|\bash\b|ice gr[ae]y|tri-?blend|triblend|marble|melange|oatmeal|\bcvc\b|vintage (black|navy|royal|red)/i.test(color || "");
/** the flecks: an SVG filter (light fibers from one noise channel, dark ones from another), `k` = fleck size scale */
const heatherFx = (id: string, k = 1) => `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(0.12 / k).toFixed(3)} ${(1.4 / k).toFixed(3)}" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.6 0 0 0 -1.25" result="lite"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -2.6 0 0 1.2" result="dark"/><feMerge><feMergeNode in="dark"/><feMergeNode in="lite"/></feMerge></filter>`;
/** a heather tile (CSS background-image) for a color; light colors get darker flecks, dark ones lighter */
export function heatherTile(hex: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><defs>${heatherFx("h")}</defs><rect width="140" height="140" fill="${hex}"/><rect width="140" height="140" filter="url(#h)" opacity=".4"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
/** CSS background for a shirt color: flat, or heathered */
export const shirtBg = (color: string, hex = guessHex(color)) => (isHeather(color) ? `${heatherTile(hex)} 0 0 / 140px 140px, ${hex}` : hex);

/** Plain tee outline for garments without S&S photos (heathered when the color is a heather). */
export function teeSvg(hex: string, view: View, heather = false) {
  const neck = view === "front" ? "M420 110 Q500 175 580 110" : "M430 100 Q500 130 570 100";
  const body = `M405 105 L250 150 L60 390 L180 470 L245 410 L245 1120 L755 1120 L755 410 L820 470 L940 390 L750 150 L595 105 Q500 ${view === "front" ? 175 : 130} 405 105 Z`;
  const fx = heather ? `<defs>${heatherFx("h", 2)}<clipPath id="t"><path d="${body}"/></clipPath></defs>` : "";
  const flecks = heather ? `<rect width="1000" height="1250" filter="url(#h)" opacity=".4" clip-path="url(#t)"/>` : "";
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1250">${fx}<rect width="1000" height="1250" fill="#ffffff"/><path d="${body}" fill="${hex}"/>${flecks}<path d="${body}" fill="none" stroke="#00000033" stroke-width="4"/><path d="${neck}" fill="none" stroke="#00000044" stroke-width="6"/></svg>`)}`;
}

/** Same-origin link to an S&S photo (so it can be drawn into the saved mockup). */
export const ssImg = (path: string) => (!path ? "" : /^https?:\/\/[\w.-]*sanmar\.com\//i.test(path) ? `/api/ss/img?u=${encodeURIComponent(path)}` : `/api/ss/img?p=${encodeURIComponent(path.replace(/^https?:\/\/[^/]+\//, ""))}`);
