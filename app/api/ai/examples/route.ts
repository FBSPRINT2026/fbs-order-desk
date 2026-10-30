import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveExample } from "@/lib/ai/orderExamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create order's worked examples (lib/ai/orderExamples.ts), staff only. POST { orderId } saves (or refreshes) that order
 * as an example for its customer, the same as Yes, it's right or sending it does. GET ?customerId lists them.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const orderId = String(b.orderId || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "Which order?" }, { status: 400 });
  const r = await saveExample(createAdminClient(), orderId, v.email || "staff");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ error: "Staff only." }, { status: 403 });
  const customerId = new URL(req.url).searchParams.get("customerId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return Response.json({ error: "Which customer?" }, { status: 400 });
  const { data } = await createAdminClient().from("order_examples").select("order_id, title, confirmed_by, confirmed_at, order_text").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: false });
  return Response.json({ examples: data || [] });
}
