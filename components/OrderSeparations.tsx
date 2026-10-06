"use client";
import { orderGroups, type Order } from "@/lib/pricing";
import SepRequest from "@/components/SepRequest";

/**
 * On an order with screen printing, once it's past the quote: where each location's separation is, and Request
 * Separations behind the art check (approved proofs, saved art; lib/artGate.ts). Requests land in the Separation
 * Center. The same panel is in the production calendar's job panel.
 */
export default function OrderSeparations({ o }: { o: Pick<Order, "id" | "number" | "status" | "groups" | "lines" | "customer_id" | "due_date"> }) {
  const screen = orderGroups(o).some((g) => g.imprints.some((im) => im.method === "screen"));
  if (!screen || ["quote", "request"].includes(o.status)) return null;
  return (
    <section className="panel sep-op">
      <div className="panel-h"><h2>Separations</h2></div>
      <div className="panel-b"><SepRequest orderId={o.id} /></div>
    </section>
  );
}
