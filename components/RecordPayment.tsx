"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";

type Res = { ok: boolean; error?: string; applied?: { number: number; amount: number; full: boolean }[]; total?: number };

/** Staff: one check / ACH covering many invoices, applied oldest first (the last one partly). Shows exactly where it goes before saving. */
export default function RecordPayment({ record, onDone, picked }: { record: (p: { amount: number; method: string; paid_on: string; note: string; orderIds?: string[]; preview?: boolean }) => Promise<Res>; onDone: () => void;
  /** the invoices checked in the list below (Nov 10, Nick): the amount fills in with their total, and the payment goes to them */
  picked?: { ids: string[]; total: number; label: string } | null }) {
  const [amount, setAmount] = useState(""), [method, setMethod] = useState("Check"), [day, setDay] = useState(new Date().toISOString().slice(0, 10)), [note, setNote] = useState("");
  const [prev, setPrev] = useState<Res | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const amt = Math.round((+amount.replace(/[$,\s]/g, "") || 0) * 100) / 100;
  const ids = picked?.ids.length ? picked.ids : undefined, idKey = (ids || []).join(",");
  useEffect(() => { if (picked) setAmount(picked.total.toFixed(2)); }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!(amt > 0)) { setPrev(null); return; }
    const t = setTimeout(async () => setPrev(await record({ amount: amt, method, paid_on: day, note, orderIds: ids, preview: true })), 350);
    return () => clearTimeout(t);
  }, [amt, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="aa-card rp">
      <div className="aa-sec-h"><h3>Record a payment</h3><span className="faint">{picked?.ids.length ? `For ${picked.label}: check more below, or change the amount` : "Check the invoices it pays below, or just enter the amount: it goes to the oldest first."}</span></div>
      <div className="rp-grid">
        <label>Amount received<div className="qp-amt-in"><span>$</span><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div></label>
        <label>Method<select value={method} onChange={(e) => setMethod(e.target.value)}>{["Check", "ACH", "Cash", "Credit card", "Zelle", "Venmo", "Other"].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Date<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label>Reference<input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Check #, ACH ref…" /></label>
      </div>
      {prev && (prev.ok && prev.applied ? (
        <div className="rp-prev">
          <b>Goes to {prev.applied.length} invoice{prev.applied.length === 1 ? "" : "s"}:</b>
          <div className="rp-list">{prev.applied.map((a) => <span key={a.number} className={a.full ? "" : "part"}>#{a.number} {money(a.amount)}{a.full ? "" : " (part)"}</span>)}</div>
        </div>
      ) : <div className="rp-prev bad">{prev.error}</div>)}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !prev?.ok} onClick={async () => { setBusy(true); setMsg(""); const r = await record({ amount: amt, method, paid_on: day, note, orderIds: ids }); setBusy(false); if (r.ok) { setMsg(`Recorded ${money(r.total || 0)} across ${r.applied?.length} invoices.`); setAmount(""); setNote(""); setPrev(null); onDone(); } else setMsg(r.error || "Couldn't record it."); }}>{busy ? "Saving…" : amt > 0 ? `Record ${money(amt)}` : "Record payment"}</button>
        {msg && <span className="faint" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
