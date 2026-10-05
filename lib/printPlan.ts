/**
 * How a logo should print, worked out once and used everywhere: the Mockup Creator (the logo's inks, the imprint's
 * color count for the price) and the Separation Studio (the screens) start from the same plan, so a logo sold as two
 * colors isn't found to be five on press.
 *
 *   - Colors (`findColors`): flat inks, small detail inks, and fades (gradients) reduced to their truest end colors.
 *   - Fades: a long fade (yellow to red) or one whose middle prints muddy (yellow to blue) gets a middle screen, the way
 *     the shop prints them (Separo recommends five for the Peticolas yellow → red; the shop prints three).
 *   - Method: spot color unless the art is shaded like a photo (lots of it is neither an ink nor along a fade between
 *     two inks): then simulated process.
 *   - Ink names: the suggested ink for each color (stock ink when it's very close, PMS when only a PMS is).
 * The plan is saved on the design (`designs.print_plan`), so both screens read the same one.
 */
import { baseShirt, findColors, findSimInks, type Px, type SepInk } from "./separate";
import { closestPms, colorHex, deltaE, suggestInk } from "./inkColors";
import { snapInk } from "./separate";
import { labOfRgb } from "./gradients";

export type InkLib = "auto" | "wilflex" | "pms";
export type PrintPlan = {
  v: 1;
  method: "spot" | "sim";
  /** the inks (art color → ink name), fades and combined colors included; sim: the simulated-process inks */
  inks: SepInk[];
  /** screens for the price (colors; the underbase on a dark shirt isn't counted) */
  colors: number;
  /** in words, for the person selling it */
  why: string;
  /** sim plans depend on the shirt: made for a dark or a light one */
  dark?: boolean;
  at: string;
};

/** the ink an art color is called (White and Black by name; else stock ink or PMS by the shop's rule) */
export const inkName = (hex: string, lib: InkLib = "auto") => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (r > 238 && g > 238 && b > 238) return "White";
  if (r < 30 && g < 30 && b < 30) return "Black";
  return lib === "pms" ? closestPms(hex).name : lib === "wilflex" ? snapInk(hex).name : (({ standard, pms, rec }) => (rec === "pms" ? pms : standard).name)(suggestInk(hex));
};
/** the color an ink prints (its name's color), else the art's */
export const shown = (ink: SepInk) => colorHex(ink.name) || ink.hex;

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
/** a plain word for a color (green, orange, light blue…) */
export function colorWord(hex: string): string {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.08) return l > 0.85 ? "white" : l < 0.15 ? "black" : "gray";
  let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360;
  const name = hue < 15 || hue >= 340 ? "red" : hue < 40 ? "orange" : hue < 65 ? "yellow" : hue < 165 ? "green" : hue < 195 ? "teal" : hue < 255 ? "blue" : hue < 290 ? "purple" : "pink";
  return (l > 0.75 && name !== "yellow" ? "light " : l < 0.3 ? "dark " : "") + name;
}
export type FadeRow = { a: SepInk; b: SepInk; mid: string; midWord: string; risky: boolean; long: boolean };
/**
 * Each fade between two inks, with the art's own color halfway along it, and whether two screens are enough:
 *   risky: the middle can print muddy (ends far apart around the color wheel, like yellow and blue, whose dots side by
 *          side mix in light toward a dull gray-green instead of the art's green), or two dots mix far off the art's middle
 *   long:  the ends are far apart (yellow to red): a middle screen keeps the fade smooth. Separo recommends five screens
 *          for the Peticolas yellow → red fade (101 C, 7409 C, 7577 C, 2027 C, Warm Red C); the shop prints it in three.
 */
export function fadesOf(inks: SepInk[], px: Px | null): FadeRow[] {
  const out: FadeRow[] = [];
  const lin = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  inks.forEach((a, i) => (a.fadeTo || []).forEach((h) => {
    const j = inks.findIndex((x) => x.hex.toLowerCase() === h.toLowerCase()); if (j <= i) return;
    const b = inks[j], A = hexRgb(a.hex), B = hexRgb(b.hex);
    // the art's color halfway along the fade
    let mid = A.map((v, k) => (v + B[k]) / 2);
    if (px) {
      const AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2, acc = [0, 0, 0];
      let n = 0; const step = Math.max(1, Math.floor((px.w * px.h) / 120000));
      for (let q = 0; q < px.w * px.h && L2; q += step) {
        const o = q * 4; if (px.data[o + 3] < 200) continue;
        const P = [px.data[o], px.data[o + 1], px.data[o + 2]], t = ((P[0] - A[0]) * AB[0] + (P[1] - A[1]) * AB[1] + (P[2] - A[2]) * AB[2]) / L2;
        if (t < 0.42 || t > 0.58) continue;
        const d = Math.hypot(P[0] - A[0] - t * AB[0], P[1] - A[1] - t * AB[1], P[2] - A[2] - t * AB[2]); if (d > 90) continue;
        acc[0] += P[0]; acc[1] += P[1]; acc[2] += P[2]; n++;
      }
      if (n > 20) mid = acc.map((v) => v / n);
    }
    const SA = hexRgb(shown(a)), SB = hexRgb(shown(b));
    const light = SA.map((v, k) => gam((lin(v) + lin(SB[k])) / 2));
    const la = labOfRgb(SA), lb = labOfRgb(SB), ca = Math.hypot(la[1], la[2]), cb = Math.hypot(lb[1], lb[2]);
    let dh = Math.abs(Math.atan2(la[2], la[1]) - Math.atan2(lb[2], lb[1])) * 180 / Math.PI; if (dh > 180) dh = 360 - dh;
    const midHex = toHex(mid), risky = (ca > 25 && cb > 25 && dh > 90) || deltaE(midHex, toHex(light)) > 14;
    // once a fade has a middle screen (an end that fades two ways), its halves aren't flagged again
    const split = (a.fadeTo?.length || 0) > 1 || (b.fadeTo?.length || 0) > 1;
    out.push({ a, b, mid: midHex, midWord: colorWord(midHex), risky: risky && !split, long: deltaE(shown(a), shown(b)) > 45 && !split });
  }));
  return out;
}
/** a third ink in the middle of a fade: A → middle → B */
export function withMiddle(l: SepInk[], ah: string, bh: string, mid: string, lib: InkLib): SepInk[] {
  const at = l.findIndex((x) => x.hex === bh);
  const n = l.map((x) => x.hex === ah ? { ...x, fadeTo: [...(x.fadeTo || []).filter((h) => h !== bh), mid] } : x.hex === bh ? { ...x, fadeTo: [...(x.fadeTo || []).filter((h) => h !== ah), mid] } : x);
  n.splice(at < 0 ? n.length : at, 0, { hex: mid, name: inkName(mid, lib), fadeTo: [ah, bh] });
  return n;
}

/** pixels of a picture (an image already loaded in the browser), at most `side` px on the long side */
export function pxOfImage(img: HTMLImageElement, side = 2400): Px {
  const nat = Math.max(img.naturalWidth || 1, img.naturalHeight || 1), k = Math.min(1, side / nat);
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * k)), h = Math.max(1, Math.round((img.naturalHeight || 1) * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
  return { w, h, data: x.getImageData(0, 0, w, h).data };
}

/**
 * Share of the art that is shading no spot ink explains: neither one of the inks (within 12 ΔE) nor along a fade
 * between two of them, and not the soft edge where two colors meet (only pixels inside an area count).
 */
function unexplained(px: Px, inks: SepInk[]): number {
  const labs = inks.map((k) => labOfRgb(hexRgb(k.hex)));
  const segs: [number[], number[]][] = [];
  inks.forEach((a) => (a.fadeTo || []).forEach((h) => { const b = inks.find((x) => x.hex.toLowerCase() === h.toLowerCase()); if (b) segs.push([hexRgb(a.hex), hexRgb(b.hex)]); }));
  const { w, h, data } = px, n = w * h, step = Math.max(1, Math.floor(n / 40000));
  let far = 0, tot = 0;
  for (let i = w + 1; i < n - w - 1; i += step) {
    const o = i * 4; if (data[o + 3] < 200) continue;
    // inside an area: its neighbors are about the same color
    let flat = true;
    for (const j of [i - 1, i + 1, i - w, i + w]) { const q = j * 4; if (data[q + 3] < 200 || Math.abs(data[q] - data[o]) + Math.abs(data[q + 1] - data[o + 1]) + Math.abs(data[q + 2] - data[o + 2]) > 30) { flat = false; break; } }
    if (!flat) continue;
    tot++;
    const P = [data[o], data[o + 1], data[o + 2]], L = labOfRgb(P);
    if (labs.some((c) => (c[0] - L[0]) ** 2 + (c[1] - L[1]) ** 2 + (c[2] - L[2]) ** 2 < 144)) continue;
    if (segs.some(([A, B]) => { const AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2; if (!L2) return false; const t = ((P[0] - A[0]) * AB[0] + (P[1] - A[1]) * AB[1] + (P[2] - A[2]) * AB[2]) / L2; if (t < -0.05 || t > 1.05) return false; const tc = Math.max(0, Math.min(1, t)); return Math.hypot(P[0] - A[0] - tc * AB[0], P[1] - A[1] - tc * AB[1], P[2] - A[2] - tc * AB[2]) < 42; })) continue;
    far++;
  }
  return tot ? far / tot : 0;
}

/** Work out how a logo prints. `garment`: the shirt color, only needed when the art turns out to be simulated process. */
export function planPrint(px: Px, opts: { garment?: string; lib?: InkLib; /** a method someone picked: plan within it */ method?: "spot" | "sim" } = {}): PrintPlan {
  const lib = opts.lib || "auto";
  const f = findColors(px, 12, 9, 0.004);
  let inks: SepInk[] = f.map((x) => ({ hex: x.hex, name: inkName(x.hex, lib), ...(x.fadeTo?.length ? { fadeTo: x.fadeTo } : {}) }));
  const added: string[] = [];
  for (const r of fadesOf(inks, px)) if ((r.risky || r.long) && inks.length < 12) { inks = withMiddle(inks, r.a.hex, r.b.hex, r.mid, lib); added.push(`${r.a.name} → ${r.mid ? colorWord(r.mid) + " → " : ""}${r.b.name}`); }
  const fades = inks.filter((k) => k.fadeTo?.length).length;
  const shade = unexplained(px, inks);
  const at = new Date().toISOString();
  if (opts.method === "sim" || (opts.method !== "spot" && (shade > 0.18 || inks.length > 10))) {
    const garment = opts.garment || "#000000", dark = baseShirt(garment);
    const sim = findSimInks(px, garment, 8);
    return { v: 1, method: "sim", inks: sim.map((x) => ({ hex: x.hex, name: inkName(x.hex, lib) })), colors: sim.length, dark, at,
      why: opts.method === "sim" ? `Simulated process, ${sim.length} screens.` : `Simulated process, ${sim.length} screens: ${Math.round(shade * 100)}% of the art is shading no spot ink makes${inks.length > 10 ? ` (and it has ${inks.length} colors)` : ""}.` };
  }
  const plain = inks.length - (fades ? inks.filter((k) => k.fadeTo?.length).length : 0);
  const why = fades
    ? `Screen print, ${inks.length} color${inks.length === 1 ? "" : "s"}: ${added.length ? `the fade${added.length > 1 ? "s" : ""} (${added.join("; ")}) print${added.length > 1 ? "" : "s"} with a middle screen` : "a fade printed as two inks' halftones crossing"}${plain > 0 ? `, plus ${plain} solid color${plain === 1 ? "" : "s"}` : ""}.`
    : `Screen print, ${inks.length} solid color${inks.length === 1 ? "" : "s"}.`;
  return { v: 1, method: "spot", inks, colors: inks.length, why, at };
}

/** a saved plan for this shirt: a simulated-process plan made for a dark shirt is made again for a light one */
export function planFor(plan: PrintPlan | null | undefined, px: Px, garment: string, lib: InkLib = "auto"): PrintPlan | null {
  if (!plan || plan.v !== 1 || !plan.inks?.length) return null;
  if (plan.method !== "sim") return plan;
  const dark = baseShirt(garment);
  if (plan.dark === dark) return plan;
  const sim = findSimInks(px, garment, Math.max(plan.colors, 1));
  return { ...plan, inks: sim.map((x) => ({ hex: x.hex, name: inkName(x.hex, lib) })), colors: sim.length, dark };
}

/** take an ink out; if it was the middle of a fade, the fade joins its two neighbors again */
export function dropInk(l: SepInk[], i: number): SepInk[] {
  const gone = l[i], nb = gone.fadeTo || [];
  return l.filter((_, j) => j !== i).map((x) => {
    if (!x.fadeTo?.includes(gone.hex)) return x;
    const rest = x.fadeTo.filter((h) => h !== gone.hex), join = nb.filter((h) => h !== x.hex && !rest.includes(h));
    const f = [...rest, ...join];
    if (f.length) return { ...x, fadeTo: f };
    const { fadeTo: _f, ...plain } = x; void _f; return plain;
  });
}

/**
 * Override how the logo was read: print it in `want` inks instead (Separo's Colors + Apply).
 *   Fewer: one at a time, the ink easiest to do without goes: the one whose color the others make best (a fade's
 *          middle step, made by the fade's two sides; a gold between yellow and orange), weighed by how much of the
 *          art it is. Its area then prints as halftones of the inks left.
 *   More:  one at a time: the longest step of a fade gets a middle screen (Separo's five-color Peticolas: 101 C,
 *          7409 C, 7577 C, 2027 C, Warm Red C); with no fade to split, the biggest color in the art that isn't one of
 *          the inks yet gets its own.
 * Names already chosen are kept.
 */
export function adjustInks(px: Px, inks: SepInk[], want: number, lib: InkLib = "auto"): { inks: SepInk[]; note: string } {
  let list = inks.map((k) => ({ ...k }));
  const start = list.length;
  want = Math.max(1, Math.min(12, Math.round(want)));
  const labOf = (h: string) => labOfRgb(hexRgb(h));
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // how much of the art each ink is: sampled pixels to their nearest ink
  const sample: number[][] = [];
  { const n = px.w * px.h, step = Math.max(1, Math.floor(n / 30000)); for (let i = 0; i < n; i += step) { const o = i * 4; if (px.data[o + 3] >= 160) sample.push(labOfRgb([px.data[o], px.data[o + 1], px.data[o + 2]])); } }
  const shares = (l: SepInk[]) => {
    const labs = l.map((k) => [k.hex, ...(k.also || [])].map(labOf)), c = new Array(l.length).fill(0);
    for (const p of sample) { let bi = 0, bd = Infinity; labs.forEach((ls, i) => ls.forEach((L) => { const d = d2(p, L); if (d < bd) { bd = d; bi = i; } })); c[bi]++; }
    return c.map((v) => v / (sample.length || 1));
  };
  while (list.length > want) {
    const sh = shares(list), labs = list.map((k) => labOf(k.hex));
    let bi = 0, bc = Infinity;
    for (let i = 0; i < list.length; i++) {
      // how far its color is from what the others make: the nearest other ink, or a mix along the line of two others
      let best = Infinity;
      for (let a = 0; a < list.length; a++) {
        if (a === i) continue;
        best = Math.min(best, d2(labs[i], labs[a]));
        for (let b = a + 1; b < list.length; b++) {
          if (b === i) continue;
          const A = labs[a], B = labs[b], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2; if (!L2) continue;
          const t = Math.max(0, Math.min(1, ((labs[i][0] - A[0]) * AB[0] + (labs[i][1] - A[1]) * AB[1] + (labs[i][2] - A[2]) * AB[2]) / L2));
          best = Math.min(best, d2(labs[i], [A[0] + t * AB[0], A[1] + t * AB[1], A[2] + t * AB[2]]));
        }
      }
      // a fade's middle is made by its two sides by design: cheaper to drop; a combined ink costs more
      const mid = (list[i].fadeTo?.length || 0) > 1 ? 0.5 : 1;
      const c = Math.sqrt(best) * Math.sqrt(sh[i] + 0.002) * mid * (list[i].also?.length ? 3 : 1);
      if (c < bc) { bc = c; bi = i; }
    }
    list = dropInk(list, bi);
  }
  let none = false;
  while (list.length < want) {
    // a fade step to split: the longest one
    let fa = -1, fb = -1, fl = 0;
    list.forEach((a, i) => (a.fadeTo || []).forEach((h) => { const j = list.findIndex((x) => x.hex === h); if (j > i) { const L = deltaE(shown(a), shown(list[j])); if (L > fl) { fl = L; fa = i; fb = j; } } }));
    if (fa >= 0 && fl > 18) {
      const row = fadesOf(list, px).find((r) => r.a.hex === list[fa].hex && r.b.hex === list[fb].hex);
      if (row && !list.some((k) => k.hex === row.mid)) { list = withMiddle(list, row.a.hex, row.b.hex, row.mid, lib); continue; }
    }
    // the next color in the art that isn't an ink yet
    const more = findColors(px, 16, 5, 0.0008);
    const have = list.flatMap((k) => [k.hex, ...(k.also || [])]);
    const cand = more.filter((c) => have.every((h) => deltaE(h, c.hex) > 8)).sort((a, b) => b.share - a.share)[0];
    if (!cand) { none = true; break; }
    list.push({ hex: cand.hex, name: inkName(cand.hex, lib) });
  }
  const n = list.length;
  const note = n === start ? (none ? `The art has no other color to give its own ink: still ${n}.` : `Still ${n} color${n === 1 ? "" : "s"}.`)
    : n < start ? `Now ${n} color${n === 1 ? "" : "s"} (was ${start}): the colors left out print as halftones of the others.`
    : `Now ${n} colors (was ${start})${none ? ": the art has no other color to give its own ink" : ""}.`;
  return { inks: list, note };
}
