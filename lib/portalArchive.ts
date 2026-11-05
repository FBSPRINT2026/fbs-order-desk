import "server-only";
import { cardFeeInOld } from "@/lib/cardFeeIn";
import { allRows } from "@/lib/readAll";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvTransaction } from "@/lib/archive";
import type { AOrder, APayment } from "@/components/AccountAreas";

/**
 * A customer's old (Printavo) orders in the portal, in two parts (Nov 5, Nick: "Cedar Promos… their site is painting
 * pretty slow"). Cedar has 2,337 old orders, and the page sent every one (4.3 MB) before it could draw. Now the page
 * draws with the newest ones plus every one with a balance (so what's owed, the aging and Pay are whole from the start),
 * and the rest arrive just after it's on screen (AccountAreas `moreOrders`). Any account with a long history gains;
 * small ones get everything in the first part, as before.
 */
export const FIRST_OLD = 150;
export type OldRow = ArchiveSummary & { transactions: PvTransaction[] | null };

const cols = `${ARCHIVE_LIST_COLS}, search:search_text, transactions:data->transactions`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** the first part: the newest FIRST_OLD, every owed invoice, and whether there are more */
export async function oldOrdersFirst(admin: Admin, cids: string[]): Promise<{ rows: OldRow[]; more: boolean }> {
  const base = () => admin.from("archived_orders").select(cols).is("removed_at", null).in("customer_id", cids);
  const [{ data: top }, { data: owed }, { count }] = await Promise.all([
    base().order("order_date", { ascending: false }).order("id").range(0, FIRST_OLD - 1),
    allRows((ra, rb) => base().eq("kind", "invoice").gt("balance", 0.004).order("id").range(ra, rb)),
    admin.from("archived_orders").select("id", { count: "exact", head: true }).is("removed_at", null).in("customer_id", cids),
  ]);
  const seen = new Set<string>(), rows: OldRow[] = [];
  for (const r of [...((top || []) as OldRow[]), ...((owed || []) as OldRow[])]) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  rows.sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""));
  return { rows, more: (count || 0) > rows.length };
}

/** the rest: everything past the newest FIRST_OLD that the first part didn't already send (owed ones) */
export async function oldOrdersRest(admin: Admin, cids: string[]): Promise<OldRow[]> {
  const { data } = await allRows<OldRow>((ra, rb) => admin.from("archived_orders").select(cols).is("removed_at", null).in("customer_id", cids)
    .order("order_date", { ascending: false }).order("id").range(ra + FIRST_OLD, rb + FIRST_OLD));
  return (data || []).filter((a) => !(a.kind === "invoice" && +a.balance > 0.004));
}

/** old orders as the account's order and payment rows: pay links and card fees for owed ones, and what was paid here */
export async function oldOrderRows(admin: Admin, archived: OldRow[], o: { href: (id: string) => string; movedIds: Set<string> }): Promise<{ orders: AOrder[]; payments: APayment[]; payUrls: Record<string, string> }> {
  const owedArch = archived.filter((a) => a.kind === "invoice" && +a.balance > 0.004).map((a) => a.id);
  const payUrls: Record<string, string> = {}, feeIns: Record<string, number> = {};
  const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const byId = new Map(archived.map((a) => [a.id, a]));
  // both lookups in parallel, in pieces the database takes in one request
  const [pus, ops] = await Promise.all([
    Promise.all(chunks(owedArch, 200).map((ids) => admin.from("archived_orders").select("id, balance, pay:data->urls->>publicUrl, fees:data->fees, groups:data->groups").is("removed_at", null).in("id", ids))),
    Promise.all(chunks(archived.map((a) => a.id), 300).map((ids) => admin.from("payments").select("id, archived_order_id, amount, method, paid_on, created_at, processor_id, note, fee").in("archived_order_id", ids))),
  ]);
  for (const { data: pu } of pus as { data: { id: string; balance: number; pay: string | null; fees: null; groups: null }[] | null }[])
    (pu || []).forEach((r) => { if (r.pay && /^https:\/\//.test(r.pay)) payUrls[r.id] = r.pay; const n = cardFeeInOld(r, +r.balance || 0); if (n) feeIns[r.id] = n; });
  const orders: AOrder[] = archived.map((a) => ({ ...archiveAsOrder(a, o.href(a.id)), payUrl: payUrls[a.id], cardFeeIn: feeIns[a.id] || 0, payHere: o.movedIds.has((a as { customer_id?: string }).customer_id || "") }));
  const ours: APayment[] = [];
  for (const { data: op } of ops as { data: { id: string; archived_order_id: string; amount: number; method: string; paid_on: string | null; created_at: string; processor_id: string | null; note: string | null; fee: number | null }[] | null }[])
    for (const x of op || []) {
      const a = byId.get(x.archived_order_id);
      ours.push({ id: x.id, order_id: x.archived_order_id, number: +(a?.visual_id || 0), amount: +x.amount || 0, method: x.method, paid_on: x.paid_on, created_at: x.created_at, href: o.href(x.archived_order_id), processor_id: x.processor_id, note: x.note, fee: x.fee, nickname: a?.nickname || "", archived: true });
    }
  return { payUrls, orders, payments: [...ours, ...archived.flatMap((a) => archivePayments(a, o.href(a.id)))] };
}
