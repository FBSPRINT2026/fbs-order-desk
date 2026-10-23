import type { SupabaseClient } from "@supabase/supabase-js";

/** the thread codes on the wall (Thread Room, table stock_threads), Polyneon codes as-is, Rayon codes as "R1147" */
export type StockThread = { id: string; brand: string; line: string; code: string; name: string; hex: string; pms: string; cones: number | null; min_cones: number | null; spot: string; notes: string };
let cache: { at: number; set: Set<string> } | null = null;
export async function loadThreadStock(sb: SupabaseClient): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.set;
  const { data } = await sb.from("stock_threads").select("line, code").is("archived_at", null);
  const set = new Set<string>((data || []).map((r) => stockKey(r.line as string, r.code as string)));
  cache = { at: Date.now(), set };
  return set;
}
export const stockKey = (line: string, code: string) => (/isacord/i.test(line) ? "I" : /rayon/i.test(line) ? "R" : "") + code;
export const forgetThreadStock = () => { cache = null; };
