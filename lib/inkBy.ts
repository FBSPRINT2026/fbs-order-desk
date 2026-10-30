/**
 * A print's color changes in plain words (Imprint.inkBy: garment color → { the print's ink: what it prints in instead }).
 * One place for every page that says it (Oct 30, Nick: "nowhere on the proof does it show the color change… the PMS 230…
 * you don't see it anywhere"): the proof, the work order, the order page.
 */
import type { Imprint } from "@/lib/pricing";

const ck = (c: string) => (c || "").trim().toLowerCase();
export const titleColor = (c: string) => c.replace(/\b\w/g, (m) => m.toUpperCase());

export type InkChange = { from: string; to: string; colors: string[] };
/** each change once (Contact Blue → PMS 230) with the garment colors it's on, as the order writes them */
export function inkChanges(im: Pick<Imprint, "inkBy" | "visualOnly">, colorNames: string[] = []): InkChange[] {
  if (im.visualOnly) return [];
  const out: InkChange[] = [];
  for (const [color, m] of Object.entries(im.inkBy || {})) {
    for (const [from, to] of Object.entries(m || {})) {
      if (!to || ck(from) === ck(to)) continue;
      const named = colorNames.find((c) => ck(c) === ck(color)) || titleColor(color);
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
