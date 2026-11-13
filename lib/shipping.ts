import type { ShipAddress, ShipSettings } from "@/lib/pricing";

/** Shipping center: boxes, addresses and what we charge. Shared by the shop screens and the server. */

export type Box = { n: number; length: number | ""; width: number | ""; height: number | ""; weight: number | ""; tracking?: string; label_url?: string };
export type BillTo = "fbs" | "ups" | "fedex";
export type Rate = { id?: string; carrier: string; service: string; cost: number; price: number; days: number | null; deliveryDate?: string | null };
export type Shipment = {
  id: string; order_id: string | null; archived_order_id: string | null; customer_id: string | null;
  status: "draft" | "labeled" | "shipped" | "void";
  ship_to: ShipAddress; bill_to: BillTo; bill_account: string; bill_zip: string; /** the customer's own carrier account it shipped on (EasyPost id); empty = FBS's */ ship_on?: string; carrier: string; service: string;
  boxes: Box[]; rates: Rate[] | null; cost: number | null; price: number | null; note: string;
  created_by: string; created_at: string; updated_at: string; shipped_at: string | null;
};

export const BILL_LABEL: Record<BillTo, string> = { fbs: "Our account (FBS)", ups: "Customer's UPS account", fedex: "Customer's FedEx account" };

export const emptyAddress = (): ShipAddress => ({ name: "", company: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US", phone: "", email: "" });

/** How many boxes an order needs at `perBox` pieces a box (at least one). */
export const estimateBoxes = (pieces: number, perBox: number) => Math.max(1, Math.ceil((+pieces || 0) / Math.max(1, +perBox || 72)));

export const newBoxes = (count: number, size?: { length: number; width: number; height: number }): Box[] =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, length: size?.length ?? "", width: size?.width ?? "", height: size?.height ?? "", weight: "" }));

/** A box is ready to rate when it has all three sides and a weight. */
export const boxReady = (b: Box) => [b.length, b.width, b.height, b.weight].every((x) => typeof x === "number" && x > 0);

/**
 * Best-effort split of a typed address ("Shag Carpet\n3184 Quebec Street\nDallas, TX 75204") into fields.
 * Staff check and correct it in the ship window; the carrier validates it before labels are made.
 */
/**
 * A typed ship-to ("Armstrong Relocation Chattanooga / ATTN Stacy / 6059 Relocation Way / Ooltewah, TN 37363") as an
 * address. The name and company come from the text's own lines (an "ATTN" / "Attn:" / "Attention" / "c/o" line is the
 * person); the customer's own name and company are only the fallback when the text names nobody, so a reseller's order
 * shipped to their end client never goes out addressed to the reseller (Nick, Nov 13, #50036: Nine18 · Mike Howard on
 * Armstrong's address).
 */
export function addressFromText(text: string, name = "", company = ""): ShipAddress {
  const a = emptyAddress();
  const tidy = (l: string) => l.trim().replace(/[,;\s]+$/, "").trim();
  let lines = (text || "").split(/\n|;/).map(tidy).filter(Boolean);
  // one line with commas: "ALL MY SONS TUCSON, 5131 E CANADA STREET, TUCSON, AZ 85706, ATTN OPERATIONS MGR"
  if (lines.length === 1 && lines[0].includes(",")) lines = lines[0].split(",").map(tidy).filter(Boolean);
  const attnRe = /^(attn|attention|c\/o|care of)\b[:.\s-]*/i;
  lines = lines
    // "MEI ATTN: Kristopher Gibson": the company, then the person
    .flatMap((l) => { const m = l.match(/^(.+?)\s+((?:attn|attention|c\/o)\b.*)$/i); return m && !attnRe.test(l) ? [tidy(m[1]), m[2].trim()] : [l]; })
    // "5900 Blackwelder Street, Culver City, CA 90232": the street, then the city line
    .flatMap((l) => { const m = l.match(/^(.*\d.*?),\s*([^,]+,?\s*[A-Za-z]{2}[\s,]+\d{5}(?:-\d{4})?)$/); return m ? [tidy(m[1]), m[2].trim()] : [l]; });
  // "TUCSON" then "AZ 85706" (split on commas): one city line
  lines = lines.reduce<string[]>((acc, l) => { if (/^[A-Za-z]{2}\s+\d{5}(-\d{4})?$/.test(l) && acc.length) acc[acc.length - 1] += `, ${l}`; else acc.push(l); return acc; }, []);
  const cszAt = lines.findIndex((l) => /\b[A-Z]{2}\b[\s,]*\d{5}(-\d{4})?\s*$/i.test(l));
  const same = (x: string, y: string) => !!x && !!y && x.toLowerCase().replace(/[^a-z0-9]/g, "") === y.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cszAt >= 0) {
    const m = lines[cszAt].match(/^(.*?)[\s,]+([A-Za-z]{2})[\s,]+(\d{5}(?:-\d{4})?)\s*$/);
    if (m) { a.city = m[1].replace(/,$/, "").trim(); a.state = m[2].toUpperCase(); a.zip = m[3]; }
    const attn = lines.find((l, i) => i !== cszAt && attnRe.test(l));
    const head = lines.slice(0, cszAt).filter((l) => l !== attn);
    const street = head.filter((l) => /\d/.test(l) || /\b(suite|ste|unit|po box|#)\b/i.test(l));
    const other = head.filter((l) => !street.includes(l));
    a.street1 = street[0] || ""; a.street2 = street.slice(1).join(", ");
    // the person: an ATTN line, else a line that's the customer's own contact or a role ("OPS MANAGER")
    const role = (l: string) => /\b(mgr|manager|operations|ops|receiving|dept|department|front desk)\b/i.test(l) && !/\b(inc|llc|co|corp|company)\b/i.test(l);
    const person = attn ? attn.replace(attnRe, "").trim() : other.find((l) => same(l, name)) || (other.length > 1 ? other.find(role) : "") || "";
    const firm = other.find((l) => l !== person && !same(l, name) && !(attn ? false : l === person)) || "";
    if (person || firm) {
      a.name = person || (same(firm, company) ? name : "");
      a.company = firm || (same(person, name) ? company : "");
    } else { a.name = name; a.company = company; }
  } else {
    a.name = name; a.company = company;
    a.street1 = lines[0] || ""; a.street2 = lines.slice(1).join(", ");
  }
  return a;
}

export const addressReady = (a: ShipAddress) => !!(a.street1 && a.city && a.state && a.zip && (a.name || a.company));

export const oneLine = (a: ShipAddress) => [a.company || a.name, a.street1, [a.city, a.state].filter(Boolean).join(", ") + (a.zip ? ` ${a.zip}` : "")].filter((x) => x && x.trim()).join(" · ");

/** What the customer pays for a shipment. Our account: cost + markup % + per-box fee (at least the minimum). Their account: the per-box fee for third-party shipments, if any. */
export function shippingPrice(cost: number, boxes: number, bill: BillTo, s: ShipSettings): number {
  if (bill !== "fbs") return Math.round((s.thirdPartyFee || 0) * boxes * 100) / 100;
  const p = cost * (1 + (s.markupPct || 0) / 100) + (s.perBoxFee || 0) * boxes;
  return Math.round(Math.max(p, s.minCharge || 0) * 100) / 100;
}

/** "1Z…" is UPS; 12/15/20-digit is usually FedEx; 20–22 digit starting 9 is USPS. */
export function carrierOf(tracking: string): "UPS" | "FedEx" | "USPS" | "" {
  const t = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "UPS";
  if (/^(94|93|92|95)\d{18,20}$/.test(t)) return "USPS";
  if (/^\d{12}$|^\d{15}$|^\d{20}$/.test(t)) return "FedEx";
  return "";
}
export function trackingLink(tracking: string): string {
  const t = tracking.replace(/\s+/g, "");
  const c = carrierOf(t);
  if (c === "UPS") return `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`;
  if (c === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}`;
  if (c === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(t)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}
