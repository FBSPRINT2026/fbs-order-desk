"use client";
import { orderGroups, ST, type Order } from "@/lib/pricing";
import SepRequest from "@/components/SepRequest";

/**
 * On an order with screen printing, once it's past the quote: where each location's separation is, and Request
 * Separations behind the art check (approved proofs, saved art; lib/artGate.ts). Requests land in the Separation
 * Center. The same panel is in the production calendar's job panel.
 */
export default function OrderSeparations({ o, stamp = "" }: { o: Pick<Order, "id" | "number" | "status" | "groups" | "lines" | "customer_id" | "due_date">;
  /** what the art check reads (the proofs' answers): when it changes the check runs again, so an approval shows at once
   *  (Nov 3, Nick: approved, and it still said "waiting on the customer") */ stamp?: string }) {
  const screen = orderGroups(o).some((g) => g.imprints.some((im) => im.method === "screen"));
  // only once it's an order (a sent quote is still a quote)
  if (!screen || o.status === "request" || ST[o.status]?.type === "quote") return null;
  return (
    <section className="panel sep-op">
      <div className="panel-h"><h2>Separations</h2></div>
      <div className="panel-b"><SepRequest key={`${o.status}|${stamp}`} orderId={o.id} /></div>
    </section>
  );
}
