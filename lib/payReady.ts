import type { PayTerms } from "@/lib/pricing";
import { termsPct } from "@/lib/payTerms";

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
 * The customer's payment terms decide the rest (lib/payTerms.ts): on receipt and net 30 nothing before it's ready, 50/50
 * the deposit, pre-pay all of it.
 */
export type PayMode = "auto" | "not_yet" | "deposit" | "ready";
export type PayCan = "none" | "deposit" | "full";
export type PayState = { can: PayCan; why: string; notFinal: boolean; note: string; mode: PayMode };

export function payState(o: { status: string; type?: string | null; pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, x: { paid: number; depositPct: number; /** the customer's payment terms (lib/payTerms.ts): on receipt and net 30 nothing is paid before it's ready; pre-pay pays it all up front */ terms?: PayTerms | null }): PayState {
  const mode: PayMode = o.pay_mode === "not_yet" || o.pay_mode === "deposit" || o.pay_mode === "ready" ? o.pay_mode : "auto";
  const note = (o.pay_note || "").trim();
  const notFinal = !!o.pay_not_final;
  const pct = x.terms === undefined ? x.depositPct : termsPct(x.terms, x.depositPct);
  const depOk = pct > 0 && pct < 100 && x.paid < 0.005;
  const later = x.terms !== undefined && pct === 0; // on receipt or net 30: nothing until it's ready
  const later0 = x.terms === "net30" ? "Nothing is due now. Your invoice is on 30-day terms." : "Nothing is due now. Payment is due on receipt.";
  const out = (can: PayCan, why: string): PayState => ({ can, why, notFinal: can !== "none" && notFinal, note, mode });
  if (o.status === "void") return out("none", "This order was canceled.");
  if (mode === "not_yet") return out("none", note || "We're finalizing this order. We'll let you know when it's ready to pay.");
  // asked for by hand: the shop's deposit, whatever the terms
  if (mode === "deposit") return x.depositPct > 0 && x.paid < 0.005 ? out("deposit", "We're asking for the deposit now.") : out("none", note || "We'll let you know when the balance is ready to pay.");
  if (mode === "ready") return out("full", "");
  // auto, by where the order is
  if (o.status === "request") return out("none", "We're checking your order. You can pay once we confirm it.");
  if (o.status === "quote") return out("none", "We're putting your quote together.");
  if (o.status === "ready" || o.status === "completed") return out("full", "");
  if (later) return out("none", later0);
  if (o.status === "quote_sent") return out(depOk ? "deposit" : "full", "Paying approves the quote.");
  if (pct >= 100 && x.paid < 0.005) return out("full", "Your terms are paid up front.");
  return depOk ? out("deposit", "We're asking for the deposit now. The balance is due when your order is ready.") : out("none", "We'll ask for the balance when your order is ready.");
}
