"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dismissDigitizeEmail, placeDigitizeEmail } from "@/lib/digitizerOutside";

/** Digitizing: an email to the digitizer sent outside the portal, put on its order by hand, or set aside (lib/digitizerOutside.ts) */
export async function matchOutsideDigitize(activityId: string, orderId: string | null) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false as const, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    if (!orderId) { await dismissDigitizeEmail(admin, activityId); return { ok: true as const, number: 0 }; }
    return await placeDigitizeEmail(admin, activityId, orderId, v.email);
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
