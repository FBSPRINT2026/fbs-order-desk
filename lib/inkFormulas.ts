import type { SupabaseClient } from "@supabase/supabase-js";
import { addFormulaInks } from "@/lib/inkColors";

/**
 * Reads the Ink Room's PMS formulas into the color lookup (lib/inkColors.ts FORMULA_HEX), once per page load: the
 * Mockup Creator, Create order and the order's ink swatches all know every PMS the Ink Room has.
 */
let loading: Promise<number> | null = null;
export function loadInkFormulas(sb: SupabaseClient): Promise<number> {
  if (loading) return loading;
  loading = (async () => {
    let n = 0;
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from("ink_formulas").select("name, hex").eq("system", "RX").is("archived_at", null).ilike("name", "PANTONE %").order("code").range(from, from + 999);
      if (error || !data?.length) break;
      addFormulaInks(data as { name: string; hex: string }[]);
      n += data.length;
      if (data.length < 1000) break;
    }
    if (!n) loading = null; // nothing read (signed out, offline): tried again next time
    return n;
  })();
  return loading;
}
