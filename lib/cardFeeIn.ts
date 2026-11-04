import { CARD } from "@/lib/printavoChanges";

/**
 * The credit card fee already inside an invoice's balance (Nov 4, Nick: "invoices that already have the Printavo 3% CC
 * fee shouldn't get it again… sometimes the ones in Printavo sent it back… if you detect it as a line item anywhere, you've
 * got to deduct it"). Found anywhere it can be: a fee or a line, on an old Printavo invoice or on one of ours that synced
 * to Printavo and came back with it.
 * - paid by card: no new card fee on that invoice;
 * - paid by ACH (no card fee at all): that amount comes off what's owed.
 * Never more than the invoice still owes.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const isCard = (...t: unknown[]) => t.some((x) => typeof x === "string" && CARD.test(x));

type FeeLike = { label?: string; description?: string; amount?: number | string | "" | null; free?: boolean; tbd?: boolean };
type OurLine = { garment?: string; style?: string; priceOverride?: number | null; sizes?: Record<string, number | undefined> };
type OldLine = { description?: string; itemNumber?: string; price?: number | string; items?: number | string };

/** our order: its fees, and any line that is really the surcharge */
export function cardFeeInOrder(o: { fees?: FeeLike[] | null; groups?: { lines?: OurLine[] }[] | null }, balance: number): number {
  let n = 0;
  for (const f of o.fees || []) if (!f.free && !f.tbd && isCard(f.label, f.description)) n += +(f.amount || 0) || 0;
  for (const g of o.groups || []) for (const l of g.lines || []) if (isCard(l.garment, l.style)) n += (+(l.priceOverride || 0) || 0) * Object.values(l.sizes || {}).reduce((a: number, q) => a + (+(q || 0) || 0), 0);
  return r2(Math.max(0, Math.min(n, balance)));
}

/** an old Printavo invoice (archived_orders.data): its fees and its lines */
export function cardFeeInOld(data: { fees?: FeeLike[] | null; groups?: { lines?: OldLine[] }[] | null } | null | undefined, balance: number): number {
  if (!data) return 0;
  let n = 0;
  for (const f of data.fees || []) if (isCard(f.description, f.label)) n += +(f.amount || 0) || 0;
  for (const g of data.groups || []) for (const l of g.lines || []) if (isCard(l.description, l.itemNumber)) n += (+(l.price || 0) || 0) * (+(l.items || 1) || 1);
  return r2(Math.max(0, Math.min(n, balance)));
}
