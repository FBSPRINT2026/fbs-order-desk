/**
 * Merch stores, shared by the shop, the customer portal and the public storefront (no server-only code here).
 * A store is a pre-order window for one client (a school PTA, a team): shoppers order one by one, the store closes,
 * we order the goods, print, and pack every order in its own bag sorted for hand-out.
 */

export type StoreStatus = "draft" | "review" | "open" | "closed" | "ordered" | "production" | "packing" | "ready" | "delivered" | "archived";
export type Field = { key: string; label: string; kind: "text" | "select"; options: string[]; required: boolean; /** packing sort order: 0 first; -1 = not used for sorting */ sort: number };
export type Delivery = { org: { on: boolean; label: string; address: string; note: string }; pickup: { on: boolean; note: string }; ship: { on: boolean; flat: number } };
export type Brand = { school?: string; mascot?: string; district?: string; city?: string; logo?: string; banner?: string; primary?: string; accent?: string; text?: string; tagline?: string };
export type TimelineEvent = { status: string; at: string; by: string; note?: string };
export type Store = {
  id: string; customer_id: string | null; name: string; slug: string; status: StoreStatus;
  opens_at: string | null; closes_at: string | null; deliver_by: string | null;
  brand: Brand; welcome: string; delivery: Delivery; fields: Field[]; giveback: { goal?: number; note?: string };
  tax_rate: number; tax_exempt: boolean; contact: { name?: string; email?: string; phone?: string }; password: string;
  order_id: string | null; goods_ordered_at: string | null; timeline: TimelineEvent[]; owner: "staff" | "customer"; notes: string;
  /** expected: pieces per design (for prices); notify: email shoppers at each step */
  settings: { expected?: number; notify?: boolean };
  created_by: string; created_at: string; updated_at: string;
};
export type ProductColor = { name: string; hex: string; /** mockup (storage path under stores/) */ image: string; /** blank photo URL (supplier) */ photo: string; back?: string; /** sizes offered in this color */ sizes: string[] };
/** a second blank for youth sizes ("Spirit Tee" = Gildan 5000 adult + 5000B youth) */
export type YouthBlank = { supplier: string; style: string; brand: string; garment_id: string | null; sizes: string[]; cost: Record<string, number> };
export type Product = {
  id: string; store_id: string; position: number; name: string; description: string; design_id: string | null;
  imprint: { location?: string; width?: number; inks?: string; method?: string; colors?: number; back_design_id?: string | null; back_location?: string; youth?: YouthBlank | null };
  supplier: string; style: string; brand: string; garment_id: string | null; colors: ProductColor[]; sizes: string[];
  cost: Record<string, number>; base_price: number; giveback: number; upcharges: Record<string, number>;
  personalize: { label: string; price: number; max: number }[]; active: boolean;
};
export type OrderItem = { id?: string; product_id: string; name: string; style: string; color: string; size: string; qty: number; unit_price: number; base_price: number; giveback: number; personalization: Record<string, string>; pack?: "" | "packed" | "backorder" };
export type MerchOrder = {
  id: string; store_id: string; number: number; token: string; shopper: { name: string; email: string; phone?: string }; answers: Record<string, string>;
  delivery: "org" | "pickup" | "ship"; ship_to: { name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string };
  subtotal: number; tax: number; shipping: number; total: number; giveback: number;
  status: "pending" | "paid" | "cancelled" | "refunded" | "packed" | "delivered" | "picked_up" | "shipped";
  paid_at: string | null; processor_id: string; pay_method: string; packed_at: string | null; packed_by: string; tracking: string;
  changes: { at: string; by: string; what: string }[]; note: string; created_at: string; items?: OrderItem[];
  /** orders checked out together (siblings: one payment, one bag each) share this */
  checkout_id?: string | null;
};

export const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
export const SIZE_ORDER = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
export const bySize = (a: string, b: string) => { const i = SIZE_ORDER.indexOf(a), j = SIZE_ORDER.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b); };
export const isYouthSize = (z: string) => /^Y/.test(z);
export const sizeName = (z: string) => ({ YXS: "Youth XS", YS: "Youth S", YM: "Youth M", YL: "Youth L", YXL: "Youth XL", OS: "One size" } as Record<string, string>)[z] || `Adult ${z}`;

/** a quick size guide for parents (typical youth ages and adult chest sizes; brands vary a little) */
export const SIZE_GUIDE: Record<string, string> = {
  YXS: "Ages 4–5", YS: "Ages 6–8", YM: "Ages 10–12", YL: "Ages 14–16", YXL: "Ages 18–20",
  XS: "Chest 31–33″", S: "Chest 34–36″", M: "Chest 38–40″", L: "Chest 42–44″", XL: "Chest 46–48″", "2XL": "Chest 50–52″", "3XL": "Chest 54–56″", "4XL": "Chest 58–60″", "5XL": "Chest 62–64″",
};
/** the size on its own, without "Youth" ("YM" → "M") */
export const shortSize = (z: string) => z.replace(/^Y(?=XS|S|M|L|XL)/, "");

/** what a shopper pays for one piece in this size (FBS's price + the give-back + the size's upcharge) */
export const unitPrice = (p: Pick<Product, "base_price" | "giveback" | "upcharges">, size: string) => r2(+p.base_price + +p.giveback + +(p.upcharges?.[size] || 0));
/** the lowest and highest price a product sells for (for "from $18") */
export function priceRange(p: Product) {
  const ps = (p.sizes.length ? p.sizes : ["M"]).map((z) => unitPrice(p, z));
  return { min: Math.min(...ps), max: Math.max(...ps) };
}

/** order money: items, shipping, tax (on items + shipping, Texas), total, and the give-back inside it */
export function orderTotals(items: Pick<OrderItem, "qty" | "unit_price" | "giveback">[], opts: { taxRate: number; taxExempt: boolean; shipping: number }) {
  const subtotal = r2(items.reduce((a, i) => a + i.qty * i.unit_price, 0));
  const giveback = r2(items.reduce((a, i) => a + i.qty * i.giveback, 0));
  const shipping = r2(opts.shipping || 0);
  const tax = opts.taxExempt ? 0 : r2(((subtotal + shipping) * (+opts.taxRate || 0)) / 100);
  return { subtotal, shipping, tax, total: r2(subtotal + shipping + tax), giveback, pieces: items.reduce((a, i) => a + i.qty, 0) };
}

/** a store's steps, as the shop and the shopper see them */
export const STORE_STEPS: { k: StoreStatus; label: string; shopper: string; hint: string }[] = [
  { k: "draft", label: "Draft", shopper: "Coming soon", hint: "Being set up; not public yet" },
  { k: "review", label: "Waiting for FBS", shopper: "Coming soon", hint: "Built by the customer; FBS checks it before it opens" },
  { k: "open", label: "Open", shopper: "Taking orders", hint: "Live: shoppers are ordering" },
  { k: "closed", label: "Closed", shopper: "Store closed", hint: "No more orders; next: order the goods" },
  { k: "ordered", label: "Goods ordered", shopper: "Goods ordered", hint: "Blanks ordered from the vendors" },
  { k: "production", label: "In production", shopper: "Printing", hint: "On the press" },
  { k: "packing", label: "Packing", shopper: "Packing orders", hint: "Packing each order in its own bag" },
  { k: "ready", label: "Ready", shopper: "Ready", hint: "Packed; arranging delivery with the contact" },
  { k: "delivered", label: "Delivered", shopper: "Delivered", hint: "Delivered / handed out" },
  { k: "archived", label: "Archived", shopper: "Closed", hint: "Done and filed away" },
];
export const stepOf = (s: StoreStatus) => STORE_STEPS.find((x) => x.k === s) || STORE_STEPS[0];
/** the steps a shopper sees on their status page (after they've ordered) */
export const SHOPPER_STEPS: StoreStatus[] = ["open", "closed", "ordered", "production", "packing", "delivered"];
export const stepIndex = (s: StoreStatus) => { const i = SHOPPER_STEPS.indexOf(s === "ready" ? "packing" : s === "archived" ? "delivered" : s); return i < 0 ? 0 : i; };

/** the store is taking orders right now */
export function isOpen(st: Pick<Store, "status" | "opens_at" | "closes_at">, now = Date.now()) {
  if (st.status !== "open") return false;
  if (st.opens_at && Date.parse(st.opens_at) > now) return false;
  if (st.closes_at && Date.parse(st.closes_at) <= now) return false;
  return true;
}
/** shoppers can still change their own order: until the goods are ordered */
export const canChange = (st: Pick<Store, "status" | "goods_ordered_at">) => !st.goods_ordered_at && (st.status === "open" || st.status === "closed");

const CT = "America/Chicago";
export const fmtDate = (d: string | null | undefined, withDay = true) => {
  if (!d) return "";
  const x = d.length === 10 ? new Date(d + "T12:00:00") : new Date(d);
  return x.toLocaleDateString("en-US", { timeZone: CT, ...(withDay ? { weekday: "long" } : {}), month: "long", day: "numeric" });
};
export const fmtDateTime = (d: string | null | undefined) => (!d ? "" : new Date(d).toLocaleString("en-US", { timeZone: CT, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));

/**
 * The pre-order line every page shows (Amanda: "people think they're going to have already received their goods").
 * "This is a pre-order. The store closes Friday, October 17. Orders are printed after it closes and delivered to the
 * school around Monday, November 3."
 */
export function preorderLine(st: Pick<Store, "closes_at" | "deliver_by" | "delivery" | "brand" | "name">) {
  const where = st.delivery?.org?.on ? `delivered to ${st.delivery.org.label || st.brand?.school || "the school"}` : st.delivery?.pickup?.on ? "ready for pickup" : "shipped";
  const close = st.closes_at ? ` The store closes ${fmtDate(st.closes_at)}.` : "";
  const when = st.deliver_by ? ` Orders are printed after the store closes and ${where} around ${fmtDate(st.deliver_by)}.` : ` Orders are printed after the store closes and ${where}.`;
  return `This is a pre-order: nothing ships right away.${close}${when}`;
}

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** the order's label for people: "WHITT-0042" */
export const orderCode = (st: Pick<Store, "slug">, n: number) => `${st.slug.split("-")[0].toUpperCase().slice(0, 8)}-${String(n).padStart(4, "0")}`;

/** the packing sort: the store's sort fields in order (grade → teacher → student by default) */
export function packingKey(fields: Field[], answers: Record<string, string>, shopperName = "") {
  const sorted = fields.filter((f) => f.sort >= 0).sort((a, b) => a.sort - b.sort);
  const gradeRank = (v: string) => { const m = v.match(/^(\d+)/); return /^k/i.test(v) ? "00" : /pre/i.test(v) ? "-1" : m ? m[1].padStart(2, "0") : "99" + v; };
  return [...sorted.map((f) => (f.key === "grade" || f.kind === "select" ? (f.options.indexOf(answers[f.key] || "") >= 0 ? String(f.options.indexOf(answers[f.key])).padStart(3, "0") : gradeRank(answers[f.key] || "")) : (answers[f.key] || "").toLowerCase())), shopperName.toLowerCase()].join("|");
}

/** the answers worth printing big on a bag label / packing slip, in the store's order */
export const labelAnswers = (fields: Field[], answers: Record<string, string>) => fields.map((f) => ({ label: f.label, value: (answers[f.key] || "").trim() })).filter((x) => x.value);

export const DEFAULT_FIELDS: Field[] = [
  { key: "student", label: "Student name", kind: "text", options: [], required: true, sort: 2 },
  { key: "grade", label: "Grade", kind: "select", options: ["K", "1st", "2nd", "3rd", "4th", "5th", "Staff"], required: true, sort: 0 },
  { key: "teacher", label: "Homeroom teacher", kind: "select", options: [], required: true, sort: 1 },
];

/** store-image paths are served by /api/store-img (private storage) */
export const storeImg = (path: string | undefined | null) => (!path ? "" : /^(https?:|data:|\/)/.test(path) ? path : `/api/store-img?p=${encodeURIComponent(path)}`);
