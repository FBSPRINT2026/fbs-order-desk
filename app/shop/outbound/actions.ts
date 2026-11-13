"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { custLabel } from "@/lib/format";

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}

/** Where a job is, for the person at the door (Nov 13, Nick): read straight off the order's status, nothing new kept. */
export type Where = "shelf" | "ship" | "deliver" | "packing" | "printing" | "waiting";
export type LookupJob = { key: string; id: string; printavo: boolean; href: string; number: string; job: string; customer: string; qty: number; due: string | null; where: Where; note: string };

const whereOf = (status: string, delivery: string | null): Where =>
  status === "ready" ? (delivery === "ship" ? "ship" : delivery === "deliver" ? "deliver" : "shelf")
    : status === "fulfillment" ? "packing" : status === "production" ? "printing" : "waiting";
const OPEN = ["approved", "production", "fulfillment", "ready"];
const clean = (s: string) => s.replace(/[%,()*\\]/g, " ").trim();

/**
 * Every open job for whoever is at the door: a customer's name, a job #, a PO, or words of the job's name (a reseller's
 * end client, "All My Sons", is in Nine18's job names). Open = Approved through Ready; old Printavo jobs only when ready.
 */
export async function outboundLookup(q: string): Promise<{ ok: true; jobs: LookupJob[] } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    const t = clean(q);
    if (t.length < 2) return { ok: true, jobs: [] };
    const num = t.replace(/^#/, "");
    const { data: cs } = await admin.from("customers").select("id").or(`company.ilike.%${t}%,name.ilike.%${t}%`).limit(25);
    const cids = ((cs || []) as { id: string }[]).map((c) => c.id);
    const ors = [`nickname.ilike.%${t}%`, `po_number.ilike.%${t}%`, ...(/^\d{3,7}$/.test(num) ? [`number.eq.${num}`] : []), ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
    const aors = [`nickname.ilike.%${t}%`, `po_number.ilike.%${t}%`, ...(/^\d{3,7}$/.test(num) ? [`visual_id.eq.${num}`] : []), ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
    const [n, a] = await Promise.all([
      admin.from("orders").select("id, number, nickname, qty, due_date, customer_id, status, delivery_method").is("discarded_at", null).in("status", OPEN).or(ors).order("due_date", { ascending: true, nullsFirst: false }).limit(60),
      admin.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, status_name, delivery:data->deliveryMethod").is("removed_at", null).ilike("status_name", "%ready%").or(aors).limit(30),
    ]);
    type N = { id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; status: string; delivery_method: string | null };
    type A = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string | null; status_name: string; delivery: string | null };
    const ns = (n.data || []) as N[], as = (a.data || []) as unknown as A[];
    const ids = [...new Set([...ns, ...as].map((o) => o.customer_id).filter(Boolean))] as string[];
    const { data: cc } = ids.length ? await admin.from("customers").select("id, company, name").in("id", ids) : { data: [] };
    const cust = new Map(((cc || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, custLabel(c)]));
    const pvWhere = (s: string, d: string | null): Where => (/pick/i.test(s + " " + (d || "")) ? "shelf" : /deliver/i.test(s + " " + (d || "")) ? "deliver" : "ship");
    const jobs: LookupJob[] = [
      ...ns.map((o) => ({ key: "o" + o.id, id: o.id, printavo: false, href: `/shop/orders/${o.id}`, number: String(o.number), job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, where: whereOf(o.status, o.delivery_method), note: "" })),
      ...as.map((o) => ({ key: "a" + o.id, id: o.id, printavo: true, href: `/shop/archive/${o.id}`, number: o.visual_id, job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, where: pvWhere(o.status_name, String(o.delivery || "")), note: "Printavo" })),
    ];
    // when the job is printing, say when it's booked to run (the schedule's next booking for it)
    const printing = jobs.filter((j) => !j.printavo && (j.where === "printing" || j.where === "waiting")).map((j) => j.id);
    if (printing.length) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const { data: sl } = await admin.from("production_slots").select("order_id, day, status").in("order_id", printing).neq("status", "done").gte("day", today).order("day").limit(200);
      const next = new Map<string, string>();
      for (const s of (sl || []) as { order_id: string; day: string }[]) if (!next.has(s.order_id)) next.set(s.order_id, s.day);
      for (const j of jobs) { const d = next.get(j.id); if (d) j.note = d === today ? "On the press today" : `On the schedule ${new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`; else if (j.where === "waiting") j.note = "Not on the schedule yet"; }
    }
    return { ok: true, jobs };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Picked up off the shelf: the order is Completed, logged with who handed it over. Our orders only (Printavo is read-only). */
export async function markPickedUp(orderIds: string[]): Promise<{ ok: true; done: number } | { ok: false; error: string }> {
  try {
    const { admin, by } = await staff();
    const ids = [...new Set(orderIds)].filter(Boolean).slice(0, 50);
    if (!ids.length) return { ok: true, done: 0 };
    const { data, error } = await admin.from("orders").update({ status: "completed" }).in("id", ids).eq("status", "ready").select("id");
    if (error) return { ok: false, error: error.message };
    const done = ((data || []) as { id: string }[]).map((r) => r.id);
    if (done.length) await admin.from("order_events").insert(done.map((id) => ({ order_id: id, kind: "status", detail: "completed", actor: `Picked up · ${by}` })));
    return { ok: true, done: done.length };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
