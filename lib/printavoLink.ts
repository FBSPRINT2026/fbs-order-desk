import "server-only";

/**
 * Another shop's Printavo work order, sent as a link (Nov 12, Nick: Illusive Apparel's Tal sends "NEW W.O 11756 CIA" with a
 * link to ilsv.printavo.com/work_orders/…: "all I need to do is train how to download"). Any shop on Printavo has the
 * same public page (no sign-in), so this reads any of them: invoices, quotes and work orders.
 *
 * What comes off the page:
 *  - the order itself, as a text file read like the customer's own work order: the dates, their customer's ship-to
 *    (where we ship it), the production notes, each line's style, color, description and sizes, the imprints. Their
 *    prices and fees are what THEY charge THEIR customer, so they're left out: we price at our own rates.
 *  - each line's pictures, named for the line ("Line 1 picture 1"), so the reader knows which art is on which garment
 *  - the production files (their .ai art, a supplier's order confirmation) and the large mockups, under their own names
 */
export const isPrintavoLink = (u: string) => {
  try { const x = new URL(u); return /(^|\.)printavo\.com$/i.test(x.hostname) && /\/(work_orders|invoices|quotes|orders)\/[0-9a-z]{16,}/i.test(x.pathname); } catch { return false; }
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ent = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const attr = (tag: string, name: string) => ent(tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:'([^']*)'|"([^"]*)")`, "i"))?.slice(1).find((x) => x != null) || "");
/** a filepicker link's file (their "…+..ai" / "?cache=true+.png" endings are only labels) */
const fileUrl = (u: string) => u.replace(/\?[^#]*$/, "").replace(/\+[^/]*$/, "");

/** the page as text a person reads: rows as "a | b | c", blocks on their own lines; prices and fees dropped */
function pageText(html: string): string {
  let h = html.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  // what they charge their customer: the price cells and the fees table (hidden on their own work order print)
  h = h.replace(/<(td|th)\b[^>]*workorder--hidden[^>]*>[\s\S]*?<\/\1>/gi, "");
  h = h.replace(/<\/(td|th)>/gi, " | ").replace(/<\/tr>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|li|table|section)>/gi, "\n");
  h = ent(h.replace(/<[^>]+>/g, " "));
  const lines = h.split("\n").map((l) => l.replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+$/g, "").replace(/^(\s*\|\s*)+/, "").trim()).filter(Boolean);
  // money lines (subtotal, tax, fees, payments) never reach the order: their prices aren't ours
  return lines.filter((l) => !/\$\s?\d/.test(l) && !/^(fee|credit card fee|shipping fee|subtotal|total due|amount paid|balance)\b/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n");
}

export type PrintavoOrder = { title: string; text: string; files: { url: string; name: string }[] };

export async function readPrintavoPage(url: string): Promise<PrintavoOrder> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Their Printavo page answered ${r.status}.`);
  const html = await r.text();
  const title = ent(html.match(/<title>([^<]*)<\/title>/i)?.[1] || "").replace(/^Printavo\s*-\s*/i, "").replace(/\s*-\s*[^-]*$/, "").trim() || "Printavo order";
  const files: { url: string; name: string }[] = [], seen = new Set<string>();
  const add = (u: string, name: string) => { const f = fileUrl(u); if (!/^https:\/\//.test(f) || seen.has(f)) return; seen.add(f); files.push({ url: f, name }); };
  // each line's pictures, in line order (the rows under each line item)
  let line = 0;
  for (const tr of html.split(/<tr\b/i).slice(1)) {
    const cls = attr("<tr" + tr.slice(0, tr.indexOf(">") + 1), "class");
    if (/line-item-detail/.test(cls)) { line++; continue; }
    if (!/line-item-assets/.test(cls) || !line) continue;
    let k = 0;
    for (const a of tr.match(/<a\b[^>]*filepicker-image[^>]*>/gi) || []) add(attr(a, "href"), `Line ${line} picture ${++k}`);
  }
  // their production files (art, a supplier's confirmation), by the names they gave them
  for (const m of html.matchAll(/<a\b[^>]*production-preview__wrapper[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = ent(m[1].match(/production-file-name[^>]*>([^<]*)</i)?.[1] || "").trim();
    add(attr(m[0], "href"), name || "Production file");
  }
  // the large mockups at the end of a work order
  const big = html.indexOf("workorder-large-mockups");
  if (big > 0) { let k = 0; for (const a of html.slice(big).match(/<a\b[^>]*fancybox[^>]*>/gi) || []) add(attr(a, "href"), `Mockup ${++k}`); }
  const head = [
    `${title}: the customer's order on their own Printavo (${new URL(url).hostname}), read off the page.`,
    "The line items are the order: their quantities and sizes are what to make (a size sheet among the pictures is only a reference).",
    "Their prices and fees are what they charge their own customer and were left out: price this at our own rates.",
    "Customer Shipping is where the finished order ships (their customer, a drop ship). Customer Billing is their customer, not who we bill.",
    "Each line's pictures are saved as \"Line N picture …\": the art on that line's garments.",
    "",
  ].join("\n");
  return { title, text: head + pageText(html.slice(html.search(/<body\b/i) >= 0 ? html.search(/<body\b/i) : 0)).slice(0, 20_000), files: files.slice(0, 14) };
}
