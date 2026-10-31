import type { DigitizedSet } from "@/lib/digitizedFiles";
import { garmentHex, guessHex, mainLine } from "@/lib/mockup";
import { needleThreads, sheetThread } from "@/lib/needleThreads";
import { colorHex } from "@/lib/inkColors";
import { threadByName } from "@/lib/embroidery";
import { newImprint, type Design, type GLine, type Imprint, type Method } from "@/lib/pricing";

/**
 * Brands under a customer (Oct 27, Nick: Cedar Promos is a distributor; MEI, ShipStation / WWEX and Embark each have
 * their own brand standards). A logo (one D-number) is uploaded once to a brand, and each department "takes it and runs"
 * in its own lane:
 *   - screen print: the vector, its separations / films, the inks (PMS) of each colorway
 *   - embroidery: the sew files E1, E2… (one per size and kind: flat, cap, bag, puff), DST + EMB + worksheet
 *   - heat press: the print file
 * The lanes only change what a department sees first; the logo is the same record, so any department can grab it
 * ("sometimes we need artwork to talk between departments… screen printing needs to go in and grab the logo").
 * The brand on an order is only its rules: which colorway goes on a light, a dark or a one-color job, and the threads.
 */
export type BrandColor = { name: string; pms?: string; hex: string; /** a thread matched to it */ thread?: string };
export type BrandRules = { light?: string; dark?: string; one_light?: string; one_dark?: string;
  /** new orders with this brand's logos (Oct 30, Nick: All My Sons gets a logo mockup, like #40284; "only for this
   *  account"): "logo" = Create order makes the logo mockup (the logos on the shirt color) by itself; unset = none */
  mockup?: "logo";
  /** the brand's standard mockups by number (Oct 30, Nick: "save the mockup number and reuse those on each line item…
   *  you don't need to make it each time"): a new order's group with the same logos gets that mockup, copied */
  mockups?: number[] };
export type BrandEmb = { light?: string[]; dark?: string[]; backing?: string };
export type Brand = { id: string; customer_id: string; name: string; colors: BrandColor[]; rules: BrandRules; embroidery: BrandEmb; notes: string; sort: number; archived_at?: string | null };

/** a version of a logo in set colors ("Maroon / Black"): its inks, and its own picture when there is one; `sew` is the
 *  code of the logo's sew file that stitches it (E2), so an order that picks this colorway gets that DST (Oct 31, Nick) */
export type Colorway = { name: string; inks: string[]; preview?: string; file?: { path: string; name: string }; sew?: string };
/** a logo's colors (the swatches on its page): the brand's colors it uses, with their PMS (Oct 31, Nick: "here's the
 *  logo, here's the colors… very visual") */
export type LogoColor = { name: string; pms?: string; hex: string;
  /** the thread we sew this color in (Oct 31, Nick: "instead of the hex… set a thread color"): the customer-approved one.
   *  Every sew file's needle nearest this color runs it, whatever the digitizer's sheet says (withStandards) */ thread?: string };
/** a sew file: a DST made for one size and kind of goods. code = E1, E2… (D10241E1 on the Tajima's screen) */
export type SewKind = "flat" | "cap" | "bag" | "puff" | "fleece";
export const SEW_KINDS: Record<SewKind, string> = { flat: "Flat", cap: "Cap", bag: "Bag", puff: "3D puff", fleece: "Fleece" };
export type SewFile = DigitizedSet & { code?: string; kind?: SewKind; placement?: string; threads?: { light?: string[]; dark?: string[] } };

export type Lane = "embroidery" | "screen" | "dtf";
export const LANES: { id: Lane; label: string; short: string }[] = [
  { id: "embroidery", label: "Embroidery", short: "Embroidery" },
  { id: "screen", label: "Screen print", short: "Screen print" },
  { id: "dtf", label: "Heat press", short: "Heat press" },
];

type Specs = { colorways?: Colorway[]; embroidery?: { files?: SewFile[] }; heat?: { file?: { path: string; name: string } }; seps?: unknown; [k: string]: unknown };
const specsOf = (d: Pick<Design, "specs">) => (d.specs || {}) as Specs;
export const colorwaysOf = (d: Pick<Design, "specs">): Colorway[] => specsOf(d).colorways || [];
/** a logo's sew files, each needle on the thread we really run (withStandards: staff picks, else the logo colors' threads) */
export const sewFilesOf = (d: Pick<Design, "specs">, brand?: Pick<Brand, "colors"> | null): SewFile[] => {
  const std = standardColors(d, brand);
  return (specsOf(d).embroidery?.files || []).filter((f) => f && f.path).map((f) => withStandards(f, std));
};
/** a logo's colors with their standard threads: its own (each without a thread taking its brand's for the same PMS or
 *  name), else its brand's colors */
export function standardColors(d: Pick<Design, "specs">, brand?: Pick<Brand, "colors"> | null): LogoColor[] {
  const k = (s?: string) => (s || "").toLowerCase().replace(/^(pantone|pms)\s*/, "").replace(/[^a-z0-9]/g, "");
  const own = ((specsOf(d) as { colors?: LogoColor[] }).colors || []).filter((c) => c && c.name);
  const bc = brand?.colors || [];
  if (!own.length) return bc;
  return own.map((c) => c.thread ? c : { ...c, thread: bc.find((x) => (c.pms && x.pms && k(x.pms) === k(c.pms)) || k(x.name) === k(c.name))?.thread });
}
const rgbOf = (h: string) => { const v = parseInt((h || "#9aa1ab").replace("#", "").padEnd(6, "0").slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const rgbDist = (a: string, b: string) => { const x = rgbOf(a), y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/** a logo color's screen color: as saved, else its PMS's, else its name's */
const colorOf = (c: LogoColor) => (/^#[0-9a-f]{6}$/i.test(c.hex || "") ? c.hex : colorHex(c.pms || "") || colorHex(c.name) || guessHex(c.name) || "#9aa1ab");
/**
 * The logo color a worksheet's thread is (Oct 31): the nearest of the logo's colors to the thread's color, when it's
 * close (a Carmine needle is the Maroon; a gold one is no color of a maroon-and-white logo). Ties go to a color with a
 * thread set. Null when none is close.
 */
export function logoColorOfThread(x: { code: string; chart: string; name: string }, colors: LogoColor[]): LogoColor | null {
  const st = sheetThread(x), hex = st?.hex || guessHex(x.name) || "";
  if (!colors.length) return null;
  // by name first: a color whose whole name is in the thread's ("Super White" is the White, not the Off White; "Emerald
  // Black" is the Black), the longest such name
  const tn = ` ${(st?.name || x.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const named = colors.filter((c) => c.name && tn.includes(` ${c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `)).sort((a, b) => b.name.length - a.name.length);
  if (named.length) return named.find((c) => c.thread) && named[0].name.length === named.find((c) => c.thread)!.name.length ? named.find((c) => c.thread)! : named[0];
  if (!hex) return null;
  let best: LogoColor | null = null, bd = Infinity;
  for (const c of colors) { const dd = rgbDist(hex, colorOf(c)); if (dd < bd - 0.5 || (Math.abs(dd - bd) <= 0.5 && !best?.thread && c.thread)) { best = c; bd = dd; } }
  return bd <= 80 ? best : null;
}
/**
 * A sew file with each needle on the thread we really run (Oct 31, Nick: "the digitizer doesn't know what we have on the
 * wall… if we get a DST back, they might just select whatever on the embroidery sheet… don't assume those are the
 * customer approved threads"): a needle staff picked a thread for keeps it; any other takes the standard thread of the
 * logo color nearest the sheet's thread (LogoColor.thread); else the sheet's. Worked out each time a logo's files are
 * read, so a standard set later reaches every file, old and new.
 */
export function withStandards(f: SewFile, colors: LogoColor[]): SewFile {
  if (!f.ws?.threads?.length) return f;
  let changed = false;
  const threads = f.ws.threads.map((x) => {
    if (x.ours && x.oursFrom !== "standard") return x;
    const c = logoColorOfThread(x, colors);
    const st = sheetThread(x);
    // the standard only when it isn't what the sheet already says
    const want = c?.thread && !(st && threadByName(c.thread)?.code === st.code && threadByName(c.thread)?.line === st.line) ? c.thread : undefined;
    if ((x.ours || undefined) === want) return x;
    changed = true;
    const y = { ...x };
    if (want) { y.ours = want; y.oursFrom = "standard"; } else { delete y.ours; delete y.oursFrom; }
    return y;
  });
  return changed ? { ...f, ws: { ...f.ws, threads } } : f;
}
const isVector = (d: Pick<Design, "file_type" | "file_name">) => /pdf|postscript|illustrator|svg|eps/i.test(d.file_type || "") || /\.(pdf|ai|eps|svg)$/i.test(d.file_name || "");

/** what a lane has of a logo, in words for its card ("2 sew files", "Vector, 4 colorways"), and whether it's ready */
export function laneState(d: Pick<Design, "specs" | "file_type" | "file_name">, lane: Lane): { ready: boolean; note: string } {
  if (lane === "embroidery") {
    const fs = sewFilesOf(d);
    return fs.length ? { ready: true, note: fs.length === 1 ? `${fs[0].code || "1 sew file"} · ${fs[0].wIn}" × ${fs[0].hIn}"` : `${fs.length} sew files` } : { ready: false, note: "Needs digitizing" };
  }
  if (lane === "screen") {
    const cw = colorwaysOf(d).length;
    return isVector(d) ? { ready: true, note: ["Vector", cw ? `${cw} colorway${cw === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") } : { ready: false, note: "Needs separations" };
  }
  const heat = specsOf(d).heat?.file;
  return heat || isVector(d) ? { ready: true, note: "Print file" } : { ready: false, note: "Needs a print file" };
}

/** the Tajima's name for a sew file: D{number}E{n} (on the machine's screen and the DST's LA header) */
export const tajimaName = (number: number, n: number) => `D${number}E${n}`;
export const nextSewCode = (files: SewFile[]) => `E${files.reduce((m, f) => Math.max(m, Number((f.code || "").replace(/\D/g, "")) || 0), 0) + 1}`;

/** dark goods (the logo's light version goes on these) */
export function isDarkGarment(l: Pick<GLine, "color"> & { hex?: string | null }) {
  const h = garmentHex((l as { hex?: string | null }).hex, l.color || "");
  const v = parseInt(h.slice(1), 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** the brand's colorway for light or dark goods, as one of the logo's colorways (by name; the first when it has no match) */
export function colorwayFor(d: Pick<Design, "specs">, brand: Brand | null | undefined, dark: boolean, one = false): Colorway | null {
  const cws = colorwaysOf(d);
  if (!cws.length) return null;
  const want = (one ? (dark ? brand?.rules.one_dark : brand?.rules.one_light) : (dark ? brand?.rules.dark : brand?.rules.light)) || "";
  const k = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  return cws.find((c) => k(c.name) === k(want)) || cws[0];
}

/** the sew file linked to a colorway (Colorway.sew), if it has one */
export function colorwaySew(d: Pick<Design, "specs">, cw: Colorway | null | undefined, brand?: Pick<Brand, "colors"> | null): SewFile | null {
  return cw?.sew ? sewFilesOf(d, brand).find((f) => f.code === cw.sew) || null : null;
}
/** a print with its sew file as the logo has it now (Oct 31): the threads we really run on each needle may have been set on
 *  the logo since the print took its copy of the file (lib/brands.ts withStandards) */
export function withLiveSew<T extends Pick<Imprint, "emb">>(im: T, d: Pick<Design, "specs"> | null | undefined): T {
  const p = im.emb?.file?.path;
  const live = p && d ? sewFilesOf(d).find((f) => f.path === p) : null;
  return live?.ws ? { ...im, emb: { ...(im.emb || {}), file: { ...im.emb!.file!, ws: live.ws } } } : im;
}
/** the threads a sew file sews in, in order ("Madeira 1981 Carmine"): its worksheet's, else the ones set on it */
export function sewThreads(f: SewFile | null | undefined, side: "light" | "dark" = "light"): string[] {
  if (!f) return [];
  if (f.ws?.threads?.length) return needleThreads(f.ws, "").map((t) => t.label);
  return f.threads?.[side] || [];
}
/** a sew file's threads in the order they sew (its worksheet's color sequence), else as listed */
function seqThreads(f: SewFile | null | undefined): string[] {
  if (!f) return [];
  const ws = f.ws as { sequence?: { needle: number }[] } | undefined;
  if (!ws?.sequence?.length || !f.ws?.threads?.length) return sewThreads(f);
  const nt = needleThreads(f.ws, "");
  return ws.sequence.map((st) => nt.find((t) => t.needle === st.needle)?.label || "").filter(Boolean);
}
/**
 * How a print's inks (or threads) become another colorway's: each ink of the colorway it is → the ink in the same place
 * in the other one (Oct 31, Nick: "same logo, but with a color change"). Embroidery pairs the two sew files' threads stop
 * by stop (MEI's E2 Black, Carmine → E1 Cream, Carmine); a screen print pairs the colorways' inks in order. A colorway
 * with fewer inks puts its last one on the rest (Maroon / Black → All White: both white).
 */
export function colorwayInkMap(d: Pick<Design, "specs">, im: Pick<Imprint, "inks" | "method">, from: Colorway, to: Colorway): Record<string, string> {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const digits = (x: string) => (x.match(/\d{3,4}/) || [""])[0];
  const same = (a: string, b: string) => norm(a) === norm(b) || (!!digits(a) && digits(a) === digits(b));
  const emb = im.method === "embroidery";
  const a = emb ? seqThreads(colorwaySew(d, from)) : from.inks, b = emb ? seqThreads(colorwaySew(d, to)) : to.inks;
  const A = a.length ? a : from.inks, B = b.length ? b : to.inks;
  const out: Record<string, string> = {};
  const inks = (im.inks || "").split(/\s*,\s*/).filter(Boolean);
  inks.forEach((ink, k) => {
    const i = A.findIndex((x) => same(x, ink));
    const at = i >= 0 ? i : k;
    const t = B[Math.min(at, B.length - 1)];
    if (t) out[ink] = t;
  });
  return out;
}
/**
 * A colorway change on a print (Oct 31, Nick: "CT106678 gets colorway B, and then the charcoal gets colorway A…
 * just like color change or location change"): by garment color, the colorway it sews or prints in. It's a color change
 * underneath (Imprint.inkBy: the colorway's inks on those garments), so everything that already follows a color change
 * (the grouped lines, the tiles, the Mockup Creator, the work order, the ink change count) follows it; colorwayBy keeps
 * which colorway each one is, for its letter, name, picture and sew file. Colors on the print's own colorway are left off.
 */
export function applyColorwayChange(im: Imprint, d: Pick<Design, "specs">, byColor: Record<string, string>): Imprint {
  const x: Imprint = { ...im };
  const base = printColorway(im, d);
  const cws = colorwaysOf(d);
  const ck = (c: string) => c.trim().toLowerCase();
  const was = Object.keys(im.colorwayBy || {}).map(ck);
  const inkBy: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(im.inkBy || {}).filter(([c]) => !was.includes(ck(c))));
  const by: Record<string, string> = {};
  for (const [c, name] of Object.entries(byColor)) {
    const cw = cws.find((y) => cwKey(y.name) === cwKey(name));
    if (!cw || !base || cwKey(cw.name) === cwKey(base.name)) continue;
    by[ck(c)] = cw.name;
    inkBy[ck(c)] = colorwayInkMap(d, im, base, cw);
  }
  if (Object.keys(by).length) x.colorwayBy = by; else delete x.colorwayBy;
  if (Object.keys(inkBy).length) x.inkBy = inkBy; else delete x.inkBy;
  return x;
}
/** the colorway a garment color gets on a print: its colorway change, else the print's own */
export function colorwayOnColor(im: Pick<Imprint, "colorway" | "colorwayBy" | "inks" | "emb">, d: Pick<Design, "specs"> | null | undefined, color: string): Colorway | null {
  if (!d) return null;
  const name = Object.entries(im.colorwayBy || {}).find(([c]) => c.trim().toLowerCase() === (color || "").trim().toLowerCase())?.[1];
  if (name) { const cw = colorwaysOf(d).find((y) => cwKey(y.name) === cwKey(name)); if (cw) return cw; }
  return printColorway(im, d);
}
/** colorway names compared loosely ("Maroon / Off White" = "maroon/off-white") */
const cwKey = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** inks compared loosely, in any order ("PMS 492 C, Black" = "black, pantone 492c") */
const inksKey = (xs: string[]) => xs.map((x) => x.trim().toLowerCase().replace(/^pantone\s*/, "pms ").replace(/[^a-z0-9]/g, "")).filter(Boolean).sort().join("|");
/**
 * THE picture of a print's art (Oct 31): the colorway it was switched to (Imprint.colorway) has its own picture, drawn
 * as it is; else the logo's picture (painted in the print's inks by whoever shows it). `urls` is previewUrls'.
 */
export function printArtUrl(urls: Record<string, string> | null | undefined, designId: string | null | undefined, im?: { colorway?: string } | null): string {
  if (!urls || !designId) return "";
  return (im?.colorway && urls[`${designId}:cw:${cwKey(im.colorway)}`]) || urls[designId] || "";
}
/** a print switched to a colorway with its own picture: that picture is already in its colors (nothing to paint) */
export const hasColorwayArt = (urls: Record<string, string> | null | undefined, designId: string | null | undefined, im?: { colorway?: string } | null) =>
  !!(urls && designId && im?.colorway && urls[`${designId}:cw:${cwKey(im.colorway)}`]);
/** a colorway's letter: A, B, C… in the order they're on the logo's page (M-1240-B is saved mockup 1240 in its B) */
export function cwLetter(d: Pick<Design, "specs">, cw: Pick<Colorway, "name"> | null | undefined): string {
  const i = cw ? colorwaysOf(d).findIndex((c) => cwKey(c.name) === cwKey(cw.name)) : -1;
  return i >= 0 ? String.fromCharCode(65 + i) : "";
}
/**
 * The colorway a print is (Oct 31, Nick: "I'm using this logo… it's on this logo mockup, which is M-1108, and I can use
 * A, B, C, or D"): the one picked on it (Imprint.colorway), else the one whose sew file it sews, else the one whose inks
 * it has. Null when it's none of them (inks typed by hand, or a logo without colorways).
 */
export function printColorway(im: Pick<Imprint, "colorway" | "inks" | "emb">, d: Pick<Design, "specs"> | null | undefined): Colorway | null {
  const cws = d ? colorwaysOf(d) : [];
  if (!d || !cws.length) return null;
  if (im.colorway) { const c = cws.find((x) => cwKey(x.name) === cwKey(im.colorway)); if (c) return c; }
  const f = im.emb?.file?.path;
  if (f) { const c = cws.find((x) => colorwaySew(d, x)?.path === f); if (c) return c; }
  const k = inksKey((im.inks || "").split(/\s*,\s*/));
  return k ? cws.find((x) => inksKey(x.inks) === k) || null : null;
}
/**
 * A print switched to one of its logo's colorways (Swap on the order). It takes the colorway's inks; embroidery takes
 * the colorway's sew file (the one of the same kind and size as the file it sewed, when the logo has one for each),
 * that file's threads, stitches and size. The picture becomes the colorway's own: the inks painted before, the saved
 * tile and any color change were for the old version, so they're dropped.
 */
export function applyColorway(im: Imprint, d: Pick<Design, "specs">, cw: Colorway): Imprint {
  const x: Imprint = { ...im, colorway: cw.name };
  delete x.inkMap; delete x.shownArt; delete x.inkBy; x.inkChanges = 0;
  if (im.method === "embroidery") {
    const linked = colorwaySew(d, cw), was = im.emb?.file as SewFile | undefined;
    // the colorway's file for the size and kind this print sews: the linked one, or one cut the same as the old file
    // that sews the linked one's threads
    const same = (f: SewFile) => !!was && (f.kind || "flat") === (was.kind || "flat") && Math.abs((f.wIn || 0) - (was.wIn || 0)) < 0.06;
    const sew = !linked || !was || same(linked) ? linked : sewFilesOf(d).find((f) => same(f) && sewThreads(f).join() === sewThreads(linked).join()) || linked;
    const th = sewThreads(sew);
    const inks = th.length ? th : cw.inks;
    x.inks = inks.join(", ");
    x.colors = Math.max(1, inks.length);
    if (sew) {
      x.emb = { ...(im.emb || {}), file: sew, stitchesFrom: "file" };
      x.stitches = sew.stitches;
      x.digitized = true;
      if (sew.wIn && sew.hIn) { x.size = `${sew.wIn}" × ${sew.hIn}"`; x.artRatio = Math.round((sew.hIn / sew.wIn) * 1000) / 1000; }
    }
  } else {
    x.inks = cw.inks.join(", ");
    x.colors = Math.max(1, cw.inks.length);
  }
  // a colorway change on it stays: each garment color keeps its colorway, worked out again from the new one (one that is
  // now the print's own drops off)
  if (im.colorwayBy && Object.keys(im.colorwayBy).length) { delete x.colorwayBy; return applyColorwayChange(x, d, im.colorwayBy); }
  return x;
}
/** a print as it runs on one garment color: the colorway it gets there (a colorway change) as that colorway, with its own
 *  inks or threads, sew file and picture; else the print as it is. For the work order's press sheets and close-ups */
export function printOnColor(im: Imprint, d: Pick<Design, "specs"> | null | undefined, color: string): Imprint {
  const name = Object.entries(im.colorwayBy || {}).find(([c]) => c.trim().toLowerCase() === (color || "").trim().toLowerCase())?.[1];
  const cw = name && d ? colorwaysOf(d).find((y) => cwKey(y.name) === cwKey(name)) : null;
  if (!cw || !d) return im;
  const base: Imprint = { ...im };
  delete base.colorwayBy; delete base.inkBy;
  return applyColorway(base, d, cw);
}
/**
 * A logo put on a print brings what the logo already knows (Oct 31, Nick: "when you bring in a master logo that's been
 * established with the thread, has digitizing… and you add it to the mock-up, it should pull in all that details…
 * colorways and thread choices… or just do it automatically"): its colorway for these goods (the one the print already
 * is, else the brand's rule for light or dark goods, else its first), and for embroidery the sew file that colorway
 * sews (else the one that fits the goods and size) with its threads, stitches and size. Taken once per logo
 * (Imprint.setupFrom), so nothing set by hand afterwards is changed.
 * `fresh`: the logo was just put on the print (it all comes); otherwise (a print from before) only what's missing (a sew
 * file it doesn't have) is filled in, and its size and threads stay.
 */
export function withLogoSetup(im: Imprint, d: Pick<Design, "id" | "specs"> | null | undefined, lines: GLine[], brand?: Brand | null, fresh = true): Imprint {
  if (!d || im.design_id !== d.id || im.setupFrom === d.id || im.supplied || im.visualOnly) return im;
  const x: Imprint = { ...im, setupFrom: d.id };
  const cws = colorwaysOf(d);
  const goods = lines.filter((l) => (l.color || "").trim());
  const main = mainLine(goods.length ? goods : lines);
  const cw = printColorway(x, d) || (fresh && cws.length ? colorwayFor(d, brand, main ? isDarkGarment(main) : false) : null);
  if (im.method === "embroidery") {
    const files = sewFilesOf(d, brand), linked = cw ? colorwaySew(d, cw, brand) : null;
    if (fresh && cw && linked) return applyColorway(x, d, cw);
    if (!files.length || (x.emb?.file?.path && files.some((f) => f.path === x.emb!.file!.path))) { if (cw && !x.colorway && fresh) x.colorway = cw.name; return x; }
    const w = /(\d+(?:\.\d+)?)/.exec(x.size || "");
    const f = linked || pickSewFile(files, sewKindOf(lines), w ? +w[1] : undefined);
    if (!f) return x;
    x.emb = { ...(x.emb || {}), file: f, stitchesFrom: "file" };
    if (f.stitches) x.stitches = f.stitches;
    x.digitized = true;
    const th = sewThreads(f);
    if (th.length && (fresh || !(x.inks || "").trim())) { x.inks = th.join(", "); x.colors = th.length; }
    if (fresh && f.wIn && f.hIn) { x.size = `${f.wIn}" × ${f.hIn}"`; x.artRatio = Math.round((f.hIn / f.wIn) * 1000) / 1000; }
    if (cw && linked && !x.colorway) x.colorway = cw.name;
    return x;
  }
  if (fresh && cw && im.method === "screen") return applyColorway(x, d, cw);
  return x;
}
/** the sew file for a print: the one linked to the colorway the brand's rule picks for these goods (same kind of goods),
 *  else the best fit by kind and size (pickSewFile) */
export function sewForPrint(d: Pick<Design, "specs">, brand: Brand | null | undefined, dark: boolean, kind: SewKind, wantW?: number): SewFile | null {
  const linked = colorwaySew(d, colorwayFor(d, brand, dark), brand);
  if (linked && (linked.kind || "flat") === kind) return linked;
  return pickSewFile(sewFilesOf(d, brand), kind, wantW);
}

/** the sew file that fits a print: the kind of goods, then the size closest to the one wanted (within about 10%) */
export function pickSewFile(files: SewFile[], kind: SewKind, wantW?: number): SewFile | null {
  if (!files.length) return null;
  const same = files.filter((f) => (f.kind || "flat") === kind);
  const pool = same.length ? same : files;
  if (!wantW) return pool[0];
  return [...pool].sort((a, b) => Math.abs(a.wIn - wantW) - Math.abs(b.wIn - wantW))[0];
}

/**
 * The print with the sew file it sews (Oct 30, #40284: D10303E1.DST and its worksheet were added to the logo after the
 * print was made, so the work order painted the flat art in thread colors and said "7,500 (est.)"). A print with its own
 * file keeps it; one without takes its logo's file for its goods and size (pickSewFile), with that file's stitches.
 */
export function withSewFile<T extends Pick<Imprint, "method" | "emb" | "size" | "stitches">>(im: T, design: Pick<Design, "specs"> | null | undefined, lines: Pick<GLine, "garment" | "style" | "brand">[]): T {
  if (im.method !== "embroidery" || im.emb?.file || !design) return im;
  const w = /(\d+(?:\.\d+)?)/.exec(im.size || "");
  const f = pickSewFile(sewFilesOf(design), sewKindOf(lines), w ? +w[1] : undefined);
  if (!f) return im;
  return { ...im, emb: { ...(im.emb || {}), file: f, stitchesFrom: "file" }, stitches: f.stitches || im.stitches };
}

/** the kind of sew file a group's goods take (caps, bags, fleece; else flat) */
export function sewKindOf(lines: Pick<GLine, "garment" | "style" | "brand">[]): SewKind {
  const t = lines.map((l) => `${l.garment || ""} ${l.style || ""} ${l.brand || ""}`).join(" ").toLowerCase();
  if (/\b(cap|hat|trucker|snapback|visor|richardson|beanie)\b/.test(t)) return "cap";
  if (/\b(bag|backpack|tote|duffel|cooler)\b/.test(t)) return "bag";
  if (/\bfleece\b/.test(t)) return "fleece";
  return "flat";
}

/**
 * The print a logo makes on a group (Customer artwork → a brand → Add to group): the logo, its spot, the method, the size
 * (a sew file's own size for embroidery), and the inks / threads by the brand's rule. Goods of both kinds in one group:
 * the light goods' version is the print's, the dark goods change to theirs (Imprint.inkBy, by garment color).
 */
export function brandPrint(o: { design: Design; brand: Brand | null; method: Lane; location: string; lines: GLine[]; size?: string; sew?: SewFile | null; colorway?: Colorway | null;
  /** light or dark goods, as set in the picker (else read off the color's name) */ darkOf?: (color: string) => boolean }): Imprint {
  const { design: d, brand, method, lines } = o;
  const im: Imprint = { ...newImprint(o.location), method: method as Method, design_id: d.id };
  const isDk = (l: GLine) => (o.darkOf ? o.darkOf(l.color) : isDarkGarment(l));
  const dark = lines.filter((l) => (l.color || "").trim() && isDk(l)), light = lines.filter((l) => (l.color || "").trim() && !isDk(l));
  const base = light.length || !dark.length ? "light" : "dark";
  if (method === "embroidery") {
    // a colorway linked to its own sew file sews in that file's threads (the dark goods' colorway in its file's threads)
    const linked = (side: "light" | "dark") => sewThreads(colorwaySew(d, colorwayFor(d, brand, side === "dark")));
    const th = (side: "light" | "dark") => linked(side).length ? linked(side) : o.sew?.threads?.[side]?.length ? o.sew.threads[side]! : brand?.embroidery[side] || [];
    const a = th(base), b = th(base === "light" ? "dark" : "light");
    { const cw = colorwayFor(d, brand, base === "dark"); if (cw && colorwaySew(d, cw)) im.colorway = cw.name; }
    im.inks = a.join(", ");
    im.colors = Math.max(1, a.length || o.sew?.colors || 1);
    if (base === "light" && dark.length && b.length && b.join() !== a.join()) {
      im.inkBy = Object.fromEntries([...new Set(dark.map((l) => l.color.trim().toLowerCase()))].map((c) => [c, Object.fromEntries(a.map((t, i) => [t, b[i] ?? b[b.length - 1]]))]));
    }
    if (o.sew) {
      im.size = `${o.sew.wIn}" × ${o.sew.hIn}"`;
      im.stitches = o.sew.stitches;
      im.digitized = true;
      im.emb = { ...(im.emb || {}), file: o.sew, stitchesFrom: "file" };
      im.artRatio = o.sew.wIn ? Math.round((o.sew.hIn / o.sew.wIn) * 1000) / 1000 : undefined;
    } else if (o.size) im.size = o.size;
  } else {
    const cw = o.colorway || colorwayFor(d, brand, base === "dark");
    if (cw) {
      im.colorway = cw.name;
      im.inks = cw.inks.join(", ");
      im.colors = Math.max(1, cw.inks.length);
      const other = base === "light" && dark.length ? colorwayFor(d, brand, true) : null;
      if (other && other.name !== cw.name) {
        im.inkBy = Object.fromEntries([...new Set(dark.map((l) => l.color.trim().toLowerCase()))].map((c) => [c, Object.fromEntries(cw.inks.map((t, i) => [t, other.inks[i] ?? ""]))]));
      }
    } else if (d.inks) { im.inks = d.inks; im.colors = d.colors || 1; }
    if (o.size) im.size = o.size;
  }
  im.fromBrand = brand?.name || "their logos";
  if (o.sew) im.sizeFrom = "brand";
  else if (o.size) im.sizeFrom = "staff";
  return im;
}
