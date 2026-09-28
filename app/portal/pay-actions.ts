"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, r2, type Order, type Payment } from "@/lib/pricing";
import { money } from "@/lib/format";
import { allocateOldest } from "@/lib/paySelect";

type Result = { ok: boolean; error?: string; paid?: number; fee?: number };
const STAX_API = "https://apiprod.fattlabs.com";
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

/**
 * The signed-in customer's orders (row security checks they're theirs) with what's owed on each,
 * worked out here from the order and its payments — never taken from the browser.
 */
async function owed(items: { orderId: string; kind: "deposit" | "balance" }[], applyAmount?: number) {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers pay from their own login.");
  if (!items.length) throw new Error("Pick at least one order to pay.");
  const ids = [...new Set(items.map((i) => i.orderId))];
  const { data: os } = await supabase.from("orders").select("*").in("id", ids);
  const orders = (os || []) as Order[];
  if (orders.length !== ids.length) throw new Error("We couldn't find one of those orders.");
  const admin = createAdminClient();
  const [{ data: pays }, { data: s }, { data: cs }] = await Promise.all([
    admin.from("payments").select("*").in("order_id", ids),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    supabase.from("customers").select("*"),
  ]);
  const settings = mergeSettings(s?.data);
  const lines = items.map((it) => {
    const o = orders.find((x) => x.id === it.orderId)!;
    // quotes waiting on approval can be paid too; a successful card/ACH payment approves them
    if (o.type !== "invoice" && o.status !== "quote_sent") throw new Error(`#${o.number} isn't ready to pay yet.`);
    const c = calcOrder(o, settings, ((pays || []) as Payment[]).filter((p) => p.order_id === o.id));
    const deposit = Math.min(c.balance, r2((c.total * settings.depositPct) / 100));
    const amount = r2(it.kind === "deposit" && c.paid < 0.005 ? deposit : c.balance);
    if (amount <= 0.004) throw new Error(`#${o.number} is already paid.`);
    return { o, amount };
  });
  // "pay an amount": oldest orders first, the last one partly
  let use = lines;
  if (applyAmount !== undefined) {
    const total = r2(lines.reduce((a, l) => a + l.amount, 0));
    const amt = r2(+applyAmount);
    if (!(amt >= 1)) throw new Error("Enter an amount of at least $1.");
    if (amt > total + 0.004) throw new Error(`That's more than these orders owe (${money(total)}).`);
    use = allocateOldest(lines.map((l) => ({ ...l, balance: l.amount, created_at: l.o.created_at, number: l.o.number })), amt).map((x) => ({ o: x.item.o, amount: x.amount }));
  }
  return { admin, email, settings, lines: use, customer: (cs || [])[0] as { id: string; name: string; company: string; email: string } | undefined };
}

/** Card fee on a credit card payment (a setting; never on ACH, Zelle or Venmo). */
const cardFee = (sum: number, pct: number) => r2((sum * Math.max(0, pct)) / 100);

/**
 * Pay one or more orders together with a card or bank account the customer entered in Stax's secure fields.
 * paymentMethodId comes from Stax.js tokenize(); the card or bank numbers never touch our server.
 */
export async function payOrders(input: { items: { orderId: string; kind: "deposit" | "balance" }[]; method: "card" | "bank"; paymentMethodId: string; applyAmount?: number }): Promise<Result> {
  try {
    if (!process.env.STAX_API_KEY) return { ok: false, error: "Online payments aren't set up yet. Please contact the shop." };
    if (!/^[\w-]{6,}$/.test(input.paymentMethodId || "")) return { ok: false, error: "Enter your payment details again." };
    const { admin, email, settings, lines, customer } = await owed(input.items, input.applyAmount);
    const sum = r2(lines.reduce((a, l) => a + l.amount, 0));
    const fee = input.method === "card" ? cardFee(sum, settings.pay.cardFeePct) : 0;
    const total = r2(sum + fee);
    const ref = lines.map((l) => `#${l.o.number}`).join(", ");
    const res = await fetch(`${STAX_API}/charge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STAX_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        payment_method_id: input.paymentMethodId,
        total,
        pre_auth: 0,
        meta: {
          reference: ref.slice(0, 200),
          memo: `${settings.shop.name} ${lines.length > 1 ? "orders" : "order"} ${ref}`.slice(0, 200),
          subtotal: sum,
          ...(fee ? { surcharge: fee } : {}),
          lineItems: lines.map((l) => ({ item: `Order #${l.o.number}`, details: l.o.nickname || "", quantity: 1, price: l.amount })),
          transaction_initiation_type: "CIT",
          transaction_schedule_type: "unscheduled",
        },
      }),
    });
    const txn = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !txn || txn.success === false) {
      const why = (txn && (txn.message || (Array.isArray(txn.error) ? txn.error.join(" ") : txn.error))) || `The payment didn't go through (${res.status}).`;
      return { ok: false, error: String(why) };
    }
    // record it on each order; the card fee is split across them so the order balances stay exact
    const methodName = input.method === "card" ? "Credit card" : "ACH";
    let feeLeft = fee;
    const today = new Date().toISOString().slice(0, 10);
    const rows = lines.map((l, i) => {
      const f = i === lines.length - 1 ? r2(feeLeft) : r2((fee * l.amount) / (sum || 1));
      feeLeft = r2(feeLeft - f);
      return { order_id: l.o.id, amount: l.amount, method: methodName, paid_on: today, fee: f, processor_id: String(txn.id || ""), note: lines.length > 1 ? `Paid together: ${ref}` : null };
    });
    const { error } = await admin.from("payments").insert(rows);
    // paying a quote approves it (the customer saw "Paying approves the quote and our terms")
    const quotes = lines.filter((l) => l.o.type === "quote");
    if (!error && quotes.length) {
      const who = customer?.name || email;
      await admin.from("orders").update({ type: "invoice", status: "approved", approved_at: new Date().toISOString(), approved_name: `${who} (paid online)` }).in("id", quotes.map((l) => l.o.id));
      await admin.from("order_events").insert(quotes.map((l) => ({ order_id: l.o.id, kind: "status", detail: "approved (paid online)", actor: email })));
    }
    if (error) return { ok: false, error: `Your payment went through, but we couldn't record it (${error.message}). Please contact us so we can mark it paid.` };
    await admin.from("order_events").insert(lines.map((l) => ({ order_id: l.o.id, kind: "payment", detail: `${money(l.amount)} ${methodName}${fee ? ` + ${money(rows.find((r) => r.order_id === l.o.id)?.fee)} card fee` : ""}`, actor: email })));
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `Payment received: ${money(total)} for ${ref}`,
      html: emailLayout(settings.shop.name, `${customer?.company || customer?.name || email} paid ${money(total)}`, `${methodName} payment for ${ref}: ${money(sum)}${fee ? ` + ${money(fee)} card fee` : ""}. Stax transaction ${txn.id || ""}.`, "Open orders", `${siteUrl()}/shop`),
    });
    revalidatePath("/portal");
    lines.forEach((l) => revalidatePath(`/portal/orders/${l.o.id}`));
    return { ok: true, paid: total, fee };
  } catch (e) { return fail(e); }
}

/** Customer says they sent a Zelle or Venmo payment. Staff confirm it and record the payment. */
export async function sentPaymentNotice(input: { items: { orderId: string; kind: "deposit" | "balance" }[]; method: "Zelle" | "Venmo"; note: string; applyAmount?: number }): Promise<Result> {
  try {
    const { admin, email, settings, lines, customer } = await owed(input.items, input.applyAmount);
    const sum = r2(lines.reduce((a, l) => a + l.amount, 0));
    const ref = lines.map((l) => `#${l.o.number}`).join(", ");
    const { error } = await admin.from("payment_notices").insert({ customer_id: customer?.id || null, order_ids: lines.map((l) => l.o.id), method: input.method, amount: sum, note: input.note.slice(0, 500), created_by: email });
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert(lines.map((l) => ({ order_id: l.o.id, kind: "payment_notice", detail: `${input.method} ${money(l.amount)} sent (to confirm)`, actor: email })));
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `${input.method} payment sent: ${money(sum)} for ${ref}`,
      html: emailLayout(settings.shop.name, `${customer?.company || customer?.name || email} says they sent ${money(sum)} by ${input.method}`, `For ${ref}.${input.note ? `\n\nNote: ${input.note}` : ""}\n\nCheck your ${input.method} account, then record the payment on the order.`, "Open orders", `${siteUrl()}/shop`),
    });
    revalidatePath("/portal");
    return { ok: true, paid: sum };
  } catch (e) { return fail(e); }
}
