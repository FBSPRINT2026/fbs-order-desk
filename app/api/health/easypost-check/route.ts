import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: which carrier accounts EasyPost uses (type and name only, no credentials) and, for a sample box, the
// rate we'd pay next to the carrier's list and retail rates. Rates are free; nothing is bought. Removed after use.
export async function GET() {
  const key = process.env.EASYPOST_API_KEY?.trim() || "";
  const auth = { Authorization: "Basic " + Buffer.from(key + ":").toString("base64"), "Content-Type": "application/json" };
  const out: Record<string, unknown> = {};
  const ca = await fetch("https://api.easypost.com/v2/carrier_accounts", { headers: auth, cache: "no-store" }).then((r) => r.json()).catch(() => null);
  out.accounts = Array.isArray(ca) ? ca.map((a: { id: string; type: string; description?: string; readable?: string; billing_type?: string; reference?: string }) => ({ id: a.id, type: a.type, readable: a.readable, description: a.description, billing_type: a.billing_type })) : ca;
  const body = { shipment: {
    from_address: { company: "FBS Print", street1: "811 Alpha Dr", street2: "STE 343", city: "Richardson", state: "TX", zip: "75081", country: "US", phone: "9724877858" },
    to_address: { company: "Test", street1: "417 Montgomery St", city: "San Francisco", state: "CA", zip: "94104", country: "US", phone: "4155550100" },
    parcel: { length: 21, width: 16, height: 13, weight: 320 },
  } };
  const sh = await fetch("https://api.easypost.com/v2/shipments", { method: "POST", headers: auth, body: JSON.stringify(body), cache: "no-store" }).then((r) => r.json()).catch(() => null);
  out.rates = (sh?.rates || []).filter((r: { carrier: string }) => /ups|fedex/i.test(r.carrier)).slice(0, 12)
    .map((r: { carrier: string; service: string; rate: string; list_rate: string | null; retail_rate: string | null; carrier_account_id: string }) => `${r.carrier} ${r.service}: ours $${r.rate} · list $${r.list_rate ?? "?"} · retail $${r.retail_rate ?? "?"} · acct ${r.carrier_account_id}`);
  if (sh?.messages?.length) out.messages = sh.messages.map((m: { carrier: string; message: string }) => `${m.carrier}: ${m.message}`);
  return NextResponse.json(out);
}
