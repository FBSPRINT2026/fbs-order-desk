/**
 * A print's color changes in plain words (Imprint.inkBy: garment color → { the print's ink: what it prints in instead }).
 * One place for every page that says it (Oct 30, Nick: "nowhere on the proof does it show the color change… the PMS 230…
 * you don't see it anywhere"): the proof, the work order, the order page.
 */
import type { Imprint } from "@/lib/pricing";

const ck = (c: string) => (c || "").trim().toLowerCase();
/** A colorway of a group (Nov 9, Nick: "the same garment color can be in two colorways… Mauve in B and C"): a line with
 *  `cw` keeps its own inks under "mauve ~c" in Imprint.inkBy, so two lines of one garment color can print different
 *  inks in one group (one set of screens). Every place that looks up a line's inks goes through inkKeyOf(line). */
export const inkKeyOf = (l: { color?: string | null; cw?: string | null }) => (l.cw ? `${(l.color || "").trim()} ~${l.cw}` : (l.color || ""));
/** the garment color of an ink key ("Mauve ~c" → "Mauve") for showing it and for its color */
export const baseColor = (k: string) => (k || "").replace(/\s*~[\w-]+$/, "");
export const titleColor = (c: string) => baseColor(c).replace(/\b\w/g, (m) => m.toUpperCase());

/** A print's color changes only for the garment colors its group has (Nick, Nov 12, #50061: a reorder of only Blue Spruce
 *  kept the last job's "White → 7640 on Mauve", charged its PMS match and showed it on the inks). A change saved for a
 *  color no longer on the group is kept on the print (the color may come back) but nothing shows, charges or prints it.
 *  Lines not given (or none with a color yet): the print's own inkBy. Every place that reads inkBy for a group goes
 *  through this. */
export function liveInkBy(im: Pick<Imprint, "inkBy">, lines?: { color?: string | null; cw?: string | null }[] | null): Imprint["inkBy"] {
  const ls = (lines || []).filter((l) => (l.color || "").trim());
  if (!im.inkBy || !ls.length) return im.inkBy;
  const k = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9~]/g, "");
  const here = new Set(ls.flatMap((l) => [k(inkKeyOf(l)), k(l.color || "")]));
  const out = Object.fromEntries(Object.entries(im.inkBy).filter(([c]) => here.has(k(c))));
  return Object.keys(out).length === Object.keys(im.inkBy).length ? im.inkBy : out;
}
/** the print as its group prints it (liveInkBy) */
export const livePrint = <T extends Pick<Imprint, "inkBy">>(im: T, lines?: { color?: string | null; cw?: string | null }[] | null): T => { const ib = liveInkBy(im, lines); return ib === im.inkBy ? im : { ...im, inkBy: ib }; };

export type InkChange = { from: string; to: string; colors: string[] };
/** each change once (Contact Blue → PMS 230) with the garment colors it's on, as the order writes them */
export function inkChanges(im: Pick<Imprint, "inkBy" | "visualOnly">, colorNames: string[] = []): InkChange[] {
  if (im.visualOnly) return [];
  const out: InkChange[] = [];
  for (const [color, m] of Object.entries(im.inkBy || {})) {
    for (const [from, to] of Object.entries(m || {})) {
      if (!to || ck(from) === ck(to)) continue;
      const named = colorNames.find((c) => ck(c) === ck(baseColor(color))) || titleColor(color);
      const hit = out.find((x) => ck(x.from) === ck(from) && ck(x.to) === ck(to));
      if (hit) { if (!hit.colors.some((c) => ck(c) === ck(named))) hit.colors.push(named); } else out.push({ from, to, colors: [named] });
    }
  }
  return out;
}

/** the inks a print prints on one garment color: its own, with that color's change swapped in */
export function inksOnColor(im: Pick<Imprint, "inks" | "inkBy">, color: string): { name: string; changed: boolean; from?: string }[] {
  const m = Object.entries(im.inkBy || {}).find(([k]) => ck(k) === ck(color))?.[1] || {};
  return (im.inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => {
    const to = Object.entries(m).find(([a, b]) => b && ck(a) === ck(n) && ck(a) !== ck(b))?.[1];
    return to ? { name: to, changed: true, from: n } : { name: n, changed: false };
  });
}

/** "on Navy, PMS 230 instead of Contact Blue; on Black, White instead of Navy" */
export const inkChangesText = (im: Pick<Imprint, "inkBy" | "visualOnly">, colorNames: string[] = []) =>
  inkChanges(im, colorNames).map((c) => `on ${c.colors.join(", ")}, ${c.to} instead of ${c.from}`).join("; ");

/** A color change's versions for a proof (Oct 30, Nick: "a small visual… a small block with the PMS color underneath it"):
 *  A as printed, then each change, with the garment colors and styles each goes on, and the swap to paint it with.
 *  A version is everything that changes on a garment color (Oct 31: a colorway change changes several threads at once,
 *  one version, not one per thread); a colorway change's version carries its colorway's name. */
export type ChangeVersion = { letter: string; colors: string[]; styles: string; swap: Record<string, string> | null; ink: string; from: string; colorway?: string };
export function changeVersions(im: Pick<Imprint, "inks" | "inkBy" | "visualOnly" | "colorwayBy" | "colorway">, lines0: { color?: string; brand?: string; style?: string; cw?: string }[]): ChangeVersion[] {
  if (im.visualOnly) return [];
  // each line by its ink key (a colorway's own line of a garment color is its own key, inkKeyOf)
  const ls = lines0.filter((l) => (l.color || "").trim()).map((l) => ({ ...l, color: inkKeyOf(l) }));
  const k2 = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stylesOn = (colors: string[]) => [...new Set(ls.filter((l) => colors.some((c) => k2(c) === k2(l.color || ""))).map((l) => [l.brand, l.style].filter(Boolean).join(" ")).filter(Boolean))].join(", ");
  const named = (c: string) => ls.find((l) => ck(l.color || "") === ck(c))?.color || c;
  const shown = (cs: string[]) => [...new Set(cs.map(baseColor))];
  const vers: { key: string; colors: string[]; swap: Record<string, string>; from: string[]; to: string[]; cw?: string }[] = [];
  const keys = [...new Set([...Object.keys(liveInkBy(im, lines0) || {}), ...Object.keys(im.colorwayBy || {})].map(ck))];
  for (const color of keys) {
    const m = Object.entries(im.inkBy || {}).find(([k]) => ck(k) === color)?.[1] || {};
    const ch = Object.entries(m).filter(([a, b]) => b && ck(a) !== ck(b));
    const cw = Object.entries(im.colorwayBy || {}).find(([k]) => ck(k) === color)?.[1];
    if (!ch.length && !cw) continue;
    const key = cw ? `cw:${ck(cw)}` : JSON.stringify(ch.map(([a, b]) => [ck(a), ck(b)]).sort());
    let v = vers.find((x) => x.key === key);
    if (!v) vers.push(v = { key, colors: [], swap: Object.fromEntries(ch.map(([a, b]) => [ck(a), b.trim()])), from: ch.map(([a]) => a), to: ch.map(([, b]) => b.trim()), cw });
    const n = named(color);
    if (!v.colors.some((c) => ck(c) === ck(n))) v.colors.push(n);
  }
  if (!vers.length) return [];
  const changed = new Set(vers.flatMap((v) => v.colors.map(k2)));
  const asIs = [...new Set(ls.map((l) => l.color || "").filter((c) => !changed.has(k2(c))))];
  const inks = (im.inks || "").split(/\s*,\s*/).filter(Boolean).join(", ");
  return [
    { letter: "A", colors: shown(asIs), styles: stylesOn(asIs), swap: null, ink: inks, from: "", ...(im.colorwayBy && im.colorway ? { colorway: im.colorway } : {}) },
    ...vers.map((v, i) => ({ letter: String.fromCharCode(66 + i), colors: shown(v.colors), styles: stylesOn(v.colors), swap: Object.keys(v.swap).length ? v.swap : null, ink: [...new Set(v.to)].join(", "), from: [...new Set(v.from)].join(", "), ...(v.cw ? { colorway: v.cw } : {}) })),
  ].filter((v) => v.colors.length);
}
