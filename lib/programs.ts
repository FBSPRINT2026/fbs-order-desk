import type { GLine, Group } from "@/lib/pricing";

/** Program pricing: items a customer orders often, at a flat price per piece (any quantity), with a quick order form. */
export type ProgramImprint = { location: string; method: "screen" | "embroidery" | "dtf"; colors: number; inks: string; size: string; notes: string };
export type ProgramItem = {
  id: string; program_id: string; name: string; style: string; brand: string; garment: string; colors: string[]; sizes: string[];
  price: number; min_qty: number; imprints: ProgramImprint[]; design_id: string | null; image_path: string; notes: string; active: boolean; position: number;
  /** price breaks for this design: from min pieces, price per piece (Oct 14: Mewjira 100+ 6.25, 150+ 6.00, 200+ 5.50).
   *  price / min_qty hold the first break (the portal order form reads those) */
  tiers?: { min: number; price: number }[] | null;
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
export type Program = { id: string; customer_id: string; name: string; notes: string; active: boolean; rate_card?: RateCard | null };
export const PROGRAM_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];

/* ───────────────────────── program rate card (Oct 14, Nick) ─────────────────────────
 * Customers between retail and wholesale (Peticolas, Nine18, Furry Feline): a short card of the prices we agreed.
 * Peticolas: a 1/1 screen print on a Next Level 6210 is $11.50 a shirt at 50 pieces or more, no setup. Another shirt
 * costs the difference in blank cost × 1.2 more (less, for a cheaper one): 6010 = 11.50 + (6010 − 6210) × 1.2.
 * 2XL+ is a flat charge per piece ($2.50 today, a setting). Below the minimum the order prices normally.
 * Staff pick "Program" on the order (next to Retail / Wholesale); the order page then puts the program price on each
 * line (GLine.prog), so every total (invoice, portal, QuickBooks) reads the same saved price. */

export type RateCard = {
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
  /** parts of the deal the card can't hold yet, in plain words: shown on every order set to Program */
  extras?: string[];
  /** the deal in the account manager's words, newest first (kept from the Program tab's AI box) */
  about?: { text: string; by: string; at: string }[];
};
/** does the card set anything? (prices, or a rule) */
export const cardSetsAnything = (c: RateCard | null | undefined) => !!c && (Object.values(c.prices || {}).some((x) => +x > 0) || c.screenFee != null || !!c.noSetupEver || !!c.extras?.length);
export const cardHasPrices = (c: RateCard | null | undefined) => !!c && c.gridOn !== false && Object.values(c.prices || {}).some((x) => +x > 0);
export const BIG_SIZES = ["2XL", "3XL", "4XL", "5XL"] as const;
export const newRateCard = (): RateCard => ({ base: { brand: "Next Level", style: "6210" }, markup: 1.2, minQty: 50, waiveSetup: true, garmentIncluded: true, sizeUp: { "2XL": 2.5, "3XL": 2.5, "4XL": 2.5, "5XL": 2.5 }, prices: {} });
export const FRONTS = [1, 2, 3, 4, 5, 6], BACKS = [0, 1, 2, 3, 4, 5, 6];

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
  if (fronts.length !== 1 || backs.length > 1) return { why: fronts.length ? "more than one print on the front or back" : "no front print" };
  const f = Math.max(1, n0(fronts[0].colors)), b = backs.length ? Math.max(1, n0(backs[0].colors)) : 0;
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
export type DesignPrice = Pick<ProgramItem, "id" | "name" | "style" | "price" | "min_qty" | "design_id" | "active" | "tiers" | "price_mode">;
export type DesignCtx = { items: DesignPrice[]; /** the order's name and its prints' design names */ text: string };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function designPrice(g: Pick<Group, "imprints">, qty: number, d: DesignCtx): { item?: DesignPrice; under?: DesignPrice } {
  const ids = new Set((g.imprints || []).map((x) => x.design_id).filter(Boolean));
  const text = ` ${norm(d.text)} `;
  const hits = d.items.filter((it) => it.active && tiersOf(it).length && ((it.design_id && ids.has(it.design_id)) || (norm(it.name).length >= 3 && text.includes(` ${norm(it.name)} `))));
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
      for (const l of g.lines || []) lines[l.id] = qtyOf(l) ? { each: r2(+it.price), note: `${it.name} program price: ${(+it.price).toFixed(2)}${it.min_qty ? ` at ${it.min_qty}+` : ""}` } : null;
      return { ok: true, flat: true, key: it.name, note: `${it.name}: ${(+it.price).toFixed(2)} a piece${it.min_qty ? ` at ${it.min_qty}+` : ""}, ${qty} pieces`, lines };
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
