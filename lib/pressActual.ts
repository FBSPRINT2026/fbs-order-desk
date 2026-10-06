/**
 * Suggested vs as printed, per print location. The suggestion is the separation's press setup (the studio's head
 * layout, inks and meshes); "as printed" is what the crew actually ran, saved from the job's phone menu (press_actuals).
 * Safe for the browser. The saving and the learning (into the separation, the design and the order) are in
 * lib/pressActualServer.ts.
 */
export type HeadWhat = "screen" | "flash" | "cool" | "empty";
/** one head on the press, in order. `key` ties a screen to its separation plate (the film), so an ink can change and
 *  still be the same screen. */
export type PHead = { what: HeadWhat; key?: string; name: string; hex: string; mesh: number | null };
export type Change = { kind: "press" | "ink" | "mesh" | "order" | "flash" | "screen"; text: string };
export type PressActual = {
  id: string; separation_id: string | null; location: string; press_id: string; press_name: string; heads: PHead[]; changes: Change[];
  notes: string; learned: boolean; by_name: string; created_at: string;
};
/** One print location's press sheet on the phone: the suggested setup and, once saved, what really ran. */
export type PressSheet = {
  id: string;            // the separation id, or "loc:<location>" for a location with no separation (inks from the order)
  sepId: string | null; number: number; location: string; status: string; garment: string; notes: string;
  pressId: string; press: string; heads: PHead[];
  actual: PressActual | null;
};
export type PressOption = { id: string; name: string; colors: number; flashes: number };

const nm = (s: string) => s.trim().toLowerCase();
const screens = (hs: PHead[]) => hs.filter((h) => h.what === "screen");
const same = (a: PHead, b: PHead) => (a.key && b.key ? a.key === b.key : nm(a.name) === nm(b.name));

/** What changed from the suggestion, in plain words, e.g. "PMS 185 → PMS 186", "Ran on Press 3 instead of Press 1". */
export function diffSetup(plan: { pressId: string; press: string; heads: PHead[] }, act: { pressId: string; press: string; heads: PHead[] }): Change[] {
  const out: Change[] = [];
  if (act.pressId && act.pressId !== plan.pressId) out.push({ kind: "press", text: plan.press ? `Ran on ${act.press} instead of ${plan.press}` : `Ran on ${act.press}` });
  const ps = screens(plan.heads), as = screens(act.heads);
  // the same screen (film) with a different ink or mesh
  for (const a of as) {
    const p = ps.find((x) => same(x, a));
    if (!p) continue;
    if (nm(p.name) !== nm(a.name)) out.push({ kind: "ink", text: `${p.name} → ${a.name}` });
    if ((p.mesh || null) !== (a.mesh || null) && a.mesh) out.push({ kind: "mesh", text: `${a.name}: ${p.mesh ? `${p.mesh} → ` : ""}${a.mesh} mesh` });
  }
  for (const p of ps) if (!as.some((a) => same(p, a))) out.push({ kind: "screen", text: `${p.name} not printed` });
  for (const a of as) if (!ps.some((p) => same(p, a))) out.push({ kind: "screen", text: `Added ${a.name}` });
  // the order the screens went down in
  const po = ps.filter((p) => as.some((a) => same(p, a))).map((p) => p.key || nm(p.name)), ao = as.filter((a) => ps.some((p) => same(p, a))).map((a) => a.key || nm(a.name));
  if (po.join("|") !== ao.join("|")) out.push({ kind: "order", text: `Print order: ${as.map((a) => a.name).join(", ")}` });
  const count = (hs: PHead[], w: HeadWhat) => hs.filter((h) => h.what === w).length;
  for (const w of ["flash", "cool"] as const) {
    const a = count(act.heads, w), p = count(plan.heads, w);
    if (a !== p) out.push({ kind: "flash", text: `${w === "flash" ? "Flashes" : "Cool-downs"}: ${p} → ${a}` });
  }
  return out;
}

/** "Press 3: 1 Underbase White · 2 Flash · 3 PMS 186 (230) …" for notes and the work order. */
export function setupLine(press: string, heads: PHead[]) {
  return `${press ? press + ": " : ""}${heads.map((h, i) => `${i + 1} ${h.what === "screen" ? `${h.name}${h.mesh ? ` (${h.mesh})` : ""}` : h.what === "flash" ? "Flash" : h.what === "cool" ? "Cool" : "Empty"}`).join(" · ")}`;
}
