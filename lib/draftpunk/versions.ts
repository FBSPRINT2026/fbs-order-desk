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

/** every change from a to b, one short line each: ingredients first, then process, then the numbers that moved */
export function diffRecipes(a: Recipe, b: Recipe): string[] {
  const out: string[] = [];
  // fermentables by name
  const fa = new Map(a.ferms.map((f) => [key(f.name), f])), fb = new Map(b.ferms.map((f) => [key(f.name), f]));
  for (const [k, f] of fb) {
    const o = fa.get(k);
    if (!o) out.push(`Added ${f.name} ${lb(f.lb)}`);
    else if (Math.abs(o.lb - f.lb) > 0.01) out.push(`${f.name} ${lb(o.lb)} → ${lb(f.lb)}`);
  }
  for (const [k, f] of fa) if (!fb.has(k)) out.push(`Took out ${f.name}`);
  // hops by name + use + time (the same hop at two times is two lines)
  const hk = (h: Recipe["hops"][number]) => `${key(h.name)}|${h.use}|${h.use === "dry_hop" ? "" : h.min}`;
  const ha = new Map(a.hops.map((h) => [hk(h), h])), hb = new Map(b.hops.map((h) => [hk(h), h]));
  const when = (h: Recipe["hops"][number]) => (h.use === "dry_hop" ? "dry hop" : h.use === "whirlpool" ? `whirlpool ${h.min} min` : h.use === "first_wort" ? "first wort" : `${h.min} min`);
  for (const [k, h] of hb) {
    const o = ha.get(k);
    if (!o) {
      const moved = a.hops.find((x) => key(x.name) === key(h.name) && !hb.has(hk(x)));
      out.push(moved ? `${h.name} moved ${when(moved)} → ${when(h)}${Math.abs(moved.oz - h.oz) > 0.01 ? `, ${oz(moved.oz)} → ${oz(h.oz)}` : ""}` : `Added ${h.name} ${oz(h.oz)} at ${when(h)}`);
    } else {
      if (Math.abs(o.oz - h.oz) > 0.01) out.push(`${h.name} (${when(h)}) ${oz(o.oz)} → ${oz(h.oz)}`);
      if (Math.abs(o.alpha - h.alpha) > 0.05) out.push(`${h.name} alpha ${o.alpha}% → ${h.alpha}%`);
    }
  }
  for (const [k, h] of ha) if (!hb.has(k) && !b.hops.some((x) => key(x.name) === key(h.name) && !ha.has(hk(x)))) out.push(`Took out ${h.name} (${when(h)})`);
  // yeast, misc
  const ya = a.yeasts.map((y) => y.name).join(" + "), yb = b.yeasts.map((y) => y.name).join(" + ");
  if (ya !== yb) out.push(`Yeast ${ya || "none"} → ${yb || "none"}`);
  const ma = new Map(a.miscs.map((m) => [key(m.name), m])), mb = new Map(b.miscs.map((m) => [key(m.name), m]));
  for (const [k, m] of mb) { const o = ma.get(k); if (!o) out.push(`Added ${m.name} ${m.amount} ${m.unit}`); else if (o.amount !== m.amount) out.push(`${m.name} ${o.amount} → ${m.amount} ${m.unit}`); }
  for (const [k, m] of ma) if (!mb.has(k)) out.push(`Took out ${m.name}`);
  // mash, water, fermentation
  const steps = (r: Recipe) => r.mash.steps.map((s) => `${r1(s.tempF, 0)}°F ${s.min} min`).join(", ");
  if (steps(a) !== steps(b)) out.push(`Mash ${steps(a)} → ${steps(b)}`);
  for (const s of ["gypsum", "cacl2", "epsom", "nacl", "bakingSoda", "chalk", "lacticMl"] as const) {
    const x = a.water.salts[s] || 0, y = b.water.salts[s] || 0;
    if (Math.abs(x - y) > 0.05) out.push(`${SALT_NAME[s]} ${r1(x, 1)} → ${r1(y, 1)} ${s === "lacticMl" ? "ml" : "g"}`);
  }
  const fs = (r: Recipe) => r.ferment.map((s) => `${s.name} ${s.days}d @ ${s.tempF}°F`).join(", ");
  if (fs(a) !== fs(b)) out.push(`Fermentation ${fs(a)} → ${fs(b)}`);
  if (Math.abs(a.equipment.batchGal - b.equipment.batchGal) > 0.01) out.push(`Batch ${r1(a.equipment.batchGal, 2)} → ${r1(b.equipment.batchGal, 2)} gal`);
  if (a.equipment.name !== b.equipment.name) out.push(`Equipment ${a.equipment.name} → ${b.equipment.name}`);
  if (Math.abs((a.carb?.vols || 0) - (b.carb?.vols || 0)) > 0.05) out.push(`Carbonation ${a.carb.vols} → ${b.carb.vols} vols`);
  // what it all did to the numbers
  if (out.length) {
    const ca = calcRecipe(a), cb = calcRecipe(b), moved: string[] = [];
    if (Math.abs(ca.og - cb.og) >= 0.001) moved.push(`OG ${ca.og.toFixed(3)} → ${cb.og.toFixed(3)}`);
    if (Math.abs(ca.ibu - cb.ibu) >= 1) moved.push(`IBU ${r1(ca.ibu, 0)} → ${r1(cb.ibu, 0)}`);
    if (Math.abs(ca.srm - cb.srm) >= 0.5) moved.push(`SRM ${r1(ca.srm, 1)} → ${r1(cb.srm, 1)}`);
    if (moved.length) out.push(moved.join(" · "));
  }
  return out;
}
const SALT_NAME = { gypsum: "Gypsum", cacl2: "Calcium chloride", epsom: "Epsom", nacl: "Salt", bakingSoda: "Baking soda", chalk: "Chalk", lacticMl: "Lactic acid" } as const;

/** a short "why" for a new version when nobody typed one: its first few changes */
export const autoNote = (lines: string[]) => (lines.length ? lines.filter((l) => !/^OG |^IBU |^SRM /.test(l)).slice(0, 3).join("; ") + (lines.length > 4 ? "…" : "") : "No changes");

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
