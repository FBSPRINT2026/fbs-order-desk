import { deltaE } from "./inkColors";

/**
 * Shirt colors that print alike count as one (Oct 22, Nick on #40091: Violet and Purple are two brands' purples: "that
 * really doesn't impact the film"). Two colors are one set when both take the same underbase (every shirt gets one
 * except white) and they're close (ΔE under SAME_SHIRT). Black, Athletic Heather and Scarlet (#40092) stay apart: one
 * set of films prints on all of them, so the film room has to know.
 */
export const SAME_SHIRT = 30;
const white = (h: string) => deltaE(h, "#FFFFFF") < 10;
export type ShirtSet = { name: string; hex: string; names: string[] };
export function shirtSets(list: { name: string; hex: string }[]): ShirtSet[] {
  const out: ShirtSet[] = [];
  for (const c of list) {
    const s = out.find((o) => white(o.hex) === white(c.hex) && deltaE(o.hex, c.hex) < SAME_SHIRT);
    if (s) { if (!s.names.includes(c.name)) s.names.push(c.name); }
    else out.push({ ...c, names: [c.name] });
  }
  return out;
}
