import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeProduction } from "@/lib/production";
import { crewMachines, type CrewView } from "@/lib/crewView";
import { localDay, periodOf, addDays, timecard, punchFixed, type Punch } from "@/lib/timeclock";
import { statusOf, timeSettings } from "@/lib/timeclockServer";
import { checkinJobs } from "@/lib/checkin";
import type { JobActor } from "@/lib/jobAccess";

/**
 * The crew phone's main menu (/crew; Nick, Nov 13 2026: "this is how most people at my company are going to get in the
 * site"): their time clock, their press's jobs today in order, receiving's jobs to count, and what their view does.
 */
export type CrewJob = { minutes: number; startMin: number | null; number: number; name: string; customer: string; qty: number; status: "running" | "paused" | "done" | "scheduled"; due: string | null; label: string; started: string | null; finished: string | null; counted: "yes" | "no" | "issue" | null; rush: boolean };
export type CrewPress = { id: string; name: string; jobs: CrewJob[] };
export type CountJob = { number: number; name: string; customer: string; qty: number; day: string; state: string; when: "today" | "tomorrow" | "later"; kind: string };
export type CrewHome = {
  name: string; view: CrewView; staff: boolean; today: string;
  clock: { state: "in" | "out" | "break"; since: string | null; minutes: number; next: string[] } | null;
  fixes: { id: string; day: string; kind: string; at: string | null; minutes: number | null; note: string; status: string; decision_note: string }[];
  presses: CrewPress[]; mine: string[];
  counting: CountJob[] | null; issues: { number: number; name: string; what: string }[];
  /** fulfillment: orders being finished; shipping: ready orders that ship */ queue: { number: number; name: string; customer: string; qty: number; due: string | null; delivery: string }[] | null;
  /** the day shown: today, or the next working day ("Tomorrow") */ day: string;
  /** extras on this person's menu (Deliveries): a switch at the top between their view and each extra */ also: string[];
  /**
   * Payday: their hours for the pay period just ended, to approve or ask a fix on (Nick, Nov 13 2026; uAttend's printed
   * time card sheets, on the phone). `ask`: put it first on the menu (the days after the period ends, until they answer).
   */
  hours: PeriodHours | null;
  /** Deliveries (an extra on someone's menu): orders ready to deliver */ deliveries: { number: number; name: string; customer: string; qty: number; due: string | null; address: string }[] | null;
};

/** one pay period on someone's phone: its days and hours, what they said about it, and whether the office approved it */
export type PeriodHours = { start: string; end: string; worked: number; overtime: number; breaks: number; ask: boolean; check: { status: "approved" | "fix_asked"; at: string } | null;
  /** the office approved the period (Time Clock → Payroll Report): nothing left for them to do */ office: boolean;
  /** the period isn't over yet: hours so far */ open: boolean;
  days: { day: string; first: string | null; last: string | null; worked: number; breaks: number; fixed: boolean; issues: number }[] };

const nextWorkDay = (d: string) => { const x = new Date(d + "T12:00:00Z"); do x.setUTCDate(x.getUTCDate() + 1); while ([0, 6].includes(x.getUTCDay())); return x.toISOString().slice(0, 10); };

export async function crewHome(admin: SupabaseClient, who: JobActor, next = false): Promise<CrewHome> {
  const today = localDay(new Date());
  const day = next ? nextWorkDay(today) : today;
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const ps = mergeProduction((st?.data as { production?: unknown } | null)?.production);
  const out: CrewHome = { name: who.name, view: who.view, staff: who.kind === "staff", today, clock: null, fixes: [], presses: [], mine: [], counting: null, issues: [], queue: null, day, deliveries: null, also: who.also || [], hours: null };

  if (who.employeeId) {
    const s = await timeSettings(admin);
    const c = await statusOf(admin, s, who.employeeId).catch(() => null);
    if (c) out.clock = { state: c.state, since: c.since, minutes: c.todayMinutes, next: c.next };
    const { data: fx } = await admin.from("time_fix_requests").select("id, day, kind, at, minutes, note, status, decision_note").eq("employee_id", who.employeeId).gte("day", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).order("created_at", { ascending: false }).limit(10);
    out.fixes = (fx || []) as CrewHome["fixes"];
    out.hours = await payPeriodHours(admin, s, who.employeeId, today).catch(() => null);
  }

  // the press team: their press's jobs today; the office sees every press
  const machines = ps.machines.filter((m) => m.active !== false);
  const mine = who.employeeId ? crewMachines(who.employeeId, ps.crews, machines) : [];
  out.mine = mine.map((m) => m.id);
  const show = ["press", "assist", "catcher"].includes(who.view) ? mine : who.view === "office" ? machines.filter((m) => m.type === "screen") : [];
  if (show.length) {
    const { data: sl } = await admin.from("production_slots").select("id, order_id, machine, day, position, start_min, minutes, status, label, started_at, finished_at").in("machine", show.map((m) => m.id)).eq("day", day).not("order_id", "is", null).order("position");
    const slots = (sl || []) as { order_id: string; machine: string; position: number; start_min: number | null; minutes: number; status: CrewJob["status"]; label: string; started_at: string | null; finished_at: string | null }[];
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
        .map((x) => { const o = om.get(x.order_id)!; return { minutes: x.minutes || 0, startMin: x.start_min, number: o.number, name: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", qty: o.qty || 0, status: x.status, due: o.due_date, label: x.label || "", started: x.started_at, finished: x.finished_at, counted: counted.get(x.order_id) || "no", rush: !!o.rush }; }),
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
  // fulfillment: what's being finished (folded, bagged, labeled); shipping: what's ready and ships
  if (who.view === "fulfillment" || who.view === "shipping") {
    const q = admin.from("orders").select("number, nickname, qty, due_date, delivery_method, customers(company, name)").is("discarded_at", null);
    const { data } = who.view === "fulfillment" ? await q.eq("status", "fulfillment").order("due_date").limit(60) : await q.eq("status", "ready").eq("delivery_method", "ship").order("due_date").limit(60);
    type Q = { number: number; nickname: string; qty: number; due_date: string | null; delivery_method: string; customers: { company: string; name: string } | null };
    out.queue = ((data || []) as unknown as Q[]).map((o) => ({ number: o.number, name: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", qty: o.qty || 0, due: o.due_date, delivery: o.delivery_method || "pickup" }));
  }
  if (who.also?.includes("delivery") || who.view === "office") {
    const { data } = await admin.from("orders").select("number, nickname, qty, due_date, ship_to, customers(company, name, address)").is("discarded_at", null).eq("status", "ready").eq("delivery_method", "deliver").order("due_date").limit(40);
    type D = { number: number; nickname: string; qty: number; due_date: string | null; ship_to: string | null; customers: { company: string; name: string; address: string } | null };
    out.deliveries = ((data || []) as unknown as D[]).map((o) => ({ number: o.number, name: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", qty: o.qty || 0, due: o.due_date, address: (o.ship_to || o.customers?.address || "").split(/\n/).filter(Boolean).slice(0, 2).join(", ") }));
  }
  return out;
}

/** the pay period that ended most recently, for the payday card (its own pay period, as My time cards shows it) */
async function payPeriodHours(admin: SupabaseClient, s: Awaited<ReturnType<typeof timeSettings>>, employeeId: string, today: string): Promise<CrewHome["hours"]> {
  return periodHours(admin, s, employeeId, periodOf(s, addDays(periodOf(s, today).start, -1)).start, today);
}

/**
 * One pay period's time card on the phone (payday card and My time cards; Nick, Nov 13 2026). `ask` (put it first on the
 * menu): the five days after it ends, until they approve it or the office approves the period, whichever comes first.
 */
export async function periodHours(admin: SupabaseClient, s: Awaited<ReturnType<typeof timeSettings>>, employeeId: string, start: string, today: string): Promise<PeriodHours> {
  const per = periodOf(s, start);
  const from = new Date(Date.parse(per.start + "T00:00:00Z") - 2 * 86400000).toISOString(), to = new Date(Date.parse(per.end + "T23:59:59Z") + 2 * 86400000).toISOString();
  const [{ data: ps }, ck, { data: ap }] = await Promise.all([
    admin.from("time_punches").select("id, employee_id, kind, at, source, voided, original_at, edited_by").eq("employee_id", employeeId).eq("voided", false).gte("at", from).lte("at", to).order("at"),
    admin.from("time_card_checks").select("status, decided_at").eq("employee_id", employeeId).eq("period_start", per.start).maybeSingle(),
    admin.from("time_periods").select("approved_at").eq("starts_on", per.start).maybeSingle(),
  ]);
  const punches = (ps || []) as (Punch & { source?: string })[];
  const open = per.end >= today;
  const card = timecard(s, employeeId, punches, [], per.start, per.end, open ? new Date().toISOString() : new Date(Date.parse(per.end + "T23:59:59Z") + 6 * 3600000).toISOString());
  const fixedDays = new Set(punches.filter(punchFixed).map((p) => localDay(p.at)));
  const days = Object.values(card.days).filter((d) => d.worked > 0 || d.first).sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({ day: d.day, first: d.first, last: d.last, worked: Math.round(d.worked), breaks: Math.round(d.breaks), fixed: fixedDays.has(d.day), issues: d.issues.length }));
  const c = ck.data as { status: "approved" | "fix_asked"; decided_at: string } | null;
  const check = c ? { status: c.status, at: c.decided_at } : null;
  const office = !!(ap as { approved_at: string | null } | null)?.approved_at;
  const ask = !office && check?.status !== "approved" && today > per.end && today <= addDays(per.end, 5) && days.length > 0;
  return { start: per.start, end: per.end, worked: Math.round(card.worked), overtime: Math.round(card.overtime), breaks: Math.round(card.breaks), ask, check, office, open, days };
}
