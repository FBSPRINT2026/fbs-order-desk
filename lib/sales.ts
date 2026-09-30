/**
 * What counts as a sale (the same rule as the database's sales_lines, used by the dashboard):
 * Printavo invoices, not closed quotes ("Quote - Closed"), plain quotes, holders ("Holder Waiting on Details") or
 * cancelled jobs ("Quote - Paid" counts: it's paid). Orders here: invoices past the quote stage, not sample jobs.
 */
export const pvCountsAsSale = (kind: string | null | undefined, status: string | null | undefined) =>
  kind === "invoice" && !/cancel|holder|quote\s*-\s*closed|closed\s*quote/i.test(status || "") && !/^\s*quote\s*$/i.test(status || "");
export const orderCountsAsSale = (o: { type?: string | null; status?: string | null; source?: string | null }) =>
  o.type === "invoice" && !["request", "quote", "quote_sent"].includes(o.status || "") && o.source !== "sample";
