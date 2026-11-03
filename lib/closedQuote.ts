import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A closed quote's art (Nov 3, Nick: "if it's declined… none of that should be saved under the customer's files, except in
 * archive… it should automatically archive all the art"): the mockups made for the order go to the customer's Archive
 * when it's declined (by the customer or marked in the Job Center), and come back when it's made a live quote again. The
 * logos stay where they are (a logo can be on other jobs); the order keeps its proof versions as its history.
 */
export async function shelveClosedQuoteArt(admin: SupabaseClient, orderId: string, closed: boolean) {
  const now = new Date().toISOString();
  if (closed) {
    await admin.from("mockups").update({ shelved_at: now }).eq("order_id", orderId).is("shelved_at", null).is("archived_at", null);
  } else {
    // only the ones the close put away: shelved at or after the decline
    const { data: o } = await admin.from("orders").select("declined_at").eq("id", orderId).maybeSingle();
    const since = (o as { declined_at?: string | null } | null)?.declined_at;
    let q = admin.from("mockups").update({ shelved_at: null }).eq("order_id", orderId).is("archived_at", null).not("shelved_at", "is", null);
    if (since) q = q.gte("shelved_at", since);
    await q;
  }
}
