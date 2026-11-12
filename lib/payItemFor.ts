import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, mergeSettings, type Order, type Payment, type PayTerms } from "@/lib/pricing";
import { termsPct } from "@/lib/payTerms";
import { payState } from "@/lib/payReady";
import { cardFeeInOrder } from "@/lib/cardFeeIn";
import type { PayItem } from "@/components/PayPanel";

/**
 * What an order can be paid now, the same way the portal's order page works it out (deposit or balance by the customer's
 * terms, lib/payReady.ts): for paying from the emailed link without signing in (Nov 12, Nick). null when nothing's due.
 */
export async function payItemFor(admin: SupabaseClient, orderId: string): Promise<{ item: PayItem; pay: { cardFeePct: number; zelle: string; venmo: string }; receiptEmail: string } | null> {
  const [{ data: o }, { data: pays }, { data: s }] = await Promise.all([
    admin.from("orders").select("*").eq("id", orderId).maybeSingle(),
    admin.from("payments").select("*").eq("order_id", orderId),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  if (!o) return null;
  const order = o as Order, settings = mergeSettings(s?.data);
  const { data: cu } = order.customer_id ? await admin.from("customers").select("email, payment_terms").eq("id", order.customer_id).maybeSingle() : { data: null };
  const terms = ((cu as { payment_terms?: PayTerms } | null)?.payment_terms || "receipt") as PayTerms;
  const c = calcOrder(order, settings, (pays || []) as Payment[]);
  const tPct = termsPct(terms, settings.depositPct);
  const deposit = Math.min(c.balance, Math.round(c.total * (tPct > 0 && tPct < 100 ? tPct : settings.depositPct)) / 100);
  const ps = payState(order as Order & { pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, { paid: c.paid, depositPct: settings.depositPct, terms });
  if (!(c.balance > 0.004 && ps.can !== "none" && (order.type === "invoice" || order.status === "quote_sent"))) return null;
  return {
    item: { id: order.id, number: order.number, nickname: order.nickname || "", balance: ps.can === "deposit" ? deposit : c.balance, deposit: c.paid < 0.005 && ps.can !== "deposit" ? deposit : undefined, quote: order.type === "quote", notFinal: ps.notFinal, notFinalNote: ps.note, cardFeeIn: cardFeeInOrder(order as never, c.balance), part: ps.can === "deposit" },
    pay: settings.pay, receiptEmail: (cu as { email?: string } | null)?.email || "",
  };
}
