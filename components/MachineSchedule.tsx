"use client";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mergeProduction, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, shiftOn, typicalShift, isOffDay, windowsIn, downsOn, breaksOn, lunchStart, LUNCH_EARLIEST, CREW_ROLES, subNeed, restNeed, locsOf, PV_READY, type Machine, type Crew, type Down, type Need, type ProductionSettings, type Suggestion } from "@/lib/production";
import { mergeSettings, isMe, type Group, type AccountOwner } from "@/lib/pricing";
import { useSticky } from "@/lib/useSticky";

/**
 * The production calendar, on the shop's real hours.
 * 24 Hours + Next 5 (default): the next 24 hours of press time hour by hour (5 AM – 8 PM shown, shifts default 7 AM – 6 PM) on the
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
type WhatIf = { id: string; kind: "split" | "ot" | "sat" | "combo"; title: string; detail: string; split: boolean; shifts: { machine: string; crew_id: string | null; day: string; start_min: number; end_min: number }[]; splits: number; lateAfter: number; stillLate: string[]; addedHours: number; cost: number };
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
/** the instant for a shop-time date + minutes after midnight (the reverse of shopTime) */
function shopIso(day: string, min: number) {
  const guess = Date.parse(day + "T00:00:00Z") + min * 60000, st = shopTime(new Date(guess))!;
  const diff = (Math.round(Date.parse(st.day + "T00:00:00Z") / 86400000) * 1440 + st.min) - (Math.round(Date.parse(day + "T00:00:00Z") / 86400000) * 1440 + min);
  return new Date(guess - diff * 60000).toISOString();
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
// a customer name for narrow cards: drop Company / Inc / LLC and the like ("ABC Test Company" → "ABC Test")
const abbrCo = (n: string) => n.replace(/[,.]?\s+(company|co|inc|llc|l\.l\.c|corp|corporation|ltd|limited)\.?$/i, "").replace(/\s+(and|&)\s+/gi, " & ").trim() || n;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const PV_DONE = /job\s*completed|quote|cancel|ship|fulfillment|issue/i;
const TYPE_OPTS = [["", "All"], ["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const;
const VIEW_OPTS = [["split", "24 Hours + Next 5"], ["timeline", "Timeline"], ["day", "Day"]] as const;
const HOUR_PX0 = 56;
const LANE = 22;

/**
 * Lay a machine's work out on its real hours. Jobs go in day order (asked-for start times first within a day, then
 * the booking order); each starts when the job before it ends, only inside the shift, and a job that doesn't fit in
 * what's left of the day carries into the next working day. So a 30-hour job fills ~4 shifts, never "overnight".
 */
/**
 * `busy`: when each job is already on a machine (absolute minutes), shared across machines. The same garments can't be
 * on two presses at once, so a split job's other part (the sleeves on another press) waits until this part is off.
 */
function flow(cs: Card[], mach: Machine, nowAbs = -Infinity, busy: Map<string, [number, number][]> = new Map(), lunchOut?: Map<string, number>): Seg[] {
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
  // lunch starts at noon, but moves earlier (not before 11) when a job would otherwise stop in the middle for it;
  // once work is laid past a day's lunch, that day's lunch is settled
  const lunch = new Map<string, number>();
  const wins = (d: string): [number, number, number][] => (works(d) ? windowsIn(hrs(d), downsOn(mach, d, hrs(d), lunch.get(d))) : []);
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
  type Piece = { day: string; start: number; end: number; work: number; slow: number };
  // where a job would go if it were next on this machine (doesn't commit anything but a moved lunch)
  const tryPlace = (c: Card) => {
    // work that hasn't started can't happen in the past: it starts from now at the earliest (the late crew, the
    // morning breakdown…), so everything after it slides forward, into tomorrow if today's shift is used up
    const notStarted = !c.slot || c.slot.status === "scheduled" || c.slot.status === "paused";
    const planned = ord(c.day) * 1440 + (c.startMin ?? hrs(c.day)[0]);
    const asked = Math.max(planned, notStarted ? nowAbs : -Infinity);
    let t = norm(Math.max(cursor, asked), cursor < asked && c.startMin != null && asked === planned);
    const free = t;
    // lay it out from t; if another part of this job is on another machine then, start after that part is done
    const lay = (t0: number) => {
    let t = t0, left = Math.max(1, c.minutes);
    const pieces: Piece[] = [];
    for (let g = 0; g < 400 && left > 0.01; g++) {
      let dd = Math.floor(t / 1440), m = t - dd * 1440, w = wins(fromOrd(dd)).find(([, y]) => m < y);
      // don't start a longer job in the last few minutes of a window: start it in the next one
      if (g === 0 && w && w[1] - m < 10 && left / w[2] > w[1] - m) { t = norm(dd * 1440 + w[1]); dd = Math.floor(t / 1440); m = t - dd * 1440; w = wins(fromOrd(dd)).find(([, y]) => m < y); }
      // a slow stretch (operator out, 50%) takes twice the clock time for the same work
      const rate = w ? w[2] : 1;
      // never past the end of the window it's in (that would run into lunch, warm-up or downtime)
      const end = Math.min(m + left / rate, w ? w[1] : Math.max(hrs(fromOrd(dd))[1], m + 15));
      const day = fromOrd(dd), work = (end - m) * rate, prev = pieces[pieces.length - 1];
      if (prev && prev.day === day && Math.abs(prev.end - m) < 0.5) { prev.end = end; prev.work += work; prev.slow = Math.min(prev.slow, rate); }
      else pieces.push({ day, start: m, end, work, slow: rate });
      left -= work;
      t = left > 0.01 ? norm(dd * 1440 + end) : dd * 1440 + end;
    }
    return { pieces, end: t };
    };
    const jb = busy.get(c.job.key) || [];
    let r = lay(t);
    // this job would stop for lunch partway through: take lunch as it starts instead (if that's 11:00 or later)
    if (c.slot?.status !== "running" && r.pieces.length > 1) {
      const p0 = r.pieces[0], d0 = p0.day, L = lunch.has(d0) ? null : lunchStart(mach, hrs(d0));
      if (L != null && works(d0) && Math.abs(p0.end - L) < 1 && r.pieces[1].day === d0 && p0.start >= LUNCH_EARLIEST && p0.start < L && !(d0 === fromOrd(Math.floor(nowAbs / 1440)) && p0.start < nowAbs - ord(d0) * 1440)) {
        lunch.set(d0, p0.start);
        t = norm(ord(d0) * 1440 + p0.start); r = lay(t);
      }
    }
    let blocked = false;
    for (let k = 0; k < 30 && c.slot?.status !== "running"; k++) {
      const hit = jb.find(([a, b]) => r.pieces.some((p) => ord(p.day) * 1440 + p.start < b && ord(p.day) * 1440 + p.end > a));
      if (!hit) break;
      blocked = true;
      t = norm(hit[1]); r = lay(t);
    }
    return { t, r, planned, free, blocked, jb };
  };
  const pending = [...sorted];
  while (pending.length) {
    let c = pending[0];
    // finished work stays on the day it was done (it never spills into later days or pushes today's jobs)
    if (c.slot?.status === "done") {
      pending.shift();
      const [s0, s1] = hrs(c.day);
      const prior = out.filter((g) => g.day === c.day).reduce((m, g) => Math.max(m, g.end), s0);
      const st = Math.min(prior, s1 - 15);
      const en = Math.min(s1, st + Math.max(15, c.minutes));
      out.push({ c, day: c.day, start: st, end: en, part: 1, parts: 1, pushed: false, work: en - st });
      busy.set(c.job.key, [...(busy.get(c.job.key) || []), [ord(c.day) * 1440 + st, ord(c.day) * 1440 + en]]);
      continue;
    }
    const before = new Map(lunch);
    let pl = tryPlace(c);
    // the next job is waiting on its other part (the front's still on another press): don't leave this press idle,
    // run the next job that can start now instead (one booked for this day or earlier, not one with a set start time)
    if (pl.blocked && pl.t > pl.free + 5) {
      for (let i = 1; i < pending.length; i++) {
        const o = pending[i];
        if (o.slot?.status === "done" || o.slot?.status === "running" || o.startMin != null || o.day > fromOrd(Math.floor(pl.free / 1440))) continue;
        const keep = new Map(lunch);
        lunch.clear(); for (const [k, v] of before) lunch.set(k, v);
        const alt = tryPlace(o);
        if (!alt.blocked && alt.t <= pl.free + 1) { c = o; pl = alt; break; }
        lunch.clear(); for (const [k, v] of keep) lunch.set(k, v);
      }
    }
    pending.splice(pending.indexOf(c), 1);
    const { t, r, planned, jb } = pl;
    const pieces = r.pieces;
    // work laid past a day's lunch settles it
    for (const p of pieces) if (!lunch.has(p.day)) { const L = lunchStart(mach, hrs(p.day)); if (L != null && p.end > L) lunch.set(p.day, L); }
    const pushed = t > planned + 1;
    cursor = r.end;
    busy.set(c.job.key, [...jb, ...pieces.map((p): [number, number] => [ord(p.day) * 1440 + p.start, ord(p.day) * 1440 + p.end])]);
    pieces.forEach((p, i) => out.push({ c, day: p.day, start: p.start, end: p.end, part: i + 1, parts: pieces.length, pushed: pushed && i === 0, work: p.work, slow: p.slow < 1 ? p.slow : undefined }));
  }
  if (lunchOut) for (const [d, at] of lunch) lunchOut.set(d, at);
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
  // crew pay (owners/admins only): what an hour on each press costs, for job labor cost
  const [pay, setPay] = useState<{ rates: Record<string, number>; names: Record<string, string> } | null>(null);
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
  const [renorm, setRenorm] = useState(false);
  const [advise, setAdvise] = useState<null | { opts: WhatIf[]; late: { job: string; customer: string; inHands: string; why: string }[]; lateBefore: number }>(null);
  // the "schedule too tight" prompt shows once a day (again if more jobs go late)
  const [toolsOpen, setToolsOpen] = useSticky("cal.toolsOpen", true);
  const [tightOpen, setTightOpen] = useSticky("cal.tightOpen", false);

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
    if (user?.email) {
      const { data: sf } = await sb.from("staff").select("name, role").eq("email", user.email.toLowerCase()).maybeSingle(); setMe({ email: user.email.toLowerCase(), name: (sf?.name as string) || "" });
      if (["owner", "admin"].includes((sf?.role as string) || "")) {
        const [{ data: pr }, { data: em }] = await Promise.all([sb.from("employee_pay").select("employee_id, rate"), sb.from("employees").select("id, first_name, last_name")]);
        setPay({ rates: Object.fromEntries(((pr || []) as { employee_id: string; rate: number | null }[]).filter((x) => x.rate != null).map((x) => [x.employee_id, +x.rate!])), names: Object.fromEntries(((em || []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, `${x.first_name} ${x.last_name}`.trim()])) });
      }
    }
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
    const by = new Map<string, Seg[]>(), ofCard = new Map<string, Seg[]>(), lunch = new Map<string, number>();
    if (!s) return { by, ofCard, lunch };
    const per = new Map<string, Card[]>();
    for (const c of cards) per.set(c.machine.id, [...(per.get(c.machine.id) || []), c]);
    const nowAbs = ord(now.day) * 1440 + now.min;
    const busy = new Map<string, [number, number][]>();
    for (const [, cs] of per) { const ln = new Map<string, number>(); for (const g of flow(cs, cs[0].machine, nowAbs, busy, ln)) {
      const k = g.c.machine.id + "|" + g.day;
      by.set(k, [...(by.get(k) || []), g]);
      ofCard.set(g.c.key, [...(ofCard.get(g.c.key) || []), g]);
    } for (const [d, at] of ln) lunch.set(cs[0].machine.id + "|" + d, at); }
    return { by, ofCard, lunch };
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
      // Screen Print / Embroidery / Heat Press picked: the tools only deal with that kind of work
      if (typeF && n0.type !== typeF) continue;
      const bk = onCal.get(j.key + ":" + n0.type), n = bk ? restNeed(n0, bk) : n0;
      if (!n) continue;
      const sug = suggest(s, n, j.due, today, ld);
      if (sug) (ld[sug.machine.id] ||= {})[sug.day] = (ld[sug.machine.id]?.[sug.day] || 0) + sug.minutes; // later jobs see this one's room taken
      out.push({ job: j, need: n, sug });
    }
    return out;
  }, [s, jobs, cards, loadMap, today, mine, owners, me, typeF]);
  const coming = (jobs || []).filter((j) => j.kind === "o" && ["approved", "art", "blanks"].includes(j.status));
  // too tight: waiting jobs with no room before in-hands, and booked jobs that finish after their in-hands date
  const tight = useMemo(() => {
    const out: { job: Job; why: string }[] = [], seen = new Set<string>();
    for (const t of tray) if ((!t.sug || t.sug.late) && !seen.has(t.job.key)) { seen.add(t.job.key); out.push({ job: t.job, why: t.sug ? `no room before in-hands ${t.job.due ? dayLbl(t.job.due) : ""}` : "no machine free" }); }
    for (const c of cards) {
      if (!c.job.due || c.slot?.status === "done" || seen.has(c.job.key) || (typeF && c.need.type !== typeF)) continue;
      const last = (segs.ofCard.get(c.key) || []).reduce((d, g) => (g.day > d ? g.day : d), "");
      if (last > c.job.due && c.job.due >= today) { seen.add(c.job.key); out.push({ job: c.job, why: `finishes ${dayLbl(last)}, in-hands ${dayLbl(c.job.due)}` }); }
    }
    return out;
  }, [tray, cards, segs, today, typeF]);

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
  async function logAction(sl: Slot, action: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", progress?: number, reload = true, atIso?: string | null) {
    // atIso: the time the update is for (Update Progress "at a time…"), else now
    const nowIso = atIso || new Date().toISOString(), p = progress ?? +(sl.progress || 0);
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
  /** Split the chosen print locations (say the 1-color sleeve) off into their own run; the rest stay together. */
  async function splitByLocation(c: Card, off: string[]) {
    if (!c.slot) return;
    const locs = locsOf(c.need), keep = locs.filter((l) => !off.includes(l));
    if (!off.length || !keep.length) return;
    const sb = createClient(), mach = c.machine;
    const a = subNeed(c.need, keep), b = subNeed(c.need, off);
    await sb.from("production_slots").update({ locations: keep, label: a.label, minutes: estimate(s!, a, mach).minutes, updated_at: new Date().toISOString() }).eq("id", c.slot.id);
    await sb.from("production_slots").insert({ order_id: c.slot.order_id, archived_order_id: c.slot.archived_order_id, machine: mach.id, day: c.day, minutes: estimate(s!, b, mach).minutes, start_min: null, position: c.slot.position + 1, kind: c.need.type, label: b.label, source: "split", status: "scheduled", locations: off });
    setMsg(`#${c.job.number} split: ${a.label} | ${b.label}. Drag the ${b.label} run to another day or press; the two never run at the same time.`);
    setOpen(null); load();
  }
  async function unbook(sl: Slot) { await createClient().from("production_slots").delete().eq("id", sl.id); setOpen(null); load(); }

  /** Update Progress saved: statuses (as of now or the time picked), part-done jobs split into done + the rest, and the day's hours. */
  async function saveProgress(x: CiSave) {
    const sb = createClient(), when = x.atIso || new Date().toISOString(), stamp = new Date().toISOString();
    for (const ch of x.changes) await logAction(ch.slot, ch.action, ch.progress, false, x.atIso);
    // part done: this booking becomes the finished locations (Done); what's left is booked again where they said
    for (const p of x.parts) {
      const c = p.c, sl = c.slot!, locs = locsOf(c.need), rest = locs.filter((l) => !p.doneLocs.includes(l));
      const a = subNeed(c.need, p.doneLocs), b = subNeed(c.need, rest), m = s!.machines.find((y) => y.id === p.restMach) || c.machine;
      await sb.from("production_slots").update({ locations: p.doneLocs, label: a.label, minutes: estimate(s!, a, c.machine).minutes, status: "done", started_at: sl.started_at || when, finished_at: when, progress: 1, progress_at: when, updated_at: stamp }).eq("id", sl.id);
      await sb.from("production_slot_log").insert({ slot_id: sl.id, order_id: sl.order_id, machine: sl.machine, action: "done", progress: 1, by: me.name || me.email });
      const pos = p.restMach === c.machine.id && p.restDay === c.day ? sl.position + 1 : cards.filter((y) => y.machine.id === p.restMach && y.day === p.restDay).length;
      await sb.from("production_slots").insert({ order_id: sl.order_id, archived_order_id: sl.archived_order_id, machine: m.id, day: p.restDay, minutes: estimate(s!, b, m).minutes, start_min: null, position: pos, kind: c.need.type, label: b.label, source: "partial", status: "scheduled", locations: rest });
    }
    // the day's hours: later or earlier than usual is an extra shift; shorter is downtime ("Leaving early", "Starting late")
    for (const h of x.hours) {
      const [a, b] = h.to, crew = h.m.crew || null, ex: { start_min: number; end_min: number; note: string }[] = [], dn: { start_min: number; end_min: number; note: string }[] = [];
      if (!h.from) ex.push({ start_min: a, end_min: b, note: "Extra shift" });
      else {
        if (b > h.from[1]) ex.push({ start_min: h.from[1], end_min: b, note: "Staying late" });
        if (a < h.from[0]) ex.push({ start_min: a, end_min: h.from[0], note: "Coming in early" });
        if (b < h.from[1]) dn.push({ start_min: b, end_min: h.from[1], note: "Leaving early" });
        if (a > h.from[0]) dn.push({ start_min: h.from[0], end_min: a, note: "Starting late" });
      }
      if (ex.length) await sb.from("production_extra_shifts").insert(ex.map((e) => ({ machine: h.m.id, crew_id: crew, day: h.day, ...e, created_by: me.email })));
      if (dn.length) await sb.from("production_days_off").insert(dn.map((d) => ({ machine: h.m.id, crew_id: null, day: h.day, ...d, capacity: 0, employee: "", created_by: me.email })));
    }
    setCheckin(false); load();
    const n = x.changes.length + x.parts.length, hn = x.hours.length;
    const said = [n ? `${n} job update${n === 1 ? "" : "s"}` : "", hn ? `new hours for ${x.hours.map((h) => shortName(h.m)).join(", ")}` : ""].filter(Boolean).join(" and ");
    setReplan({ why: said ? `Saved ${said}. Anything not started runs from ${clockLong(now.min)} on. Re-plan the rest of the week around it?` : `Anything not started runs from ${clockLong(now.min)} on. Re-plan the rest of the week around it?` });
  }
  if (!s || !jobs) return <div className="empty">Loading the schedule…</div>;

  /**
   * Re-plan: take every booked job that hasn't started (plus, if asked, the ones waiting in Ready To Schedule) and lay
   * them out again, soonest in-hands date first, each on the machine that can finish it earliest, using every hour
   * available: crew shifts, weekend/extra shifts, around downtime, slower where someone's out. Running and done work
   * stays put. Returns the moves so they can be looked at before anything changes.
   */
  // ms: the machines with their hours; a what-if (an hour of overtime, a Saturday shift) passes changed copies
  const planIt = (allowSplit = false, ms: Machine[] = machines) => {
    const nowAbs = ord(today) * 1440 + now.min;
    const winsOf = (m: Machine, d: string) => { const sh = shiftOn(m, d); return sh ? windowsIn(sh, downsOn(m, d, sh)) : []; };
    const norm = (m: Machine, t: number) => { for (let g = 0; g < 120; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y); if (!w) { t = (dd + 1) * 1440; continue; } return mm < w[0] ? dd * 1440 + w[0] : t; } return t; };
    const sim = (m: Machine, t0: number, minutes: number) => {
      let t = norm(m, t0); const start = t; let left = minutes;
      for (let g = 0; g < 400 && left > 0.01; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y)!; if (!w) { t = norm(m, t); continue; } const end = Math.min(mm + left / w[2], w[1]); left -= (end - mm) * w[2]; t = left > 0.01 ? norm(m, dd * 1440 + end) : dd * 1440 + end; }
      return { start, end: t };
    };
    // not started yet (or paused partway): free to move. Running and done work stays where it is.
    const movable = cards.filter((c) => c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !c.fromPv && c.day >= today && (!typeF || c.machine.type === typeF));
    const cursor: Record<string, number> = {};
    for (const m of ms) cursor[m.id] = nowAbs;
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
        const mm = ms.find((x) => x.id === m.id) || m; // the calendar's copy carries days off, downtime and extra shifts
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
        // one part after another: the same shirts can't be on two presses at once
        let prevEnd = -Infinity;
        for (const [i, l] of locs.entries()) {
          const sn = subNeed(it.need, [l]), after = Object.fromEntries(Object.entries(cur2).map(([k, v]) => [k, Math.max(v, prevEnd)]));
          for (const m of ms) if (!(m.id in after)) after[m.id] = Math.max(nowAbs, prevEnd);
          const b = bestFor(sn, 1, after, it.cur); if (!b) { parts.length = 0; break; }
          if (i > 0) { const r = sim(b.m, b.start, b.minutes + 15); b.end = r.end; b.minutes += 15; }
          cur2[b.m.id] = b.end; prevEnd = b.end; parts.push({ need: sn, b, l });
        }
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
    return { out, moves, skipped, splits, lateBefore: lateOld.size, lateAfter: lateJobs.size, lateKeys: lateJobs, added: out.filter((o) => !o.it.slot && o.part === 1).length };
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
  // dropping a job puts it in the running order where it lands, right up against the job before it (no gaps):
  // it goes before the first job whose middle is below the drop point
  function drop(mach: Machine, d: string, minuteAtPointer: number) {
    setOver("");
    if (!drag) return;
    const t = minuteAtPointer - drag.grabMin;
    const inCell = at(mach, d).filter((g) => g.part === 1 && g.c.slot && g.c.key !== drag.card?.key && g.c.slot.status !== "done").sort((x, y) => x.start - y.start);
    const before = inCell.find((g) => (g.start + g.end) / 2 > t);
    place(drag.card ? { card: drag.card } : { job: drag.job, need: drag.need }, mach, d, before?.c.key);
  }
  const cls = (g: Seg) => {
    const c = g.c, late = !!c.job.due && g.day > c.job.due;
    return "ms-blk " + c.need.type + (mine && !isMe(c.job.owner, owners, me) ? " other" : "") + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "") + (g.part > 1 ? " cont-l" : "") + (g.part < g.parts ? " cont-r" : "");
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
                    {(() => { const sh = shiftOn(m, d); return sh ? breaksOn(m, d, sh, segs.lunch.get(m.id + "|" + d)).map(([a0, b0, why]) => { const a = Math.max(a0, vStart), b = Math.min(b0, vEnd); return b > a ? <div key={"bk" + a0} className={(why === "Warm-up" ? "ms-warm" : "ms-lunch") + " h"} title={`${why} ${clockLong(a0)} – ${clockLong(b0)}`} style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} /> : null; }) : null; })()}
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
            onClick={(e) => { if ((e.target as HTMLElement).closest(".ms-blk, .ms-down, .ms-slow button, .ms-warm, .ms-lunch")) return; const r = e.currentTarget.getBoundingClientRect(); setDownEdit({ machine: m.id, day, start: Math.floor((vS + ((e.clientY - r.top) / HOUR_PX) * 60) / 30) * 30 }); }}
            title="Click an open time to add downtime here">
            {shade(m).map(([a, b]) => <div key={a} className="ms-off" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} />)}
            {(() => { const sh = shiftOn(m, day); return sh ? breaksOn(m, day, sh, segs.lunch.get(m.id + "|" + day)).map(([a0, b0, why]) => { const a = Math.max(a0, vS), b = Math.min(b0, vE); if (b <= a) return null; const warm = why === "Warm-up"; return (
              <div key={"bk" + a0} className={warm ? "ms-warm" : "ms-lunch"} style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} title={`${warm ? "Press warm-up" : `${crewOf(m)?.leader ? crewOf(m)!.leader + "'s crew" : "Crew"} lunch`} ${clockLong(a0)} – ${clockLong(b0)}`}>{((b - a) / 60) * HOUR_PX >= 13 && <span>{warm ? "Warm-up" : "Lunch"}</span>}</div>
            ); }) : null; })()}
            {(m.down?.[day] || []).map(([a0, b0, why, rate]) => { const [sa, sb] = shiftOn(m, day) || typicalShift(m), a = Math.max(a0, rate ? sa : a0, vS), b = Math.min(b0, rate ? sb : b0, vE); if (b <= a) return null; return rate
              ? <div key={"sl" + a} className="ms-slow" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }}><button type="button" onClick={() => setDownEdit({ machine: m.id, day })} title={`${why}: ${m.name} runs at ${Math.round(rate * 100)}% ${clockLong(a)} – ${clockLong(b)} (jobs take ${+(1 / rate).toFixed(1)}× as long)`}>{why} · {Math.round(rate * 100)}%</button></div>
              : <button type="button" key={"dn" + a} className="ms-down" style={{ top: ((a - vS) / 60) * HOUR_PX, height: Math.max(16, ((b - a) / 60) * HOUR_PX) }} title={`${m.name} down ${clockLong(a)} – ${clockLong(b)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day, start: a })}><b>Down</b> {clock(a)}–{clock(b)} · {why}</button>; })}
            {(day < today || (day === today && now.min > vS)) && <div className="ms-pastv" style={{ height: ((Math.min(day < today ? vE : now.min, vE) - vS) / 60) * HOUR_PX }} />}
            {day === today && now.min >= vS && now.min <= vE && <div className="ms-now" style={{ top: ((now.min - vS) / 60) * HOUR_PX }} />}
            {at(m, day).map((g) => { const h = Math.max(22, ((g.end - g.start) / 60) * HOUR_PX - 2), gl = glance(g.c.need, g.c.minutes); return (
              <button key={g.c.key + g.part} type="button" draggable className={cls(g) + " card" + (h < 40 ? " tiny" : h < 60 ? " short" : "")} style={{ top: ((g.start - vS) / 60) * HOUR_PX + 1, height: h }} title={tip(g)}
                onDragStart={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); startDrag(e, { card: g.c, grabMin: ((e.clientY - r.top) / HOUR_PX) * 60 }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(g.c)}>
                <span className="ms-l1"><b>#{g.c.job.number}{g.c.slot?.status === "running" ? <em className="rn"> ●</em> : g.c.slot?.status === "done" ? <em className="ok"> ✓</em> : null}</b><span className="co"><span className="full">{g.c.job.customer}</span><span className="ab">{abbrCo(g.c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()}P</span></span>
                <span className="ms-l2">{g.c.job.name || g.c.need.label}</span>
                <span className="ms-l3"><i>{gl.colors}</i><i className="q">{gl.units.toLocaleString()} pcs</i><i className="t">{gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</i><i className="qc">{gl.units.toLocaleString()}P</i></span>
              </button>
            ); })}
          </div>
        ))}
      </div>
    </div>
    );
  };

  /* ---------- Phones: one day, each machine its jobs in time order with a small timeline ---------- */
  /* ---------- Phones: today and the next working day, press by press, as a simple run list ---------- */
  const phoneView = () => {
    const next = Array.from({ length: 7 }, (_, i) => addDay(today, i + 1)).find((d) => machines.some((m) => shiftOn(m, d) || at(m, d).length)) || addDay(today, 1);
    const dayBlock = (d: string) => {
      const rows = machines.map((m) => ({ m, gs: at(m, d).slice().sort((a, b) => a.start - b.start), sh: shiftOn(m, d) }));
      const gone = (r: { sh: [number, number] | null }) => d === today && !!r.sh && r.sh[1] <= now.min;
      const busy = rows.filter((r) => r.gs.length), open = rows.filter((r) => !r.gs.length && r.sh && !gone(r)), done = rows.filter((r) => !r.gs.length && gone(r)), off = rows.filter((r) => !r.gs.length && !r.sh);
      const booked = rows.reduce((t, r) => t + used(r.m, d), 0);
      return (
        <section key={d} className="ms-pd">
          <div className="ms-pd-h"><b>{d === today ? "Today" : d === addDay(today, 1) ? "Tomorrow" : new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}</b><span>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span><small>{fmtMin(booked)} booked</small></div>
          {busy.map(({ m, gs, sh }) => (
            <div key={m.id} className={"ms-pm " + m.type}>
              <div className="ms-pm-h"><b>{shortName(m)}{crewOf(m) ? <span> · {crewOf(m)!.leader}</span> : null}</b><span className="faint">{isOffDay(m, d) ? `Off · ${m.off![d]}` : sh ? hrsTxt(sh) : "extra"} · {fmtMin(used(m, d))}</span></div>
              <ul className="ms-pl">{gs.map((g) => { const gl = glance(g.c.need, g.c.minutes), st = g.c.slot?.status, past = d === today && g.end <= now.min && st !== "running"; return (
                <li key={g.c.key + g.part}><button type="button" className={"ms-pj " + g.c.need.type + (st === "done" ? " done" : st === "running" ? " run" : "") + (past ? " past" : "") + (mine && !isMe(g.c.job.owner, owners, me) ? " other" : "") + (!!g.c.job.due && g.day > g.c.job.due ? " late" : "")} onClick={() => setOpen(g.c)}>
                  <span className="ms-pj-t">{clock(g.start)}<small>{clock(g.end)}</small></span>
                  <span className="ms-pj-b"><span className="ms-pj-1"><b>#{g.c.job.number}</b>{st === "running" ? <em className="rn"> ●</em> : st === "done" ? <em className="ok"> ✓</em> : null} {abbrCo(g.c.job.customer || "")}</span><span className="ms-pj-2">{g.c.job.name || g.c.need.label}</span><span className="ms-pj-3">{gl.colors} · {gl.units.toLocaleString()} pcs · {gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</span></span>
                </button></li>
              ); })}</ul>
            </div>
          ))}
          {open.length > 0 && <div className="ms-pd-x"><b>Open:</b> {open.map((r) => `${shortName(r.m)}${crewOf(r.m) ? ` (${crewOf(r.m)!.leader})` : ""}`).join(", ")}</div>}
          {done.length > 0 && <div className="ms-pd-x faint"><b>Done for the day:</b> {done.map((r) => shortName(r.m)).join(", ")}</div>}
          {off.length > 0 && <div className="ms-pd-x faint"><b>Not running:</b> {off.map((r) => shortName(r.m)).join(", ")}</div>}
        </section>
      );
    };
    return <div className="ms-phone">{dayBlock(today)}{dayBlock(next)}</div>;
  };

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
          <span className="ms-l1"><b>#{c.job.number}{c.slot?.status === "done" ? <em className="ok"> ✓</em> : c.slot?.status === "running" ? <em className="rn"> ●</em> : null}</b><span className="co"><span className="full">{c.job.customer}</span><span className="ab">{abbrCo(c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()}P</span></span>
          <span className="ms-l2">{c.job.name || c.need.label}</span>
          <span className="ms-l3"><i>{gl.colors}</i><i className="q">{gl.units.toLocaleString()} pcs</i><i className="t">{gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</i><i className="qc">{gl.units.toLocaleString()}P</i></span>
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

  /* ---------- Split (default): the next 24 press hours hour by hour on the left, the next five days on the right ---------- */
  const nextVis = (d: string, step = 1) => { let x = d; for (let i = 0; i < 7 && !visible(x); i++) x = addDay(x, step); return x; };
  const dayTitle = (d: string) => { const u = machines.reduce((a, m) => a + used(m, d), 0); return <><b>{d === today ? "Today" : d === addDay(today, 1) ? "Tomorrow" : new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}</b><span>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: d === today || d === addDay(today, 1) ? "short" : undefined, month: "short", day: "numeric" })}</span><small>{fmtMin(u)} booked</small></>; };
  // a day's clock: an hour before the first crew starts to an hour after the last one leaves (and any work outside that)
  const dayWin = (d: string): [number, number] => {
    const sh = machines.map((m) => shiftOn(m, d)).filter(Boolean) as [number, number][];
    const gs = machines.flatMap((m) => at(m, d));
    const a0 = Math.min(...(sh.length ? sh.map((x) => x[0]) : [420]), ...gs.map((g) => g.start)), b0 = Math.max(...(sh.length ? sh.map((x) => x[1]) : [1080]), ...gs.map((g) => g.end));
    return [Math.max(0, Math.floor((a0 - 60) / 60) * 60), Math.min(1440, Math.ceil((b0 + 60) / 60) * 60)];
  };
  // today scrolls forward with the clock: it starts two hours before now (shown greyed as what's already happened)
  const todayWin = (d: string): [number, number] => {
    const w = dayWin(d);
    if (d !== today) return w;
    return [Math.max(w[0], Math.min(Math.floor(now.min / 60) * 60 - 120, w[1] - 60)), w[1]];
  };
  // the hour-by-hour side always holds the next 24 hours of press time (earliest crew in to last crew out), starting
  // now: late in the day that's the rest of today, tomorrow, and the next morning
  const PRESS_HOURS = 24;
  const d0 = nextVis(day);
  const hourly = (() => {
    const out: { d: string; win: [number, number]; until?: number }[] = [];
    let left = PRESS_HOURS * 60;
    for (let i = 0, d = d0; i < 21 && left > 0; i++, d = addDay(d, 1)) {
      if (!visible(d)) continue;
      const sh = machines.map((m) => shiftOn(m, d)).filter(Boolean) as [number, number][];
      if (!sh.length) continue;
      const a = Math.min(...sh.map((x) => x[0])), b = Math.max(...sh.map((x) => x[1]));
      const from = d === today ? Math.max(a, now.min) : a;
      if (d < today || b - from <= 0) continue;
      const win = d === today ? todayWin(d) : dayWin(d);
      if (b - from > left) { const cut = from + left; out.push({ d, win: [win[0], Math.max(win[0] + 60, Math.min(win[1], Math.ceil(cut / 60) * 60))], until: cut }); left = 0; }
      else { out.push({ d, win }); left -= b - from; }
    }
    return out.length ? out : [{ d: d0, win: todayWin(d0) }];
  })();
  const d1 = hourly[hourly.length - 1].d;
  // the five working days after the hour-by-hour ones (a day only partly shown there shows whole here)
  const lastPart = hourly[hourly.length - 1].until != null;
  const restDays = Array.from({ length: 21 }, (_, i) => addDay(d1, i + (lastPart ? 0 : 1))).filter(visible).slice(0, 5);
  const dayName = (d: string) => (d === today ? "Today" : d === addDay(today, 1) ? "Tomorrow" : new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }));
  const split = () => (
    <div className="ms-split">
      <div className="ms-split-col">
        <div className="ms-split-h">Next {PRESS_HOURS} press hours · hour by hour</div>
        <div className="ms-2d">
          {hourly.map((h, i) => i === 0
            ? dayGrid(h.d, { title: dayTitle(h.d), colMin: 70, hourPx: 40, win: h.win })
            : dayGrid(h.d, { sub: <><b>{dayName(h.d)}</b><span>{new Date(h.d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}{h.until != null ? ` · through ${clock(h.win[1])}` : ""}</span></>, colMin: 70, hourPx: 40, win: h.win }))}
        </div>
      </div>
      <div className="ms-split-col r">
        <div className="ms-split-h">Next five days</div>
        <div className="ms-split-fill">{listGrid(restDays, { compact: true })}</div>
      </div>
    </div>
  );
  // what Renormalize Schedule would do: extra shifts from today on, and split jobs whose parts haven't started
  const renormItems = (): RenormItem[] => {
    const out: RenormItem[] = [], sb = createClient();
    const nameOf = (id: string) => { const m = s.machines.find((x) => x.id === id); if (!m) return id; const c = crewOf(m); return shortName(m) + (c ? ` (${c.leader})` : ""); };
    for (const x of extras.filter((e) => e.day >= today && machines.some((m) => m.id === e.machine)).sort((a, b) => a.day.localeCompare(b.day) || a.machine.localeCompare(b.machine))) {
      const booked = cards.filter((c) => c.machine.id === x.machine && c.day === x.day && c.slot).length;
      out.push({ key: "sh:" + x.id, kind: "shift", title: `${nameOf(x.machine)} · ${dayLbl(x.day)} ${clock(x.start_min)}–${clock(x.end_min)}`, detail: `${x.note || "Extra shift"}${booked ? ` · ${booked} job${booked === 1 ? "" : "s"} booked that day move back into the week` : ""}`, run: () => Promise.resolve(sb.from("production_extra_shifts").delete().eq("id", x.id)) });
    }
    const groups = new Map<string, Card[]>();
    for (const c of cards) if (c.slot && !c.fromPv && (!typeF || c.machine.type === typeF)) { const k = c.job.key + ":" + c.slot.kind; groups.set(k, [...(groups.get(k) || []), c]); }
    for (const [k, cs] of groups) {
      if (cs.length < 2 || !cs.some((c) => c.slot!.locations?.length)) continue;
      const parts = cs.slice().sort((a, b) => a.day.localeCompare(b.day) || a.slot!.position - b.slot!.position);
      const job = parts[0].job, need0 = job.needs.find((n) => n.type === parts[0].slot!.kind) || parts[0].need;
      const where = parts.map((c) => `${c.need.label} on ${shortName(c.machine)} ${dayLbl(c.day)}`).join(" + ");
      const started = parts.find((c) => c.slot!.status === "running" || c.slot!.status === "done");
      // the whole job goes where the first part is, or the first part's press that can print every color
      const keep = parts.find((c) => fits(need0, c.machine));
      const title = `#${job.number} ${job.customer || job.name}`;
      if (started) { out.push({ key: "un:" + k, kind: "unsplit", title, detail: where, blocked: `${where} · can't join: the ${started.need.label} run already ${started.slot!.status === "done" ? "finished" : "started"}`, run: async () => {} }); continue; }
      if (!keep) { out.push({ key: "un:" + k, kind: "unsplit", title, detail: where, blocked: `${where} · can't join: no press it's on can print all ${need0.needColors} screens`, run: async () => {} }); continue; }
      out.push({ key: "un:" + k, kind: "unsplit", title, detail: `${where} → one run: ${need0.label} on ${shortName(keep.machine)} ${dayLbl(keep.day)} (${fmtMin(estimate(s, need0, keep.machine).minutes)})`, run: async () => {
        await sb.from("production_slots").update({ locations: null, label: need0.label, minutes: estimate(s, need0, keep.machine).minutes, start_min: null, source: "renormalize", updated_at: new Date().toISOString() }).eq("id", keep.slot!.id);
        for (const c of parts) if (c !== keep) await sb.from("production_slots").delete().eq("id", c.slot!.id);
      } });
    }
    return out;
  };
  /**
   * When the schedule is too tight: what-ifs, each a full re-plan. Split jobs; an hour or two of overtime every
   * working night until the last late job's in-hands date; a Saturday shift (4 or 8 hours); and the cheap combos.
   * Only the machines that run the late work get the extra time. Labor = extra hours × crew × wage × overtime rate.
   */
  /** What an hour on this machine costs: its crew's rates added up (press operator + assistant + catcher). */
  const crewCost = (m: Machine): { perHour: number; who: string[] } | null => {
    if (!pay) return null;
    const c = m.crew ? s.crews.find((k) => k.id === m.crew) : undefined;
    if (!c?.members) return null;
    const who: string[] = []; let perHour = 0;
    for (const [k, l] of CREW_ROLES) { const id = c.members[k]; if (id && pay.rates[id] != null) { perHour += pay.rates[id]; who.push(`${(pay.names[id] || "").split(" ")[0] || l} $${pay.rates[id]}`); } }
    return perHour ? { perHour, who } : null;
  };
  const whatIfs = (): WhatIf[] => {
    const lab = s.labor, lateTypes = new Set<string>();
    for (const t of tray) if (!t.sug || t.sug.late) lateTypes.add(t.need.type);
    for (const c of cards) if (tight.some((x) => x.job.key === c.job.key)) lateTypes.add(c.need.type);
    const cand = machines.filter((m) => lateTypes.has(m.type));
    const lastDue = tight.reduce((d, t) => (t.job.due && t.job.due > d ? t.job.due : d), addDay(today, 5));
    const until = lastDue < addDay(today, 21) ? lastDue : addDay(today, 21);
    const days: string[] = []; for (let d = today; d <= until; d = addDay(d, 1)) days.push(d);
    const people = (m: Machine) => (m.crew ? lab.crewSize : 1);
    const withExtra = (add: (m: Machine) => { day: string; a: number; b: number }[]) => {
      const shifts: WhatIf["shifts"] = [];
      const ms = machines.map((m) => {
        if (!cand.includes(m)) return m;
        const adds = add(m); if (!adds.length) return m;
        const extra = { ...(m.extra || {}) };
        for (const x of adds) { const e = extra[x.day]; extra[x.day] = e ? [Math.min(e[0], x.a), Math.max(e[1], x.b)] : [x.a, x.b]; shifts.push({ machine: m.id, crew_id: m.crew || null, day: x.day, start_min: x.a, end_min: x.b }); }
        return { ...m, extra };
      });
      return { ms, shifts };
    };
    const ot = (h: number) => withExtra((m) => days.flatMap((d) => { const sh = shiftOn(m, d); if (!sh || [0, 6].includes(dow(d))) return []; const a = sh[1]; if (d === today && now.min > a) return []; return [{ day: d, a, b: Math.min(1440, a + h * 60) }]; }));
    const sat = days.find((d) => dow(d) === 6 && d > today) || (() => { let d = addDay(today, 1); while (dow(d) !== 6) d = addDay(d, 1); return d; })();
    const satShift = (a: number, b: number) => withExtra(() => [{ day: sat, a, b }]);
    const hoursOf = (sh: WhatIf["shifts"]) => sh.reduce((t, x) => t + (x.end_min - x.start_min) / 60, 0);
    const perHr = (m: Machine) => crewCost(m)?.perHour ?? people(m) * lab.wage;
    const costOf = (sh: WhatIf["shifts"], splits: number) => sh.reduce((t, x) => { const m = machines.find((y) => y.id === x.machine)!; return t + ((x.end_min - x.start_min) / 60) * perHr(m) * lab.otMultiplier; }, 0) + splits * 0.25 * lab.crewSize * lab.wage;
    const names = cand.map((m) => (crewOf(m) ? crewOf(m)!.leader : shortName(m))).join(", ");
    const lastWork = days.filter((d) => ![0, 6].includes(dow(d)));
    const span = lastWork.length ? `${dayLbl(lastWork[0]).split(",")[0]}–${dayLbl(lastWork[lastWork.length - 1])}` : "";
    const defs: { id: string; kind: WhatIf["kind"]; title: string; detail: string; split: boolean; x: { ms: Machine[]; shifts: WhatIf["shifts"] } }[] = [
      { id: "replan", kind: "split", title: "Just re-plan", detail: "Move the open work around, no extra hours, no splitting", split: false, x: { ms: machines, shifts: [] } },
      { id: "split", kind: "split", title: "Split jobs as needed", detail: "Fronts and backs as separate runs where that makes a date", split: true, x: { ms: machines, shifts: [] } },
      { id: "ot1", kind: "ot", title: "1 hour of overtime a night", detail: `${names} stay an hour late, ${span}`, split: false, x: ot(1) },
      { id: "ot2", kind: "ot", title: "2 hours of overtime a night", detail: `${names} stay two hours late, ${span}`, split: false, x: ot(2) },
      { id: "sat4", kind: "sat", title: `Saturday morning (${dayLbl(sat)})`, detail: `${names}, 8 AM – 12 PM`, split: false, x: satShift(480, 720) },
      { id: "sat8", kind: "sat", title: `Full Saturday (${dayLbl(sat)})`, detail: `${names}, 7 AM – 3:30 PM`, split: false, x: satShift(420, 930) },
      { id: "ot1s", kind: "combo", title: "1 hour of overtime a night + split jobs", detail: `${names} an hour late, ${span}; fronts and backs split where it helps`, split: true, x: ot(1) },
      { id: "sat4s", kind: "combo", title: "Saturday morning + split jobs", detail: `${names} 8 AM – 12 PM ${dayLbl(sat)}; split where it helps`, split: true, x: satShift(480, 720) },
    ];
    return defs.map((d) => {
      const p = planIt(d.split, d.x.ms);
      const stillLate = [...p.lateKeys].map((k) => byKey.get(k)).filter(Boolean).map((j) => "#" + j!.number);
      return { id: d.id, kind: d.kind, title: d.title, detail: d.detail, split: d.split, shifts: d.x.shifts, splits: p.splits, lateAfter: p.lateAfter, stillLate, addedHours: Math.round(hoursOf(d.x.shifts) * 10) / 10, cost: Math.round(costOf(d.x.shifts, p.splits)) };
    }).sort((a, b) => a.lateAfter - b.lateAfter || a.cost - b.cost);
  };
  async function applyWhatIf(w: WhatIf) {
    const note = w.kind === "sat" || w.id === "sat4s" ? "Saturday shift" : "Overtime";
    if (w.shifts.length) {
      const r = await createClient().from("production_extra_shifts").insert(w.shifts.map((x) => ({ ...x, note, created_by: me.email })));
      if (r.error) { setMsg(r.error.message); return; }
    }
    setAdvise(null); setWknd(w.kind === "sat" || w.id === "sat4s" ? true : showWknd); load();
    setReplan({ why: `${w.title}${w.shifts.length ? " added" : ""}. Re-plan now to move the jobs into it?`, split: w.split });
  }

  const shift = (dir: 1 | -1) => (view === "timeline" ? setWeek(addDay(week, 7 * dir)) : setDay(nextVis(addDay(view === "split" ? d0 : day, dir), dir)));

  return (
    <div className="ms">
      {/* the calendar's own controls on one line: what's shown on the left, how it's shown on the right */}
      {/* one line that never wraps: when it gets tight each control turns into a compact dropdown of the same choices */}
      <div className="ms-head-w">
      <div className="ms-head">
        <h2 className="ms-title"><span className="ms-full">Production Calendar</span><span className="ms-cmp">Production</span></h2>
        <div className="rv-seg ms-full">{TYPE_OPTS.map(([k, l]) => <button key={k} type="button" className={typeF === k ? "on" : ""} onClick={() => setTypeF(k)}>{l}</button>)}</div>
        <select className="ms-cmp ms-sel" value={typeF} aria-label="Machines" onChange={(e) => setTypeF(e.target.value as typeof typeF)}>{TYPE_OPTS.map(([k, l]) => <option key={k} value={k}>{k ? l : "All machines"}</option>)}</select>
        <div className="rv-seg ms-who ms-full" role="group" aria-label="Whose jobs">{([[false, "Everyone"], [true, "My accounts"]] as const).map(([k, l]) => <button key={l} type="button" className={mine === k ? "on" : ""} onClick={() => setMine(k)}>{l}</button>)}</div>
        <select className="ms-cmp ms-sel" value={mine ? "mine" : "all"} aria-label="Whose jobs" onChange={(e) => setMine(e.target.value === "mine")}><option value="all">Everyone</option><option value="mine">My accounts</option></select>
        <span className="spacer" />
        <label className="ms-wknd ms-desk" title="Show Saturday and Sunday"><input type="checkbox" checked={showWknd} onChange={(e) => setWknd(e.target.checked)} /> <span className="ms-full">Weekends</span><span className="ms-cmp">Sat/Sun</span></label>
        <div className="rv-seg ms-span ms-full ms-desk">{VIEW_OPTS.map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
        <select className="ms-cmp ms-sel ms-desk" value={view} aria-label="View" onChange={(e) => setView(e.target.value as View)}>{VIEW_OPTS.map(([k, l]) => <option key={k} value={k}>{k === "split" ? "24 hrs + 5 days" : l}</option>)}</select>
        <div className="ms-nav ms-desk">
          <button type="button" className="btn sm" onClick={() => shift(-1)} aria-label="Earlier">←</button>
          <button type="button" className="btn sm" onClick={() => { setWeek(monday(today)); setDay(today); }}>{view === "timeline" ? "This Week" : "Today"}</button>
          <button type="button" className="btn sm" onClick={() => shift(1)} aria-label="Later">→</button>
        </div>
      </div>
      </div>
      {msg && <div className="banner" style={{ marginBottom: 8 }} onClick={() => setMsg("")}>{msg}</div>}

      {/* Scheduling Tools: the schedule's health, the actions that change it, and the jobs waiting for a spot */}
      <section className={"ms-tools" + (toolsOpen ? "" : " closed")}>
        <div className="ms-tools-h">
          <button type="button" className="ms-tools-t" onClick={() => setToolsOpen(!toolsOpen)} aria-expanded={toolsOpen}><span className="car">{toolsOpen ? "▾" : "▸"}</span>Scheduling Tools</button>
          {!toolsOpen && (tight.length ? <span className="ms-health bad">{tight.length} job{tight.length === 1 ? "" : "s"} can&apos;t make in-hands</span> : <span className="ms-health ok">On track</span>)}
          {!toolsOpen && tray.length > 0 && <span className="ms-health">{tray.length} ready to schedule</span>}
          <span className="spacer" />
          <Link className="linkbtn" href="/shop/settings/production">Machines, crews &amp; times</Link>
        </div>
        {toolsOpen && <>
          <div className="ms-acts">
            <button type="button" className="ms-act" onClick={() => setCheckin(true)}><b>Update Progress</b><small>What&apos;s started, done or paused today</small></button>
            <button type="button" className="ms-act" onClick={() => setReplan({ why: "" })}><b>Re-plan Schedule</b><small>Re-lay open work from now, soonest in-hands first</small></button>
            <button type="button" className="ms-act" onClick={() => setShiftEdit(true)}><b>+ Add Shift</b><small>A weekend or extra shift for a crew</small></button>
            <button type="button" className="ms-act" onClick={() => setDownEdit({})}><b>+ Add Downtime</b><small>Maintenance, repairs, an employee out</small></button>
            <button type="button" className="ms-act" onClick={() => setRenorm(true)}><b>Renormalize Schedule</b><small>Drop extra shifts, put split jobs back together</small></button>
          </div>

          {tight.length > 0 ? (
            <div className="ms-alert">
              <div className="ms-alert-h">
                <span className="ms-alert-i" aria-hidden>!</span>
                <div className="ms-alert-t"><b>Schedule too tight</b><span>{tight.length} job{tight.length === 1 ? " won't" : "s won't"} make {tight.length === 1 ? "its" : "their"} in-hands date on the regular schedule.</span></div>
                <span className="spacer" />
                <button type="button" className="linkbtn" onClick={() => setTightOpen(!tightOpen)}>{tightOpen ? "Hide jobs" : "Which jobs?"}</button>
                <button type="button" className="btn sm ms-ai-b" onClick={() => setAdvise({ opts: whatIfs(), late: tight.map((t) => ({ job: "#" + t.job.number, customer: t.job.customer || t.job.name, inHands: t.job.due ? dayLbl(t.job.due) : "none", why: t.why })), lateBefore: tight.length })}>✦ Get Recommendations</button>
                <button type="button" className="btn sm" onClick={() => setReplan({ why: "OK to split jobs (fronts and backs as separate runs) where that makes an in-hands date?", split: true })}>Split Jobs As Needed</button>
                <button type="button" className="btn sm" onClick={() => setReplan({ why: "" })}>Re-plan</button>
                <button type="button" className="btn sm primary" onClick={() => setShiftEdit(true)}>Add Weekend Shift</button>
              </div>
              {tightOpen && <ul className="ms-alert-l">{tight.map((t) => <li key={t.job.key}><Link href={t.job.href}>#{t.job.number}</Link><span>{t.job.customer || t.job.name}</span><small>{t.why}</small></li>)}</ul>}
            </div>
          ) : <div className="ms-okline"><span className="ms-ok-i" aria-hidden>✓</span>On track: every booked job makes its in-hands date.</div>}

          <div className="ms-ready">
            <div className="ms-ready-h">
              <button type="button" className="ms-band-t" onClick={() => setTrayOpen(!trayOpen)} aria-expanded={trayOpen}><span className="car">{trayOpen ? "▾" : "▸"}</span><b>Ready To Schedule</b><span className="aa-n">{tray.length}</span></button>
              <span className="faint ms-band-sub">{tray.filter((t) => t.sug?.late).length ? <span className="ms-late">{tray.filter((t) => t.sug?.late).length} tight or late · </span> : null}{coming.length ? `${coming.length} more coming (art, blanks) · ` : ""}{tray.length ? "drag onto a press and day, or take the suggested spot" : ""}</span>
              <span className="spacer" />
              {trayOpen && tray.some((t) => t.sug && !t.sug.late) && <button type="button" className="btn sm primary" onClick={acceptAll}>Accept All Suggestions</button>}
            </div>
            {trayOpen && (!tray.length ? <div className="ms-ready-empty">Nothing waiting. Jobs land here when they go to In Production (goods here, art approved).</div> : (
              <>
                <ul className="ms-rc-l">{(trayAll ? tray : tray.slice(0, 12)).map((t) => (
                  <li key={t.job.key + t.need.type} draggable onDragStart={(e) => startDrag(e, { job: t.job, need: t.need, grabMin: 0 })} onDragEnd={() => setDrag(null)} className={"ms-rc " + t.need.type + (t.sug?.late ? " late" : "")} title={`${t.job.name}\n${t.need.label} · ${t.need.qty} pcs${t.job.owner ? `\nAccount: ${t.job.owner}` : ""}${t.sug ? `\n${t.sug.reason}` : ""}`}>
                    <div className="ms-rc-1"><Link className="ms-r-n" href={t.job.href}>#{t.job.number}</Link><b>{t.job.customer || t.job.name}</b>{t.job.owner ? <span className="ms-own" title={t.job.owner}>{initials(t.job.owner)}</span> : null}</div>
                    <div className="ms-rc-2">{t.need.label}</div>
                    <div className="ms-rc-3">
                      <span className="ms-rc-q">{t.need.qty.toLocaleString()} pcs</span>
                      <span className={"ms-rc-d" + (t.sug?.late ? " late" : "")}>{t.job.due ? `Due ${dayShort(t.job.due)}` : "No due date"}</span>
                      <span className="spacer" />
                      {t.sug ? <button type="button" className="btn sm primary ms-r-b" onClick={() => book(t.job, t.need, t.sug!.machine, t.sug!.day, "suggested")} title={t.sug.reason}>{shortName(t.sug.machine)} · {t.sug.day === today ? "Today" : dayLbl(t.sug.day).split(",")[0]}</button> : <span className="ms-late ms-r-b">No machine</span>}
                    </div>
                  </li>
                ))}</ul>
                {tray.length > 12 && <button type="button" className="btn sm ms-band-more" onClick={() => setTrayAll(!trayAll)}>{trayAll ? "Show fewer" : `Show all ${tray.length}`}</button>}
              </>
            ))}
          </div>
        </>}
      </section>

      <div className="ms-main">
        {view === "split" ? split() : view === "timeline" ? <div className="ms-weeks">{weekGrid(week, week === monday(today) ? "This Week" : week === addDay(monday(today), -7) ? "Last Week" : "Week of")}{weekGrid(addDay(week, 7), addDay(week, 7) === addDay(monday(today), 7) ? "Next Week" : addDay(week, 7) === monday(today) ? "This Week" : "Week of")}</div> : dayGrid(day)}
        {phoneView()}
        <div className="ms-key faint"><span><i className="k screen" />Screen print</span><span><i className="k embroidery" />Embroidery</span><span><i className="k heat" />Heat press</span><span><i className="k run" />Running</span><span><i className="k done" />Done</span><span><i className="k late" />Past in-hands</span></div>
      </div>

      {advise && <AdvisePanel options={advise.opts} late={advise.late} lateBefore={advise.lateBefore} labor={s.labor} machinesLabel={typeF ? TYPE_LBL[typeF] : "all machines"} nowLabel={`${dayLbl(today)} ${clockLong(now.min)}`} onClose={() => setAdvise(null)} onApply={applyWhatIf} />}
      {renorm && <RenormPanel items={renormItems()} onClose={() => setRenorm(false)} onDone={(m) => { setRenorm(false); setMsg(m); load(); setReplan({ why: `${m} Re-plan now so the jobs fill the regular week?` }); }} />}
      {shiftEdit && <ShiftPanel machines={machines} crews={s.crews} extras={extras} today={today} me={me.email} onClose={() => setShiftEdit(false)} onSaved={(m) => { setShiftEdit(false); setWknd(true); setMsg(m); load(); setReplan({ why: "Weekend shift added. Re-plan so earlier jobs can move into it and make room during the week?" }); }} />}
      {checkin && <CheckIn s={s} cards={cards} segsOf={(c) => segs.ofCard.get(c.key) || []} machines={machines} crews={s.crews} today={today} nowMin={now.min} onClose={() => setCheckin(false)} onSave={saveProgress} />}
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
      {open && <CardPanel s={s} c={open} cost={crewCost} segs={segs.ofCard.get(open.key) || []} days={[...new Set([...allDays, ...hourly.map((h) => h.d), ...restDays])].filter(visible).sort()} win={[vStart, vEnd]} onClose={() => setOpen(null)} onMove={(mach, d, st) => { book(open.job, open.need, mach, d, "manual", open.slot, st); setOpen(null); }} onStatus={setStatus} onUnbook={unbook} onLog={(a, p) => open.slot && logAction(open.slot, a, p)} onSplit={(off) => splitByLocation(open, off)} />}
    </div>
  );
}

/** A job on the calendar: when it runs (every day it spans), the time breakdown, move it, mark it running or done, or take it off. */
function CardPanel({ s, c, cost, segs, days, win, onClose, onMove, onStatus, onUnbook, onLog, onSplit }: { s: ProductionSettings; c: Card; cost: (m: Machine) => { perHour: number; who: string[] } | null; segs: Seg[]; days: string[]; win: [number, number]; onClose: () => void; onMove: (m: Machine, d: string, startMin: number | null) => void; onStatus: (sl: Slot, st: Slot["status"]) => void; onUnbook: (sl: Slot) => void; onLog: (a: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", p?: number) => void; onSplit: (off: string[]) => void }) {
  const [splitting, setSplitting] = useState<string[] | null>(null);
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
          {(() => { const k = cost(m); return k ? <div className="ms-cost"><b>Labor ${Math.round((est.minutes / 60) * k.perHour).toLocaleString()}</b><span>{fmtMin(est.minutes)} × ${k.perHour.toFixed(2).replace(/\.00$/, "")}/hr crew ({k.who.join(" + ")}) · ${(((est.minutes / 60) * k.perHour) / Math.max(1, glance(c.need, est.minutes).units)).toFixed(2)} a piece</span></div> : null; })()}
          {c.fromPv && c.minutes !== est.minutes && <div className="faint" style={{ fontSize: 12.5 }}>Printavo has it blocked for {fmtMin(c.minutes)}; our estimate is {fmtMin(est.minutes)}. Booking it here uses our estimate.</div>}
          {splitting && <div className="ms-ask">
            <b>Which part would you like to split off?</b>
            <span>Tick what should run separately. The rest stays together on this press. The two parts never run at the same time.</span>
            <div className="ms-pick">{locsOf(c.need).map((l) => { const on = splitting.includes(l); return <button key={l} type="button" className={on ? "on" : ""} onClick={() => setSplitting(on ? splitting.filter((x) => x !== l) : [...splitting, l])}>{subNeed(c.need, [l]).label}<small>{on ? "split off" : "stays"}</small></button>; })}</div>
            <div className="row" style={{ gap: 8 }}><button type="button" className="btn sm primary" disabled={!splitting.length || splitting.length >= locsOf(c.need).length} onClick={() => onSplit(splitting)}>Split</button><button type="button" className="btn sm" onClick={() => setSplitting(null)}>Cancel</button></div>
          </div>}
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
            {c.slot && locsOf(c.need).length > 1 && stt !== "done" && <button type="button" className="btn" onClick={() => setSplitting([])} title="Run some print locations (like a sleeve) separately, on another day or press">Split Job…</button>}
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
/** Get Recommendations: the simulated options side by side, and Claude's pick (or the cheapest full fix when AI is off). */
type Advice = { headline: string; pick: string; why: string; runnersUp?: { id: string; why: string }[]; ideas?: string[] };
function AdvisePanel({ options, late, lateBefore, labor, machinesLabel, nowLabel, onClose, onApply }: { options: WhatIf[]; late: { job: string; customer: string; inHands: string; why: string }[]; lateBefore: number; labor: { crewSize: number; wage: number; otMultiplier: number }; machinesLabel: string; nowLabel: string; onClose: () => void; onApply: (w: WhatIf) => Promise<void> }) {
  const [opts] = useState(options);
  const [ai, setAi] = useState<Advice | null>(null);
  const [aiState, setAiState] = useState<"loading" | "done" | "off" | "error">("loading");
  const [aiMsg, setAiMsg] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let dead = false;
    fetch("/api/production/advise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: nowLabel, lateBefore, late, labor, machines: machinesLabel, options: opts.map((o) => ({ id: o.id, title: o.title, detail: o.detail, lateAfter: o.lateAfter, stillLate: o.stillLate, addedHours: o.addedHours, cost: o.cost, splits: o.splits })) }) })
      .then((r) => r.json()).then((j) => { if (dead) return; if (j.off) { setAiState("off"); setAiMsg(j.reason || ""); } else if (j.error) { setAiState("error"); setAiMsg(j.error); } else { setAi(j); setAiState("done"); } })
      .catch(() => { if (!dead) { setAiState("error"); setAiMsg("Couldn't reach the AI."); } });
    return () => { dead = true; };
    // once, when it opens (the inputs are a snapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // without AI: the cheapest option that gets everything on time, else the one that saves the most
  const fallback = opts.find((o) => o.lateAfter === 0) || opts[0];
  const pickId = ai?.pick && opts.some((o) => o.id === ai.pick) ? ai.pick : fallback?.id;
  const money = (n: number) => `$${n.toLocaleString()}`;
  const byId = (id: string) => opts.find((o) => o.id === id);
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-adv" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recommendations">
        <div className="pp-sheet-h"><b>Get Back On Track</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint" style={{ fontSize: 12.5 }}>{lateBefore} job{lateBefore === 1 ? "" : "s"} won&apos;t make {lateBefore === 1 ? "its" : "their"} in-hands date as planned. Each option below is a full re-plan with that change. Labor figured at crews of {labor.crewSize}, ${labor.wage}/hr, {labor.otMultiplier}× for extra hours (Settings → Production).</div>
          <div className={"ms-adv-ai " + aiState}>
            <span className="ms-adv-i" aria-hidden>✦</span>
            {aiState === "loading" && <div><b>Thinking it over…</b><span>Comparing the options.</span></div>}
            {aiState === "done" && ai && <div>
              <b>{ai.headline}</b><span>{ai.why}</span>
              {!!ai.runnersUp?.length && <ul>{ai.runnersUp.map((r) => byId(r.id) ? <li key={r.id}><b>{byId(r.id)!.title}:</b> {r.why}</li> : null)}</ul>}
              {!!ai.ideas?.length && <ul className="ideas">{ai.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>}
            {(aiState === "off" || aiState === "error") && fallback && <div>
              <b>{fallback.lateAfter === 0 ? `Cheapest fix: ${fallback.title}${fallback.cost ? ` (~${money(fallback.cost)})` : ""}. Everything makes its date.` : `Best available: ${fallback.title}. ${fallback.lateAfter} still late (${fallback.stillLate.join(", ")}).`}</b>
              <span>{aiState === "off" ? `AI advice is off${aiMsg ? `: ${aiMsg}` : ""}.` : `AI advice didn't come back (${aiMsg}).`} This is the planner&apos;s own pick.</span>
            </div>}
          </div>
          <div className="ms-adv-l">
            {opts.map((o) => (
              <div key={o.id} className={"ms-adv-r" + (o.id === pickId ? " pick" : "") + (o.lateAfter === 0 ? " ok" : "")}>
                <div className="ms-adv-t"><b>{o.title}{o.id === pickId ? <em>Recommended</em> : null}</b><small>{o.detail}{o.splits ? ` · ${o.splits} job${o.splits === 1 ? "" : "s"} split` : ""}</small></div>
                <div className="ms-adv-n"><b className={o.lateAfter ? "bad" : "good"}>{o.lateAfter ? `${o.lateAfter} late` : "All on time"}</b><small>{o.lateAfter ? o.stillLate.slice(0, 4).join(", ") + (o.stillLate.length > 4 ? "…" : "") : `was ${lateBefore}`}</small></div>
                <div className="ms-adv-n"><b>{o.cost ? `~${money(o.cost)}` : "$0"}</b><small>{o.addedHours ? `${o.addedHours} press-hrs extra` : "no extra hours"}</small></div>
                <button type="button" className={"btn sm" + (o.id === pickId ? " primary" : "")} disabled={!!busy} onClick={async () => { setBusy(o.id); await onApply(o); setBusy(""); }}>{busy === o.id ? "…" : "Apply"}</button>
              </div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>Apply adds the shifts (and allows splitting where the option says so), then opens Re-plan to preview the moves before anything else changes.</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renormalize Schedule: back to the regular week. Lists what it would do (drop the weekend / extra shifts still ahead,
 * put split jobs back together as one run) with every line ticked; untick anything to keep it, then apply.
 */
type RenormItem = { key: string; kind: "shift" | "unsplit"; title: string; detail: string; blocked?: string; run: () => Promise<unknown> };
function RenormPanel({ items, onClose, onDone }: { items: RenormItem[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [skip, setSkip] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const doable = items.filter((x) => !x.blocked), chosen = doable.filter((x) => !skip.includes(x.key));
  const shifts = items.filter((x) => x.kind === "shift"), splits = items.filter((x) => x.kind === "unsplit");
  async function apply() {
    setBusy(true);
    for (const x of chosen) await x.run();
    setBusy(false);
    const ns = chosen.filter((x) => x.kind === "shift").length, nj = chosen.filter((x) => x.kind === "unsplit").length;
    onDone(`Schedule renormalized: ${[ns ? `${ns} extra shift${ns === 1 ? "" : "s"} removed` : "", nj ? `${nj} job${nj === 1 ? "" : "s"} put back together` : ""].filter(Boolean).join(", ")}.`);
  }
  const row = (x: RenormItem) => (
    <li key={x.key} className={x.blocked ? "no" : skip.includes(x.key) ? "off" : ""}>
      <label><input type="checkbox" disabled={!!x.blocked} checked={!x.blocked && !skip.includes(x.key)} onChange={(e) => setSkip(e.target.checked ? skip.filter((k) => k !== x.key) : [...skip, x.key])} />
        <span><b>{x.title}</b><small>{x.blocked || x.detail}</small></span></label>
    </li>
  );
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-rn" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Renormalize schedule">
        <div className="pp-sheet-h"><b>Renormalize Schedule</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          {!items.length ? <div>The schedule is already normal: no extra shifts ahead and no split jobs.</div> : <>
            <div className="faint" style={{ fontSize: 12.5 }}>Back to the regular week. Everything below is ticked; untick anything you want to keep as it is.</div>
            {shifts.length > 0 && <div><div className="ms-rn-h">Remove extra shifts <span className="aa-n">{shifts.length}</span></div><ul className="ms-rn-l">{shifts.map(row)}</ul></div>}
            {splits.length > 0 && <div><div className="ms-rn-h">Put split jobs back together <span className="aa-n">{splits.length}</span></div><ul className="ms-rn-l">{splits.map(row)}</ul></div>}
          </>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>{items.length ? "Cancel" : "Close"}</button>
            {items.length > 0 && <button type="button" className="btn primary" disabled={busy || !chosen.length} onClick={apply}>{busy ? "Working…" : `Make ${chosen.length} Change${chosen.length === 1 ? "" : "s"}`}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

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
/**
 * Update Progress: the production manager's check-in. As of right now, or a time they pick ("here's where we'll be at
 * lunch"), each job on that day's presses is Not started / Running (x% done) / Paused / Part done (some print locations
 * finished, the rest booked again: next on this press, or another day and press, e.g. the sleeves on Friday) / Done.
 * At the bottom, the day's hours per press: stay late or come in early (an extra shift), leave early or start late
 * (downtime). Then re-plan around it.
 */
type CiSt = "scheduled" | "running" | "paused" | "part" | "done";
type CiEdit = { st: CiSt; p: number; doneLocs: string[]; restDay: string; restMach: string };
export type CiSave = {
  atIso: string | null;
  changes: { slot: Slot; action: Act; progress?: number }[];
  parts: { c: Card; doneLocs: string[]; restDay: string; restMach: string }[];
  hours: { m: Machine; day: string; from: [number, number] | null; to: [number, number] }[];
};
function CheckIn({ s, cards, segsOf, machines, crews, today, nowMin, onClose, onSave }: { s: ProductionSettings; cards: Card[]; segsOf: (c: Card) => Seg[]; machines: Machine[]; crews: Crew[]; today: string; nowMin: number; onClose: () => void; onSave: (x: CiSave) => Promise<void> }) {
  const [when, setWhen] = useState<"now" | "at">("now");
  const [atDay, setAtDay] = useState(today);
  const [atMin, setAtMin] = useState(() => Math.min(20 * 60, Math.max(12 * 60, Math.ceil(nowMin / 60) * 60)));
  const asDay = when === "now" ? today : atDay, asMin = when === "now" ? nowMin : atMin;
  const rows = cards.filter((c) => c.slot && !c.fromPv && machines.some((m) => m.id === c.machine.id) && (c.day === asDay || c.slot.status === "running" || c.slot.status === "paused"))
    .map((c) => ({ c, first: segsOf(c).filter((g) => g.day === asDay)[0] }))
    .sort((a, b) => (a.first?.start ?? 9999) - (b.first?.start ?? 9999));
  const init = (c: Card): CiEdit => ({ st: c.slot!.status as CiSt, p: Math.round(+(c.slot!.progress || 0) * 10) * 10, doneLocs: [], restDay: "", restMach: c.machine.id });
  const [edit, setEdit] = useState<Record<string, CiEdit>>({});
  const ed = (c: Card) => edit[c.key] || init(c);
  const set = (c: Card, v: Partial<CiEdit>) => setEdit((e) => ({ ...e, [c.key]: { ...(e[c.key] || init(c)), ...v } }));
  const [hrsOpen, setHrsOpen] = useState(false);
  const [hrs, setHrs] = useState<Record<string, [number, number]>>({});
  const [busy, setBusy] = useState(false);
  const lead = (m: Machine) => (m.crew ? crews.find((k) => k.id === m.crew)?.leader : "") || "";
  const byMach = machines.map((m) => ({ m, rs: rows.filter((r) => r.c.machine.id === m.id) })).filter((x) => x.rs.length);
  const workDays = Array.from({ length: 21 }, (_, i) => addDay(asDay, i)).filter((d) => machines.some((m) => shiftOn(m, d))).slice(0, 10);
  const changes = rows.flatMap(({ c }) => {
    const sl = c.slot!, e = ed(c), p0 = Math.round(+(sl.progress || 0) * 10) * 10;
    if (e.st === "part" || (e.st === sl.status && e.p === p0)) return [];
    const action: Act = e.st === "done" ? "done" : e.st === "scheduled" ? "not_started" : e.st === "paused" ? "pause" : sl.status === "scheduled" ? "start" : sl.status === "paused" ? "resume" : sl.status === "done" ? "reopen" : "progress";
    return [{ slot: sl, action, progress: e.p / 100 }];
  });
  const parts = rows.flatMap(({ c }) => { const e = ed(c); return e.st === "part" && e.doneLocs.length && e.doneLocs.length < locsOf(c.need).length ? [{ c, doneLocs: e.doneLocs, restDay: e.restDay || c.day, restMach: e.restMach }] : []; });
  const hours = Object.entries(hrs).flatMap(([id, to]) => { const m = machines.find((x) => x.id === id); if (!m) return []; const from = shiftOn(m, asDay); return from && from[0] === to[0] && from[1] === to[1] ? [] : [{ m, day: asDay, from, to }]; });
  const n = changes.length + parts.length + hours.length;
  const times = Array.from({ length: (22 - 4) * 4 + 1 }, (_, i) => 4 * 60 + i * 15);
  const tSel = (v: number, on: (x: number) => void, label: string, min = 0) => <select value={v} aria-label={label} onChange={(e) => on(+e.target.value)}>{times.filter((t) => t >= min).map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select>;
  const stLbl: [CiSt, string][] = [["scheduled", "Not started"], ["running", "Running"], ["paused", "Paused"], ["part", "Part done"], ["done", "Done"]];
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-ci" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Update progress">
        <div className="pp-sheet-h"><b>Update Progress</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="ms-ci-when">
            <b>Where things are</b>
            <div className="rv-seg">{([["now", `Right now · ${clockLong(nowMin)}`], ["at", "At a time…"]] as const).map(([k, l]) => <button key={k} type="button" className={when === k ? "on" : ""} onClick={() => setWhen(k)}>{l}</button>)}</div>
            {when === "at" && <span className="ms-ci-at">
              <select value={atDay} aria-label="Day" onChange={(e) => setAtDay(e.target.value)}>{Array.from({ length: 8 }, (_, i) => addDay(today, i - 1)).map((d) => <option key={d} value={d}>{d === today ? "Today" : d === addDay(today, 1) ? "Tomorrow" : d === addDay(today, -1) ? "Yesterday" : dayLbl(d)}</option>)}</select>
              {tSel(atMin, setAtMin, "Time")}
            </span>}
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>{when === "now" ? "What's happened so far today." : `Where things will be (or were) at ${clockLong(asMin)} ${asDay === today ? "today" : dayLbl(asDay)}, e.g. the plan for lunch.`} Started and finished work stays put; anything not started moves when you re-plan.</div>
          {!byMach.length && <div className="empty">Nothing booked {asDay === today ? "today" : dayLbl(asDay)} on {machines.length === 1 ? "this machine" : "these machines"}.</div>}
          {byMach.map(({ m, rs }) => (
            <div key={m.id} className="ms-ci-m">
              <b className="ms-ci-mh">{shortName(m)}{lead(m) ? <span className="faint"> · {lead(m)}</span> : null}</b>
              {rs.map(({ c, first }) => { const e = ed(c), locs = locsOf(c.need), rest = locs.filter((l) => !e.doneLocs.includes(l)); return (
                <div key={c.key} className={"ms-ci-r " + e.st}>
                  <span className="ms-ci-j"><b>#{c.job.number}</b> {c.job.customer || c.job.name}<small className="faint">{c.need.label}{first ? ` · planned ${clock(first.start)}` : ""}</small></span>
                  <div className="rv-seg">{stLbl.filter(([k]) => k !== "part" || locs.length > 1).map(([k, l]) => <button key={k} type="button" className={e.st === k ? "on" : ""} onClick={() => set(c, { st: k, p: k === "done" ? 100 : k === "scheduled" ? 0 : e.p })}>{l}</button>)}</div>
                  {(e.st === "running" || e.st === "paused") ? <select value={e.p} onChange={(ev) => set(c, { p: +ev.target.value })} aria-label="Done so far">{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => <option key={p} value={p}>{p}% done</option>)}</select> : <span />}
                  {e.st === "part" && <div className="ms-ci-part">
                    <span className="faint">Finished:</span>
                    <div className="ms-pick">{locs.map((l) => { const on = e.doneLocs.includes(l); return <button key={l} type="button" className={on ? "on" : ""} onClick={() => set(c, { doneLocs: on ? e.doneLocs.filter((x) => x !== l) : [...e.doneLocs, l] })}>{on ? "✓ " : ""}{l}</button>; })}</div>
                    {e.doneLocs.length > 0 && rest.length > 0 ? <span className="ms-ci-rest">
                      <span>Still to print: <b>{rest.join(" + ")}</b></span>
                      <select value={e.restDay || c.day} aria-label="Print the rest on" onChange={(ev) => set(c, { restDay: ev.target.value })}>{[...new Set([c.day, ...workDays])].map((d) => <option key={d} value={d}>{d === c.day ? `Next up, ${d === today ? "today" : dayLbl(d)}` : dayLbl(d)}</option>)}</select>
                      <select value={e.restMach} aria-label="On" onChange={(ev) => set(c, { restMach: ev.target.value })}>{machines.filter((x) => fits(subNeed(c.need, rest), x)).map((x) => <option key={x.id} value={x.id}>{shortName(x)}{lead(x) ? ` · ${lead(x)}` : ""}</option>)}</select>
                    </span> : <span className="faint">{e.doneLocs.length ? "That's every location: pick Done instead." : "Tick what's finished."}</span>}
                  </div>}
                </div>
              ); })}
            </div>
          ))}
          <div className="ms-ci-hrs">
            <button type="button" className="ms-band-t" onClick={() => setHrsOpen(!hrsOpen)} aria-expanded={hrsOpen}><span className="car">{hrsOpen ? "▾" : "▸"}</span><b>Update {asDay === today ? "today's" : `${dayLbl(asDay)}'s`} hours</b>{hours.length ? <span className="aa-n">{hours.length}</span> : null}<span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>stay late, come in early, leave early</span></button>
            {hrsOpen && <div className="ms-ci-hl">{machines.map((m) => { const sh = shiftOn(m, asDay), v = hrs[m.id] || sh || typicalShift(m), changed = hours.some((h) => h.m.id === m.id); return (
              <div key={m.id} className={"ms-ci-h" + (changed ? " on" : "")}>
                <span><span><b>{shortName(m)}</b>{lead(m) ? <span className="faint"> · {lead(m)}</span> : null}</span><small className="faint">{sh ? `usually ${clock(sh[0])}–${clock(sh[1])}` : "not running"}</small></span>
                {tSel(v[0], (x) => setHrs((h) => ({ ...h, [m.id]: [x, Math.max(x + 60, v[1])] })), "Starts")}
                <span className="faint">to</span>
                {tSel(v[1], (x) => setHrs((h) => ({ ...h, [m.id]: [v[0], x] })), "Ends", v[0] + 30)}
                {changed ? <button type="button" className="linkbtn" onClick={() => setHrs((h) => { const x = { ...h }; delete x[m.id]; return x; })}>Undo</button> : <span />}
              </div>
            ); })}</div>}
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onSave({ atIso: when === "now" ? null : shopIso(asDay, asMin), changes, parts, hours }); setBusy(false); }}>{n ? `Save ${n} & Re-plan` : "Re-plan From Now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
