/**
 * Sizes are always listed in size order, never alphabetically (Nick, Oct 9): baby → toddler → youth → XS … 6XL → one size.
 * Works on our size codes and the usual spellings (XXL, 2X, Large, size_2xl…).
 */
const ORDER = ["NB", "0-3M", "3M", "6M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "5/6", "6", "7", "YXS", "YS", "YM", "YL", "YXL", "XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "OS", "OTHER"];
const ALIAS: Record<string, string> = { XXL: "2XL", "2X": "2XL", XXXL: "3XL", "3X": "3XL", "4X": "4XL", "5X": "5XL", "6X": "6XL", SMALL: "S", MEDIUM: "M", LARGE: "L", "X-LARGE": "XL", XLARGE: "XL", "X-SMALL": "XS", XSMALL: "XS", "ONE SIZE": "OS", OSFA: "OS", ADJ: "OS" };
export function sizeRank(z: string) {
  const k = String(z || "").toUpperCase().replace(/^SIZE_/, "").trim();
  const i = ORDER.indexOf(ALIAS[k] || k);
  return i < 0 ? 900 : i;
}
export const bySizeOrder = (a: string, b: string) => sizeRank(a) - sizeRank(b) || String(a).localeCompare(String(b));
