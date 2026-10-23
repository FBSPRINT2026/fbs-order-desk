import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The same garment's style number at SanMar (Oct 22, Nick: "SanMar does some weird naming things… 64400 might be G64400…
 * 3001CVC at S&S is BC3001CVC at SanMar… cross-reference between those"). SanMar puts a brand code in front of other
 * brands' numbers (BC Bella+Canvas, NL Next Level, sometimes G Gildan…), so the match is: SanMar's style list
 * (sanmar_styles) for one whose number, without its letters in front, is ours, from the same brand when we know it.
 * Then the brand codes as a guess. Best first.
 */
const PREFIX: [RegExp, string][] = [[/bella|canvas/i, "BC"], [/next\s*level/i, "NL"], [/gildan/i, "G"], [/comfort\s*colors/i, "C"], [/district/i, "DT"], [/sport-?tek/i, "ST"], [/port\s*&?\s*company/i, "PC"], [/american\s*apparel/i, "AA"], [/jerzees/i, "J"], [/hanes/i, "H"], [/independent/i, "IND"], [/champion/i, "CH"]];
const bare = (s: string) => s.toUpperCase().replace(/\s+/g, "").replace(/^[A-Z]+(?=\d)/, "");
const brandKey = (b: string) => b.toLowerCase().replace(/[^a-z]/g, "").replace(/apparel$/, "");

export async function sanmarStyles(admin: SupabaseClient, style: string, brand = ""): Promise<string[]> {
  const st = style.trim().toUpperCase().replace(/\s+/g, "");
  if (!st) return [];
  const out: string[] = [];
  const add = (s: string) => { const u = s.toUpperCase(); if (u && !out.includes(u)) out.push(u); };
  const { data } = await admin.from("sanmar_styles").select("style, brand").ilike("style", `%${bare(st)}`).limit(40);
  const rows = ((data || []) as { style: string; brand: string }[]).filter((r) => bare(r.style) === bare(st));
  const bk = brandKey(brand);
  // the same brand first, then the exact number, then any one left
  for (const r of rows.filter((r) => bk && (brandKey(r.brand).includes(bk) || bk.includes(brandKey(r.brand))))) add(r.style);
  for (const r of rows.filter((r) => r.style.toUpperCase() === st)) add(r.style);
  if (rows.length === 1) add(rows[0].style);
  // not in the list we have: the style as written, and with the brand's code in front
  add(st);
  const code = PREFIX.find(([re]) => re.test(brand))?.[1];
  if (code && /^\d/.test(st)) add(code + st);
  if (/^[A-Z]+\d/.test(st)) add(bare(st));
  return out.slice(0, 4);
}
