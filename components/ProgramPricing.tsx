"use client";
import { useEffect, useState } from "react";
import { money, fmtDate } from "@/lib/format";
import type { Group } from "@/lib/pricing";
import { cardHasPrices, programForGroup, type DesignCtx, type RateCard } from "@/lib/programs";
import { pastPricesForDesign, type PastPrice } from "@/app/shop/program-pricing-actions";

/**
 * Under Retail / Wholesale / Program on an order (Oct 14, Nick): with Program on, what the rate card did to each group
 * ("program 1/1, 50 pieces" or why not: "48 pieces; the program starts at 50"); and, for any customer, what they paid
 * before for the same design (Printavo history and orders here) with Use this price.
 */
export function ProgramNotes({ groups, card, baseCost, ctx }: { groups: Group[]; card: RateCard | null; baseCost: number | null; ctx: (g: Group) => DesignCtx }) {
  const rules = [...(card?.noSetupEver ? ["No setup on any job"] : []), ...(card?.screenFee != null ? [`Screens at ${money(card.screenFee)} each`] : []), ...(card?.extras || []).map((x) => `Also: ${x}`)];
  const priced = cardHasPrices(card) || groups.some((g) => ctx(g).items.length > 0);
  return (
    <div className="prg-notes">
      {rules.map((r) => <div key={r} className="prg-note ok"><b>Program:</b> {r}</div>)}
      {priced && groups.map((g, i) => {
        const r = programForGroup(g, card, baseCost, ctx(g));
        return <div key={g.id} className={"prg-note" + (r.ok ? " ok" : "")}><b>{groups.length > 1 ? `Group ${i + 1}` : "Program"}:</b> {r.ok ? <>{r.note}{!card || card.noSetupEver || (card.waiveSetup && card.screenFee == null) ? ", no setup" : ""}</> : <>{r.note}; priced normally</>}</div>;
      })}
    </div>
  );
}

export function PastPrices({ customerId, orderId, terms, onUse }: { customerId: string; orderId: string; terms: string[]; onUse: (price: number, styles: string[]) => void }) {
  const [rows, setRows] = useState<PastPrice[] | null>(null);
  const [open, setOpen] = useState(false);
  const key = terms.join("|");
  useEffect(() => {
    let live = true;
    if (!customerId || !key.trim()) { setRows([]); return; }
    pastPricesForDesign({ customerId, orderId, terms }).then((r) => { if (live) setRows(r.ok ? r.rows : []); }, () => live && setRows([]));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, orderId, key]);
  if (!rows?.length) return null;
  const last = rows[0], l0 = last.lines[0];
  return (
    <div className="prg-past">
      <button type="button" className="prg-past-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Last time ({fmtDate(last.date)}, #{last.number}): {l0 ? <><b>{money(l0.price)}</b> × {l0.qty}{l0.style ? ` ${l0.style}` : ""}</> : money(last.total)}</span>
        <span className="faint">{rows.length > 1 ? `${rows.length} past orders ${open ? "▴" : "▾"}` : open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <table className="prg-past-t">
          <thead><tr><th>Order</th><th>Date</th><th>What</th><th className="r">Qty</th><th className="r">Each</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => r.lines.map((l, k) => (
              <tr key={r.orderId + k}>
                <td>{k === 0 ? <>#{r.number}{r.source === "printavo" ? <span className="faint"> (Printavo)</span> : null}</> : ""}</td>
                <td>{k === 0 ? fmtDate(r.date) : ""}</td>
                <td>{[l.style, l.color].filter(Boolean).join(" ")}{l.deco ? <span className="faint"> · {l.deco}</span> : null}{k === r.lines.length - 1 && r.fees.length ? <div className="faint">{r.fees.join(" · ")}</div> : null}</td>
                <td className="r">{l.qty}</td>
                <td className="r">{l.price ? money(l.price) : "—"}</td>
                <td>{l.price ? <button type="button" className="btn sm" onClick={() => onUse(l.price, [l.style])}>Use {money(l.price)}</button> : null}</td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
    </div>
  );
}
