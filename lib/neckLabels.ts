/**
 * Neck labels (Oct 20, Nick): "we go into a garment, we take the manufacturer's tag, we either tear it out or cut it
 * out, and then we print in custom art for the client that has their brand… each size gets its own neck label…
 * sometimes the art can change based on material count" (a 60/40 label and a generic one).
 *
 * A customer keeps label sets (customers.neck_labels). A set's art is either one file per size, or one design with the
 * size dropped into a box on it. Printing them is part of Private Label (Remove MFG Tags) at $1/pc: no extra screens.
 * On orders, a group with Private Label picks a set (Group.neckLabel); the mockup gets a drawn inside-the-neck view.
 */
import { ADULT_SIZES, BABY_SIZES, TODDLER_SIZES, YOUTH_SIZES, type Group } from "@/lib/pricing";

export type NeckFile = { path: string; name: string; type: string; /** a PNG of a PDF / AI / EPS made when it was uploaded (the file itself is kept as is) */ preview?: string };
export type NeckLabelSet = {
  id: string;
  /** e.g. "Tee label" or "Peticolas 60/40" */
  name: string;
  /** the fabric content it's for ("60% cotton / 40% polyester"), blank for a generic one */
  content?: string;
  /**
   * "one" (Oct 21, Nick: "just make it simple… upload one tag… or all the tags"): one file for every size (`template`),
   * with a file of its own for any size that has one (`files`). Older sets: a file per size, or one design with the
   * size dropped in.
   */
  mode: "one" | "per_size" | "template";
  files?: Partial<Record<string, NeckFile>>;
  template?: NeckFile;
  /** where the size goes on the template (fractions of the art: x, y, w, h) */
  sizeBox?: { x: number; y: number; w: number; h: number };
  /** the ink it's printed in (blank: light gray on every shirt, the shop's usual) */
  ink?: string;
  /** printed width, inches */
  widthIn?: number;
  note?: string;
  archived?: boolean;
  at?: string; by?: string;
};

export const SIZE_GROUPS: { label: string; sizes: readonly string[] }[] = [
  { label: "Adult", sizes: ADULT_SIZES },
  { label: "Youth", sizes: YOUTH_SIZES },
  { label: "Toddler", sizes: TODDLER_SIZES },
  { label: "Infant", sizes: BABY_SIZES },
];

export const isPicture = (f?: NeckFile | null) => !!f && (!!f.preview || /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
/** the picture to draw: the PNG made from a PDF / AI / EPS, else the file */
export const picturePath = (f: NeckFile) => f.preview || f.path;
/** the shop's usual tag ink: one light gray on every shirt color */
export const TAG_GRAY = "#c4c4c4";

/** the file a size prints from (per size: its own; template: the design) */
export const labelFileFor = (set: NeckLabelSet, size: string): NeckFile | null =>
  set.mode === "one" ? set.files?.[size] || set.template || null : set.mode === "template" ? set.template || null : set.files?.[size] || null;

/** sizes this set has art for (a template covers every size) */
export const sizesWithArt = (set: NeckLabelSet): string[] =>
  set.mode === "template" || set.mode === "one" ? (set.template ? SIZE_GROUPS.flatMap((g) => [...g.sizes]) : []) : Object.keys(set.files || {}).filter((z) => set.files?.[z]);

export const DEFAULT_BOX = { x: 0.3, y: 0.72, w: 0.4, h: 0.22 };

const hexRgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const isDarkHex = (h: string) => { const [r, g, b] = hexRgb(h); return 0.299 * r + 0.587 * g + 0.114 * b < 140; };

/**
 * The label as it prints: the art read as one color (dark marks on white, or the shapes of a transparent PNG) in the ink
 * color, with the size written in its box when it's a template. A canvas, transparent where nothing prints.
 */
export function labelCanvas(img: HTMLImageElement, set: NeckLabelSet, size: string, inkHex: string): HTMLCanvasElement {
  const iw = img.naturalWidth || 600, ih = img.naturalHeight || 600, k = Math.min(1, 900 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  if (set.mode === "template") {
    const b = set.sizeBox || DEFAULT_BOX;
    x.save();
    x.fillStyle = "#000"; x.textAlign = "center"; x.textBaseline = "middle";
    let fs = b.h * h * 0.9;
    x.font = `800 ${fs}px Helvetica, Arial, sans-serif`;
    const maxW = b.w * w * 0.95, tw = x.measureText(size).width;
    if (tw > maxW) { fs *= maxW / tw; x.font = `800 ${fs}px Helvetica, Arial, sans-serif`; }
    x.fillText(size, (b.x + b.w / 2) * w, (b.y + b.h / 2) * h);
    x.restore();
  }
  const d = x.getImageData(0, 0, w, h), p = d.data;
  // a transparent PNG prints its shapes; a flat file prints its dark marks
  let clear = 0;
  for (let i = 3; i < p.length; i += 16) if (p[i] < 128) clear++;
  const usesAlpha = clear > p.length / 16 * 0.1;
  // dark art on a clear background with white inside it (Furry Feline's "SMALL" in white on a black bar, Oct 21, Nick:
  // "that should be a knockout"): the white is a knockout, as on a flat file. Art that's mostly light or colored on clear
  // (white ink art for dark shirts) still prints its shapes.
  let dark = 0, solid = 0;
  if (usesAlpha) for (let i = 0; i < p.length; i += 16) if (p[i + 3] > 128) { solid++; if (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] < 90) dark++; }
  const knock = usesAlpha && solid > 0 && dark / solid > 0.4;
  const [r, g, bl] = hexRgb(inkHex);
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3] / 255, lum = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
    // the size text is drawn black on the template, so it prints even on a transparent design
    const m = usesAlpha && !knock ? (lum < 0.08 && a > 0.5 ? 1 : a) : a * (1 - lum);
    p[i] = r; p[i + 1] = g; p[i + 2] = bl; p[i + 3] = Math.round(Math.max(0, Math.min(1, m)) * 255);
  }
  x.putImageData(d, 0, 0);
  return c;
}

const shade = (hex: string, f: number) => { const [r, g, b] = hexRgb(hex); const t = (v: number) => Math.round(Math.max(0, Math.min(255, f < 0 ? v * (1 + f) : v + (255 - v) * f))); return `rgb(${t(r)},${t(g)},${t(b)})`; };

/**
 * The inside of the back neck, drawn (most supplier photos don't show it): the shirt color, the back collar band and its
 * seam across the top, a trimmed stub where the maker's tag was cut out, and the label printed below the seam.
 * w × h in px; the view is about 6" across, so the label is drawn at its real width.
 */
export function drawNeckView(x: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, shirtHex: string, label: HTMLCanvasElement | null, widthIn = 2.5, caption?: string) {
  const ppi = w / 6;
  x.save();
  x.beginPath(); x.roundRect(ox, oy, w, h, Math.min(w, h) * 0.06); x.clip();
  // the inside of the shirt, a little darker toward the edges
  const g = x.createRadialGradient(ox + w / 2, oy + h * 0.45, w * 0.1, ox + w / 2, oy + h * 0.45, w * 0.75);
  g.addColorStop(0, shade(shirtHex, 0.04)); g.addColorStop(1, shade(shirtHex, -0.14));
  x.fillStyle = g; x.fillRect(ox, oy, w, h);
  // the neck opening above the back collar (dark, the space you look through)
  const top = oy + h * 0.2, sag = h * 0.07;
  x.fillStyle = shade(shirtHex, -0.55);
  x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + w, oy); x.lineTo(ox + w, top - sag * 0.2); x.quadraticCurveTo(ox + w / 2, top + sag, ox, top - sag * 0.2); x.closePath(); x.fill();
  // the collar band (rib), a curved strip
  const band = h * 0.1;
  x.fillStyle = shade(shirtHex, -0.08);
  x.beginPath(); x.moveTo(ox, top - sag * 0.2); x.quadraticCurveTo(ox + w / 2, top + sag, ox + w, top - sag * 0.2);
  x.lineTo(ox + w, top - sag * 0.2 + band); x.quadraticCurveTo(ox + w / 2, top + sag + band, ox, top - sag * 0.2 + band); x.closePath(); x.fill();
  // rib lines
  x.strokeStyle = shade(shirtHex, -0.16); x.lineWidth = Math.max(0.5, w / 600);
  for (let i = 1; i < 30; i++) { const t = i / 30, px = ox + t * w, py = top - sag * 0.2 + 2 * sag * 0.6 * t * (1 - t) * 2; x.beginPath(); x.moveTo(px, py + 1); x.lineTo(px, py + band - 1); x.stroke(); }
  // the seam under the band, with its stitching
  x.strokeStyle = shade(shirtHex, -0.28); x.lineWidth = Math.max(1, w / 260);
  x.beginPath(); x.moveTo(ox, top - sag * 0.2 + band); x.quadraticCurveTo(ox + w / 2, top + sag + band, ox + w, top - sag * 0.2 + band); x.stroke();
  x.setLineDash([w / 90, w / 140]); x.strokeStyle = shade(shirtHex, isDarkHex(shirtHex) ? 0.25 : -0.35); x.lineWidth = Math.max(0.6, w / 500);
  x.beginPath(); x.moveTo(ox, top - sag * 0.2 + band + w / 90); x.quadraticCurveTo(ox + w / 2, top + sag + band + w / 90, ox + w, top - sag * 0.2 + band + w / 90); x.stroke();
  x.setLineDash([]);
  // the maker's tag, cut out: a short trimmed stub at the seam
  const seamY = top + sag * 0.55 + band, sw = w * 0.07;
  x.fillStyle = "rgba(240,240,236,0.92)"; x.fillRect(ox + w / 2 - sw / 2, seamY - h * 0.005, sw, h * 0.018);
  x.strokeStyle = "rgba(0,0,0,0.18)"; x.lineWidth = 1; x.strokeRect(ox + w / 2 - sw / 2, seamY - h * 0.005, sw, h * 0.018);
  // the printed label, centered a bit below the seam
  if (label) {
    const lw = Math.min(w * 0.8, widthIn * ppi), lh = lw * (label.height / label.width);
    const ly = seamY + Math.max(h * 0.06, 0.35 * ppi);
    x.globalAlpha = 0.94; x.drawImage(label, ox + (w - lw) / 2, ly, lw, Math.min(lh, oy + h - ly - h * 0.04)); x.globalAlpha = 1;
  }
  x.restore();
  // a hairline frame and the caption under it
  x.save();
  x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = 1; x.beginPath(); x.roundRect(ox + 0.5, oy + 0.5, w - 1, h - 1, Math.min(w, h) * 0.06); x.stroke();
  if (caption) {
    x.fillStyle = "#4A566B"; x.font = `600 ${Math.max(10, w / 22)}px Helvetica, Arial, sans-serif`; x.textAlign = "center";
    x.fillText(caption, ox + w / 2, oy + h + Math.max(14, w / 15));
  }
  x.restore();
}

/** the set a group prints: the one picked, else the customer's only set */
export function setFor(sets: NeckLabelSet[] | null | undefined, id?: string): NeckLabelSet | null {
  const live = (sets || []).filter((s) => s && !s.archived);
  return live.find((s) => s.id === id) || (live.length === 1 ? live[0] : null);
}

/** the Private Label finishing (cut the maker's tag out, print theirs): by id on the lists, or by its name on a custom list */
export const isRelabel = (f: { id: string; name: string }) => f.id === "relabel" || /private label|remove .*tag|relabel|neck label/i.test(f.name);

/** the size shown in the inside-neck preview: the size this group has the most of, else M */
export function mainSize(groups: Group[]): string {
  const n: Record<string, number> = {};
  for (const g of groups) for (const l of g.lines) for (const [z, q] of Object.entries(l.sizes || {})) n[z] = (n[z] || 0) + (+(q as number) || 0);
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || "M";
}

