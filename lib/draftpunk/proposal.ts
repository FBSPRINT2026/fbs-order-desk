/**
 * A recipe as the AI writes it (the assistant, best-ever recipes, a photo of a book page; Nick, Nov 24 2026), and the
 * one function that turns it into a real recipe on the brewer's equipment. The AI thinks the way Nick designs: grain
 * by percent with a target OG, hops by when and how much bitterness, so the recipe works on any system: pounds come
 * from the equipment's volumes and mash efficiency, hop ounces from the IBU target.
 */
import { calcRecipe, fromPercents } from "./calc";
import { asFerm, asHop, asMisc, asYeast, newRecipe } from "./defaults";
import { FERMENTABLES, HOPS, MISCS, YEASTS } from "./library";
import type { Equipment, Fermentable, Hop, HopUse, Misc, Recipe, Yeast } from "./types";

export type Proposal = {
  name: string; styleId?: string; goal?: "house" | "competition";
  og: number; fg?: number; ibu: number; srm?: number;
  ferms: { name: string; pct: number }[];
  hops: { name: string; use: HopUse; min?: number; days?: number; tempF?: number; oz?: number; alpha?: number }[];
  yeasts: { name: string; tempF?: number }[];
  miscs?: { name: string; amount: number; unit: string; use?: string; min?: number }[];
  mash?: { name?: string; tempF: number; min: number }[];
  ferment?: { name: string; days: number; tempF: number }[];
  water?: { ca?: number; mg?: number; na?: number; so4?: number; cl?: number; hco3?: number; name?: string };
  carbVols?: number;
  notes?: string;
};

/** the JSON shape the AI is asked for (a tool's input schema) */
export const PROPOSAL_SCHEMA = {
  type: "object", required: ["name", "og", "ibu", "ferms", "hops", "yeasts"],
  properties: {
    name: { type: "string" }, styleId: { type: "string", description: "BJCP 2021 id like 4B, 6A, 21A, 21B-WH" }, goal: { type: "string", enum: ["house", "competition"] },
    og: { type: "number", description: "target original gravity, e.g. 1.058" }, fg: { type: "number" }, ibu: { type: "number", description: "target total IBU (Tinseth)" }, srm: { type: "number" },
    ferms: { type: "array", description: "the grain bill by percent; percents add to 100", items: { type: "object", required: ["name", "pct"], properties: { name: { type: "string", description: "maltster and malt, e.g. 'Weyermann Munich II'" }, pct: { type: "number" } } } },
    hops: { type: "array", items: { type: "object", required: ["name", "use"], properties: { name: { type: "string" }, use: { type: "string", enum: ["boil", "first_wort", "whirlpool", "dry_hop", "mash"] }, min: { type: "number", description: "boil or whirlpool minutes" }, days: { type: "number", description: "dry hop days" }, tempF: { type: "number", description: "whirlpool temperature" }, oz: { type: "number", description: "ounces for a 5.5 gal batch; the bittering ounces are scaled to hit the IBU target" }, alpha: { type: "number" } } } },
    yeasts: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string", description: "lab, code and name, e.g. 'White Labs WLP833 German Bock'" }, tempF: { type: "number" } } } },
    miscs: { type: "array", items: { type: "object", required: ["name", "amount", "unit"], properties: { name: { type: "string" }, amount: { type: "number" }, unit: { type: "string" }, use: { type: "string" }, min: { type: "number" } } } },
    mash: { type: "array", items: { type: "object", required: ["tempF", "min"], properties: { name: { type: "string" }, tempF: { type: "number" }, min: { type: "number" } } } },
    ferment: { type: "array", items: { type: "object", required: ["name", "days", "tempF"], properties: { name: { type: "string" }, days: { type: "number" }, tempF: { type: "number" } } } },
    water: { type: "object", description: "target water profile in ppm", properties: { name: { type: "string" }, ca: { type: "number" }, mg: { type: "number" }, na: { type: "number" }, so4: { type: "number" }, cl: { type: "number" }, hco3: { type: "number" } } },
    carbVols: { type: "number" }, notes: { type: "string", description: "how to brew it and why it's built this way, a few lines" },
  },
} as const;

const norm = (s: string) => s.toLowerCase().replace(/®|™/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** the library item a written name means: exact, then one name inside the other, then the most shared words */
export function findIn<T extends { name: string; lab?: string; code?: string }>(list: T[], name: string): T | undefined {
  const n = norm(name);
  const full = (x: T) => norm([x.lab, x.code, x.name].filter(Boolean).join(" "));
  const exact = list.find((x) => norm(x.name) === n || full(x) === n);
  if (exact) return exact;
  const code = n.match(/\b(wlp\s?\d{3}|wy\s?\d{4}|\d{4}|[a-z]{1,3}-?\d{2,3})\b/)?.[1]?.replace(/\s/g, "");
  if (code) { const c = list.find((x) => x.code && norm(x.code).replace(/\s/g, "") === code); if (c) return c; }
  const inside = list.find((x) => n.includes(norm(x.name)) && norm(x.name).length > 3) || list.find((x) => norm(x.name).includes(n));
  if (inside) return inside;
  const words = new Set(n.split(" ").filter((w) => w.length > 2));
  let best: T | undefined, score = 0;
  for (const x of list) { const s = full(x).split(" ").filter((w) => words.has(w)).length; if (s > score) { best = x; score = s; } }
  // most of the written words must match (a lab name alone never picks a yeast); otherwise it is its own item
  return score >= Math.max(2, words.size - 1) ? best : undefined;
}

/** a malt the library doesn't have, from its name: crystal / caramel 60 is 60 °L, a sugar is all sugar */
function guessFermentable(name: string): Fermentable {
  const l = name.match(/(\d+)\s*°?\s*l\b/i)?.[1] || name.match(/(?:crystal|caramel|cara)\D*(\d+)/i)?.[1];
  if (/sugar|dextrose|honey|candi|syrup/i.test(name)) return { name, type: "sugar", potential: 1.046, color: Number(l) || 1 };
  return { name, type: "grain", potential: /wheat/i.test(name) ? 1.038 : 1.036, color: Number(l) || (/munich/i.test(name) ? 9 : /vienna/i.test(name) ? 4 : /chocolate|black|roast/i.test(name) ? 400 : 2.5) };
}

export type Libs = { fermentable?: Fermentable[]; hop?: Hop[]; yeast?: Yeast[]; misc?: Misc[] };

/** a proposal as a recipe on this equipment */
export function buildRecipe(p: Proposal, equipment: Equipment, libs: Libs = {}, brewer?: string): Recipe {
  const r = newRecipe(equipment, brewer);
  r.name = p.name || "New recipe";
  r.styleId = p.styleId;
  const F = [...FERMENTABLES, ...(libs.fermentable || [])], H = [...HOPS, ...(libs.hop || [])], Y = [...YEASTS, ...(libs.yeast || [])], M = [...MISCS, ...(libs.misc || [])];
  r.ferms = p.ferms.filter((f) => f.pct > 0).map((f) => ({ ...asFerm(findIn(F, f.name) || guessFermentable(f.name), 1), pct: f.pct }));
  r.byPercent = { on: true, targetOg: p.og || 1.05 };
  r.hops = p.hops.map((h) => {
    const lib = findIn(H, h.name) || { name: h.name, alpha: h.alpha || 5, form: "pellet" as const };
    const x = asHop({ ...lib, alpha: h.alpha || lib.alpha }, h.oz || (h.use === "dry_hop" ? 2 : 1), h.use, h.use === "dry_hop" ? 0 : h.min ?? (h.use === "boil" ? 60 : 20));
    if (h.use === "whirlpool" && h.tempF) x.tempF = h.tempF;
    if (h.use === "dry_hop") x.days = h.days || 4;
    return x;
  });
  r.yeasts = p.yeasts.slice(0, 2).map((y) => asYeast(findIn(Y, y.name) || { name: y.name, form: "liquid", attenuation: 75 }));
  r.miscs = (p.miscs || []).map((m) => ({ ...asMisc(findIn(M, m.name) || { name: m.name, type: "other", use: "boil" }), amount: m.amount, unit: m.unit, min: m.min }));
  if (p.mash?.length) r.mash = { ...r.mash, steps: p.mash.map((s, i) => ({ name: s.name || (i === p.mash!.length - 1 && s.tempF >= 165 ? "Mash Out" : "Rest"), kind: r.mash.sparge === "none" ? "temperature" : "infusion", tempF: s.tempF, min: s.min })) };
  if (p.ferment?.length) r.ferment = p.ferment;
  if (p.water && (p.water.so4 || p.water.cl || p.water.ca)) r.water.target = { name: p.water.name || "Assistant's target", ca: p.water.ca || 0, mg: p.water.mg || 0, na: p.water.na || 0, so4: p.water.so4 || 0, cl: p.water.cl || 0, hco3: p.water.hco3 || 0 };
  if (p.carbVols) r.carb = { ...r.carb, vols: p.carbVols };
  if (p.notes) r.notes = p.notes;
  return hitIbu(fromPercents(r), p.ibu);
}

/** the bittering hops (boil, first wort, whirlpool) scaled together so the recipe hits its IBU target */
export function hitIbu(r: Recipe, ibu: number): Recipe {
  if (!ibu) return r;
  for (let i = 0; i < 4; i++) {
    const c = calcRecipe(r);
    if (!c.ibu || Math.abs(c.ibu - ibu) < 0.5) break;
    const f = ibu / c.ibu;
    r = { ...r, hops: r.hops.map((h) => (h.use === "dry_hop" || h.use === "mash" ? h : { ...h, oz: Math.round(h.oz * f * 100) / 100 })) };
  }
  return r;
}

/** a recipe as a proposal (so the AI reads what the brewer has, in the same terms it writes) */
export function asProposal(r: Recipe): Proposal {
  const c = calcRecipe(r), total = r.ferms.reduce((t, f) => t + f.lb, 0) || 1;
  return {
    name: r.name, styleId: r.styleId, og: Math.round(c.og * 1000) / 1000, fg: Math.round(c.fg * 1000) / 1000, ibu: Math.round(c.ibu), srm: Math.round(c.srm * 10) / 10,
    ferms: r.ferms.map((f) => ({ name: f.name, pct: Math.round((f.lb / total) * 1000) / 10 })),
    hops: r.hops.map((h) => ({ name: h.name, use: h.use, min: h.min, days: h.days, tempF: h.tempF, oz: h.oz, alpha: h.alpha })),
    yeasts: r.yeasts.map((y) => ({ name: [y.lab, y.code, y.name].filter(Boolean).join(" ") })),
    miscs: r.miscs.map((m) => ({ name: m.name, amount: m.amount, unit: m.unit, use: m.use, min: m.min })),
    mash: r.mash.steps.map((s) => ({ name: s.name, tempF: s.tempF, min: s.min })), ferment: r.ferment,
    water: r.water.target ? { name: r.water.target.name, ca: r.water.target.ca, mg: r.water.target.mg, na: r.water.target.na, so4: r.water.target.so4, cl: r.water.target.cl, hco3: r.water.target.hco3 } : undefined,
    carbVols: r.carb.vols,
  };
}

/** the proposal's ingredients and process put on the brewer's recipe, keeping its name, equipment and notes */
export function applyProposal(r: Recipe, p: Proposal, libs: Libs = {}): Recipe {
  const built = buildRecipe({ ...p, name: r.name, styleId: p.styleId || r.styleId }, r.equipment, libs, r.brewer);
  return { ...built, notes: r.notes, byPercent: r.byPercent?.on ? built.byPercent : undefined, ferms: r.byPercent?.on ? built.ferms : built.ferms.map((f) => ({ ...f, pct: undefined })) };
}
