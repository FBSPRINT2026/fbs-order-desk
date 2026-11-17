"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkinJobs, weekOf } from "@/lib/checkin";
import type { CheckJob } from "@/lib/checkinShared";

/** one order's goods for its Goods card (components/GoodsGlance.tsx): the same reading Goods & Receiving counts from */
export async function goodsGlance(orderId: string): Promise<{ ok: true; job: CheckJob | null; goods: { status: string; supplier: string; supplier_po: string; updated_at: string | null } | null } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can see that.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const from = weekOf(today), to = new Date(new Date(from + "T12:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const r = await checkinJobs(createAdminClient(), from, to, { kind: "o", id: orderId }, true) as { jobs?: CheckJob[]; problems?: CheckJob[] };
    // the order's own goods status too: tracking cleared away (Nov 11) leaves the count-in list nothing to go by
    const { data: g } = await createAdminClient().from("order_goods").select("status, supplier, supplier_po, updated_at").eq("order_id", orderId).maybeSingle();
    return { ok: true, job: [...(r.problems || []), ...(r.jobs || [])][0] || null, goods: (g as { status: string; supplier: string; supplier_po: string; updated_at: string | null } | null) || null };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the goods." }; }
}
