"use client";
import { SUPPLIERS } from "@/lib/goods";

export type GoodsInfoValue = { supplier: string; supplier_po: string; ship_date: string | null };

/**
 * Where a wholesale order's goods are coming from: SanMar, S&S Activewear, another supplier, or not known yet,
 * plus the supplier order # and when it ships. All optional.
 */
export default function GoodsInfoFields({ v, onChange, disabled }: { v: GoodsInfoValue; onChange: (v: GoodsInfoValue) => void; disabled?: boolean }) {
  const known = v.supplier === "" || v.supplier in SUPPLIERS;
  const other = !known || v.supplier === "__other";
  return (
    <div className="gi">
      <div className="gi-l">Where are your goods coming from?</div>
      <div className="gi-chips" role="radiogroup" aria-label="Where are your goods coming from?">
        {Object.entries(SUPPLIERS).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={v.supplier === k} className={"chip" + (v.supplier === k ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: k })}>{label}</button>
        ))}
        <button type="button" role="radio" aria-checked={other} className={"chip" + (other ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: other ? v.supplier : "__other" })}>Somewhere else</button>
        <button type="button" role="radio" aria-checked={v.supplier === ""} className={"chip" + (v.supplier === "" ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: "" })}>Not sure yet</button>
      </div>
      <div className="gi-grid">
        {other && <label>Supplier name<input type="text" autoFocus value={v.supplier === "__other" ? "" : v.supplier} disabled={disabled} onChange={(e) => onChange({ ...v, supplier: e.target.value || "__other" })} placeholder="e.g. alphabroder, your own stock" /></label>}
        <label>Their order / PO # <small>(optional)</small><input type="text" value={v.supplier_po} disabled={disabled} onChange={(e) => onChange({ ...v, supplier_po: e.target.value })} /></label>
        <label>Ships on <small>(if you know)</small><input type="date" value={v.ship_date || ""} disabled={disabled} onChange={(e) => onChange({ ...v, ship_date: e.target.value || null })} /></label>
      </div>
    </div>
  );
}
/** "__other" means "somewhere else, name not typed yet": save it as not known. */
export const cleanGoodsInfo = (v: GoodsInfoValue): GoodsInfoValue => ({ ...v, supplier: v.supplier === "__other" ? "" : v.supplier.trim() });
