import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanmarConfigured, sanmarSkus } from "@/lib/sanmar";
import { sanmarStyles } from "@/lib/sanmarStyle";
import { matchColor } from "@/lib/colorMatch";

/**
 * SanMar's back photo of a style and color our supplier has no back of (one finder for the Mockup Creator's ask, the
 * photo route, and the catalog sweep: Nov 1, Nick: "look tonight in your catalog… a front but no back… normalize it"):
 * a flat back to use as is, else the back on a model to offer.
 */
export const sq = (s: string) => (s || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");
export async function sanmarBack(admin: SupabaseClient, g: { style?: string | null; supplier_style?: string | null; brand?: string | null; supplier?: string | null }, color: string): Promise<{ flat?: string; model?: string }> {
  if (g.supplier === "sanmar" || !sanmarConfigured()) return {};
  for (const t of await sanmarStyles(admin, String(g.supplier_style || g.style || "").trim().toUpperCase(), String(g.brand || ""))) {
    const skus = (await sanmarSkus(t).catch(() => [])).filter((x) => x.backFlat || x.backModel);
    if (!skus.length) continue;
    let hit = skus.find((x) => sq(x.color) === sq(color) || sq(x.catalogColor) === sq(color));
    if (!hit) { const names = [...new Set(skus.flatMap((x) => [x.color, x.catalogColor]).filter(Boolean))]; const m = matchColor(color, names); if (m?.sure) hit = skus.find((x) => x.color === m.color || x.catalogColor === m.color); }
    if (!hit) continue;
    return hit.backFlat ? { flat: hit.backFlat } : { model: hit.backModel };
  }
  return {};
}
