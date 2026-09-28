import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { easypostConfigured, rateShipment } from "@/lib/easypost";
import { mergeSettings } from "@/lib/pricing";
import { addressReady, boxReady, shippingPrice, type BillTo, type Box } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shipping rates for the boxes in the ship window (staff only). Costs nothing; no label is bought. */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet. Add EASYPOST_API_KEY in Vercel." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const boxes = (Array.isArray(b.boxes) ? b.boxes : []) as Box[];
  const bill = (["fbs", "ups", "fedex"].includes(b.bill) ? b.bill : "fbs") as BillTo;
  if (!boxes.length || !boxes.every(boxReady)) return NextResponse.json({ error: "Every box needs its size and weight." }, { status: 400 });
  if (!addressReady(b.to || {})) return NextResponse.json({ error: "The ship-to address isn't complete." }, { status: 400 });
  if (bill !== "fbs" && (!String(b.account || "").trim() || !String(b.zip || "").trim())) return NextResponse.json({ error: "Enter the customer's account number and its billing ZIP." }, { status: 400 });
  const { data: st } = await v.supabase.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(st?.data).ship;
  // rates and transit times are figured from our ZIP (75081); the street is only needed for labels
  if (!s.from.zip) return NextResponse.json({ error: "Set our ship-from ZIP first (Shipping center → Settings)." }, { status: 400 });
  try {
    const r = await rateShipment({ from: s.from, to: b.to, boxes, bill, account: String(b.account || "").trim(), zip: String(b.zip || "").trim(), reference: String(b.reference || "") });
    return NextResponse.json({ easypostOrder: r.orderId, rates: r.rates.map((x) => ({ ...x, price: shippingPrice(x.cost, boxes.length, bill, s) })) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
