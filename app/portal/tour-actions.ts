"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The portal's first-time tutorial (Nov 3, Nick: "the first time somebody logs in, it'll show. But then after that, it
 * won't show again. And then if they call, I can reset it"). Kept per person (their sign-in email) and per layout
 * (simple / full) in portal_tour_seen, so it follows them to another phone or computer; the shop's Reset tutorial sets
 * the customer's tour_reset_at, and anyone there whose tour was seen before that sees it again.
 */
type Result = { ok: boolean; error?: string };
type View = "simple" | "advanced";

/** they finished or skipped it (staff previewing: nothing is kept) */
export async function tourDone(view: View): Promise<Result> {
  try {
    const { user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff || !email) return { ok: true };
    const { error } = await createAdminClient().from("portal_tour_seen").upsert({ email: email.toLowerCase(), view: view === "advanced" ? "advanced" : "simple", seen_at: new Date().toISOString() });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/** the shop's Reset tutorial on a customer: everyone there sees it again next time they sign in */
export async function resetTour(customerId: string): Promise<Result> {
  try {
    const { isStaff } = await getViewer();
    if (!isStaff) return { ok: false, error: "Only the shop can reset a customer's tutorial." };
    const { error } = await createAdminClient().from("customers").update({ tour_reset_at: new Date().toISOString() }).eq("id", customerId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reset." }; }
}
