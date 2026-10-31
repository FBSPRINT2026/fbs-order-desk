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
  // stop (or start again) using one example: it stays saved, it just isn't read (Settings → Order training)
  if (typeof b.id === "string" && typeof b.active === "boolean") {
    const { error } = await createAdminClient().from("order_examples").update({ active: b.active }).eq("id", b.id);
    return Response.json(error ? { ok: false, why: error.message } : { ok: true }, { status: error ? 400 : 200 });
  }
  const orderId = String(b.orderId || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "Which order?" }, { status: 400 });
  const r = await saveExample(createAdminClient(), orderId, v.email || "staff");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ error: "Staff only." }, { status: 403 });
  const customerId = new URL(req.url).searchParams.get("customerId") || "";
  // every customer's count (Settings → Order training)
  if (customerId === "all") {
    const { data } = await createAdminClient().from("order_examples").select("customer_id").eq("active", true).limit(5000);
    const n: Record<string, number> = {};
    for (const r of (data || []) as { customer_id: string }[]) n[r.customer_id] = (n[r.customer_id] || 0) + 1;
    return Response.json({ counts: n });
  }
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return Response.json({ error: "Which customer?" }, { status: 400 });
  const { data } = await createAdminClient().from("order_examples").select("id, order_id, title, confirmed_by, confirmed_at, order_text, active").eq("customer_id", customerId).order("confirmed_at", { ascending: false });
  return Response.json({ examples: data || [] });
}
