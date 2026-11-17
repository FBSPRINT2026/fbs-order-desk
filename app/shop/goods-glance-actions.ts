"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkinJobs, weekOf } from "@/lib/checkin";
import type { CheckJob } from "@/lib/checkinShared";

/** one order's goods for its Goods card (components/GoodsGlance.tsx): the same reading Goods & Receiving counts from */
export async function goodsGlance(orderId: string): Promise<{ ok: true; job: CheckJob | null } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can see that.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const from = weekOf(today), to = new Date(new Date(from + "T12:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const r = await checkinJobs(createAdminClient(), from, to, { kind: "o", id: orderId }, true) as { jobs?: CheckJob[]; problems?: CheckJob[] };
    return { ok: true, job: [...(r.problems || []), ...(r.jobs || [])][0] || null };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the goods." }; }
}
