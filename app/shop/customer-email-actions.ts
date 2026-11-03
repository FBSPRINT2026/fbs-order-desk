"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The customer's emails that follow what the shop does (lib/customerEmailServer.ts): marked shipped (tracking), Ready
 * (pickup) and Completed (our delivery). Each goes only to the people the customer chose, once per order, and only once
 * the shop has turned automatic customer emails on.
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}

export async function shipmentShipped(shipmentId: string) {
  try {
    const { admin, by } = await staff();
    const m = await import("@/lib/customerEmailServer");
    // follow its tracking for the delivered / problem emails
    const { data: sp } = await admin.from("shipments").select("carrier, boxes, tracker_id").eq("id", shipmentId).maybeSingle();
    const s = sp as { carrier: string; boxes: { tracking?: string }[]; tracker_id: string | null } | null;
    const trk = (s?.boxes || []).map((b) => (b.tracking || "").trim()).find(Boolean);
    if (s && trk && !s.tracker_id) {
      const { startTracker } = await import("@/lib/goodsTrack");
      const f = await startTracker(trk, s.carrier).catch(() => null);
      if (f) await admin.from("shipments").update({ tracker_id: f.tracker_id, track_status: f.track_status, track_detail: f.track_detail, track_updated_at: f.track_updated_at }).eq("id", shipmentId);
    }
    const r = await m.emailShipped(admin, shipmentId, by);
    return { ok: true as const, sent: r?.sent || [] };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

export async function orderStatusEmail(orderId: string, status: string) {
  try {
    const { admin, by } = await staff();
    const r = await (await import("@/lib/customerEmailServer")).emailForStatus(admin, orderId, status, by);
    return { ok: true as const, sent: r?.sent || [] };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
