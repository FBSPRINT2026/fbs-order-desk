import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whose account a customer is: the account owner set on the customer (Settings → Staff → Account owners), else the
 * owner on the customer's latest Printavo order. One rule for every "My accounts" view (the Jobs calendar, the Job
 * Center; the dashboard reads the same two sources). Returns first names, lowercase.
 */
export const firstName = (x: string | null | undefined) => String(x || "").trim().split(/[\s._@-]+/)[0].toLowerCase();

export async function accountOwners(admin: SupabaseClient, customerIds: string[]): Promise<Map<string, string>> {
  const all = [...new Set(customerIds.filter(Boolean))];
  const acct = new Map<string, string>();
  for (let i = 0; i < all.length; i += 200) {
    const ids = all.slice(i, i + 200);
    // the latest Printavo owner per customer in one row each (archived_owners: DISTINCT ON in the database), not every past
    // order (Nov 2: reading all of them made the Job Center take ~3 seconds)
    const [{ data: last }, { data: ao }] = await Promise.all([
      admin.rpc("archived_owners", { p_ids: ids }),
      admin.from("customer_private").select("customer_id, account_owner").in("customer_id", ids).neq("account_owner", ""),
    ]);
    for (const r of (last || []) as { customer_id: string; owner: string | null }[]) if (r.owner && !acct.has(r.customer_id)) acct.set(r.customer_id, firstName(r.owner));
    for (const r of (ao || []) as { customer_id: string; account_owner: string }[]) acct.set(r.customer_id, firstName(r.account_owner));
  }
  return acct;
}
