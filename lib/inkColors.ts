import { PMS_COATED } from "./pms";

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

/** Screen color for an ink name: Wilflex RFU, a PMS coated number ("PMS 186 C", "186 C", "PMS 186"), or a #hex. */
export const colorHex = (name: string) => {
  if (WILFLEX_HEX[name] || PMS_HEX[name]) return WILFLEX_HEX[name] || PMS_HEX[name];
  if (/^#[0-9a-f]{6}$/i.test(name)) return name;
  const m = name.trim().replace(/^pms\s*/i, "").replace(/\s*c$/i, "");
  return m ? PMS_COATED[`PMS ${m.replace(/\b[a-z]/g, (c) => c.toUpperCase())} C`] || "" : "";
};

/** Main flat colors in a logo (transparent pixels ignored), largest first. */
export function detectColors(img: HTMLImageElement, max = 8): { hex: string; share: number }[] {
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
  return out.sort((a, b) => b.n - a.n).map((o) => ({ hex: `#${hex(o.r)}${hex(o.g)}${hex(o.b)}`, share: o.n / (total || 1) }));
}

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Repaint a logo: each detected color becomes the chosen ink color, or is dropped ("none") so the shirt shows through. */
export function recolor(img: HTMLImageElement, sources: string[], targets: Record<string, string>): string {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, w, h);
  const d = data.data;
  const src = sources.map(rgb);
  const dst = sources.map((s) => (targets[s] === "none" ? null : targets[s] ? rgb(targets[s]) : undefined));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let best = 0, bd = Infinity;
    for (let k = 0; k < src.length; k++) {
      const dd = (d[i] - src[k][0]) ** 2 + (d[i + 1] - src[k][1]) ** 2 + (d[i + 2] - src[k][2]) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    }
    const t = dst[best];
    if (t === undefined) continue;
    if (t === null) { d[i + 3] = 0; continue; }
    d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2];
  }
  x.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
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
/** The standard Wilflex RFU ink that looks closest to a color. */
export const closestInk = (hex: string) => nearest(hex, WILFLEX_HEX);
/** The Pantone coated color that looks closest (same idea as pantoneconverter.com's HEX to Pantone). */
export const closestPms = (hex: string) => nearest(hex, PMS_COATED);
