import "server-only";
import { SIZES } from "@/lib/pricing";

/** S&S Activewear API v2 (https://api.ssactivewear.com/V2/Default.aspx). Basic auth: account number / API key. */
const BASE = "https://api.ssactivewear.com/v2";

export function ssConfigured() {
  return !!(process.env.SS_ACCOUNT_NUMBER?.trim() && process.env.SS_API_KEY?.trim());
}

async function ssGet<T>(path: string): Promise<T> {
  const auth = btoa(`${process.env.SS_ACCOUNT_NUMBER!.trim()}:${process.env.SS_API_KEY!.trim()}`);
  const r = await fetch(BASE + path, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, cache: "no-store" });
  if (r.status === 404) return [] as unknown as T;
  if (r.status === 401 || r.status === 403) throw new Error("S&S rejected the account number or API key.");
  if (!r.ok) throw new Error(`S&S returned ${r.status}`);
  return (await r.json()) as T;
}

type SSStyle = { styleID: number; partNumber: string; brandName: string; styleName: string; title: string; baseCategory: string; styleImage: string };
type SSProduct = { colorName: string; sizeName: string; sizeOrder: string; customerPrice: number; piecePrice: number; qty: number };

// S&S size names -> our size codes
const SIZE_MAP: Record<string, string> = {
  XS: "XS", S: "S", M: "M", L: "L", XL: "XL", "2XL": "2XL", XXL: "2XL", "3XL": "3XL", XXXL: "3XL", "4XL": "4XL", "5XL": "5XL",
  YXS: "YXS", YS: "YS", YM: "YM", YL: "YL", YXL: "YXL", "OSFA": "OS", "OS": "OS", "ONE SIZE": "OS", "ADJ": "OS",
};

function mode(nums: number[]) {
  const c = new Map<number, number>();
  nums.forEach((n) => c.set(n, (c.get(n) || 0) + 1));
  let best = nums[0], n0 = 0;
  c.forEach((n, v) => { if (n > n0 || (n === n0 && v < best)) { best = v; n0 = n; } });
  return best;
}

export type SSHit = { styleID: number; brand: string; style: string; title: string; image: string };

/** Every S&S style matching what someone typed ("5000", "G5000", "Gildan 5000"), best matches first. */
export async function ssSearch(q: string): Promise<SSHit[]> {
  const t = q.trim();
  const stripped = t.replace(/^[A-Za-z]{1,2}(?=\d)/, "");
  const seen = new Map<number, SSStyle>();
  for (const term of [t, stripped].filter((v, i, a) => v && a.indexOf(v) === i)) {
    const list = await ssGet<SSStyle[]>(`/styles?search=${encodeURIComponent(term)}`);
    if (Array.isArray(list)) list.forEach((st) => seen.set(st.styleID, st));
  }
  const lc = (x: string) => (x || "").toLowerCase();
  const keys = [lc(t), lc(stripped)];
  const prefix = t.match(/^([A-Za-z]{1,2})(?=\d)/)?.[1]?.toLowerCase();
  const score = (st: SSStyle) => {
    const n = lc(st.styleName);
    let sc = keys.includes(n) || keys.includes(lc(`${st.brandName} ${st.styleName}`)) ? 0 : keys.some((k) => n.startsWith(k)) ? 1 : 2;
    if (prefix && lc(st.brandName).startsWith(prefix)) sc -= 0.5;
    return sc;
  };
  return [...seen.values()]
    .sort((a, b) => score(a) - score(b) || a.brandName.localeCompare(b.brandName) || a.styleName.localeCompare(b.styleName))
    .slice(0, 30)
    .map((st) => ({ styleID: st.styleID, brand: st.brandName, style: st.styleName, title: st.title, image: st.styleImage ? `https://www.ssactivewear.com/${st.styleImage}` : "" }));
}

/** Find the S&S style for what someone typed ("G5000", "5000", "Gildan 5000", "18500B"). */
/** Find the S&S style for what someone typed ("G5000", "5000", "Gildan 5000", "18500B"). */
async function findStyle(q: string): Promise<SSStyle | null> {
  const t = q.trim();
  const stripped = t.replace(/^[A-Za-z]{1,2}(?=\d)/, "");
  const tries = [t, stripped].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const term of tries) {
    const list = await ssGet<SSStyle[]>(`/styles?search=${encodeURIComponent(term)}`);
    if (!Array.isArray(list) || !list.length) continue;
    const eq = (s: SSStyle) => [s.styleName, s.partNumber, `${s.brandName} ${s.styleName}`].some((x) => (x || "").toLowerCase() === t.toLowerCase() || (x || "").toLowerCase() === stripped.toLowerCase());
    const hits = list.filter(eq);
    const prefix = t.match(/^([A-Za-z]{1,2})(?=\d)/)?.[1]?.toLowerCase();
    const pick = (prefix && hits.find((s) => s.brandName.toLowerCase().startsWith(prefix))) || hits[0];
    if (pick) return pick;
  }
  return null;
}

export type SSGarment = { style: string; brand: string; description: string; colors: string[]; cost: number; sizes: string[]; size_costs: Record<string, number>; ss_style_id: number; image: string };

/** Look up a style on S&S and shape it like a catalog garment. Cost = your price (customerPrice). */
export async function ssLookup(q: string, styleID?: number): Promise<SSGarment | null> {
  const st = styleID ? (await ssGet<SSStyle[]>(`/styles/?styleid=${styleID}`))[0] : await findStyle(q);
  if (!st) return null;
  const prods = await ssGet<SSProduct[]>(`/products/?styleid=${st.styleID}&fields=colorName,sizeName,sizeOrder,customerPrice,piecePrice,qty`);
  if (!Array.isArray(prods) || !prods.length) return null;
  const colors = [...new Set(prods.map((p) => p.colorName).filter(Boolean))];
  const bySize = new Map<string, { order: string; prices: number[] }>();
  // youth styles label sizes XS-XL; ours are YXS-YXL
  const youth = /youth|toddler|kids|infant/i.test(`${st.title} ${st.baseCategory}`);
  const YOUTH: Record<string, string> = { XS: "YXS", S: "YS", M: "YM", L: "YL", XL: "YXL" };
  for (const p of prods) {
    const raw = SIZE_MAP[(p.sizeName || "").toUpperCase().trim()];
    const z = youth && raw && YOUTH[raw] ? YOUTH[raw] : raw;
    if (!z) continue;
    const price = +(p.customerPrice || p.piecePrice || 0);
    const e = bySize.get(z) || { order: p.sizeOrder, prices: [] };
    if (price) e.prices.push(price);
    bySize.set(z, e);
  }
  const order = SIZES as readonly string[];
  const sizes = [...bySize.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const size_costs: Record<string, number> = {};
  bySize.forEach((e, z) => { if (e.prices.length) size_costs[z] = Math.round(mode(e.prices) * 100) / 100; });
  const baseSizes = sizes.filter((z) => !/^[2-5]XL$/.test(z));
  const cost = Math.min(...(baseSizes.length ? baseSizes : sizes).map((z) => size_costs[z]).filter((v) => v > 0)) || 0;
  return {
    style: st.styleName,
    brand: st.brandName,
    description: st.title || st.styleName,
    colors,
    cost: Number.isFinite(cost) ? cost : 0,
    sizes,
    size_costs,
    ss_style_id: st.styleID,
    image: st.styleImage ? `https://www.ssactivewear.com/${st.styleImage}` : "",
  };
}
