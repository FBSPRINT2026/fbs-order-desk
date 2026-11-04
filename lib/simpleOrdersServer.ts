import type { SupabaseClient } from "@supabase/supabase-js";
import { withItemsApproved } from "@/lib/simpleOrders";

/** a signage / promo / paper quote approved: its items' pictures are approved with it (lib/simpleOrders.ts) */
export async function approveItems(admin: SupabaseClient, orderId: string, by: string, at: string) {
  try {
    const { data: o } = await admin.from("orders").select("product_kind, groups").eq("id", orderId).maybeSingle();
    if (!o || !o.product_kind || o.product_kind === "apparel") return;
    const r = withItemsApproved((o.groups || []) as { lines: { spec?: import("@/lib/simpleOrders").SimpleSpec }[] }[], by, at);
    if (r.n) await admin.from("orders").update({ groups: r.groups }).eq("id", orderId);
  } catch (e) { console.warn("approveItems", e); }
}
