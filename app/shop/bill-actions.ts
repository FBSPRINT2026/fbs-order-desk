"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { billInvoices, billPeople, recentBills, sendBill, type BillInvoice } from "@/lib/bills";
import { PAY_TERMS, type PayTerms } from "@/lib/pricing";

/** Send a bill (lib/bills.ts): what the tool needs to open, and the send. Staff only. */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}

export type BillView = { name: string; terms: string; invoices: BillInvoice[]; people: { email: string; name: string }[]; to: string[]; recent: Awaited<ReturnType<typeof recentBills>> };

export async function billView(customerId: string): Promise<{ ok: true; v: BillView } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    const [{ data: c }, invoices, who, recent] = await Promise.all([
      admin.from("customers").select("name, company, payment_terms").eq("id", customerId).maybeSingle(),
      billInvoices(admin, customerId), billPeople(admin, customerId), recentBills(admin, customerId),
    ]);
    if (!c) return { ok: false, error: "Customer not found." };
    const cu = c as { name: string; company: string; payment_terms: string | null };
    return { ok: true, v: { name: cu.company || cu.name, terms: PAY_TERMS[(cu.payment_terms || "receipt") as PayTerms] || "", invoices, people: who.people, to: who.to, recent } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function sendBillNow(customerId: string, b: { orderIds: string[]; to: string[]; note: string; remind: boolean }) {
  try {
    const { admin, by } = await staff();
    return await sendBill(admin, { customerId, ...b, by });
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
