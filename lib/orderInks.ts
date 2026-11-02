import type { Group } from "@/lib/pricing";

/**
 * The inks already picked on an order (Nov 1, Nick: "I already made TYJ pink [a custom color on the front]… once you click
 * custom color again… drop down already using custom color on this order… so I can just select TYJ pink again"). Every ink
 * dropdown on the order shows them first, with where each one prints, so the same ink (a hand-matched custom, a PMS on the
 * front and back) is one click on the next print instead of being made again. Threads (embroidery) aren't inks: left out.
 */
export type OrderInk = { name: string; hex: string; where: string[] };
type Src = { where: string; method?: string; inks: { name: string; hex: string }[] };

export function orderInks(groups: Pick<Group, "id" | "name" | "imprints">[], live: Src[] = [], skipGroup = ""): OrderInk[] {
  const src: Src[] = [...live];
  const many = groups.length > 1;
  groups.forEach((g, gi) => {
    if (skipGroup && g.id === skipGroup) return;
    for (const im of g.imprints || []) {
      const m = im.inkMap?.design === im.design_id ? im.inkMap?.map : null;
      if (!m) continue;
      src.push({ where: `${many ? `${g.name?.trim() || `Group ${gi + 1}`} ` : ""}${im.location || "Print"}`, method: im.method, inks: Object.values(m) });
    }
  });
  const out = new Map<string, OrderInk>();
  for (const s of src) {
    if (s.method === "embroidery") continue;
    for (const k of s.inks) {
      const name = String(k?.name || "").trim();
      if (!name || name === "none") continue;
      const key = name.toLowerCase();
      const x = out.get(key) || { name, hex: k.hex || "", where: [] };
      if (!x.where.includes(s.where)) x.where.push(s.where);
      out.set(key, x);
    }
  }
  return [...out.values()];
}
