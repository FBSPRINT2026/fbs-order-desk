/**
 * The one way into approving an order from the portal (Nov 2, Nick): the same review page our email opens, the proof
 * first, then the quote (app/portal/orders/[id]/approve). Every "Review and approve" / "Review proof" link uses this.
 */
export const approveHref = (orderId: string, previewId?: string | null) => `/portal/orders/${orderId}/approve${previewId ? `?as=${previewId}` : ""}`;

/** what the customer still has to answer on an order (its review page's steps that are waiting on them) */
export type ReviewKind = "art" | "sewout" | "quote" | "invoice";
export const REVIEW_KINDS: ReviewKind[] = ["art", "sewout", "quote", "invoice"];
export const reviewWords = (kinds: string[]) => {
  const w = [...new Set(kinds.map((k) => (k === "art" ? "proof" : k === "sewout" ? "sew-out" : k === "invoice" ? "invoice" : k === "quote" ? "quote" : "")).filter(Boolean))];
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : w[0] || "";
};
