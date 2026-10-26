/**
 * DTF Dallas gang sheets (Oct 26, Nick: "we use DTF Dallas… pull their gang sheet sizes… make a pricing tool… how much
 * will this cost to print this DTF"). Read off dtfdallas.com/products/dtf-gang-sheets on Oct 26 2026: always 22" wide,
 * priced by length in steps of 10" (Nick: "they'll start at 10, then go to 20, 30… in increments of 10"; 210–240 aren't
 * on their page: priced at the 39¢ an inch that 200 and 250 both work out to); their sale price, the list price is twice it. One file is at most 22" × 250"; longer layouts go in
 * several files. They ask for about 1/4" between designs and a transparent file at 300 dpi.
 */
export const DTF_DALLAS = {
  name: "DTF Dallas",
  url: "https://dtfdallas.com/products/dtf-gang-sheets",
  checked: "Oct 26, 2026",
  width: 22,
  maxFileLength: 250,
  gap: 0.25,
  dpi: 300,
  /** length (in) → price ($) */
  prices: [
    [10, 4.1], [20, 8.2], [30, 12.3], [40, 16.4], [50, 20.5], [60, 24.6], [70, 28.7], [80, 32.8], [90, 36.9], [100, 40.5],
    [110, 44.55], [120, 48.6], [130, 52.65], [140, 56.7], [150, 60.75], [160, 64.8], [170, 68.86], [180, 72.9], [190, 76.95],
    [200, 78], [210, 81.9], [220, 85.8], [230, 89.7], [240, 93.6], [250, 97.5], [300, 117], [400, 156], [500, 175], [600, 204], [750, 247.5], [1000, 320],
  ] as [number, number][],
};

/** the sheet to buy for a layout this long: the shortest size that holds it */
export function sheetFor(lengthIn: number): { length: number; price: number } {
  const hit = DTF_DALLAS.prices.find(([l]) => l >= lengthIn - 0.01) || DTF_DALLAS.prices[DTF_DALLAS.prices.length - 1];
  return { length: hit[0], price: hit[1] };
}
