"use client";
import { isReorder } from "@/components/ReorderPanel";
import type { Imprint, Order } from "@/lib/pricing";

/**
 * The order's type and whether production confirms the details (Oct 24, Nick: "another button on the top row of an order
 * that says type of order… new order or reorder, or reorder with changes… a switch that says ask production to confirm
 * details, or make this a visual mock-up only… the only difference… is what the customer sees"). One place to turn it on
 * and off for the whole order, with each print still flippable (a reorder with changes: the front changed, the back is as
 * last time).
 *
 * A new order can ask production too (Oct 26, Nick: "a really complicated logo and we're not sure how many colors it's
 * going to be… I need to have production look at it first… the same idea… on a new order"), and all three types look
 * the same ("make sure they all have the same layout and they have the same look"): the switch, then what the customer
 * sees, which prints, and what to check (colors and inks, size).
 *  - Production confirms: the print's size and inks are our best guess (`confirm`) until production saves what printed.
 *  - The customer sees "Picture only": the same, and the proof shows the picture with none of the details (`visualOnly`).
 */
type O = Pick<Order, "order_type" | "notes" | "groups">;
type T = NonNullable<Order["order_type"]>;
export const CONFIRM_WHY: Record<T, string> = { new: "New order: production confirms the details before printing", reorder: "Reorder: production confirms on the run", reorder_changes: "Reorder: production confirms on the run" };
/** a print waiting on production from a new order (not a reorder): its banner and links say so */
export const isNewOrderConfirm = (why?: string | null) => /^(new order|full color art)\b/i.test(why || "");
/** the banner on a print waiting on production: a reorder's details, a new order's details, or full color art's colors */
export const confirmTitle = (why?: string | null) => (/^full color art\b/i.test(why || "") ? "Production to confirm colors" : /^new order\b/i.test(why || "") ? "Production to confirm details" : "Reorder details needed");

export const orderTypeOf = (o: O): T => o.order_type || (isReorder(o) ? "reorder" : "new");
export const ORDER_TYPE_LABEL: Record<T, string> = { new: "New order", reorder: "Reorder", reorder_changes: "Reorder with changes" };

export default function OrderTypeRow({ o, patch, bare }: { o: O; patch: (fn: (d: Order) => void) => void; /** inside Job details' Order type tab */ bare?: boolean }) {
  const t = orderTypeOf(o);
  const prints = o.groups.flatMap((g) => g.imprints);
  const open = prints.filter((im) => !im.confirmed);
  const on = (im: Imprint) => !!im.confirm && (!!im.confirm.size || !!im.confirm.ink);
  const anyOn = open.some(on), pictureOnly = open.some((im) => on(im) && im.visualOnly);
  // what production checks, across the prints that are on (both when none is on yet)
  const onNow = open.filter(on);
  const chkInk = !onNow.length || onNow.some((im) => !!im.confirm?.ink), chkSize = !onNow.length || onNow.some((im) => !!im.confirm?.size);
  const setOn = (im: Imprint, v: boolean, picture: boolean, type: T, what = { size: chkSize, ink: chkInk }) => {
    if (im.confirmed) return; // production already confirmed it
    if (v) { im.confirm = im.confirm && (im.confirm.size || im.confirm.ink) ? im.confirm : { size: what.size, ink: what.ink, why: CONFIRM_WHY[type] }; im.visualOnly = picture || undefined; }
    else { delete im.confirm; delete im.visualOnly; }
  };
  const each = (fn: (im: Imprint) => void) => patch((d) => { for (const g of d.groups) for (const im of g.imprints) fn(im); });
  const pick = (v: T) => patch((d) => {
    d.order_type = v;
    // a reorder: every print waits for production (Reorder with changes: untick the prints you changed); a new order:
    // none until it's asked for
    if (v !== "reorder_changes") for (const g of d.groups) for (const im of g.imprints) setOn(im, v === "reorder", pictureOnly, v);
    // the prints still waiting say why for the new type
    for (const g of d.groups) for (const im of g.imprints) if (!im.confirmed && im.confirm && (im.confirm.size || im.confirm.ink) && !im.confirm.filled) im.confirm.why = CONFIRM_WHY[v];
  });
  // colors and inks / size: never both off (turn the switch off for that)
  const setWhat = (k: "size" | "ink", v: boolean) => {
    if (!v && !(k === "size" ? chkInk : chkSize)) return;
    each((im) => { if (on(im) && !im.confirmed && im.confirm) im.confirm[k] = v; });
  };
  const label = (im: Imprint) => im.location || "Print";
  return (
    <div className={"pt-row ot-row" + (bare ? " ot-bare" : "")}>
      <span className="pt-l">Order type</span>
      <select className="ot-sel" aria-label="Order type" value={t} onChange={(e) => pick(e.target.value as T)}>
        <option value="new">New order</option>
        <option value="reorder">Reorder</option>
        <option value="reorder_changes">Reorder with changes</option>
      </select>
      {prints.length > 0 && (
        <>
          <label className="check ot-conf" title="Our colors, inks and size stay the best guess until production saves what they'll print">
            <input type="checkbox" checked={anyOn} onChange={(e) => each((im) => setOn(im, e.target.checked, pictureOnly, t))} />Production confirms details
          </label>
          {anyOn && (
            <>
              <span className="pt-l">Customer sees</span>
              <div className="chips">
                <button type="button" className={"chip" + (!pictureOnly ? " on" : "")} onClick={() => each((im) => { if (on(im) && !im.confirmed) delete im.visualOnly; })}>Mockup with details</button>
                <button type="button" className={"chip" + (pictureOnly ? " on" : "")} title="A visual mockup: no sizes, inks or placement on the proof" onClick={() => each((im) => { if (on(im) && !im.confirmed) im.visualOnly = true; })}>Picture only</button>
              </div>
              <div className="ot-prints">
                <span className="faint">Production confirms{t === "reorder_changes" ? " (untick what you changed)" : ""}:</span>
                {prints.map((im, i) => (
                  <label key={im.id} className="check" title={im.confirmed ? `Confirmed by ${im.confirmed.by}` : undefined}>
                    <input type="checkbox" disabled={!!im.confirmed} checked={!!im.confirmed || on(im)} onChange={(e) => patch((d) => { const x = d.groups.flatMap((g) => g.imprints).find((y) => y.id === im.id); if (x) setOn(x, e.target.checked, pictureOnly, t); })} />
                    {prints.length > 1 ? `${i + 1} ` : ""}{label(im)}{im.confirmed ? " (confirmed)" : ""}
                  </label>
                ))}
              </div>
              <div className="ot-prints">
                <span className="faint">What to check:</span>
                <label className="check"><input type="checkbox" checked={chkInk} onChange={(e) => setWhat("ink", e.target.checked)} />Colors and inks</label>
                <label className="check"><input type="checkbox" checked={chkSize} onChange={(e) => setWhat("size", e.target.checked)} />Size</label>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
