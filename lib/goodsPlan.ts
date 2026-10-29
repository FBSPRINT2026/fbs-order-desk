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
/** S&S, SanMar, and One Stop (the third choice: only for what the first two can't fill; lib/onestop.ts) */
export type Sup = "ss" | "sm" | "os";
export type Src = { sup: Sup; wh: string; stock: number; price: number; /** offered only to reach a supplier's free-shipping amount (One Stop's $175), never planned on its own */ topUp?: boolean };
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
/** One Stop ships from Grand Rapids, MI 49544 (Oct 29, Nick): UPS Ground to Richardson is 3 business days ("the shipping takes a long time") */
export const OS_WH: Record<string, [string, string, number]> = { MI: ["Michigan (One Stop)", "One Stop", 3] };
export const supName = (s: Sup) => (s === "ss" ? "S&S" : s === "os" ? "One Stop" : "SanMar");
export const whInfo = (sup: Sup, wh: string): { name: string; short: string; days: number } => {
  const x = (sup === "ss" ? SS_WH : sup === "os" ? OS_WH : SM_WH)[wh];
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
const SUP_RANK: Record<Sup, number> = { ss: 0, sm: 1, os: 2 };
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
  if (a.sup !== b.sup) return SUP_RANK[a.sup] - SUP_RANK[b.sup]; // S&S first (no card fee), One Stop last
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

/* ---------- arrival-day options (Oct 27, Nick) ----------
 * "you should treat it by date… like UPS does… arrive Thursday, this cost". One option per arrival day: the cheapest
 * way to have everything here that day, with the fewest shipments when that costs nothing more ("easiest is never
 * available if it costs more"). A later day only shows when it's cheaper. On a big run, a split that gets most of the
 * goods here sooner is its own option ("the majority of the goods here Wednesday and one box Thursday… so that we can
 * start running it"). Shipping is free at both suppliers: only the goods and SanMar's card fee count (points come back
 * on both, the same share of what's paid, so they never change the order of the options). */
export type DayOption = Plan & { kind: "full" | "early"; start: number; startPcs: number; pcs: number; /** pieces moved to One Stop to reach its free shipping */ topUp?: TopUp };
export type TopUp = { pcs: number; extra: number; freight: number; amount: number };
export type Pick = { option: DayOption; i: number; why: string; tone: "best" | "trade"; cheapest: DayOption; late: boolean };

const startOf = (p: Plan, share = 0.8) => {
  const pcs = p.parts.reduce((a, x) => a + x.qty, 0);
  const days = [...new Set(p.parts.map((x) => x.days))].sort((a, b) => a - b);
  let got = 0;
  for (const d of days) { got += p.parts.filter((x) => x.days === d).reduce((a, x) => a + x.qty, 0); if (got >= pcs * share) return { start: d, startPcs: got, pcs }; }
  return { start: p.days, startPcs: pcs, pcs };
};

export function dayOptions(items: PlanItem[], feePct: number, bigRun = 250, top?: { freeAt: number; freight: number }): DayOption[] {
  const out = dayOptions0(items.map((i) => ({ ...i, srcs: i.srcs.filter((s) => !s.topUp) })), feePct, bigRun);
  return top ? out.map((o) => osTopUp(o, items, feePct, top.freeAt, top.freight)) : out;
}

/**
 * One Stop's free ground starts at $175 (Oct 29, Nick: "if it's 40 cents more at One Stop per item and we need to add 10
 * more items for $4 to avoid $30 shipping, we would do that"). When a plan already buys something from One Stop (a size
 * the others are out of) but under $175, move pieces One Stop also has from the other suppliers, the ones that cost the
 * least more first, until it reaches $175, and keep that only when the extra is less than the freight it saves.
 * `freight`: what One Stop charges for ground under $175, learned from their checks (goodsOptions).
 */
export function osTopUp<T extends Plan & { topUp?: TopUp }>(p: T, items: PlanItem[], feePct: number, freeAt: number, freight: number): T {
  const osAmt = p.parts.filter((x) => x.sup === "os").reduce((a, x) => a + x.qty * x.each, 0);
  if (!osAmt || osAmt >= freeAt - 0.005 || freight <= 0) return p;
  const used = new Map<string, number>();
  for (const x of p.parts) if (x.sup === "os") used.set(x.key, (used.get(x.key) || 0) + x.qty);
  const cands = p.parts.filter((x) => x.sup !== "os").map((x) => {
    const src = items.find((i) => i.key === x.key)?.srcs.find((s) => s.sup === "os" && s.stock > 0);
    return src ? { part: x, src, left: src.stock - (used.get(x.key) || 0), per: (src.price - x.each) / src.price } : null;
  }).filter((c): c is NonNullable<typeof c> => !!c && c.left > 0).sort((a, b) => a.per - b.per);
  let amt = osAmt, extra = 0, pcs = 0;
  const moves: { part: Part; src: Src; n: number }[] = [];
  for (const c of cands) {
    if (amt >= freeAt - 0.005) break;
    const n = Math.min(c.part.qty, c.left, Math.ceil((freeAt - amt) / c.src.price));
    if (n <= 0) continue;
    moves.push({ part: c.part, src: c.src, n });
    amt += n * c.src.price; extra += n * (c.src.price - c.part.each); pcs += n;
  }
  if (amt < freeAt - 0.005 || extra >= freight) return p;
  const parts: Part[] = p.parts.map((x) => ({ ...x }));
  for (const m of moves) {
    const from = parts.find((x) => x.key === m.part.key && x.sup === m.part.sup && x.wh === m.part.wh)!;
    from.qty -= m.n;
    const to = parts.find((x) => x.key === m.part.key && x.sup === "os");
    if (to) to.qty += m.n; else parts.push({ key: m.part.key, sup: "os", wh: m.src.wh, qty: m.n, each: Math.round(costOf(m.src, feePct) * 10000) / 10000, days: whInfo("os", m.src.wh).days });
  }
  const kept = parts.filter((x) => x.qty > 0);
  return { ...p, ...sum(p.mode, kept, p.short, feePct), topUp: { pcs, extra: Math.round(extra * 100) / 100, freight, amount: Math.round(amt * 100) / 100 } };
}

function dayOptions0(items: PlanItem[], feePct: number, bigRun = 250): DayOption[] {
  const its = items.filter((i) => i.qty > 0);
  const all = its.flatMap((i) => i.srcs.filter((s) => s.stock > 0));
  const days = [...new Set(all.map((s) => whInfo(s.sup, s.wh).days))].sort((a, b) => a - b);
  const out: DayOption[] = [];
  for (const d of days) {
    const sub = its.map((i) => ({ ...i, srcs: i.srcs.filter((s) => s.stock > 0 && whInfo(s.sup, s.wh).days <= d) }));
    const cheap = makePlan(sub, "cheap", feePct);
    if (cheap.short.length) continue;
    // the fewest shipments at that same cost
    const easy = makePlan(sub, "easy", feePct);
    const p = !easy.short.length && easy.total <= cheap.total + 0.005 && easy.ships < cheap.ships ? easy : cheap;
    const prev = out[out.length - 1];
    // a later day shows only when it's cheaper or takes fewer shipments than every sooner one
    if (p.days <= (prev?.days ?? -1) || out.some((o) => p.total >= o.total - 0.005 && p.ships >= o.ships)) continue;
    out.push({ ...p, kind: "full", ...startOf(p) });
  }
  if (!out.length) {
    // nobody has all of it: the cheapest that can be had, with what's short
    const p = makePlan(its, "cheap", feePct);
    out.push({ ...p, kind: "full", ...startOf(p) });
  }
  const pcs = its.reduce((a, i) => a + i.qty, 0);
  if (pcs > bigRun) {
    const f = makePlan(its, "fast", feePct), s = startOf(f);
    if (!f.short.length && s.start < out[0].days && s.start < f.days) out.unshift({ ...f, kind: "early", ...s });
  }
  return out;
}

/**
 * The one to order (Oct 27, Nick: "it's always fastest and cheapest… if it's not cheapest and fastest, then we have to
 * make the decision… under 250 pieces… go easiest… over 250 pieces… go with fastest… if you have to run it earlier and
 * you're missing a box"):
 *   1. one way is both the cheapest and the soonest: that one.
 *   2. otherwise, `split` pieces or fewer: the easiest, the fewest shipments, never costing more than the cheapest
 *      ("we're never going to pay more for it to be easy"), then the soonest.
 *   3. over `split` pieces: the fastest, the soonest the run can start (most of it here, a box may follow), then the
 *      cheapest.
 * When the goods are needed by a day (an order), only ways that are here in time are picked, if there are any.
 */
export function pickOption(opts: DayOption[], needBy: Date | null, split = 250): Pick {
  const pcs = opts[0]?.pcs || 0, big = pcs > split;
  const startDay = (o: DayOption) => (big ? o.start : o.days);
  const when = (o: DayOption) => arriveOn(startDay(o));
  const cheapest = [...opts].sort((a, b) => a.total - b.total || a.days - b.days || a.ships - b.ships)[0];
  const soonest = [...opts].sort((a, b) => startDay(a) - startDay(b) || a.total - b.total || a.ships - b.ships)[0];
  const at = (o: DayOption) => opts.indexOf(o);
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short" });
  const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lateOf = (o: DayOption) => !!needBy && when(o) > needBy;
  if (cheapest === soonest || (startDay(cheapest) === startDay(soonest) && Math.abs(cheapest.total - soonest.total) < 0.005)) return { option: cheapest, i: at(cheapest), why: "Cheapest and fastest", tone: "best", cheapest, late: lateOf(cheapest) };
  const pool = needBy && opts.some((o) => !lateOf(o)) ? opts.filter((o) => !lateOf(o)) : opts;
  const floor = Math.min(...pool.map((o) => o.total));
  let o: DayOption, why: string;
  if (!big) {
    o = [...pool].filter((x) => x.total <= floor + 0.005).sort((a, b) => a.ships - b.ships || a.days - b.days)[0];
    why = `Cheapest and fastest isn't one option: easiest, ${o.ships === 1 ? "one shipment" : `${o.ships} shipments`}${o.total > cheapest.total + 0.005 ? `, ${money(o.total - cheapest.total)} more to be here by ${needBy ? day(needBy) : "then"}` : ""}`;
  } else {
    o = [...pool].sort((a, b) => startDay(a) - startDay(b) || a.total - b.total || a.ships - b.ships)[0];
    const extra = o.total - cheapest.total;
    why = `Cheapest and fastest isn't one option: fastest, ${o.kind === "early" ? `${o.startPcs.toLocaleString("en-US")} of ${o.pcs.toLocaleString("en-US")} pcs here ${day(arriveOn(o.start))} to start the run` : `here ${day(arriveOn(o.days))}`}${extra > 0.005 ? `, ${money(extra)} more than the cheapest` : ""}`;
  }
  return { option: o, i: at(o), why, tone: "trade", cheapest, late: lateOf(o) };
}
