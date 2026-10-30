import { normSize } from "@/lib/ai/normalize";
import type { Size } from "@/lib/pricing";
import type { SheetLine } from "@/lib/sheetSizes";

/**
 * A supplier's order confirmation (S&S Activewear "Order Confirmation", SanMar…) read by code, not the AI (Oct 24, Nick
 * on Dear Heart's In Every Season: "it's just a simple thing. You add up the quantities, it adds to 950"). Their two S&S
 * confirmations (550 + 400) were read as 1,025 every time: the 400 sheet lists the 1717 Blue Spruce in S, M and XL only,
 * and the AI gave it an L 75 like the other sheet's. One row per item:
 *   "00708763 Comfort Colors - Unisex Garment-Dyed Heavyweight T-Shirt - 1717 Blue Spruce S 50 5.49 274.50"
 * (item # ("00708763", Under Armour's "134E2508"), brand - description - style, color, size, pieces, price, line total). A size split over two warehouses
 * (Mauve M 51 + 49) is added up. Every confirmation in the order is added together: one line per style + color.
 */
// waist sizes too (Oct 30): 30, 32x30, and SanMar's waist+inseam run together (3232); lib/pricing.ts waistOf reads them
const SIZE = "(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|Y?XS|YS|YM|YL|YXL|OSFA|OS|NB|\\d{1,2}T|\\d{1,2}-\\d{1,2}M|\\d{1,2}M|\\d{2}[xX/]\\d{2}|\\d{4}|\\d{2})";
const ROW = new RegExp(`\\b(\\d[0-9A-Z]{5,8})\\s+(.+?)\\s+-\\s+([A-Z0-9][A-Z0-9-]{1,11})\\s+(.+?)\\s+(${SIZE})\\s+(\\d{1,5})\\s+\\$?(\\d{1,4}\\.\\d{2})\\s+\\$?([\\d,]{1,9}\\.\\d{2})(?=\\s|$)`, "g");

/**
 * SanMar's confirmation e-mail (Oct 30: All My Sons' Pittsburgh PO came with one, and only the S&S rows were read by code):
 *   "JST73 Forest Green ST Hooded Raglan Jacket S 1 $18.23 $18.23 TX"
 * (style, color, the brand's short name in capitals + description, size, pieces, price, amount, warehouse). The color is
 * the words after the style up to the brand's short name (ST, PC, PA, GLDN, JZS, NK, OGE, TNF…): "TNF Black TNF Aim…".
 * Styles always have a digit (ST350, W961, NF0A8FQJ), so the warehouse codes and labels aren't taken for one.
 */
const SANMAR_ROW = new RegExp(`(?:^|\\s)([A-Z]{0,4}\\d[A-Z0-9-]{0,11})\\s+([^$:#]{3,100}?)\\s+(${SIZE}|S\\/M|M\\/L|L\\/XL)\\s+(\\d{1,5})\\s+\\$(\\d{1,4}\\.\\d{2})\\s+\\$([\\d,]{1,9}\\.\\d{2})(?=\\s|$)`, "g");
function splitColor(words: string[]): { color: string; desc: string } {
  for (let i = 1; i < words.length - 1; i++) if (/^[A-Z]{2,4}$/.test(words[i]) && /^[A-Z0-9]/.test(words[i + 1])) return { color: words.slice(0, i).join(" ").replace(/\b(\w+) (\w)\b(?=\/|$)/g, "$1$2"), desc: words.slice(i).join(" ") };
  return { color: words.slice(0, 2).join(" "), desc: words.slice(2).join(" ") };
}
function sanmarRows(t: string) {
  const out: { product: string; style: string; color: string; size: Size; qty: number }[] = [];
  for (const m of t.matchAll(SANMAR_ROW)) {
    const size = normSize(m[3]) as Size | null, qty = +m[4], price = +m[5], total = +m[6].replace(/,/g, "");
    if (!size || !qty || Math.abs(qty * price - total) > 0.05 * Math.max(1, total)) continue;
    const { color, desc } = splitColor(m[2].trim().split(" "));
    out.push({ product: `${desc} - ${m[1]}`, style: m[1], color, size, qty });
  }
  return out;
}

export type ConfirmRead = { lines: SheetLine[]; pieces: number; rows: number };

/** the rows of one confirmation's text (pdf.js words joined by spaces) */
export function supplierConfirmRows(text: string): { product: string; style: string; color: string; size: Size; qty: number }[] {
  const t = String(text || "").replace(/\s+/g, " ");
  if (!/order confirmation|s&s activewear|sanmar|alphabroder/i.test(t)) return [];
  const out: { product: string; style: string; color: string; size: Size; qty: number }[] = [];
  for (const m of t.matchAll(ROW)) {
    const size = normSize(m[5]) as Size | null, qty = +m[6], price = +m[7], total = +m[8].replace(/,/g, "");
    // the line total is the pieces times the price: a check that this really is an item row
    if (!size || !qty || Math.abs(qty * price - total) > 0.05 * Math.max(1, total)) continue;
    // "Comfort Colors - Unisex Garment-Dyed Heavyweight T-Shirt" + " - 1717"
    // the first row can carry the page's header before it: the description starts after the last item number
    const desc = m[2].split(/\b\d[0-9A-Z]{5,8}\s+/).pop()!.trim();
    out.push({ product: `${desc} - ${m[3]}`, style: m[3], color: m[4].trim(), size, qty });
  }
  return out.length ? out : sanmarRows(t);
}

/** every confirmation's rows added up into one line per style + color, with the pieces they add to */
export function supplierConfirms(texts: string[]): ConfirmRead {
  const by = new Map<string, SheetLine>();
  let pieces = 0, rows = 0;
  for (const tx of texts) for (const r of supplierConfirmRows(tx)) {
    const k = `${r.style.toLowerCase()}|${r.color.toLowerCase()}`;
    const l = by.get(k) || { product: r.product, color: r.color, sizes: {}, total: 0 };
    l.sizes[r.size] = (l.sizes[r.size] || 0) + r.qty; l.total += r.qty;
    by.set(k, l); pieces += r.qty; rows++;
  }
  return { lines: [...by.values()], pieces, rows };
}

/**
 * Who a confirmation is from and its order number, with the pieces its rows add to (Oct 30: Pittsburgh's goods note said
 * "SanMar 8 pcs" when SanMar's confirmation was 43): the goods on an order are written from these, not guessed.
 */
export function confirmMeta(text: string): { supplier: "sanmar" | "ss" | "alpha" | ""; order: string; pieces: number } {
  const t = String(text || "").replace(/\s+/g, " ");
  const supplier = /sanmar/i.test(t) ? "sanmar" : /s&s activewear/i.test(t) ? "ss" : /alphabroder/i.test(t) ? "alpha" : "";
  const order = (t.match(/\b(SO-\d{6,12})\b/) || t.match(/Order Confirmation:?\s*#?\s*(\d{6,12})/i) || t.match(/Order (?:Number|#)\s*:?\s*([A-Z0-9-]{5,20})/i) || [])[1] || "";
  return { supplier, order, pieces: supplierConfirmRows(text).reduce((a, r) => a + r.qty, 0) };
}
