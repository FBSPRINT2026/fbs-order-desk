import { calcGroup, type GLine, type Group, type Settings } from "@/lib/pricing";

/** Program pricing: items a customer orders often, at a flat price per piece (any quantity), with a quick order form. */
export type ProgramImprint = { location: string; method: "screen" | "embroidery" | "dtf"; colors: number; inks: string; size: string; notes: string };
export type ProgramItem = {
  id: string; program_id: string; name: string; style: string; brand: string; garment: string; colors: string[]; sizes: string[];
  price: number; min_qty: number; imprints: ProgramImprint[]; design_id: string | null; image_path: string; notes: string; active: boolean; position: number;
  /** price breaks for this design: from min pieces, price per piece (Oct 14: Mewjira 100+ 6.25, 150+ 6.00, 200+ 5.50).
   *  price / min_qty hold the first break (the portal order form reads those) */
  tiers?: { min: number; price: number }[] | null;
  /** match by who and what instead of by name (Oct 18: Nine18's All My Sons prices): who = words in the order's name
   *  (any of them), what = the group's garment, by style number or word (any of them). Both lists given = both must hit. */
  match?: { who?: string[]; what?: string[];
    /** never when the order's name or design names have any of these (Oct 18: Armstrong's city-back and holiday shirts
     *  are custom quoted: "custom", "holiday", "4th of July"…) */
    not?: string[];
    /** only the standard print: at most this many colors on any print, and this many prints (Armstrong: 1 color, front
     *  and back = 2); a sleeve or a 2-color print isn't standard */
    maxColors?: number; maxPrints?: number;
    /** the standard logos (design ids) this price is for (Oct 18, Nick: "you would likely only know if it is a special
     *  print based on the artwork"): a print with other art is a special, custom quoted; no art linked yet = the rules above */
    designs?: string[];
    /** art that's always a special: words in the prints' art names only, not the order's name (Oct 18, Nick: Armstrong's
     *  "ARMSTRONG RALEIGH", "Armstrong Charleston SC" files are city shirts, custom quoted; the order names have the city
     *  on standard jobs too) */
    notArt?: string[] } | null;
  /** "flat": one price at any quantity; "breaks": by quantity (tiers) */
  price_mode?: "flat" | "breaks";
  /** the back picture (image_path is the front) */
  image_back?: string;
  /** the customer supplies the shirts: the shirt fields don't apply */
  supplied?: boolean;
  /** taken off the program (kept, not deleted) */
  archived_at?: string | null;
};
/** a design price's breaks, lowest first: its tiers, or its one price at its minimum */
export const tiersOf = (it: Pick<ProgramItem, "price" | "min_qty"> & { tiers?: { min: number; price: number }[] | null; price_mode?: string | null }) =>
  (it.price_mode === "flat" ? [{ min: 0, price: +it.price }] : it.tiers?.length ? it.tiers : [{ min: it.min_qty || 0, price: +it.price }]).filter((t) => +t.price > 0).map((t) => ({ min: Math.max(0, Math.round(+t.min || 0)), price: +t.price })).sort((a, b) => a.min - b.min);
export type Program = { id: string; customer_id: string; name: string; notes: string; active: boolean; rate_card?: RateCard | null;
  /** the other rate cards (Nine18: one per location or brand); rate_card is the first (migration 168) */ rate_cards?: RateCard[] | null;
  /** auto: new quotes use program pricing by themselves; ask: an Apply button on the order */ apply_mode?: "auto" | "ask" | null };
export const PROGRAM_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];

/* ───────────────────────── program rate card (Oct 14, Nick) ─────────────────────────
 * Customers between retail and wholesale (Peticolas, Nine18, Furry Feline): a short card of the prices we agreed.
 * Peticolas: a 1/1 screen print on a Next Level 6210 is $11.50 a shirt at 50 pieces or more, no setup. Another shirt
 * costs the difference in blank cost × 1.2 more (less, for a cheaper one): 6010 = 11.50 + (6010 − 6210) × 1.2.
 * 2XL+ is a flat charge per piece ($2.50 today, a setting). Below the minimum the order prices normally.
 * Staff pick "Program" on the order (next to Retail / Wholesale); the order page then puts the program price on each
 * line (GLine.prog), so every total (invoice, portal, QuickBooks) reads the same saved price. */

export type RateCard = {
  /** a customer with more than one card (Oct 17): its id ("main" for the first) and name ("Fort Worth"), and words that
   *  pick it for an order (found in the order's name, PO or ship-to) */
  id?: string; name?: string; match?: string[];
  /** the shirt the prices are for, and its blank cost (S–XL) when the card was last saved (the live cost is used when known) */
  base: { brand: string; style: string; cost?: number };
  /** the difference in blank cost is multiplied by this (1.2 = 20% on the difference) */
  markup: number;
  /** pieces per print job (group) for program prices; below it, normal pricing */
  minQty: number;
  waiveSetup: boolean;
  /** true: the price includes the shirt (Peticolas); false: print only, the garment is priced as usual */
  garmentIncluded: boolean;
  /** flat charge per piece for big sizes */
  sizeUp: Partial<Record<"2XL" | "3XL" | "4XL" | "5XL", number>>;
  /** price per piece by front colors / back colors: "1/0", "1/1", "2/1"… */
  prices: Record<string, number>;
  /** the price grid is in use (Oct 14: "toggle the rate card on and off"); not set = on when it has prices.
   *  Off, orders ignore the grid; the rules (no setup, screen price) still apply. */
  gridOn?: boolean;
  /** rules that apply to every job on Program, whatever the print */
  /** price per screen instead of the price list's (Tiger Blue: $15, they supply print-ready separations) */
  screenFee?: number | null;
  /** no setup (screens, digitizing, PMS…) on any job (Furry Feline: they supply everything and pay a flat price) */
  noSetupEver?: boolean;
  /** finishing that's part of the price (Oct 17, Nick: Peticolas's price includes roll & rubber band and printing the
   *  neck labels): no charge for these on Program; any other finishing on the job is added on top */
  included?: string[];
  /** the program's own price for extras (finishing / embroidery extras by id): Nine18 personalization $5 a name, not the
   *  list's $6. These are added on top even of a design's flat price (Oct 18) */
  extraPrices?: Record<string, number>;
  /** a design's own price includes the finishing too (Nine18); off (the default, Oct 21, Nick: Mewjira's tagging is $1
   *  on top), finishing on the job is added on top of a design's price unless it's listed in `included` */
  designsAllIn?: boolean;
  /** free local delivery by our courier (not shipping) (Oct 17, Nick: Peticolas) */
  freeDelivery?: boolean;
  /** parts of the deal the card can't hold yet, in plain words: shown on every order set to Program */
  extras?: string[];
  /** the deal in the account manager's words, newest first (kept from the Program tab's AI box) */
  about?: { text: string; by: string; at: string }[];
};
/** does the card set anything? (prices, or a rule) */
export const cardSetsAnything = (c: RateCard | null | undefined) => !!c && (Object.values(c.prices || {}).some((x) => +x > 0) || c.screenFee != null || !!c.noSetupEver || !!c.extras?.length || !!Object.keys(c.extraPrices || {}).length || !!c.included?.length || !!c.freeDelivery || !!c.designsAllIn);
export const cardHasPrices = (c: RateCard | null | undefined) => !!c && c.gridOn !== false && Object.values(c.prices || {}).some((x) => +x > 0);
export const BIG_SIZES = ["2XL", "3XL", "4XL", "5XL"] as const;
export const newRateCard = (): RateCard => ({ base: { brand: "Next Level", style: "6210" }, markup: 1.2, minQty: 50, waiveSetup: true, garmentIncluded: true, sizeUp: { "2XL": 2.5, "3XL": 2.5, "4XL": 2.5, "5XL": 2.5 }, prices: {} });
// 0 on the front = a back-only print (Oct 17, Nick); 0/0 isn't a print
export const FRONTS = [0, 1, 2, 3, 4, 5, 6], BACKS = [0, 1, 2, 3, 4, 5, 6];

const r2 = (n: number) => Math.round(n * 100) / 100;
const n0 = (v: unknown) => (typeof v === "number" ? v : +String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
const qtyOf = (l: Pick<GLine, "sizes">) => Object.values(l.sizes || {}).reduce((a: number, b) => a + n0(b), 0);

/** a print's place on the shirt: front, back, or somewhere the card doesn't cover (sleeve, neck tag…) */
function side(location: string): "front" | "back" | "other" {
  const x = (location || "").toLowerCase();
  if (/neck|tag|label|sleeve|side|leg|hood|vertical|bottom/.test(x)) return "other";
  if (/back|yoke|shoulder/.test(x)) return "back";
  if (/front|chest|pocket/.test(x)) return "front";
  return "other";
}

/** which card price a group's prints are ("2/1"), or why the card doesn't cover them */
export function printKey(g: Pick<Group, "imprints">): { key: string } | { why: string } {
  const imps = g.imprints || [];
  if (!imps.length) return { why: "no print on it yet" };
  if (imps.some((d) => d.method !== "screen")) return { why: "the card is for screen printing" };
  const fronts = imps.filter((d) => side(d.location) === "front"), backs = imps.filter((d) => side(d.location) === "back");
  const other = imps.find((d) => side(d.location) === "other");
  if (other) return { why: `${other.location || "a print"} isn't on the card` };
  if (fronts.length > 1 || backs.length > 1) return { why: "more than one print on the front or back" };
  if (!fronts.length && !backs.length) return { why: "no front or back print" };
  // a back-only print is 0/n (Oct 17)
  const f = fronts.length ? Math.max(1, n0(fronts[0].colors)) : 0, b = backs.length ? Math.max(1, n0(backs[0].colors)) : 0;
  return { key: `${f}/${b}` };
}

export type ProgramGroup = { ok: boolean; key?: string; note: string; lines: Record<string, { each: number; note: string } | null>;
  /** a design's flat price: everything in (no garment, no 2XL+ charge) */ flat?: boolean };
/**
 * The program price for each line of a group, or why there isn't one. baseCost: the base shirt's blank cost now.
 * A line whose blank cost isn't known yet gets no price (the order page fills costs from the catalog first).
 */
/** a design's own program price (Oct 14, Nick: "Mewjira, 200 pieces at $5.50… this one is by design"): a program item
 *  linked to the design, or named like it (Printavo-era orders have no design links) */
export type DesignPrice = Pick<ProgramItem, "id" | "name" | "style" | "price" | "min_qty" | "design_id" | "active" | "tiers" | "price_mode" | "supplied" | "match"> & { imprints?: ProgramImprint[] };
export type DesignCtx = { items: DesignPrice[]; /** the order's name and its prints' design names */ text: string; /** the group's garments: styles, brands, names */ garments?: string; /** the prints' art names only */ art?: string;
  /** each line's own garment text (by line id): a group with helper tees and hoodies prices each by its own garment
   *  (Oct 30, Nick: All My Sons tees $1.35, hoodies $1.50 on one job) */ lineGarments?: Record<string, string> };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function designPrice(g: Pick<Group, "imprints">, qty: number, d: DesignCtx): { item?: DesignPrice; under?: DesignPrice } {
  const ids = new Set((g.imprints || []).map((x) => x.design_id).filter(Boolean));
  const text = ` ${norm(d.text)} `;
  const linked = d.items.filter((it) => it.active && tiersOf(it).length && it.design_id && ids.has(it.design_id));
  let hits = linked;
  // by who and what (Nine18: "All My Sons" jobs, polos by style or word); plurals count ("polos", "hats")
  if (!hits.length) {
    const sing = (s: string) => ` ${norm(s).split(" ").map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)).join(" ")} `;
    const who = sing(d.text), what = sing(d.garments || "");
    const has = (hay: string, list?: string[]) => (list || []).map((x) => sing(x).trim()).filter(Boolean).some((x) => hay.includes(` ${x} `));
    // and the same decoration: a printed-tee price never lands on an embroidered tee
    const methods = new Set((g.imprints || []).map((x) => x.method).filter(Boolean));
    const sameMethod = (it: DesignPrice) => { const m = it.imprints?.[0]?.method; return !m || !methods.size || methods.has(m); };
    const imps = g.imprints || [];
    const standard = (it: DesignPrice) => (!it.match?.maxColors || imps.every((x) => (+(x as { colors?: number }).colors! || 1) <= it.match!.maxColors!))
      && (!it.match?.maxPrints || imps.length <= it.match.maxPrints);
    const art = imps.map((x) => x.design_id).filter(Boolean) as string[];
    const standardArt = (it: DesignPrice) => !it.match?.designs?.length || !art.length || art.every((id) => it.match!.designs!.includes(id));
    hits = d.items.filter((it) => it.active && tiersOf(it).length && (it.match?.who?.length || it.match?.what?.length) && standardArt(it)
      && (!it.match?.who?.length || has(who, it.match.who)) && (!it.match?.what?.length || has(what, it.match.what))
      && !(it.match?.not?.length && has(who, it.match.not)) && !(it.match?.notArt?.length && has(sing(d.art || ""), it.match.notArt)) && sameMethod(it) && standard(it));
    // the most specific match wins: a style number ("W961") over a word, a longer phrase ("knit cap") over one word
    // ("short" is in "Short Sleeve UV Daybreak Shirt"), and any garment match over a catch-all with no garment list
    const fit = (it: DesignPrice) => Math.max(0, ...(it.match?.what || []).map((x) => sing(x).trim()).filter((x) => x && what.includes(` ${x} `))
      .map((x) => (/\d/.test(x) ? 100 : x.split(" ").length)));
    const best = Math.max(0, ...hits.map(fit));
    hits = hits.filter((it) => fit(it) === best);
  }
  if (!hits.length) {
    const named = d.items.filter((it) => it.active && tiersOf(it).length && !(it.match?.who?.length || it.match?.what?.length) && norm(it.name).length >= 3 && text.includes(` ${norm(it.name)} `));
    // the most specific name wins: "Rice Life Totes" over "Rice Life", "SPICY Deep Shit Pizza" over "Deep Shit Pizza"
    hits = named.filter((it) => !named.some((o) => o !== it && norm(o.name).length > norm(it.name).length && ` ${norm(o.name)} `.includes(` ${norm(it.name)} `)));
  }
  if (!hits.length) return {};
  // every break of every matching entry, highest minimum first: the first one the quantity reaches
  const breaks = hits.flatMap((it) => tiersOf(it).map((t) => ({ ...it, price: t.price, min_qty: t.min }))).sort((a, b) => (b.min_qty || 0) - (a.min_qty || 0));
  const item = breaks.find((it) => qty >= (it.min_qty || 0));
  return item ? { item } : { under: breaks[breaks.length - 1] };
}

export function programForGroup(g: Group, card: RateCard | null, baseCost: number | null, design?: DesignCtx): ProgramGroup {
  const qty = (g.lines || []).reduce((a, l) => a + qtyOf(l), 0);
  const none = (note: string): ProgramGroup => ({ ok: false, note, lines: {} });
  // the design's own price first
  let pre = "";
  if (design?.items.length) {
    const dp = designPrice(g, qty, design);
    if (dp.item) {
      const it = dp.item, lines: ProgramGroup["lines"] = {};
      const names = new Set<string>();
      for (const l of g.lines || []) {
        if (!qtyOf(l)) { lines[l.id] = null; continue; }
        // the line's own garment picks its price when it has one (same quantity break as the group)
        const own = design.lineGarments?.[l.id] ? designPrice(g, qty, { ...design, garments: design.lineGarments[l.id] }).item : undefined;
        const x = own || it;
        names.add(x.name);
        lines[l.id] = { each: r2(+x.price), note: `${x.name} program price: ${(+x.price).toFixed(2)}${x.min_qty ? ` at ${x.min_qty}+` : ""}` };
      }
      const one = names.size <= 1;
      return { ok: true, flat: true, key: one ? it.name : [...names].join(" + "), note: one ? `${it.name}: ${(+it.price).toFixed(2)} a piece${it.min_qty ? ` at ${it.min_qty}+` : ""}, ${qty} pieces` : `${[...names].join(" + ")}: each garment at its own program price, ${qty} pieces`, lines };
    }
    if (dp.under) pre = `${dp.under.name} program price starts at ${dp.under.min_qty} (this is ${qty}); `;
  }
  if (!card || card.gridOn === false) return none(`${pre}no rate card`);
  const k = printKey(g);
  if ("why" in k) return none(`${pre}no program price: ${k.why}`);
  const price = card.prices?.[k.key];
  if (!price) return none(`${pre}no program price set for ${k.key}`);
  if (qty < (card.minQty || 0)) return none(`${pre}${qty} piece${qty === 1 ? "" : "s"}; the program starts at ${card.minQty}`);
  const lines: ProgramGroup["lines"] = {};
  let all = true;
  for (const l of g.lines || []) {
    if (!qtyOf(l)) { lines[l.id] = null; continue; }
    if (!card.garmentIncluded) { lines[l.id] = { each: price, note: `Program ${k.key}: ${price.toFixed(2)} print` }; continue; }
    const same = (l.style || "").trim().toLowerCase() === card.base.style.trim().toLowerCase();
    if (same) { lines[l.id] = { each: r2(price), note: `Program ${k.key} on ${card.base.style}: ${price.toFixed(2)}` }; continue; }
    const cost = n0(l.cost);
    if (!cost || baseCost == null) { lines[l.id] = null; all = false; continue; }
    const diff = r2((cost - baseCost) * (card.markup || 1));
    lines[l.id] = { each: r2(price + diff), note: `Program ${k.key}: ${price.toFixed(2)} ${diff < 0 ? `− (${baseCost.toFixed(2)} − ${cost.toFixed(2)})` : `+ (${cost.toFixed(2)} − ${baseCost.toFixed(2)})`} × ${card.markup} = ${r2(price + diff).toFixed(2)}` };
  }
  return { ok: all, key: k.key, note: all ? `program ${k.key}, ${qty} pieces` : "program price waits for a blank cost", lines };
}

/* ───────── a price for a quantity they've never had (Oct 14, Nick: "if they reorder a design that's part of their
   program at a quantity we've never done… recommend a price. I would have wanted you to get to 200 at $5.50") ─────────
   Their nearest real price, moved by as much as the retail table moves between that quantity and this one:
   Mewjira $6.00 at 150 × (retail $6.29 at 200 ÷ $6.88 at 150) = $5.48 → $5.50. Only above their top break or under
   their lowest one (between breaks, the breaks they agreed to apply). Rounded to 5 cents. */
export type PriceSuggestion = { itemId: string; name: string; qty: number; refQty: number; refPrice: number; retailRef: number; retailNow: number; price: number; above: boolean };
const qtyOfG = (g: Pick<Group, "lines">) => (g.lines || []).reduce((a, l) => a + qtyOf(l), 0);
/** the retail table's price per piece for this group's prints at a quantity (their shirts: no garment) */
export function retailEach(g: Group, qty: number, s: Settings, supplied: boolean): number {
  const l0 = (g.lines || []).find((l) => qtyOf(l) > 0) || g.lines?.[0];
  if (!l0 || qty <= 0) return 0;
  const line: GLine = { ...l0, id: "x", cost: supplied ? "" : l0.cost, sizes: { L: qty }, priceOverride: null, prog: undefined, progOff: undefined };
  const c = calcGroup({ ...g, lines: [line], screenFee: undefined }, { waive_setup: true, price_type: "retail" }, s);
  return c.lines[0]?.calcEach || 0;
}
export function suggestDesignPrice(g: Group, d: DesignCtx, s: Settings): PriceSuggestion | null {
  const qty = qtyOfG(g);
  if (!qty || !d.items.length) return null;
  const dp = designPrice(g, qty, d);
  const hit = dp.item || dp.under;
  if (!hit) return null;
  const orig = d.items.find((x) => x.id === hit.id);
  if (!orig || orig.price_mode === "flat") return null;
  const t = tiersOf(orig);
  if (!t.length) return null;
  const top = t[t.length - 1], low = t[0];
  let ref: { min: number; price: number };
  if (dp.item) { if (qty <= top.min || hit.min_qty !== top.min) return null; ref = top; }
  else ref = low;
  if (!ref.min) return null;
  // only a real jump (Nick: "150 to 160 you don't change anything… 150 to 200 justifies a fresh look"): at least 25% more
  // pieces (or 20% fewer) than their price break, and the retail table moving 5% or more
  if (qty < ref.min * 1.25 && qty > ref.min * 0.8) return null;
  const supplied = !!orig.supplied;
  const a = retailEach(g, ref.min, s, supplied), b = retailEach(g, qty, s, supplied);
  if (!a || !b || Math.abs(b / a - 1) < 0.05) return null;
  const price = Math.round((ref.price * b) / a / 0.05) * 0.05;
  if (Math.abs(price - ref.price) < 0.01) return null;
  return { itemId: orig.id, name: orig.name, qty, refQty: ref.min, refPrice: ref.price, retailRef: r2(a), retailNow: r2(b), price: r2(price), above: !!dp.item };
}

/** finishing that's often part of a program price (the shop's own finishing list is offered too) */
// neck labels = removing the maker's tags and printing ours: called "Private Label (Remove MFG Tags)" (Oct 17, Nick)
export const COMMON_INCLUDED = ["Roll & rubber band", "Private Label (Remove MFG Tags)", "Fold & bag", "Hang tag", "Individual poly bag", "Sticker in the bag"];
const finNorm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
/** is this finishing item part of the card's price? */
export const finishingIncluded = (card: Pick<RateCard, "included"> | null | undefined, f: { id?: string; name: string }) =>
  !!card?.included?.some((x) => finNorm(x) === finNorm(f.name) || (!!f.id && finNorm(x) === finNorm(f.id)));

/** every rate card of a program, the first (rate_card) as "main" */
export function cardsOf(p: Pick<Program, "rate_card" | "rate_cards"> | null | undefined): (RateCard & { id: string })[] {
  if (!p) return [];
  const out: (RateCard & { id: string })[] = [];
  if (p.rate_card) out.push({ ...p.rate_card, id: "main" });
  for (const c of p.rate_cards || []) if (c && c.id) out.push({ ...c, id: c.id });
  return out;
}
/** the card an order uses: the one picked on it, else the first whose name or words show up in the order, else the first */
export function cardForOrder<T extends { id: string; name?: string; match?: string[] }>(cards: T[], o: { program_card?: string | null; nickname?: string | null; po_number?: string | null; ship_to?: string | null }): T | null {
  if (!cards.length) return null;
  const picked = o.program_card ? cards.find((c) => c.id === o.program_card) : null;
  if (picked) return picked;
  const hay = ` ${[o.nickname, o.po_number, o.ship_to].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hit = cards.find((c) => [c.name || "", ...(c.match || [])].map((w) => w.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter((w) => w.length >= 2).some((w) => hay.includes(` ${w} `)));
  return hit || cards[0];
}
