import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every past job of the email's customer whose name matches (Oct 20, Nick: "when I click Reorder and search bottles it
 * only returns three… there's many more orders… it should pull up all the orders for that style on that account").
 * GET ?activity=<email id>&q=bottles → portal orders and Printavo jobs, newest first, as the Create order chooser lists
 * them (ref "o:<id>" / "a:<id>", the same refs a reorder reads).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim().slice(0, 60);
  const admin = createAdminClient();
  // or by customer (Customer artwork on an order, Oct 24: "search old orders… key in a name or an invoice number")
  const byCust = /^[0-9a-f-]{36}$/i.test(sp.get("customer") || "") ? sp.get("customer")! : "";
  const { data: a } = byCust ? { data: { customer_id: byCust } } : await admin.from("activities").select("customer_id").eq("id", sp.get("activity") || "").maybeSingle();
  const cid = (a?.customer_id as string) || "";
  if (!cid) return NextResponse.json({ jobs: [] });
  const like = `%${q.replace(/[%_,()]/g, " ").trim().split(/\s+/).join("%")}%`;
  const num = /^#?\d{4,6}$/.test(q) ? q.replace("#", "") : "";
  const [os, as] = await Promise.all([
    (num ? admin.from("orders").select("id, number, nickname, created_at, qty").eq("customer_id", cid).eq("number", +num)
      : admin.from("orders").select("id, number, nickname, created_at, qty").eq("customer_id", cid).ilike("nickname", like)).not("status", "in", "(request)").order("created_at", { ascending: false }).limit(60),
    (num ? admin.from("archived_orders").select("id, visual_id, nickname, order_date, qty").eq("customer_id", cid).eq("visual_id", num)
      : admin.from("archived_orders").select("id, visual_id, nickname, order_date, qty").eq("customer_id", cid).ilike("nickname", like)).eq("kind", "invoice").order("order_date", { ascending: false, nullsFirst: false }).limit(100),
  ]);
  const jobs = [
    ...((os.data || []) as { id: string; number: number; nickname: string | null; created_at: string; qty: number | null }[]).map((o) => ({ ref: `o:${o.id}`, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, date: String(o.created_at || "").slice(0, 10), qty: o.qty || 0, groups: [] })),
    ...((as.data || []) as { id: string; visual_id: string; nickname: string | null; order_date: string | null; qty: number | null }[]).map((r) => ({ ref: `a:${r.id}`, label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "", qty: r.qty || 0, groups: [] })),
  ].sort((x, y) => y.date.localeCompare(x.date));
  return NextResponse.json({ jobs });
}
