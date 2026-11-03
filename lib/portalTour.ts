import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** the portal tutorial (app/portal/tour-actions.ts): is the tour due for this person on this layout */
export async function tourDue(email: string, view: "simple" | "advanced", resetAt: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const { data } = await createAdminClient().from("portal_tour_seen").select("seen_at").eq("email", email.toLowerCase()).eq("view", view).maybeSingle();
  if (!data) return true;
  return !!resetAt && String(data.seen_at) < resetAt;
}
