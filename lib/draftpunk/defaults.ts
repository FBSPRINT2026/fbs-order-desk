/** a fresh recipe, the ids for recipe lines, and turning library items into recipe lines */
import { RO_WATER } from "./calc";
import { DEFAULT_EQUIPMENT, MASH_PROFILES, WATERS } from "./library";
import type { Equipment, Fermentable, Hop, Misc, Recipe, RFerm, RHop, RMisc, RYeast, Yeast } from "./types";

export const lid = () => Math.random().toString(36).slice(2, 10);

export function newRecipe(equipment?: Equipment, brewer?: string): Recipe {
  const e = equipment || DEFAULT_EQUIPMENT[0];
  // no-sparge systems start with a no-sparge mash; the rest with a single infusion
  const noSparge = /no.?sparge|biab/i.test(e.name);
  return {
    version: 1, name: "Untitled Brew", brewer, type: /biab/i.test(e.name) ? "biab" : "all_grain",
    equipment: { ...e }, ferms: [], hops: [], yeasts: [], miscs: [], ibuMethod: "tinseth",
    mash: structuredClone(noSparge ? MASH_PROFILES[0] : MASH_PROFILES.find((m) => m.name.startsWith("Single Infusion, Medium"))!),
    water: { source: { ...RO_WATER }, target: { ...WATERS.find((w) => w.name.startsWith("Balanced"))! }, salts: { gypsum: 0, cacl2: 0, epsom: 0, nacl: 0, bakingSoda: 0, chalk: 0, lacticMl: 0 }, spargeSalts: true, lodo: e.lodo ? { on: true, smbMgL: 50 } : undefined },
    ferment: [{ name: "Primary", days: 14, tempF: 66 }],
    carb: { vols: 2.4, method: e.lodo ? "spund" : "keg", tempF: 38, harvest: !!e.lodo },
    starter: { liters: 2, stir: true },
  };
}

/** a recipe saved by an older version, or imported, filled out to today's shape */
export function normalize(r: Partial<Recipe>): Recipe {
  const base = newRecipe(r.equipment as Equipment | undefined);
  const e = { ...base.equipment, ...(r.equipment || {}) } as Equipment & { efficiency?: number };
  if (!e.mashEff && e.efficiency) e.mashEff = e.efficiency;
  return { ...base, ...r, equipment: e, water: { ...base.water, ...(r.water || {}), salts: { ...base.water.salts, ...(r.water?.salts || {}) } }, carb: { ...base.carb, ...(r.carb || {}) } } as Recipe;
}

export const asFerm = (f: Fermentable, lb = 1): RFerm => ({ ...strip(f), lid: lid(), lb });
export const asHop = (h: Hop, oz = 1, use: RHop["use"] = "boil", min = 60): RHop => ({ ...strip(h), lid: lid(), oz, use, min, tempF: use === "whirlpool" ? 180 : undefined, days: use === "dry_hop" ? 4 : undefined });
export const asYeast = (y: Yeast): RYeast => ({ ...strip(y), lid: lid(), packs: 1 });
export const asMisc = (m: Misc): RMisc => ({ ...strip(m), lid: lid(), amount: 1, unit: m.type === "fining" ? "each" : "oz", min: m.use === "boil" ? 15 : undefined });
const strip = <T extends object>(x: T) => { const { id: _id, ...rest } = x as T & { id?: string }; return rest as T; };

export const fmtDate = (d?: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }).toUpperCase() : "");
