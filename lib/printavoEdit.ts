import { groupsFromPrintavo, type PvRow } from "@/lib/printavoGroups";
import { calcOrder, SIZES, type Fee, type GLine, type Group, type Order, type Settings, type StatusKey } from "@/lib/pricing";
import { CARD, ourStatusFor } from "@/lib/printavoOld";
import type { PvOrder } from "@/lib/archive";
import { oldNoteText } from "@/lib/emailOrderShared";

/**
 * An old Printavo job made editable here (Nick, Nov 18 2026: "Now that there's no Printavo anymore… all our edits have
 * to be done here… update all the statuses… change pricing… we have to be able to edit them the way they are").
 *
 * The job becomes one of our orders, exactly as Printavo had it: the same number, customer, name, PO, dates and status;
 * every garment line at Printavo's own price each (a price set by hand, so no price list, no 2XL+ upcharge and no
 * minimum is added on top); Printavo's setup and other charges as they were (they're lines or fees there, so our screen
 * setup is waived); its fees, discount and tax; its payments. Its prints come over too (spot, method, colors), so a job
 * still open runs on the schedule and work order like any order. What it comes to is checked against Printavo's total
 * before anything is saved (`pvAsOrder` → `ours` / `theirs`).
 *
 * Pure: the server action (app/shop/archive/edit-actions.ts) loads, saves and moves everything that pointed at the old job.
 */

export type PvEditRow = PvRow & {
  printavo_id: string; kind: string; customer_id: string | null; due_date: string | null; total: number | null; po_number: string | null;
  locked?: boolean; data: PvOrder & PvRow["data"];
};

const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;

export function pvAsOrder(row: PvEditRow, settings: Settings, prodData: unknown): {
  order: Pick<Order, "number" | "customer_id" | "nickname" | "status" | "type" | "due_date" | "groups" | "lines" | "fees" | "discount_pct" | "discount_amt" | "discount_type" | "tax_exempt" | "tax_rate" | "waive_setup" | "po_number" | "production_date" | "delivery_method" | "notes" | "price_type" | "total" | "qty">;
  ours: number; theirs: number; notes: string[];
} {
  const d = row.data;
  const notes: string[] = [];
  const groups: Group[] = groupsFromPrintavo(row, prodData).map((g) => ({
    ...g,
    lines: g.lines.map((l) => {
      const pv = (l as GLine & { pvPrice?: number }).pvPrice;
      delete (l as GLine & { pvPrice?: number }).pvPrice;
      // Printavo's price each is the price: nothing added for bigger sizes (Printavo has them on their own lines)
      const sizeUpSet = Object.fromEntries(SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => [z, 0]));
      return { ...l, priceOverride: r2(pv ?? 0), sizeUpSet };
    }),
  }));
  const fees: Fee[] = [];
  for (const f of d.fees || []) {
    const amt = r2(+f.amount || 0);
    if (!amt) continue;
    const label = String(f.description || "").trim() || "Fee";
    fees.push({ label: CARD.test(label) ? "Credit Card Processing Surcharge" : label, amount: amt, ...(/^\s*(shipping|delivery|freight)\b/i.test(label) ? { ship: true } : {}) });
  }
  // Printavo's discountAmount can hold the subtotal when there's no discount (#33526): only a real discount counts
  const disc = +d.discount > 0 ? r2(+d.discountAmount || (d.discountAsPercentage ? ((+d.subtotal || 0) * +d.discount) / 100 : +d.discount)) : 0;
  const status: StatusKey = (ourStatusFor(row.status_name || "", row.kind) || (row.kind === "quote" ? "quote" : "approved")) as StatusKey;
  const order = {
    number: +String(row.visual_id), customer_id: row.customer_id, nickname: String(row.nickname || "").slice(0, 120),
    status, type: (row.kind === "quote" ? "quote" : "invoice") as Order["type"],
    due_date: (d.customerDueAt || row.due_date || "").slice(0, 10) || null,
    production_date: (d.dueAt || "").slice(0, 10) || null,
    groups, lines: [], fees,
    // a percent off stays a percent off, so it still comes off right once the job is priced
    ...(+d.discount > 0 && d.discountAsPercentage ? { discount_pct: +d.discount, discount_amt: 0, discount_type: "pct" as const } : { discount_pct: 0, discount_amt: disc, discount_type: "amt" as const }),
    tax_exempt: true, tax_rate: (+d.salesTax || null) as number | null,
    // setup was a line or a fee in Printavo: never charged again on top
    waive_setup: true,
    po_number: String(row.po_number || d.poNumber || "").slice(0, 60),
    delivery_method: /ship/i.test(d.deliveryMethod || "") ? "ship" as const : /deliver/i.test(d.deliveryMethod || "") ? "deliver" as const : "pickup" as const,
    notes: oldNoteText(d.customerNote).slice(0, 2000),
    price_type: "retail" as const,
  };
  // the tax: Printavo's rate when it comes to Printavo's tax; when Printavo taxed only some lines (or rounded line by
  // line), the rate on the whole order that comes to the same dollars, so the total is Printavo's to the cent
  const base = calcOrder(order as never, settings, []).total, amt = r2(+d.salesTaxAmount || 0), rate0 = +d.salesTax || 0;
  // nothing priced yet ($0 jobs waiting for prices): taxed at Printavo's rate once it's priced
  if (base <= 0 && rate0 > 0) { order.tax_exempt = false; order.tax_rate = rate0; }
  if (amt > 0 && base > 0) {
    order.tax_exempt = false;
    if (r2((base * rate0) / 100) === amt) order.tax_rate = rate0;
    else {
      order.tax_rate = Math.round((amt / base) * 100 * 1e6) / 1e6;
      notes.push(`Printavo taxed only part of it: tax is ${order.tax_rate}% of the whole order so it comes to the same $${amt.toFixed(2)}`);
    }
  }
  const c = calcOrder(order as never, settings, []);
  return { order: { ...order, total: c.total, qty: c.qty }, ours: c.total, theirs: r2(+(d.total ?? row.total ?? 0)), notes };
}
