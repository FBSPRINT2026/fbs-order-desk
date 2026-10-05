import type { VArt } from "./svgVector";

/**
 * A background layer in vector art: stock art (vectorstock, Freepik…) usually sits on a page-size rectangle of
 * cream / white / a color, at the very bottom of the file. It isn't part of the design and shouldn't print. Found as
 * the bottom shapes (drawn first) that are one flat color and cover the whole page or everything else in the art.
 * Taking them out is lossless: the rest of the shapes stay exactly as they are. Shapes of the same color higher up
 * (highlights, glints) are art and stay.
 */
export type Backdrop = { idx: number[]; hex: string; name: string; what: string };

const box = (ops: string) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const l of ops.trim().split("\n")) {
    const p = l.trim().split(/\s+/); p.pop();
    for (let i = 0; i + 1 < p.length; i += 2) { const x = +p[i], y = +p[i + 1]; if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  }
  return { x0: a, y0: b, x1: c, y1: d };
};
const area = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

export function findBackdrop(v: VArt | null): Backdrop | null {
  if (!v?.ok || v.shapes.length < 2) return null;
  const page = { x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h };
  const idx: number[] = [];
  for (let i = 0; i < Math.min(4, v.shapes.length - 1); i++) {
    const s = v.shapes[i];
    if (s.grad || s.ink) break; // a gradient or a spot swatch: the designer meant it
    const b = box(s.ops);
    // everything above it
    const rest = v.shapes.slice(i + 1).map((t) => box(t.ops)).reduce((m, r) => ({ x0: Math.min(m.x0, r.x0), y0: Math.min(m.y0, r.y0), x1: Math.max(m.x1, r.x1), y1: Math.max(m.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const coversPage = area(b) >= 0.9 * area(page);
    const pad = 0.01 * Math.max(v.w, v.h);
    const coversArt = b.x0 <= rest.x0 + pad && b.y0 <= rest.y0 + pad && b.x1 >= rest.x1 - pad && b.y1 >= rest.y1 - pad && area(b) >= 1.05 * area(rest);
    // a plain box (a handful of points), not an outline of the design
    const simple = s.ops.trim().split("\n").length <= 12;
    if (!(coversPage || (coversArt && simple))) break;
    if (idx.length && s.fill !== v.shapes[idx[0]].fill) break;
    idx.push(i);
  }
  if (!idx.length) return null;
  const hex = v.shapes[idx[0]].fill;
  return { idx, hex, name: colorWord(hex), what: idx.length === 1 ? "one box behind the art" : `${idx.length} boxes behind the art` };
}

export const withoutBackdrop = (v: VArt, b: Backdrop | null): VArt => (b ? { ...v, shapes: v.shapes.filter((_, i) => !b.idx.includes(i)) } : v);

/** a plain word for a background color: white, cream, light gray, black, light blue… */
export function colorWord(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, c = (mx - mn) / 255;
  let h = mx === mn ? 0 : mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? ((b - r) / (mx - mn)) * 60 + 120 : ((r - g) / (mx - mn)) * 60 + 240;
  if (h < 0) h += 360;
  // warm off-white (paper, parchment): cream
  if (l > 0.85 && c >= 0.03 && h >= 25 && h <= 70) return "cream";
  if (c < 0.06) return l > 0.96 ? "white" : l > 0.75 ? "light gray" : l > 0.2 ? "gray" : "black";
  const hue = h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 70 ? "yellow" : h < 165 ? "green" : h < 200 ? "teal" : h < 255 ? "blue" : h < 290 ? "purple" : "pink";
  return l > 0.8 ? `light ${hue}` : l < 0.25 ? `dark ${hue}` : hue;
}
