import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ourCustomersForMatching } from "@/lib/qbo/matchRun";
import { selfTest, type ArchivedRef } from "@/lib/qbo/selftest";
import type { OrderRow, OurCustomer, OurPayment } from "@/lib/qbo/map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The QuickBooks self-test on the real data (read only; nothing is written, QuickBooks isn't contacted). Same token
 * as the runner (x-sync-token). Returns each check and some samples of what would be sent.
 */
/** archived invoices with the Printavo customer on each (keyset pages: the rows carry big JSON, offsets time out) */
async function archivedRefs(admin: ReturnType<typeof createAdminClient>) {
  const out: Record<string, unknown>[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await admin.from("archived_orders").select("id, visual_id, customer_id, total, order_date, pcust:data->customer").eq("kind", "invoice").gt("id", after).order("id").limit(1000);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
    after = String(data![data!.length - 1].id);
  }
  return out;
}

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("qbo_settings").select("token").eq("id", 1).maybeSingle();
  if (!s || req.headers.get("x-sync-token") !== String(s.token)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const page = async <T,>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const out: T[] = [];
    for (let a = 0; ; a += 1000) { const { data, error } = await q(a, a + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if ((data || []).length < 1000) break; }
    return out;
  };
  const [{ data: st }, orders, customers, payments, archived, pcs, ours] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    page<OrderRow>((a, b) => admin.from("orders").select("*").gte("number", 40000).order("number").range(a, b)),
    page<OurCustomer>((a, b) => admin.from("customers").select("id, company, name, email, phone, address, ship_address, tax_exempt, payment_terms, is_test").order("id").range(a, b)),
    page<OurPayment>((a, b) => admin.from("payments").select("*").order("id").range(a, b)),
    archivedRefs(admin),
    page<Record<string, unknown>>((a, b) => admin.from("printavo_customers").select("printavo_id, data->primaryContact").order("printavo_id").range(a, b)),
    ourCustomersForMatching(admin),
  ]);
  const arch: ArchivedRef[] = archived.filter((a) => a.visual_id && a.customer_id && (a.pcust as { id?: string } | null)?.id).map((a) => ({
    visual_id: String(a.visual_id), customer_id: String(a.customer_id), pid: String((a.pcust as { id: string }).id), pname: String((a.pcust as { companyName?: string }).companyName || ""), total: +(a.total as number) || 0, date: String(a.order_date || ""),
  }));
  const pcEmails: Record<string, string> = {};
  for (const p of pcs) { const e = (p.primaryContact as { email?: string } | null)?.email; if (e) pcEmails[String(p.printavo_id)] = e; }
  const t0 = Date.now();
  const r = selfTest({ settings: st?.data, orders, customers, payments, archived: arch, ours, pcEmails });
  const failed = r.checks.filter((c) => !c.ok);
  return NextResponse.json({ passed: r.checks.length - failed.length, failed: failed.length, ms: Date.now() - t0, data: { orders: orders.length, customers: customers.length, payments: payments.length, archivedInvoices: arch.length }, checks: r.checks, samples: r.samples });
}
