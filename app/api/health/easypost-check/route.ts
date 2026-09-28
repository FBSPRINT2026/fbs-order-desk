import { NextResponse } from "next/server";
import { rateShipment } from "@/lib/easypost";
import { emptyAddress } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: checks the EasyPost connection with a sample rate request (rates are free; nothing is bought).
// Returns only carrier/service names, prices and days for a made-up box. Removed after use.
export async function GET() {
  const from = { ...emptyAddress(), company: "FBS Print", city: "Richardson", state: "TX", zip: "75081", phone: "9724877858" };
  const to = { ...emptyAddress(), company: "Test", name: "Test", street1: "417 Montgomery St", city: "San Francisco", state: "CA", zip: "94104", phone: "4155550100" };
  const out: Record<string, unknown> = {};
  try {
    const r = await rateShipment({ from, to, boxes: [{ n: 1, length: 18, width: 14, height: 10, weight: 20 }], bill: "fbs", account: "", zip: "", reference: "test" });
    out.rates = r.rates.map((x) => `${x.carrier} ${x.service}: $${x.cost} · ${x.days ?? "?"} days${x.deliveryDate ? " · " + x.deliveryDate.slice(0, 10) : ""}`);
  } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
  return NextResponse.json(out);
}
