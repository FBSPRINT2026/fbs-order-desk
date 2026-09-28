import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { payDueDate, type PayTerms } from "@/lib/pricing";

export type OpenInvoice = { id: string; number: number; nickname: string; po_number: string; customer_id: string; created_at: string; total: number; paid: number; balance: number; pay_due: string | null; status: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A customer's invoices with money still owed, oldest first (what a statement lists, and where a lump payment goes). */
export async function openInvoices(admin: SupabaseClient, customerIds: string[]): Promise<OpenInvoice[]> {
  if (!customerIds.length) return [];
  const [{ data: os }, { data: cs }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, po_number, customer_id, created_at, completed_at, approved_at, sent_at, total, status, type").in("customer_id", customerIds).eq("type", "invoice").neq("status", "quote").limit(5000),
    admin.from("customers").select("id, payment_terms").in("id", customerIds),
  ]);
  const orders = (os || []) as { id: string; number: number; nickname: string | null; po_number: string | null; customer_id: string; created_at: string; completed_at: string | null; approved_at: string | null; sent_at: string | null; total: number; status: string }[];
  const ids = orders.map((o) => o.id);
  const paid: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ps } = await admin.from("payments").select("order_id, amount").in("order_id", ids.slice(i, i + 300));
    (ps || []).forEach((p) => { paid[p.order_id] = (paid[p.order_id] || 0) + (+p.amount || 0); });
  }
  const terms = new Map(((cs || []) as { id: string; payment_terms: PayTerms }[]).map((c) => [c.id, c.payment_terms]));
  return orders
    .map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", po_number: o.po_number || "", customer_id: o.customer_id, created_at: o.created_at, status: o.status,
      total: r2(+o.total || 0), paid: r2(paid[o.id] || 0), balance: r2((+o.total || 0) - (paid[o.id] || 0)), pay_due: payDueDate(o, terms.get(o.customer_id)) }))
    .filter((o) => o.balance > 0.004)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.number - b.number);
}
