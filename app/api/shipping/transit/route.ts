import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easypostConfigured, rateParcel } from "@/lib/easypost";
import { emptyAddress } from "@/lib/shipping";
import { mergeSettings, DEFAULT_TRANSIT_BOX, type TransitBox } from "@/lib/pricing";
import { STATES } from "@/lib/transit";
import { zip3Areas } from "@/lib/usmap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The transit map (staff only), by 3-digit ZIP area like the UPS map.
 * GET: the areas, what the chosen service takes to each (and costs), the box it's priced for, and how much is priced.
 *      ?zip3=794 → every carrier/service to that area.
 * POST {action:"box", box}: change the box / weight / from ZIP the map is priced for (re-price afterwards).
 * POST {action:"build"}: price the areas not yet priced for the current box, as many as fit in one request (EasyPost
 *      rates; nothing is bought). Call again until left = 0.
 */
const ZIPS_URL = "https://cdn.jsdelivr.net/npm/zipcodes@8.0.0/lib/codes.js";
const boxOf = (st: unknown): TransitBox => ({ ...DEFAULT_TRANSIT_BOX, ...(mergeSettings(st).ship.transitBox || {}) });
const sigOf = (b: TransitBox, fromZip: string) => `${fromZip}|${b.length}x${b.width}x${b.height}|${b.weightLb}`;

async function context() {
  const admin = createAdminClient();
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(st?.data);
  const box = boxOf(st?.data);
  const fromZip = (box.fromZip || s.ship.from.zip || "").trim();
  return { admin, settingsData: (st?.data || {}) as Record<string, unknown>, from: s.ship.from, box, fromZip, sig: sigOf(box, fromZip) };
}

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const u = new URL(req.url);
  const { box, fromZip, sig } = await context();
  const zip3 = u.searchParams.get("zip3");
  if (zip3) {
    const { data } = await v.supabase.from("ship_transit_zip3").select("zip3, zip, st, carrier, service, days, cost, delivery_date, sig, updated_at").eq("zip3", zip3).neq("carrier", "_");
    return NextResponse.json({ rows: data || [] });
  }
  const carrier = u.searchParams.get("carrier") === "FedEx" ? "FedEx" : "UPS";
  const service = u.searchParams.get("service") || (carrier === "UPS" ? "Ground" : "FEDEX_GROUND");
  const mainZip3 = [...new Set(STATES.map((s) => s.zip.slice(0, 3)))];
  const [areas, svcRows, rows, priced, legacy] = await Promise.all([
    v.supabase.from("ship_zip3").select("zip3, st, zip, city, x, y").range(0, 1999),
    v.supabase.from("ship_transit_zip3").select("carrier, service").in("zip3", mainZip3).neq("carrier", "_").range(0, 1999),
    v.supabase.from("ship_transit_zip3").select("zip3, days, cost, sig, updated_at").eq("carrier", carrier).eq("service", service).range(0, 1999),
    v.supabase.from("ship_transit_zip3").select("zip3", { count: "exact", head: true }).eq("carrier", "_").eq("sig", sig),
    v.supabase.from("ship_transit").select("state, carrier, service, days, cost, updated_at, from_zip").range(0, 1999),
  ]);
  const services = [...new Map([...(svcRows.data || []), ...((legacy.data || []) as { carrier: string; service: string }[])].map((r) => [r.carrier + "|" + r.service, { carrier: r.carrier, service: r.service }])).values()];
  return NextResponse.json({
    ready: easypostConfigured(), box, fromZip, sig, carrier, service,
    areas: areas.data || [], services,
    rows: rows.data || [], legacy: legacy.data || [],
    priced: priced.count || 0, total: (areas.data || []).length,
  });
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const ctx = await context();
  const { admin } = ctx;

  if (b.action === "box") {
    const n = (x: unknown, lo: number, hi: number) => { const k = Number(x); return isFinite(k) && k >= lo && k <= hi ? Math.round(k * 10) / 10 : null; };
    const box: TransitBox = { length: n(b.box?.length, 1, 108) ?? 12, width: n(b.box?.width, 1, 108) ?? 10, height: n(b.box?.height, 1, 108) ?? 8, weightLb: n(b.box?.weightLb, 0.1, 150) ?? 10, fromZip: /^\d{5}$/.test(String(b.box?.fromZip || "").trim()) ? String(b.box.fromZip).trim() : "" };
    const data = { ...ctx.settingsData, ship: { ...((ctx.settingsData.ship as object) || {}), transitBox: box } };
    const { error } = await admin.from("settings").update({ data }).eq("id", 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, box, sig: sigOf(box, box.fromZip || ctx.from.zip) });
  }

  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet. Add EASYPOST_API_KEY in Vercel." }, { status: 503 });
  if (!ctx.fromZip) return NextResponse.json({ error: "Set our ship-from ZIP first (Shipping Center → Settings)." }, { status: 400 });
  const deadline = Date.now() + 48000;

  // first time: the 3-digit ZIP areas (from a public ZIP list: where each ZIP is), ~900 of them
  let { data: areas } = await admin.from("ship_zip3").select("zip3, st, zip, city").range(0, 1999);
  if (!areas || areas.length < 800) {
    const r = await fetch(ZIPS_URL, { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return NextResponse.json({ error: "Couldn't load the ZIP list to set up the map. Try again in a minute." }, { status: 502 });
    const t = await r.text();
    const codes = Object.values(JSON.parse(t.slice(t.indexOf("{"), t.indexOf("};\n") + 1))) as { zip: string; latitude: number; longitude: number; city: string; state: string }[];
    const rows = zip3Areas(codes);
    for (let i = 0; i < rows.length; i += 500) { const { error } = await admin.from("ship_zip3").upsert(rows.slice(i, i + 500), { onConflict: "zip3" }); if (error) return NextResponse.json({ error: error.message }, { status: 500 }); }
    areas = rows;
  }

  // what's already priced for this box
  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("ship_transit_zip3").select("zip3").eq("carrier", "_").eq("sig", ctx.sig).range(from, from + 999);
    (data || []).forEach((x) => done.add(x.zip3 as string));
    if (!data || data.length < 1000) break;
  }
  // each state's main city first (so the map is useful right away), then everything else
  const main = new Set(STATES.map((s) => s.zip.slice(0, 3)));
  const queue = (areas as { zip3: string; st: string; zip: string; city: string }[]).filter((a) => !done.has(a.zip3)).sort((a, b) => Number(main.has(b.zip3)) - Number(main.has(a.zip3)) || a.zip3.localeCompare(b.zip3));
  const failed: { zip3: string; error: string }[] = [];
  let priced = 0;
  const from = { ...ctx.from, zip: ctx.fromZip, country: "US" };
  async function worker() {
    for (let a = queue.shift(); a; a = queue.shift()) {
      if (Date.now() > deadline) { queue.unshift(a); return; }
      try {
        const rates = await rateParcel({ from, to: { ...emptyAddress(), zip: a.zip, city: a.city, state: a.st }, parcel: { length: ctx.box.length, width: ctx.box.width, height: ctx.box.height, weightLb: ctx.box.weightLb } });
        const now = new Date().toISOString();
        const rows: Record<string, unknown>[] = rates.filter((r) => /ups|fedex/i.test(r.carrier)).map((r) => ({ zip3: a.zip3, zip: a.zip, st: a.st, carrier: /ups/i.test(r.carrier) ? "UPS" : "FedEx", service: r.service, days: r.days, cost: r.cost, delivery_date: r.deliveryDate || null, sig: ctx.sig, updated_at: now }));
        rows.push({ zip3: a.zip3, zip: a.zip, st: a.st, carrier: "_", service: "_", days: null, cost: null, delivery_date: null, sig: ctx.sig, updated_at: now });
        const { error } = await admin.from("ship_transit_zip3").upsert(rows, { onConflict: "zip3,carrier,service" });
        if (error) throw new Error(error.message);
        priced++;
      } catch (e) { failed.push({ zip3: a.zip3, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return NextResponse.json({ priced, failed: failed.slice(0, 5), failedCount: failed.length, left: queue.length + failed.length, total: areas.length });
}
