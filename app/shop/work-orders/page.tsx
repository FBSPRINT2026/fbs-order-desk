import { createAdminClient } from "@/lib/supabase/admin";
import { mergeProduction } from "@/lib/production";
import WorkOrders, { type WoJob } from "./WorkOrders";

export const dynamic = "force-dynamic";

/**
 * Work Orders (Nick, Nov 13 2026: "a computer that sits by a color printer where they go in and print off all the
 * orders… print all work orders for today… select them all and print them all at one time"): the jobs on the schedule
 * by the day they run, each with its press and time, ticked and printed together (/print/work), and marked printed.
 * The FBS-PO shop computer opens here (lib/stations.ts); anyone with the schedule can.
 */
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export default async function Page() {
  const admin = createAdminClient();
  const today = ymd(new Date());
  const until = ymd(new Date(Date.now() + 10 * 86400000));
  const [{ data: st }, { data: slots }] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("production_slots").select("order_id, machine, day, position, start_min, status").not("order_id", "is", null).gte("day", today).lte("day", until).order("day").order("position"),
  ]);
  const data = (st?.data || {}) as Record<string, unknown>;
  const prod = mergeProduction(data.production);
  const mName = new Map(prod.machines.map((m) => [m.id, m.name]));
  const mLead = new Map(prod.machines.map((m) => [m.id, prod.crews.find((c) => c.id === m.crew)?.leader || ""]));
  const ids = [...new Set(((slots || []) as { order_id: string }[]).map((x) => x.order_id))];
  const { data: os } = ids.length ? await admin.from("orders").select("id, number, nickname, qty, status, customers(company, name)").in("id", ids) : { data: [] };
  const oById = new Map(((os || []) as unknown as { id: string; number: number; nickname: string | null; qty: number | null; status: string; customers: { company: string | null; name: string | null } | null }[]).map((o) => [o.id, o]));
  const printed = (data.woPrinted || {}) as Record<string, string>;
  // one row per order per day: its first booking that day (press and time)
  const seen = new Set<string>(), jobs: WoJob[] = [];
  for (const s of (slots || []) as { order_id: string; machine: string; day: string; position: number; start_min: number | null; status: string }[]) {
    const o = oById.get(s.order_id); if (!o) continue;
    const k = s.order_id + "|" + s.day; if (seen.has(k)) continue; seen.add(k);
    jobs.push({ id: o.id, number: o.number, name: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", qty: o.qty || 0, day: s.day, press: mName.get(s.machine) || "", lead: mLead.get(s.machine) || "", start: s.start_min, done: s.status === "done", printed: printed[o.id] || null });
  }
  return <WorkOrders jobs={jobs} today={today} />;
}
