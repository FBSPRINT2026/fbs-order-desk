import type { Group, Imprint } from "@/lib/pricing";

/**
 * Reorder - Production Details Needed. A reorder of an old Printavo job comes in with our best guess at the print
 * size and inks (off the film or the old mockup), flagged on the print (Imprint.confirm). Production (Jose) checks it
 * against what we printed before and confirms, corrects or leaves it blank (Production Details). Until then:
 *  - staff see "Reorder - Production Details Needed" on the order, in the order list and on the dashboards;
 *  - the customer sees the print specs greyed out, marked REORDER (nothing is blocked);
 *  - the work order / Printavo say it on the print.
 * The flag lives on the imprints (orders.groups), so nothing new is needed in the database.
 */
export const DETAILS_LABEL = "Reorder - Production Details Needed";
export const DETAILS_SHORT = "Details needed";

export const needsDetails = (im: Pick<Imprint, "confirm"> | null | undefined) => !!im?.confirm && (!!im.confirm.size || !!im.confirm.ink);
export const orderNeedsDetails = (groups: Pick<Group, "imprints">[] | null | undefined) => (groups || []).some((g) => (g.imprints || []).some(needsDetails));
export const detailsCount = (groups: Pick<Group, "imprints">[] | null | undefined) => (groups || []).reduce((n, g) => n + (g.imprints || []).filter(needsDetails).length, 0);

/** the orders with a print waiting on production details (jsonb contains: one query per flag, merged). The filter goes
 *  as JSON text: an array of objects was sent as `{[object Object]}` and every lookup failed (found Oct 16). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ordersNeedingDetails<T extends { id: string }>(sb: any, cols: string): Promise<T[]> {
  const q = (flag: "size" | "ink") => sb.from("orders").select(cols).neq("status", "completed").contains("groups", JSON.stringify([{ imprints: [{ confirm: { [flag]: true } }] }])).limit(300);
  const [a, b] = await Promise.all([q("size"), q("ink")]);
  const seen = new Set<string>(), out: T[] = [];
  for (const r of [...((a.data || []) as T[]), ...((b.data || []) as T[])]) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
  return out;
}

/**
 * An order editor left open while production confirmed: its copy still has the flags. Before it saves, the prints
 * production confirmed since are taken from the saved order, so the editor can't put the flag back.
 */
export function keepConfirmed(local: Group[], saved: Pick<Group, "id" | "imprints">[] | null | undefined): { groups: Group[]; changed: boolean } {
  if (!saved?.length || !orderNeedsDetails(local)) return { groups: local, changed: false };
  const done = new Map<string, Imprint>();
  for (const g of saved) for (const im of g.imprints || []) if (im.confirmed && !needsDetails(im)) done.set(im.id, im);
  if (!done.size) return { groups: local, changed: false };
  let changed = false;
  const groups = local.map((g) => ({
    ...g,
    imprints: g.imprints.map((im) => {
      const s = needsDetails(im) ? done.get(im.id) : undefined;
      if (!s) return im;
      changed = true;
      // the confirmed details, keeping anything else changed here (art, location, notes)
      return { ...im, size: s.size, inks: s.inks, colors: s.colors, underbase: s.underbase, drop: s.drop, sizeFrom: s.sizeFrom, remake: s.remake, notes: s.notes, design_id: s.design_id || im.design_id, confirm: undefined, confirmed: s.confirmed };
    }),
  }));
  return { groups, changed };
}

/** What production fills in for one print. Blank = left blank (not known). */
export type DetailsInput = { id: string; size: string; inks: string; colors: number; underbase: "" | "yes" | "no"; drop: string; screensOnFile: boolean; notes: string };
