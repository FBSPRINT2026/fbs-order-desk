/**
 * "Make Separations Better": what the coach may change in the Separation Studio, and the lessons it keeps.
 * Shared by the Studio (to apply a change, and to start new separations from the lessons) and the API route
 * (to tell Claude what each setting does and to check what comes back).
 */
export type CoachSetting =
  | "method" | "colors" | "addMiddle" | "underbase" | "highlight" | "chokePt" | "trapPt" | "finePt" | "fineChokePt" | "bumpPt"
  | "blackOver" | "lpi" | "angle" | "dot" | "pressGain" | "dpi" | "cropMarks" | "regMarks";
export type CoachChange = { setting: CoachSetting; value: string | number | boolean; why?: string };
export type LessonDefault = { setting: CoachSetting; value: string | number | boolean; when: "all" | "spot" | "sim" | "dark" | "light" };
export type Lesson = { id: string; lesson: string; tags: string[]; default_setting: LessonDefault | null; by: string; created_at: string; expires_at: string; active: boolean };

/** each setting: what it does (for Claude) and the values it can take */
export const COACH_SETTINGS: Record<CoachSetting, { about: string; check: (v: unknown) => string | number | boolean | null }> = {
  method: { about: "\"spot\" (flat colors, solid screens; fades as two inks' halftones crossing) or \"sim\" (simulated process: a few bright inks in halftones mixed on the shirt; photos, painted art)", check: (v) => (v === "spot" || v === "sim" ? v : null) },
  colors: { about: "how many inks (1–12). The Studio re-separates with that many: fewer = the colors left out print as halftones of the others; more = a fade gets another step or the next color in the art gets its own ink", check: (v) => num(v, 1, 12, 1) },
  addMiddle: { about: "add a third screen in the middle of a fade, value \"Ink A|Ink B\" (the two ink names of the fade, as listed). For fades whose middle prints muddy as two halftones crossing (yellow→blue needs a green)", check: (v) => (typeof v === "string" && v.includes("|") ? v.slice(0, 120) : null) },
  underbase: { about: "white underbase: \"auto\" (on dark shirts), \"on\", \"off\"", check: (v) => (v === "auto" || v === "on" || v === "off" ? v : null) },
  highlight: { about: "true/false: print the art's white again on top as a highlight white. Simulated process on a dark shirt only: spot color never prints a highlight white (its white is an ink like the others), so on spot this setting does nothing", check: bool },
  chokePt: { about: "underbase choke in points (0–3, default 0.5): how far the base is pulled in from the colors' edges so it never peeks out", check: (v) => num(v, 0, 3, 0.05) },
  trapPt: { about: "(spot only) spot color trap in points (0–2, default 0.25): each color spreads under the darker color printed after it so neighbors overlap a hair (no gaps when a screen is a little off)", check: (v) => num(v, 0, 2, 0.05) },
  finePt: { about: "fine detail threshold in points (0–4, 0 = off): parts thinner than this (small type, thin lines) get a smaller base choke and the color on top gets a stroke instead", check: (v) => num(v, 0, 4, 0.05) },
  fineChokePt: { about: "base choke on fine detail, points (0–3)", check: (v) => num(v, 0, 3, 0.05) },
  bumpPt: { about: "color stroke: the stroke added to the top color on fine detail, points (0–1)", check: (v) => num(v, 0, 1, 0.05) },
  blackOver: { about: "true/false (vector art, spot): black prints on top of the colors (overprint) instead of knocking them out", check: bool },
  lpi: { about: "halftone lines per inch (25–85, usually 45–65): lower = bigger dots that hold on the screen and print smoother fades on coarse mesh; higher = finer detail but needs finer mesh (mesh ≥ 4 × lpi)", check: (v) => num(v, 25, 85, 1) },
  angle: { about: "halftone angle in degrees (0–90, usually 22.5)", check: (v) => num(v, 0, 90, 0.5) },
  dot: { about: "halftone dot shape: \"ellipse\" (smoothest midtones, the usual pick), \"round\", \"square\"", check: (v) => (v === "ellipse" || v === "round" || v === "square" ? v : null) },
  pressGain: { about: "dot gain on press, 0–0.3 (0.15 = a 50% dot prints ~65%): the halftone plates are made lighter by that much. Fades that print too dark / blocked up in the middle need more; too light / washed out need less. 0 if the RIP adds its own curve", check: (v) => num(v, 0, 0.3, 0.05) },
  dpi: { about: "film resolution: 360, 600, 720, 1200 or 1440", check: (v) => ([360, 600, 720, 1200, 1440].includes(+(v as number)) ? +(v as number) : null) },
  cropMarks: { about: "true/false: crop marks at the corners of each film (and the Illustrator / RIP files)", check: bool },
  regMarks: { about: "true/false: registration targets on the four sides of each film", check: bool },
};
function num(v: unknown, lo: number, hi: number, step: number) { const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; if (!Number.isFinite(n)) return null; return Math.round(Math.min(hi, Math.max(lo, n)) / step) * step; }
function bool(v: unknown) { return v === true || v === "true" ? true : v === false || v === "false" ? false : null; }

/** a change Claude sent back, checked: the setting exists and the value is one it can take (else null) */
export function cleanChange(c: { setting?: string; value?: unknown; why?: string }): CoachChange | null {
  const def = COACH_SETTINGS[c.setting as CoachSetting]; if (!def) return null;
  const value = def.check(c.value); if (value === null) return null;
  return { setting: c.setting as CoachSetting, value: typeof value === "number" ? +value.toFixed(3) : value, why: String(c.why || "").slice(0, 300) };
}

/**
 * The job a setting is read on: the method, a dark shirt, whether an underbase prints and whether any plate is in
 * halftones. Left out (undefined) = not known, and the setting counts as in use.
 */
export type SepJob = { method?: string; dark?: boolean; underbase?: string; halftones?: boolean };

/**
 * Does this setting do anything on this job? Some only act on part of the jobs: the highlight white is simulated process
 * on a dark shirt only (spot color never prints one); the choke and fine-detail settings work on the underbase, so only
 * when one prints; trap and black on top are spot color's; LPI, angle, dot and dot gain only touch halftone plates.
 * (Oct 29 2026, S-57 Christmas tree pocket: a spot job showed "highlight: true", a setting that did nothing there, and
 * the Separo comparison read it as an extra white pass and taught "highlight off" for every job, sim included.)
 */
export function settingApplies(setting: CoachSetting, job: SepJob): boolean {
  const sim = job.method === undefined ? undefined : job.method === "sim";
  const base = job.underbase === "on" ? true : job.underbase === "off" ? false : job.dark;
  switch (setting) {
    case "highlight": return sim !== false && base !== false;
    case "chokePt": case "finePt": case "fineChokePt": case "bumpPt": return base !== false;
    case "trapPt": case "blackOver": return sim !== true;
    case "lpi": case "angle": case "dot": case "pressGain": return sim === true || job.halftones !== false;
    default: return true;
  }
}

/** a settings object cut down to what's in use on this job (what the coach and the Separo comparison are shown) */
export function settingsInUse<T extends Record<string, unknown>>(settings: T, job: SepJob): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(settings)) if (!(k in COACH_SETTINGS) || settingApplies(k as CoachSetting, job)) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** the job a saved feedback row was about (a Separo comparison keeps ours + art, a coach chat keeps the Studio's context) */
export function feedbackJob(ctx: unknown): SepJob {
  const c = (ctx || {}) as { method?: string; ours?: { method?: string; settings?: { underbase?: string } }; art?: { dark?: boolean }; shirt?: { dark?: boolean } | string; settings?: { underbase?: string } };
  const method = c.ours?.method || c.method;
  const dark = typeof c.art?.dark === "boolean" ? c.art.dark : typeof c.shirt === "object" && typeof c.shirt?.dark === "boolean" ? c.shirt.dark : typeof c.shirt === "string" ? false : undefined;
  return { method, dark, underbase: c.ours?.settings?.underbase || c.settings?.underbase };
}

/**
 * A lesson's starting setting, checked against the job it was learned on: a setting that did nothing there can't be
 * what fixed it, so the lesson keeps its words but starts nothing (null).
 */
export function lessonDefaultFrom(d: LessonDefault | null, from: SepJob): LessonDefault | null {
  return d && settingApplies(d.setting, from) ? d : null;
}

/** a lesson's starting setting applies to this separation? (and, when known, made sense on the job it was learned on) */
export const lessonFits = (d: LessonDefault, method: string, dark: boolean, from?: SepJob) =>
  (d.when === "all" || d.when === method || (d.when === "dark" && dark) || (d.when === "light" && !dark))
  && settingApplies(d.setting, { method, dark }) && (!from || settingApplies(d.setting, from));

export const COACH_LABEL: Record<CoachSetting, string> = {
  method: "Method", colors: "Colors", addMiddle: "Middle screen", underbase: "Underbase", highlight: "Highlight white", chokePt: "Choke",
  trapPt: "Trap", finePt: "Fine detail", fineChokePt: "Fine base choke", bumpPt: "Color stroke", blackOver: "Black on top", lpi: "LPI",
  angle: "Angle", dot: "Dot", pressGain: "Dot gain", dpi: "Film DPI", cropMarks: "Crop marks", regMarks: "Registration targets",
};
export const changeText = (c: CoachChange) => {
  const v = c.setting === "addMiddle" ? String(c.value).split("|").join(" → middle → ") : c.setting === "pressGain" ? `${Math.round(+c.value * 100)}%`
    : /Pt$/.test(c.setting) ? `${c.value} pt` : typeof c.value === "boolean" ? (c.value ? "on" : "off") : String(c.value);
  return `${COACH_LABEL[c.setting]}: ${v}`;
};
