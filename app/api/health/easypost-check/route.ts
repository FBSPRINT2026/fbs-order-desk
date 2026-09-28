import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY: the UPS / FedEx account numbers connected in EasyPost (account numbers only; no passwords or keys). Removed after use.
export async function GET() {
  const key = process.env.EASYPOST_API_KEY?.trim() || "";
  const ca = await fetch("https://api.easypost.com/v2/carrier_accounts", { headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") }, cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const pick = (c: Record<string, unknown> | undefined) => c ? Object.fromEntries(Object.entries(c).filter(([k]) => /account_number|shipper_number|account_id$/i.test(k))) : {};
  return NextResponse.json(Array.isArray(ca) ? ca.filter((a: { type: string }) => /ups|fedex/i.test(a.type)).map((a: { type: string; description?: string; credentials?: Record<string, unknown> }) => ({ type: a.type, description: a.description, ...pick(a.credentials) })) : { error: "could not read" });
}
