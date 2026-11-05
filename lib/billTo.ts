/**
 * Billing one order to a department of the account (Nov 5, Nick: "a fossil group… each department gets billed… I need to
 * be able to override master billing for a one-off invoice"). The order keeps its customer (pricing, terms, statements,
 * QuickBooks customer); `orders.bill_to` changes who the quote / invoice is addressed to and who it's emailed to. The
 * account's departments are learned from its past orders' bill_to (lib/billToServer.ts), so each one typed once is offered
 * next time for everyone.
 */
export type BillTo = { dept: string; attn?: string; email?: string; cc?: string; address?: string };

/** the order's department billing, when it has one */
export function billToOf(o: { bill_to?: BillTo | null } | null | undefined): BillTo | null {
  const b = o?.bill_to;
  return b && String(b.dept || "").trim() ? b : null;
}
export const cleanBill = (b: BillTo): BillTo | null => {
  const t = (s?: string) => String(s || "").trim();
  const x: BillTo = { dept: t(b.dept), attn: t(b.attn), email: t(b.email).toLowerCase(), cc: t(b.cc), address: t(b.address) };
  return x.dept ? x : null;
};
/** one key per department of an account ("Marketing Dept" = "marketing dept") */
export const billKey = (b: BillTo) => b.dept.trim().toLowerCase().replace(/\s+/g, " ");
/** the Bill to block on the quote / invoice: the name in bold, then short lines */
export function billBlock(b: BillTo | null, cust: { company?: string | null; name?: string | null }): { name: string; lines: string[] } {
  const company = cust.company || cust.name || "";
  if (!b) return { name: company || "—", lines: [cust.company && cust.name && cust.name !== cust.company ? cust.name : ""].filter(Boolean) };
  return { name: [company, b.dept].filter(Boolean).join(" · "), lines: [b.attn ? `Attn: ${b.attn}` : "", b.cc ? `Cost center ${b.cc}` : "", b.address || ""].filter(Boolean) };
}
/** the address text to bill to (QuickBooks' bill-to block): department and attention first, then the address */
export function billAddressText(b: BillTo, company: string, fallback: string | null | undefined) {
  return [[company, b.dept].filter(Boolean).join(" · "), b.attn ? `Attn: ${b.attn}` : "", b.address || fallback || ""].filter(Boolean).join("\n");
}
