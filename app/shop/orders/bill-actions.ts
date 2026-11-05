"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";
import { billKey, cleanBill, type BillTo } from "@/lib/billTo";

/**
 * An account's departments, learned from its past orders' Bill to (lib/billTo.ts): one per department, its newest details,
 * how many orders went to it. Nobody saves them on purpose; billing an order to one is what teaches it.
 */
export async function billDepartments(customerId: string): Promise<{ b: BillTo; n: number; last: string }[]> {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !customerId) return [];
  const admin = createAdminClient();
  const { data } = await allRows<{ bill_to: BillTo | null; created_at: string }>((ra, rb) => admin.from("orders").select("bill_to, created_at")
    .eq("customer_id", customerId).not("bill_to", "is", null).is("discarded_at", null).order("created_at", { ascending: false }).order("id").range(ra, rb));
  const by = new Map<string, { b: BillTo; n: number; last: string }>();
  for (const r of data || []) {
    const b = r.bill_to ? cleanBill(r.bill_to) : null;
    if (!b) continue;
    const k = billKey(b), had = by.get(k);
    if (had) had.n++; else by.set(k, { b, n: 1, last: r.created_at });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
}
