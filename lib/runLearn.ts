import type { Machine, ProductionSettings } from "@/lib/production";

/**
 * How fast each press operator really runs (Nov 9, Nick: "you should be learning when people clock in and out… learning
 * by press operator… Miguel will run a job faster than Kelsey… there's got to be a little edit button next to the time").
 *
 * Every run teaches it, for everyone, without anyone ticking anything (run_lessons):
 *  - ran:  a booking marked Finished. Its real time on the press (started → finished, less pauses and lunch; or, when
 *          nobody pressed Start, the operator's own job clock on that order that day) against the standard time.
 *  - said: staff set how long a print location takes (the schedule's edit button): what they know against the standard.
 * An operator's pace is the weighted middle of their latest jobs (a real run counts twice what's said), once there are
 * two; it follows the operator to whichever press they're on. It never touches a time staff set.
 */
export type RunLesson = { operator: string | null; crew_id: string | null; kind: "ran" | "said"; est_min: number; real_min: number; created_at: string };

export const PACE_AFTER = 2; // jobs before a pace is used
const LATEST = 12;

export function paceOf(lessons: RunLesson[]): { pace: number; n: number } | null {
  const xs = lessons
    .filter((l) => l.est_min >= 10 && l.real_min > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LATEST)
    .map((l) => ({ r: Math.max(0.33, Math.min(3, l.real_min / l.est_min)), w: l.kind === "ran" ? 2 : 1 }));
  if (xs.length < PACE_AFTER) return null;
  // weighted median: one odd job (a press broke) doesn't swing it
  xs.sort((a, b) => a.r - b.r);
  const half = xs.reduce((t, x) => t + x.w, 0) / 2;
  let acc = 0, mid = xs[0].r;
  for (const x of xs) { acc += x.w; if (acc >= half) { mid = x.r; break; } }
  return { pace: Math.round(Math.max(0.5, Math.min(2, mid)) * 100) / 100, n: xs.length };
}

/** the operator on a machine (its crew's Press Operator), and who that is */
export function operatorOf(ps: ProductionSettings, m: Machine): { id: string | null; crew: string | null; who: string } {
  const crew = m.crew ? ps.crews.find((c) => c.id === m.crew) : undefined;
  return { id: crew?.members?.operator || null, crew: crew?.id || null, who: crew?.leader || "" };
}

/** each machine with its operator's learned pace */
export function withPace(ps: ProductionSettings, lessons: RunLesson[]): ProductionSettings {
  return {
    ...ps,
    machines: ps.machines.map((m) => {
      const op = operatorOf(ps, m);
      const mine = lessons.filter((l) => (op.id ? l.operator === op.id : !!op.crew && l.crew_id === op.crew));
      const p = op.id || op.crew ? paceOf(mine) : null;
      return p ? { ...m, pace: p.pace, paceN: p.n, paceWho: op.who } : { ...m, paceN: mine.length, paceWho: op.who };
    }),
  };
}

/**
 * How long, as people type or say it → minutes (null if it can't tell): "3h 30m", "3:30", "3.5", "3.5h", "1h30", "1 hr 30",
 * "90 min", "210", "1 1/2", "1½", "1,5", "an hour and a half", "10 hours and a half", "half an hour" (Nov 13, Nick:
 * "1.5 hours… it doesn't save half the time").
 */
export function parseDuration(t: string): number | null {
  let x = t.trim().toLowerCase().replace(/,/g, ".").replace(/½/g, ".5").replace(/\s+1\/2\b/g, ".5").replace(/\s+/g, " ");
  if (!x) return null;
  x = x.replace(/^half (an )?hour$/, "30m").replace(/\ban? hour\b/g, "1 hour")
    .replace(/(\d+(?:\.\d+)?) ?(?:h|hrs?|hours?)? and a half(?: ?(?:h|hrs?|hours?))?/g, (_, n) => `${+n + 0.5}h`);
  let m: RegExpMatchArray | null;
  if ((m = x.match(/^(\d{1,2}):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  // a bare number: hours up to 24 ("1.5", "3"), minutes past that ("210")
  if ((m = x.match(/^(\d+(?:\.\d+)?)$/))) { const n = +m[1]; return n <= 24 ? Math.round(n * 60) : Math.round(n); }
  if ((m = x.match(/^(?:(\d+(?:\.\d+)?) ?(?:h|hrs?|hours?)\.?)? ?(?:(\d+) ?(?:m|mins?|minutes?)?\.?)?$/)) && (m[1] || m[2])) return Math.round(+(m[1] || 0) * 60 + +(m[2] || 0));
  return null;
}
