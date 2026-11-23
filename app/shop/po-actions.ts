"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Purchase orders to a vendor for an order's items (app/print/[id]/po; Nick, Nov 23 2026: "quantity, a picture, item,
 * description… and then the shipping information… typically to us… just leave off pricing"). Saved so the PO number
 * (<order #>-<n>) stays the same when it's printed again, and so the vendors we've used come back next time.
 */
export type PoSave = {
  id?: string; vendor: string; vendorContact: string; shipToKind: "us" | "customer" | "other"; shipTo: string;
  neededBy: string | null; notes: string; lineIds: string[]; qty: Record<string, number>;
};

export async function savePo(orderId: string, p: PoSave): Promise<{ ok: true; id: string; seq: number } | { ok: false; error: string }> {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient();
    const row = {
      vendor: p.vendor.trim().slice(0, 200), vendor_contact: p.vendorContact.trim().slice(0, 1000), ship_to_kind: p.shipToKind,
      ship_to: p.shipTo.trim().slice(0, 1000), needed_by: p.neededBy || null, notes: p.notes.trim().slice(0, 2000),
      line_ids: p.lineIds.slice(0, 200), qty: p.qty, updated_at: new Date().toISOString(),
    };
    if (p.id) {
      const { data, error } = await admin.from("purchase_orders").update(row).eq("id", p.id).eq("order_id", orderId).select("id, seq").maybeSingle();
      if (error || !data) return { ok: false, error: error?.message || "That PO isn't here." };
      return { ok: true, id: data.id as string, seq: data.seq as number };
    }
    const { data: last } = await admin.from("purchase_orders").select("seq").eq("order_id", orderId).order("seq", { ascending: false }).limit(1);
    const seq = (((last || [])[0] as { seq: number } | undefined)?.seq || 0) + 1;
    const by = String((v.staff as { name?: string } | null)?.name || v.email || "");
    const { data, error } = await admin.from("purchase_orders").insert({ ...row, order_id: orderId, seq, created_by: by }).select("id, seq").single();
    if (error || !data) return { ok: false, error: error?.message || "Couldn't save the PO." };
    return { ok: true, id: data.id as string, seq: data.seq as number };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
