import type { Group } from "@/lib/pricing";

/**
 * Options on a quote (Nick, Nov 19 2026: "when we send somebody a quote sometimes we need to give them options… he wants to
 * see black and heather black… he just needs to approve an option A or an option B… we should be able to do more than just
 * change colors… change thread or change the designs… they wanna go with 50 instead of 100… I want to just send them the
 * options and then they can pick for approval").
 *
 * A choice is the groups that share `Group.opt.set`: Option A, B, C… in the order they sit on the order. Any group can
 * have options (+ Add option on the order page copies it as the next option, and staff change whatever differs: color,
 * style, quantity, thread, inks, design). Until the customer picks, only the first option of each choice counts in the
 * order's total (calcOrder skips the others but still prices each one on its own, so each option shows its own price).
 * Picking (the customer approving on their order page or portal, or staff approving by hand) keeps the picked option,
 * takes the others off the order (kept in its history) and the order is an ordinary order from then on.
 */
export type OptionPick = Record<string, string>; // choice (set) → the picked group's id

export const optLetter = (i: number) => String.fromCharCode(65 + Math.max(0, Math.min(25, i)));

export type Choice = { set: string; options: { g: Group; gi: number; letter: string; label: string }[] };

/** the order's choices, each with its options in order (a set with one group left is no choice) */
export function choicesOf(groups: Group[] | null | undefined): Choice[] {
  const by = new Map<string, Choice>();
  (groups || []).forEach((g, gi) => {
    const set = g.opt?.set;
    if (!set) return;
    const c = by.get(set) || { set, options: [] };
    c.options.push({ g, gi, letter: optLetter(c.options.length), label: (g.opt?.label || "").trim() });
    by.set(set, c);
  });
  return [...by.values()].filter((c) => c.options.length > 1);
}

/** the groups that don't count yet: every option of a choice but its first */
export function offOptions(groups: Group[] | null | undefined): Set<number> {
  const off = new Set<number>();
  for (const c of choicesOf(groups)) for (const o of c.options.slice(1)) off.add(o.gi);
  return off;
}

/** what an option is called: "Option B · Heather Black" */
export function optionName(o: { letter: string; label: string }) {
  return `Option ${o.letter}${o.label ? ` · ${o.label}` : ""}`;
}

/** a group's option letter and label, when it is one ("B", "Heather Black") */
export function optionOf(groups: Group[] | null | undefined, gi: number) {
  for (const c of choicesOf(groups)) { const o = c.options.find((x) => x.gi === gi); if (o) return { ...o, set: c.set, of: c.options.length }; }
  return null;
}

/** the order with this group first in its choice: what it comes to if the customer picks it */
export function withPicked<T extends { groups?: Group[] | null }>(o: T, groupId: string): T {
  const gs = [...(o.groups || [])];
  const i = gs.findIndex((g) => g.id === groupId), set = gs[i]?.opt?.set;
  if (i < 0 || !set) return o;
  const first = gs.findIndex((g) => g.opt?.set === set);
  if (first === i) return o;
  const [g] = gs.splice(i, 1);
  gs.splice(first, 0, g);
  return { ...o, groups: gs };
}

/**
 * The groups once the picks are made: each choice keeps its picked option (no longer an option) and drops the rest.
 * Every choice needs a pick; returns the missing ones' first option name when one isn't picked.
 */
export function applyPicks(groups: Group[], picks: OptionPick): { ok: true; groups: Group[]; kept: Group[]; dropped: Group[] } | { ok: false; missing: string } {
  const cs = choicesOf(groups);
  for (const c of cs) if (!c.options.some((o) => o.g.id === picks[c.set])) return { ok: false, missing: c.options.map(optionName).join(" or ") };
  const keep = new Set(cs.map((c) => picks[c.set])), inChoice = new Set(cs.flatMap((c) => c.options.map((o) => o.g.id)));
  const out: Group[] = [], kept: Group[] = [], dropped: Group[] = [];
  for (const g of groups) {
    if (!inChoice.has(g.id)) { out.push(g); continue; }
    if (keep.has(g.id)) { const { opt: _o, ...rest } = g; void _o; out.push(rest as Group); kept.push(g); } else dropped.push(g);
  }
  return { ok: true, groups: out, kept, dropped };
}

/** a copy of a group as the next option of its choice (new ids; its mockup to be made again for what changes) */
export function copyAsOption(g: Group, uid: () => string, label = ""): { src: Group; copy: Group } {
  const set = g.opt?.set || uid();
  const src: Group = { ...g, opt: { set, label: g.opt?.label || "" } };
  const c = structuredClone(g) as Group;
  const copy: Group = {
    ...c, id: uid(), opt: { set, label },
    lines: (c.lines || []).map((l) => ({ ...l, id: uid() })),
    imprints: (c.imprints || []).map((d) => ({ ...d, id: uid(), changeOf: undefined })),
  };
  delete (copy as { mockupArt?: unknown }).mockupArt;
  return { src, copy };
}
