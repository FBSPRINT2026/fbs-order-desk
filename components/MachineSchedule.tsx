"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mergeProduction, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, shiftOn, typicalShift, isOffDay, windowsIn, downsOn, breaksOn, lunchStart, LUNCH_EARLIEST, CREW_ROLES, otFromOn, weekOvertime, payWeekStart, type WeekOT, quickNeed, plusWorkdays, minusWorkdays, type QuickJob, condsFor, condSpeed, withIssue, withClock, withCrewHours, type ClockPunch, type EquipRow, type Station, defaultLayout, layoutCounts, flashesOf, flashesFor, stationsNeeded, subNeed, restNeed, locsOf, PV_READY, type Machine, type Crew, type Down, type Need, type ProductionSettings, type Suggestion, type MachineType } from "@/lib/production";
import { mergeSettings, isMe, type Group, type AccountOwner } from "@/lib/pricing";
import { useSticky } from "@/lib/useSticky";
import PressLayout from "@/components/PressLayout";

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
type Job = { key: string; kind: "o" | "a" | "h"; id: string; number: string; customer: string; name: string; due: string | null; qty: number; status: string; needs: Need[]; href: string; owner: string; rush?: boolean; firm?: boolean; dueTime?: number | null };
/** when a job has to be done (absolute minutes): end of its in-hands day, or the set time on a firm date */
const dueAbs = (j: Job) => (j.due ? ord(j.due) * 1440 + (j.dueTime != null ? j.dueTime : 1440) : Infinity);
/** 🔥 rush, ⛰️ firm date */
const flags = (j: Job) => (j.rush || j.firm ? <i className="ms-flags" title={[j.rush ? "Rush" : "", j.firm ? `Firm: needed ${firmLbl(j)}` : ""].filter(Boolean).join(" · ")}>{j.rush ? "🔥" : ""}{j.firm ? "⛰️" : ""}</i> : null);
const firmLbl = (j: Job) => (j.due ? `${new Date(j.due + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}${j.dueTime != null ? " " + clock(j.dueTime) : ""}` : "");
type Slot = { id: string; order_id: string | null; archived_order_id: string | null; /** a Planner hold (a job we know is coming) */ hold_id?: string | null; machine: string; day: string; position: number; minutes: number; start_min: number | null; kind: string; label: string; status: "scheduled" | "running" | "paused" | "done"; source: string; note: string; rolled_from: string | null;
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
type WhenOpt = { m: Machine; start: number; end: number; minutes: number; ot: number; extra?: number; cost?: number; bumped?: { job: Job; late: boolean }[] };
type WhenResult = { need: Need; minutes: number; soonest: WhenOpt | null; aggressive: WhenOpt | null; open: WhenOpt | null; slow: WhenOpt | null; noMachine: boolean };
type Hold = { id: string; name: string; customer: string; spec: QuickJob | Record<string, never>; due_date: string | null; due_time: number | null; notes: string; status: string; created_by: string; created_at: string };
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
// busy intervals: [start, end, the part's place in its job's order] (absolute minutes)
type Busy = Map<string, [number, number, number][]>;
/**
 * `order`: each part's place in its job's order (the front before the sleeves). A part only waits for the parts before
 * it; `prior` is where those were in the last pass (the machines are laid out one at a time, so the calendar makes a few
 * passes until the parts agree). On the `final` pass every part already laid out counts, so nothing ever overlaps.
 */
function flow(cs: Card[], mach: Machine, nowAbs = -Infinity, busy: Busy = new Map(), lunchOut?: Map<string, number>, order: Map<string, number> = new Map(), prior: Busy = new Map(), final = true): Seg[] {
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
    const my = order.get(c.key) ?? 0;
    const jb = [...(busy.get(c.job.key) || []).filter((x) => final || x[2] < my), ...(prior.get(c.job.key) || []).filter((x) => x[2] < my)];
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
    return { t, r, planned, free, blocked };
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
      busy.set(c.job.key, [...(busy.get(c.job.key) || []), [ord(c.day) * 1440 + st, ord(c.day) * 1440 + en, order.get(c.key) ?? 0]]);
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
    const { t, r, planned } = pl;
    const pieces = r.pieces;
    // work laid past a day's lunch settles it
    for (const p of pieces) if (!lunch.has(p.day)) { const L = lunchStart(mach, hrs(p.day)); if (L != null && p.end > L) lunch.set(p.day, L); }
    const pushed = t > planned + 1;
    cursor = r.end;
    busy.set(c.job.key, [...(busy.get(c.job.key) || []), ...pieces.map((p): [number, number, number] => [ord(p.day) * 1440 + p.start, ord(p.day) * 1440 + p.end, order.get(c.key) ?? 0])]);
    pieces.forEach((p, i) => out.push({ c, day: p.day, start: p.start, end: p.end, part: i + 1, parts: pieces.length, pushed: pushed && i === 0, work: p.work, slow: p.slow < 1 ? p.slow : undefined }));
  }
  if (lunchOut) for (const [d, at] of lunch) lunchOut.set(d, at);
  return out;
}

/** Every machine's work laid out on its hours, split into per-day pieces (the calendar, and a re-plan checked before it's applied). */
function layoutAll(cards: Card[], nowAbs: number) {
  const by = new Map<string, Seg[]>(), ofCard = new Map<string, Seg[]>(), lunch = new Map<string, number>();
  const per = new Map<string, Card[]>();
  for (const c of cards) per.set(c.machine.id, [...(per.get(c.machine.id) || []), c]);
  // a job in parts (split by print location, or screen print + embroidery): its parts run in order, one at a time
  const rank = new Map<string, number>(), byJob = new Map<string, Card[]>();
  for (const c of cards) if (c.slot?.status !== "done") byJob.set(c.job.key, [...(byJob.get(c.job.key) || []), c]);
  let multi = false;
  for (const [, cs] of byJob) {
    if (cs.length > 1) multi = true;
    const li = (c: Card) => { const all = c.job.needs.flatMap((n) => locsOf(n)), l = c.slot?.locations?.[0]; return l ? Math.max(0, all.indexOf(l)) : 0; };
    cs.sort((a, b) => (a.slot?.status === "running" ? 0 : 1) - (b.slot?.status === "running" ? 0 : 1) || a.day.localeCompare(b.day) || li(a) - li(b) || a.need.type.localeCompare(b.need.type) || a.key.localeCompare(b.key)).forEach((c, i) => rank.set(c.key, i));
  }
  let prior = new Map() as Busy, out: [Card[], Seg[], Map<string, number>][] = [];
  for (let pass = 0, n = multi ? 3 : 1; pass < n; pass++) {
    const busy = new Map() as Busy; out = [];
    for (const [, cs] of per) { const ln = new Map<string, number>(); out.push([cs, flow(cs, cs[0].machine, nowAbs, busy, ln, rank, prior, pass === n - 1), ln]); }
    prior = busy;
  }
  for (const [cs, gs, ln] of out) {
    for (const g of gs) { const k = g.c.machine.id + "|" + g.day; by.set(k, [...(by.get(k) || []), g]); ofCard.set(g.c.key, [...(ofCard.get(g.c.key) || []), g]); }
    for (const [d, at] of ln) lunch.set(cs[0].machine.id + "|" + d, at);
  }
  return { by, ofCard, lunch };
}

export default function MachineSchedule() {
  const [now, setNow] = useState(() => shopTime(new Date())!);
  useEffect(() => { const t = setInterval(() => setNow(shopTime(new Date())!), 60000); return () => clearInterval(t); }, []);
  const today = now.day;
  const [sBase, setS] = useState<ProductionSettings | null>(null);
  // the time clock (uAttend, or our own clock): today's punches of each press crew's operator, checked every minute
  const [tc, setTc] = useState<{ ok: boolean; punches: ClockPunch[]; ranAt: string | null; tracked: string[]; worked: Record<string, { worked: number; missing: boolean }>; names: Record<string, string> }>({ ok: false, punches: [], ranAt: null, tracked: [], worked: {}, names: {} });
  useEffect(() => {
    // every crew member (operator, assistant, catcher): the operator starts the press; everyone's hours count toward overtime
    const ids = [...new Set((sBase?.crews || []).flatMap((c) => [c.members?.operator, c.members?.assistant, c.members?.catcher]).filter(Boolean))] as string[];
    if (!ids.length) return;
    let live = true;
    const get = async () => {
      const sb = createClient(), nowT = shopTime(new Date())!, day = nowT.day, ws = payWeekStart(day);
      // two weeks back: an operator with no punches in that time doesn't use the clock, so the schedule doesn't wait on them
      const from = new Date(Date.parse(addDay(ws < addDay(day, -14) ? ws : addDay(day, -14), -1) + "T00:00:00Z")).toISOString();
      const [{ data: p }, { data: st }, { data: em }] = await Promise.all([
        sb.from("time_punches").select("employee_id, kind, at, source").in("employee_id", ids).eq("voided", false).gte("at", from).order("at").limit(5000),
        sb.from("uattend_sync").select("last_ok_at").eq("id", 1).maybeSingle(),
        sb.from("employees").select("id, first_name").in("id", ids),
      ]);
      if (!live) return;
      const all = ((p || []) as { employee_id: string; kind: ClockPunch["kind"]; at: string; source: string }[]).map((x) => ({ ...x, t: shopTime(x.at)! }));
      const tracked = [...new Set(all.filter((x) => x.t.day >= addDay(day, -14)).map((x) => x.employee_id))], rows = all.filter((x) => x.t.day === day);
      // hours worked this pay week (Friday on), pair by pair; a shift left open on an earlier day isn't counted (missing punch)
      const worked: Record<string, { worked: number; missing: boolean }> = {}, nowAbs = ord(day) * 1440 + nowT.min;
      // lunch isn't punched here: like the schedule, a stretch longer than the lunch rule's hours loses the unpaid lunch.
      // A day left open (no clock-out) counts to the end of that crew's shift, and is flagged.
      const brk = sBase!.breaks, lunchAfter = (brk.lunchAfterHours || 8) * 60, lunch = brk.lunchMin || 0;
      const endOf = (id: string, d: string) => { const c = sBase!.crews.find((k) => k.members && Object.values(k.members).includes(id)); const m = c && sBase!.machines.find((x) => x.crew === c.id); const sh = m && shiftOn(m, d); return sh ? sh[1] : null; };
      const span = (a: number, b: number) => { const len = Math.max(0, b - a); return len > lunchAfter ? len - lunch : len; };
      for (const id of ids) {
        const ps = all.filter((x) => x.employee_id === id && x.t.day >= ws);
        if (!ps.length) continue;
        let open: { at: number; day: string; min: number } | null = null, tot = 0, missing = false;
        const close = () => { if (!open) return; const e = endOf(id, open.day); tot += span(open.at, ord(open.day) * 1440 + (e != null && e > open.min ? e : open.min + 9 * 60)); missing = true; open = null; };
        for (const x of ps) {
          const a = ord(x.t.day) * 1440 + x.t.min, isIn = x.kind === "in" || x.kind === "break_end";
          if (isIn) { if (open && open.day !== x.t.day) close(); else if (open) { missing = true; } open = { at: a, day: x.t.day, min: x.t.min }; }
          else if (open) { tot += span(open.at, a); open = null; }
        }
        if (open) { if (open.day === day) tot += span(open.at, nowAbs); else close(); }
        worked[id] = { worked: tot, missing };
      }
      const okAt = (st?.last_ok_at as string | null) || null;
      // trust "not clocked in" only while the clock is reporting: uAttend synced in the last 15 minutes, or someone used our own clock today
      const ok = (!!okAt && Date.now() - Date.parse(okAt) < 15 * 60000) || rows.some((x) => x.source !== "uattend");
      const names = Object.fromEntries(((em || []) as { id: string; first_name: string }[]).map((x) => [x.id, x.first_name]));
      setTc({ ok, punches: rows.map((x) => ({ employee_id: x.employee_id, kind: x.kind, min: x.t.min })), ranAt: okAt, tracked, worked, names });
    };
    get(); const t = setInterval(get, 60000);
    return () => { live = false; clearInterval(t); };
  }, [sBase]);
  const clockBucket = Math.floor(now.min / 5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => {
    if (!sBase) return sBase;
    const withTc = tc.ok ? withClock(sBase, tc.punches, today, now.min, 5, new Set(tc.tracked), tc.names) : sBase;
    return Object.keys(tc.worked).length ? withCrewHours(withTc, tc.worked, tc.names, today, now.min) : withTc;
  }, [sBase, tc, today, clockBucket]);
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
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(""), Math.min(20000, 6000 + msg.length * 45)); return () => clearTimeout(id); }, [msg]);
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
  // Re-plan sends a crew home at 40 hours when every job still makes its date without the overtime
  const [replanNoOT, setReplanNoOT] = useSticky("cal.replanNoOT", true);
  const [replanBusy, setReplanBusy] = useState(false);
  const [checkin, setCheckin] = useState(false);
  const [renorm, setRenorm] = useState(false);
  const [otOpen, setOtOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [equip, setEquip] = useState<EquipRow[]>([]);
  const [eqOpen, setEqOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [advise, setAdvise] = useState<null | { opts: WhatIf[]; late: { job: string; customer: string; inHands: string; why: string }[]; lateBefore: number }>(null);
  // the "schedule too tight" prompt shows once a day (again if more jobs go late)
  const [toolsOpen, setToolsOpen] = useSticky("cal.toolsOpen", true);
  const [tightOpen, setTightOpen] = useSticky("cal.tightOpen", false);
  // Re-plan results for the calendar as it is (the Re-plan window asks on every redraw): worked out again when anything changes
  const planCache = useRef<{ deps: unknown[]; v: Map<boolean, unknown> }>({ deps: [], v: new Map() });

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: st }, { data: o }, { data: a }, { data: sl0 }, { data: off0 }, { data: ex0 }, { data: ho0 }] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups, lines, rush, firm, due_time").in("status", ["approved", "art", "blanks", "production"]).limit(300),
      // Printavo jobs are left off the calendar (it plans our own orders only); nothing in Printavo is read or changed here
      Promise.resolve({ data: [] as unknown[] }),
      sb.from("production_slots").select("*").or("order_id.not.is.null,hold_id.not.is.null").gte("day", addDay(today, -21)).lte("day", addDay(today, 70)),
      sb.from("production_days_off").select("id, crew_id, machine, day, note, start_min, end_min, capacity, employee").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
      sb.from("production_extra_shifts").select("id, machine, crew_id, day, start_min, end_min, note").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
      sb.from("production_holds").select("*").eq("status", "planned").order("due_date"),
    ]);
    // Equipment Status: presses running with heads out, slow, or down
    const { data: eq0 } = await sb.from("production_equipment").select("*");
    const eqList = (eq0 || []) as EquipRow[];
    setEquip(eqList);
    const exList = (ex0 || []) as Extra[];
    setExtras(exList);
    const offList = (off0 || []) as DayOff[];
    setOffs(offList);
    let sl = (sl0 || []) as Slot[];
    // not marked done by the end of its day → it moves forward to today (first in line), remembering where it started
    const stale = sl.filter((x) => (x.order_id || x.hold_id) && x.day < today && x.status !== "done");
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
      return withIssue({ ...m, off, down, extra }, eqList.find((e) => e.machine === m.id), today);
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
      setIsAdmin(["owner", "admin"].includes((sf?.role as string) || ""));
      if (["owner", "admin"].includes((sf?.role as string) || "")) {
        const [{ data: pr }, { data: em }] = await Promise.all([sb.from("employee_pay").select("employee_id, rate"), sb.from("employees").select("id, first_name, last_name")]);
        setPay({ rates: Object.fromEntries(((pr || []) as { employee_id: string; rate: number | null }[]).filter((x) => x.rate != null).map((x) => [x.employee_id, +x.rate!])), names: Object.fromEntries(((em || []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, `${x.first_name} ${x.last_name}`.trim()])) });
      }
    }
    const js: Job[] = [
      ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null; groups: Group[]; lines: never[]; rush?: boolean; firm?: boolean; due_time?: number | null }[]).map((x) => ({ rush: !!x.rush, firm: !!x.firm || x.due_time != null, dueTime: x.due_time ?? null, key: "o:" + x.id, kind: "o" as const, id: x.id, number: String(x.number), customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status, needs: needsForOrder(ps, x as never), href: `/shop/orders/${x.id}`, owner: own.get(x.customer_id || "") || "" })),
      ...pv.map((x) => ({ key: "a:" + x.id, kind: "a" as const, id: x.id, number: x.visual_id, customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status_name, needs: needsForPrintavo(ps, { qty: x.qty, status_name: x.status_name, nickname: x.nickname, data: { groups: x.pvgroups as never } }), href: `/shop/archive/${x.id}`, owner: "" })),
      // Planner holds: jobs we know are coming, holding time before there's an order
      ...((ho0 || []) as Hold[]).map((h) => ({ key: "h:" + h.id, kind: "h" as const, id: h.id, number: "PLAN", customer: h.customer || "Planned", name: h.name || "Planned job", due: h.due_date, dueTime: h.due_time, firm: h.due_time != null, qty: +(h.spec as QuickJob)?.qty || 0, status: "planned", needs: [quickNeed(ps, h.spec as QuickJob)], href: "", owner: "" })),
    ];
    setHolds((ho0 || []) as Hold[]);
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
  const slotKey = (x: { order_id: string | null; archived_order_id: string | null; hold_id?: string | null }) => (x.hold_id ? "h:" + x.hold_id : x.order_id ? "o:" + x.order_id : "a:" + x.archived_order_id);
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
      // live estimate: follows the press crew's speed sliders and the time standards as they change
      const est = estimate(s, need, mach).minutes || sl.minutes, prog = Math.max(0, Math.min(1, +(sl.progress || 0)));
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
  const segs = useMemo(() => (s ? layoutAll(cards, ord(now.day) * 1440 + now.min) : { by: new Map<string, Seg[]>(), ofCard: new Map<string, Seg[]>(), lunch: new Map<string, number>() }), [cards, s, now]);
  const at = (m: Machine, d: string) => segs.by.get(m.id + "|" + d) || [];
  // when each crew goes into overtime that day (cached until the settings / hours change)
  const otCache = useMemo(() => new Map<string, number | null>(), [s]);
  const otOn = (m: Machine, d: string) => { const k = m.id + "|" + d; if (!otCache.has(k)) otCache.set(k, otFromOn(m, d)); return otCache.get(k)!; };
  const inOT = (g: Seg) => { const oa = otOn(g.c.machine, g.day); return oa != null && g.end > oa + 1; };
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
    // booked on a press that can't run it right now (heads out: Equipment Status)
    for (const c of cards) if (c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !fits(c.need, c.machine) && !seen.has(c.job.key) && (!typeF || c.need.type === typeF)) { seen.add(c.job.key); out.push({ job: c.job, why: `${whyUnfit(c.need, c.machine)}${c.machine.issue ? " (Equipment Status)" : ""}` }); }
    for (const c of cards) {
      if (!c.job.due || c.slot?.status === "done" || seen.has(c.job.key) || (typeF && c.need.type !== typeF)) continue;
      const gs = segs.ofCard.get(c.key) || [], lastAbs = gs.reduce((t, g) => Math.max(t, ord(g.day) * 1440 + g.end), 0), last = gs.reduce((d, g) => (g.day > d ? g.day : d), "");
      if (lastAbs > dueAbs(c.job) && c.job.due >= today) { seen.add(c.job.key); out.push({ job: c.job, why: c.job.firm && c.job.dueTime != null && last === c.job.due ? `finishes ${clock(lastAbs % 1440)}, firm ${firmLbl(c.job)}` : `finishes ${dayLbl(last)}, ${c.job.firm ? "firm" : "in-hands"} ${c.job.firm ? firmLbl(c.job) : dayLbl(c.job.due)}` }); }
    }
    return out;
  }, [tray, cards, segs, today, typeF]);

  async function book(job: Job, need: Need, machine: Machine, d: string, source = "manual", slot?: Slot | null, startMin: number | null = null) {
    if (!s) return;
    if (!fits(need, machine)) { setMsg(`#${job.number} ${whyUnfit(need, machine)}.`); return; }
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
  type OtCut = { m: Machine; day: string; start: number; end: number };
  const planIt = (allowSplit = false, ms: Machine[] = machines): PlanResult & { otCuts: OtCut[] } => {
    if (ms !== machines) return { ...planFresh(allowSplit, ms), otCuts: [] };
    const deps = [cards, segs, tray, tight, replanTray, replanNoOT, typeF, now, s], pc = planCache.current;
    if (deps.length !== pc.deps.length || deps.some((d, i) => d !== pc.deps[i])) { pc.deps = deps; pc.v = new Map(); }
    if (!pc.v.has(allowSplit)) pc.v.set(allowSplit, planAvoidingOT(allowSplit));
    return pc.v.get(allowSplit) as PlanResult & { otCuts: OtCut[] };
  };
  /**
   * Overtime check on a re-plan: for each press crew going past 40 hours (this pay week and next), try sending them home
   * when they hit 40 instead (after any work that's already running or can't move). Keep it when no job that makes its
   * date with the overtime would miss it without; crew by crew, so one crew's overtime can go even if another's is needed.
   */
  const planAvoidingOT = (allowSplit: boolean): PlanResult & { otCuts: OtCut[] } => {
    const base = planFresh(allowSplit, machines);
    if (!replanNoOT) return { ...base, otCuts: [] };
    const nowAbs = ord(today) * 1440 + now.min, cuts = new Map<string, OtCut[]>();
    for (const m of machines) {
      if (!m.crew) continue;
      for (let i = 0, d = today; i < 14; i++, d = addDay(d, 1)) {
        const oa = otOn(m, d), sh = shiftOn(m, d); if (oa == null || !sh) continue;
        // work that stays put that day (running, done, firm, a Planner hold) keeps its time
        const stuck = cards.filter((c) => c.machine.id === m.id && (c.slot?.status === "running" || c.slot?.status === "done" || !!c.job.firm || c.job.kind === "h")).flatMap((c) => segs.ofCard.get(c.key) || []).filter((g) => g.day === d).reduce((t, g) => Math.max(t, g.end), 0);
        const start = Math.ceil(Math.max(oa, stuck, d === today ? nowAbs - ord(d) * 1440 : 0) / 15) * 15;
        if (start < sh[1] - 5) cuts.set(m.id, [...(cuts.get(m.id) || []), { m, day: d, start, end: sh[1] }]);
      }
    }
    if (!cuts.size) return { ...base, otCuts: [] };
    const withCuts = (list: OtCut[]) => machines.map((m) => { const mine = list.filter((x) => x.m.id === m.id); if (!mine.length) return m; const down = { ...(m.down || {}) }; for (const x of mine) down[x.day] = [...(down[x.day] || []), [x.start, x.end, "Leaving early (no overtime)", 0]]; return { ...m, down }; });
    const ok = (p: PlanResult) => [...p.lateKeys].every((k) => base.lateKeys.has(k));
    const all = [...cuts.values()].flat(), pAll = planFresh(allowSplit, withCuts(all), base.how);
    if (ok(pAll)) return { ...pAll, otCuts: all };
    let keep: OtCut[] = [], best = base;
    for (const [, list] of cuts) { const p = planFresh(allowSplit, withCuts([...keep, ...list]), base.how); if (ok(p)) { keep = [...keep, ...list]; best = p; } }
    return { ...best, otCuts: keep };
  };
  const planFresh = (allowSplit: boolean, ms: Machine[], only?: string) => {
    const nowAbs = ord(today) * 1440 + now.min;
    // a machine's open time: its shift less breaks and downtime, and less the work that stays put (running, done, firm)
    const winsOf = (m: Machine, d: string) => { const sh = shiftOn(m, d); if (!sh) return []; const fx = (fixed.get(m.id + "|" + d) || []).map(([a, b]): Down => [a, b, "Booked", 0]); return windowsIn(sh, [...downsOn(m, d, sh), ...fx]); };
    const norm = (m: Machine, t: number) => { for (let g = 0; g < 120; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y); if (!w) { t = (dd + 1) * 1440; continue; } return mm < w[0] ? dd * 1440 + w[0] : t; } return t; };
    // when each crew goes into overtime (past 40 paid hours, Friday–Thursday), per machine copy and day
    const otc = new WeakMap<Machine, Map<string, number | null>>();
    const otAt = (m: Machine, d: string) => { let c = otc.get(m); if (!c) otc.set(m, (c = new Map())); if (!c.has(d)) c.set(d, otFromOn(m, d)); return c.get(d)!; };
    const run = (m: Machine, t0: number, minutes: number) => {
      let t = norm(m, t0); let left = minutes, ot = 0;
      // like the calendar: a longer job doesn't start in the last few minutes of a stretch, it starts in the next one
      { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y); if (w && w[1] - mm < 10 && left / w[2] > w[1] - mm) t = norm(m, dd * 1440 + w[1]); }
      const start = t;
      for (let g = 0; g < 400 && left > 0.01; g++) { const dd = Math.floor(t / 1440), mm = t - dd * 1440, w = winsOf(m, fromOrd(dd)).find(([, y]) => mm < y)!; if (!w) { t = norm(m, t); continue; } const end = Math.min(mm + left / w[2], w[1]); const oa = otAt(m, fromOrd(dd)); if (oa != null) ot += Math.max(0, end - Math.max(mm, oa)); left -= (end - mm) * w[2]; t = left > 0.01 ? norm(m, dd * 1440 + end) : dd * 1440 + end; }
      return { start, end: t, ot };
    };
    // the calendar runs each press's jobs one after another, so a job never runs around work that stays put (it fits
    // in the open time before it or goes after it), and one job's parts never run at the same time on two machines
    const sim = (m: Machine, t0: number, minutes: number, job?: string) => {
      let from = t0, r = run(m, from, minutes);
      for (let k = 0; k < 400; k++) {
        const hit = (fixedAbs.get(m.id) || []).find(([a]) => a >= r.start && a < r.end - 0.5) || (job ? (jobBusy.get(job) || []).find(([a, b]) => a < r.end - 0.5 && b > r.start + 0.5) : undefined);
        if (!hit) break;
        from = hit[1]; r = run(m, from, minutes);
      }
      return r;
    };
    // not started yet (or paused partway): free to move. Running and done work stays where it is.
    // a firm job (⛰️) that's on course for its date and time stays exactly where it is (unless its press can't print it now)
    const firmHolds = (c: Card) => !!c.job.firm && fits(c.need, c.machine) && (segs.ofCard.get(c.key) || []).reduce((t, g) => Math.max(t, ord(g.day) * 1440 + g.end), 0) <= dueAbs(c.job);
    const movable = cards.filter((c) => c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !c.fromPv && c.day >= today && (!typeF || c.machine.type === typeF) && !firmHolds(c) && c.job.kind !== "h");
    // work that stays where it is (running, done, a firm job on course, other machine types) is an obstacle on its
    // machine, not a wall: open time before and between it is still used (a firm job on Thursday doesn't empty Wednesday)
    let fixed = new Map<string, [number, number][]>(), fixedAbs = new Map<string, [number, number][]>(), jobBusy = new Map<string, [number, number][]>();
    const push = (mp: Map<string, [number, number][]>, k: string, v: [number, number]) => mp.set(k, [...(mp.get(k) || []), v]);
    const reset = () => {
      fixed = new Map(); fixedAbs = new Map(); jobBusy = new Map();
      for (const c of cards) if (!movable.includes(c)) for (const g of segs.ofCard.get(c.key) || []) if (g.day >= today) {
        const k = c.machine.id + "|" + g.day, a = ord(g.day) * 1440 + g.start, b = ord(g.day) * 1440 + g.end;
        push(fixed, k, [g.start, g.end]); push(fixedAbs, c.machine.id, [a, b]);
        if (c.slot?.status !== "done") push(jobBusy, c.job.key, [a, b]);
      }
    };
    // each job placed takes its time on the press: later jobs fill the open time around it (like the calendar's line)
    const occupy = (id: string, a: number, b: number) => {
      const added: [string, [number, number]][] = [];
      for (let d = Math.floor(a / 1440); d * 1440 < b; d++) { const x: [number, number] = [Math.max(a, d * 1440) - d * 1440, Math.min(b, d * 1440 + 1440) - d * 1440]; const k = id + "|" + fromOrd(d); push(fixed, k, x); added.push([k, x]); }
      const ab: [number, number] = [a, b]; push(fixedAbs, id, ab);
      return () => { for (const [k, x] of added) fixed.set(k, (fixed.get(k) || []).filter((y) => y !== x)); fixedAbs.set(id, (fixedAbs.get(id) || []).filter((y) => y !== ab)); };
    };
    type Item = { key: string; job: Job; need: Need; slot: Slot | null; cur: string; curDay: string; left: number };
    const items: Item[] = [
      ...movable.map((c) => ({ key: c.key, job: c.job, need: c.need, slot: c.slot, cur: c.machine.id, curDay: c.day, left: 1 - Math.max(0, Math.min(1, +(c.slot?.progress || 0))) })),
      ...(replanTray ? tray.map((t) => ({ key: "t:" + t.job.key + t.need.type, job: t.job, need: t.need, slot: null, cur: "", curDay: "", left: 1 })) : []),
    ].sort((a, b) => dueAbs(a.job) - dueAbs(b.job) || +!!b.job.firm - +!!a.job.firm || +!!b.job.rush - +!!a.job.rush || (a.curDay || "9999").localeCompare(b.curDay || "9999"));
    const lateOld = new Set(tight.map((t) => t.job.key));
    type Out = { it: Item; mach: Machine; day: string; startAbs: number; endAbs: number; end: string; minutes: number; late: boolean; locs: string[] | null; part: number; parts: number };
    const endDayOf = (t: number) => fromOrd(Math.floor((t - 1) / 1440));
    // the machine that finishes this work earliest, given where each machine's day is up to; among the ones that
    // make the in-hands date, the one that runs the least of it on overtime (a crew past 40 hours this pay week)
    const bestFor = (need: Need, left: number, from: number, prefer: string, due = Infinity, job?: string) => {
      let best: { m: Machine; start: number; end: number; minutes: number; ot: number } | null = null;
      const late = (t: number) => t > due;
      for (const m of s.machines.filter((x) => x.active && fits(need, x))) {
        const mm = ms.find((x) => x.id === m.id) || m; // the calendar's copy carries days off, downtime and extra shifts
        const minutes = Math.max(15, estimate(s, need, mm).minutes * left), r = sim(mm, from, minutes, job);
        const sooner = !best || r.end < best.end - 30 || (Math.abs(r.end - best.end) <= 30 && (mm.id === prefer || (best.m.id !== prefer && (need.type === "screen" ? mm.colors < best.m.colors : false))));
        const better = !best || (late(r.end) !== late(best.end) ? !late(r.end) : !late(r.end) && Math.abs(r.ot - best.ot) > 10 ? r.ot < best.ot : sooner);
        if (better) best = { m: mm, start: r.start, end: r.end, minutes, ot: r.ot };
      }
      return best;
    };
    // one try at the plan: the jobs in this order, each placed where it finishes soonest, then checked on the calendar
    const attempt = (order: Item[]) => {
    reset();
    const out: Out[] = [], skipped: Item[] = [];
    let splits = 0;
    for (const it of order) {
      const best = bestFor(it.need, it.left, nowAbs, it.cur, dueAbs(it.job), it.job.key);
      if (!best) { skipped.push(it); continue; }
      const locs = locsOf(it.need);
      // won't make it in one piece: try the print locations separately (fronts on one press, backs on another / the next day)
      // only when allowed (the schedule is tight and someone said OK): splitting costs efficiency (shared screens, one setup)
      if (allowSplit && best.end > dueAbs(it.job) && locs.length > 1 && it.left >= 0.999) {
        const undo: (() => void)[] = [], parts: { need: Need; b: NonNullable<ReturnType<typeof bestFor>>; l: string }[] = [];
        // each extra run costs another setup: re-registering and ink changes, about 15 minutes
        // one part after another: the same shirts can't be on two presses at once
        let prevEnd = nowAbs;
        for (const [i, l] of locs.entries()) {
          const sn = subNeed(it.need, [l]);
          const b = bestFor(sn, 1, prevEnd, it.cur, dueAbs(it.job), it.job.key); if (!b) { parts.length = 0; break; }
          if (i > 0) { const r = sim(b.m, b.start, b.minutes + 15, it.job.key); b.start = r.start; b.end = r.end; b.minutes += 15; }
          undo.push(occupy(b.m.id, b.start, b.end)); prevEnd = b.end; parts.push({ need: sn, b, l });
        }
        const splitEnd = Math.max(...parts.map((p) => p.b.end));
        if (parts.length > 1 && splitEnd < best.end - 30) {
          splits++;
          for (const pt of parts) push(jobBusy, it.job.key, [pt.b.start, pt.b.end]);
          parts.forEach((p, i) => out.push({ it, mach: p.b.m, day: fromOrd(Math.floor(p.b.start / 1440)), startAbs: p.b.start, endAbs: p.b.end, end: endDayOf(p.b.end), minutes: p.b.minutes, late: splitEnd > dueAbs(it.job), locs: [p.l], part: i + 1, parts: parts.length }));
          continue;
        }
        undo.forEach((f) => f());
      }
      occupy(best.m.id, best.start, best.end); push(jobBusy, it.job.key, [best.start, best.end]);
      out.push({ it, mach: best.m, day: fromOrd(Math.floor(best.start / 1440)), startAbs: best.start, endAbs: best.end, end: endDayOf(best.end), minutes: best.minutes, late: best.end > dueAbs(it.job), locs: it.slot?.locations?.length ? it.slot.locations : locsFor(it.job, it.need), part: 1, parts: 1 });
    }
    // each press/day numbered in start-time order, with the work that stays put and hasn't started (a firm job on
    // course, a Planner hold) keeping its place in the line, so the calendar lays things out where the plan put them
    const planned = new Set(out.map((o) => o.it.slot?.id).filter(Boolean));
    const stay = cards.filter((c) => c.slot && !c.fromPv && (c.slot.status === "scheduled" || c.slot.status === "paused") && !planned.has(c.slot.id) && out.some((o) => o.mach.id === c.machine.id))
      .map((c) => { const g = (segs.ofCard.get(c.key) || [])[0]; return g ? { c, day: g.day, startAbs: ord(g.day) * 1440 + g.start } : null; }).filter(Boolean) as { c: Card; day: string; startAbs: number }[];
    const pos: Record<string, number> = {};
    const rows = [...out.map((o) => ({ o, st: undefined as (typeof stay)[number] | undefined, mach: o.mach.id, day: o.day, startAbs: o.startAbs, position: 0 })), ...stay.map((x) => ({ o: undefined as Out | undefined, st: x, mach: x.c.machine.id, day: x.day, startAbs: x.startAbs, position: 0 }))]
      .sort((a, b) => a.startAbs - b.startAbs);
    for (const r of rows) r.position = pos[r.mach + r.day] = (pos[r.mach + r.day] ?? -1) + 1;
    // check it before anyone applies it: lay the plan out exactly as the calendar will, and take the finish times and
    // the late count from that (not from the estimate above), so the numbers shown are the numbers you'll get
    const swapM = (c: Card): Card => (ms === machines ? c : { ...c, machine: ms.find((x) => x.id === c.machine.id) || c.machine });
    const moved = new Set(movable.map((c) => c.key)), restacked = new Set(stay.map((x) => x.c.key));
    const virt: Card[] = cards.filter((c) => !moved.has(c.key) && !restacked.has(c.key)).map(swapM);
    const vOf = new Map<Out, string>();
    for (const r of rows) {
      if (r.st) { const c = swapM(r.st.c); virt.push({ ...c, day: r.day, slot: { ...c.slot!, day: r.day, position: r.position } }); continue; }
      const o = r.o!, key = "plan:" + o.it.key + ":" + o.part, need = o.parts > 1 ? subNeed(o.it.need, o.locs) : o.it.need;
      const base = o.it.slot || ({ id: key, order_id: null, archived_order_id: null, hold_id: null, kind: o.it.need.type, label: "", status: "scheduled", source: "replan", note: "", rolled_from: null, progress: 0 } as unknown as Slot);
      vOf.set(o, key);
      virt.push({ key, job: o.it.job, need, machine: o.mach, day: o.day, minutes: o.minutes, startMin: null, slot: { ...base, id: key, machine: o.mach.id, day: o.day, position: r.position, start_min: null, locations: o.locs, status: base.status === "paused" ? "paused" : "scheduled" }, fromPv: false });
    }
    const L = layoutAll(virt, nowAbs), endOf = (k: string) => (L.ofCard.get(k) || []).reduce((t, g) => Math.max(t, ord(g.day) * 1440 + g.end), 0);
    const jobEnd = new Map<string, number>();
    for (const c of virt) if (c.slot?.status !== "done") jobEnd.set(c.job.key, Math.max(jobEnd.get(c.job.key) || 0, endOf(c.key)));
    for (const o of out) { const e = endOf(vOf.get(o)!); if (e) { o.endAbs = e; o.end = endDayOf(e); } o.late = (jobEnd.get(o.it.job.key) || o.endAbs) > dueAbs(o.it.job); }
    const lateJobs = new Set<string>([...skipped.map((x) => x.job.key), ...(replanTray ? [] : tray.filter((t) => !t.sug || t.sug.late).map((t) => t.job.key))]);
    for (const c of virt) if (c.job.due && c.job.due >= today && c.slot?.status !== "done" && (!typeF || c.need.type === typeF) && (jobEnd.get(c.job.key) || 0) > dueAbs(c.job)) lateJobs.add(c.job.key);
    const moves = out.filter((o) => !o.it.slot || o.parts > 1 || o.mach.id !== o.it.cur || o.day !== o.it.curDay);
    const tardy = [...jobEnd].reduce((t, [k, e]) => { const j = byKey.get(k); return t + (j?.due && j.due >= today ? Math.max(0, e - dueAbs(j)) : 0); }, 0);
    return { out, rows, moves, skipped, splits, lateBefore: lateOld.size, lateAfter: lateJobs.size, lateKeys: lateJobs, added: out.filter((o) => !o.it.slot && o.part === 1).length, tardy };
    };
    // soonest in-hands date first; then, when some would be late anyway, try letting those wait until the jobs that can
    // still make their dates are done (fewer late jobs), and keep whichever plan leaves fewer late
    const better = (a: ReturnType<typeof attempt>, b: ReturnType<typeof attempt>) => a.lateAfter < b.lateAfter || (a.lateAfter === b.lateAfter && a.tardy < b.tardy);
    // `only`: just the way of ordering that won last time (the overtime check re-runs the plan a few times)
    const edd = only === "current" ? null : attempt(items);
    let best = edd ? { ...edd, how: "edd" } : null;
    for (let k = 0; edd && (!only || only === "defer") && k < 2 && best!.lateAfter > 0; k++) {
      const lk = best!.lateKeys, alt = attempt([...items.filter((i) => !lk.has(i.job.key)), ...items.filter((i) => lk.has(i.job.key))]);
      if (better(alt, best!) || only === "defer") best = { ...alt, how: "defer" }; else break;
    }
    // and the order the jobs are in now (just tightened up, onto whichever press frees up first): the way things are
    // lined up can beat re-sorting by date, so a re-plan never leaves more jobs late than keeping the current order would
    if ((!only && best!.lateAfter > 0) || only === "current") {
      const at0 = (it: Item) => { const c = cards.find((x) => x.key === it.key); const g = c && (segs.ofCard.get(c.key) || [])[0]; if (g) return ord(g.day) * 1440 + g.start; const t = tray.find((x) => "t:" + x.job.key + x.need.type === it.key); return t?.sug ? ord(t.sug.day) * 1440 + 1439 : dueAbs(it.job); };
      const alt = attempt([...items].sort((a, b) => at0(a) - at0(b)));
      if (!best || better(alt, best)) best = { ...alt, how: "current" };
    }
    return best!;
  };
  type PlanResult = ReturnType<typeof planFresh>;
  async function applyPlan(p: ReturnType<typeof planIt>) {
    setReplanBusy(true);
    const sb = createClient();
    const ups: Promise<unknown>[] = [], ins: Record<string, unknown>[] = [];
    for (const row of p.rows) {
      const position = row.position;
      if (row.st) { const sl = row.st.c.slot!; if (sl.position !== position || sl.day !== row.day) ups.push(Promise.resolve(sb.from("production_slots").update({ position, day: row.day, updated_at: new Date().toISOString() }).eq("id", sl.id))); continue; }
      const o = row.o!;
      const lbl = o.parts > 1 ? subNeed(o.it.need, o.locs).label : o.it.need.label;
      if (o.it.slot && o.part === 1) ups.push(Promise.resolve(sb.from("production_slots").update({ machine: o.mach.id, day: o.day, minutes: o.minutes, start_min: null, position, rolled_from: null, label: lbl, locations: o.locs, updated_at: new Date().toISOString() }).eq("id", o.it.slot.id)));
      else ins.push({ order_id: o.it.job.kind === "o" ? o.it.job.id : null, archived_order_id: o.it.job.kind === "a" ? o.it.job.id : null, machine: o.mach.id, day: o.day, minutes: o.minutes, start_min: null, position, kind: o.it.need.type, label: lbl, source: "replan", status: "scheduled", locations: o.locs });
    }
    await Promise.all(ups);
    if (ins.length) await sb.from("production_slots").insert(ins);
    // the crews sent home at 40 hours: an early finish, like Cut Unused Overtime
    const cuts = (p as { otCuts?: OtCut[] }).otCuts || [];
    if (cuts.length) await sb.from("production_days_off").insert(cuts.map((x) => ({ machine: x.m.id, crew_id: null, day: x.day, start_min: x.start, end_min: x.end, capacity: 0, employee: "", note: "Leaving early (no overtime)", created_by: me.email })));
    setReplanBusy(false); setReplan(null);
    setMsg(`Re-planned: ${p.moves.length} job${p.moves.length === 1 ? "" : "s"} moved${p.added ? ` (${p.added} booked from Ready To Schedule)` : ""}. Late: ${p.lateBefore} → ${p.lateAfter}.${cuts.length ? ` Overtime avoided: ${fmtMin(cuts.reduce((t, x) => t + x.end - x.start, 0))} (${[...new Set(cuts.map((x) => crewOf(x.m)?.leader || shortName(x.m)))].join(", ")} leave at 40 hours).` : ""}`);
    load();
  }
  // Equipment Status problems on the machines in view
  const eqIssues = s.machines.filter((m) => m.issue && m.active && (!typeF || m.type === typeF));
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
    const c = g.c, late = ord(g.day) * 1440 + g.end > dueAbs(c.job);
    return "ms-blk " + c.need.type + (c.job.kind === "h" ? " hold" : "") + (inOT(g) ? " ot" : "") + (c.job.firm ? " is-firm" : "") + (c.job.rush ? " is-rush" : "") + (mine && !isMe(c.job.owner, owners, me) ? " other" : "") + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "") + (g.part > 1 ? " cont-l" : "") + (g.part < g.parts ? " cont-r" : "");
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
              <div key={m.id + w} className={"ms-wg-m " + m.type} title={`${m.name}: ${fmtMin(wkUsed)} of ${fmtMin(wkCap)} booked`}><b>{shortName(m)}<IssueTag m={m} />{crewOf(m) ? <span className="ms-op"> · {crewOf(m)!.leader}</span> : null}</b><small>{m.type === "screen" ? `${m.colors}C` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat"} · <span className="ms-used">{Math.round(wkUsed / 60)}/{Math.round(wkCap / 60)}h</span></small>
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
          <div key={m.id} className={"ms-dv-h " + m.type + (isOffDay(m, day) ? " off" : "")}><b>{shortName(m)}</b><small title={crewOf(m) ? `${crewOf(m)!.leader}'s crew` : undefined}>{crewOf(m) ? <b className="ms-lead">{crewOf(m)!.leader}</b> : m.type === "screen" ? `${m.colors} colors` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat press"}</small><IssueTag m={m} />{day === today && <ClockTag m={m} />}
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
            {[...new Map(cards.filter((c) => c.machine.id === m.id && c.job.firm && c.job.due === day && c.job.dueTime != null).map((c) => [c.job.key, c.job])).values()].map((j) => { const t = j.dueTime!; if (t < vS || t > vE) return null; return <div key={"dl" + j.key} className="ms-dl" style={{ top: ((t - vS) / 60) * HOUR_PX }} title={`#${j.number} ${j.customer}: firm, needed by ${clockLong(t)} ${dayLbl(day)}`}><span>⛰️ #{j.number} by {clock(t)}</span></div>; })}
            {(() => { const sh = shiftOn(m, day), oa = sh ? otOn(m, day) : null; if (!sh || oa == null) return null; const a = Math.max(oa, vS), b = Math.min(sh[1], vE); return b > a ? <div className="ms-ot" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} title={`${crewOf(m)?.leader ? crewOf(m)!.leader + "'s crew" : "This crew"} is past 40 hours this pay week from ${clockLong(oa)}: overtime`}><span>Overtime</span></div> : null; })()}
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
                <span className="ms-l1"><b>#{g.c.job.number}{g.c.slot?.status === "running" ? <em className="rn"> ●</em> : g.c.slot?.status === "done" ? <em className="ok"> ✓</em> : null}</b>{flags(g.c.job)}<span className="co"><span className="full">{g.c.job.customer}</span><span className="ab">{abbrCo(g.c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()}P</span></span>
                <span className="ms-l2">{g.c.job.firm ? <b className="ms-firm">Firm {firmLbl(g.c.job)}</b> : null}{g.c.job.name || g.c.need.label}</span>
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
              <div className="ms-pm-h"><b>{shortName(m)}<IssueTag m={m} />{crewOf(m) ? <span> · {crewOf(m)!.leader}</span> : null}{d === today && <ClockTag m={m} />}</b><span className="faint">{isOffDay(m, d) ? `Off · ${m.off![d]}` : sh ? hrsTxt(sh) : "extra"} · {fmtMin(used(m, d))}</span></div>
              <ul className="ms-pl">{gs.map((g) => { const gl = glance(g.c.need, g.c.minutes), st = g.c.slot?.status, past = d === today && g.end <= now.min && st !== "running"; return (
                <li key={g.c.key + g.part}><button type="button" className={"ms-pj " + g.c.need.type + (st === "done" ? " done" : st === "running" ? " run" : "") + (past ? " past" : "") + (mine && !isMe(g.c.job.owner, owners, me) ? " other" : "") + (ord(g.day) * 1440 + g.end > dueAbs(g.c.job) ? " late" : "")} onClick={() => setOpen(g.c)}>
                  <span className="ms-pj-t">{clock(g.start)}<small>{clock(g.end)}</small></span>
                  <span className="ms-pj-b"><span className="ms-pj-1"><b>#{g.c.job.number}</b>{flags(g.c.job)}{st === "running" ? <em className="rn"> ●</em> : st === "done" ? <em className="ok"> ✓</em> : null} {abbrCo(g.c.job.customer || "")}</span><span className="ms-pj-2">{g.c.job.firm ? <b className="ms-firm">Firm {firmLbl(g.c.job)}</b> : null}{g.c.job.name || g.c.need.label}</span><span className="ms-pj-3">{gl.colors} · {gl.units.toLocaleString()} pcs · {gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</span></span>
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
    if (!fits(need, mach)) { setMsg(`#${job.number} ${whyUnfit(need, mach)}.`); return; }
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
      <button key={c.key + g.part} type="button" draggable className={"ms-chip " + c.need.type + (c.job.kind === "h" ? " hold" : "") + (inOT(g) ? " ot" : "") + (c.job.firm ? " is-firm" : "") + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (ord(g.day) * 1440 + g.end > dueAbs(c.job) ? " late" : "") + (g.part > 1 ? " cont" : "") + (mine && !isMe(c.job.owner, owners, me) ? " other" : "") + (two ? " two" : "")}
        title={tip(g)} onClick={() => setOpen(c)}
        onDragStart={(e) => startDrag(e, { card: c, grabMin: 0 })} onDragEnd={() => { setDrag(null); setOver(""); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver("k:" + c.key); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag && g.part === 1) place(drag, g.c.machine, d, c.key); else if (drag) place(drag, g.c.machine, d); }}>
        {over === "k:" + c.key && <i className="ms-ins" />}
        {two ? (() => { const gl = glance(c.need, c.minutes); return <>
          <span className="ms-l1"><b>#{c.job.number}{c.slot?.status === "done" ? <em className="ok"> ✓</em> : c.slot?.status === "running" ? <em className="rn"> ●</em> : null}</b>{flags(c.job)}<span className="co"><span className="full">{c.job.customer}</span><span className="ab">{abbrCo(c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()}P</span></span>
          <span className="ms-l2">{c.job.firm ? <b className="ms-firm">Firm {firmLbl(c.job)}</b> : null}{c.job.name || c.need.label}</span>
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
            if (o.compact) return <div key={m.id} className={"ms-lg-m " + m.type} title={`${m.name}${crewOf(m) ? ` · ${crewOf(m)!.leader}'s crew` : ""}: ${fmtMin(wkU)} booked in these days`}><b>{shortName(m)}<IssueTag m={m} /></b><small>{crewOf(m) ? `${crewOf(m)!.leader} · ` : ""}{Math.round(wkU / 60)}h</small></div>;
            return <div key={m.id} className={"ms-lg-m " + m.type} title={m.name}><b>{shortName(m)}<IssueTag m={m} /></b><small>{crewOf(m) ? `${crewOf(m)!.leader} · ` : m.type === "screen" ? `${m.colors} color · ` : m.type === "embroidery" ? `${m.heads} head · ` : "heat · "}{Math.round(wkU / 60)}h this wk</small></div>;
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
      out.push({ key: "sh:" + x.id, kind: "shift", title: `${nameOf(x.machine)} · ${dayLbl(x.day)} ${clock(x.start_min)}–${clock(x.end_min)}`, detail: `${x.note || "Extra shift"}${booked ? ` · ${booked} job${booked === 1 ? "" : "s"} booked that day move back into the week` : ""}`, run: async () => {
        await sb.from("production_extra_shifts").delete().eq("id", x.id);
        // no regular shift that day (a Saturday): the jobs booked on it go to the start of the next regular day
        const m = s.machines.find((y) => y.id === x.machine); if (!m) return;
        const reg = { ...m, extra: Object.fromEntries(Object.entries(m.extra || {}).filter(([d]) => d !== x.day)) };
        if (shiftOn(reg, x.day)) return;
        let nd = addDay(x.day, 1); for (let i = 0; i < 14 && !shiftOn(reg, nd); i++) nd = addDay(nd, 1);
        const on = cards.filter((c) => c.machine.id === x.machine && c.day === x.day && c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused")).sort((a, b) => a.slot!.position - b.slot!.position);
        await Promise.all(on.map((c, i) => sb.from("production_slots").update({ day: nd, start_min: null, position: -on.length + i, updated_at: new Date().toISOString() }).eq("id", c.slot!.id)));
      } });
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
  /**
   * Overtime this pay week (Friday–Thursday) for each press crew in view: paid hours on the schedule (shifts, extra
   * shifts, days off, leaving early; lunch unpaid), hours past 40, how much of that has jobs booked in it, and the pay.
   */
  const otReport = (ws: string) => machines.filter((m) => m.crew).map((m) => {
    const w = weekOvertime(m, ws)!, days = Object.keys(w.days);
    const used = days.reduce((t, d) => { const oa = w.days[d].otFrom; if (oa == null) return t; return t + at(m, d).reduce((u, g) => u + Math.max(0, g.end - Math.max(g.start, oa)), 0); }, 0);
    const cc = crewCost(m), mult = s.labor.otMultiplier;
    const first = days.find((d) => w.days[d].otFrom != null);
    return { m, w, used: Math.min(used, w.ot), unused: Math.max(0, w.ot - used), perHour: cc?.perHour ?? null, who: cc?.who ?? [], pay: cc ? (w.ot / 60) * cc.perHour * mult : null, premium: cc ? (w.ot / 60) * cc.perHour * (mult - 1) : null, starts: first ? { day: first, min: w.days[first].otFrom! } : null };
  });
  // send a crew home at 40 hours: downtime ("Leaving early (no overtime)") from when overtime starts, or after the last booked job, to the end of the shift
  async function cutOvertime(rows: ReturnType<typeof otReport>) {
    const ins: Record<string, unknown>[] = [];
    for (const r of rows) for (const [d, x] of Object.entries(r.w.days)) {
      if (x.otFrom == null || d < today) continue;
      const sh = shiftOn(r.m, d); if (!sh) continue;
      const last = at(r.m, d).reduce((t, g) => Math.max(t, g.end), 0);
      const from = Math.ceil(Math.max(x.otFrom, last, d === today ? now.min : 0) / 15) * 15;
      if (from < sh[1]) ins.push({ machine: r.m.id, crew_id: null, day: d, start_min: from, end_min: sh[1], capacity: 0, employee: "", note: "Leaving early (no overtime)", created_by: me.email });
    }
    if (!ins.length) { setMsg("No unused overtime to cut: the overtime hours all have jobs booked."); return; }
    const r = await createClient().from("production_days_off").insert(ins);
    setMsg(r.error ? r.error.message : `Overtime cut: ${ins.length} early finish${ins.length === 1 ? "" : "es"} added (crews leave when their work is done instead of staying past 40 hours).`);
    load();
  }

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
  /**
   * "When can we print it?": a job that isn't booked yet, tried on every press that can run it.
   *  - soonest: first in line from now (unstarted work that isn't firm would get pushed back)
   *  - next opening: after everything already booked (nobody moves)
   * Both follow each press's real hours, breaks, downtime and crew speed.
   */
  // booked time on each press/day (from the calendar), for trying a new job around it
  const obst = (keep: (c: Card) => boolean) => { const mp = new Map<string, [number, number][]>(); for (const c of cards) if (keep(c)) for (const g of segs.ofCard.get(c.key) || []) if (g.day >= today) { const k = c.machine.id + "|" + g.day; mp.set(k, [...(mp.get(k) || []), [g.start, g.end]]); } return mp; };
  // lay `minutes` of work on a press from t0 (absolute minutes) around its hours, breaks, downtime and booked time
  // whole: in one go, the way the calendar runs a press's line (it doesn't run around booked work, it fits before it or goes after)
  const simFrom = (m: Machine, obs: Map<string, [number, number][]>, minutes: number, t0: number, base?: Machine, whole = false): WhenOpt => {
    if (whole) {
      let r = simFrom(m, obs, minutes, t0, base);
      for (let k = 0; k < 80; k++) {
        const s0 = r.start, hit = [...obs.entries()].filter(([k2]) => k2.startsWith(m.id + "|")).flatMap(([k2, v]) => v.map(([a, b]) => [ord(k2.slice(m.id.length + 1)) * 1440 + a, ord(k2.slice(m.id.length + 1)) * 1440 + b] as [number, number])).filter(([a]) => a >= s0 && a < r.end - 0.5).sort((x, y) => x[0] - y[0])[0];
        if (!hit) break;
        r = simFrom(m, obs, minutes, hit[1], base);
      }
      return r;
    }
    const wins = (d: string) => { const sh = shiftOn(m, d); if (!sh) return []; return windowsIn(sh, [...downsOn(m, d, sh), ...(obs.get(m.id + "|" + d) || []).map(([a, b]): Down => [a, b, "Booked", 0])]); };
    let t = t0, start = -1, left = minutes, ot = 0, extra = 0;
    for (let g = 0; g < 2000 && left > 0.01; g++) {
      const dd = Math.floor(t / 1440), mm = t - dd * 1440, d = fromOrd(dd), w = wins(d).find(([, y]) => mm < y);
      if (!w) { t = (dd + 1) * 1440; continue; }
      const a = Math.max(mm, w[0]); if (start < 0) start = dd * 1440 + a;
      const e = Math.min(a + left / w[2], w[1]); const oa = otOn(base || m, d); if (oa != null) ot += Math.max(0, e - Math.max(a, oa));
      // time outside the crew's regular shift (the overtime / Saturday added to make it)
      if (base) { const sh = shiftOn(base, d); extra += sh ? Math.max(0, Math.min(e, sh[0]) - a) + Math.max(0, e - Math.max(a, sh[1])) : e - a; }
      left -= (e - a) * w[2]; t = dd * 1440 + e;
    }
    return { m: base || m, start, end: t, minutes, ot, extra };
  };
  const stays = (c: Card) => !!c.slot && (c.slot.status === "running" || c.slot.status === "done" || !!c.job.firm);
  /**
   * "When can we print it?": a job that isn't booked yet, tried on every press that can run it.
   *  - soonest: first in line from now (unstarted work that isn't firm would get pushed back)
   *  - next opening: after everything already booked (nobody moves), including Planner holds
   * Both follow each press's real hours, breaks, downtime and crew speed.
   */
  const whenCan = (need: Need): WhenResult | null => {
    if (!need.steps.length) return null;
    const nowAbs = ord(today) * 1440 + now.min;
    const cand = s.machines.filter((m) => m.active && fits(need, m));
    if (!cand.length) return { need, minutes: 0, soonest: null, aggressive: null, open: null, slow: null, noMachine: true };
    const est = (m: Machine) => estimate(s, need, m).minutes;
    const perHr = (m: Machine) => crewCost(m)?.perHour ?? (m.crew ? s.labor.crewSize : 1) * s.labor.wage, mult = s.labor.otMultiplier;
    const lastEnd = (m: Machine) => cards.filter((c) => c.machine.id === m.id).reduce((t, c) => Math.max(t, ...(segs.ofCard.get(c.key) || []).map((g) => ord(g.day) * 1440 + g.end)), nowAbs);
    // jumping the line on a press pushes back its unstarted, non-firm work: which of those would then miss their date
    const bumpsOn = (r: WhenOpt) => cards.filter((c) => c.machine.id === r.m.id && !stays(c) && !c.fromPv && (segs.ofCard.get(c.key) || []).some((g) => ord(g.day) * 1440 + g.end > r.start))
      .map((c) => { const cur = (segs.ofCard.get(c.key) || []).reduce((t, g) => Math.max(t, ord(g.day) * 1440 + g.end), 0); return { job: c.job, late: cur <= dueAbs(c.job) && cur + r.minutes > dueAbs(c.job) }; })
      .filter((x, i, arr) => arr.findIndex((y) => y.job.key === x.job.key) === i);
    const first = obst(stays), all = obst(() => true);
    // 1. absolute soonest: jump the line and add time: up to 2 hours after every regular shift and a Saturday 8–2
    const withExtra = (m: Machine): Machine => {
      const extra = { ...(m.extra || {}) };
      for (let i = 0, d = today; i < 21; i++, d = addDay(d, 1)) {
        const sh = shiftOn(m, d), wd = dow(d);
        if (sh && wd !== 0 && wd !== 6) { const e = extra[d]; extra[d] = [Math.min(e?.[0] ?? sh[0], sh[0]), Math.max(e?.[1] ?? sh[1], Math.min(1440, sh[1] + 120))]; }
        else if (wd === 6 && !isOffDay(m, d)) extra[d] = extra[d] || [480, 840];
      }
      return { ...m, extra };
    };
    const soonest = cand.map((m) => { const r = simFrom(withExtra(m), first, est(m), nowAbs, m); return { ...r, bumped: bumpsOn(r), cost: Math.round(((r.extra || 0) / 60) * perHr(m) * mult + (Math.max(0, r.ot - (r.extra || 0)) / 60) * perHr(m) * (mult - 1)) }; }).sort((x, y) => x.end - y.end || (x.cost || 0) - (y.cost || 0))[0];
    // 2. aggressive: jump the line on regular hours where nobody else ends up late
    const jumps = cand.map((m) => { const r = simFrom(m, first, est(m), nowAbs); return { ...r, bumped: bumpsOn(r) }; });
    const aggressive = [...jumps].sort((x, y) => x.bumped.filter((b) => b.late).length - y.bumped.filter((b) => b.late).length || x.end - y.end)[0];
    // 3. regular: the next opening, nothing moves
    const open = cand.map((m) => simFrom(m, all, est(m), nowAbs)).sort((x, y) => x.end - y.end || x.ot - y.ot)[0];
    // 4. slow boat: the end of the line, after everything already booked on the press
    const slow = cand.map((m) => simFrom(m, all, est(m), lastEnd(m))).sort((x, y) => x.end - y.end)[0];
    // each option is at least as soon as the one after it: if the next opening beats jumping the line, jumping isn't needed
    const agg = aggressive && open && open.end < aggressive.end ? { ...open, bumped: [] } : aggressive;
    const soon = soonest && agg && agg.end < soonest.end ? { ...agg, extra: 0, cost: Math.round((agg.ot / 60) * perHr(agg.m) * (mult - 1)) } : soonest;
    return { need, minutes: est(open.m), soonest: soon, aggressive: agg, open, slow: slow && open && slow.end < open.end ? open : slow, noMachine: false };
  };
  /**
   * Where a Planner hold goes: just in time, not first thing. The latest start that still finishes the working day
   * before its in-hands date (packing / shipping), on the press that fits it best; if nothing fits by then, the soonest.
   */
  const holdSpot = (need: Need, due: string | null): WhenOpt | null => {
    const cand = s.machines.filter((m) => m.active && fits(need, m));
    if (!cand.length) return null;
    const obs = obst(() => true), nowAbs = ord(today) * 1440 + now.min;
    if (due) {
      const target = minusWorkdays(due, Math.max(1, s.bufferDays)), deadline = ord(target) * 1440 + 1440;
      for (let k = 0; k < 30; k++) {
        const d = minusWorkdays(target, k); if (d < today) break;
        const t0 = Math.max(nowAbs, ord(d) * 1440);
        const ok = cand.map((m) => simFrom(m, obs, estimate(s, need, m).minutes, t0, undefined, true)).filter((r) => r.end <= deadline).sort((a, b) => a.ot - b.ot || a.end - b.end)[0];
        if (ok) return ok;
      }
    }
    return cand.map((m) => simFrom(m, obs, estimate(s, need, m).minutes, nowAbs, undefined, true)).sort((a, b) => a.end - b.end)[0];
  };
  async function saveHold(h: { name: string; customer: string; spec: QuickJob; due_date: string; due_time: number | null; notes: string }) {
    const need = quickNeed(s!, h.spec);
    if (!need.steps.length) return "Add at least one print location.";
    const spot = holdSpot(need, h.due_date);
    if (!spot) return "No machine can run this.";
    const sb = createClient();
    const r = await sb.from("production_holds").insert({ ...h, created_by: me.email }).select("id").single();
    if (r.error) return r.error.message;
    const day = fromOrd(Math.floor(spot.start / 1440));
    // it takes its place in that day's line by start time (the jobs after it keep their order behind it)
    const line = cards.filter((c) => c.machine.id === spot.m.id && c.day === day && c.slot).map((c) => ({ c, at: (segs.ofCard.get(c.key) || [])[0] })).sort((a, b) => (a.at ? ord(a.at.day) * 1440 + a.at.start : 0) - (b.at ? ord(b.at.day) * 1440 + b.at.start : 0));
    const idx = line.filter((x) => x.at && ord(x.at.day) * 1440 + x.at.start < spot.start).length;
    await Promise.all(line.map((x, i) => ({ x, p: i < idx ? i : i + 1 })).filter(({ x, p }) => x.c.slot!.position !== p).map(({ x, p }) => sb.from("production_slots").update({ position: p }).eq("id", x.c.slot!.id)));
    const r2 = await sb.from("production_slots").insert({ hold_id: (r.data as { id: string }).id, machine: spot.m.id, day, minutes: spot.minutes, start_min: null, position: idx, kind: need.type, label: need.label, source: "planner", status: "scheduled", locations: null });
    if (r2.error) return r2.error.message;
    setMsg(`Planned: ${h.name || "job"} holds ${fmtMin(spot.minutes)} on ${spot.m.name}, ${dayLbl(day)}${h.due_date && spot.end > ord(minusWorkdays(h.due_date, Math.max(1, s!.bufferDays))) * 1440 + 1440 ? " (the schedule is full: it finishes after the in-hands date)" : ""}. Drag it anywhere on the calendar.`);
    load();
    return "";
  }
  async function removeHold(id: string) { await createClient().from("production_holds").delete().eq("id", id); load(); }

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
  // test hook (off unless window.__MS_DEBUG is set): the scheduler's state and actions, for the automated stress test
  if (typeof window !== "undefined" && (window as unknown as { __MS_DEBUG?: boolean }).__MS_DEBUG) Object.assign(window, { __ms: { s, cards, segs, machines, today, now, tight, tray, slots, holds, planIt, applyPlan, whatIfs, whenCan, holdSpot, otReport, otOn, acceptAll, book, unbook, saveProgress, logAction, splitByLocation, saveHold, removeHold, cutOvertime, load } });

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
      {/* what just happened (booked, re-planned, saved): a quiet note at the bottom of the screen, not above the tools */}
      {msg && <div className="ms-toast" role="status"><span>{msg}</span><button type="button" aria-label="Dismiss" onClick={() => setMsg("")}>×</button></div>}

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
          {/* one slim row of tools: production (the production manager's day), shifts & equipment, sales; each its own color */}
          {/* left: the tools; right: Shop AI Assistant, how the shop is doing and what needs attention */}
          <div className="ms-tools-2">
            <div className="ms-tpanel">
              <div className="ms-pulse-h">Tools</div>
          <div className="ms-tbar">
            <div className="ms-tb-g ms-tb-prod">
              <span className="ms-tb-l">Production</span>
              <button type="button" className="ms-tb" title="What's started, done or paused today" onClick={() => setCheckin(true)}>Update Progress</button>
              <button type="button" className="ms-tb" title="Re-lay open work from now, soonest in-hands first" onClick={() => setReplan({ why: "" })}>Re-plan</button>
              <button type="button" className="ms-tb" title="Who's past 40 hours this pay week" onClick={() => setOtOpen(true)}>Overtime</button>
              <button type="button" className="ms-tb" title="Drop extra shifts, put split jobs back together" onClick={() => setRenorm(true)}>Renormalize</button>
            </div>
            <div className="ms-tb-g ms-tb-eq">
              <span className="ms-tb-l">Shifts &amp; equipment</span>
              <button type="button" className="ms-tb" title="A weekend or extra shift for a crew" onClick={() => setShiftEdit(true)}>+ Shift</button>
              <button type="button" className="ms-tb" title="Maintenance, repairs, an employee out" onClick={() => setDownEdit({})}>+ Downtime</button>
              <button type="button" className={"ms-tb" + (eqIssues.length ? " warn" : "")} title="Heads out, running slow, or down" onClick={() => setEqOpen(true)}>Equipment{eqIssues.length ? <span className="ms-tb-n">{eqIssues.length}</span> : null}</button>
            </div>
            <div className="ms-tb-g ms-tb-sales">
              <span className="ms-tb-l">Sales</span>
              <button type="button" className="ms-tb" title="Quick specs → soonest, aggressive, regular and slow-boat dates" onClick={() => setWhenOpen(true)}>When Can We {VERB[typeF || "screen"].v} It?</button>
              <button type="button" className="ms-tb" title="Hold time for jobs you know are coming" onClick={() => setPlanOpen(true)}>Planner</button>
            </div>
          </div>

            </div>
            <div className="ms-pulse" aria-label="Shop AI Assistant">
              <div className="ms-pulse-h"><span aria-hidden>✦</span> Shop AI Assistant</div>
            {(() => {
              // the assistant's read on the shop: a status ring (share of jobs on time) and a plain sentence or two
              const keys = new Set<string>();
              for (const c of cards) if (c.slot && c.slot.status !== "done" && c.job.kind !== "h" && (!typeF || c.need.type === typeF)) keys.add(c.job.key);
              for (const t of tray) keys.add(t.job.key);
              const total = keys.size, late = tight.length, onTime = Math.max(0, total - late), pct = total ? onTime / total : 1;
              const rows = otReport(payWeekStart(today)), otNeed = rows.reduce((t, r) => t + r.used, 0);
              const otWho = rows.filter((r) => r.used > 0).map((r) => crewOf(r.m)?.leader || shortName(r.m));
              const wkd = (d: string) => [0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
              const wk = extras.filter((x) => x.day >= today && wkd(x.day) && machines.some((m) => m.id === x.machine)).sort((x, y) => x.day.localeCompare(y.day));
              const lvl = late ? "bad" : otNeed > 0 || eqIssues.length || wk.length ? "warn" : "ok";
              const and = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
              const lines: string[] = [];
              if (late) lines.push(wk.length ? `Even with the weekend shift ${dayLbl(wk[0].day)}, you're short — check Recommendations, or split jobs across presses.` : `You're trending toward a weekend shift — check Recommendations, or split jobs across presses.`);
              if (otNeed > 0) lines.push(`Trending toward overtime: ${and(otWho)} ${otWho.length === 1 ? "needs" : "need"} about ${fmtMin(otNeed)} past 40 hours this pay week.`);
              if (wk.length && !late) lines.push(`A weekend shift is booked ${dayLbl(wk[0].day)}.`);
              if (eqIssues.length) lines.push(`${and(eqIssues.map((m) => shortName(m)))} ${eqIssues.length === 1 ? "has" : "have"} an equipment issue.`);
              const title = lvl === "bad" ? `${late} job${late === 1 ? "" : "s"} won't make ${late === 1 ? "its" : "their"} in-hands date.` : lvl === "warn" ? "Jobs are on time, with a heads up." : "You're good.";
              if (lvl === "ok" && !lines.length) lines.push("Every job makes its in-hands date and nobody needs overtime this week.");
              const R = 20, C = 2 * Math.PI * R;
              return (
                <div className={"ms-as " + lvl}>
                  <div className="ms-as-ring" title={`${onTime} of ${total} jobs on time`}>
                    <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden><circle cx="26" cy="26" r={R} className="trk" /><circle cx="26" cy="26" r={R} className="val" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 26 26)" /></svg>
                    <span className="ms-as-ic" aria-hidden>{lvl === "ok" ? "✓" : "!"}</span>
                  </div>
                  <div className="ms-as-b">
                    <div className="ms-as-t">{title}</div>
                    {lines.map((l, i) => <div key={i} className="ms-as-s">{l}</div>)}
                    <div className="ms-as-chips">
                      <span className={late ? "bad" : "ok"}><i />On time {onTime}/{total}</span>
                      <span className={otNeed > 0 ? "warn" : "ok"}><i />{otNeed > 0 ? `Overtime ${fmtMin(otNeed)}` : "No overtime needed"}</span>
                      <span className={wk.length ? "warn" : late ? "warn" : "ok"}><i />{wk.length ? `Weekend ${dayLbl(wk[0].day).replace(",", "")}` : late ? "Weekend may be needed" : "No weekend"}</span>
                      <span className={eqIssues.length ? "warn" : "ok"}><i />{eqIssues.length ? `Equipment: ${eqIssues.length} issue${eqIssues.length === 1 ? "" : "s"}` : "Equipment OK"}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          {(() => { const rows = otReport(payWeekStart(today)), ot = rows.reduce((t, r) => t + r.w.ot, 0); if (!rows.length) return null; const pay = rows.reduce((t, r) => t + (r.pay || 0), 0), unused = rows.reduce((t, r) => t + r.unused, 0), known = rows.every((r) => r.pay != null); return (
            <div className={"ms-otline" + (ot ? " on" : "")}>
              <span className="ms-ot-i" aria-hidden>⏱</span>
              <span><b>{ot ? `${fmtMin(ot)} of overtime this pay week` : "No overtime this pay week"}</b>{ot ? <> · {rows.filter((r) => r.w.ot).map((r) => `${crewOf(r.m)?.leader || shortName(r.m)} ${fmtMin(r.w.ot)}`).join(", ")}{pay && known ? ` · ~$${Math.round(pay).toLocaleString()} overtime pay` : ""}{unused > 30 ? ` · ${fmtMin(unused)} of it has no jobs booked` : ""}</> : null}<small> · pay week {dayLbl(payWeekStart(today))} – {dayLbl(addDay(payWeekStart(today), 6))}</small></span>
              <span className="spacer" />
              <button type="button" className="linkbtn" onClick={() => setOtOpen(true)}>Details</button>
            </div>
          ); })()}
          {(() => {
            // a press with hours open on the next working day while unstarted work waits on later days: Re-plan fills it
            const d1 = Array.from({ length: 7 }, (_, i) => addDay(today, i + 1)).find((d) => machines.some((m) => shiftOn(m, d))); if (!d1) return null;
            const idle = machines.filter((m) => shiftOn(m, d1)).map((m) => ({ m, free: capacityMin(s, m, d1) - used(m, d1) })).filter((x) => x.free >= 120 && cards.some((c) => c.day > d1 && c.slot && c.slot.status === "scheduled" && !c.job.firm && c.job.kind !== "h" && fits(c.need, x.m)));
            if (!idle.length) return null;
            return <div className="ms-otline ms-idle" title={idle.map((x) => `${shortName(x.m)}${crewOf(x.m) ? ` (${crewOf(x.m)!.leader})` : ""}: ${fmtMin(x.free)} open`).join("\n")}><span className="ms-ot-i" aria-hidden>↺</span><span className="ms-idle-t"><b>{idle.length === 1 ? `${shortName(idle[0].m)} has ${fmtMin(idle[0].free)} open` : `${idle.length} machines have open time`} {dayLbl(d1).split(",")[0] === dayLbl(addDay(today, 1)).split(",")[0] ? "tomorrow" : dayLbl(d1)}</b> while later jobs wait{idle.length > 1 ? <span className="faint"> · {idle.map((x) => `${shortName(x.m)} ${fmtMin(x.free)}`).join(", ")}</span> : null}</span><span className="spacer" /><button type="button" className="btn sm ghost" onClick={() => setReplan({ why: "Pull later jobs forward into the open time?" })}>Re-plan</button></div>;
          })()}
          {tight.length > 0 ? (
            <div className="ms-alert">
              <div className="ms-alert-h">
                <span className="ms-alert-i" aria-hidden>!</span>
                <div className="ms-alert-t"><b>Late jobs ({tight.length})</b><span>on the regular schedule</span></div>
                <span className="spacer" />
                <button type="button" className="linkbtn" onClick={() => setTightOpen(!tightOpen)}>{tightOpen ? "Hide jobs" : "Which jobs?"}</button>
                <button type="button" className="btn sm ms-ai-b" onClick={() => setAdvise({ opts: whatIfs(), late: tight.map((t) => ({ job: "#" + t.job.number, customer: t.job.customer || t.job.name, inHands: t.job.due ? dayLbl(t.job.due) : "none", why: t.why })), lateBefore: tight.length })}>✦ Recommendations</button>
                <button type="button" className="btn sm ghost" onClick={() => setReplan({ why: "OK to split jobs (fronts and backs as separate runs) where that makes an in-hands date?", split: true })}>Split Jobs</button>
                <button type="button" className="btn sm ghost" onClick={() => setShiftEdit(true)}>Add Weekend Shift</button>
              </div>
              {tightOpen && <ul className="ms-alert-l">{tight.map((t) => <li key={t.job.key}><Link href={t.job.href}>#{t.job.number}</Link><span>{t.job.customer || t.job.name}</span><small>{t.why}</small></li>)}</ul>}
            </div>
          ) : null}

            {eqIssues.length > 0 && <div className="ms-otline"><span className="ms-ot-i" aria-hidden>⚙</span><span className="ms-idle-t"><b>{eqIssues.map((m) => shortName(m)).join(", ")}</b> {eqIssues.length === 1 ? "has" : "have"} an equipment issue<span className="faint"> · {eqIssues.map((m) => m.issue!.down ? `${shortName(m)} down` : [m.issue!.colors != null ? `${shortName(m)} ${m.issue!.colors}/${m.issue!.full} ${m.type === "screen" ? "colors" : "heads"}` : "", m.issue!.flashes != null ? `${m.issue!.flashes}/${m.issue!.fullFlashes} flashes` : "", m.issue!.speed != null ? `${m.issue!.speed}% speed` : ""].filter(Boolean).join(" ")).join(" · ")}</span></span><span className="spacer" /><button type="button" className="btn sm ghost" onClick={() => setEqOpen(true)}>Details</button></div>}
            </div>
          </div>
          <div className="ms-ready">
            <div className="ms-ready-h">
              <button type="button" className="ms-band-t" onClick={() => setTrayOpen(!trayOpen)} aria-expanded={trayOpen}><span className="car">{trayOpen ? "▾" : "▸"}</span><b>Ready To Schedule</b><span className="aa-n">{tray.length}</span></button>
              <span className="faint ms-band-sub">{tray.filter((t) => t.sug?.late).length ? <span className="ms-late">{tray.filter((t) => t.sug?.late).length} tight or late · </span> : null}{coming.length ? `${coming.length} more coming (art, blanks) · ` : ""}{tray.length ? "drag onto a press and day, or take the suggested spot" : "nothing waiting"}</span>
              <span className="spacer" />
              {trayOpen && tray.some((t) => t.sug && !t.sug.late) && <button type="button" className="btn sm primary" onClick={acceptAll}>Accept All Suggestions</button>}
            </div>
            {trayOpen && tray.length > 0 && (
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
            )}
          </div>
        </>}
      </section>

      <div className="ms-main">
        {view === "split" ? split() : view === "timeline" ? <div className="ms-weeks">{weekGrid(week, week === monday(today) ? "This Week" : week === addDay(monday(today), -7) ? "Last Week" : "Week of")}{weekGrid(addDay(week, 7), addDay(week, 7) === addDay(monday(today), 7) ? "Next Week" : addDay(week, 7) === monday(today) ? "This Week" : "Week of")}</div> : dayGrid(day)}
        {phoneView()}
        <div className="ms-key faint"><span><i className="k screen" />Screen print</span><span><i className="k embroidery" />Embroidery</span><span><i className="k heat" />Heat press</span><span><i className="k run" />Running</span><span><i className="k done" />Done</span><span><i className="k late" />Past in-hands</span></div>
      </div>

      {planOpen && <PlannerPanel method={typeF || "screen"} s={s} today={today} holds={holds} admin={isAdmin} spotOf={(id) => { const c = cards.find((x) => x.job.key === "h:" + id); const g = c ? (segs.ofCard.get(c.key) || [])[0] : undefined; return c && g ? `${shortName(c.machine)} · ${dayLbl(g.day)} · ${fmtMin(c.minutes)}` : ""; }} onSave={saveHold} onRemove={removeHold} onClose={() => setPlanOpen(false)} />}
      {whenOpen && <WhenPanel method={typeF || "screen"} s={s} today={today} nowLabel={`${dayLbl(today)} ${clockLong(now.min)}`} calc={whenCan} onClose={() => setWhenOpen(false)} />}
      {eqOpen && <EquipmentPanel machines={s.machines.filter((m) => m.active && (!typeF || m.type === typeF))} rows={equip} today={today} me={me.email} crewOf={crewOf}
        stuck={(m, colors, fl) => { const mm = m.type === "screen" ? { ...m, colors, flashes: fl } : m.type === "embroidery" ? { ...m, heads: colors } : m; return cards.filter((c) => c.machine.id === m.id && c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !fits(c.need, mm)).map((c) => "#" + c.job.number); }}
        booked={(m) => cards.filter((c) => c.machine.id === m.id && c.slot && c.slot.status !== "done").length}
        onClose={() => setEqOpen(false)} onSaved={(msg0, replanToo) => { setEqOpen(false); setMsg(msg0); load(); if (replanToo) setReplan({ why: `${msg0} Re-plan so the jobs booked on it move to a press that can run them?` }); }} />}
      {otOpen && <OvertimePanel today={today} thisWeek={otReport(payWeekStart(today))} nextWeek={otReport(addDay(payWeekStart(today), 7))} mult={s.labor.otMultiplier} leader={(m) => crewOf(m)?.leader || shortName(m)} onClose={() => setOtOpen(false)} onCut={async (rows) => { await cutOvertime(rows); setOtOpen(false); }} />}
      {advise && <AdvisePanel options={advise.opts} late={advise.late} lateBefore={advise.lateBefore} labor={s.labor} otNote={otReport(payWeekStart(today)).filter((r) => r.w.ot).map((r) => `${crewOf(r.m)?.leader || shortName(r.m)}'s crew (${shortName(r.m)}): ${fmtMin(r.w.ot)} overtime already on the schedule this pay week${r.starts ? `, from ${dayLbl(r.starts.day)} ${clock(r.starts.min)}` : ""}`).join("; ")} machinesLabel={typeF ? TYPE_LBL[typeF] : "all machines"} nowLabel={`${dayLbl(today)} ${clockLong(now.min)}`} onClose={() => setAdvise(null)} onApply={applyWhatIf} />}
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
              <label className="check"><input type="checkbox" checked={replanNoOT} onChange={(e) => setReplanNoOT(e.target.checked)} /> Avoid overtime when every job still makes its date</label>
              {p.otCuts.length > 0 && (() => {
                const byCrew = new Map<string, OtCut[]>(); for (const x of p.otCuts) byCrew.set(x.m.id, [...(byCrew.get(x.m.id) || []), x]);
                const mins = p.otCuts.reduce((t, x) => t + x.end - x.start, 0);
                const dollars = p.otCuts.reduce((t, x) => { const cc = crewCost(x.m); return t + ((x.end - x.start) / 60) * (cc?.perHour ?? s.labor.crewSize * s.labor.wage) * s.labor.otMultiplier; }, 0);
                return <div className="ms-ask ok"><b>No overtime needed: {fmtMin(mins)} saved (about ${Math.round(dollars).toLocaleString()} in overtime pay).</b><span>{[...byCrew.values()].map((l) => `${crewOf(l[0].m)?.leader || shortName(l[0].m)}'s crew leaves at 40 hours: ${l.map((x) => `${dayShort(x.day)} ${clockLong(x.start)}`).join(", ")}`).join(" · ")}. Every job that makes its date with the overtime still makes it.</span></div>;
              })()}
              {p.lateAfter > p.lateBefore && <div className="ms-ask"><b>This would leave more jobs late than the schedule has now ({p.lateBefore} → {p.lateAfter}).</b><span>The way the jobs are lined up now works better than re-laying them by in-hands date. Keep it as is, or add hours (a weekend shift or overtime) and re-plan.</span></div>}
              {!p.moves.length && <div className="ms-ask ok">Nothing needs to move to another press or day. Everything not started already runs from {clockLong(now.min)} on, in in-hands order.</div>}
              {p.moves.length > 0 && <ul className="ms-offs">{p.moves.slice(0, 40).map((o) => <li key={o.it.key + o.part}><span>#{o.it.job.number}{o.parts > 1 ? <small className="faint"> · {o.locs?.join(", ")}</small> : null}{o.it.job.due ? <small className="faint"> · due {dayShort(o.it.job.due)}</small> : null}</span><span className="faint">{o.it.slot ? `${shortName(s.machines.find((x) => x.id === o.it.cur) || o.mach)} ${dayShort(o.it.curDay)}` : "Ready To Schedule"} → <b className={o.late ? "ms-late" : ""}>{shortName(o.mach)} {dayShort(o.day)}{o.end !== o.day ? `–${dayShort(o.end)}` : ""}</b></span><span /></li>)}</ul>}
              {p.moves.length > 40 && <div className="faint">and {p.moves.length - 40} more</div>}
              {splitHelps && !replan.split && <div className="ms-ask"><b>The schedule is tight. OK to split jobs up as needed?</b><span>Printing the fronts and backs of {splitP!.splits} job{splitP!.splits === 1 ? "" : "s"} as separate runs (another day or press) brings late jobs from {whole.lateAfter} to {splitP!.lateAfter}. Separate runs lose some efficiency: extra setup, screens not shared.</span><div className="row" style={{ gap: 8 }}><button type="button" className="btn sm primary" onClick={() => setReplan({ ...replan, split: true })}>Yes, Split As Needed</button><button type="button" className="btn sm" onClick={() => setShiftEdit(true)}>Add a Weekend Shift Instead</button></div></div>}
              {replan.split && splitHelps && <div className="ms-ask ok">Splitting allowed: {splitP!.splits} job{splitP!.splits === 1 ? "" : "s"} run fronts and backs separately. <button type="button" className="linkbtn" onClick={() => setReplan({ ...replan, split: false })}>Keep jobs whole</button></div>}
              {p.lateAfter > 0 && <div className="faint" style={{ fontSize: 12.5 }}>{p.lateAfter} still won&apos;t make {p.lateAfter === 1 ? "its" : "their"} in-hands date. Another weekend shift or overtime would help.</div>}
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className={"btn" + (p.lateAfter > p.lateBefore ? " primary" : "")} onClick={() => setReplan(null)}>Keep As Is</button>
                <button type="button" className={"btn" + (p.lateAfter > p.lateBefore ? "" : " primary")} disabled={replanBusy || (!p.moves.length && !p.otCuts.length)} onClick={() => applyPlan(p)}>{replanBusy ? "Moving…" : p.moves.length ? `Move ${p.moves.length} Job${p.moves.length === 1 ? "" : "s"}${p.otCuts.length ? ", Cut Overtime" : ""}` : "Cut Overtime"}</button>
              </div>
            </div>
          </div>
        </div>
      ); })()}
      {downEdit && <DownPanel machines={machines} crews={s.crews} init={downEdit} offs={offs} today={today} win={[vStart, vEnd]} me={me.email} onClose={() => setDownEdit(null)} onSaved={(m) => { setDownEdit(null); setMsg(m); load(); }} />}
      {open && <CardPanel s={s} c={open} cost={crewCost} otMin={(segs.ofCard.get(open.key) || []).reduce((t, g) => { const oa = otOn(g.c.machine, g.day); return t + (oa == null ? 0 : Math.max(0, g.end - Math.max(g.start, oa))); }, 0)} onFlags={async (x) => { const r = await createClient().from("orders").update({ ...x, updated_at: new Date().toISOString() }).eq("id", open.job.id); if (r.error) { setMsg(r.error.message); return; } const j = { ...open.job, ...(x.rush !== undefined ? { rush: x.rush } : {}), ...(x.firm !== undefined ? { firm: x.firm } : {}), ...(x.due_time !== undefined ? { dueTime: x.due_time } : {}), ...(x.due_date !== undefined ? { due: x.due_date } : {}) }; setOpen({ ...open, job: j }); load(); }} segs={segs.ofCard.get(open.key) || []} days={[...new Set([...allDays, ...hourly.map((h) => h.d), ...restDays])].filter(visible).sort()} win={[vStart, vEnd]} onClose={() => setOpen(null)} onMove={(mach, d, st) => { book(open.job, open.need, mach, d, "manual", open.slot, st); setOpen(null); }} onStatus={setStatus} onUnbook={unbook} onLog={(a, p) => open.slot && logAction(open.slot, a, p)} onSplit={(off) => splitByLocation(open, off)} />}
    </div>
  );
}

/** A job on the calendar: when it runs (every day it spans), the time breakdown, move it, mark it running or done, or take it off. */
function CardPanel({ s, c, cost, otMin, onFlags, segs, days, win, onClose, onMove, onStatus, onUnbook, onLog, onSplit }: { s: ProductionSettings; c: Card; cost: (m: Machine) => { perHour: number; who: string[] } | null; otMin: number; onFlags: (x: { rush?: boolean; firm?: boolean; due_time?: number | null; due_date?: string | null }) => void; segs: Seg[]; days: string[]; win: [number, number]; onClose: () => void; onMove: (m: Machine, d: string, startMin: number | null) => void; onStatus: (sl: Slot, st: Slot["status"]) => void; onUnbook: (sl: Slot) => void; onLog: (a: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", p?: number) => void; onSplit: (off: string[]) => void }) {
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
          <div className="faint">{c.job.name}{c.job.due ? ` · in-hands ${dayLbl(c.job.due)}${c.job.dueTime != null ? ` by ${clockLong(c.job.dueTime)}` : ""}` : ""} · {c.job.status}</div>
          {c.job.kind === "o" && <div className="ms-flagrow">
            <label className={"check" + (c.job.rush ? " on f-rush" : "")}><input type="checkbox" checked={!!c.job.rush} onChange={(e) => onFlags({ rush: e.target.checked })} /> 🔥 Rush</label>
            <label className={"check" + (c.job.firm ? " on f-firm" : "")}><input type="checkbox" checked={!!c.job.firm} onChange={(e) => onFlags({ firm: e.target.checked, ...(e.target.checked ? {} : { due_time: null }) })} /> ⛰️ Firm date</label>
            <span className="ms-due">
              <span className="faint">In-hands</span>
              <input type="date" aria-label="In-hands date" value={c.job.due || ""} onChange={(e) => onFlags({ due_date: e.target.value || null })} />
              {c.job.dueTime != null && <input type="time" step={900} aria-label="Needed by" value={`${String(Math.floor(c.job.dueTime / 60)).padStart(2, "0")}:${String(c.job.dueTime % 60).padStart(2, "0")}`} onChange={(e) => { const [h, mm] = e.target.value.split(":").map(Number); if (!isNaN(h)) onFlags({ due_time: h * 60 + (mm || 0), firm: true }); }} />}
              <label className="check"><input type="checkbox" checked={c.job.dueTime != null} disabled={!c.job.due} onChange={(e) => onFlags(e.target.checked ? { due_time: 600, firm: true } : { due_time: null })} /> Specific time</label>
            </span>
          </div>}
          <div className="ms-when"><b>{c.machine.name}</b>{segs.length > 1 ? <span className="faint"> · {fmtMin(c.minutes)} over {segs.length} days</span> : null}
            <ul>{segs.map((g) => <li key={g.part}>{dayLbl(g.day)}, {clockLong(g.start)} – {clockLong(g.end)}</li>)}</ul>
            {c.fromPv ? <span className="faint">From its Printavo schedule{c.carried ? ` (was ${dayLbl(c.carried)}, still in the machine status)` : ""}.</span> : c.carried ? <span className="faint">Rolled forward from {dayLbl(c.carried)} (not marked Done).</span> : null}
          </div>
          <div><b>{TYPE_LBL[c.need.type]}:</b> {c.need.label} · {c.need.qty} pcs{c.need.steps.some((x) => x.note) ? <span className="faint"> ({c.need.steps.find((x) => x.note)?.note})</span> : null}</div>
          <ul className="ms-parts">{est.parts.map((p, i) => <li key={i}><span>{p.label}</span><b>{fmtMin(p.minutes)}</b></li>)}<li className="tot"><span>Setup {fmtMin(est.setup)} · run {fmtMin(est.run)}{est.teardown ? ` · teardown ${fmtMin(est.teardown)}` : ""}</span><b>{fmtMin(est.minutes)}</b></li></ul>
          {(() => {
            const k = cost(m); if (!k) return null;
            // time that runs after the crew passes 40 hours this pay week is paid at the overtime rate (1.5×)
            const ot = m.id === c.machine.id ? Math.min(est.minutes, otMin) : 0, reg = est.minutes - ot, mult = s.labor.otMultiplier;
            const total = (reg / 60) * k.perHour + (ot / 60) * k.perHour * mult, rate = `$${k.perHour.toFixed(2).replace(/\.00$/, "")}/hr`;
            return <div className="ms-cost"><b>Labor ${Math.round(total).toLocaleString()}</b><span>{ot ? `${fmtMin(reg)} × ${rate} + ${fmtMin(ot)} overtime × ${mult} ` : `${fmtMin(est.minutes)} × ${rate} `}crew ({k.who.join(" + ")}) · ${(total / Math.max(1, glance(c.need, est.minutes).units)).toFixed(2)} a piece</span>{ot ? <small>Runs {fmtMin(ot)} in overtime: ${Math.round((ot / 60) * k.perHour * (mult - 1)).toLocaleString()} more than straight time</small> : null}</div>;
          })()}
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
            {c.job.kind !== "h" ? <Link className="btn" href={c.job.href}>Open Job</Link> : null}
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
/* ---------- quick job specs (When Can We Print It? and the Planner) ---------- */
/** print / sew / press, by kind of machine (the tools follow the machine filter) */
const VERB: Record<MachineType, { v: string; s: string; ed: string }> = { screen: { v: "Print", s: "Prints", ed: "printed" }, embroidery: { v: "Sew", s: "Sews", ed: "sewn" }, heat: { v: "Press", s: "Presses", ed: "pressed" } };
const LOC_NAMES: Record<MachineType, string[]> = { screen: ["Front", "Back", "Sleeve", "Other"], embroidery: ["Left Chest", "Back", "Sleeve", "Other"], heat: ["Front", "Back", "Sleeve", "Other"] };
const blankQuick = (method: MachineType = "screen"): QuickJob => ({ method, qty: method === "embroidery" ? 48 : 144, garment: "tee", dark: false, locations: LOC_NAMES[method].map((name, i) => ({ name, colors: i === 0 && method !== "embroidery" ? (method === "screen" ? 4 : 1) : 0, stitches: i === 0 && method === "embroidery" ? 8000 : 0 })) });
function QuickJobForm({ v, onChange }: { v: QuickJob; onChange: (x: QuickJob) => void }) {
  const set = (x: Partial<QuickJob>) => onChange({ ...v, ...x });
  const setLoc = (i: number, x: Partial<QuickJob["locations"][number]>) => onChange({ ...v, locations: v.locations.map((l, k) => (k === i ? { ...l, ...x } : l)) });
  return (
    <div className="ms-qf">
      <div className="rv-seg">{([["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const).map(([k, l]) => <button key={k} type="button" className={v.method === k ? "on" : ""} onClick={() => set({ method: k, conds: [], speed: 100, locations: v.locations.map((x, i) => ({ ...x, name: LOC_NAMES[k][i] || x.name, stitches: k === "embroidery" && i === 0 && !x.stitches ? 8000 : x.stitches })) })}>{l}</button>)}</div>
      <div className="ms-qf-g">
        <label>Pieces<input type="number" min={1} step={12} value={v.qty || ""} onChange={(e) => set({ qty: Math.max(0, +e.target.value || 0) })} /></label>
        <label>Garment<select value={v.garment} onChange={(e) => set({ garment: e.target.value as QuickJob["garment"] })}><option value="tee">T-shirts / light</option><option value="heavy">Hoodies / heavy</option><option value="bag">Bags / totes</option>{v.method === "embroidery" && <option value="cap">Caps</option>}</select></label>
        {v.method === "screen" && <label className="check ms-qf-dark"><input type="checkbox" checked={v.dark} onChange={(e) => set({ dark: e.target.checked })} /> Dark garments (underbase)</label>}
      </div>
      <div className="ms-qf-l">
        {v.locations.map((l, i) => (
          <div key={i} className={"ms-qf-loc" + ((v.method === "embroidery" ? l.stitches : l.colors) ? " on" : "")}>
            <span>{l.name}</span>
            {v.method === "screen" && <select value={l.colors} onChange={(e) => setLoc(i, { colors: +e.target.value })}>{Array.from({ length: 13 }, (_, c) => <option key={c} value={c}>{c ? `${c} color${c === 1 ? "" : "s"}` : "—"}</option>)}</select>}
            {v.method === "embroidery" && <select value={l.stitches} onChange={(e) => setLoc(i, { stitches: +e.target.value })}><option value={0}>—</option>{[3000, 5000, 8000, 10000, 12000, 15000, 20000, 30000, 40000].map((x) => <option key={x} value={x}>{x / 1000}k stitches</option>)}</select>}
            {v.method === "heat" && <select value={l.colors ? 1 : 0} onChange={(e) => setLoc(i, { colors: +e.target.value })}><option value={0}>—</option><option value={1}>Yes</option></select>}
          </div>
        ))}
      </div>
      <label className="ms-qf-speed" title="A hard print (fine detail, specialty ink, tricky garment) runs slower; an easy one faster">
        <span>{v.method === "embroidery" ? "Sewing speed" : v.method === "heat" ? "Press speed" : "Print speed"}</span>
        <input type="range" min={50} max={150} step={5} value={v.speed ?? 100} onChange={(e) => set({ speed: +e.target.value })} />
        <b>{(v.speed ?? 100) === 100 ? "Normal" : (v.speed ?? 100) < 100 ? `${v.speed}% · hard print` : `${v.speed}% · easy print`}</b>
      </label>
      {v.method !== "heat" && (
        <div className="ms-qf-conds" role="group" aria-label="What makes this print slower or faster">
          <span className="ms-qf-cl">Sets the speed:</span>
          {condsFor(v.method).map((c) => { const on = (v.conds || []).includes(c.k); return (
            <button key={c.k} type="button" className={"ms-qf-cond" + (on ? " on" : "") + (c.f < 1 ? " slow" : " fast")} aria-pressed={on} title={`${c.tip} (${c.f < 1 ? "" : "+"}${Math.round((c.f - 1) * 100)}%)`}
              onClick={() => { const conds = on ? (v.conds || []).filter((x) => x !== c.k) : [...(v.conds || []), c.k]; set({ conds, speed: condSpeed(conds), locations: v.locations.map((l) => ({ ...l, puff: false })) }); }}>
              {c.label}<small>{c.f < 1 ? "−" : "+"}{Math.round(Math.abs(c.f - 1) * 100)}%</small>
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}

/** Planner: jobs we know are coming. Each holds its press time on the calendar until the real order is booked. */
function PlannerPanel({ s, today, holds, admin, spotOf, onSave, onRemove, onClose, method = "screen" }: { method?: MachineType; s: ProductionSettings; today: string; holds: Hold[]; admin: boolean; spotOf: (id: string) => string; onSave: (h: { name: string; customer: string; spec: QuickJob; due_date: string; due_time: number | null; notes: string }) => Promise<string>; onRemove: (id: string) => Promise<void>; onClose: () => void }) {
  const [adding, setAdding] = useState(holds.length === 0 && admin);
  const [name, setName] = useState(""), [cust, setCust] = useState(""), [spec, setSpec] = useState<QuickJob>(() => blankQuick(method)), [due, setDue] = useState(""), [at, setAt] = useState<number | null>(null), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const need = quickNeed(s, spec);
  const est = need.steps.length ? Math.min(...s.machines.filter((m) => m.active && fits(need, m)).map((m) => estimate(s, need, m).minutes), Infinity) : 0;
  async function save() {
    if (!due) { setErr("Pick the in-hands date."); return; }
    setBusy("save"); setErr("");
    const e = await onSave({ name: name.trim(), customer: cust.trim(), spec, due_date: due, due_time: at, notes: notes.trim() });
    setBusy("");
    if (e) { setErr(e); return; }
    setAdding(false); setName(""); setCust(""); setSpec(blankQuick(method)); setDue(""); setAt(null); setNotes("");
  }
  const hm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-whenp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Planner">
        <div className="pp-sheet-h"><b>Planner</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint" style={{ fontSize: 12.5 }}>Jobs you know are coming but don&apos;t have an order for yet. Each one holds its press time on the calendar (dashed purple, “PLAN”), just in time for its in-hands date, so When Can We Print It?, suggestions and Re-plan treat that time as taken. Drag it like any job; remove it once the real order is booked.</div>
          {holds.length > 0 && <ul className="ms-plan-l">{holds.map((h) => { const n = quickNeed(s, h.spec as QuickJob), sp = spotOf(h.id); return (
            <li key={h.id}>
              <span className="ms-plan-t"><b>{h.name || "Planned job"}{h.customer ? <span className="faint"> · {h.customer}</span> : null}</b><small>{(h.spec as QuickJob).qty || 0} pcs · {n.label || "—"}</small>{h.notes ? <small className="faint">{h.notes}</small> : null}</span>
              <span className="ms-plan-d"><b>In hands {h.due_date ? dayLbl(h.due_date) : "—"}{h.due_time != null ? ` ${clock(h.due_time)}` : ""}</b><small>{sp ? `Held: ${sp}` : "Not on the calendar yet"}</small></span>
              {admin ? <button type="button" className="btn sm danger" disabled={busy === h.id} onClick={async () => { setBusy(h.id); await onRemove(h.id); setBusy(""); }}>Remove</button> : <span />}
            </li>
          ); })}</ul>}
          {!holds.length && !adding && <div className="empty">Nothing planned yet.</div>}
          {admin && !adding && <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>+ Plan a Job</button>}
          {!admin && <div className="faint" style={{ fontSize: 12.5 }}>Owners and admins add and remove planned jobs.</div>}
          {adding && <div className="ms-plan-f">
            <div className="ms-qf-g">
              <label>Job name<input type="text" value={name} placeholder="Fall league shirts" onChange={(e) => setName(e.target.value)} /></label>
              <label>Customer<input type="text" value={cust} placeholder="Lakeside Running" onChange={(e) => setCust(e.target.value)} /></label>
            </div>
            <QuickJobForm v={spec} onChange={setSpec} />
            <div className="ms-qf-g">
              <label>In-hands date<input type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <label className="check ms-qf-dark"><input type="checkbox" checked={at != null} onChange={(e) => setAt(e.target.checked ? 600 : null)} /> Specific time</label>
              {at != null && <label>Needed by<input type="time" step={900} value={hm(at)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (!isNaN(h)) setAt(h * 60 + (m || 0)); }} /></label>}
              <label style={{ flex: 1, minWidth: 180 }}>Notes<input type="text" value={notes} placeholder="Waiting on art; blanks ordered" onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>{need.steps.length ? `About ${fmtMin(est)} of ${spec.method === "embroidery" ? "sewing" : "press"} time (${need.label}).` : "Pick at least one location."}</div>
            {err && <div className="pv-err">{err}</div>}
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy === "save" || !need.steps.length} onClick={save}>{busy === "save" ? "Holding time…" : "Save & Hold Time"}</button>
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}

/** When Can We Print It?: quick specs in, three dates out (soonest, aggressive, regular), and the AI's pick. */
function WhenPanel({ s, today, nowLabel, calc, onClose, method = "screen" }: { s: ProductionSettings; today: string; nowLabel: string; calc: (n: Need) => WhenResult | null; onClose: () => void; method?: MachineType }) {
  const [v, setV] = useState<QuickJob>(() => blankQuick(method));
  const vb = VERB[v.method];
  const [needBy, setNeedBy] = useState("");
  const [ai, setAi] = useState<{ headline: string; pick: string; why: string; customerLine?: string } | null>(null);
  const [aiSt, setAiSt] = useState<"" | "loading" | "off" | "error">("");
  const need = quickNeed(s, v);
  const r = v.qty > 0 ? calc(need) : null;
  const inHands = (end: number, soonest: boolean) => { const d = fromOrd(Math.floor((end - 1) / 1440)), m = end - Math.floor((end - 1) / 1440) * 1440; return soonest && m <= 15 * 60 ? d : plusWorkdays(d, Math.max(1, s.bufferDays)); };
  const printed = (o: WhenOpt) => fromOrd(Math.floor((o.end - 1) / 1440));
  const soon = r?.soonest ? { ...r.soonest, hands: inHands(r.soonest.end, true) } : null;
  const agg = r?.aggressive ? { ...r.aggressive, hands: inHands(r.aggressive.end, true) } : null;
  const reg = r?.open ? { ...r.open, hands: inHands(r.open.end, false) } : null;
  const slowHands = r?.slow ? [inHands(r.slow.end, false), plusWorkdays(today, s.turnDays)].sort().pop()! : null;
  const lateOf = (o: WhenOpt | null) => (o?.bumped || []).filter((x) => x.late);
  const key = JSON.stringify([v, needBy]);
  const [asked, setAsked] = useState("");
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  async function ask() {
    if (!r || !soon || !agg || !reg) return;
    setAsked(key); setAiSt("loading"); setAi(null);
    const d = (x: string) => dayLbl(x);
    const desc = (o: WhenOpt & { hands: string }) => `${vb.ed} ${d(printed(o))} ${clock(o.end % 1440)} on ${o.m.name}, in hands ${d(o.hands)}`;
    const push = (o: WhenOpt) => (o.bumped?.length ? `; pushes back ${o.bumped.length} job${o.bumped.length === 1 ? "" : "s"}${lateOf(o).length ? `, ${lateOf(o).length} would miss their date (${lateOf(o).map((x) => "#" + x.job.number).join(", ")})` : ", none late"}` : "; nothing moves");
    const j = await fetch("/api/production/when", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      now: nowLabel, job: `${v.qty} pcs · ${need.label || "no print locations"} · ${v.garment}${v.dark ? " · darks" : ""}${(v.speed ?? 100) !== 100 ? ` · runs at ${v.speed}% (${(v.speed ?? 100) < 100 ? "hard print" : "easy print"})` : ""}`, runTime: fmtMin(r.minutes), needBy: needBy ? d(needBy) : "",
      soonest: `${desc(soon)}${push(soon)}; adds ${fmtMin(soon.extra || 0)} of overtime/Saturday, about ${money(soon.cost || 0)} extra labor`,
      aggressive: `${desc(agg)}${push(agg)}; regular hours`,
      regular: `${desc(reg)}; fits the schedule as it is, nothing moves`,
      slow: `end of the line: in hands ${slowHands ? d(slowHands) : "?"}; after everything already booked`,
    }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the AI." }));
    if (j.off) setAiSt("off"); else if (j.error) setAiSt("error"); else { setAi(j); setAiSt(""); }
  }
  const col = (id: string, title: string, sub: string, hands: string | null, lines: ReactNode[]) => (
    <div className={"ms-when-c" + (ai?.pick === id ? " pick" : "") + (needBy && hands ? (hands <= needBy ? " ok" : " no") : "")}>
      <small>{title}{ai?.pick === id ? <em>Recommended</em> : null}</small>
      <b>{hands ? dayLbl(hands) : "—"}</b>
      <span className="faint">{sub}</span>
      {needBy && hands ? <span className={hands <= needBy ? "good" : "bad"}>{hands <= needBy ? "✓ Makes " : "✗ Misses "}{dayLbl(needBy)}</span> : null}
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-whenp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`When can we ${vb.v.toLowerCase()} it`}>
        <div className="pp-sheet-h"><b>When Can We {vb.v} It?</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <QuickJobForm v={v} onChange={setV} />
          <label className="ms-qf-need">Customer needs it by (optional)<input type="date" min={today} value={needBy} onChange={(e) => setNeedBy(e.target.value)} /></label>
          {!r ? <div className="faint">Enter the pieces and at least one print location.</div> : r.noMachine ? <div className="pv-err">No machine can run this ({need.needColors} screens on a {Math.max(...s.machines.filter((m) => m.type === "screen").map((m) => m.colors), 0)}-color press max).</div> : <>
            <div className="faint" style={{ fontSize: 12.5 }}>About <b>{fmtMin(r.minutes)}</b> of {v.method === "embroidery" ? "sewing" : "press"} time ({need.label}). Dates are when it&apos;s in the customer&apos;s hands, from today&apos;s schedule.</div>
            <div className="ms-when-g">
              {col("soonest", "Absolute soonest", "Jump the line + overtime", soon?.hands || null, soon ? [`${vb.s} ${dayLbl(printed(soon)).split(",")[0]} by ${clock(soon.end % 1440)} on ${shortName(soon.m)}`, soon.extra ? `Adds ${fmtMin(soon.extra)} of overtime / Saturday: ~${money(soon.cost || 0)} extra labor` : "No extra hours needed", soon.bumped?.length ? `Pushes back ${soon.bumped.length} job${soon.bumped.length === 1 ? "" : "s"}${lateOf(soon).length ? `, ${lateOf(soon).length} late (${lateOf(soon).slice(0, 3).map((x) => "#" + x.job.number).join(", ")})` : ", none late"}` : "Nothing has to move"] : [])}
              {col("aggressive", "Aggressive", "Push others back, none late", agg?.hands || null, agg ? [`${vb.s} ${dayLbl(printed(agg)).split(",")[0]} by ${clock(agg.end % 1440)} on ${shortName(agg.m)}`, agg.bumped?.length ? `Pushes back ${agg.bumped.length} job${agg.bumped.length === 1 ? "" : "s"}${lateOf(agg).length ? `, ${lateOf(agg).length} would be late` : ", all still on time"}` : "Nothing has to move", "Regular hours"] : [])}
              {col("regular", "Regular turn", "Fits the schedule as it is", reg?.hands || null, reg ? [`${vb.s} ${dayLbl(printed(reg)).split(",")[0]} on ${shortName(reg.m)}`, "Nothing moves", `${s.bufferDays} business day${s.bufferDays === 1 ? "" : "s"} to pack / ship`] : [])}
              {col("slow", "Slow boat", "End of the line", slowHands, r.slow ? [`After everything booked on ${shortName(r.slow.m)}`, `At least our ${s.turnDays}-day turn`, "Most room for art, blanks and surprises"] : [])}
            </div>
            <div className={"ms-adv-ai" + (aiSt === "loading" ? " loading" : "")}>
              <span className="ms-adv-i" aria-hidden>✦</span>
              {ai && asked === key ? <div><b>{ai.headline}</b><span>{ai.why}</span>{ai.customerLine && <span className="ms-when-say">Tell the customer: “{ai.customerLine}”</span>}</div>
                : aiSt === "loading" ? <div><b>Thinking it over…</b></div>
                : <div><span>{aiSt === "off" ? "AI advice is off (Settings → Assistant & AI)." : aiSt === "error" ? "The AI didn't answer. Try again." : "Get a recommendation on which date to promise."}</span><button type="button" className="btn sm ms-ai-b" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={ask}>✦ What Should We Promise?</button></div>}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

/** Overtime: each press crew's paid hours this pay week (Friday–Thursday), what's past 40, and what it costs. */
type OtRow = { m: Machine; w: WeekOT; used: number; unused: number; perHour: number | null; who: string[]; pay: number | null; premium: number | null; starts: { day: string; min: number } | null };
/** why a press can't print a job: no working flash for a dark / puff print, or more heads than even two rounds give */
function whyUnfit(need: Need, m: Machine) {
  if (need.type !== m.type) return `needs ${TYPE_LBL[need.type]}`;
  if (need.type !== "screen") return `${shortName(m)} can't run it right now`;
  if (need.steps.some((st) => flashesFor(st) > 0) && flashesOf(m) === 0) return `needs a flash (underbase or puff): ${shortName(m)} has none working`;
  return `needs ${stationsNeeded(need)} heads (screens + flashes): more than ${shortName(m)} can print, even in two rounds`;
}
/** where the press operator is on the time clock today: in (and when), not in yet, clocked out */
function ClockTag({ m }: { m: Machine }) {
  const c = m.clock; if (!c) return null;
  const t = c.at == null ? "" : clockLong(c.at);
  const [txt, tip] = c.state === "in" ? [`In ${t}`, `${c.who} clocked in at ${t}`] : c.state === "late" ? [`In ${t} · late`, `${c.who} clocked in late at ${t}: nothing ran on this press before then`] : c.state === "waiting" ? ["Not in yet", `${c.who} hasn't clocked in: jobs on this press wait until they do (the schedule moves every few minutes)`] : c.state === "out" ? [`Out ${t}`, `${c.who} clocked out at ${t}`] : c.state === "crew" ? [`${c.who}: no punch`, `${c.who} hasn't clocked in, but ${c.crew?.length ? c.crew.join(" and ") : "the crew"} did (from ${t}), so the press is running. Fix the missing punch in uAttend.`] : ["No punch today", `${c.who} didn't clock in today`];
  return <span className={"ms-clk " + c.state} title={`${tip} (time clock)`}>{txt}</span>;
}
/** a little warning on a press's name when Equipment Status says something's wrong with it */
function IssueTag({ m }: { m: Machine }) {
  const x = m.issue; if (!x) return null;
  const unit = m.type === "screen" ? "colors" : "heads";
  const what = x.down ? "Down" : [x.colors != null ? `${x.colors}/${x.full} ${unit}` : "", x.flashes != null ? `${x.flashes}/${x.fullFlashes} flash` : "", x.speed != null ? `${x.speed}% speed` : ""].filter(Boolean).join(" · ");
  return <span className={"ms-iss" + (x.down ? " down" : "")} title={`${what}${x.note ? ` · ${x.note}` : ""}${x.until ? ` · expected fixed ${dayLbl(x.until)}` : ""} (Equipment Status)`}>⚠ {what}</span>;
}
/**
 * Equipment Status: the production manager marks what's wrong with each press or machine. Heads out on an 8-color
 * press → it runs 6 colors (jobs needing 7–8 screens go to a press that can print them); running slow → jobs take
 * longer; down → nothing runs on it until the day it's expected back. Fixed → back to normal.
 */
function EquipmentPanel({ machines, rows, today, me, crewOf, stuck, booked, onClose, onSaved }: { machines: Machine[]; rows: EquipRow[]; today: string; me: string; crewOf: (m: Machine) => Crew | undefined; stuck: (m: Machine, colors: number, flashes: number) => string[]; booked: (m: Machine) => number; onClose: () => void; onSaved: (msg: string, replan: boolean) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState<{ state: "ok" | "issue" | "down"; colors: number; flashes: number; speed: number; note: string; until: string; lay: Station[] | null }>({ state: "ok", colors: 0, flashes: 0, speed: 100, note: "", until: "", lay: null });
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const full = (m: Machine) => m.issue?.full ?? (m.type === "screen" ? m.colors : m.heads);
  const fullFl = (m: Machine) => m.issue?.fullFlashes ?? flashesOf(m);
  const unit = (m: Machine) => (m.type === "screen" ? "colors (heads)" : m.type === "embroidery" ? "heads" : "");
  // the press as it's set up now: its saved layout, or the usual one with any older "N of 12 working" marked on it
  const layOf = (m: Machine): Station[] => {
    if (m.layout) return [...m.layout];
    const l = defaultLayout(full(m), fullFl(m)), x = m.issue;
    if (x?.colors != null) for (let i = l.length - 1, k = full(m) - x.colors; i >= 0 && k > 0; i--) if (l[i] === "print") { l[i] = "down"; k--; }
    if (x?.flashes != null) for (let i = l.length - 1, k = fullFl(m) - x.flashes; i >= 0 && k > 0; i--) if (l[i] === "flash") { l[i] = "flashdown"; k--; }
    return l;
  };
  // set one head: a fault moves the status to "Problem, still running"; clearing the last one moves it back
  const setHead = (i: number, s: Station) => {
    if (!f.lay) return;
    const lay = f.lay.map((x, j) => (j === i ? s : x)), c = layoutCounts(lay);
    const state = f.state === "down" ? "down" : c.down || c.broken ? "issue" : f.state === "issue" && f.speed === 100 ? "ok" : f.state;
    setF({ ...f, lay, state, colors: full0 - c.down, flashes: c.flashes });
  };
  const full0 = edit ? full(machines.find((x) => x.id === edit)!) : 0;
  const headsTxt = (xs: number[]) => (!xs.length ? "" : xs.length === 1 ? `head ${xs[0]}` : `heads ${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const faultNote = (l: Station[]) => { const d = l.flatMap((s, i) => (s === "down" ? [i + 1] : [])), b = l.flatMap((s, i) => (s === "flashdown" ? [i + 1] : [])); return [d.length ? `${headsTxt(d)} down` : "", b.length ? `flash at ${headsTxt(b)} not heating` : ""].filter(Boolean).join("; ").replace(/^./, (ch) => ch.toUpperCase()); };
  const open = (m: Machine) => {
    const r = rows.find((x) => x.machine === m.id), live = !!m.issue;
    setF({ state: !live ? "ok" : r?.down ? "down" : "issue", colors: live && r?.colors_working != null ? r.colors_working : full(m), flashes: live && r?.flashes_working != null ? r.flashes_working : fullFl(m), speed: live && r?.speed != null ? r.speed : 100, note: live ? r?.note || "" : "", until: live ? r?.until || "" : "", lay: m.type === "screen" ? layOf(m) : null });
    setEdit(m.id); setErr(""); setPick(null);
  };
  async function save(m: Machine) {
    setBusy(true); setErr("");
    const fixed = f.state === "ok", sb = createClient(), fl = full(m);
    // screen presses: the layout says it all (heads down, flashes working, where the flashes sit); fixed clears the faults
    const lay = f.lay ? (fixed ? f.lay.map((s) => (s === "down" ? "print" : s === "flashdown" ? "flash" : s)) : f.lay) : null;
    const lc = lay ? layoutCounts(lay) : null, units = lc ? lc.units : fullFl(m);
    const colorsW = lc ? fl - lc.down : f.colors, flashW = lc ? lc.flashes : f.flashes;
    const row = fixed ? { machine: m.id, colors_working: null, flashes_working: null, speed: null, down: false, note: "", since: null, until: null, stations: lay } : { machine: m.id, colors_working: f.state === "issue" && m.type !== "heat" && colorsW < fl ? colorsW : null, flashes_working: f.state === "issue" && m.type === "screen" && flashW < units ? flashW : null, speed: f.state === "issue" && f.speed !== 100 ? f.speed : null, down: f.state === "down", note: f.note.trim() || (lay ? faultNote(lay) : ""), since: m.issue?.since || today, until: f.until || null, stations: lay };
    if (!fixed && !row.down && row.colors_working == null && row.flashes_working == null && row.speed == null) { setBusy(false); setErr(m.type === "screen" ? "Tap a head that's down or a flash that isn't heating, or pick how slow it's running (or mark it down)." : `Pick how many ${unit(m) || "units"} are working, or how slow it's running (or mark it down).`); return; }
    const r = await sb.from("production_equipment").upsert({ ...row, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: "machine" });
    if (r.error) { setBusy(false); setErr(r.error.message); return; }
    await sb.from("production_equipment_log").insert({ machine: m.id, colors_working: row.colors_working, flashes_working: row.flashes_working, speed: row.speed, down: row.down, note: row.note, until: row.until, cleared: fixed, by: me, stations: lay });
    setBusy(false); setEdit(null);
    const name = shortName(m), lost = !fixed && !row.down ? stuck(m, row.colors_working ?? fl, row.flashes_working ?? units) : [];
    if (fixed) onSaved(m.issue ? `${name} is back to normal.` : lay ? `${name} press layout saved: flashes at ${headsTxt(lay!.flatMap((s, i) => (s === "flash" ? [i + 1] : []))) || "no heads"}.` : `${name} saved.`, !!m.issue || (units !== fullFl(m) && stuck(m, fl, units).length > 0));
    else if (row.down) onSaved(`${name} marked down${row.until ? ` until ${dayLbl(row.until)}` : ""}.${booked(m) ? ` ${booked(m)} job${booked(m) === 1 ? " is" : "s are"} booked on it.` : ""}`, booked(m) > 0);
    else onSaved(`${name}: ${[lay ? `flashes at ${headsTxt(lay.flatMap((s, i) => (s === "flash" ? [i + 1] : []))) || "no heads"}` : "", row.colors_working != null ? `${row.colors_working} of ${fl} ${m.type === "screen" ? "colors" : "heads"} working` : "", row.flashes_working != null ? `${row.flashes_working} of ${units} flashes working` : "", row.speed != null ? `running at ${row.speed}%` : ""].filter(Boolean).join(", ")}.${lost.length ? ` ${lost.length} booked job${lost.length === 1 ? " needs" : "s need"} more heads (screens + flashes) than it can print now (${lost.slice(0, 6).join(", ")}).` : ""}`, lost.length > 0 || row.speed != null);
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-eq" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Equipment status">
        <div className="pp-sheet-h"><b>Equipment Status</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint" style={{ fontSize: 12.5 }}>Tell the schedule what&apos;s wrong with a press. A flash takes a head&apos;s spot (dark prints flash the underbase, puff flashes too), so a job needing more heads than the press has runs in two rounds, twice the press time. Heads or flashes out: it only gets jobs it can print (and booked jobs that need more screens go to another press when you re-plan). Running slow: jobs on it take longer. Down: nothing runs on it until it&apos;s back.</div>
          <ul className="ms-eq-list">
            {machines.map((m) => {
              const x = m.issue, c = crewOf(m), fl = full(m);
              return (
                <li key={m.id} className={x ? (x.down ? "down" : "warn") : ""}>
                  <div className="ms-eq-row">
                    {m.type === "screen" && <button type="button" className="pl-mini" title="Press layout: where the flashes are, heads down" onClick={() => open(m)}><PressLayout layout={layOf(m)} size={56} mirror={!!m.mirror} /></button>}
                    <span><b>{shortName(m)}</b>{c ? <span className="faint"> · {c.leader}</span> : null}<small className="faint"> · {m.type === "screen" ? `${fl} colors, ${fullFl(m)} flash${fullFl(m) === 1 ? "" : "es"}` : m.type === "embroidery" ? `${fl} heads` : "heat press"}</small></span>
                    <span className={"ms-eq-st" + (x ? (x.down ? " down" : " warn") : " ok")}>{!x ? "Working normally" : x.down ? `Down${x.until ? ` until ${dayShort(x.until)}` : ""}` : [x.colors != null ? `${x.colors} of ${x.full} ${m.type === "screen" ? "colors" : "heads"}` : "", x.flashes != null ? `${x.flashes} of ${x.fullFlashes} flashes` : "", x.speed != null ? `${x.speed}% speed` : ""].filter(Boolean).join(" · ")}</span>
                    {edit !== m.id && <button type="button" className="btn sm" onClick={() => open(m)}>{x ? "Update" : "Report a Problem"}</button>}
                  </div>
                  {x?.note && edit !== m.id && <div className="faint ms-eq-note">{x.note}{x.by ? ` · ${x.by.split("@")[0]}` : ""}{x.since ? `, since ${dayShort(x.since)}` : ""}</div>}
                  {edit === m.id && (
                    <div className="ms-eq-ed">
                      <div className="ms-eq-seg">
                        {([["ok", "Working normally"], ["issue", "Problem, still running"], ["down", "Down"]] as const).map(([k, l]) => <button key={k} type="button" className={f.state === k ? "on" : ""} onClick={() => setF({ ...f, state: k, lay: k === "ok" && f.lay ? f.lay.map((s) => (s === "down" ? "print" : s === "flashdown" ? "flash" : s)) : f.lay })}>{l}</button>)}
                      </div>
                      {m.type === "screen" && f.lay && f.state !== "down" && (() => {
                        const lc = layoutCounts(f.lay), fx = f.lay.flatMap((s, i) => (s === "flash" || s === "flashdown" ? [i + 1] : []));
                        return (
                          <div className="pl-ed">
                            <PressLayout layout={f.lay} mirror={!!m.mirror} selected={pick} onPick={(i) => setPick(pick === i ? null : i)} label={`${fl - lc.down} colors`} sub={`${fl + 2} stations`} />
                            <div className="pl-side">
                              <div className="pl-sum"><b>{fl} heads + load &amp; unload</b><span>{lc.units ? `Flash${lc.units === 1 ? "" : "es"} at ${headsTxt(fx)}` : "No flashes on the press"}{lc.down ? ` · ${lc.down} head${lc.down === 1 ? "" : "s"} down` : ""}{lc.broken ? ` · ${lc.broken} flash${lc.broken === 1 ? "" : "es"} not heating` : ""}</span></div>
                              {pick == null ? <div className="faint pl-hint">Tap a head to move a flash there, or to report it down.</div> : (
                                <div className="pl-pick">
                                  <div className="pl-pick-h">Head {pick + 1}</div>
                                  {([["print", "Printing"], ["flash", "Flash"], ["down", "Head down"], ["flashdown", "Flash not heating"]] as const).map(([k, l]) => <button key={k} type="button" className={"pl-opt " + k + (f.lay![pick] === k ? " on" : "")} onClick={() => setHead(pick, k)}><i aria-hidden />{l}</button>)}
                                </div>
                              )}
                              <div className="pl-key"><span><i className="print" />Printing</span><span><i className="flash" />Flash</span><span><i className="down" />Down</span><span><i className="load" />Load / unload</span></div>
                              <button type="button" className="linkbtn" onClick={() => { setF({ ...f, lay: defaultLayout(fl, Math.max(1, lc.units)), state: f.state === "issue" && f.speed === 100 ? "ok" : f.state }); setPick(null); }}>Reset to the usual layout</button>
                            </div>
                          </div>
                        );
                      })()}
                      {f.state === "issue" && (
                        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                          {m.type === "embroidery" && <label className="ms-eq-f">{"Heads working"}<select value={f.colors} onChange={(e) => setF({ ...f, colors: +e.target.value })}>{Array.from({ length: fl }, (_, i) => fl - i).map((n) => <option key={n} value={n}>{n} of {fl}{n === fl ? " (all)" : ""}</option>)}</select></label>}
                          <label className="ms-eq-f">Speed<select value={f.speed} onChange={(e) => setF({ ...f, speed: +e.target.value })}>{[100, 90, 80, 75, 70, 60, 50, 40].map((n) => <option key={n} value={n}>{n === 100 ? "Normal" : `${n}% (slower)`}</option>)}</select></label>
                        </div>
                      )}
                      {f.state !== "down" && m.type === "screen" && f.lay && (() => { const lc = layoutCounts(f.lay), cw = fl - lc.down, s0 = stuck(m, cw, lc.flashes); return s0.length > 0 && <div className="ms-ask"><b>{s0.length} booked job{s0.length === 1 ? " needs" : "s need"} more than {cw} heads ({lc.flashes} flash{lc.flashes === 1 ? "" : "es"}), even in two rounds</b><span>{s0.slice(0, 10).join(", ")}. After saving, Re-plan moves them to a press that can print them.</span></div>; })()}
                      {f.state !== "ok" && <>
                        <label className="ms-eq-f">What&apos;s wrong<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={m.type === "screen" ? "e.g. not indexing (leave blank and we note which heads)" : "e.g. waiting on a part"} /></label>
                        <label className="ms-eq-f">Expected fixed (optional)<input type="date" value={f.until} min={addDay(today, 1)} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>
                        {f.state === "down" && <div className="faint" style={{ fontSize: 12.5 }}>{f.until ? `Nothing runs on it through ${dayLbl(addDay(f.until, -1))}.` : "Nothing runs on it until it's marked fixed."}{booked(m) ? ` ${booked(m)} job${booked(m) === 1 ? " is" : "s are"} booked on it: re-plan after saving to move them.` : ""}</div>}
                      </>}
                      {err && <div className="ms-ask">{err}</div>}
                      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                        <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
                        <button type="button" className="btn primary" disabled={busy} onClick={() => save(m)}>{busy ? "Saving…" : f.state === "ok" ? (x ? "Mark Fixed" : "Save") : "Save"}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
function OvertimePanel({ today, thisWeek, nextWeek, mult, leader, onClose, onCut }: { today: string; thisWeek: OtRow[]; nextWeek: OtRow[]; mult: number; leader: (m: Machine) => string; onClose: () => void; onCut: (rows: OtRow[]) => Promise<void> }) {
  const [wk, setWk] = useState<"this" | "next">("this");
  const [busy, setBusy] = useState(false);
  const rows = wk === "this" ? thisWeek : nextWeek, ws = rows[0]?.w.weekStart;
  const tot = rows.reduce((t, r) => t + r.w.ot, 0), pay = rows.reduce((t, r) => t + (r.pay || 0), 0), prem = rows.reduce((t, r) => t + (r.premium || 0), 0), unused = rows.reduce((t, r) => t + r.unused, 0);
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const h = (min: number) => (min ? fmtMin(min) : "—");
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed ms-otp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Overtime">
        <div className="pp-sheet-h"><b>Overtime</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="rv-seg">{([["this", "This pay week"], ["next", "Next pay week"]] as const).map(([k, l]) => <button key={k} type="button" className={wk === k ? "on" : ""} onClick={() => setWk(k)}>{l}</button>)}</div>
            {ws && <span className="faint" style={{ fontSize: 12.5 }}>{dayLbl(ws)} – {dayLbl(addDay(ws, 6))} · overtime is past 40 paid hours, lunch unpaid · {mult}× pay</span>}
          </div>
          <div className="ms-ot-sum">
            <div><b>{tot ? fmtMin(tot) : "None"}</b><small>overtime on the schedule</small></div>
            <div><b>{pay ? money(pay) : "—"}</b><small>overtime pay{prem ? ` (${money(prem)} over straight time)` : ""}</small></div>
            <div><b>{unused ? fmtMin(unused) : "—"}</b><small>of it with no jobs booked</small></div>
          </div>
          {!rows.length ? <div className="empty">No press crews in view. Staff them on Employees → People &amp; Teams.</div> : (
            <div className="ms-ot-t">
              <div className="ms-ot-r h"><span>Crew</span><span title="The crew's paid hours this week; with the time clock, the crew member with the most hours">Paid hours</span><span>Overtime</span><span>Starts</span><span>Booked in OT</span><span>OT pay</span></div>
              {rows.map((r) => (
                <div key={r.m.id} className={"ms-ot-r" + (r.w.ot ? " on" : "")}>
                  <span><b>{shortName(r.m)} · {leader(r.m)}</b><small>{r.who.length ? r.who.join(" + ") + "/hr" : r.perHour == null ? "no rates (owners see pay)" : ""}</small>
                    {wk === "this" && r.m.crewHours && <small className="ms-ot-mem">{r.m.crewHours.members.map((x) => <span key={x.id} className={x.projected > 2400 ? "bad" : ""} title={`${x.name} (${x.role}): ${fmtMin(x.worked)} on the clock since ${dayLbl(r.m.crewHours!.ws)}, on pace for ${fmtMin(x.projected)} by Thursday${x.missing ? " · a punch is missing" : ""}`}>{x.name} {fmtMin(x.worked)}{x.projected > 2400 ? ` → ${fmtMin(x.projected)}` : ""}{x.missing ? " ⚠" : ""}</span>)}</small>}
                  </span>
                  <span>{fmtMin(r.w.paid)}</span>
                  <span className={r.w.ot ? "bad" : ""}>{h(r.w.ot)}</span>
                  <span>{r.starts ? `${r.starts.day === today ? "Today" : dayLbl(r.starts.day).split(",")[0]} ${clock(r.starts.min)}` : "—"}</span>
                  <span>{r.w.ot ? `${r.used ? fmtMin(r.used) : "none"}${r.unused ? ` · ${fmtMin(r.unused)} free` : ""}` : "—"}</span>
                  <span>{r.pay != null && r.w.ot ? `~${money(r.pay)}` : "—"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="faint" style={{ fontSize: 12.5 }}>From the schedule (crew hours, extra shifts, days off and early finishes) plus the time clock: each crew member's real hours so far this week, so a crew goes into overtime as soon as any one of them passes 40 hours. The planner and Re-plan steer work away from crews in overtime when another press can still make the date. Hours in overtime with no jobs booked can be cut: the crew leaves when their work is done.</div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={onClose}>Close</button>
            {wk === "this" && unused > 0 && <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onCut(rows.filter((r) => r.unused > 0)); setBusy(false); }}>Cut {fmtMin(unused)} of Unused Overtime</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Get Recommendations: the simulated options side by side, and Claude's pick (or the cheapest full fix when AI is off). */
type Advice = { headline: string; pick: string; why: string; runnersUp?: { id: string; why: string }[]; ideas?: string[] };
function AdvisePanel({ options, late, lateBefore, labor, otNote, machinesLabel, nowLabel, onClose, onApply }: { options: WhatIf[]; late: { job: string; customer: string; inHands: string; why: string }[]; lateBefore: number; labor: { crewSize: number; wage: number; otMultiplier: number }; otNote: string; machinesLabel: string; nowLabel: string; onClose: () => void; onApply: (w: WhatIf) => Promise<void> }) {
  const [opts] = useState(options);
  const [ai, setAi] = useState<Advice | null>(null);
  const [aiState, setAiState] = useState<"loading" | "done" | "off" | "error">("loading");
  const [aiMsg, setAiMsg] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let dead = false;
    fetch("/api/production/advise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: nowLabel, lateBefore, late, labor, overtime: otNote, machines: machinesLabel, options: opts.map((o) => ({ id: o.id, title: o.title, detail: o.detail, lateAfter: o.lateAfter, stillLate: o.stillLate, addedHours: o.addedHours, cost: o.cost, splits: o.splits })) }) })
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
  const rows = cards.filter((c) => c.slot && !c.fromPv && c.job.kind !== "h" && machines.some((m) => m.id === c.machine.id) && (c.day === asDay || c.slot.status === "running" || c.slot.status === "paused"))
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
