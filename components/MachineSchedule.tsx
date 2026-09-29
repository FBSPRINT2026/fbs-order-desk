"use client";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mergeProduction, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, shiftOn, typicalShift, isOffDay, windowsIn, subNeed, restNeed, locsOf, PV_READY, type Machine, type Crew, type Down, type Need, type ProductionSettings, type Suggestion } from "@/lib/production";
import { mergeSettings, isMe, type Group, type AccountOwner } from "@/lib/pricing";
import { useSticky } from "@/lib/useSticky";

/**
 * The production calendar, on the shop's real hours.
 * 2 Days + 2 Weeks (default): the next two days hour by hour (5 AM – 8 PM shown, shifts default 7 AM – 6 PM) on the
 * left, the rest of two weeks as a machine x day list on the right. Timeline: two weeks of bars. Jobs run back to back inside each machine's shift, so a
 * 30-hour job fills that press for several days (shift hours only, never "overnight").
 * Day view: machines across, the clock down. Jobs not marked Done by the end of their day roll forward to today.
 * Ready To Schedule suggests a machine and day from colors, quantity, garments and stitches; drag a job to another
 * machine, day or time (a job only drops on a machine that can run it), or tap it to move it. Only our own orders are
 * planned here; Printavo jobs are left off (the Printavo-lane code stays, fed nothing, in case it's wanted again).
 */
type Job = { key: string; kind: "o" | "a"; id: string; number: string; customer: string; name: string; due: string | null; qty: number; status: string; needs: Need[]; href: string; owner: string };
type Slot = { id: string; order_id: string | null; archived_order_id: string | null; machine: string; day: string; position: number; minutes: number; start_min: number | null; kind: string; label: string; status: "scheduled" | "running" | "paused" | "done"; source: string; note: string; rolled_from: string | null;
  /** job log: when it really started / finished, how far along (0–1) as of progress_at; which print locations this booking covers (null = all) */
  started_at?: string | null; finished_at?: string | null; progress?: number; progress_at?: string | null; locations?: string[] | null };
/** a job on the calendar; startMin = asked-for start (minutes after midnight), null = right after the job before it */
type Card = { key: string; job: Job; need: Need; machine: Machine; day: string; minutes: number; startMin: number | null; slot: Slot | null; fromPv: boolean; carried?: string | null };
/** the locations a booking covers when it's only part of the job's work on that kind of machine (null = all of it) */
const locsFor = (job: { needs: Need[] }, need: Need) => { const full = job.needs.find((n) => n.type === need.type); return full && locsOf(need).length < locsOf(full).length ? locsOf(need) : null; };
/** Screen print colors the way the shop says them: front / back, then any sleeves etc. A front-only 4 color is "4/0". */
function screenColors(need: Need) {
  let front = 0, back = 0;
  const extra = new Map<string, number>();
  for (const st of need.steps) {
    const loc = (st.location || "").toLowerCase(), c = st.colors || 1;
    if (/back|nape|yoke|neck/.test(loc)) back = Math.max(back, c);
    else if (/sleeve|leg|hip|hood|cuff|collar/.test(loc)) extra.set(loc.trim(), Math.max(extra.get(loc.trim()) || 0, c));
    else front = Math.max(front, c);
  }
  return [front, back, ...extra.values()].join("/");
}
/** A job's print at a glance: units, colors per location ("7/1/2" = front 7, back 1, sleeve 2), run time. */
function glance(need: Need, minutes: number) {
  const byLoc = new Map<string, { colors: number; qty: number; k: number }>();
  for (const st of need.steps) {
    const k = (st.location || "").trim().toLowerCase() || "print", cur = byLoc.get(k) || { colors: 0, qty: 0, k: byLoc.size };
    cur.colors = Math.max(cur.colors, need.type === "embroidery" ? Math.round((st.stitches || 0) / 1000) : st.colors || 0); cur.qty += st.qty || 0; byLoc.set(k, cur);
  }
  const locs = [...byLoc.values()].sort((a, b) => a.k - b.k);
  const units = Math.max(0, ...locs.map((x) => x.qty));
  const colors = need.type === "screen" ? screenColors(need) : need.type === "embroidery" ? locs.map((x) => `${x.colors || 8}k`).join("/") : locs.length > 1 ? `${locs.length} loc` : "heat";
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return { units, colors, run: h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m` };
}
/** one day's piece of a job (a long job is several pieces, one per working day) */
/** one day's piece of a job: clock start/end, and the work minutes it covers (less than the clock time when the press runs slow) */
type Seg = { c: Card; day: string; start: number; end: number; part: number; parts: number; pushed: boolean; work: number; slow?: number };
type View = "split" | "timeline" | "day";
type Drag = { card?: Card; job?: Job; need?: Need; grabMin: number };
type Extra = { id: string; machine: string; crew_id: string | null; day: string; start_min: number; end_min: number; note: string };
type DayOff = { id: string; crew_id: string | null; machine: string | null; day: string; note: string; start_min: number | null; end_min: number | null; capacity: number | null; employee: string };

const TZ = "America/Chicago";
const PARTS = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** shop-time date + minutes after midnight for an instant */
function shopTime(d: Date | string | null): { day: string; min: number } | null {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(+x)) return null;
  const p = Object.fromEntries(PARTS.formatToParts(x).map((q) => [q.type, q.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
const dow = (d: string) => new Date(d + "T12:00:00").getDay();
const ord = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);
const fromOrd = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const monday = (d: string) => addDay(d, -((dow(d) + 6) % 7));
const dayLbl = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayShort = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
/** 420 → "7a", 510 → "8:30a" */
const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); const hh = h % 12 || 12, ap = h >= 12 ? "p" : "a"; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const clockLong = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const snap = (min: number, step = 15) => Math.round(min / step) * step;
const TYPE_LBL = { screen: "Screen Print", embroidery: "Embroidery", heat: "Heat Press" };
/** "Embroidery · 12 Head" → "12 Head", "Press 3 · 8C Sportsman" → "Press 3" */
const shortName = (m: Machine) => { const p = m.name.split(" · "); return p.length < 2 ? m.name : m.type === "embroidery" ? p[1] : p[0]; };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const PV_DONE = /job\s*completed|quote|cancel|ship|fulfillment|issue/i;
const HOUR_PX0 = 56;
const LANE = 22;

/**
 * Lay a machine's work out on its real hours. Jobs go in day order (asked-for start times first within a day, then
 * the booking order); each starts when the job before it ends, only inside the shift, and a job that doesn't fit in
 * what's left of the day carries into the next working day. So a 30-hour job fills ~4 shifts, never "overnight".
 */
function flow(cs: Card[], mach: Machine, nowAbs = -Infinity): Seg[] {
  // each day's shift can differ (crew schedules); a day it normally doesn't run but has work booked uses its usual hours
  const typ = typicalShift(mach);
  const hrs = (d: string) => shiftOn(mach, d) || typ;
  const booked = new Set(cs.map((c) => c.day));
  const works = (d: string) => !!shiftOn(mach, d) || (booked.has(d) && !isOffDay(mach, d));
  // within a day: finished work, then what's running (where it really started), then the rest in booking order
  const rank = (c: Card) => (c.slot?.status === "done" ? 0 : c.slot?.status === "running" ? 1 : 2);
  const sorted = [...cs].sort((a, b) => a.day.localeCompare(b.day) || rank(a) - rank(b) || (a.startMin ?? hrs(a.day)[0]) - (b.startMin ?? hrs(b.day)[0]) || (a.slot?.position ?? 99) - (b.slot?.position ?? 99));
  const out: Seg[] = [];
  let cursor = -Infinity;
  // the next moment this machine is running, at or after `t` (absolute minutes)
  // the stretches it can run each day: the shift minus any downtime (maintenance at noon splits the day in two)
  const wins = (d: string): [number, number, number][] => (works(d) ? windowsIn(hrs(d), mach.down?.[d]) : []);
  const norm = (t: number, allowEarly = false) => {
    for (let g = 0; g < 400; g++) {
      const dd = Math.floor(t / 1440), m = t - dd * 1440, ws = wins(fromOrd(dd));
      const w = ws.find(([, y]) => m < y);
      if (!w) { t = (dd + 1) * 1440; allowEarly = false; continue; }
      if (m < w[0] && !(allowEarly && w === ws[0])) return dd * 1440 + w[0];
      return t;
    }
    return t;
  };
  for (const c of sorted) {
    // finished work stays on the day it was done (it never spills into later days or pushes today's jobs)
    if (c.slot?.status === "done") {
      const [s0, s1] = hrs(c.day);
      const prior = out.filter((g) => g.day === c.day).reduce((m, g) => Math.max(m, g.end), s0);
      const st = Math.min(prior, s1 - 15);
      const en = Math.min(s1, st + Math.max(15, c.minutes));
      out.push({ c, day: c.day, start: st, end: en, part: 1, parts: 1, pushed: false, work: en - st });
      continue;
    }
    // work that hasn't started can't happen in the past: it starts from now at the earliest (the late crew, the
    // morning breakdown…), so everything after it slides forward, into tomorrow if today's shift is used up
    const notStarted = !c.slot || c.slot.status === "scheduled" || c.slot.status === "paused";
    const planned = ord(c.day) * 1440 + (c.startMin ?? hrs(c.day)[0]);
    const asked = Math.max(planned, notStarted ? nowAbs : -Infinity);
    let t = norm(Math.max(cursor, asked), cursor < asked && c.startMin != null && asked === planned);
    const pushed = t > planned + 1;
    let left = Math.max(1, c.minutes);
    const pieces: { day: string; start: number; end: number; work: number; slow: number }[] = [];
    for (let g = 0; g < 400 && left > 0.01; g++) {
      let dd = Math.floor(t / 1440), m = t - dd * 1440, w = wins(fromOrd(dd)).find(([, y]) => m < y);
      // don't start a longer job in the last few minutes of a window: start it in the next one
      if (g === 0 && w && w[1] - m < 10 && left / w[2] > w[1] - m) { t = norm(dd * 1440 + w[1]); dd = Math.floor(t / 1440); m = t - dd * 1440; w = wins(fromOrd(dd)).find(([, y]) => m < y); }
      // a slow stretch (operator out, 50%) takes twice the clock time for the same work
      const rate = w ? w[2] : 1;
      const end = Math.min(m + left / rate, Math.max(w ? w[1] : hrs(fromOrd(dd))[1], m + 15));
      const day = fromOrd(dd), work = (end - m) * rate, prev = pieces[pieces.length - 1];
      if (prev && prev.day === day && Math.abs(prev.end - m) < 0.5) { prev.end = end; prev.work += work; prev.slow = Math.min(prev.slow, rate); }
      else pieces.push({ day, start: m, end, work, slow: rate });
      left -= work;
      t = left > 0.01 ? norm(dd * 1440 + end) : dd * 1440 + end;
    }
    cursor = t;
    pieces.forEach((p, i) => out.push({ c, day: p.day, start: p.start, end: p.end, part: i + 1, parts: pieces.length, pushed: pushed && i === 0, work: p.work, slow: p.slow < 1 ? p.slow : undefined }));
  }
  return out;
}

export default function MachineSchedule() {
  const [now, setNow] = useState(() => shopTime(new Date())!);
  useEffect(() => { const t = setInterval(() => setNow(shopTime(new Date())!), 60000); return () => clearInterval(t); }, []);
  const today = now.day;
  const [s, setS] = useState<ProductionSettings | null>(null);
  const [view, setView] = useSticky<View>("cal.view", "split");
  const [week, setWeek] = useState(() => monday(shopTime(new Date())!.day));
  const [day, setDay] = useState(() => shopTime(new Date())!.day);
  const [wknd, setWknd] = useSticky<boolean | null>("cal.weekends", null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [pvLane, setPvLane] = useState<{ job: Job; machine: Machine; day: string; startMin: number | null; minutes: number | null; carried?: string }[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState("");
  const [open, setOpen] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  const [typeF, setTypeF] = useSticky<"" | "screen" | "embroidery" | "heat">("cal.type", "");
  // whose jobs: everyone's, or the accounts the signed-in person owns (others fade on the calendar)
  const [mine, setMine] = useSticky("cal.mine", false);
  const [me, setMe] = useState<{ email: string; name: string }>({ email: "", name: "" });
  const [owners, setOwners] = useState<AccountOwner[]>([]);
  const [trayAll, setTrayAll] = useState(false);
  const [trayOpen, setTrayOpen] = useSticky("cal.trayOpen", true);
  const [showPast, setShowPast] = useState(false);
  const [offs, setOffs] = useState<DayOff[]>([]);
  const [downEdit, setDownEdit] = useState<{ machine?: string; day?: string; start?: number; allDay?: boolean } | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [shiftEdit, setShiftEdit] = useState(false);
  const [replan, setReplan] = useState<null | { why: string; split?: boolean }>(null);
  const [replanTray, setReplanTray] = useSticky("cal.replanTray", true);
  const [replanBusy, setReplanBusy] = useState(false);
  const [checkin, setCheckin] = useState(false);
  // the "schedule too tight" prompt shows once a day (again if more jobs go late)
  const [tightSeen, setTightSeen] = useSticky("cal.tightSeen", "");

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: st }, { data: o }, { data: a }, { data: sl0 }, { data: off0 }, { data: ex0 }] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups, lines").in("status", ["approved", "art", "blanks", "production"]).limit(300),
      // Printavo jobs are left off the calendar (it plans our own orders only); nothing in Printavo is read or changed here
      Promise.resolve({ data: [] as unknown[] }),
      sb.from("production_slots").select("*").not("order_id", "is", null).gte("day", addDay(today, -21)).lte("day", addDay(today, 70)),
      sb.from("production_days_off").select("id, crew_id, machine, day, note, start_min, end_min, capacity, employee").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
      sb.from("production_extra_shifts").select("id, machine, crew_id, day, start_min, end_min, note").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
    ]);
    const exList = (ex0 || []) as Extra[];
    setExtras(exList);
    const offList = (off0 || []) as DayOff[];
    setOffs(offList);
    let sl = (sl0 || []) as Slot[];
    // not marked done by the end of its day → it moves forward to today (first in line), remembering where it started
    const stale = sl.filter((x) => x.order_id && x.day < today && x.status !== "done");
    if (stale.length) {
      await Promise.all(stale.map((x) => sb.from("production_slots").update({ day: today, start_min: null, position: -1, rolled_from: x.rolled_from || x.day, updated_at: new Date().toISOString() }).eq("id", x.id)));
      sl = sl.map((x) => (stale.includes(x) ? { ...x, day: today, start_min: null, position: -1, rolled_from: x.rolled_from || x.day } : x));
      // once a day: offer to re-plan around what didn't get done
      try { if (localStorage.getItem("fbs:cal.rolledSeen") !== today) { localStorage.setItem("fbs:cal.rolledSeen", today); setReplan({ why: `${stale.length} job${stale.length === 1 ? " wasn't" : "s weren't"} finished on ${stale.length === 1 ? "its" : "their"} day and moved to today. Re-plan so everything after them fits?` }); } } catch { /* private window */ }
    }
    // jobs the floor started in the employee app (punched onto the order) count as started here
    const oids = [...new Set(sl.filter((x) => x.day === today && x.order_id && x.status !== "done").map((x) => x.order_id!))];
    if (oids.length) {
      const { data: jt } = await sb.from("job_time").select("order_id, started_at, ended_at, pieces").in("order_id", oids).eq("voided", false).gte("started_at", new Date(Date.now() - 18 * 3600000).toISOString());
      const by = new Map<string, { first: string; open: boolean; pieces: number }>();
      for (const r of (jt || []) as { order_id: string; started_at: string; ended_at: string | null; pieces: number | null }[]) {
        const e = by.get(r.order_id) || { first: r.started_at, open: false, pieces: 0 };
        if (r.started_at < e.first) e.first = r.started_at;
        if (!r.ended_at) e.open = true;
        e.pieces += r.pieces || 0; by.set(r.order_id, e);
      }
      const qtyOf = new Map(((o || []) as { id: string; qty: number }[]).map((x) => [x.id, x.qty || 0]));
      const ups: PromiseLike<unknown>[] = [];
      for (const [oid, e] of by) {
        const x = sl.filter((y) => y.order_id === oid && y.day === today && y.status !== "done").sort((a1, b1) => a1.position - b1.position)[0];
        if (!x) continue;
        const q = qtyOf.get(oid) || 0, prog = q && e.pieces ? Math.min(0.95, e.pieces / q) : +(x.progress || 0);
        if (x.status === "scheduled" && e.open) {
          const patch = { status: "running" as const, started_at: e.first, progress: Math.max(+(x.progress || 0), prog), progress_at: new Date().toISOString() };
          Object.assign(x, patch);
          ups.push(sb.from("production_slots").update(patch).eq("id", x.id));
          ups.push(sb.from("production_slot_log").insert({ slot_id: x.id, order_id: oid, machine: x.machine, action: "start", progress: patch.progress, note: "Started in the employee app", at: e.first, by: "employee app" }));
        } else if (x.status === "running" && prog > +(x.progress || 0) + 0.01) {
          const patch = { progress: prog, progress_at: new Date().toISOString() };
          Object.assign(x, patch);
          ups.push(sb.from("production_slots").update(patch).eq("id", x.id));
        }
      }
      if (ups.length) await Promise.all(ups);
    }
    const ps0 = mergeProduction((st?.data as { production?: unknown } | null)?.production);
    // each machine carries its days off (its crew's and its own) so the calendar and suggestions skip them
    // whole days off vs downtime for part of a day (maintenance at noon)
    const ps = { ...ps0, machines: ps0.machines.map((m) => {
      const off: Record<string, string> = {}, down: Record<string, Down[]> = {};
      for (const x of offList) if (x.machine === m.id || (x.crew_id && x.crew_id === m.crew)) {
        const rate = Math.max(0, Math.min(100, x.capacity || 0)) / 100, why = x.employee ? `${x.employee} out` : x.note || "Down";
        // stopped all day = a day off; anything else is a stretch of downtime or a slow (short-handed) stretch
        if ((x.start_min == null || x.end_min == null) && rate === 0) off[x.day] = why;
        else (down[x.day] ||= []).push([x.start_min ?? 0, x.end_min ?? 1440, why, rate]);
      }
      const extra: Record<string, [number, number]> = {};
      for (const x of exList) if (x.machine === m.id) { const e = extra[x.day]; extra[x.day] = e ? [Math.min(e[0], x.start_min), Math.max(e[1], x.end_min)] : [x.start_min, x.end_min]; }
      return { ...m, off, down, extra };
    }) };
    setS(ps); setSlots(sl);
    const pv = ((a || []) as { id: string; visual_id: string; nickname: string; due_date: string | null; qty: number; status_name: string; customer_id: string | null; start: string | null; pend: string | null; pvgroups: unknown }[]).filter((x) => !PV_DONE.test(x.status_name || "") || PV_READY.test(x.status_name || ""));
    const ids = [...new Set([...((o || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...pv.map((x) => x.customer_id)].filter(Boolean))] as string[];
    const cn = new Map<string, string>(), own = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) {
      const [{ data }, { data: pr }] = await Promise.all([sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 300)), sb.from("customer_private").select("customer_id, account_owner").in("customer_id", ids.slice(i, i + 300))]);
      for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name);
      for (const r of (pr || []) as { customer_id: string; account_owner: string }[]) if (r.account_owner) own.set(r.customer_id, r.account_owner);
    }
    setOwners(mergeSettings(st?.data).accountOwners || []);
    const { data: { user } } = await sb.auth.getUser();
    if (user?.email) { const { data: sf } = await sb.from("staff").select("name").eq("email", user.email.toLowerCase()).maybeSingle(); setMe({ email: user.email.toLowerCase(), name: (sf?.name as string) || "" }); }
    const js: Job[] = [
      ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null; groups: Group[]; lines: never[] }[]).map((x) => ({ key: "o:" + x.id, kind: "o" as const, id: x.id, number: String(x.number), customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status, needs: needsForOrder(ps, x as never), href: `/shop/orders/${x.id}`, owner: own.get(x.customer_id || "") || "" })),
      ...pv.map((x) => ({ key: "a:" + x.id, kind: "a" as const, id: x.id, number: x.visual_id, customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status_name, needs: needsForPrintavo(ps, { qty: x.qty, status_name: x.status_name, nickname: x.nickname, data: { groups: x.pvgroups as never } }), href: `/shop/archive/${x.id}`, owner: "" })),
    ];
    setJobs(js);
    // Printavo jobs in a machine status sit on that machine at their Printavo times; past ones still in the status carry to today
    setPvLane(pv.map((x) => {
      const mach = machineForStatus(ps, x.status_name); if (!mach) return null;
      const job = js.find((j) => j.key === "a:" + x.id)!;
      const st0 = shopTime(x.start), en = shopTime(x.pend);
      const d0 = st0?.day || (x.due_date ? addDay(x.due_date, -1) : today);
      const block = st0 && en && en.day === st0.day && en.min > st0.min ? en.min - st0.min : null;
      const sane = st0 && st0.min >= 300 && st0.min <= 1320; // ignore midnight placeholders
      if (d0 < today) return { job, machine: mach, day: today, startMin: null, minutes: block, carried: d0 };
      return { job, machine: mach, day: d0, startMin: sane ? st0!.min : null, minutes: block };
    }).filter(Boolean) as typeof pvLane);
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const byKey = useMemo(() => new Map((jobs || []).map((j) => [j.key, j])), [jobs]);
  const slotKey = (x: { order_id: string | null; archived_order_id: string | null }) => (x.order_id ? "o:" + x.order_id : "a:" + x.archived_order_id);
  // everything on the calendar: our bookings, then Printavo machine statuses that aren't booked here
  const cards = useMemo<Card[]>(() => {
    if (!s || !jobs) return [];
    const out: Card[] = [];
    const booked = new Set<string>();
    for (const sl of slots) {
      const job = byKey.get(slotKey(sl)); const mach = s.machines.find((x) => x.id === sl.machine);
      booked.add(slotKey(sl) + ":" + sl.kind);
      if (!job || !mach) continue;
      const need0 = job.needs.find((n) => n.type === sl.kind) || job.needs[0];
      if (!need0) continue;
      const need = subNeed(need0, sl.locations);
      const est = sl.minutes || estimate(s, need, mach).minutes, prog = Math.max(0, Math.min(1, +(sl.progress || 0)));
      let minutes = est, startMin = sl.start_min;
      // started: it sits where it really started; what's left is the estimate less the share already done
      const st0 = sl.started_at ? shopTime(sl.started_at) : null, pa = sl.progress_at ? shopTime(sl.progress_at) : null;
      if (sl.status === "running" && st0 && st0.day === sl.day) { startMin = st0.min; minutes = (pa && pa.day === sl.day && pa.min > st0.min ? pa.min - st0.min : 0) + est * (1 - prog); }
      else if (sl.status === "running" || sl.status === "paused") minutes = Math.max(15, est * (1 - prog));
      out.push({ key: sl.id, job, need, machine: mach, day: sl.day, minutes: Math.max(15, minutes), startMin, slot: sl, fromPv: false, carried: sl.rolled_from });
    }
    for (const p of pvLane) {
      const need = p.job.needs.find((n) => n.type === p.machine.type) || p.job.needs[0];
      if (!need || booked.has(p.job.key + ":" + p.machine.type)) continue;
      out.push({ key: "pv:" + p.job.key, job: p.job, need, machine: p.machine, day: p.day, minutes: p.minutes || estimate(s, need, p.machine).minutes, startMin: p.startMin, slot: null, fromPv: true, carried: p.carried });
    }
    return out;
  }, [s, jobs, slots, pvLane, byKey]);

  // every machine's work laid out on its hours, split into per-day pieces
  const segs = useMemo(() => {
    const by = new Map<string, Seg[]>(), ofCard = new Map<string, Seg[]>();
    if (!s) return { by, ofCard };
    const per = new Map<string, Card[]>();
    for (const c of cards) per.set(c.machine.id, [...(per.get(c.machine.id) || []), c]);
    const nowAbs = ord(now.day) * 1440 + now.min;
    for (const [, cs] of per) for (const g of flow(cs, cs[0].machine, nowAbs)) {
      const k = g.c.machine.id + "|" + g.day;
      by.set(k, [...(by.get(k) || []), g]);
      ofCard.set(g.c.key, [...(ofCard.get(g.c.key) || []), g]);
    }
    return { by, ofCard };
  }, [cards, s, now]);
  const at = (m: Machine, d: string) => segs.by.get(m.id + "|" + d) || [];
  const used = (m: Machine, d: string) => at(m, d).reduce((a, g) => a + g.work, 0);
  const loadMap = useMemo(() => { const m: Record<string, Record<string, number>> = {}; for (const [k, gs] of segs.by) { const [id, d] = k.split("|"); (m[id] ||= {})[d] = gs.filter((g) => g.c.slot?.status !== "done").reduce((a, g) => a + g.work, 0); } return m; }, [segs]);

  // ready to schedule: in production (goods here, art done) or a Printavo "ready for production / scheduling" status, not booked yet
  const tray = useMemo(() => {
    if (!s || !jobs) return [];
    // what's booked per job and kind of machine: everything, or just some print locations
    const onCal = new Map<string, string[] | "all">();
    for (const c of cards) { const k = c.job.key + ":" + c.need.type, cur = onCal.get(k); if (cur === "all") continue; const l = c.slot?.locations; onCal.set(k, !l || !l.length ? "all" : [...(cur || []), ...l]); }
    const ready = jobs.filter((j) => (j.kind === "o" ? j.status === "production" : PV_READY.test(j.status)) && (!mine || isMe(j.owner, owners, me)));
    const ld = JSON.parse(JSON.stringify(loadMap)) as Record<string, Record<string, number>>;
    const out: { job: Job; need: Need; sug: Suggestion | null }[] = [];
    for (const j of [...ready].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))) for (const n0 of j.needs) {
      const bk = onCal.get(j.key + ":" + n0.type), n = bk ? restNeed(n0, bk) : n0;
      if (!n) continue;
      const sug = suggest(s, n, j.due, today, ld);
      if (sug) (ld[sug.machine.id] ||= {})[sug.day] = (ld[sug.machine.id]?.[sug.day] || 0) + sug.minutes; // later jobs see this one's room taken
      out.push({ job: j, need: n, sug });
    }
    return out;
  }, [s, jobs, cards, loadMap, today, mine, owners, me]);
  const coming = (jobs || []).filter((j) => j.kind === "o" && ["approved", "art", "blanks"].includes(j.status));
  // too tight: waiting jobs with no room before in-hands, and booked jobs that finish after their in-hands date
  const tight = useMemo(() => {
    const out: { job: Job; why: string }[] = [], seen = new Set<string>();
    for (const t of tray) if ((!t.sug || t.sug.late) && !seen.has(t.job.key)) { seen.add(t.job.key); out.push({ job: t.job, why: t.sug ? `no room before in-hands ${t.job.due ? dayLbl(t.job.due) : ""}` : "no machine free" }); }
    for (const c of cards) {
      if (!c.job.due || c.slot?.status === "done" || seen.has(c.job.key)) continue;
      const last = (segs.ofCard.get(c.key) || []).reduce((d, g) => (g.day > d ? g.day : d), "");
      if (last > c.job.due && c.job.due >= today) { seen.add(c.job.key); out.push({ job: c.job, why: `finishes ${dayLbl(last)}, in-hands ${dayLbl(c.job.due)}` }); }
    }
    return out;
  }, [tray, cards, segs, today]);

  async function book(job: Job, need: Need, machine: Machine, d: string, source = "manual", slot?: Slot | null, startMin: number | null = null) {
    if (!s) return;
    if (!fits(need, machine)) { setMsg(`#${job.number} needs ${need.type === "screen" ? `${need.needColors} screens` : TYPE_LBL[need.type]}: ${machine.name} can't run it.`); return; }
    const minutes = estimate(s, need, machine).minutes;
    const sb = createClient();
    const pos = cards.filter((c) => c.machine.id === machine.id && c.day === d).length;
    const r = slot
      ? await sb.from("production_slots").update({ machine: machine.id, day: d, minutes, start_min: startMin, position: pos, updated_at: new Date().toISOString() }).eq("id", slot.id)
      : await sb.from("production_slots").insert({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, machine: machine.id, day: d, minutes, start_min: startMin, position: pos, kind: need.type, label: need.label, source, locations: locsFor(job, need) });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(`#${job.number} → ${machine.name}, ${dayLbl(d)}${startMin != null ? ` at ${clockLong(startMin)}` : ""} (${fmtMin(minutes)})`);
    load();
  }
  async function acceptAll() {
    const pos: Record<string, number> = {};
    const rows = tray.filter((t) => t.sug && !t.sug.late).map((t) => {
      const k = t.sug!.machine.id + t.sug!.day; pos[k] = pos[k] ?? cards.filter((c) => c.machine.id === t.sug!.machine.id && c.day === t.sug!.day).length;
      return { order_id: t.job.kind === "o" ? t.job.id : null, archived_order_id: t.job.kind === "a" ? t.job.id : null, machine: t.sug!.machine.id, day: t.sug!.day, minutes: t.sug!.minutes, position: pos[k]++, kind: t.need.type, label: t.need.label, source: "suggested", locations: locsFor(t.job, t.need) };
    });
    if (!rows.length) return;
    const r = await createClient().from("production_slots").insert(rows);
    setMsg(r.error ? r.error.message : `Booked ${rows.length} job${rows.length === 1 ? "" : "s"}. Late ones stay in the list for you to place.`);
    load();
  }
  /** Start / pause / resume / progress / done on a booked job: updates it and writes the job log. */
  async function logAction(sl: Slot, action: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", progress?: number, reload = true) {
    const nowIso = new Date().toISOString(), p = progress ?? +(sl.progress || 0);
    const patch: Partial<Slot> & { updated_at: string } = { updated_at: nowIso };
    if (action === "start") Object.assign(patch, { status: "running", started_at: sl.started_at || nowIso, progress: p, progress_at: nowIso });
    if (action === "resume") Object.assign(patch, { status: "running", progress: p, progress_at: nowIso, started_at: sl.started_at || nowIso });
    if (action === "pause") Object.assign(patch, { status: "paused", progress: p, progress_at: nowIso });
    if (action === "progress") Object.assign(patch, { progress: p, progress_at: nowIso, ...(sl.status === "scheduled" && p > 0 ? { status: "running", started_at: sl.started_at || nowIso } : {}) });
    if (action === "done") Object.assign(patch, { status: "done", finished_at: nowIso, progress: 1, progress_at: nowIso });
    if (action === "not_started") Object.assign(patch, { status: "scheduled", started_at: null, finished_at: null, progress: 0, progress_at: null });
    if (action === "reopen") Object.assign(patch, { status: "running", finished_at: null, progress: Math.min(p, 0.9), progress_at: nowIso });
    const sb = createClient();
    await sb.from("production_slots").update(patch).eq("id", sl.id);
    await sb.from("production_slot_log").insert({ slot_id: sl.id, order_id: sl.order_id, machine: sl.machine, action, progress: patch.progress ?? p, by: me.name || me.email });
    if (reload) { setOpen(null); load(); }
  }
  async function setStatus(sl: Slot, status: Slot["status"]) { await logAction(sl, status === "done" ? "done" : status === "running" ? (sl.status === "paused" ? "resume" : "start") : status === "paused" ? "pause" : "not_started"); }
  /** Break a booking into one per print location (same press and day), so the backs can go to another day or press. */
  async function splitByLocation(c: Card) {
    if (!c.slot) return;
    const locs = locsOf(c.need); if (locs.length < 2) return;
    const sb = createClient(), mach = c.machine;
    const parts = locs.map((l) => subNeed(c.need, [l]));
    await sb.from("production_slots").update({ locations: [locs[0]], label: parts[0].label, minutes: estimate(s!, parts[0], mach).minutes, updated_at: new Date().toISOString() }).eq("id", c.slot.id);
    await sb.from("production_slots").insert(parts.slice(1).map((pn, i) => ({ order_id: c.slot!.order_id, archived_order_id: c.slot!.archived_order_id, machine: mach.id, day: c.day, minutes: estimate(s!, pn, mach).minutes, start_min: null, position: c.slot!.position + i + 1, kind: c.need.type, label: pn.label, source: "split", status: "scheduled", locations: [locs[i + 1]] })));
    setMsg(`#${c.job.number} split into ${locs.length}: ${parts.map((x) => x.label).join(" · ")}. Drag any of them to another day or press.`);
    setOpen(null); load();
  }
  async function unbook(sl: Slot) { await createClient().from("production_slots").delete().eq("id", sl.id); setOpen(null); load(); }

  if (!s || !jobs) return <div className="empty">Loading the schedule…</div>;

  /**
   * Re-plan: take every booked job that hasn't started (plus, if asked, the ones waiting in Ready To Schedule) and lay
   * them out again, soonest in-hands date first, each on the machine that can finish it earliest, using every hour
   * available: crew shifts, weekend/extra shifts, around downtime, slower where someone's out. Running and done work
   * stays put. Returns the moves so they can be looked at before anything changes.
   */
  const planIt = (allowSplit = false) => {
    const nowAbs = ord(today) * 1440 + now.min;
    const winsOf = (m: Machine, d: string) => { const sh = shiftOn(m, d); return sh ? windowsIn(sh, m.down?.[d]) : []; };
    const norm = (m: Machine, t: number) => { for (let g = 0; g < 120; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y); if (!w) { t = (dd + 1) * 1440; continue; } return mm < w[0] ? dd * 1440 + w[0] : t; } return t; };
    const sim = (m: Machine, t0: number, minutes: number) => {
      let t = norm(m, t0); const start = t; let left = minutes;
      for (let g = 0; g < 400 && left > 0.01; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y)!; if (!w) { t = norm(m, t); continue; } const end = Math.min(mm + left / w[2], w[1]); left -= (end - mm) * w[2]; t = left > 0.01 ? norm(m, dd * 1440 + end) : dd * 1440 + end; }
      return { start, end: t };
    };
    // not started yet (or paused partway): free to move. Running and done work stays where it is.
    const movable = cards.filter((c) => c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !c.fromPv && c.day >= today);
    const cursor: Record<string, number> = {};
    for (const m of machines) cursor[m.id] = nowAbs;
    for (const c of cards) if (!movable.includes(c)) for (const g of segs.ofCard.get(c.key) || []) if (g.day >= today) cursor[c.machine.id] = Math.max(cursor[c.machine.id] ?? nowAbs, ord(g.day) * 1440 + g.end);
    type Item = { key: string; job: Job; need: Need; slot: Slot | null; cur: string; curDay: string; left: number };
    const items: Item[] = [
      ...movable.map((c) => ({ key: c.key, job: c.job, need: c.need, slot: c.slot, cur: c.machine.id, curDay: c.day, left: 1 - Math.max(0, Math.min(1, +(c.slot?.progress || 0))) })),
      ...(replanTray ? tray.map((t) => ({ key: "t:" + t.job.key + t.need.type, job: t.job, need: t.need, slot: null, cur: "", curDay: "", left: 1 })) : []),
    ].sort((a, b) => (a.job.due || "9999").localeCompare(b.job.due || "9999") || (a.curDay || "9999").localeCompare(b.curDay || "9999"));
    const lateOld = new Set(tight.map((t) => t.job.key));
    type Out = { it: Item; mach: Machine; day: string; startAbs: number; end: string; minutes: number; late: boolean; locs: string[] | null; part: number; parts: number };
    const out: Out[] = [];
    const skipped: Item[] = [];
    const endDayOf = (t: number) => fromOrd(Math.floor((t - 1) / 1440));
    // the machine that finishes this work earliest, given where each machine's day is up to
    const bestFor = (need: Need, left: number, cur: Record<string, number>, prefer: string) => {
      let best: { m: Machine; start: number; end: number; minutes: number } | null = null;
      for (const m of s.machines.filter((x) => x.active && fits(need, x))) {
        const mm = machines.find((x) => x.id === m.id) || m; // the calendar's copy carries days off, downtime and extra shifts
        const minutes = Math.max(15, estimate(s, need, mm).minutes * left), r = sim(mm, cur[mm.id] ?? nowAbs, minutes);
        const better = !best || r.end < best.end - 30 || (Math.abs(r.end - best.end) <= 30 && (mm.id === prefer || (best.m.id !== prefer && (need.type === "screen" ? mm.colors < best.m.colors : false))));
        if (better) best = { m: mm, start: r.start, end: r.end, minutes };
      }
      return best;
    };
    let splits = 0;
    for (const it of items) {
      const best = bestFor(it.need, it.left, cursor, it.cur);
      if (!best) { skipped.push(it); continue; }
      const locs = locsOf(it.need);
      // won't make it in one piece: try the print locations separately (fronts on one press, backs on another / the next day)
      // only when allowed (the schedule is tight and someone said OK): splitting costs efficiency (shared screens, one setup)
      if (allowSplit && it.job.due && endDayOf(best.end) > it.job.due && locs.length > 1 && it.left >= 0.999) {
        const cur2 = { ...cursor }, parts: { need: Need; b: NonNullable<ReturnType<typeof bestFor>>; l: string }[] = [];
        // each extra run costs another setup: re-registering and ink changes, about 15 minutes
        for (const [i, l] of locs.entries()) { const sn = subNeed(it.need, [l]), b = bestFor(sn, 1, cur2, it.cur); if (!b) { parts.length = 0; break; } if (i > 0) { const r = sim(b.m, b.start, b.minutes + 15); b.end = r.end; b.minutes += 15; } cur2[b.m.id] = b.end; parts.push({ need: sn, b, l }); }
        const splitEnd = Math.max(...parts.map((p) => p.b.end));
        if (parts.length > 1 && splitEnd < best.end - 30) {
          Object.assign(cursor, cur2); splits++;
          parts.forEach((p, i) => out.push({ it, mach: p.b.m, day: fromOrd(Math.floor(p.b.start / 1440)), startAbs: p.b.start, end: endDayOf(p.b.end), minutes: p.b.minutes, late: !!it.job.due && endDayOf(splitEnd) > it.job.due, locs: [p.l], part: i + 1, parts: parts.length }));
          continue;
        }
      }
      cursor[best.m.id] = best.end;
      out.push({ it, mach: best.m, day: fromOrd(Math.floor(best.start / 1440)), startAbs: best.start, end: endDayOf(best.end), minutes: best.minutes, late: !!it.job.due && endDayOf(best.end) > it.job.due, locs: it.slot?.locations?.length ? it.slot.locations : locsFor(it.job, it.need), part: 1, parts: 1 });
    }
    const moves = out.filter((o) => !o.it.slot || o.parts > 1 || o.mach.id !== o.it.cur || o.day !== o.it.curDay);
    const lateJobs = new Set([...out.filter((o) => o.late).map((o) => o.it.job.key), ...skipped.map((x) => x.job.key)]);
    return { out, moves, skipped, splits, lateBefore: lateOld.size, lateAfter: lateJobs.size, added: out.filter((o) => !o.it.slot && o.part === 1).length };
  };
  async function applyPlan(p: ReturnType<typeof planIt>) {
    setReplanBusy(true);
    const sb = createClient();
    const pos: Record<string, number> = {};
    const sorted = [...p.out].sort((a, b) => a.startAbs - b.startAbs);
    const ups: Promise<unknown>[] = [], ins: Record<string, unknown>[] = [];
    for (const o of sorted) {
      const k = o.mach.id + o.day, position = (pos[k] = (pos[k] ?? -1) + 1);
      const lbl = o.parts > 1 ? subNeed(o.it.need, o.locs).label : o.it.need.label;
      if (o.it.slot && o.part === 1) ups.push(Promise.resolve(sb.from("production_slots").update({ machine: o.mach.id, day: o.day, minutes: o.minutes, start_min: null, position, rolled_from: null, label: lbl, locations: o.locs, updated_at: new Date().toISOString() }).eq("id", o.it.slot.id)));
      else ins.push({ order_id: o.it.job.kind === "o" ? o.it.job.id : null, archived_order_id: o.it.job.kind === "a" ? o.it.job.id : null, machine: o.mach.id, day: o.day, minutes: o.minutes, start_min: null, position, kind: o.it.need.type, label: lbl, source: "replan", status: "scheduled", locations: o.locs });
    }
    await Promise.all(ups);
    if (ins.length) await sb.from("production_slots").insert(ins);
    setReplanBusy(false); setReplan(null);
    setMsg(`Re-planned: ${p.moves.length} job${p.moves.length === 1 ? "" : "s"} moved${p.added ? ` (${p.added} booked from Ready To Schedule)` : ""}. Late: ${p.lateBefore} → ${p.lateAfter}.`);
    load();
  }
  // presses in number order (Press 1, 2, 3, 4); other machines keep their Settings order
  const machines = s.machines.filter((x) => x.active && (!typeF || x.type === typeF))
    .map((x, i) => ({ x, i })).sort((a, b) => a.x.type === "screen" && b.x.type === "screen" ? a.x.name.localeCompare(b.x.name, undefined, { numeric: true }) : a.i - b.i).map((o) => o.x);

  // weeks shown: this week and the next, with or without weekends
  const weekDays = (w: string) => Array.from({ length: 7 }, (_, i) => addDay(w, i));
  const allDays = [...weekDays(week), ...weekDays(addDay(week, 7))];
  const weekendUsed = machines.some((m) => !!m.week?.[0] || !!m.week?.[6] || Object.keys(m.extra || {}).some((d) => d >= addDay(today, -7) && (dow(d) === 0 || dow(d) === 6))) || allDays.some((d) => (dow(d) === 0 || dow(d) === 6) && machines.some((m) => at(m, d).length));
  const showWknd = wknd ?? weekendUsed;
  const visible = (d: string) => showWknd || (dow(d) !== 0 && dow(d) !== 6);

  // the clock window: 5 AM – 8 PM (every hour a machine could run), wider if a shift or job starts earlier / ends later
  const shifts = machines.flatMap((m) => (m.week || []).filter(Boolean) as [number, number][]);
  const vStart = Math.max(0, Math.floor(Math.min(300, ...shifts.map((x) => x[0]), ...[...segs.by.values()].flat().map((g) => g.start)) / 60) * 60);
  const vEnd = Math.min(1440, Math.ceil(Math.max(1200, ...shifts.map((x) => x[1]), ...[...segs.by.values()].flat().map((g) => g.end)) / 60) * 60);
  const range = vEnd - vStart;
  const hours = Array.from({ length: range / 60 }, (_, i) => vStart + i * 60);
  const pct = (min: number) => `${((min - vStart) / range) * 100}%`;

  const dragNeed = drag?.card?.need || drag?.need;
  const canDrop = (mach: Machine) => !dragNeed || fits(dragNeed, mach);
  function startDrag(e: DragEvent, d: Drag) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "job"); } catch { /* old browsers */ } setDrag(d); }
  function drop(mach: Machine, d: string, minuteAtPointer: number) {
    setOver("");
    if (!drag) return;
    const st = Math.max(0, Math.min(1440 - 15, snap(minuteAtPointer - drag.grabMin)));
    if (drag.card) book(drag.card.job, drag.card.need, mach, d, "manual", drag.card.slot, st);
    else if (drag.job && drag.need) book(drag.job, drag.need, mach, d, "manual", null, st);
    setDrag(null);
  }
  const cls = (g: Seg) => {
    const c = g.c, late = !!c.job.due && g.day > c.job.due;
    return "ms-blk " + c.need.type + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "") + (g.part > 1 ? " cont-l" : "") + (g.part < g.parts ? " cont-r" : "");
  };
  const tip = (g: Seg) => `#${g.c.job.number} ${g.c.job.customer}${g.c.job.owner ? ` (${g.c.job.owner})` : ""}\n${g.c.job.name}\n${dayLbl(g.day)} ${clockLong(g.start)} – ${clockLong(g.end)}${g.parts > 1 ? ` (part ${g.part} of ${g.parts}; ${fmtMin(g.c.minutes)} in all)` : ` (${fmtMin(g.c.minutes)})`}\n${g.c.need.label}${g.c.job.due ? `\nIn-hands ${dayLbl(g.c.job.due)}` : ""}${g.c.slot?.status === "done" ? "\nDone" : g.c.slot?.status === "running" ? "\nRunning" : ""}${g.c.fromPv ? "\nFrom its Printavo status" : ""}${g.c.carried ? `\nRolled forward from ${dayLbl(g.c.carried)}` : ""}${g.pushed ? "\nStarts later than asked (the job before runs long)" : ""}`;
  const offShade = (mach: Machine, d: string) => {
    const [a, b] = shiftOn(mach, d) || typicalShift(mach), works = !!shiftOn(mach, d) || at(mach, d).length > 0;
    return works ? [[vStart, a], [b, vEnd]].filter(([x, y]) => y > x) : [[vStart, vEnd]];
  };
  const crewOf = (m: Machine) => (m.crew ? s.crews.find((c) => c.id === m.crew) : undefined);
  const hrsTxt = (sh: [number, number]) => `${clock(sh[0])}–${clock(sh[1])}`;
  /** who runs it that day and when, or why it's off */
  const crewLine = (m: Machine, d: string) => { const sh = shiftOn(m, d), slow = (m.down?.[d] || []).filter((x) => x[3] > 0).sort((x, y) => x[3] - y[3])[0]; return isOffDay(m, d) ? `Off · ${m.off![d]}` : sh ? `${hrsTxt(sh)}${m.extra?.[d] ? " · extra" : ""}${slow ? ` · ${Math.round(slow[3] * 100)}%` : ""}` : "not running"; };
  const label = (g: Seg) => <><b>#{g.c.job.number}</b> {g.part > 1 ? <i className="ms-cont">cont.</i> : null}{g.c.job.customer || g.c.job.name}</>;

  /* ---------- Week view: machines down, days across; each day a 6a–6p timeline, one lane per job ---------- */
  const weekGrid = (w: string, title: string) => {
    const ds = weekDays(w).filter(visible);
    return (
      <section className="ms-wk" key={w}>
        <div className="ms-wk-h"><b>{title}</b><span className="faint">{dayLbl(ds[0])} – {dayLbl(ds[ds.length - 1])}</span></div>
        <div className="ms-wg" style={{ gridTemplateColumns: `128px repeat(${ds.length}, minmax(0,1fr))` }}>
          <div className="ms-wg-c" />
          {ds.map((d) => (
            <button type="button" key={d} className={"ms-wg-d" + (d === today ? " today" : d < today ? " past" : "")} onClick={() => { setDay(d); setView("day"); }} title="Open this day">
              <b>{dayShort(d)}{d === today ? <em> · Today</em> : null}</b>
              <span className="ms-ax">{hours.filter((h) => (h - vStart) % 180 === 0).map((h) => <i key={h} style={{ left: pct(h) }}>{clock(h)}</i>)}</span>
            </button>
          ))}
          {machines.map((m) => {
            const lanes = Math.max(1, ...ds.map((d) => at(m, d).length));
            const wkUsed = ds.reduce((a, d) => a + used(m, d), 0), wkCap = ds.reduce((a, d) => a + capacityMin(s, m, d), 0);
            return [
              <div key={m.id + w} className={"ms-wg-m " + m.type} title={`${m.name}: ${fmtMin(wkUsed)} of ${fmtMin(wkCap)} booked`}><b>{shortName(m)}{crewOf(m) ? <span className="ms-op"> · {crewOf(m)!.leader}</span> : null}</b><small>{m.type === "screen" ? `${m.colors}C` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat"} · <span className="ms-used">{Math.round(wkUsed / 60)}/{Math.round(wkCap / 60)}h</span></small>
                <div className={"ms-cap" + (wkUsed > wkCap ? " full" : wkUsed > wkCap * s.fillTarget ? " warn" : "")}><i style={{ width: `${Math.min(100, wkCap ? (wkUsed / wkCap) * 100 : 0)}%` }} /></div></div>,
              ...ds.map((d) => {
                const gs = at(m, d).slice().sort((a, b) => a.start - b.start);
                const u = used(m, d), cap = capacityMin(s, m, shiftOn(m, d) ? d : undefined);
                return (
                  <div key={m.id + d} className={"ms-wc" + (d === today ? " today" : d < today ? " past" : "") + (over === m.id + d ? (canDrop(m) ? " over" : " no") : "") + (u >= cap ? " full" : "")} style={{ minHeight: lanes * LANE + 10, backgroundSize: `${(180 / range) * 100}% 100%` }}
                    onDragOver={(e) => { e.preventDefault(); setOver(m.id + d); }} onDragLeave={() => setOver("")}
                    onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, d, vStart + ((e.clientX - r.left) / r.width) * range); }}>
                    {offShade(m, d).map(([a, b]) => <div key={a} className="ms-off h" style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />)}
                    {(m.down?.[d] || []).map(([a0, b0, why, rate]) => { const a = Math.max(a0, vStart), b = Math.min(b0, vEnd); return <div key={"dn" + a} className={"ms-down h" + (rate ? " slow" : "")} title={rate ? `${why}: ${Math.round(rate * 100)}%` : `Down ${clockLong(a)} – ${clockLong(b)}: ${why}`} style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />; })}
                    {d === today && now.min > vStart && <div className="ms-past" style={{ width: pct(Math.min(now.min, vEnd)) }} />}
                    {d === today && now.min >= vStart && now.min <= vEnd && <div className="ms-now v" style={{ left: pct(now.min) }} />}
                    {gs.map((g, i) => {
                      const right = (g.start - vStart) / range > 0.55;
                      return (
                        <div key={g.c.key + g.part} className="ms-lane" style={{ top: 5 + i * LANE }}>
                          <button type="button" draggable className={cls(g) + " bar"} title={tip(g)} style={{ left: pct(g.start), width: `calc(${((g.end - g.start) / range) * 100}% - 1px)` }}
                            onDragStart={(e) => { const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect(), pr = el.parentElement!.getBoundingClientRect(); startDrag(e, { card: g.c, grabMin: ((e.clientX - r.left) / pr.width) * range }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(g.c)} aria-label={tip(g)} />
                          <span className={"ms-lbl" + (right ? " r" : "")} style={right ? { right: `calc(${100 - ((g.start - vStart) / range) * 100}% + 3px)`, maxWidth: `calc(${((g.start - vStart) / range) * 100}% - 4px)` } : { left: `calc(${pct(g.start)} + 5px)`, maxWidth: `calc(${100 - ((g.start - vStart) / range) * 100}% - 8px)` }}>{label(g)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </section>
    );
  };

  /* ---------- Day view: machines across, the clock down ---------- */
  const dayGrid = (day: string, o: { title?: ReactNode; colMin?: number; hourPx?: number; win?: [number, number]; sub?: ReactNode } = {}) => {
    const HOUR_PX = o.hourPx ?? HOUR_PX0, colMin = o.colMin ?? 112, gut = o.colMin ? 42 : 52;
    // this grid's own clock window (the two-day view trims each day to its crews' hours ± 1 hour)
    const [vS, vE] = o.win ?? [vStart, vEnd], rng = vE - vS;
    const hrsL = Array.from({ length: Math.round(rng / 60) }, (_, i) => vS + i * 60);
    const shade = (m: Machine) => offShade(m, day).map(([x, y]) => [Math.max(x, vS), Math.min(y, vE)]).filter(([x, y]) => y > x);
    return (
    <div className={"ms-dv" + (o.sub ? " cont" : "")} key={"dv" + day}>
      {o.title ? <div className="ms-dv-t">{o.title}</div> : null}
      <div className="ms-dv-grid" style={{ gridTemplateColumns: `${gut}px repeat(${machines.length}, minmax(${colMin}px,1fr))`, minWidth: gut + machines.length * colMin }}>
        {o.sub ? <>
          <div className="ms-dv-bar" style={{ gridColumn: "1 / -1" }}>{o.sub}</div>
          <div className="ms-dv-sub0" />
          {machines.map((m) => { const u = used(m, day), cap = capacityMin(s, m, shiftOn(m, day) ? day : undefined); return (
            <div key={m.id} className={"ms-dv-sub " + m.type + (isOffDay(m, day) ? " off" : "")}>
              <button type="button" className={"ms-crew" + (isOffDay(m, day) ? " off" : "")} onClick={() => setDownEdit({ machine: m.id, day, allDay: true })} title={isOffDay(m, day) ? "Off this day: tap to change" : "Mark this press (or its crew) off"}>{crewLine(m, day)}</button>
              <small className="ms-used">{+(u / 60).toFixed(1)} / {+(cap / 60).toFixed(1)}h</small>
            </div>
          ); })}
        </> : <>
        <div className="ms-dv-corner" />
        {machines.map((m) => { const u = used(m, day), cap = capacityMin(s, m, shiftOn(m, day) ? day : undefined); return (
          <div key={m.id} className={"ms-dv-h " + m.type + (isOffDay(m, day) ? " off" : "")}><b>{shortName(m)}</b><small title={crewOf(m) ? `${crewOf(m)!.leader}'s crew` : undefined}>{crewOf(m) ? <b className="ms-lead">{crewOf(m)!.leader}</b> : m.type === "screen" ? `${m.colors} colors` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat press"}</small>
            <button type="button" className={"ms-crew" + (isOffDay(m, day) ? " off" : "")} onClick={() => setDownEdit({ machine: m.id, day, allDay: true })} title={isOffDay(m, day) ? "Off this day: tap to change" : "Mark this press (or its crew) off"}>{crewLine(m, day)}</button>
            <div className={"ms-cap" + (u > cap ? " full" : u > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(u)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (u / cap) * 100)}%` }} /></div>
            <small className="ms-used">{o.colMin ? `${+(u / 60).toFixed(1)} / ${+(cap / 60).toFixed(1)}h` : `${fmtMin(u)} / ${fmtMin(cap)}`}</small></div>
        ); })}</>}
        <div className="ms-dv-gut" style={{ height: (rng / 60) * HOUR_PX }}>{hrsL.map((h) => <span key={h} style={{ top: ((h - vS) / 60) * HOUR_PX }}>{clock(h)}</span>)}</div>
        {machines.map((m) => (
          <div key={m.id} className={"ms-dv-col" + (over === m.id + day ? (canDrop(m) ? " over" : " no") : "")} style={{ height: (rng / 60) * HOUR_PX, backgroundSize: `100% ${HOUR_PX}px` }}
            onDragOver={(e) => { e.preventDefault(); setOver(m.id + day); }} onDragLeave={() => setOver("")}
            onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, day, vS + ((e.clientY - r.top) / HOUR_PX) * 60); }}
            onClick={(e) => { if ((e.target as HTMLElement).closest(".ms-blk, .ms-down, .ms-slow button")) return; const r = e.currentTarget.getBoundingClientRect(); setDownEdit({ machine: m.id, day, start: Math.floor((vS + ((e.clientY - r.top) / HOUR_PX) * 60) / 30) * 30 }); }}
            title="Click an open time to add downtime here">
            {shade(m).map(([a, b]) => <div key={a} className="ms-off" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} />)}
            {(m.down?.[day] || []).map(([a0, b0, why, rate]) => { const [sa, sb] = shiftOn(m, day) || typicalShift(m), a = Math.max(a0, rate ? sa : a0, vS), b = Math.min(b0, rate ? sb : b0, vE); if (b <= a) return null; return rate
              ? <div key={"sl" + a} className="ms-slow" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }}><button type="button" onClick={() => setDownEdit({ machine: m.id, day })} title={`${why}: ${m.name} runs at ${Math.round(rate * 100)}% ${clockLong(a)} – ${clockLong(b)} (jobs take ${+(1 / rate).toFixed(1)}× as long)`}>{why} · {Math.round(rate * 100)}%</button></div>
              : <button type="button" key={"dn" + a} className="ms-down" style={{ top: ((a - vS) / 60) * HOUR_PX, height: Math.max(16, ((b - a) / 60) * HOUR_PX) }} title={`${m.name} down ${clockLong(a)} – ${clockLong(b)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day, start: a })}><b>Down</b> {clock(a)}–{clock(b)} · {why}</button>; })}
            {day === today && now.min >= vS && now.min <= vE && <div className="ms-now" style={{ top: ((now.min - vS) / 60) * HOUR_PX }} />}
            {at(m, day).map((g) => { const h = Math.max(22, ((g.end - g.start) / 60) * HOUR_PX - 2), gl = glance(g.c.need, g.c.minutes); return (
              <button key={g.c.key + g.part} type="button" draggable className={cls(g) + " card" + (h < 40 ? " tiny" : h < 60 ? " short" : "")} style={{ top: ((g.start - vS) / 60) * HOUR_PX + 1, height: h }} title={tip(g)}
                onDragStart={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); startDrag(e, { card: g.c, grabMin: ((e.clientY - r.top) / HOUR_PX) * 60 }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(g.c)}>
                <span className="ms-l1"><b>#{g.c.job.number}{g.c.slot?.status === "running" ? <em className="rn"> ●</em> : g.c.slot?.status === "done" ? <em className="ok"> ✓</em> : null}</b><span>{g.c.job.customer}</span></span>
                <span className="ms-l2">{g.c.job.name || g.c.need.label}</span>
                <span className="ms-l3"><i>{gl.colors}</i><i>{gl.units.toLocaleString()} pcs</i><i>{gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</i></span>
              </button>
            ); })}
          </div>
        ))}
      </div>
    </div>
    );
  };

  /* ---------- Phones: one day, each machine its jobs in time order with a small timeline ---------- */
  const phoneView = () => (
    <div className="ms-phone">
      <div className="ms-pnav"><button type="button" className="btn sm" onClick={() => setDay(addDay(day, -1))} aria-label="Previous day">←</button><b>{new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</b><button type="button" className="btn sm" onClick={() => setDay(addDay(day, 1))} aria-label="Next day">→</button></div>
      {machines.map((m) => { const gs = at(m, day).slice().sort((a, b) => a.start - b.start); const u = used(m, day), cap = capacityMin(s, m, shiftOn(m, day) ? day : undefined); return (
        <section key={m.id} className={"ms-pm " + m.type}>
          <div className="ms-pm-h"><b>{m.name}{crewOf(m) ? ` · ${crewOf(m)!.leader}` : ""}</b><span className="faint">{fmtMin(u)} / {fmtMin(cap)}</span></div>
          <div className="ms-pstrip">{offShade(m, day).map(([a, b]) => <div key={a} className="ms-off h" style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />)}{(m.down?.[day] || []).map(([a0, b0, , rate]) => { const a = Math.max(a0, vStart), b = Math.min(b0, vEnd); return <div key={"dn" + a} className={"ms-down h" + (rate ? " slow" : "")} style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />; })}{gs.map((g) => <i key={g.c.key + g.part} className={cls(g) + " bar"} style={{ left: pct(g.start), width: `${((g.end - g.start) / range) * 100}%` }} />)}{day === today && <div className="ms-now v" style={{ left: pct(Math.max(vStart, Math.min(vEnd, now.min))) }} />}</div>
          <div className="ms-ax ph">{hours.filter((h) => (h - vStart) % 180 === 0).map((h) => <i key={h} style={{ left: pct(h) }}>{clock(h)}</i>)}</div>
          {gs.length ? <ul className="ms-agenda">{gs.map((g) => (
            <li key={g.c.key + g.part}><button type="button" className={cls(g) + " row-blk"} onClick={() => setOpen(g.c)}>
              <span className="ms-t1">{clock(g.start)}–{clock(g.end)}</span><span className="ms-b1">{label(g)}</span><span className="ms-b3">{g.c.need.label}{g.parts > 1 ? ` · part ${g.part} of ${g.parts}` : ` · ${fmtMin(g.c.minutes)}`}</span>
            </button></li>
          ))}</ul> : <div className="faint" style={{ fontSize: 12.5 }}>Open all day</div>}
        </section>
      ); })}
    </div>
  );

  /* ---------- Week list (default): machines across, days down; each cell = that machine's jobs that day, in run order ---------- */
  async function place(c: { card?: Card; job?: Job; need?: Need }, mach: Machine, d: string, beforeKey?: string) {
    setOver(""); setDrag(null);
    const job = c.card?.job || c.job, need = c.card?.need || c.need;
    if (!s || !job || !need) return;
    if (!fits(need, mach)) { setMsg(`#${job.number} needs ${need.type === "screen" ? `${need.needColors} screens` : TYPE_LBL[need.type]}: ${mach.name} can't run it.`); return; }
    const sb = createClient();
    // the bookings already in that cell (first pieces only), in run order, without the one being moved
    const inCell = at(mach, d).filter((g) => g.part === 1 && g.c.slot && g.c.key !== c.card?.key).sort((x, y) => x.start - y.start).map((g) => g.c);
    let idx = beforeKey ? inCell.findIndex((x) => x.key === beforeKey) : -1;
    if (idx < 0) idx = inCell.length;
    let id = c.card?.slot?.id;
    const minutes = estimate(s, need, mach).minutes;
    if (id) {
      const r = await sb.from("production_slots").update({ machine: mach.id, day: d, minutes, start_min: null, position: idx, updated_at: new Date().toISOString() }).eq("id", id);
      if (r.error) { setMsg(r.error.message); return; }
    } else {
      const r = await sb.from("production_slots").insert({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, machine: mach.id, day: d, minutes, start_min: null, position: idx, kind: need.type, label: need.label, source: "manual", locations: locsFor(job, need) }).select("id").single();
      if (r.error) { setMsg(r.error.message); return; }
      id = (r.data as { id: string }).id;
    }
    // renumber the cell so the moved job sits where it was dropped (pinned times give way to the running order)
    await Promise.all(inCell.map((x, i) => sb.from("production_slots").update({ position: i < idx ? i : i + 1, start_min: null }).eq("id", x.slot!.id)));
    setMsg(`#${job.number} → ${mach.name}, ${dayLbl(d)} (${fmtMin(minutes)})`);
    load();
  }
  const listDays = [...weekDays(week).filter(visible), ...weekDays(addDay(week, 7)).filter(visible)];
  const groups = (["screen", "embroidery", "heat"] as const).map((t) => ({ t, ms: machines.filter((m) => m.type === t) })).filter((g) => g.ms.length);
  const chip = (g: Seg, d: string, two = false) => {
    const c = g.c, when = d >= today;
    return (
      <button key={c.key + g.part} type="button" draggable className={"ms-chip " + c.need.type + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (!!c.job.due && g.day > c.job.due ? " late" : "") + (g.part > 1 ? " cont" : "") + (mine && !isMe(c.job.owner, owners, me) ? " other" : "") + (two ? " two" : "")}
        title={tip(g)} onClick={() => setOpen(c)}
        onDragStart={(e) => startDrag(e, { card: c, grabMin: 0 })} onDragEnd={() => { setDrag(null); setOver(""); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver("k:" + c.key); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag && g.part === 1) place(drag, g.c.machine, d, c.key); else if (drag) place(drag, g.c.machine, d); }}>
        {over === "k:" + c.key && <i className="ms-ins" />}
        {two ? (() => { const gl = glance(c.need, c.minutes); return <>
          <span className="ms-l1"><b>#{c.job.number}{c.slot?.status === "done" ? <em className="ok"> ✓</em> : c.slot?.status === "running" ? <em className="rn"> ●</em> : null}</b><span>{c.job.customer}</span></span>
          <span className="ms-l2">{c.job.name || c.need.label}</span>
          <span className="ms-l3"><i>{gl.colors}</i><i>{gl.units.toLocaleString()} pcs</i><i>{gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</i></span>
        </>; })() : <>
        <b>{c.job.number}</b>{c.slot?.status === "done" ? <em className="ok">✓</em> : c.slot?.status === "running" ? <em className="rn">●</em> : null}
        <span className="ms-cn">{g.part > 1 ? <em>cont. </em> : null}{c.job.customer || c.job.name}</span>
        <small>{g.parts > 1 ? `${g.part}/${g.parts}` : when ? clock(g.start) : fmtMin(g.end - g.start)}</small></>}
      </button>
    );
  };
  const wkName = (d: string) => (monday(d) === monday(today) ? "This Week" : monday(d) === addDay(monday(today), 7) ? "Next Week" : monday(d) === addDay(monday(today), 14) ? "In Two Weeks" : "Week of");
  const listGrid = (days: string[] = listDays, o: { compact?: boolean } = {}) => {
    const past = o.compact ? [] : days.filter((d) => d < today), rest = o.compact ? days : days.filter((d) => d >= today);
    const rows = [...(showPast ? past : []), ...rest];
    const nextMon = addDay(week, 7);
    const colMin = o.compact ? 62 : 104, dayCol = o.compact ? 58 : 92;
    return (
      <div className={"ms-lw" + (o.compact ? " compact" : "")}>
        <div className="ms-lg" style={{ gridTemplateColumns: `${dayCol}px repeat(${machines.length}, minmax(${colMin}px,1fr))`, minWidth: dayCol + machines.length * colMin,
          // compact (next to the hour-by-hour days): day rows share any spare height so the list is as tall as the left side
          ...(o.compact ? { gridTemplateRows: ["auto", "auto", ...rows.flatMap((d, ri) => (ri === 0 || monday(d) !== monday(rows[ri - 1]) ? ["auto", "minmax(0,1fr)"] : ["minmax(0,1fr)"]))].join(" ") } : {}) }}>
          <div className="ms-lg-corner">{past.length > 0 && <button type="button" className="linkbtn" onClick={() => setShowPast(!showPast)}>{showPast ? "Hide" : "Show"} earlier this week</button>}</div>
          {groups.map((g) => <div key={g.t} className={"ms-lg-grp " + g.t} style={{ gridColumn: `span ${g.ms.length}` }}>{TYPE_LBL[g.t]}</div>)}
          <div className="ms-lg-corner2" />
          {groups.flatMap((g) => g.ms).map((m) => {
            const wkU = (o.compact ? rows : days.filter((d) => d >= week && d < nextMon)).reduce((a, d) => a + used(m, d), 0);
            if (o.compact) return <div key={m.id} className={"ms-lg-m " + m.type} title={`${m.name}${crewOf(m) ? ` · ${crewOf(m)!.leader}'s crew` : ""}: ${fmtMin(wkU)} booked in these days`}><b>{shortName(m)}</b><small>{crewOf(m) ? `${crewOf(m)!.leader} · ` : ""}{Math.round(wkU / 60)}h</small></div>;
            return <div key={m.id} className={"ms-lg-m " + m.type} title={m.name}><b>{shortName(m)}</b><small>{crewOf(m) ? `${crewOf(m)!.leader} · ` : m.type === "screen" ? `${m.colors} color · ` : m.type === "embroidery" ? `${m.heads} head · ` : "heat · "}{Math.round(wkU / 60)}h this wk</small></div>;
          })}
          {rows.map((d, ri) => {
            const isToday = d === today;
            const newWeek = o.compact ? ri === 0 || monday(d) !== monday(rows[ri - 1]) : d === nextMon || (ri > 0 && monday(d) !== monday(rows[ri - 1]));
            const dayUsed = machines.reduce((a, m) => a + used(m, d), 0);
            return [
              newWeek ? <div key={"wk" + d} className="ms-lg-wk" style={{ gridColumn: `1 / span ${machines.length + 1}` }}>{o.compact ? wkName(d) : d >= nextMon ? "Next Week" : "This Week"} · {dayLbl(monday(d))}</div> : null,
              <div key={"d" + d} className={"ms-lg-d" + (isToday ? " today" : d < today ? " past" : "")}><b>{isToday ? "Today" : new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}</b><span>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><small>{Math.round(dayUsed / 60)}h{o.compact ? "" : " booked"}</small></div>,
              ...groups.flatMap((g) => g.ms).map((m) => {
                const gs = at(m, d).slice().sort((x, y) => x.start - y.start);
                const u = used(m, d), works = !!shiftOn(m, d) || gs.length > 0, cap = capacityMin(s, m, works && !shiftOn(m, d) ? undefined : d);
                return (
                  <div key={m.id + d} className={"ms-lc" + (isToday ? " today" : d < today ? " past" : "") + (!works || isOffDay(m, d) ? " off" : "") + (over === m.id + d ? (canDrop(m) ? " over" : " no") : "")}
                    onDragOver={(e) => { e.preventDefault(); setOver(m.id + d); }} onDragLeave={() => setOver((o) => (o === m.id + d ? "" : o))} onDrop={(e) => { e.preventDefault(); if (drag) place(drag, m, d); }}>
                    {works && <div className={"ms-lc-cap" + (u > cap ? " full" : u > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(u)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (u / cap) * 100)}%` }} /><span>{u ? `${(u / 60).toFixed(u % 60 ? 1 : 0)}/${Math.round(cap / 60)}h` : ""}</span></div>}
                    {(m.down?.[d] || []).map(([a, b, why, rate]) => <button type="button" key={"dn" + a} className={"ms-lc-dn" + (rate ? " slow" : "")} title={rate ? `${why}: runs at ${Math.round(rate * 100)}%${a > 0 || b < 1440 ? ` ${clockLong(a)} – ${clockLong(b)}` : ""}` : `Down ${clockLong(a)} – ${clockLong(b)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day: d, start: rate ? undefined : a })}>{rate ? `${why} · ${Math.round(rate * 100)}%` : `Down ${clock(a)}–${clock(b)}`}</button>)}
                    {gs.map((g) => chip(g, d, o.compact))}
                    {isOffDay(m, d) ? <button type="button" className="ms-lc-off x" onClick={() => setDownEdit({ machine: m.id, day: d, allDay: true })} title="Tap to change">Off · {m.off![d]}</button> : !works && !gs.length ? <span className="ms-lc-off">off</span> : null}
                    {works && d >= today && <button type="button" className="ms-lc-mk" onClick={() => setDownEdit({ machine: m.id, day: d, allDay: true })} title={`Mark ${m.name}${crewOf(m) ? ` / ${crewOf(m)!.leader}'s crew` : ""} off this day`}>off?</button>}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>
    );
  };

  /* ---------- Split (default): the next two days hour by hour on the left, the rest of the next two weeks on the right ---------- */
  const nextVis = (d: string, step = 1) => { let x = d; for (let i = 0; i < 7 && !visible(x); i++) x = addDay(x, step); return x; };
  const d0 = nextVis(day), d1 = nextVis(addDay(d0, 1));
  // the five working days after the two hour-by-hour days
  const restDays = Array.from({ length: 21 }, (_, i) => addDay(d1, i + 1)).filter(visible).slice(0, 5);
  const dayTitle = (d: string) => { const u = machines.reduce((a, m) => a + used(m, d), 0); return <><b>{d === today ? "Today" : d === addDay(today, 1) ? "Tomorrow" : new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}</b><span>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: d === today || d === addDay(today, 1) ? "short" : undefined, month: "short", day: "numeric" })}</span><small>{fmtMin(u)} booked</small></>; };
  // a day's clock: an hour before the first crew starts to an hour after the last one leaves (and any work outside that)
  const dayWin = (d: string): [number, number] => {
    const sh = machines.map((m) => shiftOn(m, d)).filter(Boolean) as [number, number][];
    const gs = machines.flatMap((m) => at(m, d));
    const a0 = Math.min(...(sh.length ? sh.map((x) => x[0]) : [420]), ...gs.map((g) => g.start)), b0 = Math.max(...(sh.length ? sh.map((x) => x[1]) : [1080]), ...gs.map((g) => g.end));
    return [Math.max(0, Math.floor((a0 - 60) / 60) * 60), Math.min(1440, Math.ceil((b0 + 60) / 60) * 60)];
  };
  const split = () => (
    <div className="ms-split">
      <div className="ms-split-col">
        <div className="ms-split-h">Next two days · hour by hour</div>
        <div className="ms-2d">
          {dayGrid(d0, { title: dayTitle(d0), colMin: 70, hourPx: 40, win: dayWin(d0) })}
          {dayGrid(d1, { sub: dayTitle(d1), colMin: 70, hourPx: 40, win: dayWin(d1) })}
        </div>
      </div>
      <div className="ms-split-col r">
        <div className="ms-split-h">Next five days</div>
        <div className="ms-split-fill">{listGrid(restDays, { compact: true })}</div>
      </div>
    </div>
  );
  const shift = (dir: 1 | -1) => (view === "timeline" ? setWeek(addDay(week, 7 * dir)) : setDay(nextVis(addDay(view === "split" ? d0 : day, dir), dir)));

  return (
    <div className="ms">
      <div className="ms-top">
        <h2 className="ms-title">Production Calendar</h2>
        <span className="spacer" />
        <Link className="linkbtn" href="/shop/settings/production">Machines, crews &amp; times</Link>
        <button type="button" className="btn ms-dn-btn" onClick={() => setCheckin(true)}>Update Progress</button>
        <button type="button" className="btn ms-dn-btn" onClick={() => setReplan({ why: "" })}>Re-plan Schedule</button>
        <button type="button" className="btn ms-dn-btn" onClick={() => setShiftEdit(true)}>+ Add Weekend Shift</button>
        <button type="button" className="btn primary ms-dn-btn" onClick={() => setDownEdit({})}>+ Add Downtime / Maintenance</button>
      </div>
      <div className="ms-bar">
        <div className="rv-seg">{([["", "All"], ["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const).map(([k, l]) => <button key={k} type="button" className={typeF === k ? "on" : ""} onClick={() => setTypeF(k)}>{l}</button>)}</div>
        <div className="rv-seg ms-who" role="group" aria-label="Whose jobs">{([[false, "Everyone"], [true, "My accounts"]] as const).map(([k, l]) => <button key={l} type="button" className={mine === k ? "on" : ""} onClick={() => setMine(k)}>{l}</button>)}</div>
        <span className="spacer" />
        <label className="ms-wknd"><input type="checkbox" checked={showWknd} onChange={(e) => setWknd(e.target.checked)} /> Weekends</label>
        <div className="rv-seg ms-span">{([["split", "2 Days + Next 5"], ["timeline", "Timeline"], ["day", "Day"]] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
        <button type="button" className="btn sm" onClick={() => shift(-1)} aria-label="Earlier">←</button>
        <button type="button" className="btn sm" onClick={() => { setWeek(monday(today)); setDay(today); }}>{view === "timeline" ? "This Week" : "Today"}</button>
        <button type="button" className="btn sm" onClick={() => shift(1)} aria-label="Later">→</button>
      </div>
      {msg && <div className="banner" style={{ marginBottom: 8 }} onClick={() => setMsg("")}>{msg}</div>}
      {tight.length > 0 && <div className="ms-tight"><b>Schedule too tight:</b> {tight.length} job{tight.length === 1 ? " can't" : "s can't"} fit before {tight.length === 1 ? "its" : "their"} in-hands date.<span className="spacer" /><button type="button" className="btn sm" onClick={() => setReplan({ why: "" })}>Re-plan Schedule</button><button type="button" className="btn sm primary" onClick={() => setShiftEdit(true)}>Add Weekend Shift</button></div>}
      {tight.length > 0 && tightSeen !== `${today}:${tight.length}` && !shiftEdit && (
        <div className="pp-modal" onClick={() => setTightSeen(`${today}:${tight.length}`)}>
          <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Schedule too tight">
            <div className="pp-sheet-h"><b>Schedule too tight, can&apos;t fit</b><button type="button" className="btn icon ghost" onClick={() => setTightSeen(`${today}:${tight.length}`)} aria-label="Close">✕</button></div>
            <div className="tmx-ed-b">
              <div>{tight.length} job{tight.length === 1 ? "" : "s"} won&apos;t make {tight.length === 1 ? "its" : "their"} in-hands date on the regular schedule:</div>
              <ul className="ms-offs">{tight.slice(0, 8).map((t) => <li key={t.job.key}><span>#{t.job.number}</span><span className="faint">{t.job.customer || t.job.name} · {t.why}</span><span /></li>)}</ul>
              {tight.length > 8 && <div className="faint">and {tight.length - 8} more</div>}
              <b>Add a weekend shift, or split jobs up (fronts and backs as separate runs) where that helps?</b>
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setTightSeen(`${today}:${tight.length}`)}>Not Now</button>
                <button type="button" className="btn" onClick={() => { setTightSeen(`${today}:${tight.length}`); setReplan({ why: "OK to split jobs (fronts and backs as separate runs) where that makes an in-hands date?", split: true }); }}>Split Jobs As Needed</button>
                <button type="button" className="btn primary" onClick={() => { setTightSeen(`${today}:${tight.length}`); setShiftEdit(true); }}>Yes, Add Weekend Shift</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className={"ms-band" + (trayOpen ? "" : " closed")}>
        <div className="ms-band-h">
          <button type="button" className="ms-band-t" onClick={() => setTrayOpen(!trayOpen)} aria-expanded={trayOpen}><span className="car">{trayOpen ? "▾" : "▸"}</span><b>Ready To Schedule</b><span className="aa-n">{tray.length}</span></button>
          <span className="faint ms-band-sub">{tray.filter((t) => t.sug?.late).length ? <span className="ms-late">{tray.filter((t) => t.sug?.late).length} tight or late · </span> : null}{coming.length ? `${coming.length} more coming (art, blanks) · ` : ""}drag one onto a machine and day, or accept the suggestion</span>
          <span className="spacer" />
          {trayOpen && tray.some((t) => t.sug && !t.sug.late) && <button type="button" className="btn sm primary" onClick={acceptAll}>Accept All Suggestions</button>}
        </div>
        {trayOpen && (!tray.length ? <div className="db-empty">Nothing waiting. Jobs land here when they go to In Production (goods here, art approved).</div> : (
          <>
            <ul className="ms-band-l">{(trayAll ? tray : tray.slice(0, 12)).map((t) => (
              <li key={t.job.key + t.need.type} draggable onDragStart={(e) => startDrag(e, { job: t.job, need: t.need, grabMin: 0 })} onDragEnd={() => setDrag(null)} className={"ms-r " + t.need.type + (t.sug?.late ? " late" : "")} title={`${t.job.name}\n${t.need.label} · ${t.need.qty} pcs${t.job.owner ? `\nAccount: ${t.job.owner}` : ""}${t.sug ? `\n${t.sug.reason}` : ""}`}>
                <Link className="ms-r-n" href={t.job.href}>#{t.job.number}</Link>
                <span className="ms-r-c"><b>{t.job.customer || t.job.name}</b><small>{t.need.label} · {t.need.qty} pcs</small></span>
                {t.job.owner ? <span className="ms-own" title={t.job.owner}>{initials(t.job.owner)}</span> : <span />}
                <span className={"ms-r-d" + (t.sug?.late ? " late" : "")}>{t.job.due ? dayShort(t.job.due) : "—"}</span>
                {t.sug ? <button type="button" className="btn sm primary ms-r-b" onClick={() => book(t.job, t.need, t.sug!.machine, t.sug!.day, "suggested")}>{shortName(t.sug.machine)} {t.sug.day === today ? "today" : dayLbl(t.sug.day).split(",")[0]}</button> : <span className="ms-late ms-r-b">no machine</span>}
              </li>
            ))}</ul>
            {tray.length > 12 && <button type="button" className="btn sm ms-band-more" onClick={() => setTrayAll(!trayAll)}>{trayAll ? "Show fewer" : `Show all ${tray.length}`}</button>}
          </>
        ))}
      </section>

      <div className="ms-main">
        {view === "split" ? split() : view === "timeline" ? <div className="ms-weeks">{weekGrid(week, week === monday(today) ? "This Week" : week === addDay(monday(today), -7) ? "Last Week" : "Week of")}{weekGrid(addDay(week, 7), addDay(week, 7) === addDay(monday(today), 7) ? "Next Week" : addDay(week, 7) === monday(today) ? "This Week" : "Week of")}</div> : dayGrid(day)}
        {phoneView()}
        <div className="ms-key faint"><span><i className="k screen" />Screen print</span><span><i className="k embroidery" />Embroidery</span><span><i className="k heat" />Heat press</span><span><i className="k run" />Running</span><span><i className="k done" />Done</span><span><i className="k late" />Past in-hands</span></div>
      </div>

      {shiftEdit && <ShiftPanel machines={machines} crews={s.crews} extras={extras} today={today} me={me.email} onClose={() => setShiftEdit(false)} onSaved={(m) => { setShiftEdit(false); setWknd(true); setMsg(m); load(); setReplan({ why: "Weekend shift added. Re-plan so earlier jobs can move into it and make room during the week?" }); }} />}
      {checkin && <CheckIn rows={cards.filter((c) => c.slot && !c.fromPv && (c.day === today || c.slot.status === "running" || c.slot.status === "paused")).map((c) => ({ c, first: (segs.ofCard.get(c.key) || []).filter((g) => g.day === today)[0] })).sort((a, b) => a.c.machine.id.localeCompare(b.c.machine.id) || (a.first?.start ?? 9999) - (b.first?.start ?? 9999))}
        machines={machines} crews={s.crews} now={now.min} onClose={() => setCheckin(false)}
        onSave={async (changes) => { for (const ch of changes) await logAction(ch.slot, ch.action, ch.progress, false); setCheckin(false); load(); setReplan({ why: changes.length ? `Progress saved (${changes.length} update${changes.length === 1 ? "" : "s"}). Anything not started now runs from ${clockLong(now.min)} on. Re-plan the rest of the week around it?` : `Anything not started runs from ${clockLong(now.min)} on. Re-plan the rest of the week around it?` }); }} />}
      {replan && (() => {
        const whole = planIt(false), splitP = whole.lateAfter > 0 ? planIt(true) : null;
        const splitHelps = !!splitP && splitP.splits > 0 && splitP.lateAfter < whole.lateAfter;
        const p = replan.split && splitHelps ? splitP! : whole;
        return (
        <div className="pp-modal" onClick={() => setReplan(null)}>
          <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Re-plan schedule">
            <div className="pp-sheet-h"><b>Re-plan Schedule</b><button type="button" className="btn icon ghost" onClick={() => setReplan(null)} aria-label="Close">✕</button></div>
            <div className="tmx-ed-b">
              {replan.why && <div><b>{replan.why}</b></div>}
              <div className="faint" style={{ fontSize: 12.5 }}>Every booked job that hasn&apos;t started gets laid out again: soonest in-hands date first, each on the press that can finish it earliest, using every shift (weekend shifts too), around downtime. Running and done jobs stay put.</div>
              <label className="check"><input type="checkbox" checked={replanTray} onChange={(e) => setReplanTray(e.target.checked)} /> Also book the {tray.length} job{tray.length === 1 ? "" : "s"} waiting in Ready To Schedule</label>
              <div className="ms-rp-sum"><span><b>{p.moves.length}</b> move{p.moves.length === 1 ? "" : "s"}{p.added ? ` (${p.added} newly booked)` : ""}</span>{p.splits ? <span><b>{p.splits}</b> split by print location</span> : null}<span className={p.lateAfter < p.lateBefore ? "good" : p.lateAfter > p.lateBefore ? "bad" : ""}>Late: <b>{p.lateBefore}</b> → <b>{p.lateAfter}</b></span></div>
              {!p.moves.length && <div className="ms-ask ok">Nothing needs to move to another press or day. Everything not started already runs from {clockLong(now.min)} on, in in-hands order.</div>}
              {p.moves.length > 0 && <ul className="ms-offs">{p.moves.slice(0, 40).map((o) => <li key={o.it.key + o.part}><span>#{o.it.job.number}{o.parts > 1 ? <small className="faint"> · {o.locs?.join(", ")}</small> : null}{o.it.job.due ? <small className="faint"> · due {dayShort(o.it.job.due)}</small> : null}</span><span className="faint">{o.it.slot ? `${shortName(s.machines.find((x) => x.id === o.it.cur) || o.mach)} ${dayShort(o.it.curDay)}` : "Ready To Schedule"} → <b className={o.late ? "ms-late" : ""}>{shortName(o.mach)} {dayShort(o.day)}{o.end !== o.day ? `–${dayShort(o.end)}` : ""}</b></span><span /></li>)}</ul>}
              {p.moves.length > 40 && <div className="faint">and {p.moves.length - 40} more</div>}
              {splitHelps && !replan.split && <div className="ms-ask"><b>The schedule is tight. OK to split jobs up as needed?</b><span>Printing the fronts and backs of {splitP!.splits} job{splitP!.splits === 1 ? "" : "s"} as separate runs (another day or press) brings late jobs from {whole.lateAfter} to {splitP!.lateAfter}. Separate runs lose some efficiency: extra setup, screens not shared.</span><div className="row" style={{ gap: 8 }}><button type="button" className="btn sm primary" onClick={() => setReplan({ ...replan, split: true })}>Yes, Split As Needed</button><button type="button" className="btn sm" onClick={() => setShiftEdit(true)}>Add a Weekend Shift Instead</button></div></div>}
              {replan.split && splitHelps && <div className="ms-ask ok">Splitting allowed: {splitP!.splits} job{splitP!.splits === 1 ? "" : "s"} run fronts and backs separately. <button type="button" className="linkbtn" onClick={() => setReplan({ ...replan, split: false })}>Keep jobs whole</button></div>}
              {p.lateAfter > 0 && <div className="faint" style={{ fontSize: 12.5 }}>{p.lateAfter} still won&apos;t make {p.lateAfter === 1 ? "its" : "their"} in-hands date. Another weekend shift or overtime would help.</div>}
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setReplan(null)}>Keep As Is</button>
                <button type="button" className="btn primary" disabled={replanBusy || !p.moves.length} onClick={() => applyPlan(p)}>{replanBusy ? "Moving…" : `Move ${p.moves.length} Job${p.moves.length === 1 ? "" : "s"}`}</button>
              </div>
            </div>
          </div>
        </div>
      ); })()}
      {downEdit && <DownPanel machines={machines} crews={s.crews} init={downEdit} offs={offs} today={today} win={[vStart, vEnd]} me={me.email} onClose={() => setDownEdit(null)} onSaved={(m) => { setDownEdit(null); setMsg(m); load(); }} />}
      {open && <CardPanel s={s} c={open} segs={segs.ofCard.get(open.key) || []} days={[...new Set([...allDays, d0, d1, ...restDays])].filter(visible).sort()} win={[vStart, vEnd]} onClose={() => setOpen(null)} onMove={(mach, d, st) => { book(open.job, open.need, mach, d, "manual", open.slot, st); setOpen(null); }} onStatus={setStatus} onUnbook={unbook} onLog={(a, p) => open.slot && logAction(open.slot, a, p)} onSplit={() => splitByLocation(open)} />}
    </div>
  );
}

/** A job on the calendar: when it runs (every day it spans), the time breakdown, move it, mark it running or done, or take it off. */
function CardPanel({ s, c, segs, days, win, onClose, onMove, onStatus, onUnbook, onLog, onSplit }: { s: ProductionSettings; c: Card; segs: Seg[]; days: string[]; win: [number, number]; onClose: () => void; onMove: (m: Machine, d: string, startMin: number | null) => void; onStatus: (sl: Slot, st: Slot["status"]) => void; onUnbook: (sl: Slot) => void; onLog: (a: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", p?: number) => void; onSplit: () => void }) {
  const [log, setLog] = useState<{ id: string; action: string; progress: number | null; note: string; at: string; by: string }[]>([]);
  const [prog, setProg] = useState(Math.round(+(c.slot?.progress || 0) * 10) * 10);
  useEffect(() => { if (c.slot) createClient().from("production_slot_log").select("id, action, progress, note, at, by").eq("slot_id", c.slot.id).order("at", { ascending: false }).limit(30).then(({ data }) => setLog((data || []) as typeof log)); }, [c.slot]);
  const sl = c.slot, stt = sl?.status || "scheduled";
  const ACT: Record<string, string> = { start: "Started", pause: "Paused", resume: "Resumed", progress: "Progress", done: "Finished", not_started: "Marked not started", reopen: "Reopened" };
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
  const [mach, setMach] = useState(c.machine.id), [day, setDay] = useState(c.day);
  const [st, setSt] = useState<string>(c.startMin != null ? String(c.startMin) : "auto");
  const m = s.machines.find((x) => x.id === mach) || c.machine;
  const est = estimate(s, c.need, m);
  const options = s.machines.filter((x) => x.active && x.type === c.need.type);
  const times: number[] = []; for (let t = Math.min(win[0], (shiftOn(m, day) || typicalShift(m))[0]); t < win[1]; t += 15) times.push(t);
  const newStart = st === "auto" ? null : +st;
  const same = mach === c.machine.id && day === c.day && newStart === c.startMin && !c.fromPv;
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled job">
        <div className="pp-sheet-h"><b>#{c.job.number} {c.job.customer}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint">{c.job.name}{c.job.due ? ` · in-hands ${dayLbl(c.job.due)}` : ""} · {c.job.status}</div>
          <div className="ms-when"><b>{c.machine.name}</b>{segs.length > 1 ? <span className="faint"> · {fmtMin(c.minutes)} over {segs.length} days</span> : null}
            <ul>{segs.map((g) => <li key={g.part}>{dayLbl(g.day)}, {clockLong(g.start)} – {clockLong(g.end)}</li>)}</ul>
            {c.fromPv ? <span className="faint">From its Printavo schedule{c.carried ? ` (was ${dayLbl(c.carried)}, still in the machine status)` : ""}.</span> : c.carried ? <span className="faint">Rolled forward from {dayLbl(c.carried)} (not marked Done).</span> : null}
          </div>
          <div><b>{TYPE_LBL[c.need.type]}:</b> {c.need.label} · {c.need.qty} pcs{c.need.steps.some((x) => x.note) ? <span className="faint"> ({c.need.steps.find((x) => x.note)?.note})</span> : null}</div>
          <ul className="ms-parts">{est.parts.map((p, i) => <li key={i}><span>{p.label}</span><b>{fmtMin(p.minutes)}</b></li>)}<li className="tot"><span>Setup {fmtMin(est.setup)} · run {fmtMin(est.run)}{est.teardown ? ` · teardown ${fmtMin(est.teardown)}` : ""}</span><b>{fmtMin(est.minutes)}</b></li></ul>
          {c.fromPv && c.minutes !== est.minutes && <div className="faint" style={{ fontSize: 12.5 }}>Printavo has it blocked for {fmtMin(c.minutes)}; our estimate is {fmtMin(est.minutes)}. Booking it here uses our estimate.</div>}
          {sl && <div className="ms-job">
            <div className="ms-job-h"><span className={"ms-st " + stt}>{stt === "scheduled" ? "Not started" : stt === "running" ? "Running" : stt === "paused" ? "Paused" : "Done"}</span>
              <span className="faint">{sl.started_at ? `Started ${when(sl.started_at)}` : ""}{sl.finished_at ? ` · Finished ${when(sl.finished_at)}` : ""}{(stt === "running" || stt === "paused") && +(sl.progress || 0) > 0 ? ` · ${Math.round(+(sl.progress || 0) * 100)}% done` : ""}</span></div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {stt === "scheduled" && <button type="button" className="btn sm primary" onClick={() => onLog("start")}>Start</button>}
              {stt === "running" && <button type="button" className="btn sm" onClick={() => onLog("pause", prog / 100)}>Pause / Stop</button>}
              {stt === "paused" && <button type="button" className="btn sm primary" onClick={() => onLog("resume", prog / 100)}>Resume</button>}
              {stt !== "done" && <button type="button" className="btn sm" onClick={() => onLog("done")}>Finished</button>}
              {stt === "done" && <button type="button" className="btn sm" onClick={() => onLog("reopen", 0.9)}>Reopen</button>}
              {stt !== "scheduled" && stt !== "done" && <button type="button" className="btn sm ghost" onClick={() => onLog("not_started")}>Not Started</button>}
              {stt !== "done" && <label className="ms-inl">Done so far <select value={prog} onChange={(e) => setProg(+e.target.value)}>{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => <option key={p} value={p}>{p}%</option>)}</select><button type="button" className="btn sm" onClick={() => onLog("progress", prog / 100)}>Save</button></label>}
            </div>
            {log.length > 0 && <ul className="ms-log">{log.map((x) => <li key={x.id}><span>{when(x.at)}</span><span>{ACT[x.action] || x.action}{x.progress != null && x.action !== "done" && x.action !== "not_started" ? ` · ${Math.round(+x.progress * 100)}%` : ""}{x.note ? ` · ${x.note}` : ""}</span><span className="faint">{x.by}</span></li>)}</ul>}
          </div>}
          <div className="tmx-2 ms-3">
            <label>Machine<select value={mach} onChange={(e) => setMach(e.target.value)}>{options.map((x) => <option key={x.id} value={x.id} disabled={!fits(c.need, x)}>{x.name}{!fits(c.need, x) ? " (not enough colors)" : ""}</option>)}</select></label>
            <label>Day<select value={day} onChange={(e) => setDay(e.target.value)}>{[...new Set([c.day, ...days])].sort().map((d) => <option key={d} value={d}>{dayLbl(d)}</option>)}</select></label>
            <label>Start<select value={st} onChange={(e) => setSt(e.target.value)}><option value="auto">After the job before it</option>{times.map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link className="btn" href={c.job.href}>Open Job</Link>
            {c.slot && locsOf(c.need).length > 1 && stt !== "done" && <button type="button" className="btn" onClick={onSplit} title="One booking per print location, so the backs can go to another day or press">Split By Location</button>}
            {c.slot && <button type="button" className="btn danger" onClick={() => onUnbook(c.slot!)}>Take Off Schedule</button>}
            <button type="button" className="btn primary" disabled={same} onClick={() => onMove(m, day, newStart)}>{c.fromPv ? "Book Here" : "Move"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Downtime / maintenance / someone out, on one machine (or a crew's presses): one day or a stretch of days (vacation),
 * all day or a time window, and how much it still runs: stopped, or at 25–75% (operator out: the press keeps running,
 * jobs just take longer). The calendar blocks or slows that time and moves work around it.
 */
function DownPanel({ machines, crews, init, offs, today, win, me, onClose, onSaved }: { machines: Machine[]; crews: Crew[]; init: { machine?: string; day?: string; start?: number; allDay?: boolean }; offs: DayOff[]; today: string; win: [number, number]; me: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [mach, setMach] = useState(init.machine || machines[0]?.id || "");
  const m = machines.find((x) => x.id === mach);
  const crew0 = m?.crew ? crews.find((c) => c.id === m.crew) : undefined;
  const [reason, setReason] = useState(init.allDay && crew0 ? "Employee out" : "Maintenance");
  const [other, setOther] = useState("");
  const [emp, setEmp] = useState(crew0?.leader || "");
  const [from, setFrom] = useState(init.day || today), [to, setTo] = useState(init.day || today);
  const [allDay, setAllDay] = useState(!!init.allDay || init.start == null);
  const start0 = init.start ?? 720;
  const [a, setA] = useState(start0), [b, setB] = useState(Math.min(win[1], start0 + 60));
  const [cap, setCap] = useState(init.allDay && crew0 ? 50 : 0);
  const [wholeCrew, setWholeCrew] = useState(true);
  const [busy, setBusy] = useState(false);
  const empOut = reason === "Employee out";
  const leadCrew = empOut ? crews.find((c) => c.leader && c.leader.toLowerCase() === emp.trim().toLowerCase()) : undefined;
  const times: number[] = []; for (let t = win[0]; t <= win[1]; t += 15) times.push(t);
  const existing = offs.filter((x) => (x.machine === mach || (m?.crew && x.crew_id === m.crew)) && x.day >= today).sort((x, y) => x.day.localeCompare(y.day) || (x.start_min ?? -1) - (y.start_min ?? -1));
  const pickReason = (r: string) => { setReason(r); if (r === "Employee out") { setCap(50); if (!emp && crew0) setEmp(crew0.leader); } else if (cap === 50 && reason === "Employee out") setCap(0); };
  const pickEmp = (name: string) => { setEmp(name); const c = crews.find((k) => k.leader.toLowerCase() === name.trim().toLowerCase()); const press = c && machines.find((x) => x.crew === c.id); if (press) setMach(press.id); };
  const nDays = Math.max(0, Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000) + 1);
  const ok = !!m && nDays >= 1 && nDays <= 120 && (allDay || b > a) && (!empOut || emp.trim()) && (reason !== "Other" || other.trim());
  async function save() {
    if (!ok || !m) return;
    setBusy(true);
    const note = reason === "Other" ? other.trim() : reason;
    const crewWide = empOut && !!leadCrew && wholeCrew;
    const rows = Array.from({ length: nDays }, (_, i) => addDay(from, i)).map((d) => ({ machine: crewWide ? null : mach, crew_id: crewWide ? leadCrew!.id : null, day: d, start_min: allDay ? null : a, end_min: allDay ? null : b, capacity: cap, employee: empOut ? emp.trim() : "", note, created_by: me }));
    const r = await createClient().from("production_days_off").insert(rows);
    setBusy(false);
    const when = `${from === to ? dayLbl(from) : `${dayLbl(from)} – ${dayLbl(to)}`}${allDay ? "" : `, ${clockLong(a)} – ${clockLong(b)}`}`;
    onSaved(r.error ? r.error.message : `${empOut ? `${emp.trim()} out` : note}: ${crewWide ? `${leadCrew!.leader}'s press${machines.filter((x) => x.crew === leadCrew!.id).length > 1 ? "es" : ""}` : m.name} ${cap ? `runs at ${cap}%` : "is stopped"} ${when}. The schedule moves around it.`);
  }
  async function remove(id: string) { setBusy(true); await createClient().from("production_days_off").delete().eq("id", id); setBusy(false); onSaved("Removed. That time is back on the schedule."); }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add downtime or maintenance">
        <div className="pp-sheet-h"><b>Add Downtime / Maintenance</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="tmx-2 ms-3">
            <label>Why<select value={reason} onChange={(e) => pickReason(e.target.value)}>{["Maintenance", "Repair", "Cleaning", "Employee out", "Training", "Meeting", "Press closed", "Holiday", "Other"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            {empOut
              ? <label>Employee<input type="text" list="dn-emp" value={emp} placeholder="Who's out" onChange={(e) => pickEmp(e.target.value)} /><datalist id="dn-emp">{crews.filter((c) => c.leader).map((c) => <option key={c.id} value={c.leader} />)}</datalist></label>
              : reason === "Other" ? <label>Reason<input type="text" value={other} placeholder="What's going on" onChange={(e) => setOther(e.target.value)} /></label> : <span />}
            <label>Machine<select value={mach} onChange={(e) => setMach(e.target.value)}>{machines.map((x) => { const c = x.crew ? crews.find((k) => k.id === x.crew) : undefined; return <option key={x.id} value={x.id}>{shortName(x)}{c ? ` · ${c.leader}` : ""}</option>; })}</select></label>
          </div>
          {empOut && leadCrew && machines.filter((x) => x.crew === leadCrew.id).length > 1 && <label className="check"><input type="checkbox" checked={wholeCrew} onChange={(e) => setWholeCrew(e.target.checked)} /> Every press {leadCrew.leader} runs</label>}
          <div className="tmx-2 ms-3">
            <label>From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
            <label>Through<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
            <label>Press runs at<select value={cap} onChange={(e) => setCap(+e.target.value)}>{[0, 25, 50, 75].map((p) => <option key={p} value={p}>{p === 0 ? "0% · stopped" : `${p}% · ${+(100 / p).toFixed(1)}× as long`}</option>)}</select></label>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day{nDays > 1 ? ` (each of the ${nDays} days)` : ""}</label>
            {!allDay && <>
              <label className="ms-inl">From <select value={a} onChange={(e) => { const v = +e.target.value; setA(v); if (b <= v) setB(Math.min(win[1], v + 60)); }}>{times.slice(0, -1).map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
              <label className="ms-inl">until <select value={b} onChange={(e) => setB(+e.target.value)}>{times.filter((t) => t > a).map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
            </>}
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>{cap ? `The press keeps running, just slower: work in that time counts ${cap}%, so jobs stretch out and later jobs slide back.` : "The press is blocked off: nothing is scheduled then, and a job running into it stops and picks up right after."}</div>
          {existing.length > 0 && <div><b style={{ fontSize: 13 }}>Coming up on {m ? shortName(m) : ""}</b><ul className="ms-offs">{existing.slice(0, 40).map((x) => <li key={x.id}><span>{dayLbl(x.day)}</span><span className="faint">{x.start_min != null ? `${clockLong(x.start_min)} – ${clockLong(x.end_min!)}` : "All day"} · {x.employee ? `${x.employee} out` : x.note} · {x.capacity ? `${x.capacity}%` : "stopped"}{x.crew_id ? " · whole crew" : ""}</span><button type="button" className="linkbtn" disabled={busy} onClick={() => remove(x.id)}>Remove</button></li>)}</ul></div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !ok} onClick={save}>{cap ? "Save" : "Block It Off"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Add an extra shift (usually Saturday or Sunday) for one or more presses and their crews, e.g. Saturday 10 AM – 2 PM. */
function ShiftPanel({ machines, crews, extras, today, me, onClose, onSaved }: { machines: Machine[]; crews: Crew[]; extras: Extra[]; today: string; me: string; onClose: () => void; onSaved: (msg: string) => void }) {
  // the next three weekends
  const wkends: string[] = []; for (let i = 1; i <= 21 && wkends.length < 6; i++) { const d = addDay(today, i); if (dow(d) === 6 || dow(d) === 0) wkends.push(d); }
  const [day, setDay] = useState(wkends[0] || today);
  const [pick, setPick] = useState<string[]>([]);
  const [a, setA] = useState(600), [b, setB] = useState(840);
  const [busy, setBusy] = useState(false);
  const times: number[] = []; for (let t = 240; t <= 1320; t += 15) times.push(t);
  const crewOf = (m: Machine) => (m.crew ? crews.find((c) => c.id === m.crew) : undefined);
  const list = [...machines].sort((x, y) => (x.type === "screen" ? 0 : 1) - (y.type === "screen" ? 0 : 1));
  const upcoming = extras.filter((x) => x.day >= today).sort((x, y) => x.day.localeCompare(y.day) || x.machine.localeCompare(y.machine));
  const nameOf = (id: string) => { const m = machines.find((x) => x.id === id); const c = m && crewOf(m); return `${m ? shortName(m) : id}${c ? ` · ${c.leader}` : ""}`; };
  async function save() {
    if (!pick.length || b <= a) return;
    setBusy(true);
    const r = await createClient().from("production_extra_shifts").insert(pick.map((id) => ({ machine: id, crew_id: machines.find((x) => x.id === id)?.crew || null, day, start_min: a, end_min: b, note: "Weekend shift", created_by: me })));
    setBusy(false);
    onSaved(r.error ? r.error.message : `Extra shift ${dayLbl(day)} ${clockLong(a)} – ${clockLong(b)}: ${pick.map(nameOf).join(", ")}. Jobs that were running late move into it.`);
  }
  async function remove(id: string) { setBusy(true); await createClient().from("production_extra_shifts").delete().eq("id", id); setBusy(false); onSaved("Extra shift removed."); }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add weekend shift">
        <div className="pp-sheet-h"><b>Add Weekend Shift</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div><b style={{ fontSize: 13 }}>Which crews?</b>
            <div className="ms-pick">{list.map((m) => { const c = crewOf(m), on = pick.includes(m.id); return <button key={m.id} type="button" className={on ? "on" : ""} onClick={() => setPick(on ? pick.filter((x) => x !== m.id) : [...pick, m.id])}>{shortName(m)}{c ? <small>{c.leader}</small> : null}</button>; })}</div>
          </div>
          <div className="tmx-2 ms-3">
            <label>Day<select value={wkends.includes(day) ? day : ""} onChange={(e) => e.target.value && setDay(e.target.value)}>{wkends.map((d) => <option key={d} value={d}>{dayLbl(d)}</option>)}<option value="">Another day…</option></select></label>
            <label>From<select value={a} onChange={(e) => { const v = +e.target.value; setA(v); if (b <= v) setB(Math.min(1440, v + 240)); }}>{times.slice(0, -1).map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
            <label>Until<select value={b} onChange={(e) => setB(+e.target.value)}>{times.filter((t) => t > a).map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
          </div>
          <label className="ms-inl faint" style={{ fontSize: 12.5 }}>Or pick any date <input type="date" value={day} min={today} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
          <div className="faint" style={{ fontSize: 12.5 }}>{pick.length ? `${pick.length} press${pick.length === 1 ? "" : "es"}, ${dayLbl(day)} ${clockLong(a)} – ${clockLong(b)} (${fmtMin(b - a)} each). The calendar fills it with work that's running late.` : "Pick the presses (crews) that will come in."}</div>
          {upcoming.length > 0 && <div><b style={{ fontSize: 13 }}>Extra shifts on the books</b><ul className="ms-offs">{upcoming.map((x) => <li key={x.id}><span>{dayLbl(x.day)}</span><span className="faint">{nameOf(x.machine)} · {clockLong(x.start_min)} – {clockLong(x.end_min)}</span><button type="button" className="linkbtn" disabled={busy} onClick={() => remove(x.id)}>Remove</button></li>)}</ul></div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !pick.length || b <= a} onClick={save}>Add Shift</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Mid-day check-in: for every job on today's schedule (and anything running or paused), say what really happened —
 * not started, running (and how far along), paused, or finished — then re-plan the rest around it.
 */
type Act = "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen";
function CheckIn({ rows, machines, crews, now, onClose, onSave }: { rows: { c: Card; first?: Seg }[]; machines: Machine[]; crews: Crew[]; now: number; onClose: () => void; onSave: (ch: { slot: Slot; action: Act; progress?: number }[]) => Promise<void> }) {
  type St = "scheduled" | "running" | "paused" | "done";
  const [edit, setEdit] = useState<Record<string, { st: St; p: number }>>(() => Object.fromEntries(rows.map(({ c }) => [c.key, { st: (c.slot!.status as St), p: Math.round(+(c.slot!.progress || 0) * 10) * 10 }])));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: Partial<{ st: St; p: number }>) => setEdit((e) => ({ ...e, [k]: { ...e[k], ...v } }));
  const changes = rows.flatMap(({ c }) => {
    const sl = c.slot!, e = edit[c.key], p0 = Math.round(+(sl.progress || 0) * 10) * 10;
    if (e.st === sl.status && e.p === p0) return [];
    const action: Act = e.st === "done" ? "done" : e.st === "scheduled" ? "not_started" : e.st === "paused" ? "pause" : sl.status === "scheduled" ? "start" : sl.status === "paused" ? "resume" : sl.status === "done" ? "reopen" : "progress";
    return [{ slot: sl, action, progress: e.p / 100 }];
  });
  const lead = (m: Machine) => (m.crew ? crews.find((k) => k.id === m.crew)?.leader : "") || "";
  const byMach = machines.map((m) => ({ m, rs: rows.filter((r) => r.c.machine.id === m.id) })).filter((x) => x.rs.length);
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-ci" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Update progress">
        <div className="pp-sheet-h"><b>Update Progress · {clockLong(now)}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint" style={{ fontSize: 12.5 }}>What happened so far today? Started jobs stay where they are; anything not started can move when you re-plan.</div>
          {!byMach.length && <div className="empty">Nothing on today&apos;s schedule.</div>}
          {byMach.map(({ m, rs }) => (
            <div key={m.id} className="ms-ci-m">
              <b className="ms-ci-mh">{shortName(m)}{lead(m) ? <span className="faint"> · {lead(m)}</span> : null}</b>
              {rs.map(({ c, first }) => { const e = edit[c.key]; return (
                <div key={c.key} className={"ms-ci-r " + e.st}>
                  <span className="ms-ci-j"><b>#{c.job.number}</b> {c.job.customer || c.job.name}<small className="faint">{c.need.label}{first ? ` · planned ${clock(first.start)}` : ""}{c.day !== c.slot!.day ? "" : ""}</small></span>
                  <div className="rv-seg">{([["scheduled", "Not started"], ["running", "Running"], ["paused", "Paused"], ["done", "Done"]] as [St, string][]).map(([k, l]) => <button key={k} type="button" className={e.st === k ? "on" : ""} onClick={() => set(c.key, { st: k, p: k === "done" ? 100 : k === "scheduled" ? 0 : e.p })}>{l}</button>)}</div>
                  {(e.st === "running" || e.st === "paused") ? <select value={e.p} onChange={(ev) => set(c.key, { p: +ev.target.value })} aria-label="Done so far">{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => <option key={p} value={p}>{p}% done</option>)}</select> : <span />}
                </div>
              ); })}
            </div>
          ))}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onSave(changes); setBusy(false); }}>{changes.length ? `Save ${changes.length} & Re-plan` : "Re-plan From Now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
