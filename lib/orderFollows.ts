import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Following an order is each login's own (Nov 5, Nick: "people with multiple accounts… if you follow an order, does it
 * follow it for everybody or just your own login"): order_follows (order_id, email). The portal pages lay the viewer's
 * follows over `customer_starred_at`, so everything that reads it (the tracker, the star, the order lists) shows only
 * theirs. A staff preview shows anyone's on the account.
 */
export async function withMyFollows<T extends { id: string }>(admin: SupabaseClient, orders: T[], email: string | null | undefined, preview: boolean): Promise<(T & { customer_starred_at: string | null })[]> {
  const ids = orders.map((o) => o.id);
  const at = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    let q = admin.from("order_follows").select("order_id, email, created_at").in("order_id", ids.slice(i, i + 200));
    if (!preview) q = q.eq("email", String(email || "").toLowerCase());
    const { data } = await q;
    for (const r of (data || []) as { order_id: string; created_at: string }[]) if (!at.has(r.order_id) || r.created_at > at.get(r.order_id)!) at.set(r.order_id, r.created_at);
  }
  return orders.map((o) => ({ ...o, customer_starred_at: at.get(o.id) || null }));
}
