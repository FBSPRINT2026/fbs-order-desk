import { normSize } from "@/lib/ai/normalize";
import type { Size } from "@/lib/pricing";
import type { SheetLine } from "@/lib/sheetSizes";

/**
 * A supplier's order confirmation (S&S Activewear "Order Confirmation", SanMar…) read by code, not the AI (Oct 24, Nick
 * on Dear Heart's In Every Season: "it's just a simple thing. You add up the quantities, it adds to 950"). Their two S&S
 * confirmations (550 + 400) were read as 1,025 every time: the 400 sheet lists the 1717 Blue Spruce in S, M and XL only,
 * and the AI gave it an L 75 like the other sheet's. One row per item:
 *   "00708763 Comfort Colors - Unisex Garment-Dyed Heavyweight T-Shirt - 1717 Blue Spruce S 50 5.49 274.50"
 * (item #, brand - description - style, color, size, pieces, price, line total). A size split over two warehouses
 * (Mauve M 51 + 49) is added up. Every confirmation in the order is added together: one line per style + color.
 */
const SIZE = "(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|Y?XS|YS|YM|YL|YXL|OSFA|OS|NB|\\d{1,2}T|\\d{1,2}-\\d{1,2}M|\\d{1,2}M)";
const ROW = new RegExp(`\\b(\\d{6,9})\\s+(.+?)\\s+-\\s+([A-Z0-9][A-Z0-9-]{1,11})\\s+(.+?)\\s+(${SIZE})\\s+(\\d{1,5})\\s+\\$?(\\d{1,4}\\.\\d{2})\\s+\\$?([\\d,]{1,9}\\.\\d{2})(?=\\s|$)`, "g");

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
    const desc = m[2].split(/\b\d{6,9}\s+/).pop()!.trim();
    out.push({ product: `${desc} - ${m[3]}`, style: m[3], color: m[4].trim(), size, qty });
  }
  return out;
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
