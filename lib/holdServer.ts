import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Flag, FlagKey } from "@/lib/orderStages";
import { AUTO_HOLD, HOLD_REASONS, holdsOf, isHoldKey, type HoldShow } from "@/lib/holds";
import { calcOrder, mergeSettings, orderGroups, type Order, type PayTerms, type Payment } from "@/lib/pricing";
import { upFront } from "@/lib/payTerms";

/**
 * Putting a job on hold and taking it off (lib/holds.ts), and the payment hold that runs itself:
 *  - a pre-pay or deposit job goes on hold for payment once it's waiting only on the money (quote and art approved, not
 *    gone to goods or the press) and a few minutes have passed (time to pay right then: Nick, "give it minutes… if a
 *    customer… exits out without paying, it should just say on hold"), from the 5-minute tick (sweepPaymentHolds);
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
  // the customer hears about it, as much as they're shown (Nick: "on hold should just go out"; lib/customerEmailServer.ts)
  if (h.show !== "none") await (await import("@/lib/customerEmailServer")).emailOnHold(admin, orderId, h.by).catch(() => null);
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

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Is the job waiting only on the customer's money? (Nov 3, Nick: "jobs shouldn't be on hold if they haven't been sent to
 * proof yet… if there's still a task in our hands"): the quote is approved, the art is approved (the proof, or staff
 * marked it approved another way; a job with no prints has no art to wait on), and nothing has gone to goods or the press
 * (still Approved or Art & proofs). Returns when it became ready, or "" while it's still ours to do.
 */
async function readyButForPay(admin: SupabaseClient, o: Order & { approved_at?: string | null }) {
  if (!["approved", "art"].includes(String(o.status)) || !o.approved_at) return "";
  const prints = orderGroups(o).some((g) => (g.imprints || []).length > 0);
  if (!prints) return o.approved_at;
  const { artGate } = await import("@/lib/artGate");
  const { gate } = await artGate(admin, o.id);
  if (!gate.approved) return "";
  return [o.approved_at, gate.approved.at || ""].sort().pop() || "";
}

/**
 * Every few minutes: a pre-pay or deposit job that's ready except for the money (readyButForPay) for `wait` minutes and
 * isn't paid goes on hold for payment (time to pay right then). An automatic hold on a job that's no longer only waiting
 * on payment comes off (the art went back for changes, it moved on). A job is never held again for payment after
 * someone on staff took that hold off.
 */
export async function sweepPaymentHolds(admin: SupabaseClient, waitMin = 10) {
  const now = Date.now(), cut = new Date(now - waitMin * 60000).toISOString(), old = new Date(now - 2 * 864e5).toISOString();
  const [{ data: fresh }, { data: holding }] = await Promise.all([
    admin.from("orders").select("*").eq("type", "invoice").in("status", ["approved", "art"]).is("discarded_at", null).is("printavo_id", null)
      .gte("approved_at", new Date(now - 30 * 864e5).toISOString()).order("id").limit(300),
    admin.from("orders").select("*").contains("flags", JSON.stringify([{ key: "hold_payment" }])).order("id").limit(300),
  ]);
  let held = 0, freed = 0;
  const seen = new Set<string>();
  for (const o of [...((holding || []) as (Order & { flags?: Flag[]; approved_at?: string | null })[]), ...((fresh || []) as (Order & { flags?: Flag[]; approved_at?: string | null })[])]) {
    if (seen.has(o.id)) continue; seen.add(o.id);
    const h = holdsOf(o.flags).find((f) => f.key === "hold_payment");
    if (h) {
      if (await releasePaymentHold(admin, o)) { freed++; continue; }
      // ours, and the job isn't only waiting on the money any more: off
      if (h.by === AUTO_HOLD && !(await readyButForPay(admin, o))) { await clearHold(admin, o.id, AUTO_HOLD, "hold_payment", "not waiting on payment yet"); freed++; }
      continue;
    }
    const since = await readyButForPay(admin, o);
    if (!since || since > cut || since < old) continue;
    const { owed, kind } = await owedToStart(admin, o);
    if (kind === "none" || owed <= 0.005) continue;
    // someone on staff took a payment hold off since it was approved: it stays off
    const { data: off } = await admin.from("order_events").select("id").eq("order_id", o.id).eq("kind", "unhold").like("detail", "Payment%").neq("actor", AUTO_HOLD).gte("created_at", o.approved_at || "").limit(1);
    if ((off || []).length) continue;
    const r = await setHold(admin, o.id, { key: "hold_payment", show: "message", by: AUTO_HOLD, note: kind === "deposit" ? `We need your deposit of ${money(owed)} to start your order.` : `We need your payment of ${money(owed)} to start your order.` });
    if (r.ok) held++;
  }
  return { held, freed };
}
