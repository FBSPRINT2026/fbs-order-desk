"use client";
import { useProdSide } from "@/lib/prodSide";
import { runParts, sampleRunOn, samplePieces, waitsOnSample } from "@/lib/samples";
import { trainingSaid } from "@/lib/orderTrainings";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import SepRequest from "@/components/SepRequest";
import WorkOrderView from "@/components/WorkOrderView";
import { colorHex } from "@/lib/inkColors";
import { createClient } from "@/lib/supabase/client";
import { withPace, operatorOf, parseDuration, type RunLesson } from "@/lib/runLearn";
import { setRunTime, learnRun } from "@/app/shop/run-time-actions";
import { addTask } from "@/app/shop/myday-actions";
import { seedStyleTitles, mergeProduction, estimateRaw, locKey, artsOf, MIN_JOB_MIN, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, shiftOn, typicalShift, isOffDay, windowsIn, downsOn, breaksOn, lunchStart, LUNCH_EARLIEST, CREW_ROLES, otFromOn, weekOvertime, payWeekStart, type WeekOT, quickNeed, plusWorkdays, minusWorkdays, type QuickJob, condsFor, condSpeed, withIssue, withClock, withCrewHours, type ClockPunch, type EquipRow, type Station, defaultLayout, layoutCounts, flashesOf, flashesFor, stationsNeeded, pressOnlyOf, subNeed, restNeed, locsOf, PV_READY, type Machine, type Crew, type Down, type Need, type ProductionSettings, type Suggestion, type MachineType } from "@/lib/production";
import { mergeSettings, isMe, ST, type StatusKey, type Group, type AccountOwner } from "@/lib/pricing";
import { orderStatusEmail } from "@/app/shop/customer-email-actions";
import CheckinModal from "@/components/CheckinModal";
import { styleTitles } from "@/app/shop/style-title-actions";
import type { CheckJob, CheckLine } from "@/lib/checkinShared";
import { useSticky } from "@/lib/useSticky";
import PressLayout from "@/components/PressLayout";
import ScheduleStartPoint from "@/components/ScheduleStartPoint";
import { useCan, useRole } from "@/components/RoleContext";
import { allRows } from "@/lib/readAll";

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
type Job = { /** the customer (orders only): which of their kinds of order it is (their Create order trainings) */ cid?: string; /** a pre-production sample run of the order (its own card), or the order's full run waiting on one (lib/samples.ts) */ sample?: "run" | "only"; waits?: boolean; key: string; kind: "o" | "a" | "h"; id: string; number: string; customer: string; name: string; due: string | null; /** the order's production date: it runs that day, never earlier (Nine18's weekly run; Nov 11) */ prod?: string | null; qty: number; status: string; needs: Need[]; href: string; owner: string; rush?: boolean; firm?: boolean; dueTime?: number | null;
  /** a hold from a quote (Hold the spot): its order, when its details are due, who held it */ hold?: { orderId: string | null; detailsDue: string | null; by: string; art: string } };
/** when a job has to be done (absolute minutes): end of its in-hands day, or the set time on a firm date */
const dueAbs = (j: Job) => (j.due ? ord(j.due) * 1440 + (j.dueTime != null ? j.dueTime : 1440) : Infinity);
/** a quote's held spot: waiting (details not due yet), due (its details are due today), late (past due, not approved) */
const holdState = (j: Job): "" | "wait" | "due" | "late" => {
  if (j.kind !== "h" || !j.hold?.detailsDue) return "";
  const t = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return t > j.hold.detailsDue ? "late" : t === j.hold.detailsDue ? "due" : "wait";
};
const holdTag = (j: Job) => { const st = holdState(j); if (!st) return null; const d = new Date(j.hold!.detailsDue + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }); return <b className={"msh-tag " + st}>{st === "late" ? "Late on details" : st === "due" ? "Details due today" : `Details due ${d}`}</b>; };
/** 🔥 rush, ⛰️ firm date */
/** a job's number on its card: a link to the job (Nov 11, Nick: "you click the job number, it doesn't go to the job") */
const numLink = (j: Job) => (j.href ? <a className="ms-numl" href={j.href} draggable={false} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>#{j.number}</a> : <>#{j.number}</>);
// rush and firm as small words on the right of the job's line, no emoji (Nov 12, Nick: "the little rock… get rid of that…
// move [Firm] to the right side of the box")
const flags0 = (j: Job) => (j.rush || j.firm ? <span className="mfl">{j.rush ? <em className="mfl-rush" title="Rush">Rush</em> : null}{j.firm ? <em className="mfl-firm" title={`Firm: needed ${firmLbl(j)}`}>Firm · {firmLbl(j)}</em> : null}</span> : null);
/** a job's small tags: rush / firm, and a sample run or a full run waiting on its sample (Nov 11, Nick; lib/samples.ts) */
const flags = (j: Job) => <>{flags0(j)}{j.sample ? <em className="ms-smp" title={j.sample === "run" ? "The order's pre-production sample run" : "A sample order"}>Sample</em> : null}{j.waits ? <em className="ms-smpw" title="The full run waits for the customer's OK on the sample">Waits for sample OK</em> : null}</>;
/** why a job is where it is (Nov 11 2026, Nick): the schedule put it there (sparkle), a person did, it's locked, or
 *  it only fits that press */
function WhyIcon({ w, title }: { w: "lock" | "cap" | "me" | "ai"; title: string }) {
  return <span className={"msf-why " + w} title={title} aria-label={title}>{w === "ai" ? <svg viewBox="0 0 16 16"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" /></svg>
    : w === "me" ? <svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3" /><path d="M2.5 15c0-3.2 2.5-5.3 5.5-5.3s5.5 2.1 5.5 5.3z" /></svg>
    : w === "lock" ? <svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" rx="1.5" /><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
    : <svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="7.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>}</span>;
}
const firmLbl = (j: Job) => (j.due ? `${new Date(j.due + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}${j.dueTime != null ? " " + clock(j.dueTime) : ""}` : "");
type Slot = { /** a booking of the order's sample run */ sample?: boolean; id: string; order_id: string | null; archived_order_id: string | null; /** Jose's lock (Nov 11 2026): spot = press + time, press, day; re-plan never moves it */ locked?: "spot" | "press" | "day" | "person" | null; /** a Planner hold (a job we know is coming) */ hold_id?: string | null; machine: string; day: string; position: number; minutes: number; start_min: number | null; kind: string; label: string; status: "scheduled" | "running" | "paused" | "done"; /** a running job's finish time set by hand (Where things stand) */ ends_at?: string | null; source: string; note: string; rolled_from: string | null;
  /** job log: when it really started / finished, how far along (0–1) as of progress_at; which print locations this booking covers (null = all) */
  started_at?: string | null; finished_at?: string | null; progress?: number; progress_at?: string | null; locations?: string[] | null };
/** a job on the calendar; startMin = asked-for start (minutes after midnight), null = right after the job before it */
type Card = { key: string; job: Job; need: Need; machine: Machine; day: string; minutes: number; startMin: number | null; slot: Slot | null; fromPv: boolean; /** a job printing since today: when it started and the time it was figured to take (the Printing strip) */ plan?: { start: number; est: number }; carried?: string | null; /** runs right after a job with the same art: the setup it skips */ sameArt?: { with: string; saved: number } };
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
type View = "flow" | "split" | "timeline" | "day";
type Drag = { card?: Card; job?: Job; need?: Need; grabMin: number; /** a same-art run dragged by its header: every job in it moves */ group?: Card[]; /** Shift held: pin it to the exact time it's dropped at (Nov 11, Nick) */ pin?: boolean };
type WhatIf = { id: string; kind: "split" | "ot" | "sat" | "combo"; title: string; detail: string; split: boolean; shifts: { machine: string; crew_id: string | null; day: string; start_min: number; end_min: number }[]; splits: number; lateAfter: number; stillLate: string[]; addedHours: number; cost: number };
type WhenOpt = { m: Machine; start: number; end: number; minutes: number; ot: number; extra?: number; cost?: number; bumped?: { job: Job; late: boolean }[] };
type WhenResult = { need: Need; minutes: number; soonest: WhenOpt | null; aggressive: WhenOpt | null; open: WhenOpt | null; slow: WhenOpt | null; noMachine: boolean };
type Hold = { id: string; name: string; customer: string; spec: QuickJob | Record<string, never>; due_date: string | null; due_time: number | null; notes: string; status: string; created_by: string; created_at: string; order_id?: string | null; details_due?: string | null; art?: string };
/** Hold the spot from a quote: what the order page asks the hidden schedule to place */
export type HoldAsk = { orderId: string; number: number; name: string; customer: string; spec: QuickJob; due: string; art: string; onDone: (r: { ok: boolean; msg: string }) => void };
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
/** a group's title: the customer's short name and what its jobs' names share ("Nine18 · AMS") (Nov 11, Nick) */
const runTitle = (js: { customer: string; name: string }[]) => {
  const co = abbrCo(js[0]?.customer || ""), w = co.split(/\s+/), short = co.length > 14 && w[0].length >= 3 ? w[0] : co;
  const ws = js.map((j) => (j.name || "").split(/\s+/)), pre: string[] = [];
  for (let i = 0; ws.every((x) => x[i] && x[i].toLowerCase() === ws[0][i].toLowerCase()); i++) pre.push(ws[0][i]);
  const p = pre.join(" ").replace(/[-·,:]+$/, "").trim();
  return p && js.length > 1 ? `${short} · ${p}` : short;
};
const abbrCo = (n: string) => n.replace(/[,.]?\s+(company|co|inc|llc|l\.l\.c|corp|corporation|ltd|limited)\.?$/i, "").replace(/\s+(and|&)\s+/gi, " & ").trim() || n;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const PV_DONE = /job\s*completed|quote|cancel|ship|fulfillment|issue/i;
// the machine kinds (picked from the menu's SP / EMB / HP now; kept for the names)
export const TYPE_OPTS = [["", "All"], ["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const;
const VIEW_OPTS = [["flow", "Next 12 hours"], ["timeline", "Week"], ["day", "Day"]] as const;
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
    const fixedMe = fixedAt.get(c.key);
    let t = fixedMe ? norm(planned, true) : norm(Math.max(cursor, asked), cursor < asked && c.startMin != null && asked === planned);
    const free = t;
    // lay it out from t; if another part of this job is on another machine then, start after that part is done
    const lay = (t0: number) => {
    let t = t0, left = Math.max(1, c.minutes);
    const pieces: Piece[] = [];
    for (let g = 0; g < 400 && left > 0.01; g++) {
      let dd = Math.floor(t / 1440), m = t - dd * 1440, w = wins(fromOrd(dd)).find(([, y]) => m < y);
      // don't start a longer job in the last few minutes of a window: start it in the next one
      if (g === 0 && w && w[1] - m < 10 && left / w[2] > w[1] - m) { t = norm(dd * 1440 + w[1]); dd = Math.floor(t / 1440); m = t - dd * 1440; w = wins(fromOrd(dd)).find(([, y]) => m < y); }
      // nor a sliver at the end of the day: a job that won't finish today and would get under an hour in starts the next
      // morning; the crew goes home a little early instead of warming up the press for it (Nov 11, Nick)
      if (g === 0) { const dl = wins(fromOrd(dd)).reduce((x, [a0, b0, r0]) => x + Math.max(0, b0 - Math.max(a0, m)) * r0, 0); if (dl < left - 0.5 && dl < DAY_TAIL) { t = norm((dd + 1) * 1440); dd = Math.floor(t / 1440); m = t - dd * 1440; w = wins(fromOrd(dd)).find(([, y]) => m < y); } }
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
      // a locked job's time is taken: a job that would run into it starts after it instead
      const fx = fixedMe ? undefined : [...fixedAt.entries()].find(([k2, [a, b]]) => k2 !== c.key && r.pieces.some((p) => ord(p.day) * 1440 + p.start < b && ord(p.day) * 1440 + p.end > a));
      if (!hit && !fx) break;
      if (hit) blocked = true;
      t = norm(hit ? hit[1] : fx![1][1]); r = lay(t);
    }
    return { t, r, planned, free, blocked };
  };
  // a job locked to its spot (Lock → this spot, or Shift + drag) is fixed: it runs at its own time whatever runs before it,
  // and the other jobs flow around it, finishing before it when they fit, else starting after it (Nov 11, Nick: "the
  // whole point is to lock its location": Make The Schedule's jobs carried into the morning and pushed #40408 down)
  const isFixed = (c: Card) => c.slot?.locked === "spot" && c.startMin != null && (c.slot.status === "scheduled" || c.slot.status === "paused");
  const fixedAt = new Map<string, [number, number]>();
  for (const c of sorted) if (isFixed(c)) { const a = ord(c.day) * 1440 + (c.startMin as number); fixedAt.set(c.key, [a, a + Math.max(15, c.minutes)]); }
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
    // the next job carries on from the latest work laid out (a fixed job laid early doesn't pull it back)
    cursor = fixedAt.has(c.key) ? Math.max(cursor, Number.isFinite(cursor) ? cursor : -Infinity) : r.end;
    if (fixedAt.has(c.key)) fixedAt.set(c.key, [ord(pieces[0]?.day || c.day) * 1440 + (pieces[0]?.start ?? 0), r.end]);
    busy.set(c.job.key, [...(busy.get(c.job.key) || []), ...pieces.map((p): [number, number, number] => [ord(p.day) * 1440 + p.start, ord(p.day) * 1440 + p.end, order.get(c.key) ?? 0])]);
    pieces.forEach((p, i) => out.push({ c, day: p.day, start: p.start, end: p.end, part: i + 1, parts: pieces.length, pushed: pushed && i === 0, work: p.work, slow: p.slow < 1 ? p.slow : undefined }));
  }
  if (lunchOut) for (const [d, at] of lunch) lunchOut.set(d, at);
  return out;
}

/** Every machine's work laid out on its hours, split into per-day pieces (the calendar, and a re-plan checked before it's applied). */
/** the least of a day worth starting a job that won't finish that day in (minutes): less, and it starts the next morning */
const DAY_TAIL = 60;
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

/** "When can we print it?" answered for an order that isn't booked yet (Inbox → Create order): in-hands dates per option */
export type WhenDates = { soonest: string | null; aggressive: string | null; regular: string | null; slow: string | null; press: string; minutes: number; noMachine: boolean };

/** the run times staff set on an order (orders.run_times, by print location) put on its steps */
const withRunTimes = (needs: Need[], rt: Record<string, { min: number; by: string }> | null | undefined): Need[] =>
  !rt ? needs : needs.map((n) => ({ ...n, steps: n.steps.map((st) => (rt[locKey(st)] ? { ...st, over: { min: +rt[locKey(st)].min, by: rt[locKey(st)].by } } : st)) }));
/** the customer and the job's name together (Nov 9, Nick: "I need to see the job names") */
const who = (j: { customer: string; name: string }) => (j.customer && j.name ? `${j.customer} · ${j.name}` : j.customer || j.name);

/** a press's breaks as the schedule draws them: the warm-up right after lunch joins lunch's band (min = lunch alone) */
function brkBands(bs: [number, number, string, ...unknown[]][]) {
  const out: { a: number; b: number; lunch: boolean; min: number; clock?: string }[] = [];
  for (const [a, b, why] of [...bs].sort((x, y) => x[0] - y[0])) {
    const warm = why === "Warm-up", last = out[out.length - 1];
    if (warm && last?.lunch && !last.clock && Math.abs(last.b - a) < 1) { last.b = b; continue; }
    out.push({ a, b, lunch: !warm, min: Math.round(b - a), ...(why.startsWith("Clock:") ? { clock: why.slice(6) } : {}) });
  }
  return out;
}

export default function MachineSchedule({ when, hold }: { /** hidden mode: no calendar, just the When answer for these groups */ when?: { groups: Group[]; onDates: (d: WhenDates | null) => void }; /** hidden mode: hold a spot for this quote (Hold the spot) */ hold?: HoldAsk } = {}) {
  const canEquip = useCan("pressDefaults");
  // crew pay rates (job labor cost, overtime cost): owners / admins, and anyone with the "pay" permission
  const canPay = useCan("pay");
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
        allRows((r0, r1) => sb.from("time_punches").select("employee_id, kind, at, source").in("employee_id", ids).eq("voided", false).gte("at", from).order("at").order("id").range(r0, r1)),
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
    // Live clock off: a plan made by hand; nobody's punches move it, but each press still shows when its crew clocked in
    // (the Actual box under the press; Nov 12, Nick: "why doesn't it show their clock in time")
    // and the operator's clock-outs pause the press either way (lunch, breaks: Nov 12, Nick)
    if (!sBase.liveClock) { const ck = new Map<string, Machine>(withTc.machines.map((m: Machine) => [m.id, m])); return { ...sBase, machines: sBase.machines.map((m) => { const w = ck.get(m.id); return w && (w.clock || w.away) ? { ...m, clock: w.clock, away: w.away } : m; }) }; }
    return Object.keys(tc.worked).length ? withCrewHours(withTc, tc.worked, tc.names, today, now.min) : withTc;
  }, [sBase, tc, today, clockBucket]);
  const [view0, setView] = useSticky<View>("cal.view", "flow");
  // the old two-panel view ("24 Hours + Next 5") became Next 12 hours (Nov 11 2026)
  const view: View = view0 === "split" ? "flow" : view0;
  const [week, setWeek] = useState(() => monday(shopTime(new Date())!.day));
  const [day, setDay] = useState(() => shopTime(new Date())!.day);
  const [wknd, setWknd] = useSticky<boolean | null>("cal.weekends", null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [pvLane, setPvLane] = useState<{ job: Job; machine: Machine; day: string; startMin: number | null; minutes: number | null; carried?: string }[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Shift + drag (Nov 11 2026, Nick: "if I drag a job and I want it to start at a very specific time… gray out everything
  // else… it would just put it 3 p.m. on Thursday… and lock it into that time"): where it would be pinned, by the quarter hour
  const [pinAt, setPinAt] = useState<{ mid: string; d: string; min: number; y: number } | null>(null);
  const [over, setOver] = useState("");
  const [open, setOpen] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(""), Math.min(20000, 6000 + msg.length * 45)); return () => clearTimeout(id); }, [msg]);
  const [typeF0, setTypeF] = useSticky<"" | "screen" | "embroidery" | "heat">("cal.type", "");
  // embroidery's manager sees her own schedule and machines (Oct 23, Nick: Maria "will see her schedule, right? Not
  // the screen printing schedule. She'll see her machines")
  const embOnly = useRole().role === "embroidery";
  // the menu's screen printing / embroidery switch (Oct 24): embroidery shows the embroidery machines (like Maria's
  // view); screen printing shows the screen presses, or the heat presses (heat press goes with screen printing)
  const [side, setSide] = useProdSide();
  const embSide = embOnly || side === "embroidery";
  // the menu's SP / EMB / HP picks the machines (Oct 24): screen presses, embroidery heads, or the heat press
  const typeF: "" | "screen" | "embroidery" | "heat" = embSide ? "embroidery" : side === "heat" ? "heat" : "screen";
  void typeF0; void setTypeF;
  // whose jobs: everyone's, or the accounts the signed-in person owns (others fade on the calendar)
  const [mine, setMine] = useSticky("cal.mine", false);
  const [me, setMe] = useState<{ email: string; name: string }>({ email: "", name: "" });
  // crew pay (owners/admins only): what an hour on each press costs, for job labor cost
  const [pay, setPay] = useState<{ rates: Record<string, number>; names: Record<string, string> } | null>(null);
  const [owners, setOwners] = useState<AccountOwner[]>([]);
  const [trayAll, setTrayAll] = useState(false);
  // Ready To Schedule's tabs (Nov 11, Nick: "late jobs, holders, and… jobs that are on time")
  const [trayTab, setTrayTab] = useSticky<"all" | "late" | "hold" | "ok">("cal.trayTab", "all");
  // kinds of order (Nov 11, Nick: "distinguish… what's a cart order from Cedar Promos, what's an All My Sons… order, and
  // what's a regular order… hide the cart orders and… All My Sons… so I can just see the regular"): a customer's Create
  // order trainings (their when-words in the job's name) are its kinds; a job none of them names is Regular. Hidden kinds
  // are left out of Ready To Schedule and Make The Schedule
  const [trains, setTrains] = useState<{ id: string; customer_id: string; name: string; when_words: string }[]>([]);
  const [hideKinds, setHideKinds] = useSticky<string[]>("cal.hideKinds", []);
  const [kindsOpen, setKindsOpen] = useState(false);
  // a phone sees what's on and whether it's done, nothing to plan (Nick, Nov 12, option B: "the whole point of the
  // schedule view is to see if jobs are done or not… stay on a day"); opens on today
  const [phone, setPhone] = useState(false);
  useEffect(() => { const mq = window.matchMedia("(max-width: 700px)"); const f = () => setPhone(mq.matches); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  const [pDay, setPDay] = useState("");
  const [trayOpen, setTrayOpen] = useSticky("cal.trayOpen", true);
  const [showPast, setShowPast] = useState(false);
  const [offs, setOffs] = useState<DayOff[]>([]);
  // Ready To Schedule: where staff want a job instead of our suggestion (Nov 11, Nick: "click it and say, oh, here's where I
  // want it to go… make it Kelsy on Tuesday… then make the schedule"); a plan in progress, so not kept after a refresh
  const [picks, setPicks] = useState<Record<string, { m: string; d: string }>>({});
  const [pickOpen, setPickOpen] = useState("");
  // the schedule's search (Nov 11, Nick): a customer, job # or name; matches glow, the rest fade, ↑ ↓ jump between them
  const [findQ, setFindQ] = useState(""), [findI, setFindI] = useState(0);
  const [downEdit, setDownEdit] = useState<{ machine?: string; day?: string; start?: number; end?: number; allDay?: boolean; replace?: DayOff } | null>(null);
  // right-click on a downtime block: remove it or change its times (Nov 11, Nick: "right click on those blocks… remove")
  const [downMenu, setDownMenu] = useState<{ x: number; y: number; row: DayOff | null; machine: string; day: string; a: number; b: number; why: string } | null>(null);
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
  const [holdsBy, setHoldsBy] = useState<Map<string, Hold>>(new Map());
  const [showHolds, setShowHolds] = useSticky("cal.showHolds", true);
  const [equip, setEquip] = useState<EquipRow[]>([]);
  const [eqOpen, setEqOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [advise, setAdvise] = useState<null | { opts: WhatIf[]; late: { job: string; customer: string; inHands: string; why: string }[]; lateBefore: number }>(null);
  // the "schedule too tight" prompt shows once a day (again if more jobs go late)
  const [toolsOpen, setToolsOpen] = useSticky("cal.toolsOpen", true);
  const [tightOpen, setTightOpen] = useSticky("cal.tightOpen", false);
  // the assistant's tips take turns every 8 seconds, held while the pointer is on them
  const [tipI, setTipI] = useState(0), [tipHold, setTipHold] = useState(false);
  useEffect(() => { if (tipHold) return; const t = setInterval(() => setTipI((i) => i + 1), 8000); return () => clearInterval(t); }, [tipHold]);
  const [listOpen, setListOpen] = useState(""); // a same-art list opened to show all its jobs
  const [grpEdit, setGrpEdit] = useState<Card[] | null>(null); // a same-art run's time being edited
  const [standOpen, setStandOpen] = useState(false); // Where things stand: set every job's real state at once
  const [restart, setRestart] = useState(false); // asking: take every not-started job off the calendar?
  const [relLocks, setRelLocks] = useState(false); // …and release the locks too
  // live drag (Nov 11 2026, Nick: "when you drag a card over, you should see how it bumps everything… in real time"):
  // where the dragged job would land (press, day, before which job) and the schedule laid out that way
  const dragAt = useRef(0); // when a drag last started or ended: the click that follows it is not "add downtime"
  // Shift held while grabbing a job pins it too (Nov 11, Nick): Chrome's dragstart doesn't always carry the Shift key,
  // so the key's state is kept from the keyboard and the mouse press
  const shiftHeld = useRef(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { shiftHeld.current = e.shiftKey; };
    const md = (e: MouseEvent) => { shiftHeld.current = e.shiftKey; };
    const off = () => { shiftHeld.current = false; };
    window.addEventListener("keydown", k, true); window.addEventListener("keyup", k, true); window.addEventListener("mousedown", md, true); window.addEventListener("blur", off);
    return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("keyup", k, true); window.removeEventListener("mousedown", md, true); window.removeEventListener("blur", off); };
  }, []);
  const [pv, setPv] = useState<{ mid: string; d: string; before: string; y: number } | null>(null);
  const pvCache = useRef<{ k: string; v: ReturnType<typeof layoutAll> | null }>({ k: "", v: null });
  // each order's goods (order_goods.status): the dot by its number (Nov 11 2026, Nick: "a green dot… counted")
  const [goodsSt, setGoodsSt] = useState<Map<string, string>>(new Map());
  const [goodsRev, setGoodsRev] = useState(0);
  const [upDay, setUpDay] = useSticky<number>("cal.upDay", 0);
  const [lockMenu, setLockMenu] = useState<{ c: Card; g: Seg; x: number; y: number } | null>(null);
  // the right-click's times and picks (Nov 12, Nick: "he should be able to do with a right click what the live clock will do")
  const [rcF, setRcF] = useState({ t: "", pcs: "", why: "Lunch", next: "fulfillment" as "fulfillment" | "ready" | "completed", edit: false });
  // the job's goods in the right-click (Nov 12, Nick: "mark all received, or mark missing"): the same counts as Goods & Receiving
  const [openMove, setOpenMove] = useState(false);
  const [keyOpen, setKeyOpen] = useSticky("cal.key", true);
  const [rcPause, setRcPause] = useState(false), [rcSure, setRcSure] = useState(false);
  const [rcGoods, setRcGoods] = useState<{ ref: string; job: CheckJob | null; err: string } | null>(null);
  const [countJob, setCountJob] = useState<CheckJob | null>(null);
  const [lockSide, setLockSide] = useState<{ c: Card; g: Seg; k: "spot" | "press" | "day" | "person" } | null>(null);
  // Re-plan results for the calendar as it is (the Re-plan window asks on every redraw): worked out again when anything changes
  const planCache = useRef<{ deps: unknown[]; v: Map<boolean, unknown> }>({ deps: [], v: new Map() });

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: st }, { data: o }, { data: a }, { data: sl0 }, { data: off0 }, { data: ex0 }, { data: ho0 }] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      // not a job on hold for payment: production gets it once it's paid (lib/holds.ts)
      sb.from("orders").select("id, number, nickname, due_date, production_date, qty, status, customer_id, groups, lines, rush, firm, due_time, run_times, order_type").is("discarded_at", null).is("schedule_off_at", null).in("status", ["approved", "art", "blanks", "production", "fulfillment"]).not("flags", "cs", JSON.stringify([{ key: "hold_payment" }])).limit(300),
      // Printavo jobs are left off the calendar (it plans our own orders only); nothing in Printavo is read or changed here
      Promise.resolve({ data: [] as unknown[] }),
      sb.from("production_slots").select("*").or("order_id.not.is.null,hold_id.not.is.null").gte("day", addDay(today, -21)).lte("day", addDay(today, 70)),
      sb.from("production_days_off").select("id, crew_id, machine, day, note, start_min, end_min, capacity, employee").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
      sb.from("production_extra_shifts").select("id, machine, crew_id, day, start_min, end_min, note").gte("day", addDay(today, -21)).lte("day", addDay(today, 120)),
      sb.from("production_holds").select("*").eq("status", "planned").order("due_date"),
    ]);
    // what each style number is (a line that only says "562M" is timed as the sweatshirt it is; Nov 12, #50036)
    const stys = new Set<string>();
    for (const x of (o || []) as { groups?: Group[] | null }[]) for (const g of x.groups || []) for (const l of g.lines || []) if (l.style) stys.add(String(l.style));
    if (stys.size) seedStyleTitles(await styleTitles([...stys]).catch(() => ({})));
    // Equipment Status: presses running with heads out, slow, or down
    const { data: eq0 } = await sb.from("production_equipment").select("*");
    // what runs taught about each press operator's pace (lib/runLearn.ts)
    const { data: rl0 } = await sb.from("run_lessons").select("operator, crew_id, kind, est_min, real_min, created_at").order("created_at", { ascending: false }).limit(800);
    const eqList = (eq0 || []) as EquipRow[];
    setEquip(eqList);
    const exList = (ex0 || []) as Extra[];
    setExtras(exList);
    const offList = (off0 || []) as DayOff[];
    setOffs(offList);
    let sl = (sl0 || []) as Slot[];
    // a booking for a job that's past printing is off the calendar: taken off when the schedule went live (Nov 9, already
    // past printing in Printavo), or Ready / Completed / voided / discarded here (#40096 was completed and still booked)
    const slOids = [...new Set(sl.filter((x) => x.order_id && x.status !== "done").map((x) => x.order_id!))];
    if (slOids.length) {
      const { data: offO } = await sb.from("orders").select("id").in("id", slOids).or("schedule_off_at.not.is.null,discarded_at.not.is.null,status.in.(ready,completed,void,quote,quote_sent,request)");
      const offIds = new Set(((offO || []) as { id: string }[]).map((x) => x.id));
      if (offIds.size) sl = sl.filter((x) => !(x.order_id && offIds.has(x.order_id) && x.status !== "done"));
    }
    // not marked done by the end of its day → it moves forward to today (first in line), remembering where it started
    // (Live clock off: they stay on their own day, like Printavo, until someone updates them)
    const liveClk = !!mergeProduction((st?.data as { production?: unknown } | null)?.production).liveClock;
    const stale = liveClk ? sl.filter((x) => (x.order_id || x.hold_id) && x.day < today && x.status !== "done") : [];
    // (the hidden "when can we print it?" mode only looks: it lays stale jobs on today without saving anything)
    if (stale.length && when) sl = sl.map((x) => (stale.includes(x) ? { ...x, day: today, start_min: null, position: -1, rolled_from: x.rolled_from || x.day } : x));
    else if (stale.length) {
      await Promise.all(stale.map((x) => sb.from("production_slots").update({ day: today, start_min: null, position: -1, rolled_from: x.rolled_from || x.day, updated_at: new Date().toISOString() }).eq("id", x.id)));
      sl = sl.map((x) => (stale.includes(x) ? { ...x, day: today, start_min: null, position: -1, rolled_from: x.rolled_from || x.day } : x));
      // once a day: offer to re-plan around what didn't get done
      try { if (localStorage.getItem("fbs:cal.rolledSeen") !== today) { localStorage.setItem("fbs:cal.rolledSeen", today); setReplan({ why: `${stale.length} job${stale.length === 1 ? " wasn't" : "s weren't"} finished on ${stale.length === 1 ? "its" : "their"} day and moved to today. Re-plan so everything after them fits?` }); } } catch { /* private window */ }
    }
    // jobs the floor started in the employee app (punched onto the order) count as started here
    const oids = [...new Set(sl.filter((x) => x.day === today && x.order_id && x.status !== "done").map((x) => x.order_id!))];
    if (oids.length && !when && liveClk) {
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
    const ps = withPace({ ...ps0, machines: ps0.machines.map((m) => {
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
    }) }, ((rl0 || []) as RunLesson[]).map((r) => ({ ...r, est_min: +r.est_min, real_min: +r.real_min })));
    // holds from quotes (Hold the spot): approved, the hold becomes the order's booking in the same spot; deleted or
    // declined, the hold goes. Planner holds without an order stay as they are.
    const holds0 = (ho0 || []) as Hold[];
    const hoIds = [...new Set(holds0.map((h) => h.order_id).filter(Boolean))] as string[];
    const { data: hoOs } = hoIds.length ? await sb.from("orders").select("id, number, status, type, discarded_at, declined_at").in("id", hoIds) : { data: [] };
    const holdOrd = new Map(((hoOs || []) as { id: string; number: number; status: string; type: string; discarded_at: string | null; declined_at: string | null }[]).map((x) => [x.id, x]));
    const holdRows: Hold[] = [];
    for (const h of holds0) {
      const o = h.order_id ? holdOrd.get(h.order_id) : undefined;
      if (h.order_id && (!o || o.discarded_at || o.declined_at || o.status === "completed")) { void sb.from("production_holds").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", h.id).then(() => sb.from("production_slots").delete().eq("hold_id", h.id)); sl = sl.filter((x) => x.hold_id !== h.id); continue; }
      if (o && o.type === "invoice") {
        await sb.from("production_slots").update({ order_id: o.id, hold_id: null, source: "hold" }).eq("hold_id", h.id);
        await sb.from("production_holds").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", h.id);
        sl = sl.map((x) => (x.hold_id === h.id ? { ...x, order_id: o.id, hold_id: null, source: "hold" } : x));
        continue;
      }
      holdRows.push(h);
    }
    setHoldsBy(new Map(holdRows.map((h) => [h.id, h])));
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
      // only with the pay permission (owners always have it; an admin with pay turned off, or an owner viewing as
      // someone without it, doesn't load rates) (Oct 22, Nick: Claudia "shouldn't see anything about employee pay")
      if (canPay) {
        const [{ data: pr }, { data: em }] = await Promise.all([sb.from("employee_pay").select("employee_id, rate"), sb.from("employees").select("id, first_name, last_name")]);
        setPay({ rates: Object.fromEntries(((pr || []) as { employee_id: string; rate: number | null }[]).filter((x) => x.rate != null).map((x) => [x.employee_id, +x.rate!])), names: Object.fromEntries(((em || []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, `${x.first_name} ${x.last_name}`.trim()])) });
      }
    }
    const js: Job[] = [
      ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null; groups: Group[]; lines: never[]; rush?: boolean; firm?: boolean; due_time?: number | null; production_date?: string | null; order_type?: string | null; run_times?: Record<string, { min: number; by: string }> | null }[]).flatMap((x) => {
        // a pre-production sample is its own card, and the full run (less the pieces taken off the top) waits on it (Nov 11, Nick; lib/samples.ts)
        const parts = runParts(x.groups || []), runOn = sampleRunOn(x.groups || []);
        const base = { cid: x.customer_id || "", rush: !!x.rush, firm: !!x.firm || x.due_time != null, dueTime: x.due_time ?? null, kind: "o" as const, id: x.id, number: String(x.number), customer: cn.get(x.customer_id || "") || "", due: x.due_date, status: x.status, href: `/shop/orders/${x.id}`, owner: own.get(x.customer_id || "") || "" };
        const out: Job[] = [];
        if (parts.sample.length) out.push({ ...base, key: "o:" + x.id + ":s", sample: "run", prod: runOn, due: runOn || x.due_date, name: `Sample · ${x.nickname || ""}`.trim(), qty: parts.sample.reduce((a, g) => a + samplePieces(g), 0), needs: withRunTimes(needsForOrder(ps, x as never, parts.sample), undefined) });
        const rest = needsForOrder(ps, x as never, parts.rest);
        if (rest.length) out.push({ ...base, key: "o:" + x.id, prod: [x.production_date, runOn ? addDay(runOn, 1) : null].filter(Boolean).sort().pop() || null, name: parts.sample.length ? `Production run · ${x.nickname || ""}`.trim() : x.nickname || "", qty: x.qty || 0, needs: withRunTimes(rest, x.run_times), ...(x.order_type === "sample" ? { sample: "only" as const } : {}), ...(parts.sample.length && waitsOnSample(x.groups || []) ? { waits: true } : {}) });
        return out;
      }),
      ...pv.map((x) => ({ key: "a:" + x.id, kind: "a" as const, id: x.id, number: x.visual_id, customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status_name, needs: needsForPrintavo(ps, { qty: x.qty, status_name: x.status_name, nickname: x.nickname, data: { groups: x.pvgroups as never } }), href: `/shop/archive/${x.id}`, owner: "" })),
      // Planner holds: jobs we know are coming, holding time before there's an order
      // a hold saves press time near its date, it doesn't jump the line: it runs no earlier than 3 working days before
      // in-hands (Nov 11, Nick: #50016 due the 23rd was put on the 13th). Once its order is booked it's a job like any other
      ...holdRows.map((h) => ({ prod: h.due_date ? minusWorkdays(h.due_date, 3) : null, key: "h:" + h.id, kind: "h" as const, id: h.id, number: h.order_id ? String(holdOrd.get(h.order_id)?.number ?? "HOLD") : "PLAN", customer: h.customer || "Planned", name: h.name || "Planned job", due: h.due_date, dueTime: h.due_time, firm: h.due_time != null, qty: +(h.spec as QuickJob)?.qty || 0, status: "planned", needs: [quickNeed(ps, h.spec as QuickJob)], href: h.order_id ? `/shop/orders/${h.order_id}` : "", owner: "", ...(h.order_id ? { hold: { orderId: h.order_id, detailsDue: h.details_due || null, by: h.created_by, art: h.art || "" } } : {}) })),
    ];
    setHolds((ho0 || []) as Hold[]);
    void sb.from("order_trainings").select("id, customer_id, name, when_words").then(({ data: tr }) => setTrains((tr || []) as { id: string; customer_id: string; name: string; when_words: string }[]));
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
  // a drag that ends anywhere (dropped, Esc, or its card redrawn mid-drag) always clears the live preview
  useEffect(() => {
    const end = () => { dragAt.current = Date.now(); setPv(null); setPinAt(null); setOver(""); setDrag(null); };
    window.addEventListener("dragend", end); window.addEventListener("drop", end);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", end); };
  }, []);
  useEffect(() => {
    const ids = (jobs || []).filter((j) => j.kind === "o").map((j) => j.id);
    if (!ids.length) return;
    (async () => {
      const sb = createClient(), m = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) { const r = await sb.from("order_goods").select("order_id, status").in("order_id", ids.slice(i, i + 200)); for (const x of (r.data || []) as { order_id: string; status: string }[]) m.set(x.order_id, x.status); }
      // a count saved on Goods & Receiving or from the right-click is the answer, whether or not the order has a goods row
      // (Nov 12, Nick: Fossil marked All here stayed red)
      const seenC = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const r = await sb.from("goods_checkins").select("order_id, status, resolved_at, created_at").in("order_id", ids.slice(i, i + 200)).order("created_at", { ascending: false });
        for (const x of (r.data || []) as { order_id: string; status: string; resolved_at: string | null }[]) { if (seenC.has(x.order_id)) continue; seenC.add(x.order_id); m.set(x.order_id, x.status === "issue" && !x.resolved_at ? "issue" : "received"); }
      }
      setGoodsSt(m);
    })();
  }, [jobs, goodsRev]);
  const slotKey = (x: { order_id: string | null; archived_order_id: string | null; hold_id?: string | null; sample?: boolean }) => (x.hold_id ? "h:" + x.hold_id : x.order_id ? "o:" + x.order_id + (x.sample ? ":s" : "") : "a:" + x.archived_order_id);
  // everything on the calendar: our bookings, then Printavo machine statuses that aren't booked here
  const nowTick = useMemo(() => ({ day: now.day, min: Math.floor(now.min / 5) * 5 }), [now.day, Math.floor(now.min / 5)]); // eslint-disable-line react-hooks/exhaustive-deps
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
      // its finish time set by hand (Where things stand → Printing today): it runs until then
      const en = sl.status === "running" && sl.ends_at ? shopTime(sl.ends_at) : null;
      if (en && en.day === sl.day) { const st1 = startMin ?? (st0 && st0.day === sl.day ? st0.min : en.min - minutes); startMin = st1; minutes = Math.max(15, en.min - st1); }
      // a started job runs until it's marked complete (Nick, Nov 12: "you'll keep dragging down the bottom of it… until it's
      // marked completed"): past its planned finish it stretches to now and a little beyond, and the jobs after it move down
      // with it, live clock on or off
      if (sl.status === "running" && startMin != null && sl.day === nowTick.day && startMin + minutes < nowTick.min + 10) minutes = nowTick.min + 10 - startMin;
      out.push({ key: sl.id, job, need, machine: mach, day: sl.day, minutes: Math.max(15, minutes), startMin, slot: sl, fromPv: false, carried: sl.rolled_from, ...(sl.status === "running" && st0 && st0.day === sl.day ? { plan: { start: st0.min, est } } : {}) });
    }
    for (const p of pvLane) {
      const need = p.job.needs.find((n) => n.type === p.machine.type) || p.job.needs[0];
      if (!need || booked.has(p.job.key + ":" + p.machine.type)) continue;
      out.push({ key: "pv:" + p.job.key, job: p.job, need, machine: p.machine, day: p.day, minutes: p.minutes || estimate(s, need, p.machine).minutes, startMin: p.startMin, slot: null, fromPv: true, carried: p.carried });
    }
    // back to back with the same art on one press and day: the screens stay up, so the second one skips their setup
    // and the first one their teardown (Nov 9, "jobs with the same imprint should go together")
    const lanes = new Map<string, Card[]>();
    for (const c of out) if (c.slot && c.slot.status !== "done") lanes.set(c.machine.id + "|" + c.day, [...(lanes.get(c.machine.id + "|" + c.day) || []), c]);
    for (const ls of lanes.values()) {
      ls.sort((a, b) => (a.startMin ?? 99999) - (b.startMin ?? 99999) || a.slot!.position - b.slot!.position);
      for (let i = 1; i < ls.length; i++) {
        const prev = artsOf(ls[i - 1].need), c = ls[i];
        const shared = c.need.steps.filter((st) => st.art && prev.has(st.art) && !st.over);
        if (!shared.length || c.slot!.status !== "scheduled") continue;
        const e = estimateRaw(s, { ...c.need, steps: shared }, c.machine);
        const save = Math.round(e.setup + e.teardown);
        if (save > 0) { c.minutes = Math.max(MIN_JOB_MIN, c.minutes - save); c.sameArt = { with: ls[i - 1].job.number, saved: save }; }
      }
    }
    return out;
  }, [s, jobs, slots, pvLane, byKey, nowTick]);

  // every machine's work laid out on its hours, split into per-day pieces
  // Live clock off: jobs keep their planned times; nothing not started is pushed up to "now"
  const liveNow = s?.liveClock ? ord(now.day) * 1440 + now.min : (ord(now.day) - 60) * 1440; // off: a finite floor far back (a date math on -Infinity crashed the page)
  const segs = useMemo(() => (s ? layoutAll(cards, liveNow) : { by: new Map<string, Seg[]>(), ofCard: new Map<string, Seg[]>(), lunch: new Map<string, number>() }), [cards, s, liveNow]);
  const at = (m: Machine, d: string) => segs.by.get(m.id + "|" + d) || [];
  /** a day's pieces with a job that runs through lunch (or a warm-up) drawn as one card over it (Nov 9, Nick: "when
   *  lunch falls within a job it shouldn't split it up… if lunch falls between jobs it should split between the job") */
  const joined = (m: Machine, d: string, by?: Map<string, Seg[]>) => {
    const out: { g: Seg; start: number; end: number; gaps: [number, number][]; n: number }[] = [];
    for (const g of (by ? by.get(m.id + "|" + d) || [] : at(m, d)).slice().sort((x, y) => x.start - y.start)) {
      const last = out[out.length - 1];
      if (last && last.g.c.key === g.c.key && g.start - last.end > 0 && g.start - last.end <= 90) { last.gaps.push([last.end, g.start]); last.end = g.end; last.n++; }
      else out.push({ g, start: g.start, end: g.end, gaps: [], n: 1 });
    }
    return out;
  };
  // when each crew goes into overtime that day (cached until the settings / hours change)
  const otCache = useMemo(() => new Map<string, number | null>(), [s]);
  const otOn = (m: Machine, d: string) => { const k = m.id + "|" + d; if (!otCache.has(k)) otCache.set(k, otFromOn(m, d)); return otCache.get(k)!; };
  const inOT = (g: Seg) => { const oa = otOn(g.c.machine, g.day); return oa != null && g.end > oa + 1; };
  const used = (m: Machine, d: string) => at(m, d).reduce((a, g) => a + g.work, 0);
  /**
   * Jobs printing the same art that are booked apart (Nov 9, Nick: "how do you… look at the scheduler and go, hey, we've
   * got these jobs. Would you like me to run them all together?"): one offer per set, to run them back to back on the
   * press and day that already has the most of them, where it fits each job and keeps it on time.
   */
  /**
   * Two jobs back to back show as one group only when they're one run: the same artwork and the same in-hands date
   * (Nov 11, Nick: "the only thing that should be grouped is jobs with the exact same artwork that are due at the exact
   * same time"). Same customer alone is not a group (Dear Heart's Take Heart and Count Joy are separate jobs).
   */
  const oneRun = (a: Card, b: Card) => {
    if (a.job.kind === "h" || b.job.kind === "h" || !a.job.due || a.job.due !== b.job.due || (a.job.prod || "") !== (b.job.prod || "")) return false;
    const aa = artsOf(a.need); return [...artsOf(b.need)].some((x) => aa.has(x));
  };
  const artOffers = useMemo(() => {
    if (!s) return [] as { key: string; cards: Card[]; machine: Machine; day: string; saves: number }[];
    const by = new Map<string, Card[]>();
    for (const c of cards) if (c.slot && c.slot.status === "scheduled" && c.day >= today && c.job.kind === "o") for (const a of artsOf(c.need)) by.set(a, [...(by.get(a) || []), c]);
    const out: { key: string; cards: Card[]; machine: Machine; day: string; saves: number }[] = [], seen = new Set<string>();
    for (const cs0 of by.values()) {
      const cs = [...new Map(cs0.map((c) => [c.key, c])).values()];
      if (cs.length < 2) continue;
      const lanes = new Map<string, Card[]>();
      for (const c of cs) lanes.set(c.machine.id + "|" + c.day, [...(lanes.get(c.machine.id + "|" + c.day) || []), c]);
      if (lanes.size === 1 && cs.filter((c) => c.sameArt).length === cs.length - 1) continue; // already together
      const [lane] = [...lanes.entries()].sort((x, y) => y[1].length - x[1].length || x[0].split("|")[1].localeCompare(y[0].split("|")[1]));
      const [mid, day] = lane[0].split("|"), machine = s.machines.find((x) => x.id === mid)!;
      const go = cs.filter((c) => fits(c.need, machine) && (!c.job.due || day <= c.job.due));
      if (go.length < 2) continue;
      const key = go.map((c) => c.key).sort().join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const saves = go.slice(1).reduce((t, c) => { const sh = c.need.steps.filter((st) => st.art && go[0].need.steps.some((x) => x.art === st.art)); if (!sh.length) return t; const e = estimateRaw(s, { ...c.need, steps: sh }, machine); return t + e.setup + e.teardown; }, 0);
      out.push({ key, cards: go, machine, day, saves: Math.round(saves) });
    }
    return out;
  }, [s, cards, today]);
  /** run a set of same-art jobs back to back: they move next to the first of them already on that press and day */
  async function runTogether(o: { cards: Card[]; machine: Machine; day: string }) {
    const sb = createClient(), ids = new Set(o.cards.map((c) => c.slot!.id));
    const lane = cards.filter((c) => c.slot && c.machine.id === o.machine.id && c.day === o.day).sort((x, y) => (x.startMin ?? 99999) - (y.startMin ?? 99999) || x.slot!.position - y.slot!.position);
    const at0 = lane.findIndex((c) => ids.has(c.slot!.id));
    const before = (at0 < 0 ? lane : lane.slice(0, at0)).filter((c) => !ids.has(c.slot!.id)), after = at0 < 0 ? [] : lane.slice(at0).filter((c) => !ids.has(c.slot!.id));
    const group = [...o.cards].sort((x, y) => (x.machine.id === o.machine.id && x.day === o.day ? 0 : 1) - (y.machine.id === o.machine.id && y.day === o.day ? 0 : 1) || (x.job.due || "9").localeCompare(y.job.due || "9"));
    const ordered = [...before, ...group, ...after], stamp = new Date().toISOString();
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i], inGroup = ids.has(c.slot!.id), first = inGroup && c === group[0];
      const patch: Record<string, unknown> = { position: i, updated_at: stamp };
      if (inGroup) Object.assign(patch, { machine: o.machine.id, day: o.day, ...(first ? {} : { start_min: null }), minutes: estimate(s!, c.need, o.machine).minutes });
      await sb.from("production_slots").update(patch).eq("id", c.slot!.id);
    }
    setMsg(`Running ${group.map((c) => "#" + c.job.number).join(", ")} together on ${o.machine.name}, ${dayLbl(o.day)}.`);
    load();
  }
  const loadMap = useMemo(() => { const m: Record<string, Record<string, number>> = {}; for (const [k, gs] of segs.by) { const [id, d] = k.split("|"); (m[id] ||= {})[d] = gs.filter((g) => g.c.slot?.status !== "done").reduce((a, g) => a + g.work, 0); } return m; }, [segs]);

  // ready to schedule: in production (goods here, art done) or a Printavo "ready for production / scheduling" status, not booked yet
  const tray = useMemo(() => {
    if (!s || !jobs) return [];
    // what's booked per job and kind of machine: everything, or just some print locations
    const onCal = new Map<string, string[] | "all">();
    for (const c of cards) { const k = c.job.key + ":" + c.need.type, cur = onCal.get(k); if (cur === "all") continue; const l = c.slot?.locations; onCal.set(k, !l || !l.length ? "all" : [...(cur || []), ...l]); }
    // approved orders wait here (Nov 9, Nick: "a job that's marked invoiced… and approved should just go on to the production
    // scheduler"); booking one makes it In Production (a database trigger, migration 302)
    // a hold (a quote's press time, Production holder) waits here too when it isn't on a press (Nov 11, Nick: "it should
    // just treat it like any other schedule job… in the queue above")
    const ready = jobs.filter((j) => (j.kind === "o" ? j.status === "approved" || j.status === "production" : j.kind === "h" ? true : PV_READY.test(j.status)) && (!mine || isMe(j.owner, owners, me)));
    const ld = JSON.parse(JSON.stringify(loadMap)) as Record<string, Record<string, number>>;
    // the part of today's shift that's already gone is taken: nothing new is booked into time that's past, whatever the
    // Live clock says (Nov 11, Nick: Make The Schedule at 7:35 pm put five jobs on today)
    if (now.day === today) for (const m of s.machines) { const sh = shiftOn(m, today); if (sh) { const gone = Math.max(0, Math.min(sh[1], now.min) - sh[0]); if (gone) (ld[m.id] ||= {})[today] = (ld[m.id]?.[today] || 0) + gone; } }
    const out: { job: Job; need: Need; sug: Suggestion | null; picked?: boolean; auto?: Suggestion | null }[] = [];
    // where each art already runs (booked, not done), and later where it's suggested: same art goes together (Nov 9)
    const artAt = new Map<string, { machine: string; day: string; with: string }[]>();
    const putArt = (need: Need, machine: string, day: string, num: string) => { for (const a of artsOf(need)) artAt.set(a, [...(artAt.get(a) || []), { machine, day, with: `#${num}` }]); };
    for (const c of cards) if (c.slot?.status !== "done" && c.day >= today) putArt(c.need, c.machine.id, c.day, c.job.number);
    // by in-hands date, each job followed by the other ready jobs printing the same art
    const byDue = [...ready].sort((a, b) => (a.due || "9").localeCompare(b.due || "9")), order: Job[] = [], taken = new Set<string>();
    for (const j of byDue) {
      if (taken.has(j.key)) continue;
      taken.add(j.key); order.push(j);
      const arts = new Set(j.needs.flatMap((n) => [...artsOf(n)]));
      if (arts.size) for (const k of byDue) if (!taken.has(k.key) && k.needs.some((n) => [...artsOf(n)].some((a) => arts.has(a)))) { taken.add(k.key); order.push(k); }
    }
    const mates = new Map<string, { m: Machine; d: string }>();
    for (const j of order) for (const n0 of j.needs) {
      // Screen Print / Embroidery / Heat Press picked: the tools only deal with that kind of work
      if (typeF && n0.type !== typeF) continue;
      const bk = onCal.get(j.key + ":" + n0.type), n = bk ? restNeed(n0, bk) : n0;
      if (!n) continue;
      const near = [...artsOf(n)].flatMap((a) => artAt.get(a) || []);
      // a production date is the day it runs: suggested from that day on, never before
      let sug = suggest(s, n, j.due, j.prod && j.prod > today ? j.prod : today, ld, 30, near);
      const auto = sug, pk = picks[j.key + n.type], pm = pk ? s.machines.find((x) => x.id === pk.m) : undefined;
      if (pk && pm) sug = { machine: pm, day: pk.d, minutes: estimate(s, n, pm).minutes, late: !!j.due && pk.d > j.due, reason: "Your pick", alternatives: [] };
      // the same art for the same in-hands date goes on the same press and day as the job before it, back to back,
      // when that press can print it and the day is before in-hands (Nov 11, Nick: Nine18's AMS jobs were spread over
      // three presses after "book all")
      const mate = j.due && j.kind !== "h" ? [...artsOf(n)].map((a) => mates.get(a + "|" + j.due + "|" + (j.prod || ""))).find(Boolean) : undefined;
      if (sug && !picks[j.key + n.type] && mate && (mate.m.id !== sug.machine.id || mate.d !== sug.day) && fits(n, mate.m) && (!j.due || mate.d <= j.due)) sug = { ...sug, machine: mate.m, day: mate.d, minutes: estimate(s, n, mate.m).minutes };
      if (sug && j.due) for (const a of artsOf(n)) if (!mates.has(a + "|" + j.due + "|" + (j.prod || ""))) mates.set(a + "|" + j.due + "|" + (j.prod || ""), { m: sug.machine, d: sug.day });
      if (sug) { (ld[sug.machine.id] ||= {})[sug.day] = (ld[sug.machine.id]?.[sug.day] || 0) + sug.minutes; putArt(n, sug.machine.id, sug.day, j.number); } // later jobs see this one's room taken
      out.push({ job: j, need: n, sug, picked: !!(pk && pm), auto });
    }
    return out;
  }, [s, jobs, cards, loadMap, today, mine, owners, me, typeF, picks, now.day, Math.floor(now.min / 15)]); // eslint-disable-line react-hooks/exhaustive-deps
  const coming = (jobs || []).filter((j) => j.kind === "o" && j.status === "art");
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

  /** whose booking a slot is: an order, an old Printavo job, or a hold (a quote's held press time, Production holder) */
  const ownerCols = (job: Job): Record<string, string | boolean | null> => ({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, ...(job.kind === "h" ? { hold_id: job.id } : {}), ...(job.sample === "run" ? { sample: true } : {}) });
  async function book(job: Job, need: Need, machine: Machine, d: string, source = "manual", slot?: Slot | null, startMin: number | null = null) {
    if (!s) return;
    if (!fits(need, machine)) { setMsg(`#${job.number} ${whyUnfit(need, machine)}.`); return; }
    const minutes = estimate(s, need, machine).minutes;
    const sb = createClient();
    const pos = cards.filter((c) => c.machine.id === machine.id && c.day === d).length;
    const r = slot
      ? await sb.from("production_slots").update({ machine: machine.id, day: d, minutes, start_min: startMin, position: pos, updated_at: new Date().toISOString() }).eq("id", slot.id)
      : await sb.from("production_slots").insert({ ...ownerCols(job), machine: machine.id, day: d, minutes, start_min: startMin, position: pos, kind: need.type, label: need.label, source, locations: locsFor(job, need) });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(`#${job.number} → ${machine.name}, ${dayLbl(d)}${startMin != null ? ` at ${clockLong(startMin)}` : ""} (${fmtMin(minutes)})`);
    load();
  }
  // the kinds a job is (its customer's trainings named in it), and what's left when some kinds are hidden
  // each job is ONE kind: the narrowest of its customer's trainings it names (the one fewest jobs name: an MEI store cart
  // is MEI, not Store Carts), and a training that lost jobs to a narrower one reads "Other …" (Nick, Nov 11: "MEI… and
  // other store carts")
  const titleCase = (t: string) => t.trim().replace(/\S+/g, (w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)));
  const kindIx = useMemo(() => {
    const said = new Map<string, { key: string; name: string; customer_id: string }[]>(), n = new Map<string, number>();
    for (const j of jobs || []) {
      if (!j.cid) continue;
      const m = new Map<string, { key: string; name: string; customer_id: string }>();
      for (const t of trains) if (t.customer_id === j.cid && trainingSaid(t, j.name || "")) { const key = t.customer_id + "|" + t.name.trim().toLowerCase(); m.set(key, { key, name: t.name.trim(), customer_id: t.customer_id }); }
      if (!m.size) continue;
      said.set(j.key, [...m.values()]); for (const k of m.keys()) n.set(k, (n.get(k) || 0) + 1);
    }
    const of = new Map<string, { key: string; name: string }>(), lost = new Set<string>();
    for (const [jk, ts] of said) {
      const pick = [...ts].sort((a, b) => (n.get(a.key) || 0) - (n.get(b.key) || 0) || a.name.localeCompare(b.name))[0];
      of.set(jk, pick); for (const t of ts) if (t.key !== pick.key) lost.add(t.key);
    }
    return { of, lost };
  }, [jobs, trains]);
  const kindsOfJob = (j: Job): { key: string; label: string }[] => {
    const k = kindIx.of.get(j.key);
    return k ? [{ key: k.key, label: (kindIx.lost.has(k.key) ? "Other " : "") + titleCase(k.name) }] : [{ key: "regular", label: "Regular Orders" }];
  };
  const trayV = useMemo(() => (hideKinds.length ? tray.filter((t) => !kindsOfJob(t.job).some((k) => hideKinds.includes(k.key))) : tray), [tray, hideKinds, kindIx]); // eslint-disable-line react-hooks/exhaustive-deps
  async function acceptAll() {
    // every suggestion, late ones too (Nov 9, Nick: "if a job is… past due… all that would mean is they just have to go
    // first in the list"): a late or past-due job goes ahead of the day's jobs that haven't started, most overdue first
    const pos: Record<string, number> = {}, early: Record<string, number> = {};
    const late = (t: (typeof tray)[number]) => !!t.sug?.late || (!!t.job.due && t.job.due < today);
    // same-art jobs for the same date stay in one line, one after another (their order in the tray already keeps them together)
    const list = trayV.filter((t) => t.sug).map((t, i) => ({ t, i })).sort((x, y) => Number(late(y.t)) - Number(late(x.t)) || (x.t.job.due || "9").localeCompare(y.t.job.due || "9") || x.i - y.i).map((x) => x.t);
    const rows = list.map((t) => {
      const k = t.sug!.machine.id + t.sug!.day; pos[k] = pos[k] ?? cards.filter((c) => c.machine.id === t.sug!.machine.id && c.day === t.sug!.day).length;
      const position = late(t) ? -1000 + (early[k] = (early[k] ?? 0) + 1) : pos[k]++;
      return { ...ownerCols(t.job), machine: t.sug!.machine.id, day: t.sug!.day, minutes: t.sug!.minutes, position, kind: t.need.type, label: t.need.label, source: "suggested", locations: locsFor(t.job, t.need) };
    });
    if (!rows.length) return;
    const r = await createClient().from("production_slots").insert(rows);
    const nLate = list.filter(late).length;
    const nPick = list.filter((t) => t.picked).length;
    setMsg(r.error ? r.error.message : `Scheduled ${rows.length} job${rows.length === 1 ? "" : "s"}${nPick ? ` (${nPick} where you picked)` : ""}${nLate ? `; ${nLate} late or past due went first on their day` : ""}.`);
    if (!r.error) setPicks({});
    load();
  }
  /** jobs dragged off the calendar back to Ready To Schedule (not started ones only): their bookings go, the jobs wait again */
  async function unbookMany(cs: Card[]) {
    const ids = [...new Set(cs.filter((c) => c.slot && c.slot.status === "scheduled").map((c) => c.slot!.id))];
    if (!ids.length) { setMsg("Started jobs stay on the calendar."); return; }
    const r = await createClient().from("production_slots").delete().in("id", ids);
    setMsg(r.error ? r.error.message : `${ids.length === 1 ? "Moved back" : `${ids.length} jobs moved back`} to Ready To Schedule.`);
    load();
  }
  /** Start / pause / resume / progress / done on a booked job: updates it and writes the job log. */
  async function logAction(sl: Slot, action: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "reopen", progress?: number, reload = true, atIso?: string | null, note?: string) {
    // atIso: the time the update is for (Update Progress "at a time…"), else now
    const nowIso = atIso || new Date().toISOString(), p = progress ?? +(sl.progress || 0);
    const patch: Partial<Slot> & { updated_at: string } = { updated_at: nowIso, ends_at: null };
    if (action === "start") Object.assign(patch, { status: "running", started_at: sl.started_at || nowIso, progress: p, progress_at: nowIso });
    if (action === "resume") Object.assign(patch, { status: "running", progress: p, progress_at: nowIso, started_at: sl.started_at || nowIso });
    if (action === "pause") Object.assign(patch, { status: "paused", progress: p, progress_at: nowIso });
    if (action === "progress") Object.assign(patch, { progress: p, progress_at: nowIso, ...(sl.status === "scheduled" && p > 0 ? { status: "running", started_at: sl.started_at || nowIso } : {}) });
    if (action === "done") Object.assign(patch, { status: "done", finished_at: nowIso, progress: 1, progress_at: nowIso });
    if (action === "not_started") Object.assign(patch, { status: "scheduled", started_at: null, finished_at: null, progress: 0, progress_at: null });
    if (action === "reopen") Object.assign(patch, { status: "running", finished_at: null, progress: Math.min(p, 0.9), progress_at: nowIso });
    const sb = createClient();
    await sb.from("production_slots").update(patch).eq("id", sl.id);
    await sb.from("production_slot_log").insert({ slot_id: sl.id, order_id: sl.order_id, machine: sl.machine, action, progress: patch.progress ?? p, by: me.name || me.email, ...(note ? { note } : {}), ...(atIso ? { at: atIso } : {}) });
    // a finished run teaches the operator's pace: its real time against the standard time (lib/runLearn.ts)
    const cd = action === "done" && s ? cards.find((c) => c.slot?.id === sl.id) : null;
    if (cd && s) {
      const op = operatorOf(s, cd.machine), brk = cd.machine.brk || s.breaks;
      await learnRun({ slotId: sl.id, machine: cd.machine.id, crewId: op.crew, operator: op.id, estMin: estimateRaw(s, cd.need, { ...cd.machine, pace: undefined }).minutes, qty: cd.need.qty, lunchAt: brk.lunchAt, lunchMin: brk.lunchMin }).catch(() => null);
    }
    if (reload) { setOpen(null); load(); }
  }
  async function setStatus(sl: Slot, status: Slot["status"]) { await logAction(sl, status === "done" ? "done" : status === "running" ? (sl.status === "paused" ? "resume" : "start") : status === "paused" ? "pause" : "not_started"); }
  /** Split the chosen print locations (say the 1-color sleeve) off into their own run; the rest stay together. */
  /** Split a job by print location into two runs (Nov 12, Nick: "one person will run the sleeves and one person will run
   *  the back"): what's picked becomes its own run on the press picked, after this run's part is off (the same shirts are
   *  never on two presses at once). */
  async function splitByLocation(c: Card, off: string[], toMach?: string) {
    if (!c.slot) return;
    const locs = locsOf(c.need), keep = locs.filter((l) => !off.includes(l));
    if (!off.length || !keep.length) return;
    const sb = createClient(), mach = c.machine, to = (toMach && s!.machines.find((m) => m.id === toMach)) || mach;
    const a = subNeed(c.need, keep), b = subNeed(c.need, off);
    await sb.from("production_slots").update({ locations: keep, label: a.label, minutes: estimate(s!, a, mach).minutes, updated_at: new Date().toISOString() }).eq("id", c.slot.id);
    const pos = to.id === mach.id ? c.slot.position + 1 : cards.filter((x) => x.machine.id === to.id && x.day === c.day).length;
    await sb.from("production_slots").insert({ order_id: c.slot.order_id, archived_order_id: c.slot.archived_order_id, sample: !!c.slot.sample, machine: to.id, day: c.day, minutes: estimate(s!, b, to).minutes, start_min: null, position: pos, kind: c.need.type, label: b.label, source: "split", status: "scheduled", locations: off });
    setMsg(`#${c.job.number} split: ${a.label} on ${shortName(mach)} | ${b.label} on ${shortName(to)}. The second runs when the first is off.`);
    setOpen(null); load();
  }
  /** the runs a job was split into (the same order and kind of work, not finished) */
  const splitParts = (c: Card) => (c.slot ? cards.filter((x) => x.slot && x.job.key === c.job.key && x.need.type === c.need.type && !!x.slot.sample === !!c.slot!.sample && x.slot.status !== "done").sort((x, y) => x.day.localeCompare(y.day) || (segs.ofCard.get(x.key)?.[0]?.start ?? 0) - (segs.ofCard.get(y.key)?.[0]?.start ?? 0)) : []);
  /** Unite: a split job's runs go back into one, on the first run's press; anything already printed stays printed */
  async function uniteJob(c: Card) {
    const parts = splitParts(c); if (parts.length < 2) return;
    const first = parts[0], full = c.job.needs.find((n) => n.type === c.need.type) || c.need;
    const rest = parts.slice(1).filter((x) => x.slot!.status === "scheduled");
    const locs = [...new Set([first, ...rest].flatMap((x) => locsOf(x.need)))], all = locsOf(full);
    const n2 = subNeed(full, locs), sb = createClient();
    await sb.from("production_slots").update({ locations: locs.length >= all.length ? null : locs, label: n2.label, minutes: estimate(s!, n2, first.machine).minutes, updated_at: new Date().toISOString() }).eq("id", first.slot!.id);
    if (rest.length) await sb.from("production_slots").delete().in("id", rest.map((x) => x.slot!.id));
    setMsg(`#${c.job.number} is one run again on ${shortName(first.machine)}.`);
    setOpen(null); load();
  }
  async function unbook(sl: Slot) {
    const sb = createClient();
    // a quote's held spot bumped: the hold ends, and whoever held it is told (Hold the spot)
    const h = sl.hold_id ? holdsBy.get(sl.hold_id) : undefined;
    if (h?.order_id) {
      await sb.from("production_holds").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", h.id);
      const c = cards.find((x) => x.slot?.id === sl.id);
      if (h.created_by) await addTask({ owner: h.created_by, title: `#${c?.job.number || ""} ${h.customer}: its held press spot was given away`, notes: `Bumped by ${me.name || me.email}${h.details_due ? ` (details were due ${h.details_due})` : ""}. Hold the spot again from the quote when the details are in.`, area: "customer" }).catch(() => null);
    }
    await sb.from("production_slots").delete().eq("id", sl.id); setOpen(null); load();
  }

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
      await sb.from("production_slots").insert({ order_id: sl.order_id, archived_order_id: sl.archived_order_id, sample: !!sl.sample, machine: m.id, day: p.restDay, minutes: estimate(s!, b, m).minutes, start_min: null, position: pos, kind: c.need.type, label: b.label, source: "partial", status: "scheduled", locations: rest });
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
  // hidden mode: once the schedule has loaded, answer "when can we print it?" for the order being made and stop
  const whenRef = useRef<((n: Need) => WhenResult | null) | null>(null);
  const whenDone = useRef(false);
  useEffect(() => {
    if (!when || whenDone.current || !s || !jobs || !whenRef.current) return;
    whenDone.current = true;
    const needs = needsForOrder(s, { groups: when.groups, lines: [], number: 0, nickname: "" } as never).filter((n) => n.steps.length);
    if (!needs.length) { when.onDates(null); return; }
    const hands = (end: number, soonest: boolean) => { const day0 = Math.floor((end - 1) / 1440), d = fromOrd(day0), m = end - day0 * 1440; return soonest && m <= 15 * 60 ? d : plusWorkdays(d, Math.max(1, s.bufferDays)); };
    const latest = (xs: (string | null)[]) => (xs.some((x) => !x) ? null : (xs as string[]).sort().pop() || null);
    const rs = needs.map((n) => whenRef.current!(n));
    if (rs.some((r) => !r || r.noMachine)) { when.onDates({ soonest: null, aggressive: null, regular: null, slow: null, press: "", minutes: 0, noMachine: true }); return; }
    const ok = rs as WhenResult[];
    when.onDates({
      soonest: latest(ok.map((r) => (r.soonest ? hands(r.soonest.end, true) : null))),
      aggressive: latest(ok.map((r) => (r.aggressive ? hands(r.aggressive.end, true) : null))),
      regular: latest(ok.map((r) => (r.open ? hands(r.open.end, false) : null))),
      slow: latest(ok.map((r) => (r.slow ? [hands(r.slow.end, false), plusWorkdays(today, s.turnDays)].sort().pop()! : null))),
      press: ok.map((r) => r.open?.m.name).filter(Boolean).join(" + "), minutes: ok.reduce((a, r) => a + r.minutes, 0), noMachine: false,
    });
  }, [when, s, jobs, segs]); // eslint-disable-line react-hooks/exhaustive-deps
  // hidden mode: Hold the spot for a quote (Nov 9, Nick): placed just in time for its due date, like a Planner hold, tied
  // to the order; a to-do for the person who held it on the day its details are due
  const holdDone = useRef(false);
  useEffect(() => {
    if (!hold || holdDone.current || !s || !jobs) return;
    holdDone.current = true;
    let msg = "";
    void saveHold({ name: hold.name || `#${hold.number}`, customer: hold.customer, spec: hold.spec, due_date: hold.due, due_time: null, notes: "", order_id: hold.orderId, art: hold.art }, (m) => { msg = m; })
      .then(async (err) => {
        if (err) { hold.onDone({ ok: false, msg: err }); return; }
        const { data: h } = await createClient().from("production_holds").select("details_due").eq("order_id", hold.orderId).eq("status", "planned").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (h?.details_due) await addTask({ title: `#${hold.number} ${hold.customer}: sizes, prints and art approval due (its press spot is held)`, due: h.details_due as string, notes: `Hold the spot: ${msg}\nGet the details in and the quote approved, or the spot can be given away.`, area: "customer" }).catch(() => null);
        hold.onDone({ ok: true, msg });
      });
  }, [hold, s, jobs, segs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !jobs) return when || hold ? null : <div className="empty">Loading the schedule…</div>;

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
    // the early finishes an earlier Re-plan made are worked out again, not stacked on (Nov 11: each Re-plan added more blocks)
    const pm = !replanNoOT ? machines : machines.map((m) => (m.down ? { ...m, down: Object.fromEntries(Object.entries(m.down).map(([d, xs]) => [d, xs.filter((x) => x[2] !== "Leaving early (no overtime)")])) } : m));
    const base = planFresh(allowSplit, pm);
    if (!replanNoOT) return { ...base, otCuts: [] };
    const nowAbs = ord(today) * 1440 + now.min, cuts = new Map<string, OtCut[]>();
    for (const m of machines) {
      if (!m.crew) continue;
      for (let i = 0, d = today; i < 14; i++, d = addDay(d, 1)) {
        const oa = otOn(m, d), sh = shiftOn(m, d); if (oa == null || !sh) continue;
        // work that stays put that day (running, done, firm, a Planner hold) keeps its time
        const stuck = cards.filter((c) => c.machine.id === m.id && (c.slot?.status === "running" || c.slot?.status === "done" || !!c.job.firm || !!c.slot?.locked)).flatMap((c) => segs.ofCard.get(c.key) || []).filter((g) => g.day === d).reduce((t, g) => Math.max(t, g.end), 0);
        // never a crew in for less than the morning: the earliest they go home is lunch (Nov 11, Nick: "we might cut them at
        // lunch, but… they're not going to come in for an hour and run and go home"); no lunch that day, halfway through
        const lu = breaksOn(m, d, sh, segs.lunch.get(m.id + "|" + d)).find((x) => x[2] !== "Warm-up"), noon = lu ? lu[0] : Math.round((sh[0] + sh[1]) / 2);
        const start = Math.ceil(Math.max(oa, stuck, noon, d === today ? nowAbs - ord(d) * 1440 : 0) / 15) * 15;
        if (start < sh[1] - 5) cuts.set(m.id, [...(cuts.get(m.id) || []), { m, day: d, start, end: sh[1] }]);
      }
    }
    if (!cuts.size) return { ...base, otCuts: [] };
    const withCuts = (list: OtCut[]) => pm.map((m) => { const mine = list.filter((x) => x.m.id === m.id); if (!mine.length) return m; const down = { ...(m.down || {}) }; for (const x of mine) down[x.day] = [...(down[x.day] || []), [x.start, x.end, "Leaving early (no overtime)", 0]]; return { ...m, down }; });
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
      { const dd = Math.floor(t / 1440), mm = t - dd * 1440, dl = winsOf(m, fromOrd(dd)).reduce((x, [a0, b0, r0]) => x + Math.max(0, b0 - Math.max(a0, mm)) * r0, 0); if (dl < left - 0.5 && dl < DAY_TAIL) t = norm(m, (dd + 1) * 1440); }
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
    const movable = cards.filter((c) => c.slot && (c.slot.status === "scheduled" || c.slot.status === "paused") && !c.fromPv && c.day >= today && (!typeF || c.machine.type === typeF) && !firmHolds(c) && c.slot?.locked !== "spot");
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
    type Item = { key: string; job: Job; need: Need; slot: Slot | null; cur: string; curDay: string; left: number; /** a lock that still lets it move: to a press, a person, a day */ lock?: { kind: string; m: string; crew: string; day: string } };
    // jobs printing the same art for the same in-hands date sort next to each other and go on one press (Nov 11)
    const artK = (n: Need) => [...artsOf(n)].sort().join(",");
    const items: Item[] = [
      ...movable.map((c) => ({ key: c.key, job: c.job, need: c.need, slot: c.slot, cur: c.machine.id, curDay: c.day, left: 1 - Math.max(0, Math.min(1, +(c.slot?.progress || 0))), lock: c.slot?.locked ? { kind: c.slot.locked, m: c.machine.id, crew: c.machine.crew || "", day: c.day } : undefined })),
      ...(replanTray ? tray.map((t) => ({ key: "t:" + t.job.key + t.need.type, job: t.job, need: t.need, slot: null, cur: "", curDay: "", left: 1 })) : []),
    ].sort((a, b) => dueAbs(a.job) - dueAbs(b.job) || artK(a.need).localeCompare(artK(b.need)) || +!!b.job.firm - +!!a.job.firm || +!!b.job.rush - +!!a.job.rush || (a.curDay || "9999").localeCompare(b.curDay || "9999"));
    const lateOld = new Set(tight.map((t) => t.job.key));
    type Out = { it: Item; mach: Machine; day: string; startAbs: number; endAbs: number; end: string; minutes: number; late: boolean; locs: string[] | null; part: number; parts: number };
    const endDayOf = (t: number) => fromOrd(Math.floor((t - 1) / 1440));
    // the machine that finishes this work earliest, given where each machine's day is up to; among the ones that
    // make the in-hands date, the one that runs the least of it on overtime (a crew past 40 hours this pay week)
    const bestFor = (need: Need, left: number, from: number, prefer: string, due = Infinity, job?: string, only?: (m: Machine) => boolean) => {
      let best: { m: Machine; start: number; end: number; minutes: number; ot: number } | null = null;
      const late = (t: number) => t > due;
      for (const m of s.machines.filter((x) => x.active && fits(need, x) && (!only || only(x)))) {
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
    // where each art (for each in-hands date) went in this plan: the next job with that art and date goes on the same
    // press right after it, unless that makes it late (Nov 11, Nick: "Nine18 is split… on two different schedules… it
    // should be together"). Before, each job took whichever press finished it soonest, so a run of same-art jobs spread
    // across every press with room.
    const artAt = new Map<string, { m: string; end: number }>();
    for (const it of order) {
      // a production date is the day it runs (Nine18's weekly run, Nov 11, Nick: "everything that shows a production date
      // of next Tuesday should be on next Tuesday"): it starts that day, never before
      const from0 = it.job.prod ? Math.max(nowAbs, ord(it.job.prod) * 1440) : nowAbs;
      // a lock that lets it move keeps it with its press, its person (any of their presses) or its day
      const lk = it.lock, only = lk?.kind === "press" ? (x: Machine) => x.id === lk.m : lk?.kind === "person" ? (x: Machine) => (lk.crew ? x.crew === lk.crew : x.id === lk.m) : undefined;
      const fromL = lk?.kind === "day" ? Math.max(from0, ord(lk.day) * 1440) : from0;
      let best = bestFor(it.need, it.left, fromL, it.cur, dueAbs(it.job), it.job.key, only);
      const mate = it.job.due && it.job.kind !== "h" ? [...artsOf(it.need)].map((a) => artAt.get(a + "|" + it.job.due + "|" + (it.job.prod || ""))).find(Boolean) : undefined;
      if (mate && best && best.m.id !== mate.m && !lk) {
        const mm = ms.find((x) => x.id === mate.m);
        if (mm && fits(it.need, mm)) { const minutes = Math.max(15, estimate(s, it.need, mm).minutes * it.left), r = sim(mm, Math.max(mate.end, from0), minutes, it.job.key); if (r.end <= dueAbs(it.job)) best = { m: mm, start: r.start, end: r.end, minutes, ot: r.ot }; }
      }
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
      if (it.job.due) for (const a of artsOf(it.need)) artAt.set(a + "|" + it.job.due + "|" + (it.job.prod || ""), { m: best.m.id, end: best.end });
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
      else ins.push({ ...ownerCols(o.it.job), machine: o.mach.id, day: o.day, minutes: o.minutes, start_min: null, position, kind: o.it.need.type, label: lbl, source: "replan", status: "scheduled", locations: o.locs });
    }
    await Promise.all(ups);
    if (ins.length) await sb.from("production_slots").insert(ins);
    // the crews sent home at 40 hours: an early finish, like Cut Unused Overtime
    const cuts = (p as { otCuts?: OtCut[] }).otCuts || [];
    // the last Re-plan's early finishes go first: this plan works them out again (they used to pile up)
    if (replanNoOT) await sb.from("production_days_off").delete().eq("note", "Leaving early (no overtime)").gte("day", today);
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
  function startDrag(e: DragEvent, d: Drag) {
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", "job"); } catch { /* old browsers */ }
    // the pointer carries a small label, not a see-through copy of the whole card
    try {
      const j = d.card?.job || d.job, chip = document.createElement("div");
      chip.className = "msf-dragchip"; chip.textContent = j ? `#${j.number} ${abbrCo(j.customer || j.name)}` : "Job";
      document.body.appendChild(chip); e.dataTransfer.setDragImage(chip, 12, 12); setTimeout(() => chip.remove(), 0);
    } catch { /* setDragImage not supported */ }
    dragAt.current = Date.now();
    window.getSelection()?.removeAllRanges();
    const pin = !!((e as unknown as MouseEvent).shiftKey || shiftHeld.current) && !d.group;
    setTimeout(() => { setPv(null); setPinAt(null); setDrag(pin ? { ...d, pin } : d); }, 0);
  }
  // dropping a job puts it in the running order where it lands, right up against the job before it (no gaps):
  // it goes before the first job whose middle is below the drop point
  function drop(mach: Machine, d: string, minuteAtPointer: number) {
    setOver("");
    if (!drag) return;
    const t = minuteAtPointer - drag.grabMin;
    setPv(null);
    const inCell = at(mach, d).filter((g) => g.part === 1 && g.c.slot && g.c.key !== drag.card?.key && g.c.slot.status !== "done").sort((x, y) => x.start - y.start);
    if (drag.group) { const ids = new Set(drag.group.map((c) => c.key)); placeGroup(drag.group, mach, d, inCell.find((g) => !ids.has(g.c.key) && (g.start + g.end) / 2 > t)?.c.key); return; }
    const before = inCell.find((g) => (g.start + g.end) / 2 > t);
    place(drag.card ? { card: drag.card } : { job: drag.job, need: drag.need }, mach, d, before?.c.key);
  }
  /** a same-art run moved as one: its jobs land back to back where it's dropped, in the order they were in */
  async function placeGroup(group: Card[], mach: Machine, d: string, beforeKey?: string) {
    const bad = group.find((c) => !fits(c.need, mach));
    if (bad) { setMsg(`#${bad.job.number} ${whyUnfit(bad.need, mach)}.`); return; }
    const ids = new Set(group.map((c) => c.key));
    const lane = cards.filter((c) => c.slot && c.machine.id === mach.id && c.day === d && !ids.has(c.key)).sort((x, y) => (x.startMin ?? 99999) - (y.startMin ?? 99999) || x.slot!.position - y.slot!.position);
    const i = beforeKey ? Math.max(0, lane.findIndex((c) => c.key === beforeKey)) : lane.length;
    const ordered = [...lane.slice(0, i), ...group, ...lane.slice(i)], sb = createClient(), stamp = new Date().toISOString();
    for (let k = 0; k < ordered.length; k++) {
      const c = ordered[k], mine2 = ids.has(c.key);
      await sb.from("production_slots").update({ position: k, updated_at: stamp, ...(mine2 ? { machine: mach.id, day: d, start_min: null, minutes: estimate(s!, c.need, mach).minutes } : {}) }).eq("id", c.slot!.id);
    }
    setMsg(`Moved the run (${group.map((c) => "#" + c.job.number).join(", ")}) to ${mach.name}, ${dayLbl(d)}.`);
    load();
  }
  /** this piece finishes after the job's in-hands time */
  const segLate = (g: Seg) => ord(g.day) * 1440 + g.end > dueAbs(g.c.job);
  const findWords = findQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const isHit = (j: Job) => findWords.length > 0 && findWords.every((w) => `#${j.number} ${j.number} ${j.customer} ${j.name}`.toLowerCase().includes(w.replace(/^#/, "")));
  const cls = (g: Seg) => {
    const c = g.c, late = segLate(g);
    const hs = holdState(c.job);
    return (isHit(c.job) ? " ms-hit" : "") + (hs ? " msh-" + hs : "") + (c.job.kind === "h" && !showHolds ? " msh-dim" : "") + " ms-blk " + c.need.type + (c.job.kind === "h" ? " hold" : "") + (inOT(g) ? " ot" : "") + (c.job.firm ? " is-firm" : "") + (c.job.rush ? " is-rush" : "") + (mine && !isMe(c.job.owner, owners, me) ? " other" : "") + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "") + (g.part > 1 ? " cont-l" : "") + (g.part < g.parts ? " cont-r" : "");
  };
  /** "Late" / "Hold" tag after a card's number (Nov 11, Nick: the late ones' number in red) */
  const tagOf = (g: Seg) => (g.c.job.kind === "h" ? <i className="ms-tag2 hold">Hold</i> : null); // late shows as the bold red number only, no tag (Nov 11, Nick: "remove the late box")
  const tip = (g: Seg) => `#${g.c.job.number} ${g.c.job.customer}${g.c.job.owner ? ` (${g.c.job.owner})` : ""}\n${g.c.job.name}\n${dayLbl(g.day)} ${clockLong(g.start)} – ${clockLong(g.end)}${g.parts > 1 ? ` (part ${g.part} of ${g.parts}; ${fmtMin(g.c.minutes)} in all)` : ` (${fmtMin(g.c.minutes)})`}\n${g.c.need.label}${g.c.job.due ? `\nIn-hands ${dayLbl(g.c.job.due)}` : ""}${g.c.slot?.status === "done" ? "\nDone" : g.c.slot?.status === "running" ? "\nRunning" : ""}${g.c.fromPv ? "\nFrom its Printavo status" : ""}${g.c.carried ? `\nRolled forward from ${dayLbl(g.c.carried)}` : ""}${g.pushed ? "\nStarts later than asked (the job before runs long)" : ""}`;
  const offShade = (mach: Machine, d: string) => {
    const [a, b] = shiftOn(mach, d) || typicalShift(mach), works = !!shiftOn(mach, d) || at(mach, d).length > 0;
    return works ? [[vStart, a], [b, vEnd]].filter(([x, y]) => y > x) : [[vStart, vEnd]];
  };
  const crewOf = (m: Machine) => (m.crew ? s.crews.find((c) => c.id === m.crew) : undefined);
  const hrsTxt = (sh: [number, number]) => `${clock(sh[0])}–${clock(sh[1])}`;
  /** who runs it that day and when, or why it's off */
  const crewLine = (m: Machine, d: string) => { const sh = shiftOn(m, d), slow = (m.down?.[d] || []).filter((x) => x[3] > 0).sort((x, y) => x[3] - y[3])[0]; return isOffDay(m, d) ? `Off · ${m.off![d]}` : sh ? `${hrsTxt(sh)}${m.extra?.[d] ? " · extra" : ""}${slow ? ` · ${Math.round(slow[3] * 100)}%` : ""}` : "not running"; };
  const label = (g: Seg) => <><b>{g.c.job.hold ? "HOLD #" : "#"}{g.c.job.number}</b> {g.part > 1 ? <i className="ms-cont">cont.</i> : null}{who(g.c.job)}</>;

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
            const lanes = Math.max(1, ...ds.map((d) => joined(m, d).length));
            const wkUsed = ds.reduce((a, d) => a + used(m, d), 0), wkCap = ds.reduce((a, d) => a + capacityMin(s, m, d), 0);
            return [
              <div key={m.id + w} className={"ms-wg-m " + m.type} title={`${m.name}: ${fmtMin(wkUsed)} of ${fmtMin(wkCap)} booked`}><b>{shortName(m)}<IssueTag m={m} />{crewOf(m) ? <span className="ms-op"> · {crewOf(m)!.leader}</span> : null}</b><small>{m.type === "screen" ? `${m.colors}C` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat"} · <span className="ms-used">{Math.round(wkUsed / 60)}/{Math.round(wkCap / 60)}h</span></small>
                <div className={"ms-cap" + (wkUsed > wkCap ? " full" : wkUsed > wkCap * s.fillTarget ? " warn" : "")}><i style={{ width: `${Math.min(100, wkCap ? (wkUsed / wkCap) * 100 : 0)}%` }} /></div></div>,
              ...ds.map((d) => {
                const gs = joined(m, d).map((x) => ({ ...x.g, start: x.start, end: x.end }));
                const u = used(m, d), cap = capacityMin(s, m, shiftOn(m, d) ? d : undefined);
                return (
                  <div key={m.id + d} className={"ms-wc" + (d === today ? " today" : d < today ? " past" : "") + (over === m.id + d ? (canDrop(m) ? " over" : " no") : "") + (u >= cap ? " full" : "")} style={{ minHeight: lanes * LANE + 10, backgroundSize: `${(180 / range) * 100}% 100%` }}
                    onDragOver={(e) => { e.preventDefault(); setOver(m.id + d); }} onDragLeave={() => setOver("")}
                    onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, d, vStart + ((e.clientX - r.left) / r.width) * range); }}>
                    {offShade(m, d).map(([a, b]) => <div key={a} className="ms-off h" style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />)}
                    {(() => { const sh = shiftOn(m, d); return sh ? breaksOn(m, d, sh, segs.lunch.get(m.id + "|" + d)).map(([a0, b0, why]) => { const a = Math.max(a0, vStart), b = Math.min(b0, vEnd); return b > a ? <div key={"bk" + a0} className={(why === "Warm-up" ? "ms-warm" : "ms-lunch") + " h"} title={`${why} ${clockLong(a0)} – ${clockLong(b0)}`} style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} /> : null; }) : null; })()}
                    {(m.down?.[d] || []).filter((x) => !x[4]).map(([a0, b0, why, rate]) => { const a = Math.max(a0, vStart), b = Math.min(b0, vEnd); return <div key={"dn" + a} className={"ms-down h" + (rate ? " slow" : "")} title={rate ? `${why}: ${Math.round(rate * 100)}%` : `Down ${clockLong(a)} – ${clockLong(b)}: ${why}`} style={{ left: pct(a), width: `${((b - a) / range) * 100}%` }} />; })}
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
    const inList = new Set<string>(); // jobs drawn as rows of a same-art list (filled per press column, before its cards)
    return (
    <div className={"ms-dv" + (o.sub ? " cont" : "")} key={"dv" + day}>
      {o.title ? <div className="ms-dv-t">{o.title}</div> : null}
      <div className="ms-dv-grid" style={{ gridTemplateColumns: `${gut}px repeat(${machines.length}, minmax(${colMin}px,1fr))`, minWidth: gut + machines.length * colMin }}>
        {o.sub ? <>
          <div className="ms-dv-bar" style={{ gridColumn: "1 / -1" }}>{o.sub}</div>
        </> : <>
        <div className="ms-dv-corner" />
        {machines.map((m) => { const u = used(m, day), cap = capacityMin(s, m, shiftOn(m, day) ? day : undefined); return (
          <div key={m.id} className={"ms-dv-h " + m.type + (isOffDay(m, day) ? " off" : "")}><b title={m.name}>{shortName(m)}{crewOf(m) ? <span className="ms-lead-n"><span className="ms-dot-sep"> · </span>{crewOf(m)!.leader}</span> : null}</b>{!crewOf(m) && <small>{m.type === "screen" ? `${m.colors} colors` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat press"}</small>}<IssueTag m={m} />
            {/* the crew's regular hours next to when the operator actually clocked in today (time clock) */}
            <div className="ms-sa">
              <button type="button" className={"ms-sa-c ms-crew" + (isOffDay(m, day) ? " off" : "")} onClick={() => setDownEdit({ machine: m.id, day, allDay: true })} title={isOffDay(m, day) ? "Off this day: tap to change" : "Mark this press (or its crew) off"}><i>Schedule</i><span>{crewLine(m, day)}</span></button>
              {crewOf(m) && day === today && <ActualCell m={m} />}
            </div>
            <div className={"ms-cap" + (u > cap ? " full" : u > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(u)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (u / cap) * 100)}%` }} /></div>
            <small className="ms-used">{o.colMin ? `${+(u / 60).toFixed(1)} / ${+(cap / 60).toFixed(1)}h` : `${fmtMin(u)} / ${fmtMin(cap)}`}</small></div>
        ); })}</>}
        <div className="ms-dv-gut" style={{ height: (rng / 60) * HOUR_PX }}>{hrsL.map((h) => <span key={h} style={{ top: ((h - vS) / 60) * HOUR_PX }}>{clock(h)}</span>)}</div>
        {machines.map((m) => (
          <div key={m.id} className={"ms-dv-col" + (over === m.id + day ? (canDrop(m) ? " over" : " no") : "")} style={{ height: (rng / 60) * HOUR_PX, backgroundSize: `100% ${HOUR_PX}px` }}
            onDragOver={(e) => { e.preventDefault(); setOver(m.id + day); }} onDragLeave={() => setOver("")}
            onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, day, vS + ((e.clientY - r.top) / HOUR_PX) * 60); }}
            onClick={(e) => { if ((e.target as HTMLElement).closest(".ms-blk, .ms-down, .ms-slow button, .ms-warm, .ms-lunch, .msar-box")) return; const r = e.currentTarget.getBoundingClientRect(); setDownEdit({ machine: m.id, day, start: Math.floor((vS + ((e.clientY - r.top) / HOUR_PX) * 60) / 30) * 30 }); }}
            title="Click an open time to add downtime here">
            {shade(m).map(([a, b]) => <div key={a} className="ms-off" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} />)}
            {/* a firm job's deadline is said on its card ("Firm Wed 12p"), not as a line on the calendar (Nov 9, Nick) */}
            {(() => { const sh = shiftOn(m, day), oa = sh ? otOn(m, day) : null; if (!sh || oa == null) return null; const a = Math.max(oa, vS), b = Math.min(sh[1], vE); return b > a ? <div className="ms-ot" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} title={`${crewOf(m)?.leader ? crewOf(m)!.leader + "'s crew" : "This crew"} is past 40 hours this pay week from ${clockLong(oa)}: overtime`}><span>Overtime</span></div> : null; })()}
            {(() => { const sh = shiftOn(m, day); return sh ? brkBands(breaksOn(m, day, sh, segs.lunch.get(m.id + "|" + day))).map(({ a: a0, b: b0, lunch, min }) => { const a = Math.max(a0, vS), b = Math.min(b0, vE); if (b <= a) return null; const warm = !lunch; return (
              <div key={"bk" + a0} className={(warm ? "ms-warm" : "ms-lunch") + " ms-brkc"} style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} title={`${warm ? "Press warm-up" : `${crewOf(m)?.leader ? crewOf(m)!.leader + "'s crew" : "Crew"} lunch`} ${clockLong(a0)} – ${clockLong(b0)}`}>{((b - a) / 60) * HOUR_PX >= 13 && <span>{warm ? "Warm-up" : `Lunch ${min} min`}</span>}</div>
            ); }) : null; })()}
            {(m.down?.[day] || []).filter((x) => !x[4]).map(([a0, b0, why, rate]) => { const [sa, sb] = shiftOn(m, day) || typicalShift(m), a = Math.max(a0, rate ? sa : a0, vS), b = Math.min(b0, rate ? sb : b0, vE); if (b <= a) return null; return rate
              ? <div key={"sl" + a} className="ms-slow" style={{ top: ((a - vS) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }}><button type="button" onClick={() => setDownEdit({ machine: m.id, day })} title={`${why}: ${m.name} runs at ${Math.round(rate * 100)}% ${clockLong(a)} – ${clockLong(b)} (jobs take ${+(1 / rate).toFixed(1)}× as long)`}>{why} · {Math.round(rate * 100)}%</button></div>
              : <button type="button" key={"dn" + a} className="ms-down" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setDownMenu({ x: e.clientX, y: e.clientY, row: offRow(m, day, a), machine: m.id, day, a, b, why }); }} style={{ top: ((a - vS) / 60) * HOUR_PX, height: Math.max(16, ((b - a) / 60) * HOUR_PX) }} title={`${m.name} down ${clockLong(a)} – ${clockLong(b)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day, start: a })}><b>Down</b> {clock(a)}–{clock(b)} · {why}</button>; })}
            {day === today && now.min >= vS && now.min <= vE && <div className="ms-now" style={{ top: ((now.min - vS) / 60) * HOUR_PX }} />}
            {(() => {
              // same-art jobs run back to back: one box around the run (option G, Nov 9); when its jobs are too short to read
              // as cards, the box is a list: the customer and total, then a thin row per job (option N)
              const js = joined(m, day), runs: { a: number; b: number; items: typeof js; saved: number }[] = [];
              for (let i = 1; i < js.length; i++) {
                const c = js[i].g.c;
                if (!c.sameArt || c.sameArt.with !== js[i - 1].g.c.job.number) continue;
                const last = runs[runs.length - 1];
                if (last && last.b === js[i - 1].end) { last.b = js[i].end; last.items.push(js[i]); last.saved += c.sameArt.saved; }
                else runs.push({ a: js[i - 1].start, b: js[i].end, items: [js[i - 1], js[i]], saved: c.sameArt.saved });
              }
              inList.clear();
              return runs.map((r) => {
                const a = Math.max(r.a, vS), b = Math.min(r.b, vE); if (b <= a) return null;
                const H = ((b - a) / 60) * HOUR_PX + 4, list = r.items.some((x) => ((x.end - x.start) / 60) * HOUR_PX < 40);
                const n = r.items.length, title = `Same art: ${n} jobs run back to back, one setup (${fmtMin(r.saved)} saved)`;
                if (!list) return <div key={"ar" + r.a} className="msar-box" style={{ top: ((a - vS) / 60) * HOUR_PX - 3, height: H }} title={title}><span className="msar-h" draggable onDragStart={(e) => startDrag(e, { card: r.items[0].g.c, grabMin: 0, group: r.items.map((x) => x.g.c) })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={(e) => { e.stopPropagation(); if (e.detail >= 2) setGrpEdit(r.items.map((x) => x.g.c)); }} title="Drag to move the whole run · double-click to edit its time">🔗 Same art · {n} jobs · one setup</span></div>;
                for (const x of r.items) inList.add(x.g.c.key);
                const c0 = r.items[0].g.c, pcs = r.items.reduce((t, x) => t + x.g.c.need.qty, 0), gl0 = glance(c0.need, c0.minutes);
                const open = listOpen === m.id + day + r.a, fit = Math.max(1, Math.floor((H - 22) / 16)), show = open || n <= fit ? r.items : r.items.slice(0, Math.max(1, fit - 1));
                return (
                  <div key={"ar" + r.a} className={"msar-box msar-list" + (open ? " open" : "")} style={{ top: ((a - vS) / 60) * HOUR_PX - 3, minHeight: H, ...(open ? {} : { height: H }) }} title={title}>
                    <span className="msar-lh" draggable onDragStart={(e) => startDrag(e, { card: c0, grabMin: 0, group: r.items.map((x) => x.g.c) })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={(e) => { e.stopPropagation(); if (e.detail >= 2) setGrpEdit(r.items.map((x) => x.g.c)); }} title="Drag to move the whole run · double-click to edit its time">🔗 {abbrCo(c0.job.customer)} · same art · {gl0.colors} · {pcs.toLocaleString()} P</span>
                    {show.map((x) => <button key={x.g.c.key} type="button" className="msar-row" draggable onDragStart={(e) => startDrag(e, { card: x.g.c, grabMin: 0 })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(x.g.c)} title={tip(x.g)}><b>#{x.g.c.job.number}</b>{flags(x.g.c.job)}<span>{x.g.c.need.qty.toLocaleString()} P</span></button>)}
                    {show.length < n ? <button type="button" className="msar-more" onClick={() => setListOpen(m.id + day + r.a)}>+{n - show.length} more</button> : open ? <button type="button" className="msar-more" onClick={() => setListOpen("")}>Show less</button> : null}
                  </div>
                );
              });
            })()}
            {joined(m, day).filter((x) => !inList.has(x.g.c.key)).map(({ g, start: gs0, end: ge0, gaps, n: nj }) => { const h = Math.max(22, ((ge0 - gs0) / 60) * HOUR_PX - 2), gl = glance(g.c.need, g.c.minutes), whole = nj > 1 && nj >= g.parts;
              // carries over (option J): the end-of-day piece is open at the bottom, the next morning's open at the top
              const all = segs.ofCard.get(g.c.key) || [], lastPart = g.part + nj - 1, nxt = all.find((x) => x.part === lastPart + 1 && x.day !== day), prv = all.find((x) => x.part === g.part - 1 && x.day !== day);
              return (
              <button key={g.c.key + g.part} type="button" draggable className={cls(g) + " card" + (h < 40 ? " tiny" : h < 60 ? " short" : "") + (gaps.length ? " ms-thru" : "") + (nxt ? " mscv-out" : "") + (prv ? " mscv-in" : "")} style={{ top: ((gs0 - vS) / 60) * HOUR_PX + 1, height: h }} title={tip(g)}
                onDragStart={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); startDrag(e, { card: g.c, grabMin: ((e.clientY - r.top) / HOUR_PX) * 60 }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(g.c)}>
                {prv ? <span className="mscv-from">continued from {dayLbl(prv.day).split(",")[0]} · {g.part} of {g.parts}</span> : null}
                <span className="ms-l1"><b>{numLink(g.c.job)}{g.c.slot?.status === "done" ? <em className="ok"> ✓</em> : null}</b>{tagOf(g)}{flags(g.c.job)}<span className="co"><span className="full">{g.c.job.customer}</span><span className="ab">{abbrCo(g.c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()} P</span></span>
                <span className="ms-l2">{holdTag(g.c.job)}{g.c.job.name || g.c.need.label}</span>
                <span className="ms-l3"><i>{gl.colors}</i><i className="q">{gl.units.toLocaleString()} pcs</i><i className="t">{gl.run}{g.parts > 1 && !whole ? ` · ${g.part}/${g.parts}` : ""}</i><i className="qc">{gl.units.toLocaleString()} P</i></span>
              {nxt ? <span className="mscv-to" aria-hidden>↓ continues {dayLbl(nxt.day).split(",")[0]} {clock(nxt.start)}</span> : null}{gaps.map(([a0, b0]) => <span key={"gp" + a0} className="ms-thru-l" aria-hidden style={{ top: ((a0 - gs0) / 60) * HOUR_PX, height: ((b0 - a0) / 60) * HOUR_PX }}>{((b0 - a0) / 60) * HOUR_PX >= 13 ? <em>Lunch</em> : null}</span>)}
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
      const rows = machines.map((m) => ({ m, gs: joined(m, d).map((x) => ({ ...x.g, start: x.start, end: x.end })), sh: shiftOn(m, d) }));
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
                  <span className="ms-pj-b"><span className="ms-pj-1"><b>{numLink(g.c.job)}</b>{tagOf(g)}{flags(g.c.job)}{st === "done" ? <em className="ok"> ✓</em> : null} {abbrCo(g.c.job.customer || "")}</span><span className="ms-pj-2">{g.c.job.name || g.c.need.label}</span><span className="ms-pj-3">{gl.colors} · {gl.units.toLocaleString()} pcs · {gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</span></span>
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
  async function place(c: { card?: Card; job?: Job; need?: Need; group?: Card[] }, mach: Machine, d: string, beforeKey?: string) {
    if (c.group) return placeGroup(c.group, mach, d, beforeKey);
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
      const r = await sb.from("production_slots").insert({ ...ownerCols(job), machine: mach.id, day: d, minutes, start_min: null, position: idx, kind: need.type, label: need.label, source: "manual", locations: locsFor(job, need) }).select("id").single();
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
          <span className="ms-l1"><b>{c.job.hold ? "HOLD #" : "#"}{c.job.number}{c.slot?.status === "done" ? <em className="ok"> ✓</em> : null}</b>{flags(c.job)}<span className="co"><span className="full">{c.job.customer}</span><span className="ab">{abbrCo(c.job.customer)}</span></span><span className="l1x">{gl.colors} · {gl.units.toLocaleString()} P</span></span>
          <span className="ms-l2">{holdTag(c.job)}{c.job.name || c.need.label}</span>
          <span className="ms-l3"><i>{gl.colors}</i><i className="q">{gl.units.toLocaleString()} pcs</i><i className="t">{gl.run}{g.parts > 1 ? ` · ${g.part}/${g.parts}` : ""}</i><i className="qc">{gl.units.toLocaleString()} P</i></span>
        </>; })() : <>
        <b>{c.job.number}</b>{c.slot?.status === "done" ? <em className="ok">✓</em> : null}
        <span className="ms-cn" title={who(c.job)}>{g.part > 1 ? <em>cont. </em> : null}{who(c.job)}</span>
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
                const gs = joined(m, d).map((x) => ({ ...x.g, start: x.start, end: x.end }));
                const u = used(m, d), works = !!shiftOn(m, d) || gs.length > 0, cap = capacityMin(s, m, works && !shiftOn(m, d) ? undefined : d);
                return (
                  <div key={m.id + d} className={"ms-lc" + (isToday ? " today" : d < today ? " past" : "") + (!works || isOffDay(m, d) ? " off" : "") + (over === m.id + d ? (canDrop(m) ? " over" : " no") : "")}
                    onDragOver={(e) => { e.preventDefault(); setOver(m.id + d); }} onDragLeave={() => setOver((o) => (o === m.id + d ? "" : o))} onDrop={(e) => { e.preventDefault(); if (drag) place(drag, m, d); }}>
                    {works && <div className={"ms-lc-cap" + (u > cap ? " full" : u > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(u)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (u / cap) * 100)}%` }} /><span>{u ? `${(u / 60).toFixed(u % 60 ? 1 : 0)}/${Math.round(cap / 60)}h` : ""}</span></div>}
                    {(m.down?.[d] || []).filter((x) => !x[4]).map(([a, b, why, rate]) => <button type="button" key={"dn" + a} className={"ms-lc-dn" + (rate ? " slow" : "")} title={rate ? `${why}: runs at ${Math.round(rate * 100)}%${a > 0 || b < 1440 ? ` ${clockLong(a)} – ${clockLong(b)}` : ""}` : `Down ${clockLong(a)} – ${clockLong(b)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day: d, start: rate ? undefined : a })}>{rate ? `${why} · ${Math.round(rate * 100)}%` : `Down ${clock(a)}–${clock(b)}`}</button>)}
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
  /* ---------- Next 12 hours (default, Nov 11 2026, Nick): the next 12 press hours as one run down the page, today
     flowing into tomorrow with only the rainbow bar between them; a job that runs over the day break stays one card.
     On the right, who's on what tomorrow and the day after. ---------- */
  const FLOW_HOURS = 12, FLOW_PX = 60;
  // the rest of today, then the next two full working days (Nov 11, Nick: "you should show the next 2 full days of
  // production… it's okay to scroll down")
  const flowBlocks = (() => {
    const out: { d: string; a: number; b: number }[] = [];
    let full = 0;
    for (let i = 0, d = today; i < 21 && full < 2; i++, d = addDay(d, 1)) {
      if (!visible(d)) continue;
      const sh = machines.map((m) => shiftOn(m, d)).filter(Boolean) as [number, number][];
      const gs = machines.flatMap((m) => at(m, d));
      if (!sh.length && !gs.length) continue;
      const a0 = Math.min(...sh.map((x) => x[0]), ...gs.map((g) => g.start)), b0 = Math.max(...sh.map((x) => x[1]), ...gs.map((g) => g.end));
      // every day, today too, shows whole from the first crew in, live clock on or off (Nov 12, Nick: "you have to show
      // the whole day… you should see the past, like at least the morning"); what already happened is a light tint behind
      // the jobs, never a shade over them
      const a = Math.floor(a0 / 30) * 30;
      out.push({ d, a, b: Math.ceil(b0 / 30) * 30 });
      if (d !== today) full++;
    }
    return out.length ? out : [{ d: today, a: Math.floor(now.min / 60) * 60, b: Math.floor(now.min / 60) * 60 + 12 * 60 }];
  })();
  const flowTop = flowBlocks.map((_, i) => flowBlocks.slice(0, i).reduce((t, x) => t + ((x.b - x.a) / 60) * FLOW_PX, 0));
  const flowH = flowBlocks.reduce((t, x) => t + ((x.b - x.a) / 60) * FLOW_PX, 0);
  const flowY = (bi: number, min: number) => flowTop[bi] + ((Math.min(Math.max(min, flowBlocks[bi].a), flowBlocks[bi].b) - flowBlocks[bi].a) / 60) * FLOW_PX;
  /** where a point on the column is: which day and minute */
  const flowAt = (y: number) => { let bi = flowBlocks.length - 1; for (let i = 0; i < flowBlocks.length; i++) if (y < flowTop[i] + ((flowBlocks[i].b - flowBlocks[i].a) / 60) * FLOW_PX) { bi = i; break; } return { d: flowBlocks[bi].d, min: flowBlocks[bi].a + ((y - flowTop[bi]) / FLOW_PX) * 60 }; };
  const wkd = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  /** the job a drop at minute t goes in front of (the first whose middle is below it), "" = at the end */
  const dropBefore = (mach: Machine, d: string, t: number) => at(mach, d).filter((g) => g.part === 1 && g.c.slot && g.c.key !== drag?.card?.key && g.c.slot.status !== "done").sort((x, y) => x.start - y.start).find((g) => (g.start + g.end) / 2 > t)?.c.key || "";
  // the schedule as it would be with the dragged job dropped where the pointer is (laid out by the same rules as the real one)
  const pvLay = (() => {
    if (!pv || !drag || drag.group) return null;
    const job = drag.card?.job || drag.job, need = drag.card?.need || drag.need, mach = machines.find((m) => m.id === pv.mid);
    const k = `${pv.mid}|${pv.d}|${pv.before}|${drag.card?.key || (job?.key || "") + (need?.type || "")}|${cards.length}`;
    if (pvCache.current.k === k) return pvCache.current.v;
    let v: ReturnType<typeof layoutAll> | null = null;
    if (mach && job && need && fits(need, mach)) {
      const inCell = at(mach, pv.d).filter((g) => g.part === 1 && g.c.slot && g.c.key !== drag.card?.key && g.c.slot.status !== "done").sort((x, y) => x.start - y.start).map((g) => g.c);
      let idx = pv.before ? inCell.findIndex((c) => c.key === pv.before) : -1;
      if (idx < 0) idx = inCell.length;
      const pos = new Map(inCell.map((c, i) => [c.key, i < idx ? i : i + 1]));
      const minutes = estimate(s, need, mach).minutes;
      const base = drag.card?.slot || ({ id: "pv", order_id: null, archived_order_id: null, status: "scheduled", position: 0 } as unknown as Slot);
      const moved: Card = { ...(drag.card || ({ key: "pv:" + job.key + need.type, job, need, fromPv: false } as Card)), machine: mach, day: pv.d, minutes, startMin: null, slot: { ...base, machine: mach.id, day: pv.d, position: idx, start_min: null, minutes } };
      const hypo = cards.filter((c) => c.key !== drag.card?.key).map((c) => (pos.has(c.key) && c.slot ? { ...c, startMin: null, slot: { ...c.slot, position: pos.get(c.key)!, start_min: null } } : c));
      hypo.push(moved);
      v = layoutAll(hypo, liveNow);
    }
    pvCache.current = { k, v };
    return v;
  })();
  const pvKey = drag?.card?.key || (drag?.job && drag.need ? "pv:" + drag.job.key + drag.need.type : "");
  /** how a job moves in the live drag: "↓ 1h 30m", "→ Thu 8:20a", and whether that makes it miss its in-hands */
  const pvMove = (c: Card) => {
    if (!pvLay || c.key === pvKey) return null;
    const byT = (a: Seg, b: Seg) => a.day.localeCompare(b.day) || a.start - b.start;
    const o = [...(segs.ofCard.get(c.key) || [])].sort(byT), n = [...(pvLay.ofCard.get(c.key) || [])].sort(byT);
    if (!o.length || !n.length) return null;
    const oa = ord(o[0].day) * 1440 + o[0].start, na = ord(n[0].day) * 1440 + n[0].start;
    if (Math.abs(na - oa) < 5) return null;
    const ol = o[o.length - 1], nl = n[n.length - 1], late = ord(nl.day) * 1440 + nl.end > dueAbs(c.job) && !(ord(ol.day) * 1440 + ol.end > dueAbs(c.job));
    return { txt: (n[0].day !== o[0].day ? `→ ${wkd(n[0].day)} ${clock(n[0].start)}` : `${na > oa ? "↓" : "↑"} ${fmtMin(Math.abs(na - oa))}`) + (late ? " · past in-hands" : ""), late, down: na > oa };
  };
  /** the goods dot: green counted, amber here but not all counted, red not counted and it runs within a day (or a
   *  problem), open not here yet; old Printavo jobs on the calendar were ready to print */
  const dotOf = (c: Card, startAbs: number) => {
    if (c.job.kind === "h") return null;
    if (c.job.kind === "a") return { k: "g", t: "Ready to print (Printavo)" };
    const st = goodsSt.get(c.job.id) || "";
    if (st === "received") return { k: "g", t: "Goods counted" };
    if (st === "arrived" || st === "partial") return { k: "a", t: st === "partial" ? "Goods partly counted" : "Goods here, not counted yet" };
    if (st === "issue") return { k: "r", t: "Goods problem (short, wrong or damaged)" };
    const soon = startAbs - (ord(now.day) * 1440 + now.min) < 24 * 60;
    return { k: soon ? "r" : "o", t: soon ? "Not counted yet, and it runs within a day" : st === "on_way" ? "Goods on the way" : "Goods not here yet" };
  };
  // the goods mark: a tiny shirt in the goods color (Nov 12, Nick), exactly the height of the numbers beside it; it sits in
  // one inline run with the number (`tn`) so it rests on the same baseline
  const dotEl = (c: Card, g: Seg) => { const d = dotOf(c, ord(g.day) * 1440 + g.start); return d ? <GoodsTee k={d.k} t={d.t} /> : null; };
  const tn = (mark: ReactNode, numb: ReactNode) => <span className="msf-tn">{mark}{numb}</span>;
  /** why it's where it is: locked, the only press it fits, a person put it there, or the schedule did */
  const onlyFits = (c: Card) => s.machines.filter((m) => m.active && fits(c.need, m)).length === 1;
  const whyOf = (c: Card): "lock" | "cap" | "me" | "ai" => (c.slot?.locked ? "lock" : onlyFits(c) ? "cap" : c.slot?.source === "manual" ? "me" : "ai");
  const WHY_T = { lock: "Locked", cap: "Only fits this press", me: "Shop scheduled", ai: "Placed by the schedule" } as const;
  const whyEl = (c: Card) => { const w = whyOf(c); return <WhyIcon w={w} title={w === "lock" ? `Locked to ${c.slot?.locked === "spot" ? "this spot" : c.slot?.locked === "press" ? "this press" : c.slot?.locked === "person" ? "this person" : "this day"} · right-click to change` : `${WHY_T[w]} · right-click to lock`} />; };
  /** Run next (Nov 11, Nick): first on its press after what's running now, today if the press still has time, else its next day */
  function runNext(c: Card) {
    setLockMenu(null);
    const m = c.machine, sh = shiftOn(m, today);
    let d = today; if (!sh || now.min >= sh[1] - 30) { d = addDay(today, 1); for (let g = 0; g < 14 && !shiftOn(m, d); g++) d = addDay(d, 1); }
    const nextUp = at(m, d).filter((g) => g.part === 1 && g.c.key !== c.key && g.c.slot && g.c.slot.status === "scheduled").sort((a, b) => a.start - b.start)[0];
    place({ card: c }, m, d, nextUp?.c.key);
  }
  /** Shift + drag: book it at exactly that press, day and time, locked there ("spot"); Re-plan works around it */
  async function pinTo(dr: Drag, mach: Machine, d: string, min: number) {
    setPinAt(null); setPv(null); setOver(""); setDrag(null);
    const need = dr.card?.need || dr.need, job = dr.card?.job || dr.job;
    if (!need || !job || !s) return;
    if (!fits(need, mach)) { setMsg(`#${job.number} can't run on ${shortName(mach)}.`); return; }
    const sb = createClient(), when = Math.round(min / 15) * 15;
    const pos = at(mach, d).filter((x) => x.part === 1 && x.start < when && x.c.key !== dr.card?.key).length;
    const r = dr.card?.slot
      ? await sb.from("production_slots").update({ machine: mach.id, day: d, start_min: when, position: pos, locked: "spot", updated_at: new Date().toISOString() }).eq("id", dr.card.slot.id)
      : await sb.from("production_slots").insert({ ...ownerCols(job), machine: mach.id, day: d, minutes: dr.card?.minutes || estimate(s, need, mach).minutes, start_min: when, position: pos, kind: need.type, label: need.label, source: "manual", locked: "spot", locations: locsFor(job, need) });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(`#${job.number} pinned to ${shortName(mach)} ${dayLbl(d)} ${clockLong(when)}. Re-plan works around it; right-click → Unlock to let it move.`);
    load();
  }
  /** turn Live clock on or off for the whole shop (production settings) */
  async function setLiveClock(on: boolean) {
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const d = (data?.data || {}) as { production?: Record<string, unknown> };
    const r = await sb.from("settings").upsert({ id: 1, data: { ...d, production: { ...(d.production || {}), liveClock: on } }, updated_at: new Date().toISOString() });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(on ? "Live clock is on: the schedule follows the time clock and press timers." : "Live clock is off: the schedule stays as planned until someone updates it.");
    load();
  }
  /** Right-click on a job: what the press timer and time clock do, by hand (Nov 12, Nick). Every change goes through
   *  logAction, the same booking fields and job log the press timer writes, so nothing changes when the floor clocks in. */
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
  const isoAt = (t: string) => (t ? new Date(`${today}T${t}:00`).toISOString() : new Date().toISOString());
  function openRc(c: Card, g: Seg, x: number, y: number) {
    const ref = c.job.kind === "o" ? c.job.id : c.job.kind === "a" ? "pv:" + c.job.id : "";
    setRcGoods(ref ? { ref, job: null, err: "" } : null);
    if (ref) void fetch(`/api/goods/checkin?ref=${encodeURIComponent(ref)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const job = [...((j.jobs || []) as CheckJob[]), ...((j.problems || []) as CheckJob[])].find((x) => x.ref === ref) || null;
      setRcGoods((g) => (g && g.ref === ref ? { ref, job, err: j.error || (job ? "" : "No goods on this job.") } : g));
    }).catch(() => setRcGoods((g) => (g && g.ref === ref ? { ...g, err: "Couldn't load the goods." } : g)));
    setRcF({ t: hhmm(now.min), pcs: String(Math.round(+(c.slot?.progress || 0) * c.need.qty) || ""), why: "Lunch", next: "fulfillment", edit: false });
    setRcPause(false); setRcSure(false);
    setLockMenu({ c, g, x, y });
  }
  async function slotFor(c: Card, g: Seg): Promise<Slot | null> {
    if (c.slot) return c.slot;
    const pos = at(c.machine, g.day).filter((x) => x.part === 1 && x.start < g.start).length;
    const r = await createClient().from("production_slots").insert({ ...ownerCols(c.job), machine: c.machine.id, day: g.day, minutes: c.minutes, start_min: null, position: pos, kind: c.need.type, label: c.need.label, source: "manual", locations: locsFor(c.job, c.need) }).select("*").single();
    if (r.error) { setMsg(r.error.message); return null; }
    return r.data as Slot;
  }
  async function rcDo(c: Card, g: Seg, action: "start" | "pause" | "resume" | "progress" | "done" | "not_started" | "restart", why?: string) {
    const sl = await slotFor(c, g); if (!sl) return;
    const when = isoAt(rcF.t);
    setLockMenu(null);
    if (action === "restart") {
      // the start time fixed by hand
      const sb = createClient();
      await sb.from("production_slots").update({ started_at: when, updated_at: new Date().toISOString() }).eq("id", sl.id);
      await sb.from("production_slot_log").insert({ slot_id: sl.id, order_id: sl.order_id, machine: sl.machine, action: "start", progress: +(sl.progress || 0), by: me.name || me.email, note: "Start time changed", at: when });
      setMsg(`#${c.job.number} started at ${clock(Math.round((new Date(when).getTime() - new Date(`${today}T00:00:00`).getTime()) / 60000))}.`); load(); return;
    }
    const q = c.need.qty || 0, pcs = Math.max(0, Math.min(q, Math.round(+rcF.pcs || 0)));
    if (action === "progress") { await logAction(sl, "progress", q ? pcs / q : 0, true, when); setMsg(`#${c.job.number}: ${pcs} of ${q} done.`); return; }
    if (action === "pause") { const w = why || rcF.why; await logAction(sl, "pause", undefined, true, when, `Paused: ${w}`); setMsg(`#${c.job.number} paused (${w}).`); return; }
    if (action !== "done") { await logAction(sl, action, undefined, true, when); setMsg(`#${c.job.number} ${action === "start" ? "started" : action === "resume" ? "back on" : "set back to not started"}.`); return; }
    await logAction(sl, "done", 1, false, when);
    // the order moves on once its last job on the schedule is done
    let moved = "";
    if (sl.order_id) {
      const sb = createClient();
      const { data: rest } = await sb.from("production_slots").select("id").eq("order_id", sl.order_id).neq("status", "done").neq("id", sl.id);
      const { data: o } = await sb.from("orders").select("status").eq("id", sl.order_id).maybeSingle();
      const cur = (o as { status?: string } | null)?.status || "";
      if (!(rest || []).length && ["approved", "art", "blanks", "production", "fulfillment"].includes(cur) && cur !== rcF.next) {
        const k = rcF.next as StatusKey;
        const { error } = await sb.from("orders").update({ status: k, type: ST[k].type }).eq("id", sl.order_id);
        if (!error) {
          await sb.from("order_events").insert({ order_id: sl.order_id, kind: "status", detail: k, actor: me.name || me.email || "shop" });
          if (k === "ready" || k === "completed") void orderStatusEmail(sl.order_id, k).catch(() => null);
          moved = `; the order is now ${ST[k].label}`;
        }
      }
    }
    setMsg(`#${c.job.number} complete${moved}.`);
    load();
  }
  /** Rush / Firm from the right click (the order's flags, as the job card's were) */
  async function flagJob(c: Card, x: { rush?: boolean; firm?: boolean; due_time?: number | null }) {
    setLockMenu(null);
    const r = await createClient().from("orders").update({ ...x, updated_at: new Date().toISOString() }).eq("id", c.job.id);
    setMsg(r.error ? r.error.message : `#${c.job.number}: ${x.rush !== undefined ? (x.rush ? "Rush" : "not Rush") : x.firm ? "Firm" : "not Firm"}.`);
    load();
  }
  /** every piece here: a count saved with what's expected, the same as counting each size on Goods & Receiving */
  async function goodsAllHere(job: CheckJob) {
    const lines: CheckLine[] = job.items.flatMap((it) => Object.entries(it.sizes).map(([size, n]) => ({ item: [it.style, it.color].filter(Boolean).join(" · "), style: it.style, color: it.color, size, expected: n, received: n, issue: "" as const })));
    setLockMenu(null);
    if (!lines.length) { setMsg(`#${job.number} has no sizes to count yet.`); return; }
    const r = await fetch("/api/goods/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: job.ref, lines, boxes: null, note: "All here (marked on the schedule)", photos: [], source: job.source, owner: job.owner || "customer" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setMsg(!r?.ok || j.error ? j.error || "Couldn't save the count." : `#${job.number}: all ${lines.reduce((a, l) => a + l.expected, 0)} pieces received.`);
    setGoodsRev((x) => x + 1);
  }
  async function lockAs(c: Card, g: Seg, kind: "spot" | "press" | "day" | "person" | null) {
    setLockMenu(null);
    const sb = createClient();
    if (c.slot) {
      const r = await sb.from("production_slots").update({ locked: kind, ...(kind === "spot" ? { start_min: Math.round(g.start), day: g.day } : {}), updated_at: new Date().toISOString() }).eq("id", c.slot.id);
      if (r.error) { setMsg(r.error.message); return; }
    } else if (kind) {
      // a job placed from its Printavo status isn't booked here yet: locking books it where it is
      const pos = at(c.machine, g.day).filter((x) => x.part === 1 && x.start < g.start).length;
      const r = await sb.from("production_slots").insert({ ...ownerCols(c.job), machine: c.machine.id, day: g.day, minutes: c.minutes, start_min: kind === "spot" ? Math.round(g.start) : null, position: pos, kind: c.need.type, label: c.need.label, source: "manual", locked: kind, locations: locsFor(c.job, c.need) });
      if (r.error) { setMsg(r.error.message); return; }
    }
    setMsg(kind ? `#${c.job.number} locked to ${kind === "spot" ? `${shortName(c.machine)} ${clock(g.start)}` : kind === "press" ? shortName(c.machine) : kind === "person" ? `${crewOf(c.machine)?.leader || shortName(c.machine)} (any of their presses)` : dayLbl(g.day)}. Re-plan keeps it there.` : `#${c.job.number} unlocked.`);
    load();
  }
  /** a job's card, by how much room it has: one line (#, customer, colors, pieces), two (the job's name under the
   *  customer), three (name, then colors · pieces · run time) (Nov 11, Nick: "anytime you have space… the job name") */
  /** a printing job against the time it was figured to take (Nov 12, Nick, option A): green on time, yellow up to 30 minutes
   *  over, red past that; the lunch it ran through doesn't count as its time */
  const runState = (c: Card) => {
    if (c.slot?.status !== "running" || !c.plan || c.day !== now.day) return null;
    const brk = c.machine.brk || s!.breaks, L = segs.lunch.get(c.machine.id + "|" + c.day);
    let used = now.min - c.plan.start, lunchIn = 0;
    if (L != null && L >= c.plan.start && L < now.min) { lunchIn = Math.min(brk.lunchMin || 0, now.min - L); used -= lunchIn; }
    else if (L != null && L >= c.plan.start && L < c.plan.start + c.plan.est) lunchIn = brk.lunchMin || 0;
    used = Math.max(0, used);
    const over = Math.round(used - c.plan.est);
    return { k: over <= 0 ? "g" : over <= 30 ? "y" : "r", over, used, est: c.plan.est, doneAt: c.plan.start + c.plan.est + lunchIn };
  };
  const flowCard = (g: Seg, y1: number, y2: number, key: string, extraCls = "") => {
    const rs = runState(g.c), band = !!rs && y2 - y1 - 2 >= 37;
    const h = Math.max(16, y2 - y1 - 2), gl = glance(g.c.need, g.c.minutes), st = g.c.slot?.status, hc = band ? h - 18 : h, lines = hc >= 54 ? 3 : hc >= 37 ? 2 : 1, mv = pvMove(g.c);
    const name = g.c.job.name || g.c.need.label;
    // while dragging, where it would land is an empty dotted box the jobs around it make room for (Nov 11, Nick)
    if (pvLay && g.c.key === pvKey && !extraCls && g.c.machine.id === pv?.mid) { const n0 = [...(pvLay.ofCard.get(pvKey) || [])].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)[0]; return <div key={key} className="msf-slot" data-slot="1" style={{ top: y1 + 1, height: h }} aria-hidden><span>#{g.c.job.number} moves here</span><small>{shortName(g.c.machine)}{n0 ? ` · ${n0.day !== today ? wkd(n0.day) + " " : ""}${clock(n0.start)}` : ""} · {fmtMin(g.c.minutes)}</small></div>; }
    // dragged to another press: where it was stays as a dotted box saying so, until it's dropped (Nov 11, Nick)
    const from = !!(pvLay && pv && drag?.card && g.c.key === drag.card.key && pv.mid !== g.c.machine.id);
    if (from) { const tm = machines.find((x) => x.id === pv!.mid); return (
      <div key={key} draggable className="msf-from" style={{ top: y1 + 1, height: h }} onDragEnd={() => { setDrag(null); setOver(""); }}>
        <span>#{g.c.job.number} was here</span><small>moving to {tm ? shortName(tm) : "another press"}</small>
      </div>
    ); }
    const num = <b className={"msf-n" + (segLate(g) ? " late" : "")}>{whyEl(g.c)}{tn(dotEl(g.c, g), numLink(g.c.job))}{st === "done" ? <em className="ok"> ✓</em> : null}</b>;
    return (
      <div key={key} role="button" tabIndex={0} draggable data-k={g.c.key} data-d={g.day} className={cls(g) + (notYet(g) ? " mdy-ny" : "") + (rs ? " mpr-c " + rs.k + (band ? " mpr-hasb" : "") : "") + " msf-card l" + lines + extraCls + (mv ? " msf-bump" : "") + (pvLay && g.c.key === pvKey && !extraCls && g.c.machine.id === pv?.mid ? " msf-drop" : "")} style={{ top: y1 + 1, height: h }} title={tip(g)}
        onDragStart={(e) => startDrag(e, { card: g.c, grabMin: 0 })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(g.c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(g.c); } }}
        onContextMenu={(e) => { e.preventDefault(); openRc(g.c, g, e.clientX, e.clientY); }}>
        <span className="msf-1">{num}{tagOf(g)}<span className="msf-co">{abbrCo(g.c.job.customer || name)}</span>{dayState(g)}{flags(g.c.job)}{lines === 1 ? <span className="msf-x"> · {gl.colors} · {gl.units.toLocaleString()}</span> : null}</span>
        {lines === 2 ? <span className="msf-2">{holdTag(g.c.job)}{g.c.job.customer ? name : ""}<span className="msf-x">{g.c.job.customer ? " · " : ""}{gl.colors} · {gl.units.toLocaleString()} · {gl.run}</span></span> : null}
        {mv ? <span className={"msf-bt" + (mv.late ? " bad" : "")}>{mv.txt}</span> : null}
        {lines === 3 ? <><span className="msf-2">{holdTag(g.c.job)}{g.c.job.customer ? name : g.c.need.label}</span><span className="msf-3">{gl.colors} · {gl.units.toLocaleString()} pcs · {gl.run}</span></> : null}
        {rs ? (band
          ? <span className={"mpr-band " + rs.k}><span>Printing{rs.over > 0 ? ` · ${fmtMin(rs.over)} over` : ""}</span><span className="mpr-t">{fmtMin(rs.used)} / {fmtMin(rs.est)}</span></span>
          : <span className={"mpr-side " + rs.k}>Printing</span>) : null}
      </div>
    );
  };
  /** how a job on the board is doing today (Nov 12, Nick, option C: "see the day… what we've completed and where it's at"):
   *  done (with the time), printing (how far), or not started when its start has gone by */
  const notYet = (g: Seg) => g.day === today && g.part === 1 && g.c.job.kind !== "h" && (!g.c.slot || g.c.slot.status === "scheduled" || g.c.slot.status === "paused") && g.start + 15 < now.min;
  const dayState = (g: Seg) => {
    const st = g.c.slot?.status;
    if (st === "done") { const f = g.c.slot?.finished_at; return <em className="mdy-st ok">{f ? "✓ " + new Date(f).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" AM", "a").replace(" PM", "p") : "✓ Done"}</em>; }
    if (st === "running" && runState(g.c)) return null;
    if (st === "running") return <em className="mdy-st run">Printing{g.c.slot?.progress ? ` · ${Math.round(+g.c.slot.progress * 100)}%` : ""}</em>;
    if (notYet(g)) return <em className="mdy-st bad">Not started</em>;
    return null;
  };
  /** each press's day so far: jobs done of today's, and how far off the plan it is, from what's actually been marked only
   *  (Nov 12, Nick: "how are you figuring Ana is behind… she's actually ahead"): the last job marked done against its
   *  planned finish, a printing job whose pieces were updated against where it should be by now, and, only with the live
   *  clock on, a job whose start has gone by. Nothing marked: no pace is claimed. Negative = ahead. */
  const minOfIso = (iso: string) => { const d = new Date(iso); const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d); return (+(p.find((x) => x.type === "hour")?.value || 0)) * 60 + +(p.find((x) => x.type === "minute")?.value || 0); };
  const dayScore = (m: Machine) => {
    const seen = new Map<string, Seg>();
    for (const g of at(m, today)) if (g.c.job.kind !== "h" && !seen.has(g.c.key)) seen.set(g.c.key, g);
    const gs = [...seen.values()], done = gs.filter((g) => g.c.slot?.status === "done").length;
    let off: number | null = null, lastFin = -1;
    for (const g of gs) {
      const sl = g.c.slot, st = sl?.status;
      if (st === "done" && sl?.finished_at && sl.finished_at.slice(0, 10) >= addDay(today, -1)) { const f = minOfIso(sl.finished_at); if (f > lastFin) { lastFin = f; off = f - g.end; } }
    }
    for (const g of gs) {
      const sl = g.c.slot;
      if (sl?.status === "running" && sl.progress_at && +(sl.progress || 0) > 0) { const want = Math.min(1, Math.max(0, (now.min - g.start) / Math.max(1, g.end - g.start))), got = +(sl.progress || 0); off = Math.round((want - got) * (g.end - g.start)); }
      else if (s?.liveClock && notYet(g)) off = Math.max(off ?? 0, now.min - g.start);
    }
    return { n: gs.length, done, off };
  };
  /** the downtime entry a block on the board comes from (its press's or its crew's) */
  const offRow = (m: Machine, d: string, a: number) => offs.find((x) => x.day === d && (x.machine === m.id || (!!m.crew && x.crew_id === m.crew)) && (x.start_min ?? -1) === a) || offs.find((x) => x.day === d && (x.machine === m.id || (!!m.crew && x.crew_id === m.crew)) && x.start_min == null && a <= 0) || null;
  const flowView = () => (
    <div className={"msf" + (findWords.length ? " ms-finding" : "")}>
      <div className="msf-main">
        <div className="msf-grid" style={{ gridTemplateColumns: `40px repeat(${machines.length}, minmax(0,1fr))` }}>
          <div className="msf-corner" />
          {machines.map((m) => <div key={m.id} className={"msf-mh mph " + m.type + (isOffDay(m, today) ? " off" : "")}>
            {/* one header per press (Nov 12, Nick, option A): name, crew, clock-in, the press, then the day so far */}
            <div className="mph-card">
              <div className="mph-1"><b title={m.name}>{shortName(m)}<IssueTag m={m} /></b>{crewOf(m) ? <span className="mph-who">{crewOf(m)!.leader}</span> : null}{flowBlocks[0].d === today && crewOf(m) ? <ClockIn m={m} /> : null}</div>
              <div className="mph-spec">{pressSpec(m)}</div>
              {flowBlocks[0].d === today && (() => { const sc = dayScore(m); return sc.n ? <>
                <i className="mdy-bar"><i style={{ width: `${Math.round((sc.done / sc.n) * 100)}%` }} /></i>
                <small className={"mph-st" + (sc.off != null && sc.off >= 15 ? " bad" : "")}>{sc.done} of {sc.n} done{sc.done === sc.n ? " · all done" : sc.off == null ? "" : sc.off >= 15 ? ` · ${fmtMin(sc.off)} behind` : sc.off <= -15 ? ` · ${fmtMin(-sc.off)} ahead` : " · on pace"}</small>
              </> : <small className="mph-st">Nothing today</small>; })()}
            </div>
          </div>)}
          <div className="msf-gut" style={{ height: flowH, gridColumn: 1 }}>
            {flowBlocks.flatMap((bk, bi) => {
              const hs: ReactNode[] = [];
              for (let h = Math.ceil(bk.a / 60) * 60; h < bk.b; h += 60) if (!(bi > 0 && h === bk.a)) hs.push(<span key={bk.d + h} style={{ top: flowY(bi, h) }}>{clock(h)}</span>);
              if (bi > 0) hs.push(<span key={bk.d + "lbl"} className="msf-dl" style={{ top: flowTop[bi] }}><b>{wkd(bk.d)}</b>{clock(bk.a)}</span>);
              return hs;
            })}
          </div>
          {machines.map((m, mi) => {
            // this press's jobs across the days shown, a job that carries over the day break joined into one card
            const itemsOf = (by?: Map<string, Seg[]>) => {
              const items: { g: Seg; y1: number; y2: number }[] = [];
              flowBlocks.forEach((bk, bi) => {
                for (const x of joined(m, bk.d, by)) {
                  if (x.end <= bk.a || x.start >= bk.b) continue;
                  const y1 = flowY(bi, x.start), y2 = flowY(bi, x.end), last = items[items.length - 1];
                  if (last && last.g.c.key === x.g.c.key && bi > 0 && Math.abs(last.y2 - flowTop[bi]) < 3 * FLOW_PX) last.y2 = y2;
                  else items.push({ g: x.g, y1, y2 });
                }
              });
              return items;
            };
            // the press it's dragged from keeps its jobs where they are (the job shows as "was here") while it's over another
            // press; the press it's over makes room
            // While dragging, the board doesn't re-plan under the pointer (that moved jobs to other days and back, and it
            // twitched; Nov 11, Nick). It works like any sortable list: the jobs stay where they are, the jobs below the
            // pointer slide down by the dragged job's height, and the dotted box sits in the gap. Where it goes is worked
            // out on the board as it was before the drag, so the slide can't change the answer.
            const real = itemsOf(), dragKey = drag?.card?.key;
            const live = !!(pv && drag && !drag.group && !drag.pin && pv.mid === m.id);
            const dragH = live ? Math.min(3 * FLOW_PX, Math.max(22, ((drag!.card?.minutes || (drag!.need ? estimate(s, drag!.need, m).minutes : 60)) / 60) * FLOW_PX)) : 0;
            const cand = real.filter((x) => x.g.c.key !== dragKey && x.g.part === 1 && x.g.c.slot && x.g.c.slot.status !== "done" && x.g.c.job.kind !== "h").sort((a, b) => a.y1 - b.y1);
            const insY = !live ? null : (() => { const b = pv!.before ? cand.find((x) => x.g.c.key === pv!.before) : null; if (b) return b.y1; const ls = cand.filter((x) => x.g.day === pv!.d).slice(-1)[0]; return ls ? ls.y2 : pv!.y; })();
            const items = live ? real.filter((x) => x.g.c.key !== dragKey).map((x) => (insY != null && x.y1 >= insY - 1 ? { ...x, y1: x.y1 + dragH, y2: x.y2 + dragH } : x)) : real;
            // the dragged card stays where it was (hidden) on its own press: the browser drops a drag whose card leaves the page
            const ghost = live && drag?.card && drag.card.machine.id === m.id ? real.filter((x) => x.g.c.key === dragKey) : [];
            return (
              <div key={m.id} className={"msf-col" + (drag?.pin ? " msf-pinning" : "") + (over === "f:" + m.id ? (canDrop(m) ? " over" : " no") : "")} style={{ height: flowH, backgroundSize: `100% ${FLOW_PX}px`, gridColumn: mi + 2 }}
                onDragOver={(e) => {
                  e.preventDefault(); if (over !== "f:" + m.id) setOver("f:" + m.id);
                  if (!drag || drag.group) return;
                  // Shift + drag: no making room, just the time it would be pinned at
                  if (drag.pin || e.shiftKey) {
                    const r0 = e.currentTarget.getBoundingClientRect(), p0 = flowAt(e.clientY - r0.top), mn = Math.round(p0.min / 15) * 15;
                    const bi0 = flowBlocks.findIndex((b) => b.d === p0.d && mn >= b.a && mn <= b.b), y0 = bi0 >= 0 ? flowY(bi0, mn) : e.clientY - r0.top;
                    if (!drag.pin) setDrag({ ...drag, pin: true });
                    if (pv) setPv(null);
                    if (!pinAt || pinAt.mid !== m.id || pinAt.d !== p0.d || pinAt.min !== mn) setPinAt({ mid: m.id, d: p0.d, min: mn, y: y0 });
                    return;
                  }
                  // where the pointer is: over a job's top half it goes before that job, its bottom half after it; over the
                  // dotted box it stays put; on open time, by the clock
                  const r = e.currentTarget.getBoundingClientRect(), yScr = e.clientY - r.top;
                  // back to the board as it was before the drag: below the dotted box, take its height off
                  const y = live && insY != null && yScr > insY ? Math.max(insY, yScr - dragH) : yScr;
                  // it goes before the first job whose middle is below the pointer (the top half of a job: before it; the
                  // bottom half: after it); past the last job of a day, at the end of that day
                  const hit = cand.find((x) => (x.y1 + x.y2) / 2 > y), pd = flowAt(y).d;
                  const d0 = hit && hit.g.day <= pd ? hit.g.day : pd, b = hit && hit.g.day <= pd ? hit.g.c.key : "";
                  if (!pv || pv.mid !== m.id || pv.d !== d0 || pv.before !== b) setPv({ mid: m.id, d: d0, before: b, y });
                }}
                // only a real leave clears the preview: the pointer outside the column. A card redrawn under the pointer fires a
                // leave with no next element, which used to clear the preview and redraw it again, over and over (Nov 11)
                onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) return; setOver(""); setPv(null); setPinAt(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag?.pin && pinAt && pinAt.mid === m.id) { void pinTo(drag, m, pinAt.d, pinAt.min); return; }
                  // it lands exactly where the dotted box was
                  if (drag && !drag.group && pv && pv.mid === m.id) { const c = drag.card ? { card: drag.card } : { job: drag.job, need: drag.need }; setPv(null); place(c, m, pv.d, pv.before || undefined); return; }
                  const r = e.currentTarget.getBoundingClientRect(), p = flowAt(e.clientY - r.top); drop(m, p.d, p.min);
                }}
                onClick={(e) => { if ((e.target as HTMLElement).closest(".ms-blk, .ms-down, .ms-slow button, .msf-card, .msf-run, .msf-from, .msf-slot, .msf-menu")) return; if (Date.now() - dragAt.current < 600 || (window.getSelection()?.toString() || "").trim()) return; const r = e.currentTarget.getBoundingClientRect(), p = flowAt(e.clientY - r.top); setDownEdit({ machine: m.id, day: p.d, start: Math.floor(p.min / 30) * 30 }); }}
                title="Click an open time to add downtime here">
                {pinAt && drag?.pin && pinAt.mid === m.id && (() => { const mins = drag.card?.minutes || (drag.need ? estimate(s, drag.need, m).minutes : 60); return <>
                  <div className="msf-pinline" style={{ top: pinAt.y }} />
                  <div className="msf-pintip" style={{ top: Math.max(0, pinAt.y - 46) }}><b>{wkd(pinAt.d)} {clockLong(pinAt.min)}</b><small>{shortName(m)}{crewOf(m)?.leader ? " · " + crewOf(m)!.leader : ""} · ends {clockLong(pinAt.min + mins)}</small></div>
                </>; })()}
                {flowBlocks.map((bk, bi) => {
                  const sh = shiftOn(m, bk.d), oa = sh ? otOn(m, bk.d) : null, [sa, sb2] = sh || [bk.b, bk.b];
                  const off = sh ? [[bk.a, sa], [sb2, bk.b]].filter(([x, y]) => y > x) : [[bk.a, bk.b]];
                  return (
                    <Fragment key={bk.d}>
                      {off.map(([x, y]) => <div key={"of" + x} className="ms-off" style={{ top: flowY(bi, x), height: flowY(bi, y) - flowY(bi, x) }} />)}
                      {sh && oa != null && oa < sh[1] && <div className="ms-ot" style={{ top: flowY(bi, oa), height: flowY(bi, sh[1]) - flowY(bi, oa) }} title={`${crewOf(m)?.leader ? crewOf(m)!.leader + "'s crew" : "This crew"} is past 40 hours this pay week from ${clockLong(oa)}: overtime`} />}
                      {/* breaks (Nov 11, Nick, option D: "lunch 30 minutes… they'll know about warm up, it's just part of the deal"):
                          the warm-up after lunch is part of lunch's tinted band; the word sits centered in it. A lunch that falls
                          inside a job is counted in the job (its card runs longer) and shows as a line through the card. */}
                      {sh && brkBands(breaksOn(m, bk.d, sh, segs.lunch.get(m.id + "|" + bk.d))).map(({ a: a0, b: b0, lunch, min, clock: ck }) => {
                        const ya = flowY(bi, a0), yb = flowY(bi, b0);
                        if (yb <= ya) return null;
                        const mid = (ya + yb) / 2, inJob = items.some((x) => x.y1 < mid && x.y2 > mid), word = ck || (lunch ? `Lunch ${min} min` : "Warm-up");
                        return <Fragment key={"bk" + a0}>
                          <div className={(lunch ? "ms-lunch" : "ms-warm") + (ck ? " mlc" : "")} style={{ top: ya, height: yb - ya }} title={`${lunch ? "Lunch" : "Warm-up"} ${clockLong(a0)} – ${clockLong(b0)}`} />
                          {inJob ? <div className={"msf-brk-in" + (ck ? " mlc" : "")} style={{ top: ya, height: yb - ya }}><span>{word}</span></div> : yb - ya >= 12 ? <div className="msf-brk-c" style={{ top: ya, height: yb - ya }}><span>{word}</span></div> : null}
                        </Fragment>;
                      })}
                      {(m.down?.[bk.d] || []).filter((x) => !x[4] && !x[3]).map(([a0, b0, why]) => flowY(bi, b0) > flowY(bi, a0) ? <button type="button" key={"dn" + a0} className="ms-down" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setDownMenu({ x: e.clientX, y: e.clientY, row: offRow(m, bk.d, a0), machine: m.id, day: bk.d, a: a0, b: b0, why }); }} style={{ top: flowY(bi, a0), height: Math.max(16, flowY(bi, b0) - flowY(bi, a0)) }} title={`${m.name} down ${clockLong(a0)} – ${clockLong(b0)}: ${why}`} onClick={() => setDownEdit({ machine: m.id, day: bk.d, start: a0 })}><b>Down</b> {clock(a0)}–{clock(b0)} · {why}</button> : null)}
                      {bk.d === today && now.min >= bk.a && now.min <= bk.b && <div className="ms-now" style={{ top: flowY(bi, now.min) }} />}
                    </Fragment>
                  );
                })}
                {ghost.map((x) => flowCard(x.g, x.y1, x.y2, x.g.c.key + x.g.part, " msf-ghost"))}
                {live && insY != null && <div className="msf-slot" data-slot="1" style={{ top: insY + 1, height: dragH - 2 }} aria-hidden><span>#{(drag!.card?.job || drag!.job)?.number} moves here</span></div>}
                {(() => {
                  // one customer's jobs back to back (Nine18's small orders, an All My Sons run): one box, a row per job
                  // (Nov 11, Nick: "a nice little together segment… All My Sons run")
                  const runs: (typeof items)[] = [];
                  for (const x of [...items].sort((a, b) => a.y1 - b.y1)) {
                    const last = runs[runs.length - 1], lx = last?.[last.length - 1];
                    if (lx && x.g.c.key !== pvKey && lx.g.c.key !== pvKey && !(drag?.card && (x.g.c.key === drag.card.key || lx.g.c.key === drag.card.key)) && oneRun(lx.g.c, x.g.c) && x.y1 - lx.y2 < 6) last.push(x); else runs.push([x]);
                  }
                  return runs.map((r) => {
                    if (r.length === 1) { const x = r[0]; return flowCard(x.g, x.y1, x.y2, (x.g.c.key === pvKey && pvLay ? "pv:" : "") + x.g.c.key + x.g.part); }
                    const top = r[0].y1, H = Math.max(40, r[r.length - 1].y2 - top - 2), id = "run:" + m.id + r[0].g.c.key, open = listOpen === id;
                    const fit = Math.max(1, Math.floor((H - 22) / 19)), show = open || r.length <= fit ? r : r.slice(0, Math.max(1, fit - 1));
                    const pcs = r.reduce((t, x) => t + x.g.c.need.qty, 0), mins = r.reduce((t, x) => t + x.g.c.minutes, 0);
                    return (
                      <div key={id} className={"msf-run " + r[0].g.c.need.type + (open ? " open" : "")} style={{ top: top + 1, ...(open ? { minHeight: H } : { height: H }) }}>
                        <div className="msf-run-h"><b>{runTitle(r.map((x) => x.g.c.job))}</b><span>{r.length} jobs · same art · {pcs.toLocaleString()} pcs · {fmtMin(mins)}</span></div>
                        {show.map((x) => { const gl = glance(x.g.c.need, x.g.c.minutes); return (
                          <div key={x.g.c.key + x.g.part} role="button" tabIndex={0} draggable data-k={x.g.c.key} data-d={x.g.day} className={"msf-run-r" + (isHit(x.g.c.job) ? " ms-hit" : "") + (segLate(x.g) ? " late" : "") + (x.g.c.slot?.status === "done" ? " done" : "")} title={tip(x.g)}
                            onDragStart={(e) => startDrag(e, { card: x.g.c, grabMin: 0 })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(x.g.c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(x.g.c); } }}
                            onContextMenu={(e) => { e.preventDefault(); openRc(x.g.c, x.g, e.clientX, e.clientY); }}>
                            {whyEl(x.g.c)}{tn(dotEl(x.g.c, x.g), <b>#{x.g.c.job.number}</b>)}<span className="nm">{x.g.c.job.name || x.g.c.need.label}</span><small>{gl.colors} · {gl.units.toLocaleString()}</small>
                          </div>
                        ); })}
                        {show.length < r.length ? <button type="button" className="msf-run-more" onClick={() => setListOpen(id)}>+{r.length - show.length} more</button> : open ? <button type="button" className="msf-run-more" onClick={() => setListOpen("")}>Show less</button> : null}
                      </div>
                    );
                  });
                })()}
                {pvLay && pv?.mid === m.id && (() => {
                  // the drop, said in one line: where it lands, what it pushes, who'd miss in-hands
                  const me2 = insY != null ? { y1: insY } : null; if (!me2) return null;
                  const all = cards.map((c: Card) => ({ c, mv: pvMove(c) })).filter((x) => x.mv);
                  const pushed = all.filter((x) => x.mv!.down && x.c.machine.id === m.id), lateNow = all.filter((x) => x.mv!.late);
                  const n0 = (pvLay.ofCard.get(pvKey) || [])[0], nL = (pvLay.ofCard.get(pvKey) || []).slice(-1)[0];
                  return <div className="msf-tip" style={{ top: me2.y1 }}><b>{shortName(m)} · {n0 ? `${n0.day !== today ? wkd(n0.day) + " " : ""}${clock(n0.start)} – ${nL.day !== n0.day ? wkd(nL.day) + " " : ""}${clock(nL.end)}` : ""}</b>{pushed.length ? <span>Pushes {pushed.length} job{pushed.length === 1 ? "" : "s"} later</span> : <span>Nothing else moves here</span>}{lateNow.map((x) => <span key={x.c.key} className="bad">#{x.c.job.number} {abbrCo(x.c.job.customer)} goes past in-hands</span>)}</div>;
                })()}
              </div>
            );
          })}
          {flowBlocks.slice(1).map((bk, i) => <div key={"br" + bk.d} className="msf-break" style={{ marginTop: flowTop[i + 1] - 1.5 }} aria-hidden />)}
        </div>
      </div>
      <div className="msf-side">
        <div className="msq" role="search">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={findQ} placeholder="Search the schedule" aria-label="Search the schedule" onChange={(e) => { setFindQ(e.target.value); setFindI(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setFindQ(""); return; }
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
              e.preventDefault();
              const hits = [...document.querySelectorAll<HTMLElement>(".msf .ms-hit")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
              if (!hits.length) return;
              const i = (findI + (e.key === "ArrowUp" ? -1 : 1) + hits.length) % hits.length; setFindI(i);
              hits[i].scrollIntoView({ block: "center", behavior: "smooth" }); hits.forEach((h, k) => h.classList.toggle("ms-hit-on", k === i));
            }} />
          {findWords.length > 0 && (() => { const n = new Set(cards.filter((c) => isHit(c.job)).map((c) => c.job.key)).size; return <><span className={"msq-n" + (n ? "" : " none")}>{n ? `${n} found` : "none"}</span><button type="button" className="msq-x" aria-label="Clear the search" onClick={() => setFindQ("")}>✕</button></>; })()}
        </div>
        {/* the key under the search (Nov 12, Nick): what the marks mean, folded to one line when hidden */}
        <div className={"mky" + (keyOpen ? "" : " shut")}>
          <div className="mky-h"><span>Key</span>{!keyOpen && <span className="mky-mini"><GoodsTee k="g" t="" /><GoodsTee k="a" t="" /><i className="mky-sw ok" /><i className="mky-sw bad" /></span>}<button type="button" className="linkbtn" onClick={() => setKeyOpen(!keyOpen)}>{keyOpen ? "Hide" : "Show"}</button></div>
          {keyOpen && <div className="mky-g">
            <div className="mky-sub">Goods</div>
            <div><GoodsTee k="g" t="" />Counted in</div><div><GoodsTee k="a" t="" />Here, not counted</div><div><GoodsTee k="r" t="" />Problem / runs soon</div><div><GoodsTee k="o" t="" />Not here yet</div>
            <div className="mky-sub">Printing</div>
            <div><i className="mky-sw ok" />On time</div><div><i className="mky-sw warn" />A little over</div><div><i className="mky-sw bad" />Well over</div><div><i className="mky-sw pz" />Paused / lunch</div>
            <div className="mky-sub">On the board</div>
            <div><b className="mky-late">#</b>Late</div><div><i className="mky-sw hold" />Hold</div><div><i className="mky-sw ot" />Overtime</div><div><i className="mky-sw brk" />Warm-up / lunch</div>
          </div>}
        </div>
        {comingUp()}
      </div>
      {downMenu && <>
        <div className="msf-menu-bg" onClick={() => setDownMenu(null)} onContextMenu={(e) => { e.preventDefault(); setDownMenu(null); }} />
        <div className="msf-menu" style={{ left: Math.max(8, Math.min(downMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1400) - 310)), top: Math.max(8, Math.min(downMenu.y, (typeof window !== "undefined" ? window.innerHeight : 900) - 160)) }}>
          <div className="msf-menu-h">{downMenu.why} · {clock(downMenu.a)}–{clock(downMenu.b)}</div>
          {downMenu.row ? <>
            <button type="button" onClick={async () => { const r = downMenu.row!; setDownMenu(null); const x = await createClient().from("production_days_off").delete().eq("id", r.id); setMsg(x.error ? x.error.message : `Removed ${r.note || "the downtime"} on ${dayLbl(r.day)}. That time is back on the schedule.`); load(); }}><span className="msf-rn">✕</span><span>Remove this downtime</span><small>the time goes back on the schedule</small></button>
            <button type="button" onClick={() => { const r = downMenu.row!; setDownMenu(null); setDownEdit({ machine: downMenu.machine, day: r.day, start: r.start_min ?? undefined, end: r.end_min ?? undefined, allDay: r.start_min == null, replace: r }); }}><span className="msf-rn">✎</span><span>Change its times</span><small>or move it to another day or press</small></button>
          </> : <div className="msf-menu-h">This comes from the crew&apos;s hours or a time card, not a downtime entry.</div>}
        </div>
      </>}
      {drag?.pin && <div className="msf-pinbar" role="status">📌 Pin to a time · drop where it should start · <kbd>Esc</kbd> cancels</div>}
      {lockMenu && (() => {
        // the right click (Nov 12, Nick, option B): the run first, as three steps with their times; then goods and the
        // schedule as tiles; Rush / Firm; take it off the schedule last
        const c = lockMenu.c, g = lockMenu.g, st = c.slot?.status || "scheduled", q = c.need.qty || 0;
        const tIn = <input type="time" className="mrc-t" aria-label="Time" value={rcF.t} onChange={(e) => setRcF({ ...rcF, t: e.target.value })} />;
        const tm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p") : "");
        const rs = runState(c);
        const step = (k: string, cls: string, label: string, sub: string, ico: "check" | "play" | "pause") => <div key={k} className={"mrb-st " + cls}><i className="mrb-dot"><RcIco k={ico} /></i><b>{label}</b><small>{sub}</small></div>;
        const gj = rcGoods?.job, ck = gj?.checkins?.[0], counted = !!gj && (gj.state === "checked" || gj.state === "issue");
        const tile = (key: string, ico: "box" | "check" | "warn" | "next" | "move" | "lock", label: string, on: () => void, cls = "") => <button key={key} type="button" className={"mrb-tile " + cls} onClick={on}>{ico === "lock" ? <WhyIcon w="lock" title="" /> : <RcIco k={ico} />}{label}</button>;
        return <>
          <div className="msf-menu-bg" onClick={() => { setLockMenu(null); setRcSure(false); }} onContextMenu={(e) => { e.preventDefault(); setLockMenu(null); setRcSure(false); }} />
          <div className="mrc mrb" style={{ left: lockMenu.x, top: lockMenu.y }}>
            <div className="mrc-h"><b>#{c.job.number} {abbrCo(c.job.customer)}</b><small>{shortName(c.machine)}{crewOf(c.machine)?.leader ? ` · ${crewOf(c.machine)!.leader}` : ""} · planned {clock(g.start)} – {clock(g.end)} · {fmtMin(c.plan?.est ?? c.minutes)}</small></div>
            {c.job.kind !== "h" && <div className="mrc-sec">
              <div className="mrc-l">Run</div>
              <div className="mrb-steps">
                {step("s", st === "scheduled" ? "cur" : "on", "Started", st === "scheduled" ? "not yet" : tm(c.slot?.started_at), st === "scheduled" ? "play" : "check")}
                {step("p", st === "running" ? "cur" : st === "paused" ? "cur pz" : st === "done" ? "on" : "", st === "paused" ? "Paused" : "Printing", st === "running" ? (rs ? `${fmtMin(rs.used)} · ${rs.over > 0 ? fmtMin(rs.over) + " over" : "on time"}` : "now") : st === "paused" ? "since its pause" : st === "done" ? "" : "—", st === "paused" ? "pause" : "play")}
                {step("d", st === "done" ? "on" : "", "Done", st === "done" ? tm(c.slot?.finished_at) : "—", "check")}
              </div>
              {st === "scheduled" && <div className="mrb-row">{tIn}<button type="button" className="mrc-act go" onClick={() => void rcDo(c, g, "start")}><RcIco k="play" />Start</button></div>}
              {st === "running" && <>
                <div className="mrb-row">{tIn}<button type="button" className={"mrc-act" + (rcPause ? " on" : "")} onClick={() => setRcPause(!rcPause)}><RcIco k="pause" />Pause</button><button type="button" className="mrc-act go" onClick={() => void rcDo(c, g, "done")}><RcIco k="check" />Complete</button></div>
                {rcPause && <div className="mrb-why">{["Lunch", "Break", "Ink / screen", "Other"].map((w) => <button key={w} type="button" onClick={() => { setRcF({ ...rcF, why: w }); void rcDo(c, g, "pause", w); }}>{w}</button>)}</div>}
                <div className="mrb-pcs"><span>Pieces done</span><input className="mrc-t mrc-n" inputMode="numeric" value={rcF.pcs} onChange={(e) => setRcF({ ...rcF, pcs: e.target.value.replace(/\D/g, "") })} /><span className="faint">of {q.toLocaleString()}</span><button type="button" className="linkbtn" onClick={() => void rcDo(c, g, "progress")}>Update</button></div>
              </>}
              {st === "paused" && <div className="mrb-row">{tIn}<button type="button" className="mrc-act go" onClick={() => void rcDo(c, g, "resume")}><RcIco k="play" />Resume</button><button type="button" className="mrc-act" onClick={() => void rcDo(c, g, "done")}><RcIco k="check" />Complete</button></div>}
              {(st === "running" || st === "paused") && c.slot?.order_id && <div className="mrb-then">then the order goes to <select value={rcF.next} onChange={(e) => setRcF({ ...rcF, next: e.target.value as typeof rcF.next })}><option value="fulfillment">Fulfillment</option><option value="ready">Ready</option><option value="completed">Completed</option></select> once it&apos;s its last job{rcF.next !== "fulfillment" ? " (the customer gets the status email)" : ""}</div>}
              {st === "done" && <div className="mrb-row"><button type="button" className="mrc-act" onClick={() => { const sl = c.slot!; setLockMenu(null); void logAction(sl, "reopen"); }}><RcIco k="undo" />Not done yet</button></div>}
              {(st === "running" || st === "paused") && <button type="button" className="linkbtn mrb-undo" onClick={() => void rcDo(c, g, "not_started")}>Not started after all</button>}
            </div>}
            {rcGoods && <>
              <div className="mrb-gl">Goods{gj ? <> · <GoodsTee k={gj.state === "issue" ? "r" : counted ? "g" : gj.state === "ready" || gj.state === "partial" ? "a" : "o"} t="" />{gj.state === "issue" ? "problem reported" : counted ? `counted${ck ? " " + tm(ck.created_at) : ""}` : "not counted"}</> : rcGoods.err ? ` · ${rcGoods.err}` : " · loading…"}</div>
              {gj && <div className="mrb-tiles">
                {tile("c", "box", counted ? "Recount" : "Count in", () => { setLockMenu(null); setCountJob(gj); })}
                {tile("a", "check", "All here", () => void goodsAllHere(gj), "ok")}
                {tile("m", "warn", "Missing", () => { setLockMenu(null); setCountJob(gj); }, "bad")}
              </div>}
            </>}
            <div className="mrb-gl">Schedule{c.slot?.locked ? ` · locked to ${c.slot.locked === "spot" ? "its spot" : c.slot.locked === "person" ? crewOf(c.machine)?.leader || "its person" : c.slot.locked === "press" ? "its press" : "its day"}` : ""}</div>
            <div className="mrb-tiles">
              {tile("n", "next", "Run next", () => { if (st !== "running" && st !== "done") runNext(c); else setLockMenu(null); }, st === "running" || st === "done" ? "off" : "")}
              {tile("v", "move", "Move", () => { setLockMenu(null); setOpenMove(true); setOpen(c); })}
              {tile("l", "lock", "Lock", () => { setLockMenu(null); setLockSide({ c, g, k: (c.slot?.locked as "spot" | "press" | "day" | "person") || "spot" }); })}
            </div>
            {c.job.kind === "o" && <div className="mrb-flags"><button type="button" className={c.job.rush ? "on rush" : ""} onClick={() => void flagJob(c, { rush: !c.job.rush })}>Rush</button><button type="button" className={c.job.firm ? "on firm" : ""} onClick={() => void flagJob(c, c.job.firm ? { firm: false, due_time: null } : { firm: true })}>Firm{c.job.firm ? ` · ${firmLbl(c.job)}` : ""}</button></div>}
            {c.slot && (rcSure
              ? <div className="mrb-sure">{c.job.hold ? "Bump this hold?" : "Take it off the schedule?"}<button type="button" className="btn sm danger" onClick={() => { const sl = c.slot!; setRcSure(false); setLockMenu(null); void unbook(sl); }}>Yes</button><button type="button" className="btn sm" onClick={() => setRcSure(false)}>No</button></div>
              : <button type="button" className="mrc-li mrb-off" onClick={() => setRcSure(true)}><RcIco k="x" />{c.job.hold ? "Bump this hold" : "Take off the schedule"}</button>)}
          </div>
        </>;
      })()}
      {countJob && <CheckinModal job={countJob} onClose={() => setCountJob(null)} onSaved={(c) => { setCountJob(null); setGoodsRev((x) => x + 1); setMsg(c.status === "issue" ? `#${countJob.number} counted with ${c.lines.filter((l) => l.issue).length} problem${c.lines.filter((l) => l.issue).length === 1 ? "" : "s"}; it's on Goods & Receiving's issues.` : `#${countJob.number} counted in.`); }} />}
      {lockSide && (() => {
        const { c, g } = lockSide, lead = crewOf(c.machine)?.leader, dayName = new Date(g.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
        const opts = [["spot", "This spot", `${shortName(c.machine)} at ${clock(g.start)} ${dayName}. Nothing moves it; other jobs go around it.`], ...(lead ? [["person", lead, "Any press they run, any time."]] : []), ["press", shortName(c.machine), "This press; its time can move."], ["day", dayName, "Any press, as long as it runs that day."]] as [typeof lockSide.k, string, string][];
        return <>
          <div className="mrc-bg" onClick={() => setLockSide(null)} />
          <aside className="mrc-side">
            <div className="mrc-sh"><h2>Lock #{c.job.number}</h2><small>{abbrCo(c.job.customer)} · {shortName(c.machine)}{lead ? ` · ${lead}` : ""} · {dayName.slice(0, 3)} {clock(g.start)}</small></div>
            <div className="mrc-l mrc-sl">Keep it on</div>
            {opts.map(([k, l, sub]) => <button key={k} type="button" className={"mrc-opt" + (lockSide.k === k ? " on" : "")} onClick={() => setLockSide({ ...lockSide, k })}><i /><span><b>{l}</b><small>{sub}</small></span></button>)}
            <div className="mrc-ft">{c.slot?.locked ? <button type="button" className="btn mrc-un" onClick={() => { setLockSide(null); void lockAs(c, g, null); }}>Unlock</button> : <span />}<span className="spacer" /><button type="button" className="btn" onClick={() => setLockSide(null)}>Cancel</button><button type="button" className="btn primary" onClick={() => { setLockSide(null); void lockAs(c, g, lockSide.k); }}>Lock it</button></div>
          </aside>
        </>;
      })()}
    </div>
  );
  /** the right side: who runs what tomorrow and the day after, press by press, in run order */
  const comingUp = () => {
    const ds: string[] = [];
    for (let i = 1; i < 21 && ds.length < 2; i++) { const d = addDay(today, i); if (visible(d) && machines.some((m) => shiftOn(m, d) || at(m, d).length)) ds.push(d); }
    const d = ds[Math.min(upDay, ds.length - 1)] || ds[0];
    // one list, a gray header per person, each job on two short lines; one customer's jobs back to back are one row
    // (Nov 11, Nick: option B, "one clean list")
    return (
      <aside className="msf-up">
        <div className="msf-up-h"><b>Coming up</b><span className="spacer" />
          <span className="msf-up-tabs" role="tablist">{ds.map((x, i) => <button key={x} type="button" role="tab" aria-selected={x === d} className={x === d ? "on" : ""} onClick={() => setUpDay(i)}>{new Date(x + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}</button>)}</span>
        </div>
        {d && <div className="msf-up-cols"><span>Time</span><span>Job</span><span>Pcs</span></div>}
        {d && machines.map((m) => {
          const js = joined(m, d);
          if (!js.length) return null;
          const grp: (typeof js)[] = [];
          for (const x of js) { const l = grp[grp.length - 1]; if (l && oneRun(l[l.length - 1].g.c, x.g.c)) l.push(x); else grp.push([x]); }
          return (
            <section key={m.id} className="msf-up-m">
              <div className="msf-up-mh"><b>{crewOf(m)?.leader || shortName(m)}</b>{crewOf(m) ? <span> · {shortName(m)}</span> : null}<span className="faint"> · {js.length} job{js.length === 1 ? "" : "s"} · {fmtMin(used(m, d))}</span></div>
              {grp.map((g0) => {
                const x = g0[0], gl = glance(x.g.c.need, x.g.c.minutes), many = g0.length > 1, id = "up:" + d + x.g.c.key, open = listOpen === id;
                const late = g0.some((y) => ord(d) * 1440 + y.end > dueAbs(y.g.c.job));
                const pcs = g0.reduce((t, y) => t + y.g.c.need.qty, 0);
                return (
                  <Fragment key={x.g.c.key + x.g.part}>
                    <button type="button" className={"msf-up-r" + (x.g.c.job.kind === "h" ? " hold" : "")} onClick={() => (many ? setListOpen(open ? "" : id) : setOpen(x.g.c))} title={many ? `${g0.length} ${x.g.c.job.customer} jobs back to back` : tip(x.g)}>
                      <span className="t">{clock(x.start)}</span>
                      <span className="b"><span className="l1">{many ? <>{tn(dotEl(x.g.c, x.g), <b className="c">{abbrCo(x.g.c.job.customer)}</b>)}<span className="msf-up-car">{open ? "▾" : "▸"}</span></> : <>{tn(dotEl(x.g.c, x.g), <b className={late ? "late" : ""}>#{x.g.c.job.number}</b>)}<span className="c">{abbrCo(x.g.c.job.customer || x.g.c.job.name)}</span></>}</span>
                        <span className="l2">{many ? `${g0.length} jobs · ${g0.slice(0, 3).map((y) => y.g.c.job.name || "#" + y.g.c.job.number).join(", ")}${g0.length > 3 ? ` +${g0.length - 3}` : ""}` : `${x.g.c.job.customer && x.g.c.job.name ? x.g.c.job.name + " · " : ""}${gl.colors}`}</span></span>
                      <span className="q">{pcs.toLocaleString()}</span>
                    </button>
                    {many && open && g0.map((y) => (
                      <button key={y.g.c.key + y.g.part} type="button" className="msf-up-r sub" onClick={() => setOpen(y.g.c)} title={tip(y.g)}>
                        <span className="t">{clock(y.start)}</span>
                        <span className="b"><span className="l1">{tn(dotEl(y.g.c, y.g), <b className={ord(d) * 1440 + y.end > dueAbs(y.g.c.job) ? "late" : ""}>#{y.g.c.job.number}</b>)}<span className="c">{y.g.c.job.name || y.g.c.need.label}</span></span></span>
                        <span className="q">{y.g.c.need.qty.toLocaleString()}</span>
                      </button>
                    ))}
                  </Fragment>
                );
              })}
            </section>
          );
        })}
        {d && !machines.some((m) => joined(m, d).length) && <div className="faint msf-up-none">Nothing booked yet.</div>}
      </aside>
    );
  };
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
      const title = `#${job.number} ${job.customer && job.name ? `${job.customer} · ${job.name}` : job.customer || job.name}`;
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
      const lu = breaksOn(r.m, d, sh, segs.lunch.get(r.m.id + "|" + d)).find((y) => y[2] !== "Warm-up"), noon = lu ? lu[0] : Math.round((sh[0] + sh[1]) / 2); // never less than the morning
      const from = Math.ceil(Math.max(x.otFrom, last, noon, d === today ? now.min : 0) / 15) * 15;
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
  whenRef.current = whenCan;
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
  async function saveHold(h: { name: string; customer: string; spec: QuickJob; due_date: string; due_time: number | null; notes: string; order_id?: string | null; art?: string }, said?: (m: string) => void) {
    const need = quickNeed(s!, h.spec);
    if (!need.steps.length) return "Add at least one print location.";
    const spot = holdSpot(need, h.due_date);
    if (!spot) return "No machine can run this.";
    const sb = createClient();
    const day = fromOrd(Math.floor(spot.start / 1440));
    // a hold from a quote: its details (sizes, prints, art approved) are due three working days before it prints
    const detailsDue = h.order_id ? [minusWorkdays(day, 3), today].sort().pop()! : null;
    const r = await sb.from("production_holds").insert({ ...h, created_by: me.email, ...(detailsDue ? { details_due: detailsDue } : {}) }).select("id").single();
    if (r.error) return r.error.message;
    if (h.order_id && detailsDue) said?.(`Spot held: ${spot.m.name}, ${dayLbl(day)} · about ${fmtMin(spot.minutes)} · details due ${dayLbl(detailsDue)}.`);
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

  const shift = (dir: 1 | -1) => (view === "timeline" ? setWeek(addDay(week, 7 * dir)) : view === "flow" ? (setDay(nextVis(addDay(today, dir > 0 ? 1 : 0), dir)), setView("day")) : setDay(nextVis(addDay(day, dir), dir)));
  // test hook (off unless window.__MS_DEBUG is set): the scheduler's state and actions, for the automated stress test
  if (when || hold) return null;
  if (phone && s) {
    const d = pDay || today, isToday = d === today;
    const days: string[] = []; for (let x = today; days.length < 5; x = addDay(x, 1)) { const wd = new Date(x + "T12:00:00").getDay(); if (wd !== 0 && wd !== 6) days.push(x); }
    const nowMin = now.day === d ? now.min : now.day > d ? 1e9 : -1;
    type PJ = { c: Card; start: number; end: number; st: "done" | "run" | "next" | "wait" | "late"; at?: string };
    const presses = machines.map((m) => {
      const byCard = new Map<string, { c: Card; start: number; end: number }>();
      for (const g of at(m, d)) { const x = byCard.get(g.c.key); if (x) { x.start = Math.min(x.start, g.start); x.end = Math.max(x.end, g.end); } else byCard.set(g.c.key, { c: g.c, start: g.start, end: g.end }); }
      const list = [...byCard.values()].sort((a, b) => a.start - b.start);
      let nextSet = false;
      const jobs: PJ[] = list.map((x) => {
        const st0 = x.c.slot?.status;
        if (st0 === "done") return { ...x, st: "done" as const, at: x.c.slot?.finished_at ? new Date(x.c.slot.finished_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "" };
        if (st0 === "running") return { ...x, st: "run" as const };
        if (isToday && x.start + 15 < nowMin) return { ...x, st: "late" as const };
        if (!nextSet) { nextSet = true; return { ...x, st: "next" as const }; }
        return { ...x, st: "wait" as const };
      });
      return { m, jobs };
    }).filter((p) => p.jobs.length);
    const all = presses.flatMap((p) => p.jobs);
    const nDone = all.filter((j) => j.st === "done").length, nRun = all.filter((j) => j.st === "run").length;
    const lbl: Record<PJ["st"], string> = { done: "✓ Done", run: "Running", next: "Next", wait: "Waiting", late: "Late start" };
    return (
      <div className="msp">
        <div className="msp-menu">
          {!embOnly && ([["screen", "Screen"], ["embroidery", "Embroidery"], ["heat", "Heat"]] as const).map(([k, l]) => <button key={k} type="button" className={(k === "embroidery" ? embSide : k === "heat" ? side === "heat" && !embSide : !embSide && side !== "heat") ? "on" : ""} onClick={() => setSide(k as never)}>{l}</button>)}
          <button type="button" className={"msp-mine" + (mine ? " on" : "")} onClick={() => setMine(!mine)}>My jobs</button>
        </div>
        <div className="msp-days">{days.map((x) => (
          <button key={x} type="button" className={x === d ? "on" : ""} onClick={() => setPDay(x === today ? "" : x)}><small>{x === today ? "Today" : new Date(x + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}</small><b>{+x.slice(8)}</b></button>
        ))}</div>
        <div className="msp-sum"><div><b className="ok">{nDone}</b><span className="ok">Done</span></div><div><b className="run">{nRun}</b><span className="run">Running</span></div><div><b>{all.length - nDone - nRun}</b><span>To go</span></div></div>
        {!presses.length && <div className="msp-empty">Nothing on the {embSide ? "embroidery" : side === "heat" ? "heat press" : "screen print"} schedule {isToday ? "today" : "this day"}.</div>}
        {presses.map(({ m, jobs }) => {
          const done = jobs.filter((j) => j.st === "done").length, crew = (m.crew ? s.crews.find((c) => c.id === m.crew) : undefined)?.leader;
          return (
            <div key={m.id} className="msp-pr">
              <div className="msp-ph"><span><b>{shortName(m)}</b>{crew ? <small> · {crew}</small> : null}</span><small>{done} of {jobs.length} done</small></div>
              <i className="msp-bar"><b style={{ width: `${Math.round((done / jobs.length) * 100)}%` }} /></i>
              {jobs.map((j) => {
                const q = j.c.need.qty, pr = Math.round((+(j.c.slot?.progress || 0)) * q);
                return (
                  <a key={j.c.key} className={"msp-j " + j.st} href={j.c.job.href || undefined}>
                    <span className="msp-t">{clock(j.start)}</span>
                    <span className="msp-m"><span className="msp-n"><b>#{j.c.job.number}</b> {j.c.job.customer}</span>
                      {j.c.job.name ? <span className="msp-jn" data-notranslate>{j.c.job.name}</span> : null}
                      {j.st === "run" ? <span className="msp-run">{pr ? `${pr} of ${q} · ` : ""}done ~{clock(j.end)}</span> : null}</span>
                    <span className={"msp-st " + j.st}>{lbl[j.st]}{j.st === "done" && j.at ? " " + j.at.replace(" AM", "").replace(" PM", "") : ""}</span>
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }
  if (typeof window !== "undefined" && (window as unknown as { __MS_DEBUG?: boolean }).__MS_DEBUG) Object.assign(window, { __ms: { s, cards, segs, machines, today, now, tight, tray, slots, holds, planIt, applyPlan, whatIfs, whenCan, holdSpot, otReport, otOn, acceptAll, book, unbook, saveProgress, logAction, splitByLocation, saveHold, removeHold, cutOvertime, load } });

  return (
    <div className="ms ms-calm">
      {/* the calendar's own controls on one line: what's shown on the left, how it's shown on the right */}
      {/* one line that never wraps: when it gets tight each control turns into a compact dropdown of the same choices */}
      <div className="ms-head-w">
      <div className="ms-head">
        <h2 className="ms-title"><span className="ms-full">Production Calendar</span><span className="ms-cmp">Production</span></h2>
        <div className="rv-seg ms-who ms-full" role="group" aria-label="Whose jobs">{([[false, "Everyone"], [true, "My accounts"]] as const).map(([k, l]) => <button key={l} type="button" className={mine === k ? "on" : ""} onClick={() => setMine(k)}>{l}</button>)}</div>
        <select className="ms-cmp ms-sel" value={mine ? "mine" : "all"} aria-label="Whose jobs" onChange={(e) => setMine(e.target.value === "mine")}><option value="all">Everyone</option><option value="mine">My accounts</option></select>
        <span className="spacer" />
        <label className="ms-wknd ms-desk" title="Show Saturday and Sunday"><input type="checkbox" checked={showWknd} onChange={(e) => setWknd(e.target.checked)} /> <span className="ms-full">Weekends</span><span className="ms-cmp">Sat/Sun</span></label>
        <label className="ms-wknd ms-desk" title="Quotes holding a spot (Hold the spot): off, they're a plain gray band so the time still looks taken"><input type="checkbox" checked={showHolds} onChange={(e) => setShowHolds(e.target.checked)} /> <span className="ms-full">Show holds</span><span className="ms-cmp">Holds</span></label>
        <div className="rv-seg ms-span ms-full ms-desk">{VIEW_OPTS.map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
        <select className="ms-cmp ms-sel ms-desk" value={view} aria-label="View" onChange={(e) => setView(e.target.value as View)}>{VIEW_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
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
          {/* option G (Nov 11, Nick): the tools on the left (2/3), one short AI tip at a time on the right (1/3) */}
          <div className="msk">
            <div className="msk-tools">
              <div className="msk-h">Scheduling tools</div>
              {/* grouped again, compact: a small colored name in front of each group (Nov 11, Nick: "indicate… sales tools,
                  press tools, planning") */}
              <div className="msk-row">
                <span className="msk-g plan"><span className="msk-gl">Planning</span>
                  <button type="button" className="btn primary msk-b" title="Re-lay open work from now, soonest in-hands first" onClick={() => setReplan({ why: "" })}><SkIco d="replan" />Re-plan</button>
                  <button type="button" className={"btn msk-b" + (tight.length ? " bad" : "")} title="Jobs that won't make their in-hands date" onClick={() => setTightOpen(!tightOpen)}><SkIco d="late" />Late jobs<span className="msk-n">{tight.length}</span></button>
                  <button type="button" className="btn msk-b" title="Drop extra shifts, put split jobs back together" onClick={() => setRenorm(true)}><SkIco d="norm" />Renormalize</button>
                  <button type="button" className="btn msk-b" title="Set what's really done: counted, printed, ready, completed" onClick={() => setStandOpen(true)}><SkIco d="prog" />Where things stand</button>
                </span>
                <span className="msk-g press"><span className="msk-gl">Press &amp; crew</span>
                  <button type="button" className={"btn msk-b msk-live" + (s.liveClock ? " on" : "")} disabled={!canEquip} onClick={() => void setLiveClock(!s.liveClock)} title={s.liveClock ? "Live clock is on: the schedule follows the time clock and press timers (not started moves up to now, unfinished days roll to today). Click to plan by hand." : "Live clock is off: the schedule is a plan made by hand, like Printavo; nothing moves on its own. Click to follow the time clock."}><span className="msk-sw" aria-hidden><i /></span>Live clock {s.liveClock ? "on" : "off"}</button>
                  <button type="button" className="btn msk-b" title="What's started, done or paused today" onClick={() => setCheckin(true)}><SkIco d="prog" />Progress</button>
                  <button type="button" className="btn msk-b" title="Who's past 40 hours this pay week" onClick={() => setOtOpen(true)}><SkIco d="ot" />Overtime</button>
                  <button type="button" className="btn msk-b" title="A weekend or extra shift for a crew" onClick={() => setShiftEdit(true)}><SkIco d="shift" />Shift</button>
                  <button type="button" className="btn msk-b" title="Maintenance, repairs, an employee out" onClick={() => setDownEdit({})}><SkIco d="down" />Downtime</button>
                  <button type="button" className={"btn msk-b" + (eqIssues.length ? " warn" : "")} title="Heads out, running slow, or down" disabled={!canEquip} onClick={() => setEqOpen(true)}><SkIco d="eq" />Equipment{eqIssues.length ? <span className="msk-n">{eqIssues.length}</span> : null}</button>
                </span>
                <span className="msk-g sales"><span className="msk-gl">Sales</span>
                  <button type="button" className="btn msk-b" title="Quick specs → soonest, aggressive, regular and slow-boat dates" onClick={() => setWhenOpen(true)}><SkIco d="when" />When can we {VERB[typeF || "screen"].v.toLowerCase()} it?</button>
                  <button type="button" className="btn msk-b" title="Hold time for jobs you know are coming" onClick={() => setPlanOpen(true)}><SkIco d="plan" />Planner</button>
                </span>
              </div>
              {tightOpen && tight.length > 0 && <ul className="ms-alert-l msk-late">{tight.map((t) => <li key={t.job.key}><Link href={t.job.href}>#{t.job.number}</Link><span>{who(t.job)}</span><small>{t.why}</small></li>)}</ul>}
            </div>
            {(() => {
              // the assistant's tips, most pressing first; one shows at a time and they take turns
              type Tip = { lvl: "bad" | "warn" | "ok"; t: string; s: string; act?: [string, () => void] };
              const tips: Tip[] = [];
              const and = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
              const nums = (xs: { job: { number: string | number } }[]) => xs.slice(0, 3).map((x) => "#" + x.job.number).join(", ") + (xs.length > 3 ? ` +${xs.length - 3}` : "");
              if (tight.length) tips.push({ lvl: "bad", t: `${tight.length} job${tight.length === 1 ? " won't make its" : "s won't make their"} in-hands date`, s: `${nums(tight)}. See what would fix it.`, act: ["Recommendations", () => setAdvise({ opts: whatIfs(), late: tight.map((t) => ({ job: "#" + t.job.number, customer: t.job.customer || t.job.name, inHands: t.job.due ? dayLbl(t.job.due) : "none", why: t.why })), lateBefore: tight.length })] });
              const rows = otReport(payWeekStart(today)), ot = rows.reduce((t, r) => t + r.w.ot, 0), unused = rows.reduce((t, r) => t + r.unused, 0);
              if (ot > 0) { const w = rows.filter((r) => r.w.ot).sort((a, b) => b.w.ot - a.w.ot); tips.push({ lvl: "warn", t: `${fmtMin(ot)} of overtime this pay week`, s: `${and(w.map((r) => `${crewOf(r.m)?.leader || shortName(r.m)} ${fmtMin(r.w.ot)}`))}${unused > 30 ? ` · ${fmtMin(unused)} of it has no jobs` : ""}.`, act: ["Details", () => setOtOpen(true)] }); }
              const d1 = Array.from({ length: 7 }, (_, i) => addDay(today, i + 1)).find((d) => machines.some((m) => shiftOn(m, d)));
              if (d1) { const idle = machines.filter((m) => shiftOn(m, d1)).map((m) => ({ m, free: capacityMin(s, m, d1) - used(m, d1) })).filter((x) => x.free >= 120 && cards.some((c) => c.day > d1 && c.slot && c.slot.status === "scheduled" && !c.job.firm && c.job.kind !== "h" && fits(c.need, x.m)));
                if (idle.length) tips.push({ lvl: "warn", t: idle.length === 1 ? `${shortName(idle[0].m)} has ${fmtMin(idle[0].free)} open ${d1 === addDay(today, 1) ? "tomorrow" : dayLbl(d1)}` : `${idle.length} presses have open time ${d1 === addDay(today, 1) ? "tomorrow" : dayLbl(d1)}`, s: "Later jobs could move up into it.", act: ["Re-plan", () => setReplan({ why: "Pull later jobs forward into the open time?" })] }); }
              for (const o of artOffers) tips.push({ lvl: "warn", t: `${o.cards.length} jobs print the same art`, s: `Run them together on ${shortName(o.machine)} ${dayLbl(o.day)}${o.saves ? `, about ${fmtMin(o.saves)} less setup` : ""}.`, act: ["Run together", () => runTogether(o)] });
              if (eqIssues.length) tips.push({ lvl: "warn", t: `${and(eqIssues.map((m) => shortName(m)))} ${eqIssues.length === 1 ? "has" : "have"} an equipment issue`, s: "Jobs there are planned around it.", act: canEquip ? ["Details", () => setEqOpen(true)] : undefined });
              if (tray.length) tips.push({ lvl: "warn", t: `${tray.length} job${tray.length === 1 ? "" : "s"} ready to schedule`, s: "Drag onto a press, or Re-plan books them.", act: ["Re-plan", () => { setReplanTray(true); setReplan({ why: "" }); }] });
              if (!tips.length) tips.push({ lvl: "ok", t: "You're good", s: "Every job makes its in-hands date and nobody needs overtime this week." });
              const i = tipI % tips.length, tp = tips[i];
              return (
                <div className={"msai " + tp.lvl} aria-label="Shop AI Assistant" onMouseEnter={() => setTipHold(true)} onMouseLeave={() => setTipHold(false)}>
                  <div className="msai-h"><span aria-hidden>✦</span> Shop assistant<span className="spacer" />{tips.length > 1 && <><span className="msai-dots">{tips.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</span><button type="button" className="msai-nav" aria-label="Previous tip" onClick={() => setTipI((i - 1 + tips.length) % tips.length)}>‹</button><button type="button" className="msai-nav" aria-label="Next tip" onClick={() => setTipI((i + 1) % tips.length)}>›</button></>}</div>
                  <div className="msai-b"><div className="msai-t">{tp.t}</div><div className="msai-s">{tp.s}</div></div>
                  {tp.act && <button type="button" className="btn primary sm msai-go" onClick={tp.act[1]}>{tp.act[0]}</button>}
                </div>
              );
            })()}
          </div>
          <div className={"ms-ready" + (drag?.card?.slot ? " drop-back" : "") + (over === "tray" ? " over" : "")}
            onDragOver={(e) => { if (drag?.card?.slot) { e.preventDefault(); setOver("tray"); } }} onDragLeave={() => setOver((o) => (o === "tray" ? "" : o))}
            onDrop={(e) => { e.preventDefault(); setOver(""); if (drag?.card?.slot) unbookMany(drag.group || [drag.card]); setDrag(null); }}>
            <div className="ms-ready-h">
              <button type="button" className="ms-band-t" onClick={() => setTrayOpen(!trayOpen)} aria-expanded={trayOpen}><span className="car">{trayOpen ? "▾" : "▸"}</span><b>Ready To Schedule</b><span className="aa-n">{trayV.length}</span></button>
              <span className="faint ms-band-sub">{trayV.filter((t) => t.sug?.late).length ? <span className="ms-late">{trayV.filter((t) => t.sug?.late).length} tight or late · </span> : null}{coming.length ? `${coming.length} more coming (art being approved) · ` : ""}{trayV.length ? (Object.keys(picks).length ? `${trayV.filter((t) => t.picked).length} picked by you · ` : "") + "by due date · click a spot to change it, then Make The Schedule" : "nothing waiting"}</span>
              <span className="spacer" />
              {(() => {
                // Start over asks first, and what to do with the locks (Nov 11, Nick: "yes, start over… release all locks or leave locks there")
                const open = cards.filter((c) => c.slot && c.slot.status === "scheduled" && c.day >= today && (!typeF || c.machine.type === typeF)), locked = open.filter((c) => c.slot!.locked), free = open.filter((c) => !c.slot!.locked);
                if (!open.length) return null;
                const go = async () => {
                  setRestart(false);
                  /* the early finishes a plan made for overtime go too; real downtime (a press down, someone out) stays (Nov 11, Nick) */
                  await createClient().from("production_days_off").delete().eq("note", "Leaving early (no overtime)").gte("day", today);
                  unbookMany(relLocks ? open : free);
                };
                return <>
                  <button type="button" className="btn sm" onClick={() => { setRelLocks(false); setRestart(true); }} title="Take every job that hasn't started off the calendar, back into Ready To Schedule">Start over</button>
                  {restart && <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Start over" onClick={() => setRestart(false)}>
                    <div className="dla mso-dlg" onClick={(e) => e.stopPropagation()}>
                      <h3>Start over the {typeF === "embroidery" ? "embroidery" : typeF === "heat" ? "heat press" : typeF === "screen" ? "screen print" : "whole"} schedule?</h3>
                      <p className="dla-sub">Takes every job that hasn&apos;t started off the calendar ({free.length + (relLocks ? locked.length : 0)}), back into Ready To Schedule, so Make The Schedule can plan it again.</p>
                      {locked.length > 0 && <div className="mso-opts" role="radiogroup">
                        <label className={"mso-opt" + (!relLocks ? " on" : "")}><input type="radio" name="mso-l" checked={!relLocks} onChange={() => setRelLocks(false)} /><span><b>Keep my locks</b><small>{locked.length} locked job{locked.length === 1 ? "" : "s"} stay{locked.length === 1 ? "s" : ""} where {locked.length === 1 ? "it is" : "they are"}: {locked.slice(0, 4).map((c) => `#${c.job.number} ${shortName(c.machine)} ${dayLbl(c.day).split(",")[0]}${c.startMin != null ? " " + clock(c.startMin) : ""}`).join(", ")}{locked.length > 4 ? "…" : ""}</small></span></label>
                        <label className={"mso-opt" + (relLocks ? " on" : "")}><input type="radio" name="mso-l" checked={relLocks} onChange={() => setRelLocks(true)} /><span><b>Release all locks too</b><small>Every job not started comes off, locked ones included</small></span></label>
                      </div>}
                      <div className="dla-acts"><button type="button" className="btn ghost" onClick={() => setRestart(false)}>Cancel</button><button type="button" className="btn danger" onClick={() => void go()}>Yes, start over</button></div>
                    </div>
                  </div>}
                </>;
              })()}
              {trayOpen && trayV.some((t) => t.sug) && <button type="button" className="btn sm primary" onClick={acceptAll} title="Books every job: where you picked, else our suggestion">Make The Schedule</button>}
            </div>
            {trayOpen && tray.length > 0 && (() => {
              const isLate = (t: (typeof trayV)[number]) => t.job.kind !== "h" && (!!t.sug?.late || (!!t.job.due && t.job.due < today));
              const kinds = { late: trayV.filter(isLate), hold: trayV.filter((t) => t.job.kind === "h"), ok: trayV.filter((t) => t.job.kind !== "h" && !isLate(t)) };
              const list = trayTab === "all" ? trayV : kinds[trayTab];
              return (
              <>
                <div className="toolbar ms-rtabs"><div className="chips">
                  {([["all", "All", trayV.length], ["late", "Late", kinds.late.length], ["hold", "Holds", kinds.hold.length], ["ok", "On time", kinds.ok.length]] as const).map(([k, l, n]) => <button key={k} type="button" className={"chip" + (trayTab === k ? " on" : "")} onClick={() => setTrayTab(k)}>{l}<span className="chip-n">{n}</span></button>)}
                </div>
                  {(() => {
                    // Job Filters (Nick, Nov 11): Regular Orders first, then each customer's kinds under its name
                    const all = new Map<string, { label: string; who: string; n: number }>();
                    for (const t of tray) for (const k of kindsOfJob(t.job)) { const x = all.get(k.key) || { label: k.label, who: k.key === "regular" ? "" : t.job.customer, n: 0 }; x.n++; all.set(k.key, x); }
                    const hidden = hideKinds.filter((k) => all.has(k));
                    if (all.size < 2 && !hidden.length) return null;
                    const byWho = new Map<string, [string, { label: string; who: string; n: number }][]>();
                    for (const e of all) if (e[0] !== "regular") byWho.set(e[1].who, [...(byWho.get(e[1].who) || []), e]);
                    const whos = [...byWho].sort((a, b) => b[1].reduce((x, e) => x + e[1].n, 0) - a[1].reduce((x, e) => x + e[1].n, 0));
                    const flip = (k: string) => setHideKinds(hideKinds.includes(k) ? hideKinds.filter((x) => x !== k) : [...hideKinds, k]);
                    const others = [...all.keys()].filter((k) => k !== "regular");
                    const onlyReg = all.has("regular") && others.length > 0 && others.every((k) => hideKinds.includes(k)) && !hideKinds.includes("regular");
                    const row = (k: string, x: { label: string; n: number }) => (
                      <label key={k} className="msk-kinds-r"><input type="checkbox" checked={!hideKinds.includes(k)} onChange={() => flip(k)} /><b>{x.label}</b><span className="chip-n">{x.n}</span></label>
                    );
                    return (
                      <div className="msk-kinds">
                        <button type="button" className={"btn sm" + (hidden.length ? " on" : "")} aria-expanded={kindsOpen} onClick={() => setKindsOpen(!kindsOpen)} title="Show or hide kinds of jobs: a customer's carts, a program like All My Sons, regular orders">
                          Job Filters{onlyReg ? " · Regular Orders only" : hidden.length ? ` · Hiding ${hidden.length}` : ""} ▾</button>
                        {kindsOpen && <>
                          <div className="msk-kinds-bg" onClick={() => setKindsOpen(false)} />
                          <div className="msk-kinds-m" role="menu">
                            {all.has("regular") && row("regular", all.get("regular")!)}
                            {whos.map(([who, es]) => (
                              <div key={who} className="msk-kinds-g"><div className="msk-kinds-h" data-notranslate>{who}</div>
                                {[...es].sort((a, b) => Number(a[1].label.startsWith("Other ")) - Number(b[1].label.startsWith("Other ")) || b[1].n - a[1].n).map(([k, x]) => row(k, x))}</div>
                            ))}
                            <div className="msk-kinds-a">
                              <button type="button" className="btn sm" onClick={() => setHideKinds(others)}>Only Regular Orders</button>
                              <button type="button" className="btn sm" onClick={() => setHideKinds([])}>Show All</button>
                            </div>
                          </div>
                        </>}
                      </div>
                    );
                  })()}
                </div>
                <ul className="msr-l">{(() => {
                  // by due date, due today first (no date last); jobs that print together stay in their order
                  const byDue = list.map((t, i) => ({ t, i })).sort((x, y) => (x.t.job.due || "9999").localeCompare(y.t.job.due || "9999") || x.i - y.i).map((x) => x.t);
                  const who = (m: Machine) => crewOf(m)?.leader || shortName(m), dayW = (d: string) => (d === today ? "Today" : dayLbl(d).split(",")[0]);
                  return (trayAll ? byDue : byDue.slice(0, 24)).map((t) => { const k = t.job.key + t.need.type, open = pickOpen === k, late = isLate(t), pk = picks[k];
                    const from = t.job.prod && t.job.prod > today ? t.job.prod : today, days: string[] = []; for (let d = from, g = 0; days.length < 6 && g < 21; g++, d = addDay(d, 1)) if (machines.some((m) => shiftOn(m, d))) days.push(d);
                    const okM = machines.filter((m) => fits(t.need, m)), selM = pk?.m || t.sug?.machine.id || okM[0]?.id || "", selD = pk?.d || t.sug?.day || days[0];
                    return (
                    <li key={k} draggable onDragStart={(e) => startDrag(e, { job: t.job, need: t.need, grabMin: 0 })} onDragEnd={() => setDrag(null)} className={"msr-c" + (t.job.kind === "h" ? " hold" : "") + (t.picked ? " picked" : "") + (open ? " open" : "")} title={`${t.job.name}\n${t.need.label} · ${t.need.qty} pcs${t.job.owner ? `\nAccount: ${t.job.owner}` : ""}${t.sug ? `\n${t.sug.reason}` : ""}`}>
                      <div className="msr-1">{tn((() => { const d = dotOf({ job: t.job } as Card, Infinity); return d ? <GoodsTee k={d.k} t={d.t} /> : null; })(), <Link className={"msr-n" + (late ? " late" : "")} href={t.job.href}>#{t.job.number}</Link>)}<b>{t.job.customer || t.job.name}</b></div>
                      <div className="msr-2">{t.job.customer ? t.job.name : t.need.label}</div>
                      <div className="msr-3"><b>{t.need.qty.toLocaleString()}</b><span className={late ? "late" : ""}>{t.job.due ? `due ${dayShort(t.job.due)}` : "no date"}</span><span className="spacer" />
                        {t.sug ? <button type="button" className={"msr-spot" + (t.picked ? " mine" : "")} onClick={() => setPickOpen(open ? "" : k)} title={t.picked ? "Your pick · click to change" : `Suggested: ${t.sug.reason} · click to put it somewhere else`}>{t.picked ? "✓" : "✦"} {who(t.sug.machine)} · {dayW(t.sug.day)}{t.picked ? "" : " ▾"}</button> : <button type="button" className="msr-spot none" onClick={() => setPickOpen(open ? "" : k)}>Pick a spot ▾</button>}
                      </div>
                      {open && <div className="msr-pop" onClick={(e) => e.stopPropagation()}>
                        {t.auto && <><div className="msr-ph">Suggested</div><div className="msr-sug">✦ <b>{who(t.auto.machine)} · {shortName(t.auto.machine)} · {dayW(t.auto.day)}</b> <span className="faint">{t.auto.reason}</span></div></>}
                        <div className="msr-ph">Put it on</div>
                        <div className="msr-seg" style={{ gridTemplateColumns: `repeat(${Math.max(1, okM.length)},minmax(0,1fr))` }}>{okM.map((m) => <button key={m.id} type="button" className={selM === m.id ? "on" : ""} onClick={() => setPicks((p) => ({ ...p, [k]: { m: m.id, d: selD } }))}>{who(m)}</button>)}</div>
                        <div className="msr-seg" style={{ gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))` }}>{days.map((d) => <button key={d} type="button" className={selD === d ? "on" : ""} onClick={() => setPicks((p) => ({ ...p, [k]: { m: selM, d } }))}>{dayW(d)}</button>)}</div>
                        <div className="msr-act"><button type="button" className="btn sm primary" onClick={() => { if (!pk && selM) setPicks((p) => ({ ...p, [k]: { m: selM, d: selD } })); setPickOpen(""); }}>Use {okM.find((m) => m.id === selM) ? who(okM.find((m) => m.id === selM)!) : ""} · {dayW(selD)}</button>{pk && <button type="button" className="btn sm" onClick={() => { setPicks((p) => { const n = { ...p }; delete n[k]; return n; }); setPickOpen(""); }}>Back To Suggested</button>}</div>
                      </div>}
                    </li>
                  ); });
                })()}</ul>
                {!list.length && <div className="faint ms-rnone">Nothing here.</div>}
                {list.length > 24 && <button type="button" className="btn sm ms-band-more" onClick={() => setTrayAll(!trayAll)}>{trayAll ? "Show fewer" : `Show all ${list.length}`}</button>}
              </>
              );
            })()}
          </div>
        </>}
      </section>

      <div className="ms-main">
        {/* what each look means (Nov 11, Nick: "we need a key at the top for whatever colors you do use") */}
        {view === "flow" ? flowView() : view === "timeline" ? <div className="ms-weeks">{weekGrid(week, week === monday(today) ? "This Week" : week === addDay(monday(today), -7) ? "Last Week" : "Week of")}{weekGrid(addDay(week, 7), addDay(week, 7) === addDay(monday(today), 7) ? "Next Week" : addDay(week, 7) === monday(today) ? "This Week" : "Week of")}</div> : dayGrid(day)}
        {phoneView()}
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
      {standOpen && <ScheduleStartPoint by={me.name || me.email} presses={s.machines.filter((m) => m.active).map((m) => ({ id: m.id, type: m.type, label: `${shortName(m)}${crewOf(m)?.leader ? " · " + crewOf(m)!.leader : ""}` }))} onClose={() => setStandOpen(false)} onSaved={() => load()} />}
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
                return <div className="ms-ask ok"><b>No overtime needed: {fmtMin(mins)} saved{canPay ? ` (about $${Math.round(dollars).toLocaleString()} in overtime pay)` : ""}.</b><span>{[...byCrew.values()].map((l) => `${crewOf(l[0].m)?.leader || shortName(l[0].m)}'s crew leaves at 40 hours: ${l.map((x) => `${dayShort(x.day)} ${clockLong(x.start)}`).join(", ")}`).join(" · ")}. Every job that makes its date with the overtime still makes it.</span></div>;
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
      {grpEdit && s && <RunGroupTime s={s} cards={grpEdit} onClose={() => setGrpEdit(null)} onSaved={() => { setGrpEdit(null); load(); }} />}
      {open && <CardPanel s={s} c={open} cost={crewCost} otMin={(segs.ofCard.get(open.key) || []).reduce((t, g) => { const oa = otOn(g.c.machine, g.day); return t + (oa == null ? 0 : Math.max(0, g.end - Math.max(g.start, oa))); }, 0)} onFlags={async (x) => { const r = await createClient().from("orders").update({ ...x, updated_at: new Date().toISOString() }).eq("id", open.job.id); if (r.error) { setMsg(r.error.message); return; } const j = { ...open.job, ...(x.rush !== undefined ? { rush: x.rush } : {}), ...(x.firm !== undefined ? { firm: x.firm } : {}), ...(x.due_time !== undefined ? { dueTime: x.due_time } : {}), ...(x.due_date !== undefined ? { due: x.due_date } : {}) }; setOpen({ ...open, job: j }); load(); }} segs={segs.ofCard.get(open.key) || []} days={[...new Set([...allDays, ...hourly.map((h) => h.d), ...restDays])].filter(visible).sort()} win={[vStart, vEnd]} onClose={() => { setOpen(null); setOpenMove(false); }} onMove={(mach, d, st) => { setOpenMove(false); book(open.job, open.need, mach, d, "manual", open.slot, st); setOpen(null); }} startMove={openMove} onSplit={(off, to) => splitByLocation(open, off, to)} parts={splitParts(open).map((x) => { const g = segs.ofCard.get(x.key) || []; return { key: x.key, me: x.key === open.key, press: `${shortName(x.machine)}${crewOf(x.machine)?.leader ? ` · ${crewOf(x.machine)!.leader}` : ""}`, what: x.need.label, when: g.length ? `${wkd(g[0].day)} ${clock(g[0].start)} – ${clock(g[g.length - 1].end)}` : "" }; })} onUnite={() => uniteJob(open)} presses={machines.filter((m) => m.type === open.need.type && fits(open.need, m)).map((m) => ({ id: m.id, name: `${shortName(m)}${crewOf(m)?.leader ? ` · ${crewOf(m)!.leader}` : ""}` }))} onRunTime={() => { setOpen(null); load(); }} />}
    </div>
  );
}

/** A job on the calendar: when it runs (every day it spans), the time breakdown, move it, mark it running or done, or take it off. */
/**
 * The job's time on the job panel, each print location with a pencil (Nov 9, Nick: "Jose… should be able to… go, hey,
 * this job, it took 3 hours and 30 minutes on the front… override your settings… you should be learning from that").
 * A time set here is the location's time on every press; it's also kept as a lesson about the operator's pace.
 */
function RunTimes({ s, c, m, est, onSaved }: { s: ProductionSettings; c: Card; m: Machine; est: ReturnType<typeof estimate>; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null), [txt, setTxt] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const locs = [...new Set(est.parts.map((p) => p.loc || ""))];
  const canEdit = c.job.kind === "o";
  const raw = (loc: string) => { const n = subNeed(c.need, [loc]); return estimateRaw(s, { ...n, steps: n.steps.map((st) => ({ ...st, over: undefined })) }, { ...m, pace: undefined }).minutes; };
  async function save(loc: string, minutes: number | null) {
    if (minutes !== null && !(minutes > 0)) { setErr("Type a time like 3h 30m, 3:30 or 3.5"); return; }
    setBusy(true); setErr("");
    const op = operatorOf(s, m);
    const r = await setRunTime({ orderId: c.job.id, loc, minutes, estMin: raw(loc), qty: c.need.steps.filter((st) => locKey(st) === loc).reduce((t, st) => t + st.qty, 0), machine: m.id, crewId: op.crew, operator: op.id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn't save."); return; }
    setEdit(null); onSaved();
  }
  const op = operatorOf(s, m);
  return (
    <div className="rtm">
      <ul className="ms-parts">
        {locs.map((loc) => {
          const ps = est.parts.filter((p) => (p.loc || "") === loc), tot = ps.reduce((t, p) => t + p.minutes, 0), by = ps.find((p) => p.by)?.by;
          const name = c.need.steps.find((st) => locKey(st) === loc)?.location || loc;
          return [
            ...ps.map((p, i) => <li key={loc + i}><span>{p.label}</span>{ps.length === 1 ? null : <b className="rtm-sub">{fmtMin(p.minutes)}</b>}{ps.length === 1 && edit !== loc ? <b className="rtm-t">{fmtMin(p.minutes)}{canEdit && loc ? <button type="button" className="rtm-pen" title={`Set how long ${name} takes`} aria-label={`Edit ${name} time`} onClick={() => { setEdit(loc); setTxt(fmtMin(tot)); setErr(""); }}>✎</button> : null}</b> : null}</li>),
            ps.length > 1 && edit !== loc ? <li key={loc + "t"} className="rtm-loc"><span>{name}{by ? "" : " total"}</span><b className="rtm-t">{fmtMin(tot)}{canEdit && loc ? <button type="button" className="rtm-pen" title={`Set how long ${name} takes`} aria-label={`Edit ${name} time`} onClick={() => { setEdit(loc); setTxt(fmtMin(tot)); setErr(""); }}>✎</button> : null}</b></li> : null,
            edit === loc ? <li key={loc + "e"} className="rtm-ed">
              <span className="rtm-q">{name} takes</span>
              <input className="input" autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(loc, parseDuration(txt) ?? 0); if (e.key === "Escape") setEdit(null); }} aria-label={`${name} time`} placeholder="3h 30m" />
              <button type="button" className="btn sm primary" disabled={busy} onClick={() => save(loc, parseDuration(txt) ?? 0)}>Save</button>
              {by ? <button type="button" className="btn sm" disabled={busy} onClick={() => save(loc, null)}>Use the estimate</button> : null}
              <button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
              <span className="faint rtm-n">Worked out: {fmtMin(raw(loc))} at the standard pace{err ? <b className="rtm-err"> · {err}</b> : null}</span>
            </li> : null,
          ];
        })}
        <li className="tot"><span>Setup {fmtMin(est.setup)} · run {fmtMin(est.run)}{est.teardown ? ` · teardown ${fmtMin(est.teardown)}` : ""}</span><b>{fmtMin(est.minutes)}</b></li>
      </ul>
      {c.sameArt ? <div className="rtm-same">Runs right after #{c.sameArt.with} with the same screens: {fmtMin(c.sameArt.saved)} less setup and teardown.</div> : null}
      {op.who ? <div className="faint rtm-pace">{m.pace ? `${op.who}'s crew runs ${m.pace < 1 ? `${Math.round((1 - m.pace) * 100)}% faster` : m.pace > 1 ? `${Math.round((m.pace - 1) * 100)}% slower` : "at"} than the standard${m.pace === 1 ? " pace" : ""}, learned from ${m.paceN} job${m.paceN === 1 ? "" : "s"}; worked-out times include it.` : `Learning ${op.who}'s pace from finished runs and times set here (${m.paceN || 0} of 2 so far).`}</div> : null}
    </div>
  );
}

/**
 * A same-art run's time (Nov 9, Nick: "double click on it… do you want to edit the individual job time or the total job
 * time?… add another 2 hours… override the group and not have to go to each individual one"). Each job, or the whole run:
 * a total is shared out over the jobs by their current times, and each job's over its print locations the same way; every
 * time set is a print location's time on the order (setRunTime), so it's kept and learned from like one set on a job.
 */
function RunGroupTime({ s, cards, onClose, onSaved }: { s: ProductionSettings; cards: Card[]; onClose: () => void; onSaved: () => void }) {
  const cur = cards.map((c) => c.minutes);
  const [mode, setMode] = useState<"each" | "all">("all");
  const [tot, setTot] = useState(fmtMin(cur.reduce((t, x) => t + x, 0)));
  const [each, setEach] = useState(cur.map((x) => fmtMin(x)));
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  /** one job to a total: over its print locations by their share of its worked-out time */
  async function setJob(c: Card, target: number | null) {
    const est = estimate(s, c.need, c.machine), op = operatorOf(s, c.machine);
    const locs = [...new Set(est.parts.map((p) => p.loc || ""))].filter(Boolean);
    const share = locs.map((l) => est.parts.filter((p) => p.loc === l).reduce((t, p) => t + p.minutes, 0)), sum = share.reduce((t, x) => t + x, 0) || 1;
    for (let i = 0; i < locs.length; i++) {
      const n = subNeed(c.need, [locs[i]]), raw = estimateRaw(s, { ...n, steps: n.steps.map((st) => ({ ...st, over: undefined })) }, { ...c.machine, pace: undefined }).minutes;
      const r = await setRunTime({ orderId: c.job.id, loc: locs[i], minutes: target == null ? null : Math.max(5, Math.round((target * share[i]) / sum)), estMin: raw, qty: n.qty, machine: c.machine.id, crewId: op.crew, operator: op.id });
      if (!r.ok) throw new Error(r.error || "Couldn't save.");
    }
  }
  async function save(clear = false) {
    setErr("");
    let targets: (number | null)[];
    if (clear) targets = cards.map(() => null);
    else if (mode === "all") {
      const T = parseDuration(tot); if (!T) { setErr("Type a time like 6h 30m, 6:30 or 6.5"); return; }
      const sum = cur.reduce((t, x) => t + x, 0) || 1; targets = cur.map((x) => Math.round((T * x) / sum));
    } else {
      const ts = each.map((x) => parseDuration(x)); const i = ts.findIndex((x) => !x); if (i >= 0) { setErr(`#${cards[i].job.number}: type a time like 45m or 1:15`); return; }
      targets = ts as number[];
    }
    setBusy(true);
    try { for (let i = 0; i < cards.length; i++) if (cards[i].job.kind === "o") await setJob(cards[i], targets[i]); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); setBusy(false); }
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed msgt" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Run time">
        <div className="pp-sheet-h"><b>{cards[0].job.customer} · {cards.length} jobs, same art</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="msgt-seg" role="tablist"><button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>Total for the run</button><button type="button" className={mode === "each" ? "on" : ""} onClick={() => setMode("each")}>Each job</button></div>
          {mode === "all" ? <label className="msgt-row"><span>The {cards.length} jobs take</span><input className="input" autoFocus value={tot} onChange={(e) => setTot(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="6h 30m" /><span className="faint">now {fmtMin(cur.reduce((t, x) => t + x, 0))}, shared out by each job's time</span></label>
            : <ul className="ms-parts">{cards.map((c, i) => <li key={c.key}><span>#{c.job.number} · {c.need.qty.toLocaleString()} P <span className="faint">now {fmtMin(cur[i])}</span></span><input className="input msgt-in" value={each[i]} onChange={(e) => setEach(each.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`#${c.job.number} time`} /></li>)}</ul>}
          {err ? <div className="msgt-err">{err}</div> : null}
          <div className="msgt-act"><button type="button" className="btn ghost" disabled={busy} onClick={() => save(true)}>Use the estimates</button><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button></div>
        </div>
      </div>
    </div>
  );
}

function CardPanel({ s, c, cost, otMin, onFlags, segs, days, win, onClose, onMove, onSplit, onRunTime, startMove, parts, onUnite, presses }: { startMove?: boolean; parts: { key: string; me: boolean; press: string; what: string; when: string }[]; onUnite: () => void; presses: { id: string; name: string }[]; onRunTime: () => void; s: ProductionSettings; c: Card; cost: (m: Machine) => { perHour: number; who: string[] } | null; otMin: number; onFlags: (x: { rush?: boolean; firm?: boolean; due_time?: number | null; due_date?: string | null }) => void; segs: Seg[]; days: string[]; win: [number, number]; onClose: () => void; onMove: (m: Machine, d: string, startMin: number | null) => void; onSplit: (off: string[], to?: string) => void }) {
  const [splitting, setSplitting] = useState<string[] | null>(null);
  const [sepsOpen, setSepsOpen] = useState(false);
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
  const [more, setMore] = useState(false), [moving, setMoving] = useState(!!startMove);
  const first = segs[0], last = segs[segs.length - 1], lead = (mm: Machine) => s.crews.find((k) => k.id === mm.crew)?.leader;
  const dW = (d: string) => dayLbl(d).split(",")[0];
  // what the job is (Nov 12, Nick, left click option A: "information. Open the job, run time… the separations"): its prints
  // and inks, garments, mockup pictures and goods, read when the card opens; doing things is the right click
  const [info, setInfo] = useState<{ po: string; pcs: number; prints: { loc: string; inks: string; colors: number }[]; garments: [string, number][]; pics: { url: string; title: string }[] } | null>(null);
  const [splitTo, setSplitTo] = useState(c.machine.id), [uniting, setUniting] = useState(false);
  const [gd, setGd] = useState<CheckJob | null>(null);
  const [wo, setWo] = useState(false);
  useEffect(() => {
    if (c.job.kind !== "o") return;
    const sb = createClient();
    void (async () => {
      const { data: o } = await sb.from("orders").select("po_number, groups").eq("id", c.job.id).maybeSingle();
      const gs = ((o as { groups?: Group[] } | null)?.groups || []) as Group[];
      const seen = new Set<string>(), prints: { loc: string; inks: string; colors: number }[] = [], gm = new Map<string, number>();
      let pcs = 0;
      for (const g of gs) {
        if (g.sample) continue;
        for (const i of g.imprints || []) { const k = `${i.location}|${i.inks}`; if (!i.location || seen.has(k)) continue; seen.add(k); prints.push({ loc: i.location, inks: i.inks || "", colors: i.colors || 0 }); }
        // the garment by its style number and color ("1717 Sage"; Nov 12, Nick)
        for (const l of g.lines || []) { const n = Object.values(l.sizes || {}).reduce((t, x) => t + (+(x as number) || 0), 0); if (!n) continue; pcs += n; const k = [l.style, l.color].filter(Boolean).join(" ") || l.garment || "Garment"; gm.set(k, (gm.get(k) || 0) + n); }
      }
      // every current mockup on the order (Nov 12, Nick: "I should be able to see all the mock-ups")
      const { data: ms } = await sb.from("mockups").select("file_path, title, created_at").eq("order_id", c.job.id).is("archived_at", null).order("created_at").limit(24);
      const rows = ((ms || []) as { file_path: string; title: string | null }[]).filter((x) => x.file_path);
      let pics: { url: string; title: string }[] = [];
      if (rows.length) { const { data } = await sb.storage.from("proofs").createSignedUrls(rows.map((x) => x.file_path), 3600); pics = rows.map((x, i) => ({ url: data?.[i]?.signedUrl || "", title: x.title || "" })).filter((x) => x.url); }
      setInfo({ po: (o as { po_number?: string } | null)?.po_number || "", pcs, prints, garments: [...gm.entries()], pics });
    })();
    void fetch(`/api/goods/checkin?ref=${encodeURIComponent(c.job.id)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setGd([...((j.jobs || []) as CheckJob[]), ...((j.problems || []) as CheckJob[])].find((x) => x.ref === c.job.id) || null)).catch(() => null);
  }, [c.job.id, c.job.kind]);
  const nowM = shopTime(new Date())!, started = sl?.started_at ? shopTime(sl.started_at) : null;
  const soFar = stt === "running" && started && started.day === nowM.day ? Math.max(0, nowM.min - started.min) : null;
  const ck = gd?.checkins?.[0];
  const tmD = (iso: string) => { const t = shopTime(new Date(iso))!; const h = new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" AM", "a").replace(" PM", "p"); return t.day === nowM.day ? h : `${dW(t.day)} ${h}`; };
  const goodsPill = !gd ? null : gd.state === "issue" ? ["r", "Goods problem"] : gd.state === "checked" ? ["g", `Goods counted${ck ? " " + tmD(ck.created_at) : ""}`] : gd.state === "ready" || gd.state === "partial" ? ["a", "Goods here, not counted"] : ["o", "Goods not here yet"];
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet mji" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled job">
        <div className="mji-h">
          <div className="mji-n"><b className="mji-no">{c.job.hold ? "HOLD #" : "#"}{c.job.number}</b><b className="mji-co">{c.job.customer}</b><span className="spacer" /><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
          <div className="mji-jn">{[c.job.name, info?.po && info.po.trim().toLowerCase() !== (c.job.name || "").trim().toLowerCase() ? `PO ${info.po}` : ""].filter(Boolean).join(" · ")}</div>
          <div className="mji-pills">
            <span className={"mji-pill " + (stt === "running" ? "g" : stt === "done" ? "g" : stt === "paused" ? "a" : "gr")}>{stt === "scheduled" ? "Not started" : stt === "running" ? "Printing" : stt === "paused" ? "Paused" : "Done"}</span>
            {c.job.due && <span className="mji-pill o">Due {dW(c.job.due)} {dayShort(c.job.due)}{c.job.dueTime != null ? ` · ${clock(c.job.dueTime)}` : ""}</span>}
            {goodsPill && <span className="mji-pill gr"><GoodsTee k={goodsPill[0]} t="" />{goodsPill[1]}</span>}
            {sl?.locked && <span className="mji-pill b">Locked to {sl.locked === "spot" ? "this spot" : sl.locked === "press" ? "this press" : sl.locked === "person" ? lead(c.machine) || "this person" : "this day"}</span>}
            {c.job.rush && <span className="mji-pill r">Rush</span>}{c.job.firm && <span className="mji-pill o">Firm · {firmLbl(c.job)}</span>}
          </div>
        </div>
        {parts.length > 1 && <div className="mji-sec"><div className="mji-l">This job runs in {parts.length} parts</div>
          <div className="mji-parts">{parts.map((x, i) => <div key={x.key} className={"mji-part" + (x.me ? " me" : "")}><b>Run {i + 1} · {x.press}{x.me ? " · this one" : ""}</b><span>{x.what}</span><small>{x.when}</small></div>)}</div>
        </div>}
        {info?.pics.length ? <div className="mji-sec"><div className="mji-l">Mockups<span className="mji-cnt">{info.pics.length}</span></div>
          <div className="mji-grid">{info.pics.map((x) => <a key={x.url} className="mji-mk" href={x.url} target="_blank" rel="noreferrer" title={x.title ? `${x.title}: open full size` : "Open full size"}><img src={x.url} alt={x.title} />{x.title ? <small>{x.title}</small> : null}</a>)}</div>
        </div> : null}
        <div className="mji-two">
          <div className="mji-sec">
            <div className="mji-l">Run time</div>
            <div className="mji-kv">
              <span>Press</span><b>{shortName(c.machine)}{lead(c.machine) ? ` · ${lead(c.machine)}` : ""}<em className="mji-spec">{pressSpec(c.machine)}</em></b>
              <span>Planned</span><b>{first && last ? `${first.day !== nowM.day ? dW(first.day) + " " : ""}${clock(first.start)} – ${last.day !== first.day ? dW(last.day) + " " : ""}${clock(last.end)}` : "—"} · {fmtMin(c.plan?.est ?? est.minutes)}</b>
              {started && <><span>Started</span><b>{started.day !== nowM.day ? dW(started.day) + " " : ""}{clock(started.min)}</b></>}
              {soFar != null && <><span>So far</span><b>{fmtMin(soFar)} of {fmtMin(c.plan?.est ?? est.minutes)} · {soFar - (c.plan?.est ?? est.minutes) > 0 ? `${fmtMin(soFar - (c.plan?.est ?? est.minutes))} over` : "on time"}</b></>}
              {stt === "done" && sl?.finished_at && <><span>Finished</span><b>{when(sl.finished_at)}</b></>}
            </div>
            {soFar != null && <i className="mdy-bar mji-bar"><i style={{ width: `${Math.min(100, Math.round((soFar / Math.max(1, c.plan?.est ?? est.minutes)) * 100))}%` }} /></i>}
          </div>
          {(info?.garments.length || gd) ? <div className="mji-sec"><div className="mji-l">Goods</div><div className="mji-kv">
            {info?.garments.length ? <><span>Garments</span><span className="mji-gl">{info.garments.map(([k, n]) => <Fragment key={k}><b>{k}</b><em>{n}</em></Fragment>)}</span></> : null}
            {ck ? <><span>Counted</span><b>{ck.received} of {ck.expected}{ck.by ? ` · ${ck.by.split(" ")[0]}` : ""} · {tmD(ck.created_at)}</b></> : gd ? <><span>Counted</span><b className="faint">Not yet</b></> : null}
          </div></div> : <div className="mji-sec" />}
        </div>
        {info && info.prints.length > 0 && <div className="mji-sec"><div className="mji-l">Prints · {(info.pcs || c.need.qty).toLocaleString()} pcs</div>
          {info.prints.map((x) => <div key={x.loc + x.inks} className="mji-pr"><b>{x.loc}</b><span className="mji-inks">{(x.inks || "").split(/\s*[,/+]\s*/).filter(Boolean).map((ik0) => { const ik = ik0.replace(/^PMS\s*/i, ""); return <span key={ik0} className="mji-ink"><i style={{ background: colorHex(ik0) || "var(--line)" }} />{ik}</span>; })}</span><span className="faint">{x.colors ? `${x.colors} color${x.colors === 1 ? "" : "s"}` : ""}</span></div>)}
        </div>}
        {moving && <div className="mjp-move">
          <div className="tmx-2 ms-3">
            <label>Machine<select value={mach} onChange={(e) => setMach(e.target.value)}>{options.map((x) => <option key={x.id} value={x.id} disabled={!fits(c.need, x)}>{x.name}{!fits(c.need, x) ? " (can't print it)" : ""}</option>)}</select></label>
            <label>Day<select value={day} onChange={(e) => setDay(e.target.value)}>{[...new Set([c.day, ...days])].sort().map((d) => <option key={d} value={d}>{dayLbl(d)}</option>)}</select></label>
            <label>Start<select value={st} onChange={(e) => setSt(e.target.value)}><option value="auto">After the job before it</option>{times.map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn sm" onClick={() => setMoving(false)}>Cancel</button><button type="button" className="btn sm primary" disabled={same} onClick={() => onMove(m, day, newStart)}>Move it</button></div>
        </div>}
        <div className="mji-links">
          {c.job.kind !== "h" ? <Link className="mji-lk p" href={c.job.href}><InfoIco k="open" />Open job</Link> : c.job.hold ? <Link className="mji-lk p" href={`/shop/orders/${c.job.hold.orderId}`}><InfoIco k="open" />Open the quote</Link> : null}
          {c.job.kind === "o" && c.need.type === "screen" && <button type="button" className={"mji-lk" + (sepsOpen ? " on" : "")} onClick={() => setSepsOpen(!sepsOpen)}><InfoIco k="layers" />Separations</button>}
          {c.job.kind === "o" && <Link className="mji-lk" href={c.job.href + (c.job.href.includes("?") ? "&" : "?") + "tab=prod"}><InfoIco k="img" />Mockup</Link>}
          {c.job.kind === "o" && <button type="button" className="mji-lk" onClick={() => setWo(true)}><InfoIco k="print" />Work order</button>}
          {c.slot && stt !== "done" && (parts.length > 1
            ? <button type="button" className={"mji-lk sp" + (uniting ? " on" : "")} onClick={() => { setUniting(!uniting); setSplitting(null); }}><InfoIco k="unite" />Unite</button>
            : locsOf(c.need).length > 1 ? <button type="button" className={"mji-lk sp" + (splitting ? " on" : "")} onClick={() => { setSplitting(splitting ? null : []); setUniting(false); }}><InfoIco k="split" />Split</button> : null)}
        </div>
        {splitting && <div className="mji-spl">
          <b>Split #{c.job.number} into two runs</b>
          <span className="faint">Pick what runs separately. The rest stays on {shortName(c.machine)}{lead(c.machine) ? ` with ${lead(c.machine)}` : ""}. The same shirts can&apos;t be on two presses at once, so the second run starts when the first is off.</span>
          <div className="mji-locs">{locsOf(c.need).map((l) => { const on = splitting.includes(l), st0 = c.need.steps.find((x) => locKey(x) === l || x.location === l); return <button key={l} type="button" className={on ? "on" : ""} onClick={() => setSplitting(on ? splitting.filter((x) => x !== l) : [...splitting, l])}><b>{l}</b><small>{st0 ? `${st0.colors} color${st0.colors === 1 ? "" : "s"}` : ""}{on ? " · runs separately" : ""}</small></button>; })}</div>
          <label className="mji-fld">Runs on<select value={splitTo} onChange={(e) => setSplitTo(e.target.value)}>{presses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {splitting.length > 0 && splitting.length < locsOf(c.need).length && <div className="mji-res">
            <div><b>Run 1 · {shortName(c.machine)}{lead(c.machine) ? ` · ${lead(c.machine)}` : ""}</b><span>{subNeed(c.need, locsOf(c.need).filter((x) => !splitting.includes(x))).label} · {fmtMin(estimate(s, subNeed(c.need, locsOf(c.need).filter((x) => !splitting.includes(x))), c.machine).minutes)}</span></div>
            <div><b>Run 2 · {presses.find((x) => x.id === splitTo)?.name || ""}</b><span>{subNeed(c.need, splitting).label} · {fmtMin(estimate(s, subNeed(c.need, splitting), s.machines.find((x) => x.id === splitTo) || c.machine).minutes)}</span></div>
          </div>}
          <div className="mji-act"><button type="button" className="btn sm" onClick={() => setSplitting(null)}>Cancel</button><button type="button" className="btn sm mji-pv" disabled={!splitting.length || splitting.length >= locsOf(c.need).length} onClick={() => onSplit(splitting, splitTo)}>Split into 2 runs</button></div>
        </div>}
        {uniting && <div className="mji-spl">
          <b>Put #{c.job.number} back together?</b>
          <span className="faint">The runs become one again on {parts[0]?.press.split(" · ")[0]}, where run 1 is. Anything already printed stays printed.</span>
          <div className="mji-act"><button type="button" className="btn sm" onClick={() => setUniting(false)}>Cancel</button><button type="button" className="btn sm mji-pv" onClick={onUnite}>Unite into 1 run</button></div>
        </div>}
        {sepsOpen && c.job.kind === "o" && <div className="ms-seps"><div className="ms-seps-h"><b>Separations</b><span className="faint">Approved art goes straight to the Separation Center.</span></div><SepRequest orderId={c.job.id} /></div>}
        <div className="mjp-foot"><button type="button" className="linkbtn" onClick={() => setMore(!more)} aria-expanded={more}>More details {more ? "▴" : "▾"}</button><span className="spacer" /><span className="faint mji-tip">Right-click the job to start, finish, count goods or move it</span></div>
        {more && <div className="mjp-more">
          {c.job.kind === "o" && <div className="ms-flagrow">
            <span className="ms-due"><span className="faint">In-hands</span><input type="date" aria-label="In-hands date" value={c.job.due || ""} onChange={(e) => onFlags({ due_date: e.target.value || null })} /></span>
          </div>}
          {segs.length > 1 && <ul className="mjp-segs">{segs.map((g) => <li key={g.part}>{dayLbl(g.day)}, {clockLong(g.start)} – {clockLong(g.end)}</li>)}</ul>}
          <RunTimes s={s} c={c} m={m} est={est} onSaved={onRunTime} />
          {(() => {
            const k = cost(m); if (!k) return null;
            const ot = m.id === c.machine.id ? Math.min(est.minutes, otMin) : 0, reg = est.minutes - ot, mult = s.labor.otMultiplier;
            const total = (reg / 60) * k.perHour + (ot / 60) * k.perHour * mult, rate = `$${k.perHour.toFixed(2).replace(/\.00$/, "")}/hr`;
            return <div className="ms-cost"><b>Labor ${Math.round(total).toLocaleString()}</b><span>{ot ? `${fmtMin(reg)} × ${rate} + ${fmtMin(ot)} overtime × ${mult} ` : `${fmtMin(est.minutes)} × ${rate} `}crew ({k.who.join(", ")})</span></div>;
          })()}
          {log.length > 0 && <ul className="ms-log">{log.map((x) => <li key={x.id}><span>{when(x.at)}</span><span>{ACT[x.action] || x.action}{x.progress != null && x.action !== "done" && x.action !== "not_started" ? ` · ${Math.round(x.progress * 100)}%` : ""}{x.note ? ` · ${x.note}` : ""}</span><span className="faint">{x.by}</span></li>)}</ul>}
        </div>}
        {wo && c.job.kind === "o" && <WorkOrderView orderId={c.job.id} number={c.job.number} onClose={() => setWo(false)} />}
      </div>
    </div>
  );
}

/** the job card's link icons (no emoji) */
function InfoIco({ k }: { k: "open" | "layers" | "img" | "print" | "split" | "unite" }) {
  const d: Record<string, ReactNode> = {
    open: <path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" />,
    layers: <path d="M10 3l8 4-8 4-8-4zM2 11l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.6" />,
    img: <><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5 14l4-4 3 3 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" /></>,
    print: <path d="M5 8V3h10v5M5 14H3V8h14v6h-2M6 12h8v5H6z" fill="none" stroke="currentColor" strokeWidth="1.6" />,
    split: <path d="M10 3v5M10 8l-5 5v4M10 8l5 5v4" fill="none" stroke="currentColor" strokeWidth="1.8" />,
    unite: <path d="M5 3v4l5 5v5M15 3v4l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  };
  return <svg className="mji-i" viewBox="0 0 20 20" aria-hidden>{d[k]}</svg>;
}

/**
 * Downtime / maintenance / someone out, on one machine (or a crew's presses): one day or a stretch of days (vacation),
 * all day or a time window, and how much it still runs: stopped, or at 25–75% (operator out: the press keeps running,
 * jobs just take longer). The calendar blocks or slows that time and moves work around it.
 */
function DownPanel({ machines, crews, init, offs, today, win, me, onClose, onSaved }: { machines: Machine[]; crews: Crew[]; init: { machine?: string; day?: string; start?: number; end?: number; allDay?: boolean; replace?: DayOff }; offs: DayOff[]; today: string; win: [number, number]; me: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [mach, setMach] = useState(init.machine || machines[0]?.id || "");
  const m = machines.find((x) => x.id === mach);
  const crew0 = m?.crew ? crews.find((c) => c.id === m.crew) : undefined;
  // a new entry starts as Maintenance with no one named: it used to start as "Employee out · Juan" on a whole day, so
  // opening it again to look and pressing Save added "Juan out" rows (Nov 9, Nick: Walmart days on Press 4 came back as
  // "Employee out"). Pick Employee out to name who's out.
  const REASONS = ["Maintenance", "Repair", "Cleaning", "Employee out", "Training", "Meeting", "Press closed", "Holiday", "Other"];
  const rp = init.replace, rpWhy = rp ? (rp.employee ? "Employee out" : REASONS.includes(rp.note) ? rp.note : "Other") : "";
  const [reason, setReason] = useState(rpWhy || "Maintenance");
  const [other, setOther] = useState(rpWhy === "Other" ? rp!.note : "");
  const [emp, setEmp] = useState(rp?.employee || "");
  const [from, setFrom] = useState(init.day || today), [to, setTo] = useState(init.day || today);
  const [allDay, setAllDay] = useState(!!init.allDay || init.start == null);
  const start0 = init.start ?? 720;
  const [a, setA] = useState(start0), [b, setB] = useState(init.end ?? Math.min(win[1], start0 + 60));
  const [cap, setCap] = useState(rp ? rp.capacity || 0 : init.allDay && crew0 ? 50 : 0);
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
    // changing an entry: the old one goes, the new one takes its place
    if (init.replace) await createClient().from("production_days_off").delete().eq("id", init.replace.id);
    const r = await createClient().from("production_days_off").insert(rows);
    setBusy(false);
    const when = `${from === to ? dayLbl(from) : `${dayLbl(from)} – ${dayLbl(to)}`}${allDay ? "" : `, ${clockLong(a)} – ${clockLong(b)}`}`;
    onSaved(r.error ? r.error.message : `${empOut ? `${emp.trim()} out` : note}: ${crewWide ? `${leadCrew!.leader}'s press${machines.filter((x) => x.crew === leadCrew!.id).length > 1 ? "es" : ""}` : m.name} ${cap ? `runs at ${cap}%` : "is stopped"} ${when}. The schedule moves around it.`);
  }
  async function remove(id: string) { setBusy(true); await createClient().from("production_days_off").delete().eq("id", id); setBusy(false); onSaved("Removed. That time is back on the schedule."); }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add downtime or maintenance">
        <div className="pp-sheet-h"><b>{rp ? "Change Downtime" : "Add Downtime / Maintenance"}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
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
  const canPay = useCan("pay"); // labor dollars only for people who see pay
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
      soonest: `${desc(soon)}${push(soon)}; adds ${fmtMin(soon.extra || 0)} of overtime/Saturday${canPay ? `, about ${money(soon.cost || 0)} extra labor` : ""}`,
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
  const only = pressOnlyOf(need, m);
  if (only) return `must run on ${only.name.split(" · ")[0]} (set on the production mockup)`;
  if (need.steps.some((st) => flashesFor(st) > 0) && flashesOf(m) === 0) return `needs a flash (underbase or puff): ${shortName(m)} has none working`;
  return `needs ${stationsNeeded(need)} heads (screens + flashes): more than ${shortName(m)} can print, even in two rounds`;
}
/** press header, 24-hour view: when the operator actually clocked in (and out) today */
function ActualCell({ m }: { m: Machine }) {
  const c = m.clock, t = (x: number | null | undefined) => (x == null ? "" : clock(x));
  const [txt, cls, tip]: [ReactNode, string, string] = !c ? ["—", "", "No time clock punches to go by for this crew today"]
    : c.state === "waiting" ? ["Not in yet", "warn", `${c.who} hasn't clocked in: jobs on this press wait until they do`]
    : c.state === "noshow" ? ["No punch", "bad", `${c.who} didn't clock in today`]
    : c.state === "crew" ? [<><em>Crew </em>{t(c.inAt)}</>, "warn", `${c.who} has no punch; ${c.crew?.length ? c.crew.join(" and ") : "the crew"} clocked in at ${t(c.inAt)}`]
    : c.state === "out" ? [`${t(c.inAt)}–${t(c.outAt)}`, "", `${c.who} clocked in at ${t(c.inAt)} and out at ${t(c.outAt)}`]
    : [<><em>In </em>{t(c.inAt)}</>, c.state === "late" ? "warn" : "ok", `${c.who} clocked in at ${t(c.inAt)}${c.state === "late" ? " (late)" : ""}`];
  return <div className={"ms-sa-c act " + cls} title={`${tip} (time clock)`}><i>Actual</i><span>{txt}</span></div>;
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
                              <div className="pl-sum"><b>{fl} heads + load &amp; unload</b><span>{lc.units ? `Flash${lc.units === 1 ? "" : "es"} at ${headsTxt(fx)}` : "No flashes on the press"}{lc.rollers ? ` · roller at ${headsTxt(f.lay.flatMap((s, i) => (s === "roller" ? [i + 1] : [])))}` : ""}{lc.cools ? ` · cool down at ${headsTxt(f.lay.flatMap((s, i) => (s === "cool" ? [i + 1] : [])))}` : ""}{lc.down ? ` · ${lc.down} head${lc.down === 1 ? "" : "s"} down` : ""}{lc.broken ? ` · ${lc.broken} flash${lc.broken === 1 ? "" : "es"} not heating` : ""}</span></div>
                              {pick == null ? <div className="faint pl-hint">Tap a head to move a flash there, or to report it down.</div> : (
                                <div className="pl-pick">
                                  <div className="pl-pick-h">Head {pick + 1}</div>
                                  {([["print", "Printing"], ["flash", "Flash"], ["roller", "Roller (dead screen)"], ["cool", "Cool down (left empty)"], ["down", "Head down"], ["flashdown", "Flash not heating"]] as const).map(([k, l]) => <button key={k} type="button" className={"pl-opt " + k + (f.lay![pick] === k ? " on" : "")} onClick={() => setHead(pick, k)}><i aria-hidden />{l}</button>)}
                                </div>
                              )}
                              <div className="pl-key"><span><i className="print" />Printing</span><span><i className="flash" />Flash</span><span><i className="roller" />Roller</span><span><i className="cool" />Cool down</span><span><i className="down" />Down</span><span><i className="load" />Load / unload</span></div>
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
  const canPay = useCan("pay"); // the wage and labor dollars only for people who see pay
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
          <div className="faint" style={{ fontSize: 12.5 }}>{lateBefore} job{lateBefore === 1 ? "" : "s"} won&apos;t make {lateBefore === 1 ? "its" : "their"} in-hands date as planned. Each option below is a full re-plan with that change. Labor figured at crews of {labor.crewSize}{canPay ? `, $${labor.wage}/hr` : ""}, {labor.otMultiplier}× for extra hours (Settings → Production).</div>
          <div className={"ms-adv-ai " + aiState}>
            <span className="ms-adv-i" aria-hidden>✦</span>
            {aiState === "loading" && <div><b>Thinking it over…</b><span>Comparing the options.</span></div>}
            {aiState === "done" && ai && <div>
              <b>{ai.headline}</b><span>{ai.why}</span>
              {!!ai.runnersUp?.length && <ul>{ai.runnersUp.map((r) => byId(r.id) ? <li key={r.id}><b>{byId(r.id)!.title}:</b> {r.why}</li> : null)}</ul>}
              {!!ai.ideas?.length && <ul className="ideas">{ai.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>}
            {(aiState === "off" || aiState === "error") && fallback && <div>
              <b>{fallback.lateAfter === 0 ? `Cheapest fix: ${fallback.title}${fallback.cost && canPay ? ` (~${money(fallback.cost)})` : ""}. Everything makes its date.` : `Best available: ${fallback.title}. ${fallback.lateAfter} still late (${fallback.stillLate.join(", ")}).`}</b>
              <span>{aiState === "off" ? `AI advice is off${aiMsg ? `: ${aiMsg}` : ""}.` : `AI advice didn't come back (${aiMsg}).`} This is the planner&apos;s own pick.</span>
            </div>}
          </div>
          <div className="ms-adv-l">
            {opts.map((o) => (
              <div key={o.id} className={"ms-adv-r" + (o.id === pickId ? " pick" : "") + (o.lateAfter === 0 ? " ok" : "")}>
                <div className="ms-adv-t"><b>{o.title}{o.id === pickId ? <em>Recommended</em> : null}</b><small>{o.detail}{o.splits ? ` · ${o.splits} job${o.splits === 1 ? "" : "s"} split` : ""}</small></div>
                <div className="ms-adv-n"><b className={o.lateAfter ? "bad" : "good"}>{o.lateAfter ? `${o.lateAfter} late` : "All on time"}</b><small>{o.lateAfter ? o.stillLate.slice(0, 4).join(", ") + (o.stillLate.length > 4 ? "…" : "") : `was ${lateBefore}`}</small></div>
                <div className="ms-adv-n"><b>{!canPay ? (o.addedHours ? "Extra hours" : "No extra cost") : o.cost ? `~${money(o.cost)}` : "$0"}</b><small>{o.addedHours ? `${o.addedHours} press-hrs extra` : "no extra hours"}</small></div>
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
                  <span className="ms-ci-j"><b>{c.job.hold ? "HOLD #" : "#"}{c.job.number}</b> {who(c.job)}<small className="faint">{c.need.label}{first ? ` · planned ${clock(first.start)}` : ""}</small></span>
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

/** the scheduling tools' small line icons */
const SK: Record<string, string> = {
  replan: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4", prog: "M4 19h16M6 15l4-4 3 3 5-6", late: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  ot: "M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9v4l2 1M9 2h6", norm: "M4 6h16M4 12h10M4 18h6", shift: "M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 20c0-3 3-5 6-5s6 2 6 5M18 8v6m-3-3h6",
  down: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z", eq: "M3 7h18v10H3zM7 7V4h10v3M7 17v3h10v-3",
  when: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M12 14v3", plan: "M4 4h16v16H4zM4 9h16M9 9v11",
};
function SkIco({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={SK[d]} /></svg>;
}

/** the right-click's icons (no emoji) */
function RcIco({ k }: { k: "play" | "pause" | "check" | "next" | "undo" | "chev" | "box" | "warn" | "move" | "x" }) {
  const d: Record<string, ReactNode> = {
    play: <path d="M6 4l10 6-10 6z" />, pause: <><rect x="5" y="4" width="3.5" height="12" /><rect x="11.5" y="4" width="3.5" height="12" /></>,
    check: <path d="M4 10l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2.2" />, next: <path d="M4 4l7 6-7 6zM12 4h3v12h-3z" />,
    undo: <><path d="M5 8h7a4 4 0 010 8H8" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 4L4 8l4 4" fill="none" stroke="currentColor" strokeWidth="2" /></>,
    chev: <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" />,
    box: <><path d="M3 6l7-3 7 3v8l-7 3-7-3z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M3 6l7 3 7-3M10 9v8" fill="none" stroke="currentColor" strokeWidth="1.8" /></>,
    move: <path d="M10 2v16M2 10h16M10 2l-3 3M10 2l3 3M10 18l-3-3M10 18l3-3M2 10l3-3M2 10l3 3M18 10l-3-3M18 10l-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />,
    x: <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" />,
    warn: <><path d="M10 3l8 14H2z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M10 8v4M10 14v1.5" stroke="currentColor" strokeWidth="2" /></>,
  };
  return <svg className={"mrc-i " + k} viewBox="0 0 20 20" fill="currentColor" aria-hidden>{d[k]}</svg>;
}

/** the goods mark on a job: a tiny shirt, green counted, amber here not counted, red a problem or not counted and runs
 *  within a day, orange not here yet; cut tight to the shirt so its height is the numbers' height */
function GoodsTee({ k, t }: { k: string; t: string }) {
  return <svg className={"msf-tee " + k} viewBox="1.6 2.1 16.8 15.8" role="img" aria-label={t || undefined}>{t ? <title>{t}</title> : null}<path d="M6 2.5l-4 2.2 1.6 3.3 1.6-.8V17.5h9.6V7.2l1.6.8 1.6-3.3-4-2.2c-.5 1.3-1.7 2-3 2s-2.5-.7-3-2z" /></svg>;
}

/** the press under its name (Nov 12, Nick: "press one is the gauntlet, 12 color"): "Gauntlet III · 12 color" from its name and colors */
function pressSpec(m: Machine) {
  const rest = m.name.split(" · ").slice(1).join(" · ").replace(/\b\d+\s*C\b|\b\d+\s*colou?rs?\b/i, "").replace(/\s+/g, " ").trim();
  if (m.type === "screen") return [rest, `${m.colors} color`].filter(Boolean).join(" · ");
  if (m.type === "embroidery") return rest || `${m.heads} head${m.heads === 1 ? "" : "s"}`;
  return rest || "Heat press";
}
/** when the press's crew clocked in today, at the right end of the press line (Nov 12, Nick: replaces the Actual box) */
function ClockIn({ m }: { m: Machine }) {
  const c = m.clock, t = (x: number | null | undefined) => (x == null ? "" : clock(x));
  if (!c) return <span className="mph-in none" title="No time clock punches for this crew today">—</span>;
  const [txt, cls, tip] = c.state === "waiting" ? ["Not in yet", "none", `${c.who} hasn't clocked in`]
    : c.state === "noshow" ? ["No punch", "bad", `${c.who} didn't clock in today`]
    : c.state === "crew" ? [`Crew in ${t(c.inAt)}`, "warn", `${c.who} has no punch; ${c.crew?.length ? c.crew.join(" and ") : "the crew"} clocked in at ${t(c.inAt)}`]
    : c.state === "out" ? [`${t(c.inAt)}–${t(c.outAt)}`, "none", `${c.who} clocked in at ${t(c.inAt)} and out at ${t(c.outAt)}`]
    : c.state === "late" ? [`In ${t(c.inAt)} · late`, "warn", `${c.who} clocked in late at ${t(c.inAt)}`]
    : [`In ${t(c.inAt)}`, "ok", `${c.who} clocked in at ${t(c.inAt)}`];
  return <span className={"mph-in " + cls} title={`${tip} (time clock)`}>{txt}</span>;
}
