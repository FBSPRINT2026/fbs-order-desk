/**
 * Order goods across S&S and SanMar (Oct 27, Nick: "you should be able to determine who gives us the better deal…
 * quickest vs cheapest… split between the suppliers if something is like out of stock in Dallas partially within a line
 * item… we get free credit card processing at S&S… that's 3.5%… we have to pay at SanMar… if pricing is the same at them
 * both, then S&S would win… easiest… fewer shipments… one set of UPS tracking from one location").
 *
 * Every size (a "key") can come from any warehouse of either supplier that has it. Three plans:
 *   easy  - fewest shipments (warehouses), then the cheapest of those, then the soonest
 *   cheap - lowest cost for each size (SanMar with our card fee added; a tie goes to S&S), then the soonest
 *   fast  - the soonest warehouse for each size, then the cheapest
 * A size is split between warehouses only when one can't cover it. Pure: used by the Order goods panel.
 */
export type Sup = "ss" | "sm";
export type Src = { sup: Sup; wh: string; stock: number; price: number };
export type PlanItem = { key: string; qty: number; srcs: Src[] };
export type PlanMode = "easy" | "cheap" | "fast";
export type Part = { key: string; sup: Sup; wh: string; qty: number; each: number; days: number };
export type Plan = { mode: PlanMode; parts: Part[]; short: { key: string; qty: number }[]; total: number; fee: number; ships: number; days: number };

/** S&S warehouses (their codes) and SanMar's (warehouse numbers): the name, a short name, and UPS Ground days to us (an
 *  estimate from Fort Worth; S&S's check gives the real date) */
export const SS_WH: Record<string, [string, string, number]> = {
  TX: ["Fort Worth, TX", "Fort Worth", 1], KS: ["Kansas City, KS", "Kansas City", 2], IL: ["Lockport, IL", "Illinois", 2], GA: ["McDonough, GA", "Georgia", 3],
  OH: ["West Chester, OH", "Ohio", 3], KY: ["Louisville, KY", "Kentucky", 3], PA: ["Reading, PA", "Pennsylvania", 4], NV: ["Reno, NV", "Reno", 3],
  NJ: ["Robbinsville, NJ", "New Jersey", 4], FL: ["Orlando, FL", "Florida", 3], CA: ["Fontana, CA", "California", 3], MA: ["Middleboro, MA", "Massachusetts", 4], DS: ["Mill direct", "Mill", 5],
};
export const SM_WH: Record<string, [string, string, number]> = {
  "3": ["Dallas, TX", "Dallas", 1], "12": ["Phoenix, AZ", "Phoenix", 2], "2": ["Cincinnati, OH", "Cincinnati", 3], "7": ["Minneapolis, MN", "Minneapolis", 3],
  "6": ["Jacksonville, FL", "Jacksonville", 3], "31": ["Richmond, VA", "Richmond", 3], "4": ["Reno, NV", "Reno", 3], "5": ["Robbinsville, NJ", "Robbinsville", 4], "1": ["Seattle, WA", "Seattle", 4],
};
export const supName = (s: Sup) => (s === "ss" ? "S&S" : "SanMar");
export const whInfo = (sup: Sup, wh: string): { name: string; short: string; days: number } => {
  const x = (sup === "ss" ? SS_WH : SM_WH)[wh];
  return x ? { name: x[0], short: x[1], days: x[2] } : { name: sup === "sm" ? `Warehouse ${wh}` : wh, short: wh, days: 4 };
};
export const shipKey = (p: { sup: Sup; wh: string }) => `${p.sup}:${p.wh}`;

/** the day goods ordered now arrive, `days` business days of UPS Ground (orders after 1 pm Central ship tomorrow) */
export function arriveOn(days: number, now = new Date()): Date {
  const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const d = new Date(ct.getFullYear(), ct.getMonth(), ct.getDate());
  let n = days + (ct.getHours() >= 13 ? 1 : 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}

const costOf = (s: Src, feePct: number) => (s.sup === "sm" ? s.price * (1 + feePct / 100) : s.price);
const even = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** fill one size from sources in the given order */
function fill(it: PlanItem, order: Src[], feePct: number, parts: Part[], short: Plan["short"]) {
  let need = it.qty;
  for (const s of order) {
    if (need <= 0) break;
    const t = Math.min(need, s.stock);
    if (t > 0) { parts.push({ key: it.key, sup: s.sup, wh: s.wh, qty: t, each: Math.round(costOf(s, feePct) * 10000) / 10000, days: whInfo(s.sup, s.wh).days }); need -= t; }
  }
  if (need > 0) short.push({ key: it.key, qty: need });
}
const byCheap = (feePct: number) => (a: Src, b: Src) => {
  const ca = costOf(a, feePct), cb = costOf(b, feePct);
  if (!even(ca, cb)) return ca - cb;
  if (a.sup !== b.sup) return a.sup === "ss" ? -1 : 1; // no card fee at S&S
  return whInfo(a.sup, a.wh).days - whInfo(b.sup, b.wh).days;
};
const byFast = (feePct: number) => (a: Src, b: Src) => whInfo(a.sup, a.wh).days - whInfo(b.sup, b.wh).days || byCheap(feePct)(a, b);

function sum(mode: PlanMode, parts: Part[], short: Plan["short"], feePct: number): Plan {
  const total = parts.reduce((a, p) => a + p.qty * p.each, 0);
  const fee = parts.filter((p) => p.sup === "sm").reduce((a, p) => a + p.qty * (p.each - p.each / (1 + feePct / 100)), 0);
  return { mode, parts, short, total: Math.round(total * 100) / 100, fee: Math.round(fee * 100) / 100, ships: new Set(parts.map(shipKey)).size, days: parts.reduce((a, p) => Math.max(a, p.days), 0) };
}

export function makePlan(items: PlanItem[], mode: PlanMode, feePct: number): Plan {
  const its = items.filter((i) => i.qty > 0);
  if (mode !== "easy") {
    const parts: Part[] = [], short: Plan["short"] = [];
    for (const it of its) fill(it, [...it.srcs].filter((s) => s.stock > 0).sort(mode === "cheap" ? byCheap(feePct) : byFast(feePct)), feePct, parts, short);
    return sum(mode, parts, short, feePct);
  }
  // easiest: the fewest warehouses that cover everything (each size filled cheapest within them)
  const inSet = (set: Set<string>) => { const parts: Part[] = [], short: Plan["short"] = []; for (const it of its) fill(it, it.srcs.filter((s) => s.stock > 0 && set.has(shipKey(s))).sort(byCheap(feePct)), feePct, parts, short); return sum("easy", parts, short, feePct); };
  const covers = (set: Set<string>) => its.every((it) => it.srcs.filter((s) => set.has(shipKey(s))).reduce((a, s) => a + s.stock, 0) >= it.qty);
  const avail = (it: PlanItem) => it.srcs.reduce((a, s) => a + Math.max(0, s.stock), 0);
  const need = its.filter((it) => avail(it) >= it.qty); // sizes nobody has enough of are left short either way
  // the warehouses worth trying: those holding the most of what's needed (kept small so the search stays quick)
  const score = new Map<string, number>();
  for (const it of its) for (const s of it.srcs) if (s.stock > 0) score.set(shipKey(s), (score.get(shipKey(s)) || 0) + Math.min(s.stock, it.qty));
  const whs = [...score].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k);
  const coverNeed = (set: Set<string>) => need.every((it) => it.srcs.filter((s) => set.has(shipKey(s))).reduce((a, s) => a + s.stock, 0) >= it.qty);
  let best: Plan | null = null;
  const better = (a: Plan, b: Plan | null) => !b || (!even(a.total, b.total) ? a.total < b.total : a.parts.filter((p) => p.sup === "sm").length !== b.parts.filter((p) => p.sup === "sm").length ? a.parts.filter((p) => p.sup === "sm").length < b.parts.filter((p) => p.sup === "sm").length : a.days < b.days);
  const combos = function* (k: number, start = 0, acc: string[] = []): Generator<string[]> {
    if (acc.length === k) { yield acc; return; }
    for (let i = start; i < whs.length; i++) yield* combos(k, i + 1, [...acc, whs[i]]);
  };
  for (let k = 1; k <= Math.min(4, whs.length) && !best; k++) {
    for (const c of combos(k)) { const set = new Set(c); if (!(covers(set) || coverNeed(set))) continue; const p = inSet(set); if (better(p, best)) best = p; }
  }
  if (best) return best;
  // too spread out for that: take the warehouse that covers the most of what's left, then the next…
  const set = new Set<string>(); const left = new Map(its.map((it) => [it.key, it.qty]));
  while ([...left.values()].some((q) => q > 0)) {
    let pick = "", got = 0;
    for (const w of score.keys()) {
      if (set.has(w)) continue;
      const g = its.reduce((a, it) => a + Math.min(left.get(it.key) || 0, it.srcs.filter((s) => shipKey(s) === w).reduce((n, s) => n + s.stock, 0)), 0);
      if (g > got) { got = g; pick = w; }
    }
    if (!pick) break;
    set.add(pick);
    for (const it of its) { const have = it.srcs.filter((s) => shipKey(s) === pick).reduce((n, s) => n + s.stock, 0); left.set(it.key, Math.max(0, (left.get(it.key) || 0) - have)); }
  }
  return inSet(set);
}
