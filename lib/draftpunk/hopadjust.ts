/**
 * Hops on hand (Nick, Nov 24 2026: "you design around standardized alphas but go to the store and get different ones…
 * that's difficult on brew day, should be easy"). Given the alpha acid on each package, the new amounts:
 * - bittering additions (boil of 30 min or more, first wort, mash) keep the same IBU: the weight moves by
 *   design alpha ÷ package alpha (bitterness is in proportion to alpha × weight in every formula used here);
 * - flavor and aroma additions (short boil, whirlpool, dry hop) keep their weight, since aroma follows the oil, not the
 *   alpha; their small IBU change shows in the total.
 * Either can be switched per addition. The recipe remembers the alpha it was designed around (designAlpha), so it can
 * go back, or be adjusted again for the next lot.
 */
import { calcRecipe } from "./calc";
import type { Recipe, RHop } from "./types";

export type HopMode = "ibu" | "weight";
export const defaultMode = (h: RHop): HopMode => (h.use === "first_wort" || h.use === "mash" || (h.use === "boil" && h.min >= 30) ? "ibu" : "weight");

/** what the brewer has for one addition: the package's alpha, and a different variety when they're substituting */
export type Lot = { alpha?: number; name?: string };

export function adjustForLots(r: Recipe, lots: Record<string, Lot | undefined>, modes: Record<string, HopMode | undefined>): Recipe {
  return {
    ...r,
    hops: r.hops.map((h) => {
      const lot = lots[h.lid];
      const alpha = lot?.alpha && lot.alpha > 0 ? lot.alpha : h.alpha;
      const name = lot?.name?.trim() || h.name;
      if (Math.abs(alpha - h.alpha) < 0.01 && name === h.name) return h;
      const mode = modes[h.lid] || defaultMode(h);
      const oz = mode === "ibu" ? (h.oz * h.alpha) / alpha : h.oz;
      return { ...h, designAlpha: h.designAlpha ?? h.alpha, designOz: h.designOz ?? h.oz, designName: h.designName ?? h.name, name, alpha, oz: Math.round(oz * 100) / 100 };
    }),
  };
}

/** the recipe back on the alphas it was designed around */
export function backToDesign(r: Recipe): Recipe {
  return { ...r, hops: r.hops.map((h) => (h.designAlpha != null ? { ...h, oz: h.designOz ?? h.oz, alpha: h.designAlpha, name: h.designName ?? h.name, designAlpha: undefined, designOz: undefined, designName: undefined } : h)) };
}

/** before and after, for the panel */
export function compare(r: Recipe, next: Recipe) {
  const a = calcRecipe(r), b = calcRecipe(next);
  return { ibuBefore: a.ibu, ibuAfter: b.ibu, per: Object.fromEntries(next.hops.map((h) => [h.lid, { before: a.hopIbus[h.lid] || 0, after: b.hopIbus[h.lid] || 0 }])) };
}
