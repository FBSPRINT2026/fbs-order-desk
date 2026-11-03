"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One sign-in on several customer accounts picks which one to view (Nov 3, Nick: "if an email is on multiple accounts…
 * would you like to log in to ABC Test Company or XYZ?"). The pick is kept for their email (portal_account_pick), and the
 * database's my_customer_ids() then answers with just that account, so every page and action shows and acts on it.
 */
export async function pickAccount(customerId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user || !email) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "Staff pick an account with Preview." };
    const { data: ids } = await supabase.rpc("my_all_customer_ids");
    const mine = ((ids || []) as unknown[]).map((x) => String(typeof x === "object" && x ? Object.values(x)[0] : x));
    if (!mine.includes(customerId)) return { ok: false, error: "That account isn't on your sign-in." };
    const { error } = await createAdminClient().from("portal_account_pick").upsert({ email: email.toLowerCase(), customer_id: customerId, picked_at: new Date().toISOString() });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't switch." }; }
}

/** every account on this sign-in (for the chooser and the Switch account link) */
export async function myAccountIds(): Promise<string[]> {
  const { supabase, user, isStaff } = await getViewer();
  if (!user || isStaff) return [];
  const { data } = await supabase.rpc("my_all_customer_ids");
  return ((data || []) as unknown[]).map((x) => String(typeof x === "object" && x ? Object.values(x)[0] : x));
}
