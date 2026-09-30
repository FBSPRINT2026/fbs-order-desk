/**
 * Production scheduling: our machines, the time standards used to figure how long a job takes, the estimate itself,
 * and the "where should this go" suggestion. All numbers live in Settings → Production and can be tuned; they start
 * from industry averages (see the notes on each) and get corrected from the shop's own job-time logs.
 */
import type { Group, Order } from "@/lib/pricing";

export type MachineType = "screen" | "embroidery" | "heat";
export type Machine = {
  id: string; name: string; type: MachineType;
  /** screen: print heads / colors it can run; embroidery: heads (pieces sewn at once) */
  colors: number; heads: number;
  /** when its day starts (minutes after midnight, 420 = 7:00 AM), hours it runs a day, and which days (0 = Sunday) */
  startMin: number; hoursPerDay: number; days: number[];
  /** Printavo status text that puts a job on this machine (until go-live), e.g. "Press 1" */
  pvMatch: string;
  active: boolean;
  /** this machine's own speed vs the standard (1 = standard, 1.2 = 20% faster) */
  speed: number;
  /** the crew that runs it (Settings → Production → Crews); its hours replace the machine's own */
  crew?: string;
  /** worked out when settings load: this machine's hours for each weekday (0 = Sunday), [start, end] minutes, null = off */
  week?: Shift[];
  /** warm-up / lunch for this machine (its crew's lunch time), worked out when settings load */
  brk?: Breaks;
  /** how its crew runs vs the standard (setup, printing, darks…), worked out when settings load */
  skill?: CrewSkill;
  /** dates it isn't running (its crew's or its own days off), attached by the calendar */
  off?: Record<string, string>;
  /** downtime or reduced capacity for part of a day: date → [start, end, why, rate][], rate 0 = stopped,
   *  0.5 = running at half speed (operator out: jobs take twice as long). Attached by the calendar. */
  down?: Record<string, Down[]>;
  /** extra shifts outside the regular schedule (a Saturday 10–2): date → [start, end], attached by the calendar */
  extra?: Record<string, [number, number]>;
};
/** [start, end, why, rate]: minutes after midnight; rate = the share of normal speed (0 = stopped) */
export type Down = [number, number, string, number];
/** [start, end] in minutes after midnight (300 = 5:00 AM, 900 = 3:00 PM) */
export type Shift = [number, number] | null;
/** A press crew and its leader's schedule (hours for each weekday, 0 = Sunday; null = off that day). */
/** Who's on a press crew (employee ids): the press operator runs it, an assistant, and a catcher at the dryer. */
export type CrewMembers = { operator?: string | null; assistant?: string | null; catcher?: string | null };
export const CREW_ROLES: [keyof CrewMembers, string][] = [["operator", "Press Operator"], ["assistant", "Assistant"], ["catcher", "Catcher"]];
/**
 * How a press crew runs compared with the shop standard, per kind of work: 100 = standard, 120 = 20% faster, 80 = 20%
 * slower (Employees → People & Teams → Press Crews sliders). A crew can print fast but set up slow.
 */
export type CrewSkill = { setup: number; teardown: number; run: number; long: number; short: number; dark: number; colors: number };
export const DEFAULT_SKILL: CrewSkill = { setup: 100, teardown: 100, run: 100, long: 100, short: 100, dark: 100, colors: 100 };
export const SKILLS: [keyof CrewSkill, string, string][] = [
  ["setup", "Setup", "registering screens, loading the press"],
  ["teardown", "Teardown", "pulling screens, cleanup"],
  ["run", "Printing speed", "pieces an hour once it's running"],
  ["long", "Long runs", "keeping pace on 500+ piece runs"],
  ["short", "Short runs", "quick turnaround on runs under 150"],
  ["dark", "Darks & underbase", "flashing, white underbase"],
  ["colors", "Many colors", "6+ color jobs: setup and print"],
];
export const LONG_RUN = 500, SHORT_RUN = 150;
export type Crew = { id: string; leader: string; week: Shift[]; skill?: CrewSkill; /** lunch start (minutes after midnight), default the shop's */ lunchAt?: number; members?: CrewMembers };
/** Built into every shift: press warm-up at the start, and a lunch break on long shifts. */
export type Breaks = { warmupMin: number; lunchMin: number; lunchAfterHours: number; lunchAt: number; /** warming the press back up after lunch */ rewarmMin: number };
/** What an hour of press time costs in labor, for weighing overtime / weekend shifts when the schedule is tight. */
export type Labor = { crewSize: number; wage: number; otMultiplier: number };
export const DEFAULT_LABOR: Labor = { crewSize: 3, wage: 17, otMultiplier: 1.5 };
export const DEFAULT_BREAKS: Breaks = { warmupMin: 30, lunchMin: 30, lunchAfterHours: 8, lunchAt: 720, rewarmMin: 10 };
export type ProductionSettings = {
  machines: Machine[];
  crews: Crew[];
  screen: {
    /** minutes to set up (register) one screen, and to tear it down — industry rule of thumb 5 and 3 */
    setupPerScreen: number; teardownPerScreen: number;
    /** pieces an hour on an automatic press for a simple (1–2 color) light-shirt job — planning figure 400 */
    baseRate: number;
    /** each color past 4 slows it this much (flashes, more stations to clear) */
    perExtraColor: number;
    /** darks: add a white underbase screen, and run this fraction of the speed (flash) */
    underbaseOnDark: boolean; darkFactor: number;
    /** puff ink: print at this fraction of the speed (thick stencil, extra strokes, careful flash), and set up this many times longer */
    puffFactor: number; puffSetupFactor: number;
    /** hoodies / jackets / fleece, and totes / bags run slower (loading) */
    heavyFactor: number; bagFactor: number;
    /** pockets, sleeves, necks, legs: fiddly locations */
    smallLocFactor: number;
    /** never schedule less than this for one location */
    minMinutes: number;
  };
  embroidery: {
    /** stitches a minute we actually run (flats / caps) — machines are rated 1,000–1,200 but shops run ~600–800 */
    spmFlat: number; spmCap: number;
    /** seconds to swap a hooped garment and start, per run; 0 when someone pre-hoops */
    hoopSecs: number;
    /** seconds per trim / color change, and an average count per design */
    trimSecs: number; trimsPerDesign: number;
    /** thread breaks and fixes: minutes per 10,000 stitches */
    breakMinPer10k: number;
    /** job setup (frames, threading, test sew) and each extra location */
    setupMin: number; extraLocationSetupMin: number;
    /** stitches when the order doesn't say */
    stitches: Record<string, number>;
  };
  heat: { secsPerPiece: number; setupMin: number };
  /** plan this many business days before the in-hands date (packing, shipping) */
  bufferDays: number;
  /** the shop's regular turnaround: business days from order to in-hands */
  turnDays: number;
  breaks: Breaks;
  labor: Labor;
  /** fill a machine's day to this share before suggesting the next day (85% keeps room for surprises) */
  fillTarget: number;
  /** the shop's measured speed vs these standards (from job-time logs): minutes × factor */
  factor: Record<MachineType, number>;
};

const WEEKDAYS = [1, 2, 3, 4, 5];
const m = (id: string, name: string, type: MachineType, colors: number, heads: number, pvMatch: string): Machine => ({ id, name, type, colors, heads, startMin: 420, hoursPerDay: 11, days: WEEKDAYS, pvMatch, active: true, speed: 1 });
/** a crew working the same hours Monday–Friday */
const crew = (id: string, leader: string, start: number, end: number): Crew => ({ id, leader, week: [0, 1, 2, 3, 4, 5, 6].map((d): Shift => (d >= 1 && d <= 5 ? [start, end] : null)) });
export const DEFAULT_PRODUCTION: ProductionSettings = {
  crews: [
    crew("c-miguel", "Miguel", 390, 960), // 6:30 AM – 4 PM
    crew("c-ana", "Ana", 360, 900), // 6 AM – 3 PM
    crew("c-kelsey", "Kelsey", 360, 870), // 6 AM – 2:30 PM
    crew("c-juan", "Juan", 420, 930), // 7 AM – 3:30 PM
  ],
  machines: [
    { ...m("p1", "Press 1 · 12C Gauntlet III", "screen", 12, 1, "Press 1"), crew: "c-miguel" },
    { ...m("p2", "Press 2 · 8C Sportsman", "screen", 8, 1, "Press 2"), crew: "c-ana" },
    { ...m("p3", "Press 3 · 8C Sportsman", "screen", 8, 1, "Press 3"), crew: "c-kelsey" },
    { ...m("p4", "Press 4 · 10 Color", "screen", 10, 1, "Press 4"), crew: "c-juan" },
    m("e12", "Embroidery · 12 Head", "embroidery", 15, 12, "12 Head"),
    m("e6", "Embroidery · 6 Head", "embroidery", 15, 6, "6 Head"),
    m("e4", "Embroidery · 4 Head", "embroidery", 15, 4, "4 Head"),
    m("e1", "Embroidery · Single Head", "embroidery", 15, 1, "Single Head"),
    m("hp", "Heat Press", "heat", 0, 1, ""),
  ],
  screen: { setupPerScreen: 6, teardownPerScreen: 3, baseRate: 400, perExtraColor: 0.04, underbaseOnDark: true, darkFactor: 0.75, puffFactor: 0.7, puffSetupFactor: 1.5, heavyFactor: 0.55, bagFactor: 0.6, smallLocFactor: 0.6, minMinutes: 15 },
  embroidery: {
    spmFlat: 700, spmCap: 600, hoopSecs: 30, trimSecs: 8, trimsPerDesign: 8, breakMinPer10k: 2, setupMin: 15, extraLocationSetupMin: 5,
    stitches: { "Left Chest": 8000, "Right Chest": 8000, "Cap Front": 8000, "Hat Front": 8000, "Full Front": 15000, "Full Back": 30000, "Sleeve": 5000, "Left Sleeve": 5000, "Right Sleeve": 5000, "Back Neck": 4000, "Nape": 4000, "Pocket": 6000, "default": 8000 },
  },
  heat: { secsPerPiece: 45, setupMin: 10 },
  bufferDays: 1,
  turnDays: 10,
  breaks: DEFAULT_BREAKS,
  labor: DEFAULT_LABOR,
  fillTarget: 0.85,
  factor: { screen: 1, embroidery: 1, heat: 1 },
};
export function mergeProduction(d: unknown): ProductionSettings {
  const p = (d && typeof d === "object" ? d : {}) as Partial<ProductionSettings>;
  const crews: Crew[] = (Array.isArray(p.crews) ? p.crews : DEFAULT_PRODUCTION.crews).map((c) => ({ id: c.id, leader: c.leader || "", week: Array.from({ length: 7 }, (_, i) => normShift(c.week?.[i])), lunchAt: c.lunchAt, members: c.members || {}, skill: { ...DEFAULT_SKILL, ...(c.skill || {}) } }));
  const breaks: Breaks = { ...DEFAULT_BREAKS, ...(p.breaks || {}) };
  const machines = (Array.isArray(p.machines) && p.machines.length ? p.machines.map((x) => ({ ...m(x.id, x.name, x.type, x.colors, x.heads, x.pvMatch || ""), ...x })) : DEFAULT_PRODUCTION.machines)
    .map((x) => { const c = x.crew ? crews.find((k) => k.id === x.crew) : undefined; return { ...x, crew: c ? c.id : undefined, week: c ? c.week : ownWeek(x), brk: { ...breaks, lunchAt: c?.lunchAt ?? breaks.lunchAt }, skill: c?.skill }; });
  return {
    ...DEFAULT_PRODUCTION, ...p,
    crews, machines, breaks,
    labor: { ...DEFAULT_LABOR, ...(p.labor || {}) },
    screen: { ...DEFAULT_PRODUCTION.screen, ...(p.screen || {}) },
    embroidery: { ...DEFAULT_PRODUCTION.embroidery, ...(p.embroidery || {}), stitches: { ...DEFAULT_PRODUCTION.embroidery.stitches, ...(p.embroidery?.stitches || {}) } },
    heat: { ...DEFAULT_PRODUCTION.heat, ...(p.heat || {}) },
    factor: { ...DEFAULT_PRODUCTION.factor, ...(p.factor || {}) },
  };
}

/* ---------- what a job needs ---------- */

/** One decoration to run: a location on a group of garments. */
export type Step = { method: MachineType; location: string; colors: number; screens: number; qty: number; dark: boolean; garment: "tee" | "heavy" | "bag" | "cap"; stitches: number; note: string; /** puff ink (raised print): slower printing, longer setup */ puff?: boolean };
/** Everything to run on one kind of machine, and the most colors any of it needs. */
export type Need = { type: MachineType; steps: Step[]; needColors: number; qty: number; label: string; /** a hard or easy print: 0.7 = runs at 70% ("When can we print it?" speed) */ speed?: number };

const LIGHT = /\b(white|natural|ash|cream|ivory|light|silver|heather\s*grey|sport\s*grey|pink|yellow|lime|sand|oatmeal|bone|vanilla|butter|mint|sky|baby)\b/i;
const garmentKind = (text: string): Step["garment"] => (/\b(cap|hat|beanie|visor|trucker|snapback)\b/i.test(text) ? "cap" : /\b(tote|bag|backpack|apron)\b/i.test(text) ? "bag" : /\b(hood|hoodie|sweat|crew\s*neck|fleece|jacket|pullover|quarter|zip)\b/i.test(text) ? "heavy" : "tee");
const smallLoc = (loc: string) => /\b(pocket|sleeve|neck|nape|leg|hip|cuff|hood)\b/i.test(loc);
const methodType = (m: string): MachineType => (m === "embroidery" ? "embroidery" : m === "dtf" || m === "dtg" || m === "heat" ? "heat" : "screen");

export function stitchesFor(s: ProductionSettings, location: string, given?: number | null) {
  if (given && given > 0) return given;
  const k = Object.keys(s.embroidery.stitches).find((x) => x.toLowerCase() === location.trim().toLowerCase());
  return s.embroidery.stitches[k || "default"] || 8000;
}

/** What a new order needs, from its groups (garments + imprints). */
export function needsForOrder(s: ProductionSettings, o: Pick<Order, "groups" | "lines" | "number" | "nickname">, groupsIn?: Group[]): Need[] {
  const groups = groupsIn || ((o.groups || []) as Group[]);
  const steps: Step[] = [];
  for (const g of groups) {
    const qty = g.lines.reduce((a, l) => a + Object.values(l.sizes || {}).reduce((b, n) => b + (+(n as number) || 0), 0), 0);
    if (!qty) continue;
    // mixed colors in one group: count it dark if most pieces are dark
    const darkQty = g.lines.reduce((a, l) => a + (LIGHT.test(l.color || "") ? 0 : Object.values(l.sizes || {}).reduce((b, n) => b + (+(n as number) || 0), 0)), 0);
    const garment = garmentKind(g.lines.map((l) => `${l.garment} ${l.style}`).join(" "));
    for (const i of g.imprints || []) {
      const method = methodType(i.method);
      const colors = Math.max(1, Math.min(15, +i.colors || 1));
      const dark = darkQty > qty / 2;
      const screens = method === "screen" ? colors + (dark && s.screen.underbaseOnDark && colors < 11 ? 1 : 0) : 0;
      const puff = method === "screen" && /puff/i.test(`${i.inks || ""} ${i.notes || ""} ${(i as unknown as { size?: string }).size || ""}`);
      steps.push({ method, location: i.location || "Front", colors, screens, qty, dark, garment, stitches: method === "embroidery" ? stitchesFor(s, i.location || "", (i as unknown as { stitches?: number }).stitches) : 0, note: "", puff });
    }
  }
  return groupNeeds(steps);
}

type PvLine = { description?: string; color?: string; items?: number | null; category?: string | null };
type PvImprint = { column?: string; details?: string; typeOfWork?: string };
const title = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const LOCS: [RegExp, string | null][] = [[/left\s*chest/i, "Left Chest"], [/right\s*chest/i, "Right Chest"], [/nape(\s*of\s*(the\s*)?neck)?|back\s*neck/i, "Nape"], [/(left|right)\s*(arm\s*)?sleeve/i, null], [/sleeve/i, "Sleeve"], [/pocket/i, "Pocket"], [/(full\s*)?back/i, "Back"], [/(full\s*)?front/i, "Front"]];
/** Locations named in free text, in the order they appear ("LEFT CHEST AND BACK" → Left Chest, Back). */
function locsIn(text: string): string[] {
  const hits: { at: number; end: number; name: string }[] = [];
  for (const [re, name] of LOCS) {
    const g = new RegExp(re.source, "gi"); let x: RegExpExecArray | null;
    while ((x = g.exec(text))) {
      const at = x.index, end = at + x[0].length;
      if (hits.some((h) => at < h.end && end > h.at)) continue;
      hits.push({ at, end, name: name || title(x[0].replace(/arm\s*/i, "")) });
    }
  }
  return hits.sort((p, q) => p.at - q.at).map((h) => h.name).filter((n, i, all) => all.indexOf(n) === i);
}
/** "3/1 + UNDERBASE", "1/0/1", "0/10 IMPRINT" → colors per location (skips "1/4-Zip" and dates). */
function colorSplit(text: string): number[] | null {
  const m = text.match(/(?<![\d/.])(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{1,2}))?(?![\d/]|\s*-?\s*zip)/i);
  if (!m) return null;
  const n = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return n.every((x) => x <= 15) && n.some((x) => x > 0) ? n : null;
}
const lineMethod = (cat: string, fallback: MachineType): MachineType => (/embroid/i.test(cat) ? "embroidery" : /heat|dtf|transfer|vinyl|dtg/i.test(cat) ? "heat" : /screen/i.test(cat) ? "screen" : fallback);

/**
 * A Printavo order (until go-live). Per line item group: pieces from the lines, the method from the line category
 * (else the status), screens from the imprint column ("2CL / 1CD" = 2 screens: 2 colors on light or 1 + underbase on
 * dark) or from the description ("3/1 + UNDERBASE" → front 3, back 1), locations from the imprint details.
 */
export function needsForPrintavo(s: ProductionSettings, row: { qty: number | null; status_name: string; nickname: string; data?: { groups?: { imprints?: PvImprint[] | null; lines?: PvLine[] | null }[] } | null }): Need[] {
  const st = row.status_name || "";
  const fallback: MachineType = /^emb|embroid/i.test(st) ? "embroidery" : /^hp|heat|dtf|transfer/i.test(st) ? "heat" : "screen";
  const steps: Step[] = [];
  const groups = row.data?.groups || [];
  for (const g of groups) {
    const lines = (g.lines || []).filter((l) => !/^\s*extras?\s*$/i.test(l.description || "") || (l.items || 0) > 0);
    const byMethod = new Map<MachineType, PvLine[]>();
    for (const l of lines) { const mt = lineMethod(l.category || "", fallback); byMethod.set(mt, [...(byMethod.get(mt) || []), l]); }
    const imps = (g.imprints || []).filter((i) => i && (i.column || i.details || i.typeOfWork));
    for (const [method, ls] of byMethod) {
      const qty = ls.reduce((a, l) => a + (+(l.items || 0) || 0), 0);
      if (!qty) continue;
      const text = ls.map((l) => l.description || "").join("\n");
      const darkQty = ls.reduce((a, l) => a + (l.color && LIGHT.test(l.color) ? 0 : +(l.items || 0) || 0), 0);
      const dark = /underbase/i.test(text) || darkQty > qty / 2;
      if (method === "screen") {
        const mine = imps.filter((i) => lineMethod(i.typeOfWork || "", "screen") === "screen");
        const named = locsIn(text);
        if (mine.length) {
          mine.forEach((i, k) => {
            const cm = (i.column || "").match(/(\d{1,2})\s*CL\s*\/\s*(\d{1,2})\s*CD/i), one = (i.column || "").match(/(\d{1,2})\s*c/i);
            const screens = cm ? +cm[1] : one ? +one[1] + (dark && s.screen.underbaseOnDark ? 1 : 0) : 2;
            const colors = cm ? (dark ? Math.max(1, +cm[2]) : +cm[1]) : one ? +one[1] : 1;
            const det = (i.details || "").trim(), loc = det && !/not\s*specified/i.test(det) ? title(det) : named.length === mine.length ? named[k] : mine.length === 1 ? "Print" : k === 0 ? "Front" : `Print ${k + 1}`;
            steps.push({ method, location: loc, colors, screens: Math.min(15, screens), qty, dark, garment: garmentKind(text), stitches: 0, note: cm || one ? "" : "colors unknown (Printavo)" });
          });
        } else {
          const split = colorSplit(text);
          const names = named.length ? named : ["Front", "Back", "Sleeve"];
          if (split) split.forEach((c, k) => { if (c > 0) steps.push({ method, location: named.length ? names[k] || `Location ${k + 1}` : names[k], colors: c, screens: c + (dark && s.screen.underbaseOnDark && c < 11 ? 1 : 0), qty, dark, garment: garmentKind(text), stitches: 0, note: "" }); });
          else steps.push({ method, location: named[0] || "Print", colors: 2, screens: 2 + (dark ? 1 : 0), qty, dark, garment: garmentKind(text), stitches: 0, note: "colors unknown (Printavo)" });
        }
      } else {
        // embroidery / heat: one step per location + garment kind (caps run slower)
        const parts = new Map<string, { loc: string; garment: Step["garment"]; qty: number }>();
        for (const l of ls) {
          const d = l.description || "", garment: Step["garment"] = garmentKind(d) === "cap" ? "cap" : "tee";
          if (/no\s*decoration|fulfillment\s*only/i.test(d)) continue;
          const loc = locsIn(d)[0] || (garment === "cap" ? "Cap Front" : "Left Chest");
          const k = loc + "|" + garment, cur = parts.get(k) || { loc, garment, qty: 0 };
          cur.qty += +(l.items || 0) || 0; parts.set(k, cur);
        }
        for (const p of parts.values()) if (p.qty) steps.push({ method, location: p.loc, colors: 1, screens: 0, qty: p.qty, dark, garment: p.garment, stitches: method === "embroidery" ? stitchesFor(s, p.loc) : 0, note: "" });
      }
    }
  }
  const qty = +(row.qty || 0);
  if (!steps.length && qty) { const garment = garmentKind(row.nickname); steps.push({ method: fallback, location: fallback === "embroidery" && garment === "cap" ? "Cap Front" : fallback === "embroidery" ? "Left Chest" : "Print", colors: 2, screens: fallback === "screen" ? 3 : 0, qty, dark: true, garment, stitches: s.embroidery.stitches.default, note: "estimated from quantity (Printavo)" }); }
  return groupNeeds(steps);
}

/** "Print 1c + Print 1c + Back 2c" → "Print 1c ×2 + Back 2c" */
const collapse = (ls: string[]) => [...new Set(ls)].map((l) => { const n = ls.filter((x) => x === l).length; return n > 1 ? `${l} ×${n}` : l; }).join(" + ");
function needOf(type: MachineType, st: Step[]): Need {
  return { type, steps: st, needColors: type === "screen" ? Math.max(...st.map((x) => x.screens)) : 0, qty: Math.max(...st.map((x) => x.qty)), label: collapse(st.map((x) => (type === "screen" ? `${x.location} ${x.colors}c${x.dark ? " dark" : ""}${x.puff ? " puff" : ""}` : type === "embroidery" ? `${x.location} ${Math.round(x.stitches / 1000)}k${x.garment === "cap" ? " cap" : ""}` : x.location))) };
}
function groupNeeds(steps: Step[]): Need[] {
  const out: Need[] = [];
  for (const type of ["screen", "embroidery", "heat"] as MachineType[]) {
    const st = steps.filter((x) => x.method === type);
    if (st.length) out.push(needOf(type, st));
  }
  return out;
}

/* ---------- splitting a job by print location (fronts one day / press, backs another) ---------- */

/** A print location's key: every "Full Front" on the job is one run, every "Full Back" another. */
export const locKey = (st: Step) => (st.location || "").trim().toLowerCase() || "print";
/** The print locations a need has, in order. */
export const locsOf = (need: Need) => [...new Set(need.steps.map(locKey))];
/** Just some of a need's locations (null / empty = all of it). */
export function subNeed(need: Need, locs: string[] | null | undefined): Need {
  if (!locs || !locs.length) return need;
  const st = need.steps.filter((x) => locs.includes(locKey(x)));
  return st.length ? needOf(need.type, st) : need;
}
/** What's left of a need once some locations are booked (null = nothing left). */
export function restNeed(need: Need, booked: string[] | "all"): Need | null {
  if (booked === "all") return null;
  const st = need.steps.filter((x) => !booked.includes(locKey(x)));
  return st.length ? needOf(need.type, st) : null;
}

/* ---------- how long it takes ---------- */

export type Estimate = { minutes: number; setup: number; run: number; teardown: number; parts: { label: string; minutes: number }[] };

/** Minutes for a need on a given machine (embroidery depends on the heads; screen on the press's own speed). */
export function estimate(s: ProductionSettings, need: Need, mach: Machine): Estimate {
  const f = (s.factor[need.type] || 1) / (mach.speed || 1) / Math.max(0.3, need.speed || 1);
  let setup = 0, run = 0, teardown = 0;
  const parts: Estimate["parts"] = [];
  if (need.type === "screen") {
    const S = s.screen;
    for (const st of need.steps) {
      let rate = S.baseRate * Math.max(0.5, 1 - S.perExtraColor * Math.max(0, st.colors - 4));
      if (st.dark) rate *= S.darkFactor;
      if (st.puff) rate *= S.puffFactor ?? 0.7;
      if (st.garment === "heavy") rate *= S.heavyFactor;
      if (st.garment === "bag") rate *= S.bagFactor;
      if (smallLoc(st.location)) rate *= S.smallLocFactor;
      // the crew's own pace (100 = standard): setup, teardown, printing, long / short runs, darks, many colors
      const k = mach.skill, pct = (x: number | undefined) => Math.max(0.3, (x ?? 100) / 100);
      let suF = 1, rateF = 1;
      if (k) {
        suF *= pct(k.setup); rateF *= pct(k.run);
        if (st.qty >= LONG_RUN) rateF *= pct(k.long);
        if (st.qty < SHORT_RUN) { rateF *= pct(k.short); suF *= pct(k.short); }
        if (st.dark) rateF *= pct(k.dark);
        if (st.colors >= 6) { rateF *= pct(k.colors); suF *= pct(k.colors); }
      }
      rate *= rateF;
      if (st.puff) suF /= S.puffSetupFactor ?? 1.5;
      const su = (st.screens * S.setupPerScreen) / suF, td = (st.screens * S.teardownPerScreen) / (k ? pct(k.teardown) : 1), r = (st.qty / Math.max(1, rate)) * 60;
      const tot = Math.max(S.minMinutes, su + r + td);
      setup += su; run += tot - su - td; teardown += td;
      parts.push({ label: `${st.location}${st.puff ? " (puff)" : ""}: ${st.screens} screens, ${st.qty} pcs @ ${Math.round(rate)}/hr`, minutes: tot * f });
    }
  } else if (need.type === "embroidery") {
    const E = s.embroidery;
    need.steps.forEach((st, i) => {
      const spm = st.garment === "cap" ? E.spmCap : E.spmFlat;
      const cycleMin = st.stitches / spm + (E.trimsPerDesign * E.trimSecs) / 60 + (E.breakMinPer10k * st.stitches) / 10000 + E.hoopSecs / 60;
      const runs = Math.ceil(st.qty / Math.max(1, mach.heads));
      const su = i === 0 ? E.setupMin : E.extraLocationSetupMin;
      setup += su; run += runs * cycleMin;
      parts.push({ label: `${st.location}: ${Math.round(st.stitches / 1000)}k stitches, ${runs} runs × ${cycleMin.toFixed(1)} min on ${mach.heads} head${mach.heads === 1 ? "" : "s"}`, minutes: (su + runs * cycleMin) * f });
    });
  } else {
    const H = s.heat;
    need.steps.forEach((st, i) => { const su = i === 0 ? H.setupMin : 0, r = (st.qty * H.secsPerPiece) / 60; setup += su; run += r; parts.push({ label: `${st.location}: ${st.qty} pcs @ ${H.secsPerPiece}s`, minutes: (su + r) * f }); });
  }
  return { minutes: Math.round((setup + run + teardown) * f), setup: Math.round(setup * f), run: Math.round(run * f), teardown: Math.round(teardown * f), parts };
}

/** A job described in a few fields (the "When can we print it?" form) as what it needs from a machine. */
export type QuickJob = { method: MachineType; qty: number; garment: "tee" | "heavy" | "bag" | "cap"; dark: boolean; locations: { name: string; colors: number; stitches: number; puff?: boolean }[]; /** 100 = normal; 70 = a hard print that runs at 70% */ speed?: number };
export function quickNeed(s: ProductionSettings, j: QuickJob): Need {
  const locs = j.locations.filter((l) => (j.method === "embroidery" ? l.stitches > 0 : l.colors > 0));
  const steps: Step[] = locs.map((l) => {
    const colors = j.method === "screen" ? l.colors : 0;
    const screens = j.method === "screen" ? colors + (j.dark && s.screen.underbaseOnDark && colors < 11 ? 1 : 0) : 0;
    return { method: j.method, location: l.name, colors, screens, qty: j.qty, dark: j.dark, garment: j.method === "embroidery" && j.garment === "cap" ? "cap" : j.garment, stitches: j.method === "embroidery" ? l.stitches : 0, note: "", puff: j.method === "screen" && !!l.puff };
  });
  const label = steps.map((x) => (j.method === "screen" ? `${x.location} ${x.colors}c${x.dark ? " dark" : ""}${x.puff ? " puff" : ""}` : j.method === "embroidery" ? `${x.location} ${Math.round(x.stitches / 1000)}k` : x.location)).join(" + ");
  return { type: j.method, steps, needColors: Math.max(0, ...steps.map((x) => x.screens)), qty: j.qty, label, speed: (j.speed ?? 100) / 100 };
}

/** Can this machine run it? (a job needing 11 screens only fits a 12-color press) */
export const fits = (need: Need, mach: Machine) => mach.active && mach.type === need.type && (need.type !== "screen" || need.needColors <= mach.colors);

/* ---------- where it should go ---------- */

/** A machine's hours on its own settings (start time, hours a day, working days). */
export const ownWeek = (x: Pick<Machine, "startMin" | "hoursPerDay" | "days">): Shift[] => Array.from({ length: 7 }, (_, i) => (x.days || []).includes(i) ? [x.startMin ?? 420, (x.startMin ?? 420) + Math.max(0.25, x.hoursPerDay || 0) * 60] : null);
function normShift(v: unknown): Shift { if (!Array.isArray(v) || v.length < 2) return null; const a = Math.max(0, Math.min(1439, +v[0] || 0)), b = Math.max(a + 15, Math.min(1440, +v[1] || 0)); return [a, b]; }
/** This machine's shift on a given day (its crew's hours when it has a crew), or null if it's off that day. */
export const shiftOn = (mach: Machine, day: string): Shift => {
  if (mach.off && day in mach.off) return null;
  const reg = (mach.week || ownWeek(mach))[dow(day)] || null, ex = mach.extra?.[day];
  // an extra shift (weekend or overtime) adds to the regular day, or is the whole day when it isn't a regular one
  return ex ? (reg ? [Math.min(reg[0], ex[0]), Math.max(reg[1], ex[1])] : [ex[0], ex[1]]) : reg;
};
export const isOffDay = (mach: Machine, day: string) => !!mach.off && day in mach.off;
/** Its usual shift: the longest working day of its week (for days it doesn't normally run but has work booked). */
export const typicalShift = (mach: Machine): [number, number] => ((mach.week || ownWeek(mach)).filter(Boolean) as [number, number][]).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || [mach.startMin ?? 420, (mach.startMin ?? 420) + (mach.hoursPerDay || 11) * 60];
/**
 * The stretches of a shift it can actually run, each with its speed: the shift minus downtime (rate 0), and slowed
 * where it runs short-handed (rate 0.5 = half speed). [start, end, rate][]
 */
export function windowsIn(sh: [number, number], down: Down[] = []): [number, number, number][] {
  const cuts = [...new Set([sh[0], sh[1], ...down.flatMap(([a, b]) => [a, b]).filter((t) => t > sh[0] && t < sh[1])])].sort((a, b) => a - b);
  const out: [number, number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const x = cuts[i], y = cuts[i + 1];
    const rate = down.filter(([a, b]) => a < y && b > x).reduce((r, d) => Math.min(r, Math.max(0, d[3])), 1);
    if (rate <= 0 || y - x < 5) continue;
    const last = out[out.length - 1];
    if (last && last[1] === x && last[2] === rate) last[1] = y; else out.push([x, y, rate]);
  }
  return out;
}
/** Lunch can move as early as 11:00 (so it's over by 12:30) to fall between jobs instead of in the middle of one. */
export const LUNCH_EARLIEST = 660;
/** When lunch starts on a shift, or null when the shift is too short for one. `at` moves it (kept inside the shift). */
export function lunchStart(mach: Machine, sh: [number, number], at?: number): number | null {
  const b = mach.brk || DEFAULT_BREAKS;
  if (!(b.lunchMin > 0 && sh[1] - sh[0] > b.lunchAfterHours * 60)) return null;
  return Math.max(sh[0] + b.warmupMin, Math.min(at ?? b.lunchAt, sh[1] - b.lunchMin));
}
/** Press warm-up at the start of every shift, and lunch on a shift over 8 hours (noon unless `lunchAt` moves it) followed by a short warm-up. */
export function breakDowns(mach: Machine, sh: [number, number], lunchAt?: number): Down[] {
  const b = mach.brk || DEFAULT_BREAKS, out: Down[] = [];
  if (b.warmupMin > 0) out.push([sh[0], Math.min(sh[1], sh[0] + b.warmupMin), "Warm-up", 0]);
  const at = lunchStart(mach, sh, lunchAt);
  if (at != null) {
    out.push([at, at + b.lunchMin, "Lunch", 0]);
    // then the press warms back up (10 minutes) before printing again
    const rw = b.rewarmMin ?? DEFAULT_BREAKS.rewarmMin;
    if (rw > 0) out.push([at + b.lunchMin, Math.min(sh[1], at + b.lunchMin + rw), "Warm-up", 0]);
  }
  return out;
}
/** The day's warm-ups and lunch. A crew starting late (downtime over the start of the shift) warms up when they get in. */
export const breaksOn = (mach: Machine, day: string, sh: [number, number], lunchAt?: number): Down[] => {
  let a = sh[0];
  for (const d of [...(mach.down?.[day] || [])].filter((x) => !(x[3] > 0)).sort((x, y) => x[0] - y[0])) if (d[0] <= a && d[1] > a) a = d[1];
  return a < sh[1] ? breakDowns(mach, [a, sh[1]], lunchAt) : [];
};
/** Everything that takes time out of a day: warm-ups, lunch, downtime and slow stretches. */
export const downsOn = (mach: Machine, day: string, sh: [number, number], lunchAt?: number): Down[] => [...breaksOn(mach, day, sh, lunchAt), ...(mach.down?.[day] || [])];
export const windowsOn = (mach: Machine, day: string): [number, number, number][] => { const sh = shiftOn(mach, day); return sh ? windowsIn(sh, downsOn(mach, day, sh)) : []; };
/** Work minutes it has on that day (0 when off; downtime out, slow stretches counted at their speed), or on a usual day. */
export const capacityMin = (s: ProductionSettings, mach: Machine, day?: string) => { if (day) return windowsOn(mach, day).reduce((a, [x, y, r]) => a + (y - x) * r, 0); const t = typicalShift(mach); return t[1] - t[0]; };
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();

/* ---------- overtime: the pay week runs Friday through Thursday; past 40 paid hours is overtime ---------- */
export const OT_LIMIT_MIN = 40 * 60;
/** The Friday that starts the pay week a day falls in. */
export const payWeekStart = (d: string) => addDay(d, -((dow(d) + 2) % 7));
/** The crew's paid time that day: the shift less unpaid lunch, and less any time they leave early / start late. */
export function paidOn(mach: Machine, day: string): [number, number][] {
  const sh = shiftOn(mach, day);
  if (!sh) return [];
  const cut = [
    ...breaksOn(mach, day, sh).filter((x) => x[2] === "Lunch"),
    ...(mach.down?.[day] || []).filter((x) => !(x[3] > 0) && /leav|start(ing)? late|no overtime/i.test(x[2])),
  ].sort((a, b) => a[0] - b[0]);
  let parts: [number, number][] = [[sh[0], sh[1]]];
  for (const [a, b] of cut) parts = parts.flatMap(([x, y]): [number, number][] => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as [number, number]] : []), ...(b < y ? [[b, y] as [number, number]] : [])]));
  return parts.filter(([x, y]) => y > x);
}
export type WeekOT = { weekStart: string; paid: number; ot: number; days: Record<string, { paid: number; ot: number; otFrom: number | null }> };
/** A press crew's paid minutes Friday → Thursday and where overtime starts (after 40 hours). Machines without a crew: null. */
export function weekOvertime(mach: Machine, weekStart: string): WeekOT | null {
  if (!mach.crew) return null;
  let cum = 0, ot = 0;
  const days: WeekOT["days"] = {};
  for (let i = 0; i < 7; i++) {
    const d = addDay(weekStart, i);
    let dp = 0, dot = 0, from: number | null = null;
    for (const [a, b] of paidOn(mach, d)) {
      const len = b - a, room = Math.max(0, OT_LIMIT_MIN - cum);
      if (len > room) { if (from == null) from = a + room; dot += len - room; }
      cum += len; dp += len;
    }
    ot += dot;
    days[d] = { paid: dp, ot: dot, otFrom: from };
  }
  return { weekStart, paid: cum, ot, days };
}
/** When overtime starts on a day for this machine's crew (minutes after midnight), or null. */
export const otFromOn = (mach: Machine, day: string) => weekOvertime(mach, payWeekStart(day))?.days[day]?.otFrom ?? null;
/** Business days back from a date on the shop's week (Mon–Fri). */
export function plusWorkdays(d: string, n: number) { let x = d, k = n; while (k > 0) { x = addDay(x, 1); if (dow(x) !== 0 && dow(x) !== 6) k--; } return x; }
export function minusWorkdays(d: string, n: number) { let x = d, k = n; while (k > 0) { x = addDay(x, -1); if (dow(x) !== 0 && dow(x) !== 6) k--; } return x; }

export type Suggestion = { machine: Machine; day: string; minutes: number; late: boolean; reason: string; alternatives: { machine: Machine; day: string; minutes: number }[] };

/**
 * The earliest day a machine that can run it has room, finishing before (in-hands − buffer). Among machines free
 * the same day, the one that wastes the least (don't put a 1-color job on the 12-color press; embroidery on the
 * head count that fits the quantity). `load` is minutes already booked: load[machineId][day].
 */
export function suggest(s: ProductionSettings, need: Need, due: string | null, today: string, load: Record<string, Record<string, number>>, horizon = 30): Suggestion | null {
  const machines = s.machines.filter((x) => fits(need, x));
  if (!machines.length) return null;
  const latest = due ? minusWorkdays(due, s.bufferDays) : null;
  const options: { machine: Machine; day: string; minutes: number; score: number }[] = [];
  for (const mach of machines) {
    const est = estimate(s, need, mach).minutes;
    for (let i = 0; i < horizon; i++) {
      const day = addDay(today, i);
      if (!shiftOn(mach, day)) continue;
      const cap = capacityMin(s, mach, day) * s.fillTarget;
      const used = load[mach.id]?.[day] || 0;
      // room left today, or an empty day for a job bigger than a day
      if (used + est <= cap || (used === 0 && est > cap)) {
        const waste = need.type === "screen" ? (mach.colors - need.needColors) * 2 : need.type === "embroidery" ? Math.abs(mach.heads - Math.max(1, Math.round(need.qty / 12))) * 3 : 0;
        // a job longer than a shift runs into the next working days: judge it by the day it finishes
        const spill = Math.max(0, Math.ceil(est / Math.max(1, capacityMin(s, mach))) - 1);
        options.push({ machine: mach, day, minutes: est, score: (i + spill) * 100 + waste + est / 60 + used / 30 }); // same day: the emptier machine
        break;
      }
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => a.score - b.score);
  const best = options[0];
  let finish = best.day;
  for (let k = Math.max(0, Math.ceil(best.minutes / Math.max(1, capacityMin(s, best.machine))) - 1), g = 0; k > 0 && g < 60; g++) { finish = addDay(finish, 1); if (shiftOn(best.machine, finish)) k--; }
  const late = !!latest && finish > latest;
  const needTxt = need.type === "screen" ? `${need.needColors} screens → needs a ${need.needColors}+ color press` : need.type === "embroidery" ? `${need.qty} pcs, ${need.label}` : `${need.qty} pcs heat press`;
  const reason = `${needTxt}. ${best.machine.name} is open ${best.day === today ? "today" : best.day}${due ? `; in-hands ${due}${late ? " — too late, needs attention" : " ✓"}` : ""}. About ${fmtMin(best.minutes)}.`;
  return { machine: best.machine, day: best.day, minutes: best.minutes, late, reason, alternatives: options.slice(1, 4).map(({ machine, day, minutes }) => ({ machine, day, minutes })) };
}

export const fmtMin = (min: number) => { const h = Math.floor(min / 60), mm = Math.round(min % 60); return h ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`; };

/** Which of our machines a Printavo status points at ("SP - Press 1 - 12C Gauntlet III" → Press 1). */
export function machineForStatus(s: ProductionSettings, status: string): Machine | null {
  const st = status.toLowerCase();
  return s.machines.find((x) => x.pvMatch && st.includes(x.pvMatch.toLowerCase())) || null;
}
/** Printavo statuses that mean "ready to be scheduled". */
export const PV_READY = /ready\s*for\s*(production|scheduling)|pre\s*production|ready\s*for\s*production/i;
