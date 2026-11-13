import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeProduction } from "@/lib/production";
import { crewMachines, type CrewView } from "@/lib/crewView";
import { localDay } from "@/lib/timeclock";
import { statusOf, timeSettings } from "@/lib/timeclockServer";
import { checkinJobs } from "@/lib/checkin";
import type { JobActor } from "@/lib/jobAccess";

/**
 * The crew phone's main menu (/crew; Nick, Nov 13 2026: "this is how most people at my company are going to get in the
 * site"): their time clock, their press's jobs today in order, receiving's jobs to count, and what their view does.
 */
export type CrewJob = { number: number; name: string; customer: string; qty: number; status: "running" | "paused" | "done" | "scheduled"; due: string | null; label: string; started: string | null; finished: string | null; counted: "yes" | "no" | "issue" | null; rush: boolean };
export type CrewPress = { id: string; name: string; jobs: CrewJob[] };
export type CountJob = { number: number; name: string; customer: string; qty: number; day: string; state: string; when: "today" | "tomorrow" | "later"; kind: string };
export type CrewHome = {
  name: string; view: CrewView; staff: boolean; today: string;
  clock: { state: "in" | "out" | "break"; since: string | null; minutes: number; next: string[] } | null;
  fixes: { id: string; day: string; kind: string; at: string | null; minutes: number | null; note: string; status: string; decision_note: string }[];
  presses: CrewPress[]; mine: string[];
  counting: CountJob[] | null; issues: { number: number; name: string; what: string }[];
};

const nextWorkDay = (d: string) => { const x = new Date(d + "T12:00:00Z"); do x.setUTCDate(x.getUTCDate() + 1); while ([0, 6].includes(x.getUTCDay())); return x.toISOString().slice(0, 10); };

export async function crewHome(admin: SupabaseClient, who: JobActor): Promise<CrewHome> {
  const today = localDay(new Date());
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const ps = mergeProduction((st?.data as { production?: unknown } | null)?.production);
  const out: CrewHome = { name: who.name, view: who.view, staff: who.kind === "staff", today, clock: null, fixes: [], presses: [], mine: [], counting: null, issues: [] };

  if (who.employeeId) {
    const s = await timeSettings(admin);
    const c = await statusOf(admin, s, who.employeeId).catch(() => null);
    if (c) out.clock = { state: c.state, since: c.since, minutes: c.todayMinutes, next: c.next };
    const { data: fx } = await admin.from("time_fix_requests").select("id, day, kind, at, minutes, note, status, decision_note").eq("employee_id", who.employeeId).gte("day", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).order("created_at", { ascending: false }).limit(10);
    out.fixes = (fx || []) as CrewHome["fixes"];
  }

  // the press team: their press's jobs today; the office sees every press
  const machines = ps.machines.filter((m) => m.active !== false);
  const mine = who.employeeId ? crewMachines(who.employeeId, ps.crews, machines) : [];
  out.mine = mine.map((m) => m.id);
  const show = ["press", "assist", "catcher"].includes(who.view) ? mine : who.view === "office" ? machines.filter((m) => m.type === "screen") : [];
  if (show.length) {
    const { data: sl } = await admin.from("production_slots").select("id, order_id, machine, day, position, start_min, status, label, started_at, finished_at").in("machine", show.map((m) => m.id)).eq("day", today).not("order_id", "is", null).order("position");
    const slots = (sl || []) as { order_id: string; machine: string; position: number; start_min: number | null; status: CrewJob["status"]; label: string; started_at: string | null; finished_at: string | null }[];
    const ids = [...new Set(slots.map((x) => x.order_id))];
    const [{ data: os }, { data: gc }] = await Promise.all([
      ids.length ? admin.from("orders").select("id, number, nickname, qty, due_date, rush, status, customers(company, name)").in("id", ids) : Promise.resolve({ data: [] }),
      ids.length ? admin.from("goods_checkins").select("order_id, status, resolved_at, created_at").in("order_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    type O = { id: string; number: number; nickname: string; qty: number; due_date: string | null; rush: boolean; status: string; customers: { company: string; name: string } | null };
    const om = new Map(((os || []) as unknown as O[]).map((o) => [o.id, o]));
    const counted = new Map<string, CrewJob["counted"]>();
    for (const g of (gc || []) as { order_id: string; status: string; resolved_at: string | null }[]) if (!counted.has(g.order_id)) counted.set(g.order_id, g.status === "issue" && !g.resolved_at ? "issue" : "yes");
    const rank = (s: string) => (s === "running" ? 0 : s === "paused" ? 1 : s === "scheduled" ? 2 : 3);
    out.presses = show.map((m) => ({
      id: m.id, name: m.name,
      jobs: slots.filter((x) => x.machine === m.id && om.has(x.order_id) && !om.get(x.order_id)!.status.match(/^(completed)$/))
        .sort((a, b) => rank(a.status) - rank(b.status) || (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.position - b.position)
        .map((x) => { const o = om.get(x.order_id)!; return { number: o.number, name: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", qty: o.qty || 0, status: x.status, due: o.due_date, label: x.label || "", started: x.started_at, finished: x.finished_at, counted: counted.get(x.order_id) || "no", rush: !!o.rush }; }),
    }));
  }

  // receiving: what's to count in, by the day it runs on the press
  if (who.view === "receiving" || who.view === "office") {
    const r = await checkinJobs(admin, today, today, null, true).catch(() => null);
    if (r) {
      const tom = nextWorkDay(today);
      out.counting = r.jobs.filter((j) => j.state !== "checked").map((j) => ({ number: j.number, name: j.nickname, customer: j.customer, qty: j.ordered, day: j.day, state: j.state, kind: j.kind, when: (j.day && j.day <= today ? "today" : j.day === tom ? "tomorrow" : "later") as CountJob["when"] }))
        .sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999") || a.number - b.number).slice(0, 80);
      out.issues = r.problems.slice(0, 30).map((j) => ({ number: j.number, name: j.nickname || j.customer, what: (j.checkins[0]?.lines || []).filter((l) => l.issue).map((l) => `${l.size} ${l.issue}`).slice(0, 3).join(", ") || "Goods problem" }));
    }
  }
  return out;
}
