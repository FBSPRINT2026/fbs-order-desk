/**
 * Run together (Nick, Nov 16 2026: "sometimes customers place completely separate orders… 918, there's 2 orders for
 * NCM… run them together on the schedule, but treat them as separate orders… he gets the bulk pricing… and we're
 * efficient"). Orders sharing `orders.run_id` keep their own invoices, POs and shipping; the same print (the same logo at
 * the same spot and size, as across groups of one order) counts all the run's pieces for its price break, and its
 * screens are made once, paid on the run's first order. Each order keeps its view of the others in `orders.run_ctx`,
 * which calcOrder reads (lib/pricing.ts), so every place a price is worked out agrees.
 */
import { billQty, orderGroups, printSizeKey, screenKey, type Order, type RunCtx } from "@/lib/pricing";

type RunOrder = Pick<Order, "id" | "number" | "nickname" | "groups" | "lines"> & { qty?: number };

/** a print's key for the price break (the same as calcOrder's designQty keys) */
const qtyKey = (d: { method: string; design_id?: string | null; size?: string }) => (d.design_id ? `${d.method}:${d.design_id}:${printSizeKey(d as { size?: string })}` : "");

/** what the run's other orders bring to `me`: their pieces of each print, and the screens an earlier order pays for */
export function runCtxFor(me: RunOrder, all: RunOrder[]): RunCtx {
  const mates = all.filter((x) => x.id !== me.id);
  const qty: Record<string, number> = {}, paid: Record<string, number> = {};
  for (const m of mates) {
    for (const g of orderGroups(m)) {
      if (g.sample) continue;
      const q = (g.lines || []).reduce((a, l) => a + billQty(l), 0);
      for (const k of new Set((g.imprints || []).map((d) => qtyKey(d)).filter(Boolean))) qty[k] = (qty[k] || 0) + q;
      // screens are made for the run's first order (the lowest number); later ones share them
      if (m.number < me.number) for (const d of g.imprints || []) { const k = screenKey(d); if (k && !(k in paid)) paid[k] = m.number; }
    }
  }
  return { qty, paid, mates: mates.map((m) => ({ id: m.id, number: m.number, nickname: m.nickname || "", qty: +(m.qty || 0) })) };
}

/** does `a` share a print with `b` (so they price together), by the same keys */
export function sharesPrint(a: RunOrder, b: RunOrder): boolean {
  const ks = new Set(orderGroups(a).flatMap((g) => (g.imprints || []).map((d) => qtyKey(d)).filter(Boolean)));
  return orderGroups(b).some((g) => (g.imprints || []).some((d) => ks.has(qtyKey(d))));
}
