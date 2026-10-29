import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which supplier carries which brand, from their own catalogs (Oct 29, Nick: "some products are only available at
 * SanMar, like Port & Company, OGIO, Carhartt… S&S only has Team 365… you should be able to learn the catalogs and just
 * go, hey, I don't even need to try to find this at S&S… It's a PC61, it's Port & Company"). No list typed by hand:
 *   - S&S: its brand list (GET /v2/brands/), kept a week in settings.data.ssBrands;
 *   - SanMar: the brands in its catalog we already keep (sanmar_styles, from SanMar's catalog files).
 * Every goods lookup asks `carries(sup, brand)` first and skips a supplier that doesn't carry the brand. A blank or
 * unknown brand is looked up everywhere, as before. Brands are compared loosely ("Port & Co" = "Port & Company",
 * "Bella + Canvas" = "BELLA+CANVAS", "Next Level Apparel" = "Next Level").
 */
export type Sup = "ss" | "sm";
export const brandKey = (b: string) => String(b || "").toLowerCase().replace(/&|\+|\band\b/g, " ").replace(/\b(company|co|apparel|inc|brand|brands|usa)\b/g, " ").replace(/[^a-z0-9]/g, "");

let memo: { at: number; ss: Set<string>; sm: Set<string> } | null = null;

export async function supplierBrands(admin: SupabaseClient): Promise<{ ss: Set<string>; sm: Set<string> }> {
  if (memo && Date.now() - memo.at < 30 * 60_000) return memo;
  const [{ data: st }, { data: smRows }] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("sanmar_styles").select("brand").eq("sellable", true).limit(10000),
  ]);
  const d = (st?.data || {}) as { ssBrands?: { at: string; list: string[] } };
  let ssList = d.ssBrands?.list || [];
  // S&S's brand list, refreshed weekly
  if (!ssList.length || Date.now() - Date.parse(d.ssBrands?.at || "") > 7 * 864e5) {
    const fresh = await ssBrandNames().catch(() => [] as string[]);
    if (fresh.length) {
      ssList = fresh;
      await admin.from("settings").update({ data: { ...(st?.data || {}), ssBrands: { at: new Date().toISOString(), list: fresh } } }).eq("id", 1);
    }
  }
  const smList = [...new Set(((smRows || []) as { brand: string }[]).map((x) => x.brand))];
  memo = { at: Date.now(), ss: new Set(ssList.map(brandKey).filter(Boolean)), sm: new Set(smList.map(brandKey).filter(Boolean)) };
  return memo;
}

async function ssBrandNames(): Promise<string[]> {
  if (!process.env.SS_ACCOUNT_NUMBER?.trim() || !process.env.SS_API_KEY?.trim()) return [];
  const auth = btoa(`${process.env.SS_ACCOUNT_NUMBER.trim()}:${process.env.SS_API_KEY.trim()}`);
  const r = await fetch("https://api.ssactivewear.com/v2/brands/", { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) return [];
  const list = (await r.json()) as { name?: string; brandName?: string }[];
  return Array.isArray(list) ? list.map((b) => String(b.name || b.brandName || "")).filter(Boolean) : [];
}

/** does this supplier carry this brand? unknown (no brand, or the supplier's list isn't in) = yes, look it up */
export function carries(b: { ss: Set<string>; sm: Set<string> }, sup: Sup, brand: string): boolean {
  const k = brandKey(brand), set = b[sup];
  if (!k || !set.size) return true;
  if (set.has(k)) return true;
  // a brand written longer or shorter than the supplier's ("Port & Co Core" / "Port") still counts
  for (const x of set) if (x.length >= 4 && (k.startsWith(x) || x.startsWith(k))) return true;
  return false;
}
