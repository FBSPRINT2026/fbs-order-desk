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
type Loc = { view: View; dx?: number; drop?: number; abs?: { x: number; y: number }; rot?: number; defW: number; maxW: number; maxH: number;
  /** sleeve prints wrap over the sleeve: part shows on the front photo, the rest on the back photo */
  wrap?: { front: Half; back: Half } };

/** Where each order-form location sits (dx = inches right of center as you look at the shirt; drop = inches below the collar). */
export const LOCATION_SPOTS: Record<string, Loc> = {
  // max print areas from the FBS apparel placement guide (width x height)
  "Full Front": { view: "front", dx: 0, drop: 4, defW: 11, maxW: 12, maxH: 14 },
  "Medium Front": { view: "front", dx: 0, drop: 3, defW: 8, maxW: 8, maxH: 8 },
  "Center Chest": { view: "front", dx: 0, drop: 3, defW: 4.5, maxW: 5, maxH: 5 },
  "Across Chest": { view: "front", dx: 0, drop: 3, defW: 11, maxW: 12, maxH: 4 },
  "Left Chest": { view: "front", dx: 4.5, drop: 3, defW: 3.5, maxW: 5, maxH: 5 },
  "Right Chest": { view: "front", dx: -4.5, drop: 3, defW: 3.5, maxW: 5, maxH: 5 },
  Pocket: { view: "front", dx: 4.5, drop: 5, defW: 3, maxW: 4, maxH: 4 },
  // wearer's left sleeve is on the right of the front photo and the left of the back photo
  // Measured on the S&S photos: the sleeve's outer edge (the fold) runs at ~35° and the hem is square to it.
  // The print is centered right on that edge, 2.5" up from the sleeve tip, so the cut from front to back lands where the shirt meets the white background.
  "Left Sleeve": { view: "front", defW: 3, maxW: 3.5, maxH: 3.5, wrap: { front: { x: 904, y: 335, rot: -35, show: "left" }, back: { x: 100, y: 335, rot: 35, show: "right" } } },
  "Right Sleeve": { view: "front", defW: 3, maxW: 3.5, maxH: 3.5, wrap: { front: { x: 95, y: 335, rot: 35, show: "right" }, back: { x: 900, y: 335, rot: -35, show: "left" } } },
  "Left Vertical": { view: "front", dx: 4.5, drop: 4, defW: 4, maxW: 5, maxH: 14 },
  "Right Vertical": { view: "front", dx: -4.5, drop: 4, defW: 4, maxW: 5, maxH: 14 },
  "Front Bottom Left": { view: "front", dx: 4.5, drop: 21.5, defW: 4.5, maxW: 5, maxH: 6 },
  "Front Bottom Right": { view: "front", dx: -4.5, drop: 21.5, defW: 4.5, maxW: 5, maxH: 6 },
  "Full Back": { view: "back", dx: 0, drop: 4, defW: 12, maxW: 12, maxH: 14 },
  "Medium Back": { view: "back", dx: 0, drop: 4, defW: 8, maxW: 8, maxH: 8 },
  "Upper Back (Yoke)": { view: "back", dx: 0, drop: 2, defW: 3.5, maxW: 4, maxH: 4 },
  "Across Shoulders": { view: "back", dx: 0, drop: 2.5, defW: 12, maxW: 14, maxH: 4 },
};
/** Which garment photos a location shows on. */
export const viewsFor = (location: string): View[] => { const s = spotFor(location); return s.wrap ? ["front", "back"] : [s.view]; };
/** Largest width (inches) that fits the location's max print area for a design of this height/width ratio. */
export function maxWidthFor(location: string, ratio: number) { const s = spotFor(location); return ratio ? Math.min(s.maxW, s.maxH / ratio) : s.maxW; }
export const spotFor = (location: string): Loc => LOCATION_SPOTS[location] || { view: "front", dx: 0, drop: 3, defW: 4, maxW: 12, maxH: 14 };

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

/** Top-left of a design on the photo, before any hand adjustment. */
export function basePlacement(location: string, wIn: number, ratio: number, dropIn: number | null, scale: number, view?: View) {
  const spot = spotFor(location);
  if (spot.wrap) {
    // centered on the sleeve's outer fold; half of it shows on this photo
    const hf = spot.wrap[view || "front"];
    const ppi0 = PX_PER_IN * scale, w0 = wIn * ppi0, h0 = ratio ? w0 * ratio : w0, a0 = spot.maxW * ppi0, b0 = spot.maxH * ppi0;
    return { view: view || "front", x: hf.x - w0 / 2, y: hf.y - h0 / 2, w: w0, h: h0, rot: hf.rot, clip: hf.show, area: { x: hf.x - a0 / 2, y: hf.y - b0 / 2, w: a0, h: b0 } };
  }
  const ppi = PX_PER_IN * scale;
  const w = wIn * ppi;
  const h = ratio ? w * ratio : w;
  const aw = spot.maxW * ppi, ah = spot.maxH * ppi;
  // sleeves sit on an angle to follow the sleeve hem
  if (spot.abs) return { view: spot.view, x: spot.abs.x - w / 2, y: spot.abs.y - h / 2, w, h, rot: spot.rot || 0, clip: "" as "" | "left" | "right", area: { x: spot.abs.x - aw / 2, y: spot.abs.y - ah / 2, w: aw, h: ah } };
  const cx = CENTER_X + (spot.dx || 0) * ppi;
  const top = COLLAR_Y[spot.view] + (dropIn ?? spot.drop ?? 3) * ppi;
  return { view: spot.view, x: cx - w / 2, y: top, w, h, rot: 0, clip: "" as "" | "left" | "right", area: { x: cx - aw / 2, y: top, w: aw, h: ah } };
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
