// Shared pricing engine and order vocabulary.
// Used by the shop editor (live totals), the customer portal (display)
// and the server (Stripe amounts), so every total comes from one place.

export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;
export type Size = (typeof SIZES)[number];

export type StatusKey =
  | "quote" | "quote_sent" | "approved" | "art" | "blanks" | "production" | "ready" | "completed";

export const STATUSES: { k: StatusKey; label: string; portal: string; type: "quote" | "invoice"; c: string }[] = [
  { k: "quote", label: "Quote", portal: "Draft", type: "quote", c: "#7C8799" },
  { k: "quote_sent", label: "Quote Sent", portal: "Awaiting your approval", type: "quote", c: "#6477D6" },
  { k: "approved", label: "Approved", portal: "Approved", type: "invoice", c: "#0A8FC0" },
  { k: "art", label: "Art & Proofs", portal: "Artwork", type: "invoice", c: "#A152C9" },
  { k: "blanks", label: "Blanks Ordered", portal: "Ordering garments", type: "invoice", c: "#C98A0C" },
  { k: "production", label: "In Production", portal: "Printing", type: "invoice", c: "#E0582E" },
  { k: "ready", label: "Ready for Pickup", portal: "Ready for pickup", type: "invoice", c: "#2E9D5B" },
  { k: "completed", label: "Completed", portal: "Completed", type: "invoice", c: "#6B7688" },
];
export const ST: Record<string, (typeof STATUSES)[number]> = Object.fromEntries(STATUSES.map((s) => [s.k, s]));

export const METHODS: Record<string, string> = { screen: "Screen print", embroidery: "Embroidery", dtf: "DTF transfer" };
export const LOCATIONS = ["Front", "Back", "Left chest", "Right chest", "Left sleeve", "Right sleeve", "Nape", "Hat front"];
export const PAY_METHODS = ["Card", "Cash", "Check", "ACH", "Venmo", "Other"];

export type Method = "screen" | "embroidery" | "dtf";
/** One decoration on a group of garments (Printavo calls these imprints). */
export type Imprint = { id: string; method: Method; location: string; colors: number; inks: string; size: string; notes: string };
/** One garment + color row, with its size run. */
export type GLine = {
  id: string; style: string; brand: string; garment: string; color: string; cost: number | "";
  sizes: Partial<Record<Size, number>>; priceOverride: number | null;
};
/** Garments that share the same imprints. Quantity breaks use the group total. */
export type Group = { id: string; lines: GLine[]; imprints: Imprint[] };

/** Older orders stored one garment per line with its own decorations. */
export type Decoration = { id: string; method: Method; location: string; colors: number };
export type Line = {
  id: string; garment: string; style: string; color: string; cost: number | "";
  sizes: Partial<Record<Size, number>>; decorations: Decoration[]; priceOverride: number | null;
};
export type Fee = { label: string; amount: number | "" };
export type Delivery = "pickup" | "ship" | "deliver";

export type Order = {
  id: string; number: number; customer_id: string | null; nickname: string; status: StatusKey; type: "quote" | "invoice";
  due_date: string | null; lines: Line[]; groups: Group[]; fees: Fee[]; discount_pct: number; tax_exempt: boolean; tax_rate: number | null;
  waive_setup: boolean; notes: string; total: number; qty: number; sent_at: string | null; approved_at: string | null;
  approved_name: string | null; created_at: string; updated_at: string;
  po_number: string; production_date: string | null; rush: boolean; delivery_method: Delivery; ship_to: string; ship_method: string; tracking: string;
};
export type Garment = { id: string; style: string; brand: string; description: string; colors: string[]; cost: number };
export type ArtFile = { id: string; order_id: string; name: string; file_path: string; file_type: string; created_at: string };
export type Payment = { id: string; order_id: string; amount: number; method: string; paid_on: string; stripe_session_id: string | null; created_at: string };
export type Customer = { id: string; company: string; name: string; email: string; phone: string; address: string; notes: string; tax_exempt: boolean; created_at: string; contact2_name: string; contact2_email: string; contact2_phone: string; ship_address: string };
export type Proof = { id: string; order_id: string; title: string; file_path: string; file_type: string; status: "pending" | "approved" | "changes"; customer_comment: string; decided_at: string | null; decided_name: string | null; created_at: string };
export type Message = { id: string; order_id: string; author_type: "staff" | "customer"; author_email: string; author_name: string; body: string; read_at: string | null; created_at: string };
export type OrderEvent = { id: number; order_id: string; kind: string; detail: string; actor: string; created_at: string };

export type Settings = {
  shop: { name: string; address: string; phone: string; email: string; terms: string; logoUrl: string };
  markup: number; taxRate: number; depositPct: number;
  upcharges: Partial<Record<Size, number>>;
  tiers: number[]; screen: number[][]; embroidery: number[]; dtf: number[];
  screenFee: number; digitizing: number;
};

export const DEFAULT_SETTINGS: Settings = {
  shop: { name: "FBS Print", address: "", phone: "", email: "", terms: "50% deposit to start production. Balance due at pickup.", logoUrl: "" },
  markup: 50,
  taxRate: 8.25,
  depositPct: 50,
  upcharges: { "2XL": 2, "3XL": 3, "4XL": 4, "5XL": 5 },
  tiers: [12, 24, 48, 72, 144, 288, 500],
  screen: [
    [4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
    [3.25, 4.0, 4.75, 5.5, 6.25, 7.0],
    [2.4, 3.0, 3.6, 4.2, 4.8, 5.4],
    [1.95, 2.45, 2.95, 3.45, 3.95, 4.45],
    [1.5, 1.9, 2.3, 2.7, 3.1, 3.5],
    [1.2, 1.5, 1.8, 2.1, 2.4, 2.7],
    [0.95, 1.2, 1.45, 1.7, 1.95, 2.2],
  ],
  embroidery: [9, 8, 7, 6.5, 6, 5.5, 5],
  dtf: [7, 6, 5, 4.5, 4, 3.5, 3],
  screenFee: 25,
  digitizing: 45,
};

/** Fill any missing keys in stored settings with defaults. */
export function mergeSettings(data: unknown): Settings {
  const d = (data && typeof data === "object" ? data : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    shop: { ...DEFAULT_SETTINGS.shop, ...(d.shop || {}) },
    upcharges: { ...DEFAULT_SETTINGS.upcharges, ...(d.upcharges || {}) },
  };
}

export const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
const num = (v: unknown) => (v === "" || v == null || isNaN(+(v as number)) ? 0 : +(v as number));

export function tierIndex(q: number, s: Settings) {
  let i = 0;
  s.tiers.forEach((m, ix) => { if (q >= m) i = ix; });
  return i;
}
export function lineQty(l: { sizes?: Partial<Record<Size, number>> }) {
  return SIZES.reduce((a, sz) => a + num(l.sizes?.[sz]), 0);
}

/** The order's garment groups; converts older one-garment lines on the fly. */
export function orderGroups(o: Pick<Order, "groups" | "lines">): Group[] {
  if (o.groups && o.groups.length) return o.groups;
  return (o.lines || []).map((l) => ({
    id: l.id,
    lines: [{ id: l.id + "-g", style: l.style || "", brand: "", garment: l.garment || "", color: l.color || "", cost: l.cost, sizes: l.sizes || {}, priceOverride: l.priceOverride ?? null }],
    imprints: (l.decorations || []).map((d) => ({ id: d.id, method: d.method, location: d.location, colors: d.colors, inks: "", size: "", notes: "" })),
  }));
}

function imprintPrice(d: Imprint, ti: number, s: Settings) {
  if (d.method === "screen") {
    const n = Math.min(6, Math.max(1, num(d.colors) || 1));
    return { each: num(s.screen[ti]?.[n - 1]), setup: n * num(s.screenFee) };
  }
  if (d.method === "embroidery") return { each: num(s.embroidery[ti]), setup: num(s.digitizing) };
  if (d.method === "dtf") return { each: num(s.dtf[ti]), setup: 0 };
  return { each: 0, setup: 0 };
}

export type LineCalc = { id: string; qty: number; garmentEach: number; calcEach: number; each: number; hasOv: boolean; sub: number; upTotal: number };
export type GroupCalc = ReturnType<typeof calcGroup>;
export function calcGroup(g: Group, o: Pick<Order, "waive_setup">, s: Settings) {
  const qty = (g.lines || []).reduce((a, l) => a + lineQty(l), 0);
  const ti = tierIndex(qty, s);
  const imprints = (g.imprints || []).map((d) => ({ id: d.id, ...imprintPrice(d, ti, s) }));
  const printEach = r2(imprints.reduce((a, d) => a + d.each, 0));
  const lines: LineCalc[] = (g.lines || []).map((l) => {
    const lq = lineQty(l);
    const garmentEach = r2(num(l.cost) * (1 + num(s.markup) / 100));
    const calcEach = r2(garmentEach + printEach);
    const hasOv = l.priceOverride !== null && l.priceOverride !== undefined && (l.priceOverride as unknown) !== "" && !isNaN(+l.priceOverride);
    const each = hasOv ? r2(+(l.priceOverride as number)) : calcEach;
    let sub = 0, upTotal = 0;
    SIZES.forEach((sz) => {
      const q = num(l.sizes?.[sz]);
      const up = num(s.upcharges?.[sz]);
      sub += q * (each + up);
      upTotal += q * up;
    });
    return { id: l.id, qty: lq, garmentEach, calcEach, each, hasOv, sub: r2(sub), upTotal: r2(upTotal) };
  });
  const setup = o.waive_setup ? 0 : r2(imprints.reduce((a, d) => a + d.setup, 0));
  return { id: g.id, qty, ti, tierMin: s.tiers[ti], imprints, printEach, lines, sub: r2(lines.reduce((a, l) => a + l.sub, 0)), setup, belowMin: qty > 0 && qty < s.tiers[0] };
}

export type OrderCalc = ReturnType<typeof calcOrder>;
export function calcOrder(
  o: Pick<Order, "lines" | "groups" | "fees" | "discount_pct" | "tax_exempt" | "tax_rate" | "waive_setup">,
  s: Settings,
  payments: Pick<Payment, "amount">[] = []
) {
  const groups = orderGroups(o).map((g) => calcGroup(g, o, s));
  const lines = groups.flatMap((g) => g.lines);
  const items = r2(groups.reduce((a, g) => a + g.sub, 0));
  const setup = r2(groups.reduce((a, g) => a + g.setup, 0));
  const fees = r2((o.fees || []).reduce((a, f) => a + num(f.amount), 0));
  const pre = items + setup + fees;
  const discount = r2((pre * num(o.discount_pct)) / 100);
  const rate = o.tax_rate === null || o.tax_rate === undefined || (o.tax_rate as unknown) === "" ? num(s.taxRate) : num(o.tax_rate);
  const tax = o.tax_exempt ? 0 : r2(((pre - discount) * rate) / 100);
  const total = r2(pre - discount + tax);
  const paid = r2(payments.reduce((a, p) => a + num(p.amount), 0));
  const qty = groups.reduce((a, g) => a + g.qty, 0);
  return { groups, lines, items, setup, fees, discount, rate, tax, total, paid, balance: r2(total - paid), qty };
}

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function newGLine(): GLine {
  return { id: uid(), style: "", brand: "", garment: "", color: "", cost: "", sizes: {}, priceOverride: null };
}
export function newImprint(location = "Front"): Imprint {
  return { id: uid(), method: "screen", location, colors: 1, inks: "", size: "", notes: "" };
}
export function newGroup(): Group {
  return { id: uid(), lines: [newGLine()], imprints: [newImprint()] };
}
/** Short description of an imprint for invoices and the portal. */
export function imprintLabel(d: Imprint) {
  const parts = [`${METHODS[d.method] || d.method} ${d.location}`.trim()];
  if (d.method === "screen") parts.push(`${d.colors} color${d.colors > 1 ? "s" : ""}`);
  if (d.inks) parts.push(d.inks);
  if (d.size) parts.push(d.size);
  return parts.join(" · ");
}
