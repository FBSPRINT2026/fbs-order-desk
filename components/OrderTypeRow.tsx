"use client";
import { isReorder } from "@/components/ReorderPanel";
import type { Imprint, Order } from "@/lib/pricing";
import { useSticky } from "@/lib/useSticky";

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
  // laid out to read top to bottom (Nov 1, Nick: "this reorder panel just looks weird… with multiple things"): the same
  // small heading on each part, the prints by group with their size, what's checked as two buttons; Done folds it to one
  // line, the arrow opens it again
  const [open1, setOpen1] = useSticky("order.confirmPanel", true);
  const all = (v: boolean) => each((im) => setOn(im, v, pictureOnly, t));
  const nOn = prints.filter((im) => !!im.confirmed || on(im)).length;
  const say = `Production checks ${nOn === prints.length ? (prints.length === 1 ? "the print" : `all ${prints.length} prints`) : `${nOn} of ${prints.length} prints`}: ${[chkInk && "colors & inks", chkSize && "size"].filter(Boolean).join(", ")}. Customer sees ${pictureOnly ? "a picture only" : "the mockup with details"}.`;
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
            <input type="checkbox" checked={anyOn} onChange={(e) => { const v = e.target.checked; each((im) => setOn(im, v, pictureOnly, t)); if (v) setOpen1(true); }} />Production confirms details
          </label>
          {anyOn && !open1 && (
            <div className="otp-sum">
              <span>{say}</span>
              <button type="button" className="otp-arrow" aria-label="Open the details" title="Open the details" onClick={() => setOpen1(true)}>▾</button>
            </div>
          )}
          {anyOn && open1 && (
            <div className="otp">
              <div className="otp-k">Customer sees</div>
              <div className="otp-seg" role="group" aria-label="Customer sees">
                <button type="button" className={!pictureOnly ? "on" : ""} onClick={() => each((im) => { if (on(im) && !im.confirmed) delete im.visualOnly; })}>Mockup with details</button>
                <button type="button" className={pictureOnly ? "on" : ""} title="A visual mockup: no sizes, inks or placement on the proof" onClick={() => each((im) => { if (on(im) && !im.confirmed) im.visualOnly = true; })}>Picture only</button>
              </div>
              <div className="otp-k">Prints production checks{prints.length > 1 && <span className="otp-all"><button type="button" onClick={() => all(true)}>All</button> · <button type="button" onClick={() => all(false)}>None</button></span>}</div>
              <div className="otp-list">
                {o.groups.map((g, gi) => g.imprints.length > 0 && (
                  <div key={g.id} className="otp-g">
                    {o.groups.filter((x) => x.imprints.length).length > 1 && <div className="otp-gh">{g.name || `Group ${gi + 1}`}{(() => { const cs = [...new Set(g.lines.map((l) => String(l.color || "").trim()).filter(Boolean))]; return cs.length ? ` · ${cs.join(", ")}` : ""; })()}</div>}
                    {g.imprints.map((im) => (
                      <label key={im.id} className="otp-r" title={im.confirmed ? `Confirmed by ${im.confirmed.by}` : undefined}>
                        <input type="checkbox" disabled={!!im.confirmed} checked={!!im.confirmed || on(im)} onChange={(e) => patch((d) => { const x = d.groups.flatMap((gg) => gg.imprints).find((y) => y.id === im.id); if (x) setOn(x, e.target.checked, pictureOnly, t); })} />
                        <span className="otp-n">{label(im)}</span>
                        <span className="otp-s">{im.confirmed ? "confirmed" : !on(im) && t === "reorder_changes" ? "changed" : im.size || ""}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              {t === "reorder_changes" && <div className="otp-note">Untick the prints you changed.</div>}
              <div className="otp-k">What they check</div>
              <div className="otp-what">
                <button type="button" className={chkInk ? "on" : ""} aria-pressed={chkInk} onClick={() => setWhat("ink", !chkInk)}>{chkInk ? "✓ " : ""}Colors &amp; inks</button>
                <button type="button" className={chkSize ? "on" : ""} aria-pressed={chkSize} onClick={() => setWhat("size", !chkSize)}>{chkSize ? "✓ " : ""}Size</button>
              </div>
              <div className="otp-done"><button type="button" className="btn sm primary" onClick={() => setOpen1(false)}>Done</button></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
