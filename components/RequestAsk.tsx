"use client";
import { useRouter } from "next/navigation";

/**
 * A customer's order request isn't a quote or an invoice yet, so opening it on our side asks first, right where you
 * clicked, and goes to the Job Center (Nov 2, Nick: "you're clicking on a customer's order request. Would you like to open
 * this in the job center?… it should pop up on this screen… you shouldn't be able to get into that invoice"). One piece
 * for every place an order is opened: the customer page's list, and the order page itself as the fallback.
 */
export const requestHref = (o: { id: string }, customer: string) => `/shop/jobs?${new URLSearchParams({ step: "requests", q: customer, req: o.id })}`;
/** a customer's order request that was sent to us (not one they're still building) */
export const isSentRequest = (o: { status?: string; sent?: boolean; submitted_at?: string | null }) => o.status === "request" && (!!o.sent || !!o.submitted_at);

export default function RequestAsk({ order, customer, onClose, closeLabel = "Not now" }: {
  order: { id: string; number: number | null; nickname?: string | null }; customer: string; onClose: () => void; closeLabel?: string;
}) {
  const router = useRouter();
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Open this request in the Job Center?" onClick={onClose}>
      <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>This is {customer ? `${customer}'s` : "a customer's"} order request</h3>
        <p className="dla-sub">#{order.number}{order.nickname ? ` ${order.nickname}` : ""} isn&apos;t a quote or an invoice yet. Open it in the Job Center to look it over and process it.</p>
        <div className="dla-acts">
          <button type="button" className="btn ghost" onClick={onClose}>{closeLabel}</button>
          <button type="button" className="btn primary" autoFocus onClick={() => router.push(requestHref(order, customer))}>Open in the Job Center</button>
        </div>
      </div>
    </div>
  );
}
