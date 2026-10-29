/**
 * THE name on a goods order sent to S&S or SanMar (Oct 29, Nick: "just type it in on the order goods page… autofill it
 * with just like an abbreviation of the customer name, like Peticolas 40123, or like this would be XYZ 40204. Then I can
 * type over it"). Order goods shows it in a field, filled in like that, and sends whatever is there to both suppliers.
 * The job number in it is how Goods & Receiving matches the box to the job. Without an order (stock, an email before
 * its order): the customer's short name and the month and day ("Stock 1029" when there's no customer either).
 * Cleaned to what SanMar takes (letters, numbers, spaces, # and -, at most 28; no commas), so one name works for both.
 */
export const GOODS_PO_MAX = 28;
export const cleanGoodsPo = (s: string) => String(s || "").replace(/[^A-Za-z0-9 #-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GOODS_PO_MAX).trim();

/** a customer's short name: their first word ("Peticolas Brewing" → Peticolas, "XYZ Test Company" → XYZ), skipping a
 *  leading "The" / "A", up to 18 letters */
export function customerShort(name?: string | null): string {
  const words = cleanGoodsPo(name || "").replace(/#/g, "").split(" ").filter(Boolean);
  const first = words.find((w, i) => !(i === 0 && /^(the|a|an)$/i.test(w) && words.length > 1)) || "";
  return first.slice(0, 18);
}

export function defaultGoodsPo(o: { orderNo?: number | null; customer?: string | null; when?: Date }): string {
  const short = customerShort(o.customer);
  if (o.orderNo) return cleanGoodsPo(`${short} ${o.orderNo}`);
  const d = o.when || new Date();
  return cleanGoodsPo(`${short || "Stock"} ${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
}
