import type { PayTerms } from "@/lib/pricing";

/**
 * What the customer pays when they approve, by their payment terms (Oct 29, Nick: "due on receipt… it should say…
 * nothing due today… if it's net 30… 30-day terms, or if it's 50-50… half due today… pay up front… $243.75 due today").
 * One rule for the email, the customer's order page, the send box, the portal's pay button and the deposit nudges.
 *  receipt  · nothing up front, paid when the order is ready
 *  net30    · nothing up front, invoiced on 30-day terms
 *  deposit  · the shop's deposit % (Settings) up front, the rest when ready
 *  prepay   · all of it up front
 */
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** the share paid up front, in percent */
export function termsPct(terms: PayTerms | null | undefined, depositPct: number): number {
  return terms === "prepay" ? 100 : terms === "deposit" ? depositPct || 50 : 0;
}

export type UpFront = { terms: PayTerms; pct: number; amount: number; kind: "none" | "deposit" | "full"; line: string; pay: string };
export function upFront(terms: PayTerms | null | undefined, total: number, depositPct: number, paid = 0): UpFront {
  const t: PayTerms = terms === "prepay" || terms === "deposit" || terms === "net30" ? terms : "receipt";
  const pct = termsPct(t, depositPct);
  const amount = Math.max(0, Math.round(total * pct) / 100 - paid);
  if (t === "prepay") return { terms: t, pct, amount, kind: "full", line: `${money(amount)} due today, paid up front`, pay: "Pay now" };
  if (t === "deposit") return { terms: t, pct, amount, kind: "deposit", line: `${pct === 50 ? "Half" : `${pct}%`} due today: ${money(amount)}. The rest when it's ready`, pay: "Pay the deposit" };
  if (t === "net30") return { terms: t, pct, amount: 0, kind: "none", line: "Nothing due today · Net 30 terms", pay: "" };
  return { terms: t, pct, amount: 0, kind: "none", line: "Nothing due today · Payment due on receipt", pay: "" };
}
