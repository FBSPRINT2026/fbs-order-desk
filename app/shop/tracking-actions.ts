"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addressFromText, carrierOf, type Box } from "@/lib/shipping";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tracking added by hand (Nick, Nov 19 2026: "manually ship all the other orders through FedEx… a little plus sign, plus
 * tracking… once you do one… drop down another field below it, and then when you say done, it should be done"). For a
 * job shipped outside our label buying (FedEx's own site, a customer's account): the numbers go on a shipment of its own
 * (one box each), the order's tracking, its log, and the order is done. Nothing is emailed. The order page's Delivery
 * panel shows it like any shipment (components/OrderShipments.tsx). Opened from + Tracking on Ready to ship
 * (components/shipping/ShippingCenter.tsx).
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
type Flag = { key: string; note?: string; by?: string; at?: string };

/** a shipped order is done: Ready (Shipping) → Completed; part of it shipped, the rest still printing, stays where it is */
async function doneShipping(admin: SupabaseClient, orderId: string, shipmentId: string, by: string) {
  const { data: o } = await admin.from("orders").select("status, flags").eq("id", orderId).maybeSingle();
  const fl = (Array.isArray(o?.flags) ? o!.flags : []) as Flag[];
  const pf = fl.find((f) => f.key === "partial");
  if (pf && o?.status !== "ready" && !(pf.note || "").startsWith("shipped:")) {
    await admin.from("orders").update({ flags: fl.map((f) => (f === pf ? { ...f, note: `shipped:${shipmentId}` } : f)) }).eq("id", orderId);
    return "part";
  }
  if (o?.status === "ready") {
    const { error } = await admin.from("orders").update({ status: "completed", flags: fl.filter((f) => f.key !== "partial") }).eq("id", orderId).eq("status", "ready");
    if (!error) { await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "completed", actor: by }); return "completed"; }
  }
  return "";
}

/** after Mark shipped in the ship window: the order is done too (the same as + Tracking) */
export async function orderShipped(orderId: string, shipmentId: string) {
  try { const { admin, by } = await staff(); return { ok: true as const, did: await doneShipping(admin, orderId, shipmentId, by) }; } catch (e) { return fail(e); }
}

export async function addTracking(input: { kind: "order" | "archived"; id: string; numbers: string[]; carrier?: string; /** "Ground", "2Day"… */ service?: string }) {
  try {
    const { admin, by } = await staff();
    const nums = [...new Set(input.numbers.map((n) => n.replace(/\s+/g, "").trim()).filter(Boolean))].slice(0, 60);
    if (!nums.length) return { ok: false as const, error: "Paste a tracking number first." };
    const carrier = (input.carrier || carrierOf(nums[0]) || "").trim();
    const key = input.kind === "order" ? "order_id" : "archived_order_id";
    // the order and where it goes
    let customerId: string | null = null, shipText = "", label = "";
    if (input.kind === "order") {
      const { data: o } = await admin.from("orders").select("number, customer_id, ship_to, ship_method, tracking").eq("id", input.id).maybeSingle();
      if (!o) return { ok: false as const, error: "That order isn't here any more." };
      customerId = o.customer_id as string | null; shipText = String(o.ship_to || ""); label = `#${o.number}`;
    } else {
      const { data: o } = await admin.from("archived_orders").select("visual_id, customer_id").eq("id", input.id).maybeSingle();
      if (!o) return { ok: false as const, error: "That order isn't here any more." };
      customerId = o.customer_id as string | null; label = `#${o.visual_id}`;
    }
    const { data: c } = customerId ? await admin.from("customers").select("name, company, ship_address, address").eq("id", customerId).maybeSingle() : { data: null };
    const to = addressFromText(shipText || (c?.ship_address as string) || (c?.address as string) || "", (c?.name as string) || "", (c?.company as string) || "");
    const now = new Date().toISOString();
    // a shipment started in the ship window (draft or labeled) becomes this one; else a new one
    const { data: ex } = await admin.from("shipments").select("id, boxes, status").eq(key, input.id).in("status", ["draft", "labeled"]).order("updated_at", { ascending: false }).limit(1);
    const old = ((ex || [])[0] || null) as { id: string; boxes: Box[] | null } | null;
    const boxes: Box[] = nums.map((t, i) => ({ ...(old?.boxes?.[i] || { length: "", width: "", height: "", weight: "" }), n: i + 1, tracking: t }));
    const service = String(input.service || "").trim();
    const row = { status: "shipped", shipped_at: now, updated_at: now, carrier, service, boxes, note: "Tracking added by hand" };
    const r = old
      ? await admin.from("shipments").update(row).eq("id", old.id).select("id").maybeSingle()
      : await admin.from("shipments").insert({ ...row, [key]: input.id, customer_id: customerId, ship_to: to, bill_to: "fbs", bill_account: "", bill_zip: "", rates: null, cost: null, price: null, created_by: by }).select("id").maybeSingle();
    if (r.error || !r.data) return { ok: false as const, error: r.error?.message || "Couldn't save the shipment." };
    const sid = (r.data as { id: string }).id;
    let did = "";
    if (input.kind === "order") {
      await admin.from("orders").update({ tracking: nums.join(", "), ...(carrier && service ? { ship_method: `${carrier} ${service}` } : {}) }).eq("id", input.id);
      await admin.from("order_events").insert({ order_id: input.id, kind: "note", detail: `Shipped${carrier ? ` · ${carrier}${service ? " " + service : ""}` : ""} · tracking added by hand: ${nums.join(", ")}`, actor: by });
      did = await doneShipping(admin, input.id, sid, by);
    }
    // follow it for the order page's status (no email: Nick, Nov 19 2026)
    try {
      const { startTracker } = await import("@/lib/goodsTrack");
      const f = await startTracker(nums[0], carrier).catch(() => null);
      if (f) await admin.from("shipments").update({ tracker_id: f.tracker_id, track_status: f.track_status, track_detail: f.track_detail, track_updated_at: f.track_updated_at }).eq("id", sid);
    } catch { /* tracking status is a nice-to-have */ }
    return { ok: true as const, label, n: nums.length, carrier, did };
  } catch (e) { return fail(e); }
}
