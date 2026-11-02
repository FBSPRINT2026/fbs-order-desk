/**
 * Which catalog garment a line is (Nov 2, #40368: Amanda's S&S confirmation said Rabbit Skins 3400, the order line came out
 * Colortone 3400). A style number isn't one garment: several brands use the same number (3400 Rabbit Skins / Colortone,
 * 1717, 2000, 5000…). So a line that names its brand only ever takes that brand's garment; a line with only a number takes
 * the catalog's one garment of that number. Every place that matches a line to the catalog goes through here, client or
 * server, so one can't match by number alone while another checks the brand.
 */
export const brandKey = (b: string | null | undefined) => String(b || "").toLowerCase().replace(/&|\+|\band\b/g, " ").replace(/\b(company|co|apparel|activewear|inc|brand|brands|usa)\b/g, " ").replace(/[^a-z0-9]/g, "");

/** two ways of writing one brand ("Gildan" / "Gildan Activewear", "Port & Company" / "Port and Company") */
export function sameBrand(a: string | null | undefined, b: string | null | undefined) {
  const x = brandKey(a), y = brandKey(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
}

/** the catalog garment for a style (and brand, when the line has one): never another brand's garment of the same number */
export function garmentFor<T extends { style: string; brand?: string | null }>(list: readonly T[], style: string | null | undefined, brand?: string | null): T | undefined {
  const st = String(style || "").trim().toLowerCase();
  if (!st) return undefined;
  const hits = list.filter((x) => String(x.style || "").trim().toLowerCase() === st);
  if (!hits.length) return undefined;
  if (String(brand || "").trim()) return hits.find((x) => sameBrand(x.brand, brand));
  return hits[0];
}
