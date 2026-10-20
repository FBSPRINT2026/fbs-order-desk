import { addDays, fullName, localDay, localMinutes, timeLabel, timecard, withLunch, dayLabel, type Employee, type Punch, type TimeSettings } from "@/lib/timeclock";

/**
 * Time clock issues for the people who run it (Nick, Oct 20: "a little notification… hey, one issue, Joanna clocked in
 * yesterday and never clocked out"). Worked out in the browser from the punches, for the bubble on every shop page and
 * the Today board:
 *  - no clock-out on an earlier day (or still in after the long-shift limit)
 *  - a punch that doesn't fit (out with no in, back from break with no break…)
 *  - no lunch: a finished day of 6+ hours with just an in and an out (can be marked "they didn't take one")
 * Each comes with the fix it most likely needs, so one tap puts it right.
 */
export type TimeIssue = {
  key: string; employee_id: string; name: string; first: string; day: string;
  kind: "no_out" | "odd" | "no_lunch";
  text: string;
  /** the likely fix: add a clock-out (time to suggest, "HH:MM"), or a lunch (start "HH:MM", minutes) */
  fix?: { type: "out"; time: string } | { type: "lunch"; start: string; minutes: number };
};

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const dayWord = (day: string, today: string) => (day === today ? "today" : day === addDays(today, -1) ? "yesterday" : `on ${dayLabel(day)}`);

/** issues from `from` (shop day) through today; `dismissed` = keys someone marked as fine */
export function timeIssues(s: TimeSettings, employees: Employee[], punches: Punch[], from: string, dismissed: Set<string> = new Set(), now = new Date()): TimeIssue[] {
  const today = localDay(now);
  const out: TimeIssue[] = [];
  const ids = new Set([...employees.filter((e) => e.active).map((e) => e.id), ...punches.map((p) => p.employee_id)]);
  for (const e of employees) {
    if (!ids.has(e.id)) continue;
    const mine = punches.filter((p) => p.employee_id === e.id && !p.voided);
    if (!mine.length) continue;
    const c = timecard(s, e.id, mine, [], from, today, now.toISOString());
    const name = fullName(e), first = e.first_name || name;
    for (const i of c.issues) {
      const day = localDay(i.at);
      if (i.kind === "missing_out" || i.kind === "long") {
        // suggest the clock-out they usually have, else 8½ hours after they came in (not past 11 PM)
        const usual = mine.filter((p) => p.kind === "out" && localDay(p.at) !== day).map((p) => localMinutes(p.at)).sort((a, b) => a - b);
        const mid = usual.length ? usual[Math.floor(usual.length / 2)] : Math.min(23 * 60, localMinutes(i.at) + 510);
        out.push({ key: `out:${e.id}:${day}`, employee_id: e.id, name, first, day, kind: "no_out",
          text: i.kind === "long" && day === today ? `${first} has been clocked in since ${timeLabel(i.at)} (over ${s.longShiftHours} hours)` : `${first} clocked in ${dayWord(day, today)} at ${timeLabel(i.at)} and never clocked out`,
          fix: { type: "out", time: hhmm(Math.max(mid, localMinutes(i.at) + 30)) } });
      } else {
        out.push({ key: `odd:${e.id}:${i.at}`, employee_id: e.id, name, first, day, kind: "odd", text: `${first} ${dayWord(day, today)}: ${i.text.charAt(0).toLowerCase() + i.text.slice(1)} (${timeLabel(i.at)})` });
      }
    }
    // no lunch on a finished day: exactly one in and one out, 6 hours or more
    for (const [day, d] of Object.entries(c.days)) {
      if (day >= today || d.worked < 360 || d.breaks > 0) continue;
      const dayPs = withLunch(mine.filter((p) => localDay(p.at) === day));
      if (dayPs.length !== 2 || dayPs[0].kind !== "in" || dayPs[1].kind !== "out") continue;
      const key = `lunch:${e.id}:${day}`;
      if (dismissed.has(key)) continue;
      const a = localMinutes(dayPs[0].at), b = localMinutes(dayPs[1].at);
      // noon when they were working then, else the middle of the day, on the half hour
      const start = a <= 12 * 60 - 30 && b >= 12 * 60 + 90 ? 12 * 60 : Math.round(((a + b) / 2) / 30) * 30;
      out.push({ key, employee_id: e.id, name, first, day, kind: "no_lunch", text: `${first} didn't punch out for lunch ${dayWord(day, today)} (${timeLabel(dayPs[0].at)} – ${timeLabel(dayPs[1].at)})`, fix: { type: "lunch", start: hhmm(start), minutes: 30 } });
    }
  }
  const rank = { no_out: 0, odd: 1, no_lunch: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
}
