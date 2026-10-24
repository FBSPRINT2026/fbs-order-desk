"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, r2, type Order, type Payment } from "@/lib/pricing";
import { money } from "@/lib/format";

/**
 * Charge a customer's saved card or bank account from the shop (Oct 24, Nick: "if they authorize us… can you go in and
 * run my card? You'll have it saved on file… we can go in and do that on our side"). Only methods the customer turned
 * "Let FBS charge it when I ask" on for, only staff, only up to what the order owes. Nothing is emailed.
 */
const STAX_API = "https://apiprod.fattlabs.com";
type Res = { ok: boolean; error?: string; paid?: number; fee?: number };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

export type ChargeableMethod = { id: string; method: string; brand: string; last4: string; exp: string; holder: string; staff_charge_at: string | null };

export async function chargeableMethods(customerId: string): Promise<ChargeableMethod[]> {
  try {
    await staff();
    const { data } = await createAdminClient().from("saved_payment_methods").select("id, method, brand, last4, exp, holder, staff_charge_at")
      .eq("customer_id", customerId).eq("staff_charge_ok", true).is("removed_at", null).order("last_used_at", { ascending: false, nullsFirst: false });
    return (data || []) as ChargeableMethod[];
  } catch { return []; }
}

export async function chargeSavedMethod(input: { orderId: string; savedId: string; amount: number }): Promise<Res> {
  try {
    const v = await staff();
    if (!process.env.STAX_API_KEY) return { ok: false, error: "Stax isn't set up (STAX_API_KEY)." };
    const admin = createAdminClient();
    const [{ data: o }, { data: s }] = await Promise.all([
      admin.from("orders").select("*").eq("id", input.orderId).maybeSingle(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (!o) return { ok: false, error: "Order not found." };
    const order = o as Order;
    const { data: sp } = await admin.from("saved_payment_methods").select("id, stax_pm_id, method, brand, last4, customer_id, staff_charge_ok")
      .eq("id", input.savedId).is("removed_at", null).maybeSingle();
    if (!sp || sp.customer_id !== order.customer_id) return { ok: false, error: "That saved payment method isn't on this customer." };
    if (!sp.staff_charge_ok) return { ok: false, error: "The customer hasn't allowed us to charge it. They can turn that on in their portal Settings." };
    const settings = mergeSettings(s?.data);
    const { data: pays } = await admin.from("payments").select("*").eq("order_id", order.id);
    const c = calcOrder(order, settings, (pays || []) as Payment[]);
    const sum = r2(+input.amount);
    if (!(sum >= 1)) return { ok: false, error: "Enter an amount of at least $1." };
    if (sum > c.balance + 0.004) return { ok: false, error: `That's more than the order owes (${money(c.balance)}).` };
    const isCard = sp.method !== "bank";
    const fee = isCard ? r2((sum * Math.max(0, settings.pay.cardFeePct)) / 100) : 0;
    const total = r2(sum + fee);
    const res = await fetch(`${STAX_API}/charge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STAX_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        payment_method_id: sp.stax_pm_id, total, pre_auth: 0,
        meta: {
          reference: `#${order.number}`, memo: `${settings.shop.name} order #${order.number} (charged at the customer's request)`.slice(0, 200), subtotal: sum,
          ...(fee ? { surcharge: fee } : {}),
          lineItems: [{ item: `Order #${order.number}`, details: order.nickname || "", quantity: 1, price: sum }],
          // the shop runs a stored card the customer asked us to charge: merchant initiated, unscheduled
          transaction_initiation_type: "MIT", transaction_schedule_type: "unscheduled",
        },
      }),
    });
    const txn = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !txn || txn.success === false) {
      const why = (txn && (txn.message || (Array.isArray(txn.error) ? txn.error.join(" ") : txn.error))) || `The charge didn't go through (${res.status}).`;
      await admin.from("order_events").insert({ order_id: order.id, kind: "payment", detail: `Card on file charge failed: ${String(why).slice(0, 200)}`, actor: v.email });
      return { ok: false, error: String(why) };
    }
    const methodName = isCard ? "Credit card" : "ACH";
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await admin.from("payments").insert({ order_id: order.id, amount: sum, method: methodName, paid_on: today, fee, processor_id: String(txn.id || ""), note: `Card on file (${sp.brand} ${sp.last4}), charged by ${v.email} at the customer's request` });
    await admin.from("saved_payment_methods").update({ last_used_at: new Date().toISOString() }).eq("id", sp.id);
    if (error) return { ok: false, error: `The charge went through, but we couldn't record it (${error.message}). Record ${money(sum)} by hand.` };
    await admin.from("order_events").insert({ order_id: order.id, kind: "payment", detail: `${money(sum)} ${methodName} on file (${sp.brand} ${sp.last4})${fee ? ` + ${money(fee)} card fee` : ""}, at the customer's request`, actor: v.email });
    revalidatePath(`/shop/orders/${order.id}`);
    return { ok: true, paid: sum, fee };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
