/**
 * The garment a mockup is shown on: its middle size (a toddler tee 2T-5T is shown as a 3T, adult tees as a Large) and
 * that size's flat measurements (body width = chest across, body length = collar to hem). The Mockup Creator sizes
 * the photo and the print areas by it, so a 3T toddler tee isn't treated like an adult Gildan 5000.
 * Measurements come from the supplier's size chart when we have it (S&S specs, saved on the garment as `specs`),
 * otherwise from typical numbers for that size.
 */
export type Body = { size: string; widthIn: number; lengthIn: number; kind: "adult" | "youth" | "toddler" | "infant"; from: "supplier" | "typical" };
export type GarmentSpecs = { sizes: Record<string, { width?: number; length?: number }>; source?: string; at?: string };

/** the reference everything was drawn for: an adult Large (Gildan 5000) */
export const REF_BODY: Body = { size: "L", widthIn: 22, lengthIn: 30, kind: "adult", from: "typical" };

/** typical flat measurements (inches) by size: Gildan 5000 / 5000B, Bella+Canvas 3001T, Rabbit Skins / Bella onesies */
const TYPICAL: Record<string, [number, number]> = {
  NB: [8, 12.5], "6M": [8.75, 13.5], "12M": [9.5, 14.5], "18M": [10.25, 15.5], "24M": [11, 16.5],
  "2T": [12, 15.5], "3T": [12.75, 16.5], "4T": [13.5, 17.5], "5T": [14, 18.5],
  YXS: [14.5, 19], YS: [16, 20.5], YM: [17, 22], YL: [18, 23.5], YXL: [19, 25],
  XS: [16, 27], S: [18, 28], M: [20, 29], L: [22, 30], XL: [24, 31], "2XL": [26, 32], "3XL": [28, 33], "4XL": [30, 34], "5XL": [32, 35],
};
const kindOf = (z: string): Body["kind"] => (/^(NB|\d+M)$/.test(z) ? "infant" : /^\dT$/.test(z) ? "toddler" : /^Y/.test(z) ? "youth" : "adult");
const ORDER = Object.keys(TYPICAL);

/**
 * The size a garment is shown in: Large for adult runs, youth Large for youth runs, otherwise the middle of the run
 * (the lower middle when it's even: 2T-5T → 3T, 6M-24M → 12M).
 */
export function middleSize(run: string[]): string {
  const sizes = ORDER.filter((z) => run.includes(z));
  if (!sizes.length) return "L";
  if (sizes.includes("L")) return "L";
  if (sizes.includes("YL") && !sizes.some((z) => kindOf(z) === "adult")) return "YL";
  return sizes[Math.floor((sizes.length - 1) / 2)];
}

/** "12 1/4", "12.25", "12¼", "12-13" → inches */
export function parseInches(v: string): number | null {
  const s = String(v || "").replace(/["”″]|in(ches)?\b/gi, "").replace(/½/g, " 1/2").replace(/¼/g, " 1/4").replace(/¾/g, " 3/4").trim();
  const range = s.split(/\s*[-–]\s*/);
  const one = (t: string) => { const m = t.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/); return m ? +m[1] + (m[2] ? +m[2] / +m[3] : 0) : null; };
  const vals = range.map(one).filter((x): x is number => x != null && x > 0 && x < 80);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** the body a garment is shown on: its middle size, measured from its size chart or typical numbers */
export function bodyOf(g: { sizes?: string[] | null; specs?: GarmentSpecs | null } | null | undefined, fallbackRun: string[] = []): Body {
  const run = (g?.sizes?.length ? g.sizes : fallbackRun).filter((z) => z !== "OS");
  const size = middleSize(run);
  const sp = g?.specs?.sizes?.[size];
  const t = TYPICAL[size] || TYPICAL.L;
  const w = sp?.width && sp.width > 5 && sp.width < 40 ? sp.width : t[0];
  const l = sp?.length && sp.length > 8 && sp.length < 45 ? sp.length : t[1];
  return { size, widthIn: w, lengthIn: l, kind: kindOf(size), from: sp?.width ? "supplier" : "typical" };
}
