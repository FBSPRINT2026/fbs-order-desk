import type { Group } from "@/lib/pricing";
/**
 * New garments land where a person would put them (Nov 1, Nick on a new quote: "it didn't fill in the first line. It
 * just added the other group… I dragged in three things"): the AI added each garment as a group of its own and left the
 * new quote's empty starter line. After the AI's changes, by code: garments in groups made this round, with no art of
 * their own, go into the order's empty group (its print kept) when it has one, else together in one group; empty starter
 * lines (no style, color or sizes) go once a group has real garments. Groups it named apart on purpose stay apart.
 */
export function tidyNewGroups(before: Group[], after: Group[]): Group[] {
  const blankLine = (l: Group["lines"][number]) => !String(l.style || "").trim() && !String(l.color || "").trim() && !Object.values(l.sizes || {}).some((n) => +(n || 0) > 0);
  const hasArt = (g: Group) => g.imprints.some((im) => im.design_id);
  const old = new Set(before.map((g) => g.id));
  // the groups made this round that belong together: no art of their own, and the same name as the first one (the AI
  // naming each "for this job"); groups it named apart on purpose ("a group for each") stay apart
  const fresh = after.filter((g) => !old.has(g.id) && !hasArt(g) && g.lines.some((l) => !blankLine(l)));
  const nm = (g: Group) => String(g.name || "").trim().toLowerCase();
  const made = fresh.filter((g) => nm(g) === nm(fresh[0] || g));
  if (made.length) {
    const home = after.find((g) => old.has(g.id) && g.lines.every(blankLine) && !hasArt(g)) || (made.length > 1 ? made[0] : null);
    if (home) {
      for (const g of made) if (g !== home) home.lines.push(...g.lines.filter((l) => !blankLine(l)));
      if (!home.name && made[0] !== home) home.name = made.find((g) => g.name)?.name || "";
      after = after.filter((g) => g === home || !made.includes(g));
    }
  }
  for (const g of after) if (g.lines.some((l) => !blankLine(l))) g.lines = g.lines.filter((l) => !blankLine(l));
  return after.filter((g) => g.lines.length || g.imprints.length);
}
