/**
 * Time clock math, shared by the wall clock, the admin pages and the payroll export.
 * Everything is figured in the shop's time zone (America/Chicago). Punches are never deleted: edits keep the
 * original time, and a punch taken back is "voided".
 */
export const TZ = "America/Chicago";

export type Punch = { id: string; employee_id: string; kind: "in" | "out" | "break_start" | "break_end"; at: string; source: string; photo_path?: string | null; note?: string; original_at?: string | null; edited_by?: string | null; voided?: boolean; lat?: number | null; lng?: number | null };
export type Employee = { id: string; first_name: string; last_name: string; email: string; phone: string; staff_email: string | null; department: string; title: string; pay_type: "hourly" | "salary"; color: string; has_pin: boolean; active: boolean; hire_date: string | null; end_date: string | null; uattend_id: string | null; notes: string };
export type Shift = { id: string; employee_id: string; starts_at: string; ends_at: string; station: string; note: string; published: boolean };
export type TimeOff = { id: string; employee_id: string; starts_on: string; ends_on: string; hours: number; kind: "pto" | "sick" | "holiday" | "unpaid"; status: "requested" | "approved" | "denied"; note: string };

export type TimeSettings = {
  /** how often payroll runs; `anchor` is the first day of any one pay period (weekly / every two weeks) */
  period: "weekly" | "biweekly" | "semimonthly";
  anchor: string;
  /** overtime after this many hours in a workweek (federal rule: 40; Texas has no daily overtime) */
  otWeekly: number;
  /** round every punch to the nearest N minutes (0 = exact) */
  rounding: 0 | 5 | 6 | 10 | 15;
  /** minutes after the scheduled start before someone counts as late */
  graceMin: number;
  /** take a photo at every punch on the wall clock */
  photo: boolean;
  /** staff with a login can punch from their phone, only near the shop */
  phone: boolean;
  geo: { lat: number | null; lng: number | null; radiusM: number };
  /** flag anyone still clocked in after this many hours (a forgotten clock-out) */
  longShiftHours: number;
  departments: string[];
};
export const DEFAULT_TIME: TimeSettings = {
  period: "weekly", anchor: "2026-09-28", otWeekly: 40, rounding: 0, graceMin: 5, photo: true, phone: true,
  geo: { lat: null, lng: null, radiusM: 200 }, longShiftHours: 12, departments: ["Production", "Embroidery", "Shipping & Receiving", "Office"],
};
export function mergeTime(d: unknown): TimeSettings {
  const t = (d && typeof d === "object" ? d : {}) as Partial<TimeSettings>;
  return { ...DEFAULT_TIME, ...t, geo: { ...DEFAULT_TIME.geo, ...(t.geo || {}) }, departments: Array.isArray(t.departments) ? t.departments : DEFAULT_TIME.departments };
}

export const fullName = (e: Pick<Employee, "first_name" | "last_name">) => [e.first_name, e.last_name].filter(Boolean).join(" ") || "Unnamed";

/* ---------- dates in the shop's time zone ---------- */

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-09-29" for an instant, in shop time. */
export const localDay = (t: string | number | Date) => dayFmt.format(new Date(t));
/** Minutes past local midnight. */
export function localMinutes(t: string | number | Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  return +(p.find((x) => x.type === "hour")?.value || 0) * 60 + +(p.find((x) => x.type === "minute")?.value || 0);
}
export const timeLabel = (t: string | number | Date) => new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
export function addDays(d: string, n: number) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
/** The instant a shop-local wall time happens ("2026-09-29", 7*60 → 7:00 am Central). */
export function localToIso(day: string, minutes: number) {
  const guess = Date.parse(`${day}T00:00:00Z`) + minutes * 60000;
  // shift by the zone offset at that moment (twice, to settle across a daylight-saving change)
  let t = guess;
  for (let i = 0; i < 2; i++) { const off = localMinutes(t) - (minutes % 1440); const dayOff = daysBetween(day, localDay(t)); t -= (off + dayOff * 1440) * 60000; }
  return new Date(t).toISOString();
}

/** The pay period that contains `day`. */
export function periodOf(s: TimeSettings, day: string): { start: string; end: string } {
  if (s.period === "semimonthly") {
    const [y, m, d] = day.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return d <= 15 ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` } : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  const len = s.period === "biweekly" ? 14 : 7;
  const n = Math.floor(daysBetween(s.anchor, day) / len);
  const start = addDays(s.anchor, n * len);
  return { start, end: addDays(start, len - 1) };
}
/** The workweek (for overtime) containing `day`: 7 days starting on the anchor's weekday. */
export function weekOf(s: TimeSettings, day: string) {
  const n = Math.floor(daysBetween(s.anchor, day) / 7);
  const start = addDays(s.anchor, n * 7);
  return { start, end: addDays(start, 6) };
}

/* ---------- punches → hours ---------- */

export const round = (t: string, mins: number) => (mins ? new Date(Math.round(Date.parse(t) / (mins * 60000)) * mins * 60000).toISOString() : t);

export type Issue = { kind: "missing_out" | "missing_in" | "double_in" | "break_open" | "long"; at: string; text: string };
export type DayHours = { day: string; worked: number; breaks: number; first: string | null; last: string | null; issues: Issue[] };
export type Card = {
  employee_id: string; days: Record<string, DayHours>; worked: number; regular: number; overtime: number; breaks: number;
  pto: number; sick: number; holiday: number; unpaid: number; issues: Issue[];
  /** where they are right now (last punch) */
  state: "out" | "in" | "break"; since: string | null;
};

/** What the next punch can be, given the last one. */
export function nextKinds(last: Punch | null | undefined): Punch["kind"][] {
  if (!last || last.kind === "out") return ["in"];
  if (last.kind === "break_start") return ["break_end", "out"];
  return ["break_start", "out"];
}
export const stateOf = (last: Punch | null | undefined): Card["state"] => (!last || last.kind === "out" ? "out" : last.kind === "break_start" ? "break" : "in");

/**
 * Hours for one person over [start, end] (shop-local days). Worked time is split by day at the punch-in's day;
 * overtime is per workweek over `otWeekly` hours. Time off counts as paid hours but not toward overtime.
 * `now` closes a shift that's still open (so today's hours show as they accrue).
 */
export function timecard(s: TimeSettings, employeeId: string, punchesIn: Punch[], offs: TimeOff[], start: string, end: string, now = new Date().toISOString()): Card {
  const punches = punchesIn.filter((p) => !p.voided && p.employee_id === employeeId).map((p) => ({ ...p, at: round(p.at, s.rounding) })).sort((a, b) => a.at.localeCompare(b.at));
  const days: Record<string, DayHours> = {};
  const dayRec = (d: string) => (days[d] ||= { day: d, worked: 0, breaks: 0, first: null, last: null, issues: [] });
  const issues: Issue[] = [];
  const flag = (i: Issue) => { issues.push(i); dayRec(localDay(i.at)).issues.push(i); };
  let open: string | null = null, openDay = "", breakAt: string | null = null;
  const add = (from: string, to: string) => { const m = Math.max(0, (Date.parse(to) - Date.parse(from)) / 60000); dayRec(openDay).worked += m; };
  for (const p of punches) {
    const d = localDay(p.at);
    const rec = dayRec(d);
    rec.first = rec.first && rec.first < p.at ? rec.first : p.at;
    rec.last = rec.last && rec.last > p.at ? rec.last : p.at;
    if (p.kind === "in") {
      if (open || breakAt) flag({ kind: "double_in", at: p.at, text: "Clocked in again without clocking out" });
      open = p.at; openDay = d; breakAt = null;
    } else if (p.kind === "break_start") {
      if (!open) { flag({ kind: "missing_in", at: p.at, text: "Break started without a clock-in" }); continue; }
      add(open, p.at); open = null; breakAt = p.at;
    } else if (p.kind === "break_end") {
      if (!breakAt) { flag({ kind: "missing_in", at: p.at, text: "Break ended without a break start" }); open = p.at; openDay ||= d; continue; }
      dayRec(openDay).breaks += (Date.parse(p.at) - Date.parse(breakAt)) / 60000; breakAt = null; open = p.at;
    } else if (p.kind === "out") {
      if (breakAt) { flag({ kind: "break_open", at: p.at, text: "Clocked out while on break" }); breakAt = null; continue; }
      if (!open) { flag({ kind: "missing_in", at: p.at, text: "Clocked out without a clock-in" }); continue; }
      add(open, p.at); open = null;
    }
  }
  // still clocked in (or on break)
  const last = punches[punches.length - 1] || null;
  if (open) {
    const hrs = (Date.parse(now) - Date.parse(open)) / 3600000;
    if (openDay < localDay(now) || hrs > s.longShiftHours) flag({ kind: hrs > s.longShiftHours ? "long" : "missing_out", at: open, text: openDay < localDay(now) ? "No clock-out" : `Clocked in over ${s.longShiftHours} hours` });
    if (openDay === localDay(now) && hrs <= s.longShiftHours) add(open, now); // today's hours so far
  }
  // keep only the days in range
  for (const k of Object.keys(days)) if (k < start || k > end) delete days[k];
  // overtime by workweek
  let worked = 0, overtime = 0, breaks = 0;
  const byWeek: Record<string, number> = {};
  for (const d of Object.values(days).sort((a, b) => a.day.localeCompare(b.day))) {
    worked += d.worked; breaks += d.breaks;
    const w = weekOf(s, d.day).start;
    const before = byWeek[w] || 0, after = before + d.worked;
    const cap = s.otWeekly * 60;
    overtime += Math.max(0, after - Math.max(cap, before));
    byWeek[w] = after;
  }
  // time off in range (approved)
  const off = { pto: 0, sick: 0, holiday: 0, unpaid: 0 };
  for (const o of offs) {
    if (o.employee_id !== employeeId || o.status !== "approved") continue;
    const total = daysBetween(o.starts_on, o.ends_on) + 1;
    for (let i = 0; i < total; i++) { const d = addDays(o.starts_on, i); if (d >= start && d <= end) off[o.kind] += (+o.hours || 0) / total * 60; }
  }
  return {
    employee_id: employeeId, days, worked, overtime, regular: worked - overtime, breaks, ...off,
    issues: issues.filter((i) => localDay(i.at) >= start && localDay(i.at) <= end),
    state: stateOf(last), since: last && last.kind !== "out" ? last.at : null,
  };
}

/** "7:45" style hours from minutes. */
export const hm = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
/** "7.75" decimal hours (what payroll wants). */
export const dec = (min: number) => (Math.round((min / 60) * 100) / 100).toFixed(2);

/** Distance in meters between two points (for phone punching near the shop). */
export function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const KIND_LABEL: Record<Punch["kind"], string> = { in: "Clock In", out: "Clock Out", break_start: "Start Break", break_end: "End Break" };
