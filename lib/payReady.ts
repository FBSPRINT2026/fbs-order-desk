/**
 * When a customer can pay an order online (Oct 24, Nick: "You can't pay an invoice just all the time… sometimes we will
 * ask for a payment… sometimes we have to confirm details still… we might not know the shipping till the end… if it's a
 * due on receipt thing and we're not done with it yet, we don't want them to pay… or… this invoice hasn't been
 * finalized yet, so there may be additional charges").
 *
 * The shop sets it per order (order page → Payments: Online payment), or leaves it on Auto:
 *   sent to us / quote being made        → not yet
 *   quote sent                           → the deposit (or all of it when there's no deposit): paying approves it
 *   approved, art, goods, in production  → the deposit if nothing's paid yet, else not yet ("we'll ask when it's done")
 *   ready, completed                     → the balance
 * "Charges may still change" lets them pay with a note saying the total isn't final (shipping, extras).
 */
export type PayMode = "auto" | "not_yet" | "deposit" | "ready";
export type PayCan = "none" | "deposit" | "full";
export type PayState = { can: PayCan; why: string; notFinal: boolean; note: string; mode: PayMode };

export function payState(o: { status: string; type?: string | null; pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, x: { paid: number; depositPct: number }): PayState {
  const mode: PayMode = o.pay_mode === "not_yet" || o.pay_mode === "deposit" || o.pay_mode === "ready" ? o.pay_mode : "auto";
  const note = (o.pay_note || "").trim();
  const notFinal = !!o.pay_not_final;
  const depOk = x.depositPct > 0 && x.paid < 0.005;
  const out = (can: PayCan, why: string): PayState => ({ can, why, notFinal: can !== "none" && notFinal, note, mode });
  if (o.status === "void") return out("none", "This order was canceled.");
  if (mode === "not_yet") return out("none", note || "We're finalizing this order. We'll let you know when it's ready to pay.");
  if (mode === "deposit") return depOk ? out("deposit", "We're asking for the deposit now.") : out("none", note || "We'll let you know when the balance is ready to pay.");
  if (mode === "ready") return out("full", "");
  // auto, by where the order is
  if (o.status === "request") return out("none", "We're checking your order. You can pay once we confirm it.");
  if (o.status === "quote") return out("none", "We're putting your quote together.");
  if (o.status === "quote_sent") return out(depOk ? "deposit" : "full", "Paying approves the quote.");
  if (o.status === "ready" || o.status === "completed") return out("full", "");
  return depOk ? out("deposit", "We're asking for the deposit now. The balance is due when your order is ready.") : out("none", "We'll ask for the balance when your order is ready.");
}
