"use client";
import { isReorder } from "@/components/ReorderPanel";
import type { Imprint, Order } from "@/lib/pricing";

/**
 * The order's type and, on a reorder, whether production confirms the details on the run (Oct 24, Nick: "another button
 * on the top row of an order that says type of order… new order or reorder, or reorder with changes… a switch that says
 * ask production to confirm details, or make this a visual mock-up only… the only difference… is what the customer
 * sees"). One place to turn it on and off for the whole order, with each print still flippable (a reorder with changes:
 * the front changed, the back is as last time).
 *  - Production confirms: the print's size and inks are our best guess (`confirm`) until production saves what printed.
 *  - The customer sees "Picture only": the same, and the proof shows the picture with none of the details (`visualOnly`).
 */
type O = Pick<Order, "order_type" | "notes" | "groups">;
type T = NonNullable<Order["order_type"]>;
const WHY = "Reorder: production confirms on the run";

export const orderTypeOf = (o: O): T => o.order_type || (isReorder(o) ? "reorder" : "new");
export const ORDER_TYPE_LABEL: Record<T, string> = { new: "New order", reorder: "Reorder", reorder_changes: "Reorder with changes" };

export default function OrderTypeRow({ o, patch, bare }: { o: O; patch: (fn: (d: Order) => void) => void; /** inside Job details' Order type tab */ bare?: boolean }) {
  const t = orderTypeOf(o);
  const prints = o.groups.flatMap((g) => g.imprints);
  const open = prints.filter((im) => !im.confirmed);
  const on = (im: Imprint) => !!im.confirm && (!!im.confirm.size || !!im.confirm.ink);
  const anyOn = open.some(on), pictureOnly = open.some((im) => on(im) && im.visualOnly);
  const setOn = (im: Imprint, v: boolean, picture: boolean) => {
    if (im.confirmed) return; // production already confirmed it
    if (v) { im.confirm = im.confirm && (im.confirm.size || im.confirm.ink) ? im.confirm : { size: true, ink: true, why: WHY }; im.visualOnly = picture || undefined; }
    else { delete im.confirm; delete im.visualOnly; }
  };
  const each = (fn: (im: Imprint) => void) => patch((d) => { for (const g of d.groups) for (const im of g.imprints) fn(im); });
  const pick = (v: T) => patch((d) => {
    d.order_type = v;
    // a reorder: every print waits for production (Reorder with changes: untick the prints you changed); a new order: none
    if (v !== "reorder_changes") for (const g of d.groups) for (const im of g.imprints) setOn(im, v === "reorder", pictureOnly);
  });
  const label = (im: Imprint) => im.location || "Print";
  return (
    <div className={"pt-row ot-row" + (bare ? " ot-bare" : "")}>
      <span className="pt-l">Order type</span>
      <select className="ot-sel" aria-label="Order type" value={t} onChange={(e) => pick(e.target.value as T)}>
        <option value="new">New order</option>
        <option value="reorder">Reorder</option>
        <option value="reorder_changes">Reorder with changes</option>
      </select>
      {t !== "new" && prints.length > 0 && (
        <>
          <label className="check ot-conf" title="Our sizes and inks stay the best guess until production saves what they printed">
            <input type="checkbox" checked={anyOn} onChange={(e) => each((im) => setOn(im, e.target.checked, pictureOnly))} />Production confirms details on the run
          </label>
          {anyOn && (
            <>
              <span className="pt-l">Customer sees</span>
              <div className="chips">
                <button type="button" className={"chip" + (!pictureOnly ? " on" : "")} onClick={() => each((im) => { if (on(im) && !im.confirmed) delete im.visualOnly; })}>Mockup with details</button>
                <button type="button" className={"chip" + (pictureOnly ? " on" : "")} title="A visual mockup: no sizes, inks or placement on the proof" onClick={() => each((im) => { if (on(im) && !im.confirmed) im.visualOnly = true; })}>Picture only</button>
              </div>
            </>
          )}
          {(t === "reorder_changes" || prints.length > 1) && (
            <div className="ot-prints">
              <span className="faint">{t === "reorder_changes" ? "Production confirms (untick what you changed):" : "Production confirms:"}</span>
              {prints.map((im, i) => (
                <label key={im.id} className="check" title={im.confirmed ? `Confirmed by ${im.confirmed.by}` : undefined}>
                  <input type="checkbox" disabled={!!im.confirmed} checked={!!im.confirmed || on(im)} onChange={(e) => patch((d) => { const x = d.groups.flatMap((g) => g.imprints).find((y) => y.id === im.id); if (x) setOn(x, e.target.checked, pictureOnly); })} />
                  {prints.length > 1 ? `${i + 1} ` : ""}{label(im)}{im.confirmed ? " (confirmed)" : ""}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
