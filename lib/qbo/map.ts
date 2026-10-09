import { calcOrder, imprintLabel, orderGroups, payDueDate, r2, sizeLabel, SIZES, type Order, type PayTerms, type Settings } from "@/lib/pricing";

/**
 * QuickBooks Online: what we send, built from our records. Pure functions (no database, no network), so they can be
 * tested on real orders without QuickBooks. Totals come from calcOrder(), the same engine as the printed invoice and the
 * portal, so the QuickBooks invoice reproduces ours line for line.
 */

/* ---------------- settings ---------------- */

export type TaxMode = "qbo_ast" | "tax_line" | "none";
export type QboSettings = {
  enabled: boolean; mode: "preview" | "live"; live_from_number: number; adopt_from_number: number;
  realm_id: string; company_name: string;
  item_map: Record<string, string>; deposit_account_id: string; payment_method_map: Record<string, string>;
  tax_mode: TaxMode; tax_code_id: string; exemption_reason_id: string;
  term_map: Record<string, string>; default_term_id: string; discount_account_id: string;
  po_field_id: string; po_field_name: string; class_id: string; department_id: string;
};
export const DEFAULT_QBO_SETTINGS: QboSettings = {
  enabled: false, mode: "preview", live_from_number: 50000, adopt_from_number: 40000, realm_id: "", company_name: "",
  item_map: {}, deposit_account_id: "", payment_method_map: {}, tax_mode: "qbo_ast", tax_code_id: "", exemption_reason_id: "",
  term_map: {}, default_term_id: "", discount_account_id: "", po_field_id: "", po_field_name: "", class_id: "", department_id: "",
};
export function qboSettingsOf(row: Partial<QboSettings> | null | undefined): QboSettings {
  const r = (row || {}) as Partial<QboSettings>;
  return {
    ...DEFAULT_QBO_SETTINGS, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)),
    item_map: { ...(r.item_map || {}) }, payment_method_map: { ...(r.payment_method_map || {}) }, term_map: { ...(r.term_map || {}) },
  } as QboSettings;
}

/** The QuickBooks products/services our invoice lines are filed under (Settings → QuickBooks → Items). */
export const ITEM_KEYS: { k: string; label: string }[] = [
  { k: "screen", label: "Screen printing" },
  { k: "embroidery", label: "Embroidery" },
  { k: "dtf", label: "DTF / heat press" },
  { k: "garments", label: "Garments with no decoration" },
  { k: "setup_screens", label: "Screen setup (new screens)" },
  { k: "setup_remake", label: "Screen setup (repeat screens)" },
  { k: "digitize", label: "Digitizing" },
  { k: "pms", label: "PMS color match" },
  { k: "inkchange", label: "Ink change" },
  { k: "min", label: "Minimum order charge" },
  { k: "materials", label: "2XL+ materials charge" },
  { k: "shipping", label: "Shipping / delivery" },
  { k: "surcharge", label: "Card surcharge" },
  { k: "rush", label: "Rush fee" },
  { k: "fee", label: "Other fees" },
  { k: "discount", label: "Discount (only when sales tax is its own line)" },
  { k: "tax", label: "Sales tax (only when sales tax is its own line)" },
  { k: "default", label: "Anything not mapped above" },
];
/** item keys tried in order for each kind of line; "default" is always tried last */
const ITEM_FALLBACK: Record<string, string[]> = {
  setup_screens: ["setup_screens", "screen"], setup_remake: ["setup_remake", "setup_screens", "screen"], digitize: ["digitize", "embroidery"],
  pms: ["pms", "setup_screens"], inkchange: ["inkchange", "setup_screens"], min: ["min", "fee"], materials: ["materials", "garments"],
  shipping: ["shipping", "fee"], surcharge: ["surcharge", "fee"], rush: ["rush", "fee"], garments: ["garments", "screen"],
};
export function itemFor(key: string, qs: Pick<QboSettings, "item_map">): string {
  for (const k of [...(ITEM_FALLBACK[key] || [key]), "default"]) if (qs.item_map[k]?.trim()) return qs.item_map[k].trim();
  return "";
}

/* ---------------- small helpers ---------------- */

const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const norm = (v: unknown) => s(v).toLowerCase().replace(/\s+/g, " ");
/** first real email address in a field ("Mike <mike@x.org>", "a@b.com, c@d.com", "x@y.church>") */
export function cleanEmail(v: unknown): string {
  const m = s(v).match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : "";
}
export const phoneDigits = (v: unknown) => { const d = s(v).replace(/\D/g, ""); return d.length > 10 && d.startsWith("1") ? d.slice(1, 11) : d.slice(0, 10); };
/** QuickBooks display names: unique, no colon (it means "sub-customer"), no tabs or new lines, 500 characters */
export const displayNameOf = (c: { company?: string | null; name?: string | null; email?: string | null }) =>
  (s(c.company) || s(c.name) || cleanEmail(c.email) || "Customer").replace(/:/g, " -").replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 500);
/** the shop's calendar day (Central) for a timestamp; a plain date passes through */
export function shopDay(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
/** short, stable fingerprint (FNV-1a) of any JSON value: object keys sorted */
export function hashOf(v: unknown): string {
  const str = stable(v);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}

/* ---------------- addresses ---------------- */

export type QboAddr = { Line1?: string; Line2?: string; Line3?: string; Line4?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string; Country?: string };
const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const stateCode = (v: string) => { const t = v.trim().replace(/\.$/, ""); if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase(); return STATES[t.toLowerCase()] || ""; };
/**
 * Our addresses are free text ("2435 East Hebron Pkwy\nCarrollton, Texas 75010", or one line with commas).
 * Split into QuickBooks' parts; anything that doesn't parse goes on the address lines as written.
 */
export function parseAddress(text: string | null | undefined): QboAddr | null {
  let lines = s(text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length === 1 && lines[0].includes(",")) {
    // "123 Main St, Suite 4, Dallas, TX 75201": the last two parts are the city and the state + zip
    const parts = lines[0].split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 3) lines = [...parts.slice(0, -2), `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`];
  }
  if (/^(usa?|united states( of america)?)$/i.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
  const last = lines[lines.length - 1] || "";
  const out: QboAddr = {};
  // "City, ST 75010" / "City, Texas 75010-1234" / "City ST 75010"
  const m = last.match(/^(.*?)[,\s]+([A-Za-z][A-Za-z .]*?)[,\s]+(\d{5}(?:-\d{4})?)$/);
  const st = m ? stateCode(m[2]) : "";
  if (m && st && lines.length >= 2) {
    out.City = m[1].replace(/,$/, "").trim(); out.CountrySubDivisionCode = st; out.PostalCode = m[3];
    lines = lines.slice(0, -1);
  } else {
    const z = last.match(/^([A-Za-z][A-Za-z .]*?)[,\s]+(\d{5}(?:-\d{4})?)$/); // "TX 75010" on its own line, the city above
    if (z && stateCode(z[1]) && lines.length >= 3) {
      out.CountrySubDivisionCode = stateCode(z[1]); out.PostalCode = z[2]; out.City = lines[lines.length - 2].replace(/,$/, "");
      lines = lines.slice(0, -2);
    }
  }
  const keys = ["Line1", "Line2", "Line3", "Line4"] as const;
  lines.slice(0, 4).forEach((l, i) => { out[keys[i]] = l.slice(0, 500); });
  if (lines.length > 4) out.Line4 = lines.slice(3).join(", ").slice(0, 500);
  return out;
}
const addrKey = (a: QboAddr | null | undefined) => (a ? [a.Line1, a.Line2, a.Line3, a.Line4, a.City, a.CountrySubDivisionCode, a.PostalCode].map(norm).join("|").replace(/\|+$/, "") : "");

/* ---------------- customers ---------------- */

export type OurCustomer = { id: string; company?: string | null; name?: string | null; email?: string | null; phone?: string | null; address?: string | null; ship_address?: string | null; tax_exempt?: boolean | null; payment_terms?: string | null; is_test?: boolean | null };
/** The customer fields this portal owns in QuickBooks. Everything else on the QuickBooks customer is left alone. */
export const OWNED_FIELDS = ["DisplayName", "CompanyName", "PrimaryEmailAddr", "PrimaryPhone", "BillAddr", "ShipAddr", "Taxable", "SalesTermRef"] as const;
export type OwnedField = (typeof OWNED_FIELDS)[number];
export const FIELD_LABEL: Record<OwnedField, string> = { DisplayName: "Name", CompanyName: "Company", PrimaryEmailAddr: "Email", PrimaryPhone: "Phone", BillAddr: "Billing address", ShipAddr: "Shipping address", Taxable: "Taxable", SalesTermRef: "Terms" };
/** comparable values of the owned fields (strings), from our customer */
export type Owned = Partial<Record<OwnedField, string>>;
export function ownedFromOurs(c: OurCustomer, qs: Pick<QboSettings, "term_map" | "default_term_id">): Owned {
  const o: Owned = {
    DisplayName: displayNameOf(c), CompanyName: s(c.company).slice(0, 100), PrimaryEmailAddr: cleanEmail(c.email), PrimaryPhone: s(c.phone).slice(0, 30),
    BillAddr: addrKey(parseAddress(c.address)), ShipAddr: addrKey(parseAddress(c.ship_address)), Taxable: c.tax_exempt ? "false" : "true",
    SalesTermRef: (c.payment_terms && qs.term_map[c.payment_terms]) || qs.default_term_id || "",
  };
  return o;
}
/** the same fields read off a QuickBooks customer */
type QCust = Record<string, unknown> & { Id?: string; SyncToken?: string; DisplayName?: string; CompanyName?: string; PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; BillAddr?: QboAddr; ShipAddr?: QboAddr; Taxable?: boolean; SalesTermRef?: { value?: string } };
export function ownedFromQbo(q: QCust | null | undefined): Owned {
  if (!q) return {};
  return {
    DisplayName: s(q.DisplayName), CompanyName: s(q.CompanyName), PrimaryEmailAddr: cleanEmail(q.PrimaryEmailAddr?.Address), PrimaryPhone: s(q.PrimaryPhone?.FreeFormNumber),
    BillAddr: addrKey(q.BillAddr), ShipAddr: addrKey(q.ShipAddr), Taxable: q.Taxable === false ? "false" : "true", SalesTermRef: s(q.SalesTermRef?.value),
  };
}
const same = (f: OwnedField, a?: string, b?: string) => (f === "PrimaryPhone" ? phoneDigits(a) === phoneDigits(b) : norm(a) === norm(b));

/** The QuickBooks body for the owned fields (only those listed). */
export function ownedBody(c: OurCustomer, qs: QboSettings, fields: readonly OwnedField[]): Record<string, unknown> {
  const o = ownedFromOurs(c, qs), b: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "DisplayName") b.DisplayName = o.DisplayName;
    else if (f === "CompanyName") b.CompanyName = o.CompanyName;
    else if (f === "PrimaryEmailAddr") b.PrimaryEmailAddr = { Address: o.PrimaryEmailAddr };
    else if (f === "PrimaryPhone") b.PrimaryPhone = { FreeFormNumber: o.PrimaryPhone };
    else if (f === "BillAddr") b.BillAddr = parseAddress(c.address) || {};
    else if (f === "ShipAddr") b.ShipAddr = parseAddress(c.ship_address) || {};
    else if (f === "Taxable") { b.Taxable = !c.tax_exempt; if (c.tax_exempt && qs.exemption_reason_id) b.TaxExemptionReasonId = qs.exemption_reason_id; }
    else if (f === "SalesTermRef" && o.SalesTermRef) b.SalesTermRef = { value: o.SalesTermRef };
  }
  return b;
}
/** A new QuickBooks customer from ours. */
export function customerCreateBody(c: OurCustomer, qs: QboSettings): Record<string, unknown> {
  const fields = OWNED_FIELDS.filter((f) => { const v = ownedFromOurs(c, qs)[f]; return f === "Taxable" || !!v; });
  const body = ownedBody(c, qs, fields);
  const [given, ...rest] = s(c.name).split(/\s+/);
  if (given) { body.GivenName = given.slice(0, 100); if (rest.length) body.FamilyName = rest.join(" ").slice(0, 100); }
  body.Notes = `Portal customer ${c.id}`;
  return body;
}
export type FieldConflict = { field: OwnedField; label: string; ours: string; qbo: string; sent: string };
/**
 * What to change on a linked QuickBooks customer. `lastSent` is what we last sent (null when the link was made by
 * matching and we've never sent anything). A field someone changed in QuickBooks since we last sent it isn't
 * overwritten: it comes back as a conflict for the owner (unless the owner said ours wins: `force`). Fields the owner
 * gave to QuickBooks (`keepQbo`) and fields we have blank are never sent (we never blank out QuickBooks).
 */
export function customerDiff(c: OurCustomer, current: QCust, lastSent: Owned | null, qs: QboSettings, keepQbo: string[] = [], force: string[] = []) {
  const ours = ownedFromOurs(c, qs), now = ownedFromQbo(current);
  const change: OwnedField[] = [], conflicts: FieldConflict[] = [], rename = !same("DisplayName", ours.DisplayName, now.DisplayName);
  for (const f of OWNED_FIELDS) {
    if (keepQbo.includes(f)) continue;
    const o = ours[f] || "";
    if (!o && f !== "Taxable") continue;
    if (same(f, o, now[f])) continue;
    const sent = lastSent?.[f];
    const changedThere = lastSent != null && sent !== undefined && !same(f, sent, now[f]);
    if (changedThere && !force.includes(f)) { conflicts.push({ field: f, label: FIELD_LABEL[f], ours: o, qbo: now[f] || "", sent: sent || "" }); continue; }
    change.push(f);
  }
  return { change, conflicts, rename, ours, now, body: change.length ? ownedBody(c, qs, change) : null };
}

/* ---------------- invoices ---------------- */

export type OrderRow = Order & { number: number; printavo_visual_id?: string | null; approved_at?: string | null; created_at: string; completed_at?: string | null };
export type InvoiceLine = Record<string, unknown> & { DetailType: string; Amount: number; Description?: string };
export type InvoiceBuild = {
  body: Record<string, unknown>; total: number; storedTotal: number; lineSum: number; tax: number; discount: number;
  problems: string[]; warnings: string[]; summary: { label: string; qty: number; unit: number; amount: number; item: string }[];
};
const METHOD_ITEM: Record<string, string> = { screen: "screen", embroidery: "embroidery", dtf: "dtf" };
const FEE_ITEM = (label: string) => (/ship|freight|postage|deliver|courier/i.test(label) ? "shipping" : /surcharge|card fee|processing/i.test(label) ? "surcharge" : /rush/i.test(label) ? "rush" : "fee");
const SETUP_LABEL = { screens: "Screen setup (new screens)", remake: "Screen setup (repeat screens)", digitize: "Digitizing", pms: "PMS color match", inkchange: "Ink change", min: "Minimum order charge" } as const;
const SETUP_ITEM = { screens: "setup_screens", remake: "setup_remake", digitize: "digitize", pms: "pms", inkchange: "inkchange", min: "min" } as const;

/** Is this order an invoice (past the quote stage)? Quotes are never sent to QuickBooks. */
export const isInvoiceStatus = (status: string) => ["approved", "art", "blanks", "production", "ready", "completed"].includes(status);

/**
 * The QuickBooks invoice for one of our orders. `customerRef` is the QuickBooks customer it's billed to (the primary
 * link), or null in a preview before the customer exists there. Problems stop it from being sent; warnings are shown.
 */
export function invoicePayload(inp: { order: OrderRow; customer: OurCustomer | null; customerRef: { value: string; name?: string } | null; settings: Settings; qs: QboSettings }): InvoiceBuild {
  const { order: o, customer: cu, settings, qs } = inp;
  const calc = calcOrder(o, settings);
  const groups = orderGroups(o);
  const problems: string[] = [], warnings: string[] = [];
  const taxMode = qs.tax_mode;
  const taxable = !o.tax_exempt && calc.tax > 0;
  const taxCode = taxMode === "qbo_ast" ? { TaxCodeRef: { value: taxable ? "TAX" : "NON" } } : taxMode === "tax_line" ? { TaxCodeRef: { value: "NON" } } : {};
  const lines: InvoiceLine[] = [];
  const summary: InvoiceBuild["summary"] = [];
  const missing = new Set<string>();
  const item = (key: string) => { const id = itemFor(key, qs); if (!id) missing.add(key); return id; };
  const add = (label: string, desc: string, key: string, qty: number, unit: number, amount: number) => {
    const id = item(key);
    // QuickBooks wants Amount = Qty x UnitPrice to the cent; when a split doesn't divide evenly it's one at the total
    if (r2(qty * unit) !== r2(amount)) { qty = 1; unit = r2(amount); }
    lines.push({ DetailType: "SalesItemLineDetail", Amount: r2(amount), Description: desc.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: id || "?" }, Qty: qty, UnitPrice: unit, ...taxCode } });
    summary.push({ label, qty, unit, amount: r2(amount), item: id || `(no item for "${key}")` });
  };

  // the garments: one line per style + color with its size run, as on the printed invoice
  groups.forEach((g, gi) => {
    const gc = calc.groups[gi];
    const method = g.imprints?.[0]?.method;
    const key = method ? METHOD_ITEM[method] || "screen" : "garments";
    const shown = g.lines.map((l, li) => ({ l, lc: gc?.lines[li] })).filter((x) => (x.lc?.qty || 0) > 0);
    shown.forEach(({ l, lc }, i) => {
      const title = [[l.brand, l.style, l.garment].filter(Boolean).join(" ") || "Garment", l.color].filter(Boolean).join(" · ") + (gc?.wholesale ? " (customer supplied)" : "");
      const sizes = SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => `${sizeLabel(z)} ${l.sizes[z]}`).join(", ");
      const extra: string[] = [];
      if (i === shown.length - 1) {
        if (g.imprints?.length) extra.push("Imprints: " + g.imprints.map(imprintLabel).join("; "));
        if (gc?.finishing?.length) extra.push("Finishing: " + gc.finishing.map((f) => f.name).join(", "));
      }
      const desc = [(g.name?.trim() ? `${g.name.trim()}: ` : "") + title, sizes, ...extra].filter(Boolean).join("\n");
      add(title, desc, key, lc!.qty, lc!.each, lc!.sub);
    });
  });

  // setup, itemized like Printavo listed it (new / repeat screens, digitizing, PMS match, ink changes, minimum)
  const setup = new Map<string, { kind: keyof typeof SETUP_LABEL; qty: number; unit: number; amount: number }>();
  for (const gc of calc.groups) for (const it of gc.setupItems) {
    const k = `${it.kind}|${it.unit}`, cur = setup.get(k);
    if (cur) { cur.qty += it.qty; cur.amount = r2(cur.amount + it.amount); } else setup.set(k, { kind: it.kind, qty: it.qty, unit: it.unit, amount: it.amount });
  }
  let setupSum = 0;
  for (const x of setup.values()) { if (!x.amount) continue; add(SETUP_LABEL[x.kind], SETUP_LABEL[x.kind], SETUP_ITEM[x.kind], x.qty, x.unit, x.amount); setupSum = r2(setupSum + x.amount); }
  // anything in the setup total the itemized list doesn't account for (shouldn't happen): one line, so totals agree
  if (r2(calc.setup - setupSum) !== 0) { add("Setup", "Setup", "setup_screens", 1, r2(calc.setup - setupSum), r2(calc.setup - setupSum)); warnings.push(`Setup lines didn't add up to the setup total; a ${r2(calc.setup - setupSum)} setup line was added.`); }
  if (calc.materials > 0) add("2XL+ materials charge", "2XL+ Materials Charge", "materials", 1, calc.materials, calc.materials);
  for (const f of o.fees || []) { const a = +f.amount || 0; if (a) add(f.label || "Fee", f.label || "Fee", FEE_ITEM(f.label || ""), 1, r2(a), r2(a)); }

  const lineSum = r2(lines.reduce((a, l) => a + l.Amount, 0));
  const pre = r2(calc.items + calc.setup + calc.materials + calc.fees);
  if (lineSum !== pre) problems.push(`The lines add up to ${lineSum} but the order's subtotal is ${pre}.`);

  // discount: QuickBooks' discount line (before tax), or, when tax is its own line, a negative line (so the tax line isn't discounted)
  if (calc.discount > 0) {
    const label = `Discount${o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}`;
    if (taxMode === "tax_line") add(label, label, "discount", 1, -calc.discount, -calc.discount);
    else {
      lines.push({ DetailType: "DiscountLineDetail", Amount: calc.discount, Description: label, DiscountLineDetail: { PercentBased: false, ...(qs.discount_account_id ? { DiscountAccountRef: { value: qs.discount_account_id } } : {}) } });
      summary.push({ label, qty: 1, unit: -calc.discount, amount: -calc.discount, item: "(discount)" });
    }
  }
  // sales tax
  let txnTax: Record<string, unknown> | undefined;
  if (calc.tax > 0) {
    if (taxMode === "tax_line") add(`Sales tax (${calc.rate}%)`, `Sales tax (${calc.rate}%)`, "tax", 1, calc.tax, calc.tax);
    else if (taxMode === "qbo_ast") {
      // our tax amount (rate x taxable total), not QuickBooks' own calculation, so the invoice matches what the customer saw
      txnTax = { TotalTax: calc.tax, ...(qs.tax_code_id ? { TxnTaxCodeRef: { value: qs.tax_code_id } } : {}) };
      summary.push({ label: `Sales tax (${calc.rate}%)`, qty: 1, unit: calc.tax, amount: calc.tax, item: "(QuickBooks sales tax)" });
    } else problems.push(`This order has ${calc.tax} sales tax, but QuickBooks sales tax is set to "none".`);
  }
  if (missing.size) problems.push(`Pick a QuickBooks item for: ${[...missing].map((k) => ITEM_KEYS.find((x) => x.k === k)?.label || k).join(", ")} (Settings → QuickBooks → Items).`);
  if (!inp.customerRef) problems.push("The customer isn't in QuickBooks yet.");
  if (!lines.length) problems.push("No priced lines.");
  const stored = r2(+o.total || 0);
  if (stored !== calc.total) warnings.push(`The saved order total (${stored}) differs from the recalculated total (${calc.total}); QuickBooks gets the recalculated one (what the printed invoice shows).`);

  const terms = (cu?.payment_terms || "") as PayTerms | "";
  const termId = (terms && qs.term_map[terms]) || qs.default_term_id;
  const due = payDueDate(o, terms || null);
  const po = s(o.po_number);
  const ship = o.delivery_method === "ship" || o.delivery_method === "deliver" ? parseAddress(o.ship_to) : null;
  const email = cleanEmail(cu?.email);
  const note = [`Portal order #${o.number}`, po && !qs.po_field_id ? `PO ${po}` : "", o.nickname ? `Job: ${o.nickname}` : ""].filter(Boolean).join(" · ");
  const body: Record<string, unknown> = {
    DocNumber: String(o.number),
    TxnDate: shopDay(o.approved_at || o.created_at),
    ...(due ? { DueDate: due } : {}),
    CustomerRef: inp.customerRef ? { value: inp.customerRef.value } : { value: "(new customer)" },
    Line: lines,
    ...(txnTax ? { TxnTaxDetail: txnTax } : {}),
    ApplyTaxAfterDiscount: true,
    ...(termId ? { SalesTermRef: { value: termId } } : {}),
    ...(email ? { BillEmail: { Address: email } } : {}),
    ...(parseAddress(cu?.address) ? { BillAddr: parseAddress(cu?.address) } : {}),
    ...(ship ? { ShipAddr: ship } : {}),
    ...(po && qs.po_field_id ? { CustomField: [{ DefinitionId: qs.po_field_id, Name: qs.po_field_name || "P.O. Number", Type: "StringType", StringValue: po.slice(0, 31) }] } : {}),
    ...(o.nickname ? { CustomerMemo: { value: String(o.nickname).slice(0, 1000) } } : {}),
    PrivateNote: note.slice(0, 4000),
    ...(qs.class_id ? { ClassRef: { value: qs.class_id } } : {}),
    ...(qs.department_id ? { DepartmentRef: { value: qs.department_id } } : {}),
  };
  return { body, total: calc.total, storedTotal: stored, lineSum, tax: calc.tax, discount: calc.discount, problems, warnings, summary };
}

/** The parts of a QuickBooks invoice we own, as a fingerprint: changes made there (not payments) show up as a new value. */
export function invoiceFingerprint(inv: Record<string, unknown> | null | undefined): string {
  if (!inv) return "";
  const lines = ((inv.Line || []) as Record<string, unknown>[]).filter((l) => l.DetailType === "SalesItemLineDetail" || l.DetailType === "DiscountLineDetail").map((l) => {
    const d = (l.SalesItemLineDetail || {}) as Record<string, unknown>;
    return [r2(+(l.Amount as number) || 0), s(l.Description), s((d.ItemRef as { value?: string } | undefined)?.value), +(d.Qty as number) || 0, r2(+(d.UnitPrice as number) || 0)];
  });
  return hashOf([s((inv.CustomerRef as { value?: string } | undefined)?.value), s(inv.DocNumber), s(inv.TxnDate), r2(+(inv.TotalAmt as number) || 0), lines]);
}

/* ---------------- payments ---------------- */

export type OurPayment = { id: string; order_id: string; amount: number | string; method?: string | null; paid_on?: string | null; created_at?: string | null; fee?: number | string | null; processor_id?: string | null; note?: string | null };
/** came over from Printavo (Printavo already sent it to QuickBooks): matched to QuickBooks' copy, never made again */
export const fromPrintavo = (p: Pick<OurPayment, "processor_id">) => /^printavo:/i.test(s(p.processor_id));
export function paymentPayload(inp: { payment: OurPayment; orderNumber: number; invoiceId: string; customerRef: string; qs: QboSettings }) {
  const { payment: p, qs } = inp;
  const amount = r2(+p.amount || 0), problems: string[] = [];
  if (amount <= 0) problems.push(amount < 0 ? "This is a refund (a negative payment). Refunds aren't sent automatically yet: record it in QuickBooks (refund receipt or credit memo) as your accountant prefers, then mark this Skipped." : "A zero payment isn't sent.");
  const method = s(p.method), methodId = (method && qs.payment_method_map[method]) || qs.payment_method_map.default || "";
  const fee = r2(+(p.fee || 0));
  const ref = s(p.processor_id).replace(/^[a-z]+:/i, "").slice(0, 21);
  const note = [`Portal payment on order #${inp.orderNumber}`, method ? `(${method})` : "", fee ? `· card processing fee ${fee.toFixed(2)} (our cost, not on this payment)` : "", s(p.note) ? `· ${s(p.note)}` : "", `· ${p.id}`].filter(Boolean).join(" ");
  const body: Record<string, unknown> = {
    CustomerRef: { value: inp.customerRef },
    TotalAmt: amount,
    TxnDate: shopDay(p.paid_on || p.created_at || ""),
    ...(methodId ? { PaymentMethodRef: { value: methodId } } : {}),
    ...(qs.deposit_account_id ? { DepositToAccountRef: { value: qs.deposit_account_id } } : {}),
    ...(ref ? { PaymentRefNum: ref } : {}),
    PrivateNote: note.slice(0, 4000),
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: inp.invoiceId, TxnType: "Invoice" }] }],
  };
  return { body, amount, problems };
}
/** QuickBooks payments on an invoice that could be this payment of ours: same amount, dated within 3 days. */
export function matchPayment<C extends { Id: string; TotalAmt?: number; TxnDate?: string }>(p: OurPayment, candidates: C[], taken: Set<string>): C | null {
  const amt = r2(+p.amount || 0), day = shopDay(p.paid_on || p.created_at || "");
  const t = day ? new Date(day + "T12:00:00Z").getTime() : 0;
  const ok = candidates.filter((c) => !taken.has(c.Id) && r2(+(c.TotalAmt || 0)) === amt)
    .map((c) => ({ c, d: t && c.TxnDate ? Math.abs(new Date(c.TxnDate + "T12:00:00Z").getTime() - t) / 86400000 : 99 }))
    .filter((x) => x.d <= 3).sort((a, b) => a.d - b.d);
  return ok[0]?.c || null;
}
