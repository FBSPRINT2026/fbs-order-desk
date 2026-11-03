import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Flag, FlagKey } from "@/lib/orderStages";
import { AUTO_HOLD, HOLD_REASONS, holdsOf, isHoldKey, type HoldShow } from "@/lib/holds";
import { calcOrder, mergeSettings, type Order, type PayTerms, type Payment } from "@/lib/pricing";
import { upFront } from "@/lib/payTerms";

/**
 * Putting a job on hold and taking it off (lib/holds.ts), and the payment hold that runs itself:
 *  - a pre-pay or deposit job approved and not paid goes on hold for payment a few minutes after it's approved (time to
 *    pay right then: Nick, "give it minutes… if a customer… exits out without paying, it should just say on hold"),
 *    from the 5-minute tick (app/api/away/tick, sweepPaymentHolds);
 *  - it comes off by itself the moment the payment is in (releasePaymentHold, from every payment; lib/autoSeps.ts);
 *  - taking one off by hand keeps it off: the sweep never puts back a payment hold someone took off.
 * Every change goes in the order's history.
 */
const reasonOf = (k: string) => HOLD_REASONS.find((r) => r.key === k)?.label || (k === "goods_wrong" ? "Receiving" : k === "hold_shop" ? "Shop" : k);

export async function setHold(admin: SupabaseClient, orderId: string, h: { key: FlagKey; note: string; show: HoldShow; by: string }) {
  if (!isHoldKey(h.key)) return { ok: false as const, error: "Pick why it's on hold." };
  const { data: o } = await admin.from("orders").select("flags").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false as const, error: "That order doesn't exist." };
  const flags = ((o.flags || []) as Flag[]).filter((f) => f && f.key !== h.key);
  const f: Flag = { key: h.key, note: h.note.trim().slice(0, 600), by: h.by, at: new Date().toISOString(), show: h.show };
  const next = [...flags, f];
  const { error } = await admin.from("orders").update({ flags: next }).eq("id", orderId);
  if (error) return { ok: false as const, error: error.message };
  await admin.from("order_events").insert({ order_id: orderId, kind: "hold", detail: `${reasonOf(h.key)}${f.note ? `: ${f.note}` : ""}`, actor: h.by });
  return { ok: true as const, flags: next };
}

/** take it off hold: every hold, or just one reason */
export async function clearHold(admin: SupabaseClient, orderId: string, by: string, only?: FlagKey, why = "") {
  const { data: o } = await admin.from("orders").select("flags").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false as const, error: "That order doesn't exist." };
  const flags = (o.flags || []) as Flag[];
  const gone = holdsOf(flags).filter((f) => !only || f.key === only);
  if (!gone.length) return { ok: true as const, flags };
  const next = flags.filter((f) => !gone.some((g) => g.key === f.key));
  const { error } = await admin.from("orders").update({ flags: next }).eq("id", orderId);
  if (error) return { ok: false as const, error: error.message };
  await admin.from("order_events").insert(gone.map((g) => ({ order_id: orderId, kind: "unhold", detail: `${reasonOf(g.key)}${why ? `: ${why}` : ""}`, actor: by })));
  return { ok: true as const, flags: next };
}

/** what's still owed before the job can start, by the customer's terms (0: nothing; pre-pay all, deposit its part) */
export async function owedToStart(admin: SupabaseClient, o: Order) {
  const [{ data: cu }, { data: s }, { data: pays }] = await Promise.all([
    o.customer_id ? admin.from("customers").select("payment_terms").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("payments").select("*").eq("order_id", o.id),
  ]);
  const settings = mergeSettings((s as { data?: unknown } | null)?.data);
  const c = calcOrder(o, settings, (pays || []) as Payment[]);
  const due = upFront(((cu as { payment_terms?: string } | null)?.payment_terms || null) as PayTerms | null, c.total, settings.depositPct, c.paid);
  return { owed: due.kind === "none" ? 0 : Math.max(0, due.amount), kind: due.kind, balance: c.balance };
}

/** paid: the payment hold comes off (one the system put on once what's due to start is in; any one once it's paid in full) */
export async function releasePaymentHold(admin: SupabaseClient, o: Order & { flags?: unknown }) {
  const h = holdsOf(o.flags).find((f) => f.key === "hold_payment");
  if (!h) return false;
  const { owed, balance } = await owedToStart(admin, o);
  if (!(balance <= 0.005 || (h.by === AUTO_HOLD && owed <= 0.005))) return false;
  await clearHold(admin, o.id, AUTO_HOLD, "hold_payment", "paid");
  return true;
}

const OPEN_JOB = ["approved", "art", "blanks", "production"];
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Every few minutes: jobs approved at least `wait` minutes ago (in the last two days) whose terms want money up front
 * that isn't in go on hold for payment. A job is never held again for payment after someone took that hold off.
 */
export async function sweepPaymentHolds(admin: SupabaseClient, waitMin = 10) {
  const now = Date.now();
  const { data } = await admin.from("orders").select("*").eq("type", "invoice").in("status", OPEN_JOB).is("discarded_at", null).is("printavo_id", null)
    .lte("approved_at", new Date(now - waitMin * 60000).toISOString()).gte("approved_at", new Date(now - 2 * 864e5).toISOString()).order("id").limit(200);
  let held = 0, freed = 0;
  for (const o of (data || []) as (Order & { flags?: Flag[]; approved_at?: string | null })[]) {
    const has = holdsOf(o.flags).some((f) => f.key === "hold_payment");
    if (has) { if (await releasePaymentHold(admin, o)) freed++; continue; }
    const { owed, kind } = await owedToStart(admin, o);
    if (kind === "none" || owed <= 0.005) continue;
    const { data: off } = await admin.from("order_events").select("id").eq("order_id", o.id).eq("kind", "unhold").like("detail", "Payment%").gte("created_at", o.approved_at || "").limit(1);
    if ((off || []).length) continue;
    const r = await setHold(admin, o.id, { key: "hold_payment", show: "message", by: AUTO_HOLD, note: kind === "deposit" ? `We need your deposit of ${money(owed)} to start your order.` : `We need your payment of ${money(owed)} to start your order.` });
    if (r.ok) held++;
  }
  return { held, freed };
}
