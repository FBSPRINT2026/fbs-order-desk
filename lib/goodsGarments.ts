import { uid, type GLine, type Group } from "@/lib/pricing";
import { sizeRank } from "@/lib/sizeOrder";

/**
 * Goods bought ahead from an email, before there's an order (Oct 26, Nick: "if I'm ordering goods… without an order it's
 * because I'm on the road and I've gotta do it in a pinch… you need to save it so that later, we don't have to make any
 * decisions again about what the customer meant"). Saved on the goods order (blank_orders.garments) as what was bought,
 * one entry per garment and color with its sizes; Create order offers them and, on yes, the order's lines become them.
 */
export type GoodsGarment = { brand: string; style: string; name?: string; color: string; sizes: Record<string, number> };

/** the goods rows (one per size) folded into one entry per garment and color */
export function garmentsFromRows(rows: { brand: string; style: string; color: string; size: string; qty: number }[]): GoodsGarment[] {
  const out: GoodsGarment[] = [];
  for (const r of rows) {
    if (!r.style || !(r.qty > 0)) continue;
    const k = `${r.brand}|${r.style}|${r.color}`.toLowerCase();
    let g = out.find((x) => `${x.brand}|${x.style}|${x.color}`.toLowerCase() === k);
    if (!g) { g = { brand: r.brand, style: r.style, color: r.color, sizes: {} }; out.push(g); }
    g.sizes[r.size] = (g.sizes[r.size] || 0) + r.qty;
  }
  return out;
}

export const goodsPcs = (g: GoodsGarment) => Object.values(g.sizes || {}).reduce((a, n) => a + (+n || 0), 0);
/** "S 2 · M 4 · L 6" */
export const goodsSizes = (g: GoodsGarment) => Object.entries(g.sizes || {}).filter(([, n]) => +n > 0).sort(([a], [b]) => sizeRank(a) - sizeRank(b)).map(([z, n]) => `${z} ${n}`).join(" · ");

const plain = (s: string) => String(s || "").toLowerCase().replace(/\bgrey\b/g, "gray").replace(/[^a-z0-9]/g, "");

/**
 * The order's garment lines made the goods that were bought: each line whose color matches a bought color takes its
 * style, color and sizes; lines left over take the rest in order; anything still left is added to the first group. Lines
 * with nothing bought for them stay as read (said in `kept`).
 */
export function applyGoods(groups: Group[], goods: GoodsGarment[]): { groups: Group[]; kept: string[] } {
  const left = goods.filter((g) => goodsPcs(g) > 0).map((g) => ({ ...g }));
  const take = (i: number) => left.splice(i, 1)[0];
  const asLine = (l: GLine, g: GoodsGarment): GLine => ({
    ...l, style: g.style, brand: g.brand || l.brand, garment: g.name || (l.style && l.style.toUpperCase() === g.style.toUpperCase() ? l.garment : "") || l.garment,
    color: g.color, sizes: { ...g.sizes } as GLine["sizes"], called: undefined,
  });
  const next = groups.map((x) => ({ ...x, lines: [...x.lines] }));
  const real = (l: GLine) => !l.extras;
  // 1. the same color (and the same style, when the line has one)
  for (const x of next) x.lines = x.lines.map((l) => {
    if (!real(l)) return l;
    let i = left.findIndex((g) => plain(g.color) === plain(l.color) && (!l.style || plain(l.style) === plain(g.style)));
    if (i < 0) i = left.findIndex((g) => plain(g.color) === plain(l.color));
    return i < 0 ? l : Object.assign(asLine(l, take(i)), { __done: true });
  });
  // 2. lines still as read take what's left, in order
  const kept: string[] = [];
  for (const x of next) x.lines = x.lines.map((l) => {
    if (!real(l) || (l as GLine & { __done?: boolean }).__done) return l;
    if (left.length) return asLine(l, take(0));
    kept.push([l.style, l.color].filter(Boolean).join(" ") || "a line");
    return l;
  });
  // 3. bought but not on the order yet: added to the first group
  if (left.length && next[0]) next[0].lines.push(...left.map((g) => asLine({ id: uid(), style: "", brand: "", garment: "", color: "", cost: "", sizes: {}, priceOverride: null }, g)));
  for (const x of next) x.lines = x.lines.map((l) => { const { __done, ...rest } = l as GLine & { __done?: boolean }; void __done; return rest; });
  return { groups: next, kept };
}
