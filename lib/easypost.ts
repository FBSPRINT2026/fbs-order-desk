import "server-only";
import type { ShipAddress } from "@/lib/pricing";
import type { BillTo, Box, Rate } from "@/lib/shipping";

/**
 * EasyPost (UPS, FedEx and USPS through one connection). Uses the carrier accounts connected in FBS's EasyPost
 * dashboard, so rates are FBS's own. Third-party shipments are billed to the customer's UPS / FedEx account.
 * Getting rates costs nothing; buying labels is a separate step.
 */
const EP = "https://api.easypost.com/v2";
export const easypostConfigured = () => !!process.env.EASYPOST_API_KEY?.trim();

async function ep<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) throw new Error("EasyPost isn't connected yet (EASYPOST_API_KEY is missing in Vercel).");
  const r = await fetch(EP + path, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(key + ":").toString("base64") },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null) as (T & { error?: { message?: string; errors?: { field?: string; message?: string }[] } }) | null;
  if (!r.ok || !j || j.error) {
    const e = j?.error;
    throw new Error("EasyPost: " + ([e?.message, ...(e?.errors || []).map((x) => [x.field, x.message].filter(Boolean).join(" "))].filter(Boolean).join("; ") || `HTTP ${r.status}`));
  }
  return j;
}

const addr = (a: ShipAddress) => ({ name: a.name || undefined, company: a.company || undefined, street1: a.street1, street2: a.street2 || undefined, city: a.city, state: a.state, zip: a.zip, country: a.country || "US", phone: a.phone || undefined, email: a.email || undefined });

type EpRate = { id: string; carrier: string; service: string; rate: string; delivery_days: number | null; delivery_date: string | null };

/** Rates for a multi-box shipment (one EasyPost "order" with a shipment per box). */
export async function rateShipment(p: { from: ShipAddress; to: ShipAddress; boxes: Box[]; bill: BillTo; account: string; zip: string; reference: string }): Promise<{ orderId: string; rates: Omit<Rate, "price">[] }> {
  const payment = p.bill === "fbs" ? undefined : { type: "THIRD_PARTY", account: p.account, country: "US", postal_code: p.zip };
  const o = await ep<{ id: string; rates: EpRate[]; messages?: { carrier: string; message: string }[] }>("/orders", {
    order: {
      reference: p.reference,
      to_address: addr(p.to), from_address: addr(p.from),
      shipments: p.boxes.map((b) => ({
        parcel: { length: +b.length, width: +b.width, height: +b.height, weight: Math.round(+b.weight * 16 * 10) / 10 }, // weight in ounces
        options: { print_custom_1: p.reference, label_format: "PDF", label_size: "4x6", ...(payment ? { payment } : {}) },
      })),
    },
  });
  const want = p.bill === "ups" ? /ups/i : p.bill === "fedex" ? /fedex/i : /./;
  return {
    orderId: o.id,
    rates: (o.rates || []).filter((r) => want.test(r.carrier)).map((r) => ({ id: r.id, carrier: r.carrier, service: r.service, cost: +r.rate || 0, days: r.delivery_days, deliveryDate: r.delivery_date }))
      .sort((a, b) => a.cost - b.cost),
  };
}
