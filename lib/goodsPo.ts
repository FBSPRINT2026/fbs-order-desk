/**
 * THE name on a goods order sent to S&S or SanMar (Oct 29, Nick: "just type it in on the order goods page… autofill it
 * with… an abbreviation of the customer name… Dear Heart Designs could be DHD… On Your Left OYL… Nine18 can be just 918…
 * The McKenna Group is TMG… Creative Apparel would be CA"). Order goods shows it in a field, filled in as the customer's
 * short name and the job number ("DHD 40204"), and sends whatever is there to both suppliers. The job number in it is
 * how Goods & Receiving matches the box to the job. Without an order: the short name and the month and day.
 *
 * The short name is learned: when someone types their own short name over ours and orders ("PBC 40123"), it's kept for
 * that customer (settings.data.goodsShort) and used from then on. Until then it's worked out from the name:
 *   - a name with a number in it goes by that word, number words made digits: "Nine18 Printing Solutions" → 918;
 *   - a name that starts with letters already in capitals goes by them: "XYZ Test Company" → XYZ, "MEI Store" → MEI;
 *   - one word stays a word: "Peticolas" → Peticolas;
 *   - otherwise the first letters of its words (run-together words split: "theMcKennagroup" → TMG), leaving off
 *     LLC / Inc / Corp / Ltd, a word already in capitals kept whole: "Dear Heart Designs" → DHD, "On Your Left!" → OYL,
 *     "Creative Apparel" → CA, "Aubrey ISD" → AISD.
 * Cleaned to what SanMar takes (letters, numbers, spaces, # and -, at most 28; no commas), so one name works for both.
 */
export const GOODS_PO_MAX = 28;
export const cleanGoodsPo = (s: string) => String(s || "").replace(/[^A-Za-z0-9 #-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GOODS_PO_MAX).trim();

const NUM: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
const LEGAL = /^(llc|inc|incorporated|corp|corporation|ltd|pllc|lp|llp)$/i;

/** a customer's short name, worked out from their name (see above) */
export function customerShort(name?: string | null): string {
  const raw = String(name || "").replace(/[^A-Za-z0-9 &-]+/g, " ");
  // run-together words apart ("theMcKennagroup" → the McKenna group), then the words
  const words = raw.replace(/([a-z]{2,})([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/([a-z])(group|company|designs?|apparel|printing|brewing|studio|shop)\b/gi, "$1 $2")
    .split(/[\s&-]+/).filter((w) => w && !LEGAL.test(w));
  if (!words.length) return "";
  // a word with a number in it: that word, number words as digits (Nine18 → 918)
  const numWord = String(name || "").split(/[^A-Za-z0-9]+/).find((w) => /\d/.test(w));
  if (numWord) return numWord.replace(/(zero|one|two|three|four|five|six|seven|eight|nine|ten)/gi, (m) => NUM[m.toLowerCase()]).slice(0, 12);
  // already an abbreviation (XYZ, MEI, AMS)
  const first = String(name || "").trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
  if (/^[A-Z0-9]{2,6}$/.test(first)) return first;
  if (words.length === 1) return words[0].slice(0, 14);
  // a word already in capitals stays whole ("Aubrey ISD" → AISD)
  return words.map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w[0])).join("").toUpperCase().slice(0, 8);
}

export function defaultGoodsPo(o: { orderNo?: number | null; customer?: string | null; short?: string | null; when?: Date }): string {
  const short = cleanGoodsPo(o.short || "") || customerShort(o.customer);
  if (o.orderNo) return cleanGoodsPo(`${short} ${o.orderNo}`);
  const d = o.when || new Date();
  return cleanGoodsPo(`${short || "Stock"} ${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
}

/** the short name someone typed in a PO name made the usual way ("PBC 40123", "PBC 1029" → PBC), to keep for that customer */
export function typedShort(po: string): string {
  const m = cleanGoodsPo(po).match(/^([A-Za-z0-9-]{1,18})\s+#?\d{4,6}$/);
  return m ? m[1] : "";
}
