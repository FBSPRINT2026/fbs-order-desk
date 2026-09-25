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

export type Decoration = { id: string; method: "screen" | "embroidery" | "dtf"; location: string; colors: number };
export type Line = {
  id: string; garment: string; style: string; color: string; cost: number | "";
  sizes: Partial<Record<Size, number>>; decorations: Decoration[]; priceOverride: number | null;
};
export type Fee = { label: string; amount: number | "" };

export type Order = {
  id: string; number: number; customer_id: string | null; nickname: string; status: StatusKey; type: "quote" | "invoice";
  due_date: string | null; lines: Line[]; fees: Fee[]; discount_pct: number; tax_exempt: boolean; tax_rate: number | null;
  waive_setup: boolean; notes: string; total: number; qty: number; sent_at: string | null; approved_at: string | null;
  approved_name: string | null; created_at: string; updated_at: string;
};
export type Payment = { id: string; order_id: string; amount: number; method: string; paid_on: string; stripe_session_id: string | null; created_at: string };
export type Customer = { id: string; company: string; name: string; email: string; phone: string; address: string; notes: string; tax_exempt: boolean; created_at: string };
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
export function lineQty(l: Line) {
  return SIZES.reduce((a, s) => a + num(l.sizes?.[s]), 0);
}
function decoPrice(d: Decoration, ti: number, s: Settings) {
  if (d.method === "screen") {
    const n = Math.min(6, Math.max(1, num(d.colors) || 1));
    return { each: num(s.screen[ti]?.[n - 1]), setup: n * num(s.screenFee) };
  }
  if (d.method === "embroidery") return { each: num(s.embroidery[ti]), setup: num(s.digitizing) };
  if (d.method === "dtf") return { each: num(s.dtf[ti]), setup: 0 };
  return { each: 0, setup: 0 };
}

export type LineCalc = ReturnType<typeof calcLine>;
export function calcLine(l: Line, o: Pick<Order, "waive_setup">, s: Settings) {
  const qty = lineQty(l);
  const ti = tierIndex(qty, s);
  const garmentEach = r2(num(l.cost) * (1 + num(s.markup) / 100));
  const decos = (l.decorations || []).map((d) => ({ id: d.id, ...decoPrice(d, ti, s) }));
  const decoEach = r2(decos.reduce((a, d) => a + d.each, 0));
  const calcEach = r2(garmentEach + decoEach);
  const hasOv = l.priceOverride !== null && l.priceOverride !== undefined && (l.priceOverride as unknown) !== "" && !isNaN(+l.priceOverride);
  const each = hasOv ? r2(+(l.priceOverride as number)) : calcEach;
  let sub = 0, upTotal = 0;
  SIZES.forEach((sz) => {
    const q = num(l.sizes?.[sz]);
    const up = num(s.upcharges?.[sz]);
    sub += q * (each + up);
    upTotal += q * up;
  });
  const setup = o.waive_setup ? 0 : r2(decos.reduce((a, d) => a + d.setup, 0));
  return { qty, ti, tierMin: s.tiers[ti], garmentEach, decos, decoEach, calcEach, each, hasOv, sub: r2(sub), upTotal: r2(upTotal), setup, belowMin: qty > 0 && qty < s.tiers[0] };
}

export type OrderCalc = ReturnType<typeof calcOrder>;
export function calcOrder(
  o: Pick<Order, "lines" | "fees" | "discount_pct" | "tax_exempt" | "tax_rate" | "waive_setup">,
  s: Settings,
  payments: Pick<Payment, "amount">[] = []
) {
  const lines = (o.lines || []).map((l) => calcLine(l, o, s));
  const items = r2(lines.reduce((a, l) => a + l.sub, 0));
  const setup = r2(lines.reduce((a, l) => a + l.setup, 0));
  const fees = r2((o.fees || []).reduce((a, f) => a + num(f.amount), 0));
  const pre = items + setup + fees;
  const discount = r2((pre * num(o.discount_pct)) / 100);
  const rate = o.tax_rate === null || o.tax_rate === undefined || (o.tax_rate as unknown) === "" ? num(s.taxRate) : num(o.tax_rate);
  const tax = o.tax_exempt ? 0 : r2(((pre - discount) * rate) / 100);
  const total = r2(pre - discount + tax);
  const paid = r2(payments.reduce((a, p) => a + num(p.amount), 0));
  const qty = lines.reduce((a, l) => a + l.qty, 0);
  return { lines, items, setup, fees, discount, rate, tax, total, paid, balance: r2(total - paid), qty };
}

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function newLine(): Line {
  return { id: uid(), garment: "", style: "", color: "", cost: "", sizes: {}, decorations: [{ id: uid(), method: "screen", location: "Front", colors: 1 }], priceOverride: null };
}
