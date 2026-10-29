import "server-only";
import { fabricLines } from "@/lib/fabric";

/**
 * SanMar web services (SOAP, https://ws.sanmar.com:8080). Product data only for now (styles, colors, sizes, our
 * prices, photos); purchase orders come later once SanMar signs off the product integration.
 * Credentials live in Vercel env vars: SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME, SANMAR_PASSWORD
 * (a SanMar.com user made for web services). SANMAR_ENV=uat points at SanMar's test system.
 */
const host = () => (process.env.SANMAR_ENV?.trim().toLowerCase() === "uat" ? "https://uat-ws.sanmar.com:8080" : "https://ws.sanmar.com:8080");
const cred = () => ({ num: process.env.SANMAR_CUSTOMER_NUMBER?.trim() || "", user: process.env.SANMAR_USERNAME?.trim() || "", pass: process.env.SANMAR_PASSWORD?.trim() || "" });
export const sanmarConfigured = () => { const c = cred(); return !!(c.num && c.user && c.pass); };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** First value of a tag anywhere in an XML chunk (any namespace prefix). */
export function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? unesc(m[1].trim()) : "";
}
/** Every block of a repeated tag. */
export function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "g");
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

async function soap(path: string, op: string, inner: string, timeoutMs = 25000, ns = "http://impl.webservice.integration.sanmar.com/", base = host()): Promise<string> {
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="${ns}"><soapenv:Header/><soapenv:Body><impl:${op}>${inner}</impl:${op}></soapenv:Body></soapenv:Envelope>`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' }, body, cache: "no-store", signal: ctl.signal });
    const x = await r.text();
    const fault = tag(x, "faultstring");
    if (fault) throw new Error("SanMar: " + fault);
    if (!r.ok) throw new Error(`SanMar returned ${r.status}`);
    if (tag(x, "errorOccured") === "true" || tag(x, "errorOccurred") === "true") throw new Error("SanMar: " + (tag(x, "message") || "error"));
    return x;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("SanMar didn't answer in time.");
    throw e;
  } finally { clearTimeout(t); }
}
const auth = () => { const c = cred(); return `<arg1><sanMarCustomerNumber>${esc(c.num)}</sanMarCustomerNumber><sanMarUserName>${esc(c.user)}</sanMarUserName><sanMarUserPassword>${esc(c.pass)}</sanMarUserPassword><senderId></senderId><senderPassword></senderPassword></arg1>`; };

// SanMar size names -> our size codes
const SIZE_MAP: Record<string, string> = { XS: "XS", S: "S", M: "M", L: "L", XL: "XL", "2XL": "2XL", XXL: "2XL", "3XL": "3XL", XXXL: "3XL", "4XL": "4XL", "5XL": "5XL", "6XL": "5XL",
  YXS: "YXS", YS: "YS", YM: "YM", YL: "YL", YXL: "YXL", OSFA: "OS", OS: "OS", "ONE SIZE": "OS", ADJ: "OS",
  NB: "NB", "0-3M": "NB", "3-6M": "6M", "6M": "6M", "06M": "6M", "6-12M": "12M", "12M": "12M", "12-18M": "18M", "18M": "18M", "18-24M": "24M", "24M": "24M",
  "2T": "2T", "3T": "3T", "4T": "4T", "5T": "5T", "5/6": "5T", "5/6T": "5T", "S/M": "M", "M/L": "L", "L/XL": "XL" };
// youth styles label sizes XS-XL; ours are YXS-YXL (same rule as S&S)
const YOUTH: Record<string, string> = { XS: "YXS", S: "YS", M: "YM", L: "YL", XL: "YXL" };
const isYouth = (basic: string) => /youth|toddler|kids|infant/i.test(`${tag(basic, "productTitle")} ${tag(basic, "category")}`);
const sizeFor = (raw: string, youth: boolean) => { const z = SIZE_MAP[raw.toUpperCase()] || raw.toUpperCase(); return youth && YOUTH[z] ? YOUTH[z] : z; };
const ORDER = ["NB", "6M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
const num = (s: string) => { const n = parseFloat(s); return isFinite(n) ? n : 0; };

export type SanMarSku = { color: string; catalogColor: string; size: string; rawSize: string; piecePrice: number; casePrice: number; myPrice: number; image: string; front: string; back: string; /** the flat back and the back on a model, apart (Oct 26) */ backFlat: string; backModel: string; swatch: string; brand: string; title: string; description: string; status: string; /** SanMar's ids for ordering (PO service) */ inventoryKey?: string; sizeIndex?: string; };

/** Every SKU block SanMar has for a style (product info only, no pricing call). */
async function sanmarInfoRows(style: string): Promise<string[]> {
  const info = await soap("/SanMarWebService/SanMarProductInfoServicePort", "getProductInfoByStyleColorSize", `<arg0><style>${esc(style.trim())}</style><color></color><size></size></arg0>${auth()}`, 40000);
  return blocks(info, "listResponse");
}

const pkey = (color: string, size: string) => `${(color || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}|${(size || "").toLowerCase().trim()}`;
/** Every color/size of a style: names, photos and SanMar's prices (list + ours). */
export async function sanmarSkus(style: string): Promise<SanMarSku[]> {
  const st = style.trim();
  const rows = await sanmarInfoRows(st);
  if (!rows.length) return [];
  // our prices (customer-specific "myPrice"); pricing failing shouldn't stop the lookup
  const mine = new Map<string, number>();
  try {
    const pr = await soap("/SanMarWebService/SanMarPricingServicePort", "getPricing", `<arg0><style>${esc(st)}</style><color></color><size></size></arg0>${auth()}`);
    for (const b of blocks(pr, "listResponse")) { const p = num(tag(b, "myPrice")) || num(tag(b, "casePrice")) || num(tag(b, "piecePrice")); if (p) mine.set(pkey(tag(b, "color"), tag(b, "size")), p); }
  } catch { /* list prices still come back with the product info */ }
  return rows.map((b) => {
    const basic = blocks(b, "productBasicInfo")[0] || b, img = blocks(b, "productImageInfo")[0] || b, price = blocks(b, "productPriceInfo")[0] || b;
    const color = tag(basic, "color"), raw = tag(basic, "size");
    return {
      color, catalogColor: tag(basic, "catalogColor") || color, rawSize: raw, size: sizeFor(raw, isYouth(basic)),
      // our price is listed under SanMar's catalog color ("White/True Royal"), not always the display name ("White/ Royal"):
      // without it a color fell back to the list price (Oct 20: PC55RS White/ Royal at $5.47 / $9.89 instead of ours)
      piecePrice: num(tag(price, "piecePrice")), casePrice: num(tag(price, "casePrice")), myPrice: mine.get(pkey(color, raw)) || mine.get(pkey(tag(basic, "catalogColor"), raw)) || 0,
      image: tag(img, "productImage"), // flat product shots first (like S&S), photos on a model only when there's no flat
      front: tag(img, "frontFlat") || tag(img, "colorProductImage") || tag(img, "frontModel"), back: tag(img, "backFlat") || tag(img, "backModel"), backFlat: tag(img, "backFlat"), backModel: tag(img, "backModel"), swatch: tag(img, "colorSwatchImage"),
      inventoryKey: tag(b, "inventoryKey"), sizeIndex: tag(b, "sizeIndex"), brand: tag(basic, "brandName"), title: tag(basic, "productTitle"), description: tag(basic, "productDescription"), status: tag(basic, "productStatus"),
    };
  });
}

export type SanMarGarment = { style: string; brand: string; description: string; fabric: string; fabric_at: string; colors: string[]; cost: number; sizes: string[]; size_costs: Record<string, number>; color_size_costs: Record<string, Record<string, number>>; image: string; color_images: Record<string, { front: string; back: string; side: string; hex: string }>; supplier: "sanmar"; supplier_style: string };

/** Look up a SanMar style ("PC61", "K500", "NKDC1963") and shape it like a catalog garment. Cost = our price. */
export async function sanmarLookup(style: string): Promise<SanMarGarment | null> {
  const t = style.trim().toUpperCase();
  if (!t) return null;
  const skus = await sanmarSkus(t);
  if (!skus.length) return null;
  // the color names people use ("True Royal"), not SanMar's catalog codes ("TrueRoyal")
  const nameOf = (s: SanMarSku) => (s.color || s.catalogColor || "").trim();
  const colors = [...new Set(skus.map(nameOf).filter(Boolean))];
  const sizes = [...new Set(skus.map((s) => s.size).filter(Boolean))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const cost = (s: SanMarSku) => s.myPrice || s.casePrice || s.piecePrice;
  const size_costs: Record<string, number> = {};
  for (const z of sizes) { const cs = skus.filter((s) => s.size === z).map(cost).filter((x) => x > 0); if (cs.length) size_costs[z] = Math.min(...cs); }
  // each color's own price by size (Oct 20: colors differ, e.g. PC55RS White/Royal 4XL $7.98 vs the cheapest color's $5.61)
  const color_size_costs: Record<string, Record<string, number>> = {};
  for (const sk of skus) { const c = nameOf(sk), v = cost(sk); if (!c || !sk.size || !(v > 0)) continue; const m = (color_size_costs[c] ||= {}); m[sk.size] = m[sk.size] ? Math.min(m[sk.size], v) : v; }
  const base = Math.min(...Object.values(size_costs).filter((x) => x > 0), Infinity);
  const color_images: SanMarGarment["color_images"] = {};
  for (const c of colors) { const s = skus.find((x) => nameOf(x) === c && (x.front || x.image)); if (s) color_images[c] = { front: s.front || s.image, back: s.back, side: "", hex: "" }; }
  const first = skus[0];
  return {
    style: t, brand: first.brand || "SanMar", description: first.title || first.description.replace(/<[^>]+>/g, " ").slice(0, 200),
    fabric: fabricLines([...new Set(skus.map((x) => x.description).filter(Boolean))].join("\n")), fabric_at: new Date().toISOString(),
    colors, cost: isFinite(base) ? base : 0, sizes, size_costs, color_size_costs, image: first.front || first.image, color_images, supplier: "sanmar", supplier_style: t,
  };
}

/** A small, cheap call to prove the credentials work (one SKU's price). */
export async function sanmarPing(): Promise<string> {
  const x = await soap("/SanMarWebService/SanMarPricingServicePort", "getPricing", `<arg0><style>PC61</style><color>White</color><size>M</size></arg0>${auth()}`, 10000);
  const p = blocks(x, "listResponse")[0] || "";
  return p ? `answered (PC61 White M: $${num(tag(p, "myPrice")) || num(tag(p, "piecePrice"))})` : "answered";
}

/* ---------- the whole catalog (for search) ---------- */

export type SanMarStyleSummary = { style: string; brand: string; title: string; category: string; image: string; colors: string[]; sizes: string[]; status: string };
const orderSizes = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

/** One style's name, brand, category, photo, colors and sizes (null = SanMar has nothing for it). */
export async function sanmarStyleSummary(style: string): Promise<SanMarStyleSummary | null> {
  const rows = await sanmarInfoRows(style);
  if (!rows.length) return null;
  const basic = (b: string) => blocks(b, "productBasicInfo")[0] || b;
  const img = (b: string) => blocks(b, "productImageInfo")[0] || b;
  const b0 = basic(rows[0]), i0 = img(rows[0]);
  return {
    style: style.trim().toUpperCase(),
    brand: tag(b0, "brandName"), title: tag(b0, "productTitle") || tag(b0, "productDescription").replace(/<[^>]+>/g, " ").slice(0, 160),
    category: tag(b0, "category"), status: tag(b0, "productStatus"),
    image: tag(i0, "frontFlat") || tag(i0, "colorProductImage") || tag(i0, "thumbnailImage") || tag(i0, "productImage") || tag(i0, "frontModel"),
    colors: [...new Set(rows.map((r) => { const b = basic(r); return tag(b, "catalogColor") || tag(b, "color"); }).filter(Boolean))],
    sizes: orderSizes(rows.map((r) => sizeFor(tag(basic(r), "size"), isYouth(b0)))),
  };
}

/** PromoStandards Product Data (SanMar's standard-format service; same SanMar.com web services login). */
async function psProduct(version: "2.0.0" | "1.0.0", op: string, inner: string, timeoutMs = 50000): Promise<string> {
  const c = cred();
  const path = version === "2.0.0" ? "/promostandards/ProductDataServiceBindingV2" : "/promostandards/ProductDataServiceBinding";
  const ns = `http://www.promostandards.org/WSDL/ProductDataService/${version}/`;
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${ns}" xmlns:shar="${ns}SharedObjects/"><soapenv:Header/><soapenv:Body><ns:${op}Request><shar:wsVersion>${version}</shar:wsVersion><shar:id>${esc(c.user)}</shar:id><shar:password>${esc(c.pass)}</shar:password>${inner}</ns:${op}Request></soapenv:Body></soapenv:Envelope>`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(host() + path, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: op.charAt(0).toLowerCase() + op.slice(1) }, body, cache: "no-store", signal: ctl.signal });
    const x = await r.text();
    const fault = tag(x, "faultstring");
    if (fault) throw new Error("SanMar: " + fault);
    if (!r.ok) throw new Error(`SanMar returned ${r.status}`);
    return x;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("SanMar didn't answer in time.");
    throw e;
  } finally { clearTimeout(t); }
}

/**
 * A style's companion styles on SanMar (Oct 21, Nick: "sanmar has all the info. they call it companion styles": 1717 →
 * 4410, 6014, 1745, 6030, 9360, 3023CL, 1745Y, 9018). From PromoStandards GetProduct (RelatedProduct), and any
 * companion fields in SanMar's own product info. Style numbers, upper case; [] when SanMar has none or doesn't answer.
 */
export async function sanmarCompanions(style: string): Promise<string[]> {
  const st = style.trim().toUpperCase(), out = new Set<string>();
  for (const v of ["2.0.0", "1.0.0"] as const) {
    try {
      const x = await psProduct(v, "GetProduct", `<shar:localizationCountry>US</shar:localizationCountry><shar:localizationLanguage>en</shar:localizationLanguage><shar:productId>${esc(st)}</shar:productId>`, 25000);
      for (const b of blocks(x, "RelatedProduct")) { const id = tag(b, "productId").trim().toUpperCase(); if (id && id !== st) out.add(id); }
      if (out.size) break;
    } catch { /* the other version, then SanMar's own service */ }
  }
  if (!out.size) {
    try {
      const rows = await sanmarInfoRows(st);
      const x = rows.slice(0, 3).join("");
      for (const m of x.matchAll(/<(?:[\w-]+:)?(\w*[Cc]ompanion\w*)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g))
        for (const id of unesc(m[2]).split(/[\s,;|]+/)) { const t = id.trim().toUpperCase(); if (/^[A-Z0-9-]{2,15}$/.test(t) && t !== st) out.add(t); }
    } catch { /* none */ }
  }
  return [...out];
}

/** Every style SanMar sells right now (style numbers only). */
export async function sanmarSellableStyles(): Promise<{ styles: string[]; version: string; parts: number }> {
  let last: unknown = null;
  for (const v of ["2.0.0", "1.0.0"] as const) {
    try {
      const x = await psProduct(v, "GetProductSellable", `<shar:isSellable>true</shar:isSellable>`);
      const items = blocks(x, "ProductSellable");
      if (!items.length) {
        const msg = tag(x, "description") || tag(x, "ServiceMessage") || tag(x, "ErrorMessage");
        last = new Error(msg ? `SanMar (${v}): ${msg}` : `SanMar (${v}) sent an empty list`);
        continue;
      }
      const styles = [...new Set(items.map((b) => tag(b, "productId").trim().toUpperCase()).filter(Boolean))];
      return { styles, version: v, parts: items.length };
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("SanMar's style list isn't available");
}

/** Raw first bytes of a PromoStandards answer (for checking the connection). */
export async function sanmarProbe(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const v of ["2.0.0", "1.0.0"] as const) {
    try { const x = await psProduct(v, "GetProductSellable", `<shar:productId>PC61</shar:productId><shar:isSellable>true</shar:isSellable>`, 20000); out[v] = x.slice(0, 1500); }
    catch (e) { out[v] = "ERR " + (e instanceof Error ? e.message : String(e)); }
  }
  return out;
}

/* ---------- stock by warehouse ---------- */

/**
 * SanMar's stock for every color and size of a style, by warehouse (Oct 27: Order goods compares it with S&S). Keyed by
 * the catalog (mainframe) color and SanMar's own size name; quantities are capped at 3,000 a warehouse by SanMar.
 */
export async function sanmarInventory(style: string): Promise<Map<string, { whse: string; name: string; qty: number }[]>> {
  // SanMar's own inventory call first; when it turns the style down ("Invalid product specified", Oct 27 on 1717) or
  // sends nothing, the PromoStandards Inventory 2.0 call (same login) instead
  let first: unknown = null;
  try { const m = await sanmarInventoryStd(style); if (m.size) return m; } catch (e) { first = e; }
  try { const m = await sanmarInventoryPS(style); if (m.size || !first) return m; } catch (e) { if (!first) throw e; }
  throw first instanceof Error ? first : new Error("SanMar's stock isn't available");
}
async function sanmarInventoryPS(style: string): Promise<Map<string, { whse: string; name: string; qty: number }[]>> {
  const c = cred(), ns = "http://www.promostandards.org/WSDL/Inventory/2.0.0/";
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${ns}" xmlns:shar="${ns}SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetInventoryLevelsRequest><shar:wsVersion>2.0.0</shar:wsVersion><shar:id>${esc(c.user)}</shar:id><shar:password>${esc(c.pass)}</shar:password><shar:productId>${esc(style.trim())}</shar:productId></ns:GetInventoryLevelsRequest></soapenv:Body></soapenv:Envelope>`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch(host() + "/promostandards/InventoryServiceBindingV2final", { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "getInventoryLevels" }, body, cache: "no-store", signal: ctl.signal });
    const x = await r.text();
    const fault = tag(x, "faultstring");
    if (fault) throw new Error("SanMar: " + fault);
    if (!r.ok) throw new Error(`SanMar returned ${r.status}`);
    const out = new Map<string, { whse: string; name: string; qty: number }[]>();
    for (const p of blocks(x, "PartInventory")) {
      const color = tag(p, "partColor"), size = tag(p, "labelSize");
      const whs = blocks(p, "InventoryLocation").map((w) => ({ whse: tag(w, "inventoryLocationId"), name: tag(w, "inventoryLocationName"), qty: Math.max(0, Math.round(num(tag(tag(w, "inventoryLocationQuantity") || w, "value")))) })).filter((w) => w.whse);
      if (color) out.set(pkey(color, size), whs);
    }
    if (!out.size) { const msg = tag(x, "description") || tag(x, "ServiceMessage"); if (msg) throw new Error("SanMar: " + msg); }
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("SanMar didn't answer in time.");
    throw e;
  } finally { clearTimeout(t); }
}
async function sanmarInventoryStd(style: string): Promise<Map<string, { whse: string; name: string; qty: number }[]>> {
  const c = cred();
  const x = await soap("/SanMarWebService/SanMarWebServicePort", "getInventoryQtyForStyleColorSize",
    `<arg0>${esc(c.num)}</arg0><arg1>${esc(c.user)}</arg1><arg2>${esc(c.pass)}</arg2><arg3>${esc(style.trim())}</arg3><arg4></arg4><arg5></arg5>`, 30000, "http://webservice.integration.sanmar.com/");
  const out = new Map<string, { whse: string; name: string; qty: number }[]>();
  for (const k of blocks(x, "sku")) {
    const color = tag(k, "color"), size = tag(k, "size");
    if (!color) continue;
    out.set(pkey(color, size), blocks(k, "whse").map((w) => ({ whse: tag(w, "whseID"), name: tag(w, "whseName"), qty: Math.max(0, Math.round(num(tag(w, "qty")))) })).filter((w) => w.whse));
  }
  return out;
}
export const sanmarStockKey = (color: string, size: string) => pkey(color, size);

/* ---------- purchase orders (SanMarPOServicePort) ---------- */

/**
 * Ordering is switched on by SanMar's integration team (sanmarintegrations@sanmar.com), then here by Nick in Vercel:
 * SANMAR_PO=edev (their test system) or SANMAR_PO=on (real orders). SANMAR_PO_WHSE=on once SanMar turns on Warehouse
 * Selection (then each line names its warehouse; without it SanMar ships from its closest warehouse that has it all).
 * Paid with the card saved on our sanmar.com account.
 */
export const sanmarPOMode = () => { const v = process.env.SANMAR_PO?.trim().toLowerCase() || ""; return v === "on" || v === "edev" ? v : ""; };
export const sanmarPOWhse = () => process.env.SANMAR_PO_WHSE?.trim().toLowerCase() === "on";
const poHost = () => (sanmarPOMode() === "edev" ? "https://edev-ws.sanmar.com:8080" : "https://ws.sanmar.com:8080");
/** SanMar's test system (EDEV) has its own web services login (Oct 28: sent by their integration team), put in Vercel by
 *  Nick as SANMAR_EDEV_USERNAME / SANMAR_EDEV_PASSWORD; without them the live login is used */
const poAuth = () => {
  const c = cred(), edev = sanmarPOMode() === "edev";
  const user = (edev && process.env.SANMAR_EDEV_USERNAME?.trim()) || c.user, pass = (edev && process.env.SANMAR_EDEV_PASSWORD?.trim()) || c.pass;
  return `<arg1><sanMarCustomerNumber>${esc(c.num)}</sanMarCustomerNumber><sanMarUserName>${esc(user)}</sanMarUserName><sanMarUserPassword>${esc(pass)}</sanMarUserPassword><senderId></senderId><senderPassword></senderPassword></arg1>`;
};
/** SanMar's stock a warehouse must keep after our order (Oct 28, SanMar: an order for a warehouse's last pieces is held
 *  for a person to look at; "most customers use 20-50 units as a buffer"): only stock past this is offered */
export const SANMAR_BUFFER = 25;
export type SanMarPOLine = { style: string; color: string; size: string; qty: number; inventoryKey?: string; sizeIndex?: string; whse?: string };
export type SanMarPO = { poNum: string; attention: string; shipTo: string; address1: string; address2?: string; city: string; state: string; zip: string; email: string; shipMethod: string; lines: SanMarPOLine[] };
// SanMar asks for no commas in any field
const po = (s: string, n: number) => esc(String(s || "").replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, n));
function poXml(o: SanMarPO) {
  const whse = sanmarPOWhse();
  const lines = o.lines.map((l) => `<webServicePoDetailList>${l.inventoryKey && l.sizeIndex ? `<inventoryKey>${po(l.inventoryKey, 10)}</inventoryKey><sizeIndex>${po(l.sizeIndex, 11)}</sizeIndex>` : `<inventoryKey></inventoryKey><sizeIndex></sizeIndex>`}<style>${po(l.style, 60)}</style><color>${po(l.color, 50)}</color><size>${po(l.size, 50)}</size><quantity>${Math.round(l.qty)}</quantity><whseNo>${whse && l.whse ? po(l.whse, 10) : ""}</whseNo></webServicePoDetailList>`).join("");
  return `<arg0><attention>${po(o.attention, 35)}</attention><notes></notes><poNum>${po(o.poNum, 28)}</poNum><shipTo>${po(o.shipTo, 28)}</shipTo><shipAddress1>${po(o.address1, 35)}</shipAddress1><shipAddress2>${po(o.address2 || "", 35)}</shipAddress2><shipCity>${po(o.city, 28)}</shipCity><shipState>${po(o.state, 2)}</shipState><shipZip>${po(o.zip.replace(/[^0-9-]/g, ""), 10)}</shipZip><shipMethod>${po(o.shipMethod, 15)}</shipMethod><shipEmail>${po(o.email, 105)}</shipEmail><residence>N</residence><department></department>${lines}</arg0>${poAuth()}`;
}
const PO_NS = "http://webservice.integration.sanmar.com/";
/** Checks stock for a PO without placing it: each line's warehouse, or why it can't be had. */
export async function sanmarPreSubmit(o: SanMarPO): Promise<{ ok: boolean; message: string; lines: { whse: string; message: string }[] }> {
  if (!sanmarPOMode()) throw new Error("SanMar ordering isn't turned on yet.");
  const x = await soap("/SanMarWebService/SanMarPOServicePort", "getPreSubmitInfo", poXml(o), 30000, PO_NS, poHost());
  const lines = blocks(x, "webServicePoDetailList").map((b) => ({ whse: tag(b, "whseNo"), message: tag(b, "message") }));
  return { ok: !lines.some((l) => /not in stock/i.test(l.message)), message: tag(x, "internalMessage") || tag(x, "message"), lines };
}
/** Places the PO with SanMar (charged to the card on our sanmar.com account). */
export async function sanmarSubmitPO(o: SanMarPO): Promise<{ message: string }> {
  if (!sanmarPOMode()) throw new Error("SanMar ordering isn't turned on yet.");
  const x = await soap("/SanMarWebService/SanMarPOServicePort", "submitPO", poXml(o), 45000, PO_NS, poHost());
  const message = tag(x, "message");
  if (!/success/i.test(message)) throw new Error("SanMar: " + (message || "the order wasn't accepted"));
  return { message };
}
