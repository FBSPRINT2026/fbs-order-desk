"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerItemProof } from "@/lib/itemProofs";
import type { Group } from "@/lib/pricing";
import { qtyOf, type SimpleSpec } from "@/lib/simpleOrders";

/**
 * A signage / promotional products / paper printing order in the customer's portal (Nov 4, Nick: "the customers will see
 * exactly what they see now, just an invoice… the descriptor is what's there"): each item's picture, name and description,
 * the quantity and price, and, when we sent its proof, Approve or Needs changes.
 */
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PortalItems({ orderId, groups, urls, title, hidePrices, preview }: {
  orderId: string; groups: Group[]; urls: Record<string, string>; title: string; hidePrices?: boolean; preview?: boolean;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const lines = groups.flatMap((g) => g.lines).filter((l) => l.garment || qtyOf(l) > 0);
  const answer = async (lineId: string, ok: boolean) => {
    setBusy(lineId); setErr("");
    const r = await answerItemProof(orderId, lineId, ok, ok ? "" : note);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setAsk(""); setNote(""); router.refresh();
  };
  return (
    <section className="panel pit">
      <div className="panel-h"><h2>{title}</h2><span className="faint">{lines.length} item{lines.length === 1 ? "" : "s"}</span></div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        {lines.map((l) => {
          const s = l.spec as SimpleSpec | undefined, q = qtyOf(l), each = +(l.priceOverride || 0) || 0;
          const url = s?.image ? urls[s.image] : "", st = s?.proof?.status;
          return (
            <div key={l.id} className="pit-ln">
              {s?.image ? <a className="pit-img" href={url || undefined} target="_blank" rel="noreferrer">{url && !/\.pdf$/i.test(s.image) ? <img src={url} alt={l.garment || "Proof"} /> : <span>View proof (PDF)</span>}</a> : <span className="pit-img none" aria-hidden />}
              <div className="pit-b">
                <div className="pit-t"><b>{l.garment || "Item"}</b>
                  {st === "approved" && <span className="pit-pf ok">Approved</span>}
                  {st === "changes" && <span className="pit-pf no">Changes asked</span>}
                  {st === "sent" && <span className="pit-pf wait">Waiting on you</span>}</div>
                {l.note && <div className="pit-d">{l.note}</div>}
                {!hidePrices && <div className="pit-m">{q.toLocaleString("en-US")} × {money(each)} = <b>{money(q * each)}</b></div>}
                {st === "sent" && (ask === l.id ? (
                  <div className="pit-ask">
                    <textarea rows={2} placeholder="What should we change?" value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="row"><button type="button" className="btn" onClick={() => { setAsk(""); setNote(""); }}>Cancel</button>
                      <button type="button" className="btn primary" disabled={!!busy || preview || !note.trim()} onClick={() => void answer(l.id, false)}>{busy === l.id ? "Sending…" : "Send changes"}</button></div>
                  </div>
                ) : (
                  <div className="row pit-acts"><span className="faint">Please see your visual proof and let us know if everything looks right.</span>
                    <button type="button" className="btn primary sm" disabled={!!busy || preview} onClick={() => void answer(l.id, true)}>{busy === l.id ? "Saving…" : "Approve"}</button>
                    <button type="button" className="btn sm" disabled={!!busy || preview} onClick={() => setAsk(l.id)}>Needs changes</button></div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
