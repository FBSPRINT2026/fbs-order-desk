// Staff-only customer fields (internal notes, tags, follow-up date, owner, last contact) live in
// customer_private so customers can never read them from their own customer row.
// These helpers merge them onto Customer objects for shop pages and split them back out on save.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer } from "@/lib/pricing";

export const PRIVATE_KEYS = ["notes", "tags", "next_follow_up", "owner_email", "account_owner", "last_contact_at"] as const;
type Priv = { customer_id: string; notes: string; tags: string[]; next_follow_up: string | null; owner_email: string; account_owner: string; last_contact_at: string | null };

/** Adds the private fields to each customer (staff session or admin client only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withPrivate<T extends Customer>(sb: SupabaseClient<any, any, any>, customers: T[]): Promise<T[]> {
  if (!customers.length) return customers;
  const rows: Priv[] = [];
  const ids = customers.map((c) => c.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  // all the batches at once (one after another, 650 customers took four round trips in a row)
  for (const { data } of await Promise.all(chunks.map((c) => sb.from("customer_private").select("*").in("customer_id", c))))
    rows.push(...((data || []) as Priv[]));
  const m = new Map(rows.map((r) => [r.customer_id, r]));
  return customers.map((c) => {
    const p = m.get(c.id);
    return { ...c, notes: p?.notes || "", tags: p?.tags || [], next_follow_up: p?.next_follow_up || null, owner_email: p?.owner_email || "", account_owner: p?.account_owner || "", last_contact_at: p?.last_contact_at || null };
  });
}

/** Splits a customer into the public row and the private row for saving. last_contact_at is kept by the database. */
export function splitCustomer(c: Partial<Customer>) {
  const { notes, tags, next_follow_up, owner_email, account_owner, last_contact_at: _lc, ...pub0 } = c;
  // company_key is worked out by the database from the company name (never saved directly)
  const { company_key: _ck, ...pub } = pub0 as typeof pub0 & { company_key?: string };
  const priv: Record<string, unknown> = {};
  if (notes !== undefined) priv.notes = notes;
  if (tags !== undefined) priv.tags = tags;
  if (next_follow_up !== undefined) priv.next_follow_up = next_follow_up || null;
  if (owner_email !== undefined) priv.owner_email = owner_email;
  if (account_owner !== undefined) priv.account_owner = account_owner;
  return { pub, priv };
}
