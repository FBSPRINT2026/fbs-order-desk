/**
 * Planning a brew (Nick, Nov 24 2026: "make this recipe… I'm gonna brew it Friday… we need to get the ingredients… what
 * do we have… any minor substitutions… version one sub A… if it's a permanent change, then you would make it version
 * two"). One place for what a brew is made with: the version, the size, the substitutions on top of it, its name
 * ("v2 sub A") and the shopping list against what's on the shelf. Used by the Brew it planner, a planned brew's log and
 * the Inventory page's shopping list.
 */
import { calcRecipe, r1 } from "./calc";
import { FERMENTABLES, HOPS, MISCS, YEASTS } from "./library";
import type { Recipe } from "./types";

export type Kind = "fermentable" | "hop" | "yeast" | "misc";
/** one change for this brew: an ingredient swapped for another (same amount, hops kept at the same bitterness) or left out */
export type Sub = { kind: Kind; lid: string; from: string; to: string; out?: boolean };
export type BrewPlan = {
  /** "v2", "v2 sub A" */ label?: string;
  /** the brew before its swaps (the version at this size), so a swap can be undone */ base?: Recipe; versionNum?: number; sizeLabel?: string; subs?: Sub[];
  /** after tasting: the substitution became the next version, or stayed a one-time change */ kept?: "version" | "once"; keptNum?: number;
};
export type ShelfItem = { id: string; kind: string; name: string; data: Record<string, unknown>; in_stock: number | null };
export type ShopLine = { kind: Kind; name: string; want: number; have: number; buy: number; unit: string };

const LIB: Record<Kind, readonly { id: string; name: string }[]> = { fermentable: FERMENTABLES, hop: HOPS, yeast: YEASTS, misc: MISCS };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** what an ingredient name is: from the brewer's own shelf first, then the club's built-in library */
function lookup(kind: Kind, name: string, shelf: ShelfItem[]): Record<string, unknown> | null {
  const mine = shelf.find((i) => i.kind === kind && same(i.name, name));
  if (mine) return { ...mine.data, name: mine.name };
  const lib = LIB[kind].find((x) => same(x.name, name));
  if (lib) { const { id: _id, ...rest } = lib as { id: string }; return rest; }
  return null;
}

/** the recipe with this brew's substitutions made: a swapped malt keeps its share, a swapped hop keeps its bitterness */
export function applySubs(r: Recipe, subs: Sub[] = [], shelf: ShelfItem[] = []): Recipe {
  if (!subs.length) return r;
  const out: Recipe = structuredClone(r);
  for (const s of subs) {
    const key = s.kind === "fermentable" ? "ferms" : s.kind === "hop" ? "hops" : s.kind === "yeast" ? "yeasts" : "miscs";
    const list = out[key] as { lid: string; name: string }[];
    const i = list.findIndex((x) => x.lid === s.lid);
    if (i < 0) continue;
    if (s.out) { list.splice(i, 1); continue; }
    const to = s.to.trim();
    if (!to) continue;
    const props = lookup(s.kind, to, shelf) || {};
    const cur = list[i] as Record<string, unknown>;
    const next: Record<string, unknown> = { ...cur, ...props, name: to, lid: cur.lid };
    // keep what this line is in the recipe: its amount, timing and use, not the library's defaults
    for (const k of ["lb", "pct", "late", "oz", "use", "min", "tempF", "days", "packs", "starter", "amount", "unit"]) if (k in cur) next[k] = cur[k];
    if (s.kind === "hop") {
      const a0 = Number(cur.alpha) || 0, a1 = Number(next.alpha) || a0;
      if (a0 && a1 && a1 !== a0) next.oz = r1((Number(cur.oz) || 0) * (a0 / a1), 2);
    }
    list[i] = next as never;
  }
  return out;
}

/** "Flaked oats → Quick oats", "No coriander" */
export const subText = (s: Sub) => (s.out ? `No ${s.from}` : `${s.from} → ${s.to}`);

/** a brew's name: its version, and "sub A", "sub B"… when it was brewed with substitutions (letters per version) */
export function planLabel(versionNum: number | undefined, subs: Sub[] | undefined, earlierSubBrews: number) {
  const v = versionNum ? `v${versionNum}` : "Working copy";
  return subs?.length ? `${v} sub ${String.fromCharCode(65 + Math.min(25, earlierSubBrews))}` : v;
}

/** what the recipe calls for against what's on the shelf (rice hulls and other aids included; yeast at least one pack) */
export function shoppingList(r: Recipe, shelf: ShelfItem[]): ShopLine[] {
  const lines: ShopLine[] = [];
  const have = (kind: Kind, name: string) => shelf.find((i) => i.kind === kind && same(i.name, name))?.in_stock || 0;
  const push = (kind: Kind, name: string, want: number, unit: string) => {
    const l = lines.find((x) => x.kind === kind && same(x.name, name));
    if (l) l.want += want; else lines.push({ kind, name, want, have: have(kind, name), buy: 0, unit });
  };
  r.ferms.forEach((f) => push("fermentable", f.name, f.lb, "lb"));
  r.hops.forEach((h) => push("hop", h.name, h.oz, "oz"));
  r.yeasts.forEach((y) => push("yeast", y.name, Math.max(1, y.packs || 1), "pk"));
  r.miscs.forEach((m) => push("misc", m.name, m.amount, m.unit || ""));
  for (const l of lines) { l.want = r1(l.want, 2); l.buy = Math.max(0, r1(l.want - l.have, 2)); }
  return lines;
}

/** the shopping list as text to share or paste into a phone's reminders */
export function shoppingText(name: string, when: string, lines: ShopLine[]) {
  const buy = lines.filter((l) => l.buy > 0);
  return [`${name} · brewing ${when}`, ...(buy.length ? buy.map((l) => `- ${l.name}: ${l.buy}${l.unit ? " " + l.unit : ""}`) : ["Everything's on the shelf"])].join("\n");
}

/** a liquid yeast wants a starter a day or two ahead */
export function starterDay(r: Recipe, brewDay: string): string | null {
  if (!r.yeasts.some((y) => y.form === "liquid" || y.starter)) return null;
  const d = new Date(brewDay + "T12:00:00");
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

/** the numbers that say whether it's still the same beer */
export const quickNums = (r: Recipe) => { const c = calcRecipe(r); return { og: c.og, ibu: c.ibu, srm: c.srm, abv: c.abv }; };
