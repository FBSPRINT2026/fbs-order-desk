"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** After a change on the order page that can make it ready (a status, a payment typed in): its separations ask for
 *  themselves if it's ready now (lib/autoSeps.ts). Returns how many were requested. */
export async function autoSepsNow(orderId: string, why = ""): Promise<{ made: number }> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { made: 0 };
  const { autoSeparations } = await import("@/lib/autoSeps");
  return autoSeparations(createAdminClient(), orderId, why.slice(0, 40));
}
