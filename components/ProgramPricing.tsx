"use client";
import { useEffect, useState } from "react";
import { money, fmtDate } from "@/lib/format";
import type { Group, Settings } from "@/lib/pricing";
import { cardHasPrices, programForGroup, suggestDesignPrice, type DesignCtx, type RateCard } from "@/lib/programs";
import { addPriceBreak, pastPricesForDesign, type PastPrice } from "@/app/shop/program-pricing-actions";

/**
 * Under Retail / Wholesale / Program on an order (Oct 14, Nick): with Program on, what the rate card did to each group
 * ("program 1/1, 50 pieces" or why not: "48 pieces; the program starts at 50"); and, for any customer, what they paid
 * before for the same design (Printavo history and orders here) with Use this price.
 */
export function ProgramNotes({ groups, card, baseCost, ctx }: { groups: Group[]; card: RateCard | null; baseCost: number | null; ctx: (g: Group) => DesignCtx }) {
  const rules = [...(card?.freeDelivery ? ["Free local delivery by our courier (shipping isn't included)"] : []), ...(card?.included?.length ? [`Included in the price: ${card.included.join(", ")}`] : []), ...(card?.noSetupEver ? ["No setup on any job"] : []), ...(card?.screenFee != null ? [`Screens at ${money(card.screenFee)} each`] : []), ...(card?.extras || []).map((x) => `Also: ${x}`)];
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

/**
 * A program design at a quantity they've never had (Oct 14, Nick: "recommend this price… I would have wanted you to get
 * to 200 at $5.50"): their nearest price moved as much as the retail table moves, only on a real jump (25%+ more or
 * 20%+ fewer pieces, retail moving 5%+). Use it, use it and keep it as a price break, or keep their price.
 */
export function PriceSuggestions({ groups, ctx, settings, onUse, onSaved }: { groups: Group[]; ctx: (g: Group) => DesignCtx; settings: Settings; onUse: (groupId: string, price: number) => void; onSaved: () => void }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const list = groups.map((g) => ({ g, s: suggestDesignPrice(g, ctx(g), settings) })).filter((x) => x.s && !gone.has(`${x.g.id}:${x.s.qty}`) && !x.g.lines.every((l) => !Object.values(l.sizes || {}).some((n) => +(n || 0) > 0) || +(l.priceOverride ?? -1) === x.s!.price));
  if (!list.length) return null;
  return (
    <div className="prg-sug" role="region" aria-label="Recommended program price">
      {list.map(({ g, s }) => {
        const k = `${g.id}:${s!.qty}`, pct = Math.round((s!.retailNow / s!.retailRef - 1) * 100);
        return (
          <div key={k} className="prg-sug-c">
            <div className="prg-sug-h"><span aria-hidden>✦</span> <b>{s!.name} at {s!.qty} pieces:</b> they&apos;ve never had this quantity. I recommend <b className="prg-sug-p">{money(s!.price)}</b> each.</div>
            <p className="prg-sug-why">Their price is {money(s!.refPrice)} at {s!.refQty}. On the retail table this print goes from {money(s!.retailRef)} at {s!.refQty} to {money(s!.retailNow)} at {s!.qty} ({pct > 0 ? "+" : ""}{pct}%), so the same move from {money(s!.refPrice)} is {money(s!.price)}.</p>
            <div className="prg-sug-a">
              <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => onUse(g.id, s!.price)}>Use {money(s!.price)}</button>
              <button type="button" className="btn sm" disabled={!!busy} onClick={async () => {
                setBusy(k); setErr("");
                const r = await addPriceBreak({ itemId: s!.itemId, min: s!.qty, price: s!.price }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
                setBusy("");
                if (!r.ok) { setErr(r.error); return; }
                onUse(g.id, s!.price); onSaved();
              }}>{busy === k ? "Saving…" : `Use it and save ${s!.qty}+ ${money(s!.price)} as a price break`}</button>
              <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => setGone((x) => new Set(x).add(k))}>Keep {money(s!.refPrice)}</button>
            </div>
            {err && <p className="prg-sug-err">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}
