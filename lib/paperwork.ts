/**
 * Paperwork, not art (Nov 1, Nick on the Count Joy reorder: Printavo #34448's line "mockups" were the customer's S&S
 * order confirmations, and one was drawn on both shirts as the logo): a page with lots of words and the words paperwork
 * uses (order, qty, total, ship to, item, size, price…) or several money amounts is an order confirmation, invoice,
 * packing list, size sheet or PO. Art with a lot of live text (a sponsor back with 60 names) has neither, so it stays
 * art. One rule for the browser (lib/printavoArt isPaperworkPage) and the server (the reorder's file list).
 */
export function looksLikePaperwork(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  const vocab = (text.match(/\b(order|orders|invoice|qty|quantity|total|subtotal|shipping|ship to|bill to|sold to|purchase|confirmation|item|items|style|price|unit|tax|date|page \d|sku|description|customer|account|payment|balance|due)\b/gi) || []).length;
  const money = (text.match(/\$\s?\d[\d,]*\.\d{2}/g) || []).length;
  return (words >= 40 && vocab >= 6) || money >= 3;
}

/** a supplier's order for the blanks (S&S, SanMar, alphabroder…), not the customer's own sheet */
export const isSupplierPaperwork = (text: string) => /\b(s&s|ssactivewear|sanmar|alpha\s?broder|alphabroder|carolina made|tsc apparel|order confirmation)\b/i.test(text);
