/**
 * THE garment suppliers as the garment search and the catalog know them (client-safe): S&S (looked up by its style ID),
 * and SanMar and One Stop (looked up by their own style code, `supplier_style`). Every place that labels a search
 * result, looks one up or says where a catalog garment came from uses these (Oct 29: One Stop added as the third, so
 * none of them assumes "S&S or else SanMar" again).
 */
export type GarmentSup = "ss" | "sanmar" | "onestop";
export const GARMENT_SUP_NAME: Record<GarmentSup, string> = { ss: "S&S", sanmar: "SanMar", onestop: "One Stop" };
export const garmentSupName = (s?: string | null) => GARMENT_SUP_NAME[(s || "ss") as GarmentSup] || s || "S&S";
/** looked up by its own style code (SanMar, One Stop), not an S&S style ID */
export const bySupplierStyle = (s?: string | null) => s === "sanmar" || s === "onestop";
/** the /api/ss/lookup query for a search result */
export function lookupQuery(h: { supplier?: string | null; style?: string | null; styleID?: number | null; supplierStyle?: string | null; brand?: string | null }): string {
  const st = encodeURIComponent(h.supplierStyle || h.style || "");
  if (bySupplierStyle(h.supplier)) return `style=${st}&supplier=${h.supplier}`;
  return h.styleID ? `styleid=${h.styleID}` : `style=${encodeURIComponent(h.style || "")}`;
}
/** a catalog garment's style at its supplier (SanMar's and One Stop's own codes) */
export const supplierStyleOf = (g: { supplier?: string | null; style: string; supplier_style?: string | null }) => (bySupplierStyle(g.supplier) ? g.supplier_style || g.style : g.style);
/** a search result already in the catalog */
export function inCatalogHit(catalog: { supplier?: string | null; style: string; supplier_style?: string | null; ss_style_id?: number | null }[], h: { supplier?: string | null; style: string; styleID?: number | null; supplierStyle?: string | null }): boolean {
  if (bySupplierStyle(h.supplier)) { const want = (h.supplierStyle || h.style).toLowerCase(); return catalog.some((c) => c.supplier === h.supplier && (c.supplier_style || c.style).toLowerCase() === want); }
  return catalog.some((c) => !!h.styleID && c.ss_style_id === h.styleID);
}
