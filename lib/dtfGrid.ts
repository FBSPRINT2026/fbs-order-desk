/**
 * DTF transfers we order for the customer, priced by the print's size and the pieces (Nov 4, Nick: "the DTF heat transfer
 * pricing needs to be by square inch and then by quantity… I just want to make about 40% margin if we order them…
 * some people don't have a DTF Dallas account").
 *
 * The transfer: what DTF Dallas charges us (with the wholesale discount, Nov 2026: $0.28 an inch of a 22" sheet, about
 * 1.3¢ a square inch), with 1/4" between designs and 85% of a sheet used, divided by 0.6 (a 40% margin). Small runs carry
 * more, for the shortest sheet ($2.80 for 22" × 10") and the room around a few transfers. The press is the list's own
 * pressing price (PriceList.dtfSupplied, $2), the same as when the customer sends their own transfers.
 *
 * A print's size comes from the print itself ("3.5" wide", its art's height ÷ width; "12x14"). With no size yet, a small
 * spot (chest, sleeve, pocket, side, neck, a hat) is priced Small and anything else Large, until the size is set.
 */
export type DtfGrid = {
  /** the largest print (square inches) each size covers, Small first */ sizes: { name: string; max: number }[];
  /** the piece breaks, lowest first */ qty: number[];
  /** the transfer each: [size][break] */ price: number[][];
  /** off: the list's old flat row (PriceList.dtf) */ off?: boolean;
};

export const DTF_GRID: DtfGrid = {
  sizes: [{ name: "Small", max: 16 }, { name: "Medium", max: 80 }, { name: "Large", max: 144 }, { name: "XL", max: 216 }],
  qty: [1, 12, 48, 144],
  price: [
    [0.9, 0.55, 0.5, 0.45],
    [4.2, 2.65, 2.3, 2.1],
    [7.5, 4.7, 4.1, 3.75],
    [11.15, 7, 6.15, 5.6],
  ],
};

export const dtfGridOn = (s: { dtfGrid?: DtfGrid }) => !s.dtfGrid?.off;

const SMALL_SPOT = /chest|sleeve|pocket|side|neck|collar|nape|cuff|hat|cap|beanie|visor/i;

/** the print's area in square inches, or 0 when it has no size yet */
export function dtfArea(d: { size?: string; artRatio?: number }): number {
  const nums = String(d.size || "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter((n) => n > 0) || [];
  if (!nums.length) return 0;
  const w = nums[0], h = nums[1] ?? (d.artRatio && d.artRatio > 0 ? w * d.artRatio : w);
  return Math.round(w * h * 100) / 100;
}

/** which size a print is (by its area, else by its spot) */
export function dtfSize(d: { size?: string; artRatio?: number; location?: string }, g: DtfGrid = DTF_GRID) {
  const a = dtfArea(d);
  if (!a) return { i: SMALL_SPOT.test(d.location || "") ? 0 : Math.min(2, g.sizes.length - 1), area: 0, guessed: true };
  const i = g.sizes.findIndex((z) => a <= z.max + 0.01);
  return { i: i < 0 ? g.sizes.length - 1 : i, area: a, guessed: false };
}

/** the transfer each, for this print at these pieces */
export function dtfTransfer(d: { size?: string; artRatio?: number; location?: string }, pieces: number, g: DtfGrid = DTF_GRID) {
  const { i, area } = dtfSize(d, g);
  let b = 0;
  g.qty.forEach((q, k) => { if (pieces >= q) b = k; });
  const base = +(g.price[i]?.[b] ?? 0) || 0;
  // bigger than the largest size: the largest size's price per square inch
  const top = g.sizes[g.sizes.length - 1];
  const each = i === g.sizes.length - 1 && area > top.max ? (base * area) / top.max : base;
  return Math.round(each * 100) / 100;
}

/** a DTF print we order: the transfer plus pressing it */
export const dtfEach = (d: { size?: string; artRatio?: number; location?: string }, pieces: number, press: number, g?: DtfGrid) =>
  Math.round((dtfTransfer(d, pieces, g || DTF_GRID) + press) * 100) / 100;
