/**
 * Recipes that grow (Nick, Nov 24 2026). A recipe is one living thing; its versions are the changes meant to stay; a
 * brew's own changes stay on the brew. This file says what changed between two states of a recipe in plain words, so
 * nobody has to remember what v3 was, and groups imported copies ("Witstanbul v4", "Cankles (BBO 2025)") into one recipe.
 */
import { calcRecipe, r1 } from "./calc";
import type { Recipe } from "./types";

const lb = (x: number) => (x >= 1 ? `${r1(x, 2)} lb` : `${r1(x * 16, 1)} oz`);
const oz = (x: number) => `${r1(x, 2)} oz`;
const key = (s: string) => s.trim().toLowerCase();

/**
 * Every change from a to b, one short line each: ingredients first, then process, then the numbers that moved.
 * A version made for other equipment or another batch size is the same recipe scaled (Nick, Nov 24 2026: "a lot of
 * the different versions are just based on the equipment"): then it says so once, and the grain is compared as its
 * share of the grist and hops, additions and salts per gallon, so only real changes to the recipe are listed.
 */
export function diffRecipes(a: Recipe, b: Recipe): string[] {
  const out: string[] = [];
  const ga = a.equipment.batchGal || 5, gb = b.equipment.batchGal || 5, k = gb / ga;
  const scaled = Math.abs(k - 1) > 0.02 || a.equipment.name !== b.equipment.name;
  if (scaled) out.push(a.equipment.name !== b.equipment.name ? `Scaled to ${b.equipment.name} · ${r1(ga, 2)} → ${r1(gb, 2)} gal` : `Batch ${r1(ga, 2)} → ${r1(gb, 2)} gal`);
  // the same amount for this batch? (scaled by volume, within a few percent and a rounding)
  const same = (x: number, y: number, tol: number, min: number) => Math.abs(x * k - y) <= Math.max(min, Math.abs(y) * tol);
  // fermentables by name: by share of the grist when scaled, by weight otherwise
  const fa = new Map(a.ferms.map((f) => [key(f.name), f])), fb = new Map(b.ferms.map((f) => [key(f.name), f]));
  // percents of what gives sugar: rice hulls and the like add nothing, so they don't move every malt's share
  const grist = (f: Recipe["ferms"][number]) => f.potential > 1.001;
  const ta = a.ferms.filter(grist).reduce((s, f) => s + f.lb, 0) || 1, tb = b.ferms.filter(grist).reduce((s, f) => s + f.lb, 0) || 1;
  const pct = (x: number, tot: number) => `${r1((x / tot) * 100, 1)}%`;
  // the grist by percent (how it's designed); a whole bill made bigger or smaller at the same percents is one line
  for (const [n, f] of fb) {
    const o = fa.get(n);
    if (!o) out.push(`Added ${f.name} ${grist(f) ? pct(f.lb, tb) : lb(f.lb)}`);
    else if (grist(f) ? Math.abs(o.lb / ta - f.lb / tb) * 100 >= 1 : !same(o.lb, f.lb, 0.1, 0.05)) out.push(`${f.name} ${pct(o.lb, ta)} → ${pct(f.lb, tb)}`);
  }
  for (const [n, f] of fa) if (!fb.has(n)) out.push(`Took out ${f.name}`);
  const grow = tb / (ta * k);
  if (a.ferms.length && b.ferms.length && Math.abs(grow - 1) > 0.03) out.push(`Grain bill ${grow > 1 ? `${r1((grow - 1) * 100, 0)}% bigger` : `${r1((1 - grow) * 100, 0)}% smaller`}${scaled ? " for the batch" : ""} (${lb(ta)} → ${lb(tb)})`);
  // hops by name + use + time (the same hop at two times is two lines); amounts per batch, a's scaled to b's
  const hk = (h: Recipe["hops"][number]) => `${key(h.name)}|${h.use}|${h.use === "dry_hop" ? "" : h.min}`;
  const ha = new Map(a.hops.map((h) => [hk(h), h])), hb = new Map(b.hops.map((h) => [hk(h), h]));
  const when = (h: Recipe["hops"][number]) => (h.use === "dry_hop" ? "dry hop" : h.use === "whirlpool" ? `whirlpool ${h.min} min` : h.use === "first_wort" ? "first wort" : `${h.min} min`);
  const ozA = (x: number) => oz(x * k);
  for (const [n, h] of hb) {
    const o = ha.get(n);
    if (!o) {
      const moved = a.hops.find((x) => key(x.name) === key(h.name) && !hb.has(hk(x)));
      out.push(moved ? `${h.name} moved ${when(moved)} → ${when(h)}${same(moved.oz, h.oz, 0.08, 0.05) ? "" : `, ${ozA(moved.oz)} → ${oz(h.oz)}`}` : `Added ${h.name} ${oz(h.oz)} at ${when(h)}`);
    } else {
      if (!same(o.oz, h.oz, 0.08, 0.05)) out.push(`${h.name} (${when(h)}) ${ozA(o.oz)} → ${oz(h.oz)}`);
      if (Math.abs(o.alpha - h.alpha) > 0.05) out.push(`${h.name} alpha ${o.alpha}% → ${h.alpha}%`);
    }
  }
  for (const [n, h] of ha) if (!hb.has(n) && !b.hops.some((x) => key(x.name) === key(h.name) && !ha.has(hk(x)))) out.push(`Took out ${h.name} (${when(h)})`);
  // yeast, misc
  const ya = a.yeasts.map((y) => y.name).join(" + "), yb = b.yeasts.map((y) => y.name).join(" + ");
  if (ya !== yb) out.push(`Yeast ${ya || "none"} → ${yb || "none"}`);
  const ma = new Map(a.miscs.map((m) => [key(m.name), m])), mb = new Map(b.miscs.map((m) => [key(m.name), m]));
  for (const [n, m] of mb) { const o = ma.get(n); if (!o) out.push(`Added ${m.name} ${m.amount} ${m.unit}`); else if (!same(o.amount, m.amount, 0.08, 0.05)) out.push(`${m.name} ${r1(o.amount * k, 2)} → ${r1(m.amount, 2)} ${m.unit}`); }
  for (const [n, m] of ma) if (!mb.has(n)) out.push(`Took out ${m.name}`);
  // mash, water, fermentation
  const steps = (r: Recipe) => r.mash.steps.map((s) => `${r1(s.tempF, 0)}°F ${s.min} min`).join(", ");
  if (steps(a) !== steps(b)) out.push(`Mash ${steps(a)} → ${steps(b)}`);
  for (const s of ["gypsum", "cacl2", "epsom", "nacl", "bakingSoda", "chalk", "lacticMl"] as const) {
    const x = a.water.salts[s] || 0, y = b.water.salts[s] || 0;
    if (!same(x, y, 0.08, 0.1)) out.push(`${SALT_NAME[s]} ${r1(x * k, 1)} → ${r1(y, 1)} ${s === "lacticMl" ? "ml" : "g"}`);
  }
  const fs = (r: Recipe) => r.ferment.map((s) => `${s.name} ${s.days}d @ ${s.tempF}°F`).join(", ");
  if (fs(a) !== fs(b)) out.push(`Fermentation ${fs(a)} → ${fs(b)}`);
  if (Math.abs((a.carb?.vols || 0) - (b.carb?.vols || 0)) > 0.05) out.push(`Carbonation ${a.carb.vols} → ${b.carb.vols} vols`);
  // what it all did to the numbers (a scaled copy that hits the same numbers says nothing here)
  if (out.length) {
    const ca = calcRecipe(a), cb = calcRecipe(b), moved: string[] = [];
    if (Math.abs(ca.og - cb.og) >= 0.002) moved.push(`OG ${ca.og.toFixed(3)} → ${cb.og.toFixed(3)}`);
    if (Math.abs(ca.ibu - cb.ibu) >= 1.5) moved.push(`IBU ${r1(ca.ibu, 0)} → ${r1(cb.ibu, 0)}`);
    if (Math.abs(ca.srm - cb.srm) >= 0.5) moved.push(`SRM ${r1(ca.srm, 1)} → ${r1(cb.srm, 1)}`);
    if (moved.length) out.push(moved.join(" · "));
  }
  return out;
}
/** only the recipe changes, without the scaling line or the numbers that moved */
export const recipeChanges = (lines: string[]) => lines.filter((l) => !/^(Scaled to |Batch \d|OG |IBU |SRM )/.test(l));
const SALT_NAME = { gypsum: "Gypsum", cacl2: "Calcium chloride", epsom: "Epsom", nacl: "Salt", bakingSoda: "Baking soda", chalk: "Chalk", lacticMl: "Lactic acid" } as const;

/** a short "why" for a new version when nobody typed one: its first few changes */
export const autoNote = (lines: string[]) => {
  const real = recipeChanges(lines), scale = lines.find((l) => /^(Scaled to |Batch \d)/.test(l));
  if (!real.length) return scale || "No changes";
  return (scale ? `${scale}; ` : "") + real.slice(0, 3).join("; ") + (real.length > 3 ? "…" : "");
};

/**
 * The recipe a copy belongs to, and what its own label says. BeerSmith keeps each version as its own recipe
 * ("Witstanbul v4", "Blanche de Punk - v4", "AMAMBER 3.0", "Cankles (BBO 2025)"): version marks and bracketed
 * labels come off the end, so they all join the recipe they belong to, oldest first, each label kept as that version's note.
 */
export function baseName(name: string): { base: string; label: string } {
  let base = name.trim();
  const label: string[] = [];
  const take = (s: string) => { const x = s.trim().replace(/^\((.*)\)$/, "$1").trim(); if (x) label.unshift(x); };
  for (let i = 0; i < 6; i++) {
    const before = base;
    // a bracketed label, a version mark (v4, ver2, V3, 2.0) or a label after " - "
    const m = base.match(/\s*(?:\(([^()]*)\)|\[([^\]]*)\]|[-–:]?\s*\b(v(?:er(?:sion)?)?\.?\s?\d+(?:\.\d+)?[a-z]?)|\s(\d+\.\d+)|\s[-–]\s+([^-–]+))\s*$/i);
    if (m && m.index) { take(m[1] || m[2] || m[3] || m[4] || m[5] || ""); base = base.slice(0, m.index).replace(/[\s\-–:]+$/, ""); }
    // trailing words that are a competition, a round or a year ("NHC First Round 2020", "BBO 2025", "Rebirth II")
    const words = base.split(/\s+/);
    let k = words.length;
    while (k > 1 && LABEL_WORD.test(words[k - 1])) k--;
    if (k < words.length) { take(words.slice(k).join(" ")); base = words.slice(0, k).join(" "); }
    if (base === before) break;
  }
  return { base: base || name.trim(), label: label.join(" · ") };
}
const LABEL_WORD = /^(?:nhc|bbo|aha|first|final|round|rebrew|rebirth|reborn|return!?|ii|iii|iv|small|batch|test|article|(?:19|20)\d\d|['‘’]\d\d)$/i;
/** the key two copies of one recipe share: its base name without case or punctuation */
export const groupKey = (name: string) => baseName(name).base.toLowerCase().replace(/[^a-z0-9]+/g, "");
