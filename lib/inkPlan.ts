/**
 * Ink planning: how much ink each scheduled screen job will use, which shelf ink (or Rio Mix ingredient) it comes out
 * of, what's on hand after the last inventory count, and when each ink runs out.
 *
 * Ink per print = print area × coverage × the mesh's theoretical ink volume × a real-world factor:
 *  - Theoretical ink volume (cm³ of ink per m² printed) is the mesh maker's figure for how much ink the open mesh holds
 *    (SEFAR PET 1500 data). It falls as the mesh count rises: 110 ≈ 53, 156 ≈ 30, 230 ≈ 19, 305 ≈ 14.
 *  - On a shirt the deposit runs much heavier than that (the stencil's thickness, off-contact, the ink driven into the
 *    fabric). FACTOR 4 matches a weighed print (a 6×6 at about half fill, print-flash-print: 4 g of ink a shirt), and
 *    puts a typical full front (10×12, about half covered, 156 mesh) near 800 prints a gallon. Until Oct 7 it was 1.6,
 *    an unchecked "1,000 full underbases a gallon" guess that ran about 2.5× light. Managers can tune it.
 *  - Each screen also leaves ink behind (in the screen, on the squeegee and flood bar): SETUP grams per screen per job.
 *  - The underbase goes under every color, so it covers the area of all of them together, and it prints on the
 *    underbase mesh in our white for the fabric: Amazing Bright Tiger on cotton, Super Poly White on poly blends.
 * Coverage and mesh come from the job's separations when they're made; else the latest separation of the same design
 * on another order (a reorder, or the same art for a new customer); before that, defaults by location.
 * A PMS color comes out of its Epic Rio formula: the grams split across the Rio Mix inks by the formula's weights.
 */
import { fabricOf, needsPolyWhite, type Fabric } from "./fabric";

export type InkPlanSettings = {
  /** real deposit ÷ theoretical ink volume */ factor: number;
  /** ink left in a screen / on the squeegee per screen per job (g) */ setupG: number;
  /** coverage of a color when there's no separation yet (% of the print area) */ coverage: number;
  /** mesh for colors / underbase when there's no separation yet */ colorMesh: number; baseMesh: number;
  /** polyester % at which the underbase/white switches to poly white */ polyPct: number;
  /** days ahead to plan an order for */ horizonDays: number;
  /** extra on top of the need when ordering (%) */ bufferPct: number;
};
export const DEFAULT_INK_PLAN: InkPlanSettings = { factor: 4, setupG: 120, coverage: 25, colorMesh: 156, baseMesh: 156, polyPct: 50, horizonDays: 14, bufferPct: 10 };
export const mergeInkPlan = (d: unknown): InkPlanSettings => ({ ...DEFAULT_INK_PLAN, ...((d && typeof d === "object" ? d : {}) as Partial<InkPlanSettings>) });

/** SEFAR PET 1500 theoretical ink volume, cm³/m², by threads per inch */
const TIV: [number, number][] = [[60, 90], [83, 73], [92, 62], [110, 53], [123, 46], [137, 39], [156, 30], [195, 22], [230, 19], [255, 20], [280, 19], [305, 14], [355, 12]];
export const tivOf = (mesh: number) => { const m = mesh || 156; let best = TIV[0]; for (const t of TIV) if (Math.abs(t[0] - m) < Math.abs(best[0] - m)) best = t; return best[1]; };

const CM3_PER_GAL = 3785.41, CM3_PER_QT = 946.353, IN2_TO_M2 = 0.00064516;
/** g/cm³: whites are heavier (Rio white ≈ 1,280 g a quart) */
export const densityOf = (name: string, gramsPerQt?: number | null) => (gramsPerQt ? gramsPerQt / CM3_PER_QT : /white|base|clear|puff/i.test(name) ? 1.35 : 1.15);
export const gramsPerPrint = (wIn: number, hIn: number, coveragePct: number, mesh: number, density: number, factor: number) =>
  wIn * hIn * IN2_TO_M2 * (coveragePct / 100) * tivOf(mesh) * factor * density;
/** grams → "1 gal 2 qt", "3 qt", "1.2 qt" */
export function fmtVol(grams: number, density: number) {
  const qt = grams / density / CM3_PER_QT;
  if (Math.abs(qt) < 0.05) return "0";
  if (Math.abs(qt) < 4) return `${qt < 1 ? qt.toFixed(1) : (Math.round(qt * 4) / 4).toString()} qt`;
  const gal = qt / 4;
  return `${(Math.round(gal * 4) / 4).toString()} gal`;
}
export const gramsFrom = (amt: number, unit: "gal" | "qt" | "g" | "lb", density: number) => (unit === "g" ? amt : unit === "lb" ? amt * 453.592 : unit === "qt" ? amt * CM3_PER_QT * density : amt * CM3_PER_GAL * density);
/** order sizes: whole quarts under a gallon, else whole gallons */
export function orderQty(grams: number, density: number) {
  const qt = grams / density / CM3_PER_QT;
  if (qt <= 0) return null;
  return qt <= 3 ? { n: Math.ceil(qt), unit: "qt" as const } : { n: Math.ceil(qt / 4), unit: "gal" as const };
}

/** default print size and art shape by location (inches) */
export function sizeFor(location: string, widthIn?: number, aspect?: number) {
  const l = location.toLowerCase();
  const [w, a] = /chest|pocket|nape|neck|yoke|sleeve|hat|cap/.test(l) ? [/sleeve/.test(l) ? 3.5 : 4, 1] : /back/.test(l) ? [12, 1.15] : [11, 1.15];
  const W = widthIn || w;
  return { w: W, h: W * (aspect || a) };
}

export type Screen = { name: string; kind: "color" | "underbase" | "highlight"; mesh: number; coverage: number; known: boolean };
/** one location printed on one garment color of a job */
export type Print = { location: string; pieces: number; garmentColor: string; fabric: Fabric; wIn: number; hIn: number; screens: Screen[]; note: string };
export type Job = { key: string; day: string; done: boolean; finishedAt: string | null; order: string; href: string; label: string; prints: Print[] };

export type StockLite = { id: string; brand: string; line: string; name: string; product: string; pms: string; stocked: boolean; section: string };
export type FormulaLite = { code: string; rec_type: string; lines: { type: string; code: string; desc: string; pct: number; g?: number }[] | null; grams_per_qt: number | null };

export type Use = { day: string; done: boolean; finishedAt: string | null; jobKey: string; order: string; href: string; label: string; location: string; ink: string; pieces: number; grams: number; via: string };
export type InkNeed = { key: string; stock: StockLite | null; name: string; density: number; uses: Use[] };

const norm = (s: string) => s.toLowerCase().replace(/^(pms|pantone)\s*/, "").replace(/\s+/g, " ").trim();
const pmsKey = (s: string) => { const t = norm(s); const m = t.match(/^(\d{3,4})\s*c?$/); return m ? `${m[1]} c` : t; };
const isWhite = (name: string) => /\bwhite\b/i.test(name) && !/off[- ]?white|cream|ivory/i.test(name);

/** how a job's ink names find their ink: the white for the fabric, a stocked ink, or an Epic Rio formula */
export function inkMatcher(stock: StockLite[], formulas: FormulaLite[]) {
  const live = stock.filter((x) => x.stocked);
  const tiger = live.find((x) => /tiger/i.test(x.name)) || live.find((x) => x.section === "base" && /white/i.test(x.name) && !/poly/i.test(x.name));
  const polyW = live.find((x) => /super\s*poly/i.test(x.name)) || live.find((x) => x.section === "base" && /poly/i.test(x.name) && /white/i.test(x.name)) || tiger;
  const byProduct = new Map(live.filter((x) => x.product).map((x) => [x.product.toUpperCase(), x]));
  const byName = new Map<string, StockLite>(); for (const x of [...live].sort((a, b) => (a.section === "rfu" ? -1 : 0) - (b.section === "rfu" ? -1 : 0))) if (!byName.has(norm(x.name))) byName.set(norm(x.name), x);
  const byPms = new Map<string, StockLite>(); for (const x of live) if (x.pms && x.section !== "mixing" && !byPms.has(pmsKey(x.pms))) byPms.set(pmsKey(x.pms), x);
  const fByCode = new Map<string, FormulaLite>(); for (const f of formulas) if (f.rec_type === "S" && f.lines?.length && !fByCode.has(pmsKey(f.code))) fByCode.set(pmsKey(f.code), f);
  const stockFor = (name: string) => byName.get(norm(name)) || byName.get(norm(name.replace(/^(rio\s*(rfu)?|wilflex|monarch|inktek)\s+/i, ""))) || byPms.get(pmsKey(name)) || null;
  const formulaFor = (name: string) => fByCode.get(pmsKey(name)) || null;
  return { tiger, polyW, byProduct, byName, stockFor, formulaFor };
}

/** which shelf ink(s) a job's ink comes out of */
export function planUsage(jobs: Job[], stock: StockLite[], formulas: FormulaLite[], s: InkPlanSettings) {
  const { tiger, polyW, byProduct, byName, stockFor, formulaFor } = inkMatcher(stock, formulas);
  const needs = new Map<string, InkNeed>();
  const add = (key: string, st: StockLite | null, name: string, density: number, u: Use) => {
    const n = needs.get(key) || { key, stock: st, name, density, uses: [] };
    n.uses.push(u); needs.set(key, n);
  };
  for (const j of jobs) for (const p of j.prints) {
    const area = p.wIn * p.hIn;
    const base: Omit<Use, "ink" | "grams" | "via"> = { day: j.day, done: j.done, finishedAt: j.finishedAt, jobKey: j.key, order: j.order, href: j.href, label: j.label, location: p.location, pieces: p.pieces };
    for (const sc of p.screens) {
      const white = sc.kind !== "color" || isWhite(sc.name);
      const grams = (d: number) => p.pieces * gramsPerPrint(p.wIn, p.hIn, sc.coverage, sc.mesh, d, s.factor) + s.setupG;
      const size = `${p.wIn.toFixed(p.wIn % 1 ? 1 : 0)}×${p.hIn.toFixed(1)}″, ${Math.round(sc.coverage)}%${sc.known ? "" : " (est.)"} on ${sc.mesh}`;
      if (white) {
        const pw = needsPolyWhite(p.fabric, p.garmentColor, s.polyPct), w = pw.poly ? polyW : tiger;
        const d = densityOf("white");
        const label = sc.kind === "underbase" ? "Underbase" : sc.kind === "highlight" ? "Top white" : sc.name;
        if (w) add(w.id, w, w.name, d, { ...base, ink: label, grams: grams(d), via: `${size} · ${pw.poly ? "poly white" : "cotton white"}: ${pw.why}` });
        else add("x:white", null, "White", d, { ...base, ink: label, grams: grams(d), via: size });
        continue;
      }
      const nm = norm(sc.name), pk = pmsKey(sc.name);
      const st = stockFor(sc.name);
      if (st) { const d = densityOf(st.name); add(st.id, st, st.name, d, { ...base, ink: sc.name, grams: grams(d), via: `${size}${st.pms && norm(st.name) !== nm ? ` · stock ink for PMS ${st.pms}` : ""}` }); continue; }
      const f = formulaFor(sc.name);
      if (f?.lines?.length) {
        const d = densityOf(sc.name, f.grams_per_qt), total = grams(d), sum = f.lines.reduce((a, l) => a + (l.g ?? l.pct), 0) || 1;
        for (const l of f.lines) {
          const share = (l.g ?? l.pct) / sum, ing = byProduct.get(l.code.toUpperCase()) || byName.get(norm(l.desc));
          const u = { ...base, ink: sc.name, grams: total * share, via: `${(share * 100).toFixed(1)}% of ${sc.name} (Epic Rio formula) · ${size}` };
          if (ing) add(ing.id, ing, ing.name, densityOf(ing.name), u);
          else add(`x:${norm(l.desc)}`, null, l.type === "RM" ? `${l.desc} (recycled ink)` : l.desc, d, u);
        }
        continue;
      }
      const d = densityOf(sc.name);
      add(`x:${pk || "unnamed"}`, null, sc.name || "Color not named", d, { ...base, ink: sc.name || "Color not named", grams: grams(d), via: `${size} · ${/^\d{3,4}\s*c?$/i.test(norm(sc.name)) || /pms/i.test(sc.name) ? "no Epic Rio formula read yet" : "not a stock ink"}` });
    }
  }
  return needs;
}

/** one ink a job needs, all its screens together (the job's phone menu: "what to pull or mix") */
export type JobInk = {
  key: string; name: string; kind: "white" | "stock" | "pms" | "other"; screen: string;
  /** the Epic Rio formula's code when it's mixed ("123 C") */ code: string;
  grams: number; density: number; est: boolean; where: { location: string; pieces: number; grams: number }[]; why: string;
  /** how many screens use it */ n: number;
};
export function jobInks(job: Job, stock: StockLite[], formulas: FormulaLite[], s: InkPlanSettings): JobInk[] {
  const { tiger, polyW, stockFor, formulaFor } = inkMatcher(stock, formulas);
  const out = new Map<string, JobInk>();
  for (const p of job.prints) for (const sc of p.screens) {
    const white = sc.kind !== "color" || isWhite(sc.name);
    let key: string, name: string, kind: JobInk["kind"], d: number, code = "", why = "";
    if (white) {
      const pw = needsPolyWhite(p.fabric, p.garmentColor, s.polyPct), w = pw.poly ? polyW : tiger;
      key = w ? w.id : "white"; name = w ? w.name : "White"; kind = "white"; d = densityOf("white"); why = `${pw.poly ? "Poly white" : "Cotton white"}: ${pw.why}`;
    } else {
      const st = stockFor(sc.name), f = st ? null : formulaFor(sc.name);
      if (st) { key = st.id; name = st.name; kind = "stock"; d = densityOf(st.name); }
      else if (f) { key = `f:${f.code.toUpperCase()}`; name = `PMS ${f.code}`; kind = "pms"; code = f.code; d = densityOf(sc.name, f.grams_per_qt); }
      else { key = sc.name ? `x:${norm(sc.name)}` : "x:unnamed"; name = sc.name || "Colors not named"; kind = "other"; d = densityOf(sc.name); }
    }
    const g = p.pieces * gramsPerPrint(p.wIn, p.hIn, sc.coverage, sc.mesh, d, s.factor) + s.setupG;
    const cur = out.get(key) || { key, name, kind, screen: sc.kind === "underbase" ? "Underbase" : sc.name, code, grams: 0, density: d, est: false, where: [], why, n: 0 };
    cur.grams += g; cur.n++; cur.est = cur.est || !sc.known;
    const at = cur.where.find((x) => x.location === p.location);
    if (at) { at.grams += g; at.pieces = Math.max(at.pieces, p.pieces); } else cur.where.push({ location: p.location, pieces: p.pieces, grams: g });
    out.set(key, cur);
  }
  const rank = { white: 0, stock: 1, pms: 1, other: 2 };
  return [...out.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.grams - a.grams);
}

/** a batch to mix for a need: whole quarts up to 3, then half gallons ("2 qt", "1½ gal") */
export function batchQt(grams: number, density: number) {
  const q = grams / density / CM3_PER_QT;
  return q <= 3 ? Math.max(1, Math.ceil(q)) : Math.ceil(q / 2) * 2;
}
/** quarts → "3 qt", "1 gal", "1½ gal", "2 gal 1 qt" */
export function qtLabel(qt: number) {
  if (qt < 4) return `${+qt.toFixed(2)} qt`;
  const g = Math.floor(qt / 4), r = +(qt - g * 4).toFixed(2);
  return r === 2 ? `${g}½ gal` : r ? `${g} gal ${r} qt` : `${g} gal`;
}
export const qtStep = (qt: number) => (qt < 4 ? 1 : 2);

export type CountLite = { stock_ink_id: string; grams: number; counted_at: string; counted_by: string; kind: string };
export type InkStatus = {
  need: InkNeed | null; stock: StockLite | null; name: string; density: number;
  count: CountLite | null; usedSince: number; onHand: number | null;
  ahead: number; runsOut: { day: string; uses: Use[] } | null; order: { n: number; unit: "qt" | "gal" } | null; shortG: number;
};
/** on hand (last count less finished jobs since), what's coming, the first day it runs short, and what to order */
export function inkStatus(stock: StockLite | null, need: InkNeed | null, count: CountLite | null, today: string, s: InkPlanSettings): InkStatus {
  const name = stock?.name || need?.name || "", density = need?.density || densityOf(name);
  const uses = need?.uses || [];
  const usedSince = count ? uses.filter((u) => u.done && (u.finishedAt || u.day) > count.counted_at).reduce((a, u) => a + u.grams, 0) : 0;
  const onHand = count ? Math.max(0, count.grams - usedSince) : null;
  const end = new Date(today + "T12:00:00"); end.setDate(end.getDate() + s.horizonDays);
  const until = end.toISOString().slice(0, 10);
  const coming = uses.filter((u) => !u.done && u.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const ahead = coming.filter((u) => u.day <= until).reduce((a, u) => a + u.grams, 0);
  let left = onHand ?? 0, runsOut: InkStatus["runsOut"] = null;
  for (const u of coming) { left -= u.grams; if (left < 0) { runsOut = { day: u.day, uses: coming.filter((x) => x.day === u.day) }; break; } }
  const shortG = Math.max(0, ahead * (1 + s.bufferPct / 100) - (onHand ?? 0));
  return { need, stock, name, density, count, usedSince, onHand, ahead, runsOut, order: shortG > 0 ? orderQty(shortG, density) : null, shortG };
}

// ---------- jobs from the schedule ----------
type SlotLite = { order_id: string | null; archived_order_id: string | null; day: string; status: string; finished_at: string | null; locations: string[] | null; label: string | null };
type SepLite = { order_id: string; imprint_id: string | null; garment_color: string | null; location: string | null; design_id: string | null; status: string; settings: { widthIn?: number } | null; channels: { name: string; kind: string; mesh: number; coverage: number }[] | null };
type LineLite = { style?: string; brand?: string; garment?: string; color?: string; sizes?: Record<string, number> };
type OrderLite = { id: string; number: number; nickname: string | null; groups: { lines: LineLite[]; imprints: { id: string; method: string; location: string; colors: number; inks: string; size: string; design_id?: string }[] }[] | null };
type DesignLite = { id: string; width_px: number | null; height_px: number | null };
const LIGHT = /\b(white|natural|ash|cream|ivory|light|silver|heather\s*gr[ae]y|sport\s*gr[ae]y|pink|yellow|lime|sand|oatmeal|bone|vanilla|butter|mint|sky|baby)\b/i;
const sum = (o?: Record<string, number>) => Object.values(o || {}).reduce((a, n) => a + (+n || 0), 0);
const sameLoc = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** union of the colors' coverage (they overlap some): 1 − Π(1 − c) */
const unionCov = (cs: number[]) => 100 * (1 - cs.reduce((a, c) => a * (1 - Math.min(99, c) / 100), 1));

export type GarmentFabric = { style: string; brand: string; fabric: string; supplier: string | null };
export function jobsFromOrders(slots: SlotLite[], orders: OrderLite[], seps: SepLite[], designs: DesignLite[], s: InkPlanSettings, garments: GarmentFabric[] = []): Job[] {
  const gKey = (brand?: string, style?: string) => `${(brand || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${(style || "").toLowerCase()}`;
  const gByKey = new Map(garments.map((g) => [gKey(g.brand, g.style), g])), gByStyle = new Map(garments.map((g) => [(g.style || "").toLowerCase(), g]));
  const byId = new Map(orders.map((o) => [o.id, o])), dById = new Map(designs.map((d) => [d.id, d]));
  const jobs: Job[] = [];
  const bySlotOrder = new Map<string, SlotLite[]>();
  for (const sl of slots) if (sl.order_id) bySlotOrder.set(sl.order_id, [...(bySlotOrder.get(sl.order_id) || []), sl]);
  for (const [oid, sls] of bySlotOrder) {
    const o = byId.get(oid); if (!o) continue;
    sls.sort((a, b) => a.day.localeCompare(b.day));
    const oSeps = seps.filter((x) => x.order_id === oid && x.status !== "cancelled");
    // each slot prints the locations it names, else everything not booked elsewhere
    const perSlot = new Map<SlotLite, Print[]>();
    for (const g of o.groups || []) for (const im of g.imprints || []) {
      if ((im.method || "screen") !== "screen") continue;
      const sl = sls.find((x) => x.locations?.some((l) => sameLoc(l, im.location))) || sls.find((x) => !x.locations?.length) || sls[0];
      const byColor = new Map<string, { pieces: number; line: LineLite }>();
      for (const l of g.lines || []) { const k = (l.color || "").trim(); const cur = byColor.get(k); byColor.set(k, { pieces: (cur?.pieces || 0) + sum(l.sizes), line: cur?.line || l }); }
      for (const [color, { pieces, line }] of byColor) {
        if (!pieces) continue;
        const sep = oSeps.find((x) => x.imprint_id === im.id && (x.garment_color || "").toLowerCase() === color.toLowerCase()) || oSeps.find((x) => x.imprint_id === im.id) || oSeps.find((x) => x.location && sameLoc(x.location, im.location));
        // no separation on this order yet: the same art's separation from another order gives the real coverage
        const other = !sep && im.design_id ? seps.find((x) => x.order_id !== oid && x.design_id === im.design_id && x.status !== "cancelled" && x.channels?.some((c) => c.kind === "color")) : undefined;
        const d = dById.get(sep?.design_id || im.design_id || "");
        const aspect = d?.width_px && d.height_px ? d.height_px / d.width_px : undefined;
        const typed = parseFloat(String(im.size || "").replace(/[^\d.]/g, " ").trim().split(/\s+/)[0]) || undefined;
        const wGiven = sep?.settings?.widthIn || typed || other?.settings?.widthIn || undefined;
        const { w, h } = sizeFor(im.location, wGiven, aspect);
        const dark = !LIGHT.test(color);
        let screens: Screen[];
        if (other) {
          // its colors as separated; the underbase depends on this order's shirt color
          screens = other.channels!.filter((c) => c.kind === "color").map((c) => ({ name: c.name, kind: "color" as const, mesh: c.mesh || s.colorMesh, coverage: c.coverage > 1 ? c.coverage : c.coverage * 100, known: true }));
          const ub = other.channels!.find((c) => c.kind === "underbase");
          if (dark && !screens.every((x) => isWhite(x.name))) screens.unshift({ name: "Underbase", kind: "underbase", mesh: ub?.mesh || s.baseMesh, coverage: unionCov(screens.map((x) => x.coverage)), known: false });
        } else if (sep?.channels?.length) {
          screens = sep.channels.map((c) => ({ name: c.name, kind: c.kind === "underbase" ? "underbase" : c.kind === "highlight" ? "highlight" : "color", mesh: c.mesh || (c.kind === "underbase" ? s.baseMesh : s.colorMesh), coverage: c.coverage > 1 ? c.coverage : c.coverage * 100, known: true }));
        } else {
          const names = String(im.inks || "").split(/[,;+\/]|\band\b/i).map((x) => x.trim()).filter(Boolean);
          const n = Math.max(names.length, +im.colors || 1);
          screens = Array.from({ length: n }, (_, i) => ({ name: names[i] || "", kind: "color" as const, mesh: s.colorMesh, coverage: s.coverage, known: false }));
          if (dark && !screens.every((x) => isWhite(x.name))) screens.unshift({ name: "Underbase", kind: "underbase", mesh: s.baseMesh, coverage: unionCov(screens.map((x) => x.coverage)), known: false });
        }
        const cat = gByKey.get(gKey(line.brand, line.style)) || gByStyle.get((line.style || "").toLowerCase());
        const fabric = fabricOf({ style: line.style, brand: line.brand, garment: line.garment, color, fabric: cat?.fabric, supplier: cat?.supplier || undefined });
        const pr: Print = { location: im.location, pieces, garmentColor: color, fabric, wIn: w, hIn: h, screens, note: sep ? "" : other ? "coverage from this design's separation on another order" : "no separation yet" };
        perSlot.set(sl, [...(perSlot.get(sl) || []), pr]);
      }
    }
    for (const [sl, prints] of perSlot) jobs.push({ key: `${oid}|${sl.day}|${(sl.locations || []).join(",")}`, day: sl.day, done: sl.status === "done", finishedAt: sl.finished_at, order: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, href: `/shop/orders/${oid}`, label: sl.label || "", prints });
  }
  return jobs;
}

type ArchivedLite = { id: string; visual_id: string | number | null; nickname: string | null; data: { groups?: { lines?: { description?: string; color?: string; items?: number | null; category?: string | null }[] | null; imprints?: { column?: string; details?: string; typeOfWork?: string }[] | null }[] } | null };
/** Printavo jobs (until go-live): colors aren't named, so it's the underbase in white and the rest as "colors not named" */
export function jobsFromPrintavo(slots: SlotLite[], rows: ArchivedLite[], stepsOf: (row: ArchivedLite) => { location: string; colors: number; qty: number; dark: boolean }[], s: InkPlanSettings): Job[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return slots.filter((x) => x.archived_order_id && byId.has(x.archived_order_id)).map((sl) => {
    const r = byId.get(sl.archived_order_id!)!;
    const lines = (r.data?.groups || []).flatMap((g) => g.lines || []);
    const color = lines.find((l) => l.color)?.color || "";
    const fabric = fabricOf({ garment: lines.map((l) => l.description || "").join(" "), color });
    const prints: Print[] = stepsOf(r).filter((st) => !sl.locations?.length || sl.locations.some((l) => sameLoc(l, st.location))).map((st) => {
      const { w, h } = sizeFor(st.location);
      const screens: Screen[] = Array.from({ length: st.colors }, () => ({ name: "", kind: "color" as const, mesh: s.colorMesh, coverage: s.coverage, known: false }));
      if (st.dark) screens.unshift({ name: "Underbase", kind: "underbase", mesh: s.baseMesh, coverage: unionCov(screens.map((x) => x.coverage)), known: false });
      return { location: st.location, pieces: st.qty, garmentColor: color, fabric, wIn: w, hIn: h, screens, note: "Printavo job: ink colors not named" };
    });
    return { key: `pv:${r.id}|${sl.day}`, day: sl.day, done: sl.status === "done", finishedAt: sl.finished_at, order: `Printavo #${r.visual_id ?? ""}${r.nickname ? ` ${r.nickname}` : ""}`, href: `/shop/archive/${r.id}`, label: sl.label || "", prints };
  });
}
