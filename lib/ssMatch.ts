import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ssSkus } from "@/lib/ss";
import { matchColor } from "@/lib/colorMatch";

/** A garment line to buy: style / color / size and how many, matched to an S&S sku with price and stock. */
export type GoodsRow = { key: string; brand: string; style: string; color: string; size: string; qty: number; sku: string; price: number; stock: number; found: boolean; note: string;
  /** from an email only: the color the customer wrote, the style's real colors, and whether the match is a sure one */
  asked?: string; options?: string[]; sure?: boolean; styleID?: number };

/** Match rows to S&S skus (one lookup per style; our catalog remembers the S&S style id). Fills sku, price, stock. */
export async function matchToSS(admin: SupabaseClient, rows: GoodsRow[], opts: { fixColors?: boolean } = {}) {
  const styles = [...new Set(rows.map((r) => `${r.brand}|${r.style}`))];
  for (const st of styles) {
    const [brand, style] = st.split("|");
    if (!style) { for (const r of rows.filter((x) => `${x.brand}|${x.style}` === st)) r.note = "No style number"; continue; }
    const { data: gar } = await admin.from("garments").select("ss_style_id").ilike("style", style).not("ss_style_id", "is", null).limit(1).maybeSingle();
    const info = await ssSkus(gar?.ss_style_id ? +gar.ss_style_id : `${brand} ${style}`.trim()).catch(() => null);
    const colors = info ? [...new Set(info.skus.map((k) => k.colorName))].sort((a, b) => a.localeCompare(b)) : [];
    for (const r of rows.filter((x) => `${x.brand}|${x.style}` === st)) {
      if (!info) { r.note = "Style not found at S&S"; continue; }
      r.styleID = info.styleID;
      // from an email: the customer's color → the style's real color name ("forest green" → "Heather Forest Green")
      if (opts.fixColors) {
        const m = matchColor(r.color, colors);
        r.asked = r.color; r.options = colors;
        if (m) { r.color = m.color; r.sure = m.sure; } else r.sure = false;
      }
      const sku = info.skus.find((k) => k.colorName.toLowerCase() === r.color.toLowerCase() && k.size === r.size);
      if (!sku) { r.note = info.skus.some((k) => k.colorName.toLowerCase() === r.color.toLowerCase()) ? "Size not carried in this color" : "Color not found at S&S"; continue; }
      Object.assign(r, { sku: sku.sku, price: sku.price, stock: sku.qty, found: true, note: sku.qty < r.qty ? `Only ${sku.qty} in stock` : "" });
    }
  }
  return rows;
}
