import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, mergeSettings, type Order, type Payment } from "@/lib/pricing";

/**
 * Credits (Nov 3, Nick: "someone pays an invoice and it gets canceled, or… overpays… you should be able to show a negative
 * balance on an invoice… hey, you've got a credit. How would you like to use it? Apply to this invoice… They should also be
 * able to refund the card on file… under $20… back to the card… over $20… refund pending, approve… they should sync to
 * QuickBooks… it should just show us payments").
 *
 * A credit is an invoice whose payments are more than its total (its balance below zero). Everything is a payment row:
 *  - applying a credit: two rows that cancel out, `Credit` −X on the invoice it came from and `Credit` +X on the one it
 *    pays (processor_id "credit:<move id>" on both), so no money moves and both invoices' histories say so;
 *  - a refund: a negative row on the invoice it came from (`Refund`), processor_id "stax-refund:<Stax id>", returned to
 *    the card it was paid with (Stax refunds the original charge).
 * QuickBooks reads them like any payment (lib/qbo/push.ts says what to do with each).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const STAX = "https://apiprod.fattlabs.com";
export const AUTO_REFUND_MAX = 20;
export type CreditInvoice = { id: string; number: number; nickname: string; credit: number };

/** the customer's invoices with a credit (a balance below zero), oldest first */
export async function creditsOf(admin: SupabaseClient, customerId: string): Promise<{ list: CreditInvoice[]; total: number; pending: number }> {
  const [{ data: os }, { data: s }, { data: rq }] = await Promise.all([
    admin.from("orders").select("*").eq("customer_id", customerId).eq("type", "invoice").is("discarded_at", null).order("created_at").limit(500),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("refund_requests").select("amount").eq("customer_id", customerId).eq("status", "pending"),
  ]);
  const orders = (os || []) as Order[];
  if (!orders.length) return { list: [], total: 0, pending: 0 };
  const settings = mergeSettings((s as { data?: unknown } | null)?.data);
  const { data: ps } = await admin.from("payments").select("*").in("order_id", orders.map((o) => o.id));
  const pays = (ps || []) as Payment[];
  const list: CreditInvoice[] = [];
  for (const o of orders) {
    const c = calcOrder(o, settings, pays.filter((p) => p.order_id === o.id));
    if (c.balance < -0.004) list.push({ id: o.id, number: o.number, nickname: o.nickname || "", credit: r2(-c.balance) });
  }
  // what's waiting to be refunded isn't there to use
  const pending = r2(((rq || []) as { amount: number }[]).reduce((a, x) => a + (+x.amount || 0), 0));
  return { list, total: r2(Math.max(0, list.reduce((a, x) => a + x.credit, 0) - pending)), pending };
}

/** take `amount` of credit from the customer's credit invoices (oldest first) and put it on `toOrderId` */
export async function applyCredit(admin: SupabaseClient, customerId: string, toOrderId: string, amount: number, actor: string) {
  const { data: to } = await admin.from("orders").select("*").eq("id", toOrderId).maybeSingle();
  if (!to || (to as Order).customer_id !== customerId) return { ok: false as const, error: "That invoice isn't theirs." };
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const { data: tp } = await admin.from("payments").select("*").eq("order_id", toOrderId);
  const owed = calcOrder(to as Order, mergeSettings((s as { data?: unknown } | null)?.data), (tp || []) as Payment[]).balance;
  const cr = await creditsOf(admin, customerId);
  const amt = r2(Math.min(+amount || 0, owed, cr.total));
  if (!(amt > 0.004)) return { ok: false as const, error: owed <= 0.004 ? "That invoice is already paid." : "There's no credit to use." };
  const move = crypto.randomUUID(), day = new Date().toISOString().slice(0, 10), toNo = (to as Order).number;
  let left = amt;
  const rows: Record<string, unknown>[] = [];
  for (const c of cr.list) {
    if (left <= 0.004) break;
    if (c.id === toOrderId) continue;
    const take = r2(Math.min(c.credit, left));
    rows.push({ order_id: c.id, amount: -take, method: "Credit", paid_on: day, processor_id: `credit:${move}`, note: `Credit moved to #${toNo}` });
    rows.push({ order_id: toOrderId, amount: take, method: "Credit", paid_on: day, processor_id: `credit:${move}`, note: `Credit from #${c.number}` });
    left = r2(left - take);
  }
  if (!rows.length) return { ok: false as const, error: "There's no credit to use." };
  const { error } = await admin.from("payments").insert(rows);
  if (error) return { ok: false as const, error: error.message };
  const ev = rows.map((r) => ({ order_id: r.order_id, kind: "payment", detail: `${(r.amount as number) < 0 ? "−" : ""}$${Math.abs(r.amount as number).toFixed(2)} ${r.note}`, actor }));
  await admin.from("order_events").insert(ev);
  await (await import("@/lib/autoSeps")).autoSeparations(admin, toOrderId, "paid");
  return { ok: true as const, applied: r2(amt - left) };
}

/** the card payments a credit invoice was paid with (newest first), to refund against */
async function refundSources(admin: SupabaseClient, orderId: string) {
  const { data } = await admin.from("payments").select("id, amount, processor_id, method, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
  const rows = (data || []) as { id: string; amount: number; processor_id: string | null; method: string }[];
  // a Stax charge: its id is a plain uuid (not credit:/stax-refund:/qbo-echeck:/stripe)
  const refunded = rows.filter((r) => /^stax-refund:/.test(r.processor_id || "")).reduce((a, r) => a - +r.amount, 0);
  return { charges: rows.filter((r) => +r.amount > 0 && /^[0-9a-f-]{36}$/i.test(r.processor_id || "")), refunded };
}

/** send `amount` of an invoice's credit back to the card it was paid with (Stax refunds the original charge) */
export async function refundCredit(admin: SupabaseClient, customerId: string, orderId: string, amount: number, actor: string) {
  const key = process.env.STAX_API_KEY?.trim();
  if (!key) return { ok: false as const, error: "Stax isn't connected." };
  const cr = await creditsOf(admin, customerId);
  const c = cr.list.find((x) => x.id === orderId);
  const amt = r2(+amount || 0);
  if (!c || amt <= 0.004 || amt > c.credit + 0.004) return { ok: false as const, error: "That's more than the credit on that invoice." };
  const { charges } = await refundSources(admin, orderId);
  if (!charges.length) return { ok: false as const, error: "It wasn't paid by card or bank through Stax, so it can't go back automatically. Refund it by hand." };
  let left = amt;
  const done: string[] = [];
  for (const ch of charges) {
    if (left <= 0.004) break;
    const take = r2(Math.min(+ch.amount, left));
    const r = await fetch(`${STAX}/transaction/${encodeURIComponent(ch.processor_id!)}/refund`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ total: take, reason: `Credit refund, ${actor}` }) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || j.success === false) {
      const why = String(j.message || (Array.isArray(j.error) ? (j.error as string[]).join(" ") : j.error) || `Stax answered ${r.status}`);
      if (!done.length) return { ok: false as const, error: why };
      break;
    }
    // Stax returns the refund (a child transaction) or the charge with it; either way its id is kept
    const rid = String((j.child_transactions as { id?: string }[] | undefined)?.slice(-1)[0]?.id || j.id || "");
    await admin.from("payments").insert({ order_id: orderId, amount: -take, method: "Refund", paid_on: new Date().toISOString().slice(0, 10), processor_id: `stax-refund:${rid}`, note: `Credit refunded to the ${ch.method === "ACH" ? "bank account" : "card"} it was paid with (charge ${String(ch.processor_id).slice(0, 8)}), by ${actor}` });
    await admin.from("order_events").insert({ order_id: orderId, kind: "payment", detail: `Refund −$${take.toFixed(2)} to the ${ch.method === "ACH" ? "bank account" : "card"}`, actor });
    done.push(rid); left = r2(left - take);
  }
  return { ok: true as const, refunded: r2(amt - left), ids: done };
}

/** a customer asks for their credit back: $20 or less goes right away; more waits for Nick or Amanda */
export async function requestRefund(admin: SupabaseClient, customerId: string, orderId: string, amount: number, who: string) {
  const amt = r2(+amount || 0);
  if (amt <= AUTO_REFUND_MAX + 0.004) {
    const r = await refundCredit(admin, customerId, orderId, amt, who);
    return r.ok ? { ok: true as const, done: true, amount: r.refunded } : r;
  }
  const cr = await creditsOf(admin, customerId);
  const c = cr.list.find((x) => x.id === orderId);
  if (!c || amt > c.credit + 0.004) return { ok: false as const, error: "That's more than the credit." };
  const { error } = await admin.from("refund_requests").insert({ customer_id: customerId, order_id: orderId, amount: amt, requested_by: who });
  if (error) return { ok: false as const, error: error.message };
  await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Refund of $${amt.toFixed(2)} asked for by ${who}: waiting for FBS to approve`, actor: who });
  return { ok: true as const, done: false, amount: amt };
}
