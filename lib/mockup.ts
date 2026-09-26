/**
 * Mockup geometry. Garment photos from S&S are 1000 x 1250 (front and back, flat).
 * Everything here is in that 1000-wide coordinate space.
 * Calibrated on the Gildan 5000 photos (shirt on a form): a full-front 11" x 16" print area and 13.5" x 18" max
 * land where they do on a real shirt at ~34 px per inch.
 */
export const PHOTO_W = 1000;
export const PHOTO_H = 1250;
export const PX_PER_IN = 34;
export const CENTER_X = 499;
export const COLLAR_Y = { front: 128, back: 100 } as const;

export type View = "front" | "back";
type Loc = { view: View; dx?: number; drop?: number; abs?: { x: number; y: number }; defW: number; maxW: number; maxH: number };

/** Where each order-form location sits (dx = inches right of center as you look at the shirt; drop = inches below the collar). */
export const LOCATION_SPOTS: Record<string, Loc> = {
  "Full Front": { view: "front", dx: 0, drop: 3, defW: 11, maxW: 13.5, maxH: 18 },
  "Left Chest": { view: "front", dx: 4, drop: 3, defW: 3.5, maxW: 4.5, maxH: 4.5 },
  "Right Chest": { view: "front", dx: -4, drop: 3, defW: 3.5, maxW: 4.5, maxH: 4.5 },
  Pocket: { view: "front", dx: 4, drop: 5, defW: 3, maxW: 4, maxH: 4 },
  "Left Sleeve": { view: "front", abs: { x: 825, y: 385 }, defW: 3, maxW: 3.5, maxH: 3.5 },
  "Right Sleeve": { view: "front", abs: { x: 175, y: 385 }, defW: 3, maxW: 3.5, maxH: 3.5 },
  "Full Back": { view: "back", dx: 0, drop: 4, defW: 12, maxW: 13.5, maxH: 18 },
  "Upper Back (Yoke)": { view: "back", dx: 0, drop: 1.5, defW: 10, maxW: 13.5, maxH: 4 },
};
export const spotFor = (location: string): Loc => LOCATION_SPOTS[location] || { view: "front", dx: 0, drop: 3, defW: 4, maxW: 13.5, maxH: 18 };

/** Width in inches from the imprint's print size ("11\" wide", "4\" tall", "MAX wide") and the design's proportions. */
export function printWidth(size: string, location: string, ratio: number): number {
  const spot = spotFor(location);
  const s = (size || "").trim();
  // MAX: as big as fits the location's max print area
  if (/^max/i.test(s)) return ratio ? Math.min(spot.maxW, spot.maxH / ratio) : spot.maxW;
  const m = s.match(/^([\d.]+)/);
  if (!m) return spot.defW;
  const v = +m[1];
  if (/tall/i.test(s)) return ratio ? v / ratio : v;
  return v;
}

/** Top-left of a design on the photo, before any hand adjustment. */
export function basePlacement(location: string, wIn: number, ratio: number, dropIn: number | null, scale: number) {
  const spot = spotFor(location);
  const ppi = PX_PER_IN * scale;
  const w = wIn * ppi;
  const h = ratio ? w * ratio : w;
  const aw = spot.maxW * ppi, ah = spot.maxH * ppi;
  if (spot.abs) return { view: spot.view, x: spot.abs.x - w / 2, y: spot.abs.y - h / 2, w, h, area: { x: spot.abs.x - aw / 2, y: spot.abs.y - ah / 2, w: aw, h: ah } };
  const cx = CENTER_X + (spot.dx || 0) * ppi;
  const top = COLLAR_Y[spot.view] + (dropIn ?? spot.drop ?? 3) * ppi;
  return { view: spot.view, x: cx - w / 2, y: top, w, h, area: { x: cx - aw / 2, y: top, w: aw, h: ah } };
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
