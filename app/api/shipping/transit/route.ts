import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easypostConfigured, rateParcel } from "@/lib/easypost";
import { emptyAddress } from "@/lib/shipping";
import { mergeSettings } from "@/lib/pricing";
import { STATES } from "@/lib/transit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The transit map (staff only). GET: what we have. POST: price one standard box (12×10×8, 10 lb) from our ZIP to
 * the main city of every state with UPS and FedEx (EasyPost rates; no labels are bought) and save the business days.
 */
export async function GET() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { data, error } = await v.supabase.from("ship_transit").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [], ready: easypostConfigured() });
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet. Add EASYPOST_API_KEY in Vercel." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const from = mergeSettings(st?.data).ship.from;
  if (!from.zip) return NextResponse.json({ error: "Set our ship-from ZIP first (Shipping Center → Settings)." }, { status: 400 });
  // only the states asked for (or all), a few at a time so it finishes inside one request
  const want = Array.isArray(b.states) && b.states.length ? STATES.filter((s) => b.states.includes(s.st)) : STATES;
  const deadline = Date.now() + 50000;
  const done: string[] = [], failed: { st: string; error: string }[] = [];
  const queue = [...want];
  async function worker() {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (Date.now() > deadline) { queue.unshift(s); return; }
      try {
        const rates = await rateParcel({ from: { ...from, country: "US" }, to: { ...emptyAddress(), zip: s.zip, city: s.city, state: s.st }, parcel: { length: 12, width: 10, height: 8, weightLb: 10 } });
        const rows = rates.filter((r) => /ups|fedex/i.test(r.carrier)).map((r) => ({ state: s.st, zip: s.zip, city: s.city, carrier: /ups/i.test(r.carrier) ? "UPS" : "FedEx", service: r.service, days: r.days, cost: r.cost, delivery_date: r.deliveryDate || null, from_zip: from.zip, updated_at: new Date().toISOString() }));
        if (rows.length) {
          const { error } = await admin.from("ship_transit").upsert(rows, { onConflict: "state,carrier,service" });
          if (error) throw new Error(error.message);
        }
        done.push(s.st);
      } catch (e) { failed.push({ st: s.st, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return NextResponse.json({ done, failed, left: queue.map((s) => s.st) });
}
