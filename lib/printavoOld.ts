import type { StatusKey } from "@/lib/pricing";

/**
 * What's left of Printavo (closed Nov 14 2026; Nick, Nov 15: "remove all the Printavo sync features… only thing I wanna
 * keep is a little P next to the invoice that signify it was made in that system"). Nothing here talks to Printavo: these
 * read the copy we kept (archived_orders, and the snapshot a 40,000 job carries in printavo_state.pv).
 */

/** What a 40,000 job looked like in Printavo the last time the sync read it (orders.printavo_state.pv). */
export type PvSnap = {
  at: string; visualId: string; status: string; total: number; kind: string; productionNote: string;
  customerNote: string; nickname: string; po: string; customerDue: string; productionDue: string; discount: number; discountPct: boolean; salesTax: number;
  /** the tax Printavo actually charged ($): salesTax is only the rate, and Printavo taxes only lines marked taxed */ salesTaxAmount?: number;
  imprints: string[][]; payments: { id: string; kind: string; amount: number; category: string; date: string; processing: boolean }[];
  groups: { lines: { itemNumber: string; color: string; description: string; category: string; sizes: Record<string, number>; price: number; mockups: number; /** Printavo's goods status: received / partially_received / ordered / "" */ goods?: string }[] }[];
  fees: { description: string; amount: number; quantity: number | null; unitPrice: number | null; pct: boolean }[];
};

/** The fee a 40,000 job brought back from Printavo when its setup was changed there (shown as part of Setup). */
export const ADJUST = "Setup adjustment (from Printavo)";

/** A card surcharge line, in Printavo's words or ours ("Credit Card Processing Surcharge", "CC Fees"). */
export const CARD = /credit card processing surcharge|^\s*cc\s*fees?\b|\bcard (processing )?(fee|surcharge)/i;

/**
 * Our status for a Printavo status (Oct 15, Nick): an old Printavo job's status words read the way our own statuses are.
 * null = not ours to guess (an issue, a hold, a status we don't know).
 */
export function ourStatusFor(name: string, kind: string): StatusKey | null {
  const s = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/^quote/.test(s)) return /paid|approved/.test(s) ? "approved" : /closed/.test(s) ? null : /sent/.test(s) ? "quote_sent" : kind === "invoice" ? "approved" : "quote";
  if (/complete|picked up|delivered/.test(s)) return "completed";
  if (/^shipping|ready to ship|ready for pick ?up/.test(s)) return "ready";
  if (/^issue|on hold|holder|waiting on details/.test(s)) return null;
  if (/transfers ordered|blanks|garments ordered|goods ordered|receiving/.test(s)) return "blanks";
  if (/\bart\b|proof/.test(s)) return "art";
  if (/press|printing|fulfillment|finishing|production|scheduling|^emb\b|^sp\b|^hp\b|^op\b|^dtf\b|mixed order/.test(s)) return "production";
  return null;
}

/** A job's goods from Printavo's line goods statuses: every line received → received; some → partial; else null. */
export function goodsFromPrintavo(snap: Pick<PvSnap, "groups">): "received" | "partial" | null {
  const lines = snap.groups.flatMap((g) => g.lines).filter((l) => Object.values(l.sizes || {}).some((v) => +v > 0));
  if (!lines.length) return null;
  const st = lines.map((l) => String(l.goods || "").toLowerCase());
  if (st.every((x) => x === "received")) return "received";
  if (st.some((x) => x === "received" || x === "partially_received")) return "partial";
  return null;
}
