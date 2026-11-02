/** Goods issues: types and the email to the supplier's rep, safe for the browser (lib/goodsIssues.ts is the server side). */
export type IssueOwner = "customer" | "shop";
export type IssueItem = { style: string; color: string; size: string; expected: number; received: number; owed: number; bad?: number; issue: string; note?: string };
export type GoodsIssue = {
  id: string; order_id: string | null; archived_order_id: string | null; customer_id: string | null; checkin_id: string | null;
  kind: "short" | "over" | "mispick" | "damaged" | "missing" | "tracking"; source: string; owner: IssueOwner;
  supplier: string; supplier_order: string; po: string; items: IssueItem[]; tracking: string; title: string; detail: string; photos: string[];
  status: "open" | "reported" | "replacing" | "closed"; reported_at: string | null; reported_by: string; closed_at: string | null; closed_by: string; closed_how: string;
  created_at: string; updated_at: string;
  /** filled in for the page */ number?: string; nickname?: string; photoUrls?: string[];
};
export const SUPPLIER: Record<string, string> = { ss: "S&S", sanmar: "SanMar", alpha: "alphabroder" };
export const supplierName = (s: string) => SUPPLIER[s] || s || "the supplier";
/**
 * Suppliers who'll talk to us about an order on the customer's own account (Nov 2, Nick: "we can talk to SanMar… we
 * can't talk to S&S about an order"). An issue on goods from one of these is ours to work; from any other supplier on
 * the customer's account, the customer contacts them and we suggest it. Our own blank orders are always ours.
 */
export const TALKS_TO_US: Record<string, boolean> = { sanmar: true };
export const whoWorks = (o: { blanks: boolean; supplier: string }): IssueOwner => (o.blanks || TALKS_TO_US[o.supplier] ? "shop" : "customer");
export const STEPS: { k: GoodsIssue["status"]; label: string }[] = [
  { k: "open", label: "Found" }, { k: "reported", label: "Reported" }, { k: "replacing", label: "Replacement coming" }, { k: "closed", label: "Closed" },
];
const line = (it: IssueItem) => [it.style, it.color, it.size].filter(Boolean).join(" ");

/**
 * The email to the supplier's rep (Nov 2, Nick: "an easy tool… on this order, we received this… we were short here,
 * here's a picture… this box was damaged… we need it to be replaced"): written for them, sent from their own email.
 */
export function issueEmail(i: GoodsIssue, o: { shipTo: string; signer: string }) {
  const sup = supplierName(i.supplier);
  const ref = [i.supplier_order && `${sup} order ${i.supplier_order}`, i.po && `PO ${i.po}`].filter(Boolean).join(" · ");
  const what = i.kind === "tracking" ? "Shipment problem" : i.kind === "short" ? "Short shipment" : i.kind === "damaged" ? "Damaged goods" : i.kind === "mispick" ? "Wrong items received" : i.kind === "over" ? "Received more than ordered" : "Problem with an order";
  const subject = `${what}${ref ? ` · ${ref}` : ""}`;
  const rows = i.kind === "tracking"
    ? [`Tracking ${i.tracking}: ${i.detail}`]
    : i.items.map((it) => `· ${line(it)}: ordered ${it.expected}, received ${it.received}${it.bad ? `, ${it.bad} ${it.issue === "mispick" ? "wrong" : "damaged"}` : ""}${it.owed ? ` (need ${it.owed})` : ""}${it.note ? `. ${it.note}` : ""}`);
  const ask = i.kind === "over" ? "Please let us know if you'd like the extras sent back." : i.kind === "tracking" ? "Can you check on it with the carrier and let us know?" : `Please send the replacement${i.items.some((it) => it.owed) ? "s" : ""} to:\n${o.shipTo}\nor let us know if you'd rather credit it.`;
  const photos = (i.photoUrls || []).length ? `\n\nPhotos:\n${(i.photoUrls || []).join("\n")}` : "";
  const body = `Hi,\n\nOn ${ref || "our order"}, ${i.kind === "tracking" ? "there's a problem with the shipment:" : "here's what we received:"}\n${rows.join("\n")}${photos}\n\n${ask}\n\nThanks,\n${o.signer}`;
  return { subject, body };
}
export const mailto = (to: string, subject: string, body: string) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
