/**
 * Fermentation autopilot (Nick, Nov 24 2026): walks a batch through its fermentation steps from its Tilt readings and the
 * clock, says what the chamber's setpoint should be, and raises alarms (temperatures out of range, a chamber off its
 * setpoint, a silent Tilt, a stalled fermentation, time to spund). Pure: the cron (app/api/cron/draftpunk) loads the
 * readings, calls decide(), and does the setting, logging and emailing.
 */
import { calcRecipe, r1, sgFmt, spundPlan } from "./calc";
import type { FermStep, Recipe } from "./types";

export type Reading = { sg: number | null; temp_f: number | null; set_f?: number | null; source: string; read_at: string };
export type AutoState = { on: boolean; stage: number; stageStart: string; startedAt: string; events: { at: string; text: string }[]; lastAlert?: Record<string, string> };
export type Alarm = { key: string; text: string };
export type Decision = { stage: number; step?: FermStep; targetF?: number; advanced?: string; done: boolean; alarms: Alarm[]; progress: number; sg?: number; fg: number; og?: number };

/** setpoints autopilot will ever send */
export const SAFE_MIN_F = 28, SAFE_MAX_F = 80;
export const clampSet = (f: number) => Math.min(SAFE_MAX_F, Math.max(SAFE_MIN_F, Math.round(f)));

const hrs = (a: string, b: string | number) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;

/** ready-made schedules */
export const FERMENT_PRESETS: { name: string; steps: FermStep[] }[] = [
  { name: "Ale, free-rise diacetyl rest", steps: [
    { name: "Primary", days: 4, tempF: 66, until: "progress", untilVal: 75 },
    { name: "Diacetyl rest", days: 3, tempF: 70, until: "stable", untilVal: 48 },
    { name: "Cold crash", days: 2, tempF: 34, until: "days" } ] },
  { name: "Lager with diacetyl rest", steps: [
    { name: "Primary", days: 7, tempF: 50, until: "progress", untilVal: 65 },
    { name: "Diacetyl rest", days: 3, tempF: 64, until: "stable", untilVal: 48 },
    { name: "Step down", days: 2, tempF: 45, until: "days" },
    { name: "Lager", days: 21, tempF: 34, until: "days" } ] },
  { name: "Pressure lager (Fermzilla)", steps: [
    { name: "Primary under pressure", days: 6, tempF: 64, psi: 12, until: "near_fg", untilVal: 4 },
    { name: "Spund and finish", days: 3, tempF: 66, psi: 25, until: "stable", untilVal: 48 },
    { name: "Cold crash and lager", days: 14, tempF: 34, psi: 25, until: "days" } ] },
  { name: "Hazy IPA (dry hop at the end)", steps: [
    { name: "Primary", days: 3, tempF: 66, until: "near_fg", untilVal: 6 },
    { name: "Finish and dry hop", days: 3, tempF: 68, until: "stable", untilVal: 36 },
    { name: "Cold crash", days: 2, tempF: 34, until: "days" } ] },
  { name: "Kveik, hot", steps: [
    { name: "Primary", days: 3, tempF: 90, until: "stable", untilVal: 24 },
    { name: "Cold crash", days: 2, tempF: 34, until: "days" } ] },
];

/** a step's "moves on when" in words */
export function untilText(s: FermStep) {
  switch (s.until) {
    case "progress": return `when it's ${s.untilVal ?? 75}% of the way to FG`;
    case "near_fg": return `within ${s.untilVal ?? 3} points of FG`;
    case "stable": return `when gravity holds for ${s.untilVal ?? 48} h`;
    default: return `after ${s.days} days`;
  }
}

export function decide(r: Recipe, st: AutoState, tilt: Reading[], chamber: Reading[], opts: { og?: number; now?: number; beerTolF?: number; chamberTolF?: number }): Decision {
  const now = opts.now ?? Date.now();
  const fg = calcRecipe(r).fg;
  const steps = r.ferment;
  const grav = tilt.filter((x) => x.sg != null) as (Reading & { sg: number })[];
  const last = grav[grav.length - 1];
  const og = opts.og || grav[0]?.sg;
  const progress = og && last ? Math.max(0, Math.min(1.5, (og - last.sg) / Math.max(og - fg, 0.001))) * 100 : 0;
  let stage = Math.min(st.stage, Math.max(steps.length - 1, 0));
  let advanced: string | undefined;
  const step = steps[stage];
  if (step && stage < steps.length - 1) {
    const inStage = hrs(st.stageStart, now);
    const since = grav.filter((x) => new Date(x.read_at).getTime() >= new Date(st.stageStart).getTime());
    let go = false, why = "";
    if (!step.until || step.until === "days") { go = inStage >= step.days * 24; why = `${step.days} days done`; }
    else if (step.until === "progress" && last) { go = progress >= (step.untilVal ?? 75); why = `${r1(progress, 0)}% of the way to FG (${sgFmt(last.sg)})`; }
    else if (step.until === "near_fg" && last) { go = last.sg <= fg + (step.untilVal ?? 3) / 1000; why = `${sgFmt(last.sg)} is within ${step.untilVal ?? 3} points of FG`; }
    else if (step.until === "stable" && last) {
      const h = step.untilVal ?? 48;
      const old = since.filter((x) => hrs(x.read_at, last.read_at) >= h).pop();
      go = !!old && Math.abs(old.sg - last.sg) <= 0.001; why = `gravity steady at ${sgFmt(last.sg)} for ${h} h`;
    }
    if (go) { stage += 1; const nx = steps[stage]; advanced = `${step.name} → ${nx.name}: ${why}${nx.psi && nx.psi !== step.psi ? `. Set the spunding valve to ${nx.psi} PSI` : ""}`; }
  }
  const cur = steps[stage];
  const targetF = cur ? clampSet(cur.tempF) : undefined;

  // alarms
  const alarms: Alarm[] = [];
  const beerTol = opts.beerTolF ?? 4, chTol = opts.chamberTolF ?? 5;
  const tl = tilt.slice(-3);
  if (targetF != null && tl.length >= 2 && !advanced) {
    const t = tl.map((x) => x.temp_f).filter((v): v is number => v != null);
    // allow a day to reach a new step's temperature before calling it out of range
    if (t.length >= 2 && hrs(st.stageStart, now) > 24 && t.every((v) => Math.abs(v - targetF) > beerTol))
      alarms.push({ key: "beer-temp", text: `Beer is ${r1(t[t.length - 1], 1)}°F; ${cur!.name} wants ${targetF}°F (±${beerTol}).` });
  }
  const cl = chamber.slice(-4);
  if (cl.length >= 3 && cl.every((x) => x.temp_f != null && x.set_f != null && Math.abs(x.temp_f! - x.set_f!) > chTol) && hrs(cl[0].read_at, cl[cl.length - 1].read_at) >= 1)
    alarms.push({ key: "chamber-off", text: `Chamber is ${r1(cl[cl.length - 1].temp_f!, 1)}°F but set to ${cl[cl.length - 1].set_f}°F for over an hour.` });
  if (tilt.length && hrs(tilt[tilt.length - 1].read_at, now) > 2)
    alarms.push({ key: "tilt-quiet", text: `No Tilt reading for ${r1(hrs(tilt[tilt.length - 1].read_at, now), 0)} hours (battery, range, or the phone/TiltPi logging stopped).` });
  if (last && progress < 90) {
    const dayTwo = grav.filter((x) => hrs(x.read_at, last.read_at) >= 48).pop();
    if (dayTwo && Math.abs(dayTwo.sg - last.sg) <= 0.001 && last.sg > fg + 0.004) alarms.push({ key: "stalled", text: `Gravity has sat at ${sgFmt(last.sg)} for 2 days, still ${r1((last.sg - fg) * 1000, 0)} points above the expected FG.` });
  }
  if (r.carb.method === "spund" && last) {
    const sp = spundPlan(fg, r.carb.vols, Math.max(...steps.map((s) => s.tempF), 60), r.carb.spundPts);
    if (last.sg <= sp.capSg + 0.0005 && last.sg > fg - 0.002) alarms.push({ key: "spund", text: `Time to spund: ${sgFmt(last.sg)}. Set the valve to ${r1(sp.psi, 1)} PSI.` });
  }
  return { stage, step: cur, targetF, advanced, done: stage >= steps.length - 1, alarms, progress, sg: last?.sg, fg, og };
}
