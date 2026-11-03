import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a customer pays sales tax, from what they were actually charged (Nov 3, Nick: Boneyard Battle showed tax here
 * and none in Printavo. "We've got to avoid that"). Printavo's customer "tax exempt" box is often left unticked for
 * customers who were never charged tax (their lines just weren't marked taxed), so the box alone made new orders for
 * them start at 8.25%. The invoices are the truth: invoices in the last two years and none of them with any tax means
 * they're exempt.
 *
 * Used when a customer is imported and whenever one of their invoices comes in from Printavo. A customer moved to the
 * portal is kept as staff set them (their details live here now), so it's only applied to them by hand.
 */
const YEARS = 2;

/** "exempt": their recent invoices never had tax; "taxed": at least one did; null: no recent invoices to go by */
export async function taxFromHistory(sb: SupabaseClient, customerId: string): Promise<"exempt" | "taxed" | null> {
  const since = new Date(Date.now() - YEARS * 365.25 * 864e5).toISOString().slice(0, 10);
  const { data } = await sb.from("archived_orders").select("tax:data->salesTaxAmount").eq("customer_id", customerId).eq("kind", "invoice").is("removed_at", null).gte("order_date", since).limit(1000);
  const rows = (data || []) as { tax: number | string | null }[];
  if (!rows.length) return null;
  return rows.some((r) => +(r.tax || 0) > 0.004) ? "taxed" : "exempt";
}

/** mark a customer exempt when their invoices say so (never the other way: a customer marked exempt stays exempt) */
export async function settleCustomerTax(sb: SupabaseClient, customerId: string): Promise<boolean> {
  const { data: c } = await sb.from("customers").select("tax_exempt, moved_at").eq("id", customerId).maybeSingle();
  if (!c || c.tax_exempt || c.moved_at) return false;
  if ((await taxFromHistory(sb, customerId)) !== "exempt") return false;
  const { error } = await sb.from("customers").update({ tax_exempt: true }).eq("id", customerId);
  return !error;
}
