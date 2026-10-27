import type { DigitizedSet } from "@/lib/digitizedFiles";
import { garmentHex } from "@/lib/mockup";
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
export type BrandRules = { light?: string; dark?: string; one_light?: string; one_dark?: string };
export type BrandEmb = { light?: string[]; dark?: string[]; backing?: string };
export type Brand = { id: string; customer_id: string; name: string; colors: BrandColor[]; rules: BrandRules; embroidery: BrandEmb; notes: string; sort: number; archived_at?: string | null };

/** a version of a logo in set colors ("Maroon / Black"): its inks, and its own picture when there is one */
export type Colorway = { name: string; inks: string[]; preview?: string; file?: { path: string; name: string } };
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
export const sewFilesOf = (d: Pick<Design, "specs">): SewFile[] => (specsOf(d).embroidery?.files || []).filter((f) => f && f.path);
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

/** the sew file that fits a print: the kind of goods, then the size closest to the one wanted (within about 10%) */
export function pickSewFile(files: SewFile[], kind: SewKind, wantW?: number): SewFile | null {
  if (!files.length) return null;
  const same = files.filter((f) => (f.kind || "flat") === kind);
  const pool = same.length ? same : files;
  if (!wantW) return pool[0];
  return [...pool].sort((a, b) => Math.abs(a.wIn - wantW) - Math.abs(b.wIn - wantW))[0];
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
    const th = (side: "light" | "dark") => o.sew?.threads?.[side]?.length ? o.sew.threads[side]! : brand?.embroidery[side] || [];
    const a = th(base), b = th(base === "light" ? "dark" : "light");
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
