import { PMS_COATED } from "./pms";
import { collapseRamps, labOfRgb, onLine } from "./gradients";

/**
 * Screen colors for mockups. These are approximate on-screen colors for previews only;
 * the ink name / PMS number is what goes to production.
 */
export const WILFLEX_HEX: Record<string, string> = {
  White: "#FFFFFF", "Lemon Yellow": "#FFE94A", Yellow: "#FFD100", "Light Gold": "#FFB81C", Gold: "#F2A900",
  "Dolphin Orange": "#FF6A13", "Bright Orange": "#FF5F00", "Electric Orange": "#FF7A1A", "National Red": "#C8102E",
  "Drake Red": "#BA0C2F", "Dallas Scarlet": "#D22630", Scarlet: "#CE1126", "Electric Red": "#EF3340", Maroon: "#6F263D",
  Brandywine: "#7A2638", "Russell Purple": "#4B2E83", "Electric Purple": "#8A3FFC", "Russell Gray": "#8A8D8F",
  "Dark Gray": "#53565A", Tan: "#C4A77D", Aqua: "#00A3AD", "Contact Blue": "#0072CE", Royal: "#003DA5",
  "Light Royal": "#1F5FBF", "Bears Navy": "#0B162A", Navy: "#1B2A4A", "Electric Blue": "#0096FF", "Kelly Green": "#00843D",
  "Light Green": "#78BE20", "Dark Green": "#154734", "Electric Green": "#4CFF00", "Electric Yellow": "#EEFF1A",
  "Electric Pink": "#FF3EB5", "Black Diamond": "#101820", Black: "#111111",
};

/** Common PMS (coated) colors with approximate screen values. Other PMS numbers can be typed with a custom color. */
export const PMS_HEX: Record<string, string> = {
  "PMS Black C": "#2D2926", "PMS White": "#FFFFFF", "PMS Cool Gray 1 C": "#D9D9D6", "PMS Cool Gray 6 C": "#A7A8AA",
  "PMS Cool Gray 11 C": "#53565A", "PMS 877 C (Silver)": "#8A8D8F", "PMS 871 C (Gold)": "#84754E",
  "PMS 100 C": "#F6EB61", "PMS 109 C": "#FFD100", "PMS 116 C": "#FFCD00", "PMS 123 C": "#FFC72C", "PMS 1235 C": "#FFB81C",
  "PMS 130 C": "#F2A900", "PMS 137 C": "#FFA300", "PMS 151 C": "#FF8200", "PMS 165 C": "#FF671F", "PMS 021 C": "#FE5000",
  "PMS 172 C": "#FA4616", "PMS 179 C": "#E03C31", "PMS 185 C": "#E4002B", "PMS 186 C": "#C8102E", "PMS 187 C": "#A6192E",
  "PMS 193 C": "#BF0D3E", "PMS 200 C": "#BA0C2F", "PMS 201 C": "#9D2235", "PMS 202 C": "#862633", "PMS 208 C": "#861F41",
  "PMS 212 C": "#F04E98", "PMS 219 C": "#DA1884", "PMS 226 C": "#D0006F", "PMS 2685 C": "#330072", "PMS 268 C": "#582C83",
  "PMS 2587 C": "#8246AF", "PMS 2607 C": "#500778", "PMS 279 C": "#418FDE", "PMS 285 C": "#0072CE", "PMS 286 C": "#0033A0",
  "PMS 287 C": "#003087", "PMS 288 C": "#002D72", "PMS 289 C": "#0C2340", "PMS 2767 C": "#13294B", "PMS 282 C": "#041E42",
  "PMS 293 C": "#003DA5", "PMS 300 C": "#005EB8", "PMS 299 C": "#00A3E0", "PMS 2925 C": "#009CDE", "PMS 311 C": "#05C3DE",
  "PMS 320 C": "#009CA6", "PMS 327 C": "#008675", "PMS 347 C": "#009A44", "PMS 348 C": "#00843D", "PMS 355 C": "#009639",
  "PMS 356 C": "#007A33", "PMS 3425 C": "#006341", "PMS 3435 C": "#154734", "PMS 375 C": "#97D700", "PMS 368 C": "#78BE20",
  "PMS 364 C": "#4A7729", "PMS 5535 C": "#205C40", "PMS 7406 C": "#F1C400", "PMS 7548 C": "#FFC600", "PMS 7427 C": "#97233F",
  "PMS 7421 C": "#651D32", "PMS 469 C": "#693F23", "PMS 4625 C": "#4F2C1D", "PMS 7502 C": "#CEB888", "PMS 465 C": "#B9975B",
  "PMS 802 C (Neon Green)": "#44D62C", "PMS 803 C (Neon Yellow)": "#FFE900", "PMS 804 C (Neon Orange)": "#FFAA4D",
  "PMS 805 C (Neon Red)": "#FF7276", "PMS 806 C (Neon Pink)": "#FF3EB5", "PMS 807 C (Neon Magenta)": "#EA27C2",
};

/**
 * The shop's other stock inks from the Ink Room (Production → Ink Room, the ones switched on as stocked): Monarch Bora
 * Bora Sand, InkTek Khaki and Dark Brown, the shimmers… (Oct 22, Nick: "on the ink room, we have our standard inks
 * logged… those colors need to be added to that standard colors list"). Filled once the page has read them
 * (addStockInks); empty until then and for customers.
 */
export const STOCK_HEX: Record<string, string> = {};
/** the stock inks a color can be matched to on its own (not whites, shimmers or bases: those are picked by hand) */
const STOCK_MATCH: Record<string, string> = {};
export function addStockInks(rows: { name: string; hex: string; line?: string }[]) {
  for (const r of rows) {
    const n = (r.name || "").trim();
    if (!n || WILFLEX_HEX[n] || !/^#[0-9a-f]{6}$/i.test(r.hex || "") || /additive|base|mix/i.test(r.line || "")) continue;
    STOCK_HEX[n] = r.hex.toUpperCase();
    if (!/white|shimmer|metallic|glitter/i.test(`${n} ${r.line || ""}`)) STOCK_MATCH[n] = r.hex.toUpperCase();
  }
}

/**
 * The Ink Room's PMS formulas (Production → Ink Room → PMS formulas, read from IMS: 2,756 and growing), by number
 * ("2178", "COOL GRAY 3"). Their colors come first; the old chart (lib/pms.ts, 1,341 colors) only fills in numbers the
 * Ink Room doesn't have (Oct 23, Nick: "everything that's in the ink room for sure should be in the PMS formulas…
 * Pantone adds colors all the time"; HALFF's PMS 2178 C was in the Ink Room but not the chart). A PMS in neither is
 * still a real ink: it just has no screen color here. Filled once a page has read them (lib/inkFormulas.ts).
 */
export const FORMULA_HEX: Record<string, string> = {};
export function addFormulaInks(rows: { name: string; hex: string }[]) {
  for (const r of rows) {
    const m = /^PANTONE\s+(.+?)\s+C$/i.exec((r.name || "").trim());
    const hex = (r.hex || "").replace(/^#/, "");
    if (!m || !/^[0-9a-f]{6}$/i.test(hex)) continue;
    FORMULA_HEX[m[1].toUpperCase().replace(/\s+/g, " ")] = `#${hex.toUpperCase()}`;
  }
}

/** Screen color for an ink name: Wilflex RFU, another stock ink, a PMS coated number ("PMS 186 C", "186 C", "PMS 186"), or a #hex. */
export const colorHex = (name: string) => {
  if (WILFLEX_HEX[name] || STOCK_HEX[name] || PMS_HEX[name]) return WILFLEX_HEX[name] || STOCK_HEX[name] || PMS_HEX[name];
  if (/^#[0-9a-f]{6}$/i.test(name)) return name;
  const m = name.trim().replace(/^(pms|pantone)\s*/i, "").replace(/\s*c$/i, "");
  return m ? FORMULA_HEX[m.toUpperCase().replace(/\s+/g, " ")] || PMS_COATED[`PMS ${m.replace(/\b[a-z]/g, (c) => c.toUpperCase())} C`] || "" : "";
};

/** Main flat colors in a logo (transparent pixels ignored), largest first. */
export function detectColors(img: HTMLImageElement, max = 8): { hex: string; share: number; gradient?: boolean }[] {
  const w = Math.min(400, img.naturalWidth || 400), h = Math.round(w * ((img.naturalHeight || 1) / (img.naturalWidth || 1)));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    total++;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; e.n++;
    buckets.set(key, e);
  }
  const list = [...buckets.values()].map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n })).sort((a, b) => b.n - a.n);
  const out: { r: number; g: number; b: number; n: number }[] = [];
  for (const e of list) {
    const near = out.find((o) => Math.hypot(o.r - e.r, o.g - e.g, o.b - e.b) < 60);
    if (near) { near.n += e.n; continue; }
    if (e.n / total < 0.01 || out.length >= max) continue;
    out.push({ ...e });
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  // fades (gradients): the colors along a fade are one fade between two inks; keep its ends, at their truest color
  const pts: number[][] = [], rgbs: number[][] = [];
  const step = Math.max(1, Math.floor(total / 30000)) * 4;
  for (let i = 0; i < d.length; i += step) { if (d[i + 3] < 200) continue; const c = [d[i], d[i + 1], d[i + 2]]; rgbs.push(c); pts.push(labOfRgb(c)); }
  const cols = collapseRamps(out.map((o) => { const c = [o.r, o.g, o.b]; return { lab: labOfRgb(c), rgb: c, share: o.n / (total || 1) }; }), pts, rgbs);
  return cols.sort((a, b) => b.share - a.share).map((o) => ({ hex: `#${hex(o.rgb[0])}${hex(o.rgb[1])}${hex(o.rgb[2])}`, share: o.share, ...(o.gradient ? { gradient: true } : {}) }));
}

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Repaint a logo: each detected color becomes the chosen ink color, or is dropped ("none") so the shirt shows through. */
export function recolor(img: HTMLImageElement, sources: string[], targets: Record<string, string>): string {
  return recolorCanvas(img, sources, targets).toDataURL("image/png");
}

/**
 * Recolored, and cut down to what's left when a color was removed (Oct 21, Nick: "when I remove a color and it becomes
 * the shirt color, are you cropping down?… when I say 11.50 you still have the original box from the color I
 * removed"): a logo on a black box with the black removed is sized by the art that prints, not the box.
 * `box` = the part kept, as fractions of the full picture (null when nothing was cut).
 */
export function recolorTrim(img: HTMLImageElement, sources: string[], targets: Record<string, string>, solid?: { shirt?: string }): { url: string; w: number; h: number; box: { x: number; y: number; w: number; h: number } | null } {
  const c = solid ? solidCanvas(img, sources, targets, solid.shirt) : recolorCanvas(img, sources, targets);
  const W = c.width, H = c.height;
  if (!Object.values(targets).includes("none") || !W || !H) return { url: c.toDataURL("image/png"), w: W, h: H, box: null };
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { url: c.toDataURL("image/png"), w: W, h: H, box: null };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w >= W * 0.99 && h >= H * 0.99) return { url: c.toDataURL("image/png"), w: W, h: H, box: null };
  const o = document.createElement("canvas"); o.width = w; o.height = h;
  o.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { url: o.toDataURL("image/png"), w, h, box: { x: x0 / W, y: y0 / H, w: w / W, h: h / H } };
}

/**
 * Solid colors only (Oct 23, Nick on HUD 102026: "this shouldn't print with any shading… it's just all solid colors"): art
 * pulled off a photo carries the photo's light and shadow (a black ring gone gray, the shirt's red half showing through
 * at the edges). Every pixel becomes exactly one of its inks, or the shirt (left out); no in-between colors, no see-through.
 */
function solidCanvas(img: HTMLImageElement, sources: string[], targets: Record<string, string>, shirt?: string): HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, w, h), d = data.data;
  const cand = sources.map((s0) => ({ src: rgb(s0), out: targets[s0] === "none" ? null : rgb(targets[s0] || s0) }));
  if (shirt && /^#[0-9a-f]{6}$/i.test(shirt)) cand.push({ src: rgb(shirt), out: null });
  const cache = new Map<number, number[] | null>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let out = cache.get(key);
    if (out === undefined && !cache.has(key)) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < cand.length; k++) { const q = cand[k].src, dd = (d[i] - q[0]) ** 2 + (d[i + 1] - q[1]) ** 2 + (d[i + 2] - q[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
      out = cand[best].out; cache.set(key, out);
    }
    if (!out) { d[i + 3] = 0; continue; }
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255;
  }
  x.putImageData(data, 0, 0);
  return c;
}

function recolorCanvas(img: HTMLImageElement, sources: string[], targets: Record<string, string>): HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, w, h);
  const d = data.data;
  const src = sources.map(rgb);
  const dst = sources.map((s) => (targets[s] === "none" ? null : targets[s] ? rgb(targets[s]) : undefined));
  // a pixel between two of the colors (a fade from one to the other, or the soft edge where they meet) is repainted
  // the same way between their new colors, so a gradient stays a gradient in the chosen inks
  const cache = new Map<number, number[] | null | undefined>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let out = cache.get(key);
    if (!cache.has(key)) {
      const p = [d[i], d[i + 1], d[i + 2]];
      let best = 0, bd = Infinity;
      for (let k = 0; k < src.length; k++) {
        const dd = (p[0] - src[k][0]) ** 2 + (p[1] - src[k][1]) ** 2 + (p[2] - src[k][2]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      out = dst[best];
      // the pair of colors this one sits between, measured against how far apart the pair is: a fade drawn in a color
      // profile bows off the straight line between its ends (yellow → orange by 20–40 units), and a cut-off there
      // would paint the bow flat and leave steps in the fade
      let pa = -1, pb = -1, pt = 0, pd = Infinity, pr = Infinity;
      for (let a = 0; a < src.length; a++) for (let b = a + 1; b < src.length; b++) {
        const r = onLine(p, src[a], src[b]); if (r.t <= 0.02 || r.t >= 0.98) continue;
        const len = Math.hypot(src[b][0] - src[a][0], src[b][1] - src[a][1], src[b][2] - src[a][2]) || 1, rel = r.d / len;
        if (rel < pr) { pr = rel; pd = r.d; pa = a; pb = b; pt = r.t; }
      }
      if (pa >= 0 && pd < Math.sqrt(bd) && (pd < 18 || pr < 0.3)) {
        const ta = dst[pa], tb = dst[pb];
        if (ta !== undefined || tb !== undefined) {
          const A = ta === undefined ? src[pa] : ta, B = tb === undefined ? src[pb] : tb;
          if (A === null && B === null) out = null;
          else if (A === null || B === null) { const C = (A || B)!; const w = A === null ? pt : 1 - pt; out = [C[0], C[1], C[2], w]; }
          else out = [A[0] + pt * (B[0] - A[0]), A[1] + pt * (B[1] - A[1]), A[2] + pt * (B[2] - A[2])];
        }
      }
      cache.set(key, out);
    }
    if (out === undefined) continue;
    if (out === null) { d[i + 3] = 0; continue; }
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    if (out.length > 3) d[i + 3] = Math.round(d[i + 3] * out[3]);
  }
  x.putImageData(data, 0, 0);
  return c;
}

const lab = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), Y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), Z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};

/** CIEDE2000 color difference (how different two colors look; under ~2 is hard to tell apart). */
export function deltaE(h1: string, h2: string) {
  const [L1, a1, b1] = lab(h1), [L2, a2, b2] = lab(h2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b: number, a: number) => { if (!b && !a) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p) { dh = h2p - h1p; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p;
  if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hb += h1p + h2p < 360 ? 360 : -360; hb /= 2; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const nearest = (hex: string, chart: Record<string, string>) => {
  let best = "", bd = Infinity;
  for (const [name, h] of Object.entries(chart)) { const d = deltaE(hex, h); if (d < bd) { bd = d; best = name; } }
  return { name: best, hex: chart[best], dE: Math.round(bd * 10) / 10 };
};
/** The standard stock ink (Wilflex RFU, or another one we stock) that looks closest to a color. */
export const closestInk = (hex: string) => nearest(hex, Object.keys(STOCK_MATCH).length ? { ...WILFLEX_HEX, ...STOCK_MATCH } : WILFLEX_HEX);
/** The Pantone coated color that looks closest (same idea as pantoneconverter.com's HEX to Pantone). */
export const closestPms = (hex: string) => nearest(hex, PMS_COATED);

/** how close a match is, in shop words (CIEDE2000) */
export const matchWord = (dE: number) => (dE < 1 ? "exact" : dE < 3 ? "very close" : dE < 6 ? "close" : "not very close");
export type InkMatch = { name: string; hex: string; dE: number };
/**
 * Standard ink or PMS for a color from the art:
 *   - a standard (stock Wilflex RFU) ink when it's very close: no mixing, always on the shelf
 *   - a PMS when no stock ink is very close and the PMS is clearly closer (mix it)
 *   - otherwise the standard ink (the PMS isn't worth mixing for)
 * White and black are always the standard inks.
 */
export function suggestInk(hex: string): { standard: InkMatch; pms: InkMatch; rec: "standard" | "pms"; why: string } {
  const standard = closestInk(hex), pms = closestPms(hex);
  const n = parseInt(hex.replace("#", ""), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const plain = (r > 238 && g > 238 && b > 238) || (r < 30 && g < 30 && b < 30);
  if (plain || standard.dE < 3) return { standard, pms, rec: "standard", why: plain ? "White and black: standard ink." : `${standard.name} is ${matchWord(standard.dE)}: stock ink, no mixing.` };
  if (pms.dE + 1 < standard.dE) return { standard, pms, rec: "pms", why: `No stock ink is very close (${standard.name} is ${matchWord(standard.dE)}). ${pms.name} is ${matchWord(pms.dE)}: mix it.` };
  return { standard, pms, rec: "standard", why: `${standard.name} is about as close as any PMS: use the stock ink.` };
}

/**
 * Repaint a logo picture in its picked inks without its background going with it: only pixels close to one of the
 * logo's colors move, shifted by that color's change (soft edges keep their blend). For thumbnails of the raw upload.
 * `map`: logo color hex → new hex, or "none" (removed: the pixel goes see-through).
 */
export function repaintLogo(img: HTMLImageElement, map: Record<string, string>, maxSide = 600): string {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * k)), h = Math.max(1, Math.round((img.naturalHeight || 1) * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h), d = data.data;
  const rgbOf = (hx: string) => { const v = hx.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
  const pairs = Object.entries(map).map(([s, t]) => ({ s: rgbOf(s), t: t === "none" ? null : rgbOf(t) }));
  if (!pairs.length) return clearPage(c).toDataURL("image/png");
  const cache = new Map<number, number[] | null | undefined>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let out = cache.get(key);
    if (!cache.has(key)) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < pairs.length; j++) { const s = pairs[j].s, dd = (d[i] - s[0]) ** 2 + (d[i + 1] - s[1]) ** 2 + (d[i + 2] - s[2]) ** 2; if (dd < bd) { bd = dd; best = j; } }
      if (best < 0 || bd > 70 * 70) out = undefined;
      else { const { s, t } = pairs[best]; out = t ? [0, 1, 2].map((q) => Math.max(0, Math.min(255, d[i + q] + t[q] - s[q]))) : null; }
      cache.set(key, out);
    }
    if (out === undefined) continue;
    if (out === null) { d[i + 3] = 0; continue; }
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
  x.putImageData(data, 0, 0);
  return clearPage(c).toDataURL("image/png");
}

/**
 * A logo picture made from a whole PDF page (a white page with the art on it) shown as art: the white page around the
 * art is taken off and the picture cropped to the art (Oct 24, Nick: "these little boxes are appearing again over the
 * mockups on the order"). Only white that touches the picture's edge goes, so white ink inside the art stays; a picture
 * that's already see-through around its art is left as it is.
 */
export function clearPage(c: HTMLCanvasElement): HTMLCanvasElement {
  const w = c.width, h = c.height, x = c.getContext("2d", { willReadFrequently: true })!;
  const data = x.getImageData(0, 0, w, h), d = data.data;
  const white = (p: number) => d[p * 4 + 3] > 200 && d[p * 4] > 236 && d[p * 4 + 1] > 236 && d[p * 4 + 2] > 236;
  const seen = new Uint8Array(w * h), stack: number[] = [];
  for (let i = 0; i < w; i++) { stack.push(i, (h - 1) * w + i); }
  for (let j = 0; j < h; j++) { stack.push(j * w, j * w + w - 1); }
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || !white(p)) continue;
    seen[p] = 1; d[p * 4 + 3] = 0; cleared++;
    const px = p % w, py = (p - px) / w;
    if (px > 0) stack.push(p - 1); if (px < w - 1) stack.push(p + 1); if (py > 0) stack.push(p - w); if (py < h - 1) stack.push(p + w);
  }
  if (cleared < w * h * 0.05) return c; // no white page around it
  // crop to what's left
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 16) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  x.putImageData(data, 0, 0);
  if (x1 < 0) return c;
  const pad = 2, cw = Math.min(w, x1 - x0 + 1 + pad * 2), ch = Math.min(h, y1 - y0 + 1 + pad * 2);
  const o = document.createElement("canvas"); o.width = cw; o.height = ch;
  o.getContext("2d")!.drawImage(c, Math.max(0, x0 - pad), Math.max(0, y0 - pad), cw, ch, 0, 0, cw, ch);
  return o;
}
