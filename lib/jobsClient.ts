import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpenJob } from "@/lib/timeclock";

const PV_DONE = /job\s*completed|quote\s*-\s*closed|cancel/i;
/** Open jobs for picking (staff pages): new orders in the works and open Printavo orders, soonest due first. */
export async function loadOpenJobs(sb: SupabaseClient): Promise<OpenJob[]> {
  const [{ data: o }, { data: a }] = await Promise.all([
    sb.from("orders").select("id, number, nickname, due_date, qty, status, customer_id").in("status", ["approved", "art", "blanks", "production", "ready"]).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
    sb.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, customer_id").eq("kind", "invoice").gte("due_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)).order("due_date").limit(500),
  ]);
  const pv = ((a || []) as { id: string; visual_id: string; nickname: string; due_date: string | null; qty: number; status_name: string; customer_id: string | null }[]).filter((x) => !PV_DONE.test(x.status_name || ""));
  const ids = [...new Set([...((o || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...pv.map((x) => x.customer_id)].filter(Boolean))] as string[];
  const cn = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 300));
    for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name);
  }
  return [
    ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null }[]).map((x): OpenJob => ({ kind: "o", id: x.id, number: String(x.number), name: x.nickname || "", customer: cn.get(x.customer_id || "") || "", due: x.due_date, qty: x.qty || 0, status: x.status })),
    ...pv.map((x): OpenJob => ({ kind: "a", id: x.id, number: x.visual_id, name: x.nickname || "", customer: cn.get(x.customer_id || "") || "", due: x.due_date, qty: x.qty || 0, status: x.status_name })),
  ].sort((p, q) => (p.due || "9").localeCompare(q.due || "9"));
}
