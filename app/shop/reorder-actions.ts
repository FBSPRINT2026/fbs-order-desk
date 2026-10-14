"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** The order's Reorder section: staff checked the reorder's pricing (an entry in the order's history). */
export async function confirmReorderPricing(orderId: string, summary: string): Promise<{ ok: true; by: string; at: string } | { ok: false; error: string }> {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    const by = String(v.staff?.name || "") || v.email.split("@")[0];
    const at = new Date().toISOString();
    const { error } = await createAdminClient().from("order_events").insert({ order_id: orderId, kind: "reorder_pricing", detail: `Reorder pricing checked: ${summary}`.slice(0, 500), actor: by, created_at: at });
    if (error) throw new Error(error.message);
    return { ok: true, by, at };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
