// Shared pricing engine and order vocabulary.
// Used by the shop editor (live totals), the customer portal (display)
// and the server (Stripe amounts), so every total comes from one place.

export const YOUTH_SIZES = ["YXS", "YS", "YM", "YL", "YXL"] as const;
export const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;
/** Quantity for one-size items (hats, koozies, bags). */
export const ONE_SIZE = "OS" as const;
/** Every size, youth first, then one-size. Orders store quantities keyed by these names. */
export const SIZES = [...YOUTH_SIZES, ...ADULT_SIZES, ONE_SIZE] as const;
/** How a size is shown to people. */
export const sizeLabel = (z: string) => (z === ONE_SIZE ? "Qty" : z);
export type Size = (typeof SIZES)[number];

export type StatusKey =
  | "request" | "quote" | "quote_sent" | "approved" | "art" | "blanks" | "production" | "ready" | "completed";

export const STATUSES: { k: StatusKey; label: string; portal: string; type: "quote" | "invoice"; c: string }[] = [
  { k: "request", label: "Order request", portal: "Order request", type: "quote", c: "#0E9F9A" },
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
/** House ink: Wilflex Epic Rio RFU standard colors. */
export const INK_COLORS = ["White", "Lemon Yellow", "Yellow", "Light Gold", "Gold", "Dolphin Orange", "Bright Orange", "Electric Orange", "National Red", "Drake Red", "Dallas Scarlet", "Scarlet", "Electric Red", "Maroon", "Brandywine", "Russell Purple", "Electric Purple", "Russell Gray", "Dark Gray", "Tan", "Aqua", "Contact Blue", "Royal", "Light Royal", "Bears Navy", "Navy", "Electric Blue", "Kelly Green", "Light Green", "Dark Green", "Electric Green", "Electric Yellow", "Electric Pink", "Black Diamond", "Black"];
/** Embroidery thread colors (standard list for now). */
export const THREAD_COLORS = ["White", "Black", "Navy", "Royal", "Light Blue", "Carolina Blue", "Red", "Maroon", "Kelly Green", "Forest Green", "Lime Green", "Gold", "Athletic Gold", "Yellow", "Orange", "Purple", "Pink", "Hot Pink", "Silver", "Gray", "Charcoal", "Brown", "Tan", "Cream"];
/** Staff roles. Owner sees everything; the others get their own views as those screens are built. */
export const ROLES = { owner: "Owner", admin: "Admin (orders, customers, payments)", production: "Production manager", receiving: "Receiving", shipping: "Shipping" } as const;
export type Role = keyof typeof ROLES;
/** Print locations (match the fbsprint.com order form). */
export const LOCATIONS = ["Left Chest", "Right Chest", "Full Front", "Medium Front", "Center Chest", "Across Chest", "Full Back", "Medium Back", "Upper Back (Yoke)", "Across Shoulders", "Left Sleeve", "Right Sleeve", "Left Vertical", "Right Vertical", "Front Bottom Left", "Front Bottom Right", "Pocket"];
export const SHIP_METHODS = [
  "UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS Next Day Air",
  "FedEx Ground", "FedEx Home Delivery", "FedEx Express Saver", "FedEx 2Day", "FedEx Standard Overnight",
  "USPS Priority Mail", "USPS Ground Advantage",
];
export const PAY_METHODS = ["Credit card", "ACH", "Zelle", "Venmo", "Cash", "Check", "Card", "Other"];

export type Method = "screen" | "embroidery" | "dtf";
/** One decoration on a group of garments (Printavo calls these imprints). */
export type Imprint = { id: string; method: Method; location: string; colors: number; inks: string; size: string; notes: string; inkChanges?: number; /** inches down from the collar; blank = standard */ drop?: string; /** the customer design printed here */ design_id?: string; /** staff confirmed a small print really goes on this big location */ keepLocation?: boolean; };
/** A piece of customer art, saved under their account and reused across orders. */
export type Design = { id: string; number: number; customer_id: string | null; name: string; file_path: string; file_name: string; file_type: string; preview_path: string; width_px: number | null; height_px: number | null; starred?: boolean; archived_at?: string | null; /** made in the shirt designer: where its editable layers are saved */ designer?: { file: string } | null; method: string; colors: number; inks: string; notes: string; created_by: string; created_at: string };
export const designLabel = (d: Pick<Design, "number" | "name">) => `D-${d.number}${d.name ? " · " + d.name : ""}`;
/** Height for a given width (or width for a given height) from the design's proportions. */
export function designOther(d: Pick<Design, "width_px" | "height_px"> | null | undefined, value: number, given: "W" | "H") {
  if (!d?.width_px || !d?.height_px || !value) return 0;
  const r = d.height_px / d.width_px;
  return Math.round((given === "W" ? value * r : value / r) * 100) / 100;
}
/** One garment + color row, with its size run. */
export type GLine = {
  id: string; style: string; brand: string; garment: string; color: string; cost: number | "";
  sizes: Partial<Record<Size, number>>; priceOverride: number | null;
  /** One-size item (hat, koozie, bag): a single quantity instead of a size run. */
  oneSize?: boolean;
  /** Sizes this garment comes in, copied from the catalog when the style is picked. */
  sizeRun?: string[];
  /** 2XL+ material charge per piece from the supplier's size pricing (S&S). Overrides the settings upcharges on retail. */
  sizeUp?: Partial<Record<Size, number>>;
};
/** Garments that share the same imprints. Quantity breaks use the group total. */
export type Group = { id: string; name?: string; lines: GLine[]; imprints: Imprint[]; finishing?: string[]; youth?: boolean;
  /** when mockups were last saved for this group (unlocks the imprints section) */ mockupAt?: string;
  /** staff chose to fill in imprints without making a mockup */ mockupSkipped?: boolean;
  /** photos-only pictures of the latest saved mockups (storage paths), shown as thumbnails on the order */ mockupThumbs?: string[];
  /** mockups the customer supplied themselves (their own software, or saved from the portal builder): storage paths */
  customerMockups?: { path: string; name: string }[] };
export type PriceType = "retail" | "wholesale";

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
  due_date: string | null; lines: Line[]; groups: Group[]; fees: Fee[]; discount_pct: number; discount_amt?: number; discount_type?: "pct" | "amt"; tax_exempt: boolean; tax_rate: number | null;
  waive_setup: boolean; notes: string; total: number; qty: number; sent_at: string | null; approved_at: string | null;
  approved_name: string | null; created_at: string; updated_at: string;
  price_type: PriceType; submitted_at?: string | null; completed_at?: string | null; source?: string; po_number: string; production_date: string | null; rush: boolean; delivery_method: Delivery; ship_to: string; ship_method: string; tracking: string;
};
export type Garment = { id: string; style: string; brand: string; description: string; colors: string[]; cost: number; sizes?: string[]; size_costs?: Record<string, number>; ss_style_id?: number | null; image?: string; synced_at?: string | null; color_images?: Record<string, { front: string; back: string; side: string; hex: string }> };
export type ArtFile = { id: string; order_id: string; name: string; file_path: string; file_type: string; created_at: string };
export type Payment = { id: string; order_id: string; amount: number; method: string; paid_on: string; stripe_session_id: string | null; created_at: string; fee?: number; processor_id?: string | null; note?: string | null };
export type Customer = { id: string; company: string; name: string; email: string; phone: string; address: string; notes: string; tax_exempt: boolean; created_at: string; contact2_name: string; contact2_email: string; contact2_phone: string; ship_address: string; price_type: PriceType; payment_terms?: PayTerms;
  /** CRM */ tags?: string[]; next_follow_up?: string | null; owner_email?: string; last_contact_at?: string | null;
  /** shipping: whose carrier account pays (fbs = ours, with markup) */ ship_bill?: "fbs" | "ups" | "fedex"; ship_ups_account?: string; ship_fedex_account?: string; ship_bill_zip?: string };
/** One entry on a customer's timeline: an email, call, note, meeting or task. */
export type Activity = { id: string; customer_id: string | null; order_id: string | null; kind: "note" | "call" | "email" | "meeting" | "task" | "sms"; direction: "in" | "out" | "none"; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; ai_processed_at: string | null; meta: Record<string, unknown>; created_by: string; created_at: string };
/** One item in the Assistant inbox. */
export type Suggestion = { id: string; kind: string; source: "rules" | "ai" | "staff"; status: "open" | "snoozed" | "done" | "dismissed"; priority: 1 | 2 | 3; dedupe_key: string | null; customer_id: string | null; order_id: string | null; activity_id: string | null; title: string; body: string; draft: { channel?: "portal" | "email"; subject?: string; body?: string }; payload: Record<string, unknown>; due_at: string | null; snoozed_until: string | null; model: string | null; decided_at: string | null; decided_by: string | null; created_at: string; updated_at: string };
export type Proof = { id: string; order_id: string; title: string; file_path: string; file_type: string; status: "pending" | "approved" | "changes"; customer_comment: string; decided_at: string | null; decided_name: string | null; created_at: string };
export type Message = { id: string; order_id: string; author_type: "staff" | "customer"; author_email: string; author_name: string; body: string; read_at: string | null; created_at: string };
export type OrderEvent = { id: number; order_id: string; kind: string; detail: string; actor: string; created_at: string };

/** One imprint price list (retail or wholesale). */
export type PriceList = {
  tiers: number[]; screen: number[][]; embroidery: number[]; dtf: number[];
  screenFee: number; digitizing: number; inkChangeFee: number;
  upcharges: Partial<Record<Size, number>>;
  /** Optional all-inclusive retail model (ooshirts style). All arrays are per tier. */
  blankAdd?: number[];        // added to each garment's price (handling / shipping built in)
  screenLight?: number[][];   // screen print per location on light garments (screen = dark garments)
  dtg?: number[];             // full-color digital print per location, dark garments
  dtgLight?: number[];        // full-color digital print per location, light garments
  lightColors?: string[];     // garment colors that get light-garment screen prices
  dtgLightColors?: string[];  // garment colors that get light-garment full-color prices (no white underbase)
  colorAdjust?: Record<string, number>; // per-piece price change by garment color (e.g. White -0.065)
};
export const FULL_COLOR = 11;
/** True when a garment color is on the light-garment list. */
const normColor = (c: string) => (c || "").trim().toLowerCase().replace(/^sports /, "sport ");
export function isLightColor(color: string, pl: Pick<PriceList, "lightColors">, list = pl.lightColors) {
  const c = normColor(color);
  return !!c && (list || []).some((x) => normColor(x) === c);
}
export type Finishing = { id: string; name: string; price: number };
export type Settings = PriceList & {
  shop: { name: string; address: string; phone: string; email: string; terms: string; logoUrl: string };
  markup: number; taxRate: number; depositPct: number;
  /** online payments: card fee % (credit card only), and where to send Zelle / Venmo */
  pay: { cardFeePct: number; zelle: string; venmo: string };
  wholesale: PriceList;
  finishing: Finishing[];
  /** Follow-up rules and the (optional) AI assistant. */
  assistant: AssistantSettings;
  /** Shipping center: pieces per box, where we ship from, saved box sizes, and the markup on our own account. */
  ship: ShipSettings;
};

export type ShipAddress = { name: string; company: string; street1: string; street2: string; city: string; state: string; zip: string; country: string; phone: string; email: string };
export type BoxSize = { name: string; length: number; width: number; height: number };
export type ShipSettings = {
  perBox: number;          // pieces that fit in one box (for the box estimate)
  from: ShipAddress;       // our return / pickup address
  boxes: BoxSize[];        // box sizes we keep on hand
  markupPct: number;       // on our account: what we paid + this %
  perBoxFee: number;       // + this per box
  minCharge: number;       // at least this
  thirdPartyFee: number;   // per box, when it ships on the customer's own account (0 = free)
};

/** When the Assistant flags things, and what the AI is allowed to do. AI stays off until an API key is set AND ai.enabled is on. */
export type AssistantSettings = {
  quoteFollowUpDays: number;   // quote sent, no answer after this many days
  proofFollowUpDays: number;   // proof waiting on the customer this many days
  replyWithinHours: number;    // customer message with no reply after this many hours = urgent
  priceRequestDays: number;    // customer order request not priced after this many days
  atRiskDays: number;          // job not printing yet and due within this many days
  pickupRemindDays: number;    // ready for pickup this many days
  reorderAfterDays: number;    // customers with no order in this many days get a check-in
  digest: boolean;             // email the shop a daily list of follow-ups
  ai: {
    enabled: boolean;          // master switch
    model: string;             // Claude model for drafting and reading orders
    fastModel: string;         // cheaper model for sorting emails
    readEmails: boolean;       // read forwarded emails and suggest orders / replies
    customerAssist: boolean;   // "describe your order" box in the customer order form
    voice: string;             // how the shop sounds in drafted messages
  };
};

export const DEFAULT_SETTINGS: Settings = {
  shop: { name: "FBS Print", address: "", phone: "", email: "", terms: "50% deposit to start production. Balance due at pickup.", logoUrl: "" },
  markup: 50,
  taxRate: 8.25,
  depositPct: 50,
  pay: { cardFeePct: 3.25, zelle: "", venmo: "" },
  upcharges: { "2XL": 2, "3XL": 3, "4XL": 4, "5XL": 5 }, // 2XL+ Materials Charge (per piece, billed as their own line)
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
  inkChangeFee: 15,
  wholesale: {
    tiers: [12, 24, 48, 72, 144, 288, 500],
    screen: [
      [3.25, 4.0, 4.75, 5.5, 6.25, 7.0],
      [2.4, 3.0, 3.6, 4.2, 4.8, 5.4],
      [1.75, 2.2, 2.65, 3.1, 3.55, 4.0],
      [1.4, 1.8, 2.2, 2.6, 3.0, 3.4],
      [1.1, 1.4, 1.7, 2.0, 2.3, 2.6],
      [0.9, 1.15, 1.4, 1.65, 1.9, 2.15],
      [0.7, 0.9, 1.1, 1.3, 1.5, 1.7],
    ],
    embroidery: [7, 6.25, 5.5, 5, 4.5, 4.25, 4],
    dtf: [5.5, 4.75, 4, 3.5, 3.25, 3, 2.75],
    screenFee: 20,
    digitizing: 40,
    inkChangeFee: 15,
    upcharges: { "2XL": 0.5, "3XL": 0.75, "4XL": 1, "5XL": 1 },
  },
  finishing: [
    { id: "fold_bag", name: "Fold & bag", price: 0.5 },
    { id: "hang_tag", name: "Hang tag", price: 0.35 },
    { id: "relabel", name: "Remove tag & relabel", price: 1.0 },
  ],
  assistant: {
    quoteFollowUpDays: 3,
    proofFollowUpDays: 2,
    replyWithinHours: 24,
    priceRequestDays: 1,
    atRiskDays: 5,
    pickupRemindDays: 5,
    reorderAfterDays: 150,
    digest: false,
    ai: {
      enabled: false,
      model: "claude-sonnet-5",
      fastModel: "claude-haiku-4-5-20251001",
      readEmails: false,
      customerAssist: false,
      voice: "Friendly, short and plain-spoken, like a local print shop owner. Sign off as the FBS Print team.",
    },
  },
  ship: {
    perBox: 72,
    from: { name: "Shipping", company: "FBS Print", street1: "", street2: "", city: "Richardson", state: "TX", zip: "75081", country: "US", phone: "9724877858", email: "" },
    boxes: [
      { name: "Small", length: 14, width: 10, height: 8 },
      { name: "Medium", length: 18, width: 14, height: 10 },
      { name: "Large", length: 20, width: 16, height: 12 },
      { name: "XL", length: 24, width: 18, height: 12 },
    ],
    markupPct: 15, perBoxFee: 2, minCharge: 0, thirdPartyFee: 0,
  },
};

/** Fill any missing keys in stored settings with defaults. */
export function mergeSettings(data: unknown): Settings {
  const d = (data && typeof data === "object" ? data : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    shop: { ...DEFAULT_SETTINGS.shop, ...(d.shop || {}) },
    pay: { ...DEFAULT_SETTINGS.pay, ...(d.pay || {}) },
    upcharges: { ...DEFAULT_SETTINGS.upcharges, ...(d.upcharges || {}) },
    wholesale: { ...DEFAULT_SETTINGS.wholesale, ...(d.wholesale || {}), upcharges: { ...DEFAULT_SETTINGS.wholesale.upcharges, ...(d.wholesale?.upcharges || {}) } },
    finishing: Array.isArray(d.finishing) ? d.finishing : DEFAULT_SETTINGS.finishing,
    assistant: { ...DEFAULT_SETTINGS.assistant, ...(d.assistant || {}), ai: { ...DEFAULT_SETTINGS.assistant.ai, ...(d.assistant?.ai || {}) } },
    ship: { ...DEFAULT_SETTINGS.ship, ...(d.ship || {}), from: { ...DEFAULT_SETTINGS.ship.from, ...(d.ship?.from || {}) }, boxes: Array.isArray(d.ship?.boxes) && d.ship.boxes.length ? d.ship.boxes : DEFAULT_SETTINGS.ship.boxes },
  };
}

/** The price list and garment rules for retail or wholesale work. */
export function priceList(s: Settings, type: PriceType = "retail") {
  const pl: PriceList = type === "wholesale" ? s.wholesale : s;
  return { ...pl, markup: s.markup, useGarment: type !== "wholesale" };
}

export const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
const num = (v: unknown) => (v === "" || v == null || isNaN(+(v as number)) ? 0 : +(v as number));

export function tierIndex(q: number, s: { tiers: number[] }) {
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

function imprintPrice(d: Imprint, ti: number, s: PriceList, light = false, dtgLight = light) {
  const inkFee = num(d.inkChanges) * num(s.inkChangeFee);
  if (d.method === "screen") {
    const k = Math.max(1, num(d.colors) || 1);
    const full = k >= FULL_COLOR;
    if (s.dtg && full) {
      const each = num((dtgLight && s.dtgLight ? s.dtgLight : s.dtg)[ti]);
      return { each, setup: 0, inkFee, dtg: each, full: true };
    }
    const row = (light && s.screenLight ? s.screenLight : s.screen)[ti] || [];
    const n = Math.min(row.length || 6, k);
    const dtg = s.dtg ? num((dtgLight && s.dtgLight ? s.dtgLight : s.dtg)[ti]) : 0;
    return { each: num(row[n - 1]), setup: Math.min(n, 10) * num(s.screenFee), inkFee, dtg, full: false };
  }
  if (d.method === "embroidery") return { each: num(s.embroidery[ti]), setup: num(s.digitizing), inkFee };
  if (d.method === "dtf") return { each: num(s.dtf[ti]), setup: 0, inkFee };
  return { each: 0, setup: 0, inkFee };
}

export type LineCalc = { id: string; qty: number; garmentEach: number; printEach: number; light: boolean; calcEach: number; each: number; hasOv: boolean; sub: number; upTotal: number };
export type GroupCalc = ReturnType<typeof calcGroup>;
export function calcGroup(g: Group, o: Pick<Order, "waive_setup"> & { price_type?: PriceType }, s: Settings) {
  const pl = priceList(s, o.price_type || "retail");
  const qty = (g.lines || []).reduce((a, l) => a + lineQty(l), 0);
  const ti = tierIndex(qty, pl);
  const imprints = (g.imprints || []).map((d) => ({ id: d.id, ...imprintPrice(d, ti, pl) }));
  // Print price per piece. With a digital (full color) price list, screen prints switch to digital
  // for the whole garment when that is cheaper, or when any location is full color.
  const printFor = (light: boolean, dtgLight: boolean) => {
    const imps = light || dtgLight ? (g.imprints || []).map((d) => imprintPrice(d, ti, pl, light, dtgLight)) : imprints;
    const other = imps.filter((_, i) => (g.imprints || [])[i]?.method !== "screen").reduce((a, d) => a + d.each, 0);
    const scr = imps.filter((_, i) => (g.imprints || [])[i]?.method === "screen");
    let screenPart = scr.reduce((a, d) => a + d.each, 0);
    if (pl.dtg && scr.length) {
      const digital = scr.reduce((a, d) => a + num(d.dtg), 0);
      screenPart = scr.some((d) => d.full) ? digital : Math.min(screenPart, digital);
    }
    return other + screenPart;
  };
  const printEach = printFor(false, false);
  const printCache = new Map<string, number>();
  const printLine = (color: string) => {
    const light = isLightColor(color, pl), dl = isLightColor(color, pl, pl.dtgLightColors);
    const key = `${light}${dl}`;
    if (!printCache.has(key)) printCache.set(key, light || dl ? printFor(light, dl) : printEach);
    return { light, print: printCache.get(key) as number };
  };
  const finishing = (g.finishing || []).map((fid) => s.finishing.find((f) => f.id === fid)).filter(Boolean) as Finishing[];
  const finishEach = r2(finishing.reduce((a, f) => a + num(f.price), 0));
  const lines: LineCalc[] = (g.lines || []).map((l) => {
    const lq = lineQty(l);
    const adj = Object.entries(pl.colorAdjust || {}).find(([c]) => normColor(c) === normColor(l.color))?.[1] || 0;
    const garmentRaw = pl.useGarment ? num(l.cost) * (1 + num(pl.markup) / 100) + num(pl.blankAdd?.[ti]) + num(adj) : 0;
    const garmentEach = r2(garmentRaw);
    const { light, print: linePrint } = printLine(l.color);
    const calcEach = r2(garmentRaw + linePrint + finishEach);
    const hasOv = l.priceOverride !== null && l.priceOverride !== undefined && (l.priceOverride as unknown) !== "" && !isNaN(+l.priceOverride);
    const each = hasOv ? r2(+(l.priceOverride as number)) : calcEach;
    let sub = 0, upTotal = 0;
    SIZES.forEach((sz) => {
      const q = num(l.sizes?.[sz]);
      const up = pl.useGarment && l.sizeUp && l.sizeUp[sz] !== undefined ? num(l.sizeUp[sz]) : num(pl.upcharges?.[sz]);
      sub += q * each; // 2XL+ Materials Charge are billed as their own line
      upTotal += q * up;
    });
    return { id: l.id, qty: lq, garmentEach, printEach: r2(linePrint), light, calcEach, each, hasOv, sub: r2(sub), upTotal: r2(upTotal) };
  });
  const screens = o.waive_setup ? 0 : imprints.reduce((a, d) => a + d.setup, 0);
  const inkFees = imprints.reduce((a, d) => a + d.inkFee, 0);
  const setup = r2(screens + inkFees);
  return { id: g.id, qty, ti, tierMin: pl.tiers[ti], materials: r2(lines.reduce((a, l) => a + l.upTotal, 0)), imprints, printEach: r2(printEach), finishEach, finishing, lines, sub: r2(lines.reduce((a, l) => a + l.sub, 0)), setup, inkFees: r2(inkFees), belowMin: qty > 0 && qty < pl.tiers[0], wholesale: !pl.useGarment };
}

export type OrderCalc = ReturnType<typeof calcOrder>;
export function calcOrder(
  o: Pick<Order, "lines" | "groups" | "fees" | "discount_pct" | "tax_exempt" | "tax_rate" | "waive_setup"> & { price_type?: PriceType; discount_amt?: number; discount_type?: "pct" | "amt" },
  s: Settings,
  payments: Pick<Payment, "amount">[] = []
) {
  const groups = orderGroups(o).map((g) => calcGroup(g, o, s));
  const lines = groups.flatMap((g) => g.lines);
  const items = r2(groups.reduce((a, g) => a + g.sub, 0));
  const setup = r2(groups.reduce((a, g) => a + g.setup, 0));
  const materials = r2(groups.reduce((a, g) => a + g.materials, 0)); // 2XL+ Materials Charge
  const fees = r2((o.fees || []).reduce((a, f) => a + num(f.amount), 0));
  const pre = items + setup + materials + fees;
  const discount = o.discount_type === "amt" ? r2(Math.min(pre, Math.max(0, num(o.discount_amt)))) : r2((pre * num(o.discount_pct)) / 100);
  const rate = o.tax_rate === null || o.tax_rate === undefined || (o.tax_rate as unknown) === "" ? num(s.taxRate) : num(o.tax_rate);
  const tax = o.tax_exempt ? 0 : r2(((pre - discount) * rate) / 100);
  const total = r2(pre - discount + tax);
  const paid = r2(payments.reduce((a, p) => a + num(p.amount), 0));
  const qty = groups.reduce((a, g) => a + g.qty, 0);
  return { groups, lines, items, setup, materials, fees, discount, rate, tax, total, paid, balance: r2(total - paid), qty };
}

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function newGLine(): GLine {
  return { id: uid(), style: "", brand: "", garment: "", color: "", cost: "", sizes: {}, priceOverride: null };
}
export function newImprint(location = "Full Front"): Imprint {
  return { id: uid(), method: "screen", location, colors: 1, inks: "", size: "", notes: "", inkChanges: 0 };
}
export function newGroup(): Group {
  return { id: uid(), lines: [newGLine()], imprints: [newImprint()] };
}
/** True when a size is a youth size. */
export const isYouth = (z: string) => (YOUTH_SIZES as readonly string[]).includes(z);

/** Short description of an imprint for invoices and the portal. */
export function imprintLabel(d: Imprint) {
  const parts = [`${METHODS[d.method] || d.method} ${d.location}`.trim()];
  if (d.method === "screen" || d.method === "embroidery") parts.push(d.method === "screen" && d.colors >= FULL_COLOR ? "full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`);
  if (d.inks) parts.push(d.inks);
  if (d.size) parts.push(d.size);
  if (d.drop) parts.push(`${d.drop}" drop`);
  return parts.join(" · ");
}

/** Image types a browser can show as a logo preview. */
export const PREVIEWABLE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;

/**
 * What stops a customer's order from being sent in. Kept loose on purpose: it just needs pieces and
 * some artwork (a logo on any print location, or a mockup). Anything else is a gentle reminder (requestHints).
 */
export function requestProblems(groups: Group[]): string[] {
  const pcs = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
  const art = groups.some((g) => g.imprints.some((im) => im.design_id) || (g.customerMockups || []).length > 0);
  const out: string[] = [];
  if (!pcs) out.push("Add at least one garment with quantities");
  if (!art) out.push("Attach your artwork: upload a logo on a print location, or add a mockup");
  return out;
}

/** Nice-to-haves we remind the customer about but don't require (we can sort them out with them). */
export function requestHints(groups: Group[]): string[] {
  const out: string[] = [];
  groups.forEach((g, gi) => {
    const name = g.name || `Group ${gi + 1}`;
    g.imprints.forEach((im) => {
      const need: string[] = [];
      if (!im.design_id) need.push("logo");
      if (!(im.size || "").trim()) need.push("print size");
      const inks = im.method !== "dtf" && !(im.method === "screen" && im.colors >= FULL_COLOR);
      if (inks && !(im.inks || "").trim()) need.push("ink colors");
      if (need.length) out.push(`${name} ${im.location || "print location"}: ${need.join(", ")}`);
    });
  });
  return out;
}


/** Customer payment terms. */
export type PayTerms = "prepay" | "receipt" | "net30";
export const PAY_TERMS: Record<PayTerms, string> = { prepay: "Pre-pay", receipt: "Due on receipt", net30: "Net 30 days" };
/**
 * When an order's payment is due under the customer's terms:
 * pre-pay = when the order is approved; due on receipt = when the order is closed (completed);
 * net 30 = 30 days after it's closed. Null = not due yet (still being made).
 */
export function payDueDate(o: { approved_at?: string | null; sent_at?: string | null; created_at: string; completed_at?: string | null }, terms?: PayTerms | null) {
  if (terms === "prepay") return (o.approved_at || o.sent_at || o.created_at || "").slice(0, 10) || null;
  const closed = (o.completed_at || "").slice(0, 10);
  if (!closed) return null;
  if (terms !== "net30") return closed;
  const d = new Date(closed + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}
