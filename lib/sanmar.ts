import "server-only";

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

async function soap(path: string, op: string, inner: string, timeoutMs = 25000): Promise<string> {
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/"><soapenv:Header/><soapenv:Body><impl:${op}>${inner}</impl:${op}></soapenv:Body></soapenv:Envelope>`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(host() + path, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' }, body, cache: "no-store", signal: ctl.signal });
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
  YXS: "YXS", YS: "YS", YM: "YM", YL: "YL", YXL: "YXL", OSFA: "OS", OS: "OS", "ONE SIZE": "OS", ADJ: "OS", "S/M": "M", "M/L": "L", "L/XL": "XL" };
const ORDER = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
const num = (s: string) => { const n = parseFloat(s); return isFinite(n) ? n : 0; };

export type SanMarSku = { color: string; catalogColor: string; size: string; rawSize: string; piecePrice: number; casePrice: number; myPrice: number; image: string; front: string; back: string; swatch: string; brand: string; title: string; description: string; status: string };

/** Every color/size of a style: names, photos and SanMar's prices (list + ours). */
export async function sanmarSkus(style: string): Promise<SanMarSku[]> {
  const st = style.trim();
  const info = await soap("/SanMarWebService/SanMarProductInfoServicePort", "getProductInfoByStyleColorSize", `<arg0><style>${esc(st)}</style><color></color><size></size></arg0>${auth()}`);
  const rows = blocks(info, "listResponse");
  if (!rows.length) return [];
  // our prices (customer-specific "myPrice"); pricing failing shouldn't stop the lookup
  const mine = new Map<string, number>();
  try {
    const pr = await soap("/SanMarWebService/SanMarPricingServicePort", "getPricing", `<arg0><style>${esc(st)}</style><color></color><size></size></arg0>${auth()}`);
    for (const b of blocks(pr, "listResponse")) { const p = num(tag(b, "myPrice")) || num(tag(b, "casePrice")) || num(tag(b, "piecePrice")); if (p) mine.set(`${tag(b, "color")}|${tag(b, "size")}`.toLowerCase(), p); }
  } catch { /* list prices still come back with the product info */ }
  return rows.map((b) => {
    const basic = blocks(b, "productBasicInfo")[0] || b, img = blocks(b, "productImageInfo")[0] || b, price = blocks(b, "productPriceInfo")[0] || b;
    const color = tag(basic, "color"), raw = tag(basic, "size");
    return {
      color, catalogColor: tag(basic, "catalogColor") || color, rawSize: raw, size: SIZE_MAP[raw.toUpperCase()] || raw.toUpperCase(),
      piecePrice: num(tag(price, "piecePrice")), casePrice: num(tag(price, "casePrice")), myPrice: mine.get(`${color}|${raw}`.toLowerCase()) || 0,
      image: tag(img, "productImage"), front: tag(img, "frontModel") || tag(img, "frontFlat") || tag(img, "colorProductImage"), back: tag(img, "backModel") || tag(img, "backFlat"), swatch: tag(img, "colorSwatchImage"),
      brand: tag(basic, "brandName"), title: tag(basic, "productTitle"), description: tag(basic, "productDescription"), status: tag(basic, "productStatus"),
    };
  });
}

export type SanMarGarment = { style: string; brand: string; description: string; colors: string[]; cost: number; sizes: string[]; size_costs: Record<string, number>; image: string; color_images: Record<string, { front: string; back: string; side: string; hex: string }>; supplier: "sanmar"; supplier_style: string };

/** Look up a SanMar style ("PC61", "K500", "NKDC1963") and shape it like a catalog garment. Cost = our price. */
export async function sanmarLookup(style: string): Promise<SanMarGarment | null> {
  const t = style.trim().toUpperCase();
  if (!t) return null;
  const skus = await sanmarSkus(t);
  if (!skus.length) return null;
  const colors = [...new Set(skus.map((s) => s.catalogColor).filter(Boolean))];
  const sizes = [...new Set(skus.map((s) => s.size).filter(Boolean))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const cost = (s: SanMarSku) => s.myPrice || s.casePrice || s.piecePrice;
  const size_costs: Record<string, number> = {};
  for (const z of sizes) { const cs = skus.filter((s) => s.size === z).map(cost).filter((x) => x > 0); if (cs.length) size_costs[z] = Math.min(...cs); }
  const base = Math.min(...Object.values(size_costs).filter((x) => x > 0), Infinity);
  const color_images: SanMarGarment["color_images"] = {};
  for (const c of colors) { const s = skus.find((x) => x.catalogColor === c && (x.front || x.image)); if (s) color_images[c] = { front: s.front || s.image, back: s.back, side: "", hex: "" }; }
  const first = skus[0];
  return {
    style: t, brand: first.brand || "SanMar", description: first.title || first.description.replace(/<[^>]+>/g, " ").slice(0, 200),
    colors, cost: isFinite(base) ? base : 0, sizes, size_costs, image: first.image || first.front, color_images, supplier: "sanmar", supplier_style: t,
  };
}

/** A small, cheap call to prove the credentials work (one SKU's price). */
export async function sanmarPing(): Promise<string> {
  const x = await soap("/SanMarWebService/SanMarPricingServicePort", "getPricing", `<arg0><style>PC61</style><color>White</color><size>M</size></arg0>${auth()}`, 10000);
  const p = blocks(x, "listResponse")[0] || "";
  return p ? `answered (PC61 White M: $${num(tag(p, "myPrice")) || num(tag(p, "piecePrice"))})` : "answered";
}
