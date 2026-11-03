"use client";
import { useState } from "react";
import type { Flag, FlagKey } from "@/lib/orderStages";
import { HOLD_REASONS, type HoldShow } from "@/lib/holds";
import { putOnHold } from "@/app/shop/hold-order-actions";

/**
 * "Why is this job on hold?" (Nov 3, Nick): picking On hold in an order's status menu opens this. The reason, what's going
 * on (filled in for each reason, changeable), and what the customer sees: the message, just "On hold", or nothing.
 * One component for every place a job is put on hold (lib/holds.ts).
 */
export default function HoldDialog({ orderId, owed, onClose, onDone }: { orderId: string; /** what's still due to start ("$10.83"), for Payment's note */ owed?: string; onClose: () => void; onDone: (flags: Flag[]) => void }) {
  const textFor = (k: FlagKey) => {
    const r = HOLD_REASONS.find((x) => x.key === k)!;
    return k === "hold_payment" && owed ? `We need your payment of ${owed} to start your order.` : r.text;
  };
  const [key, setKey] = useState<FlagKey>("hold_payment");
  const [note, setNote] = useState(textFor("hold_payment"));
  const [show, setShow] = useState<HoldShow>("message");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const pick = (k: FlagKey) => {
    const r = HOLD_REASONS.find((x) => x.key === k)!;
    // the note follows the reason until someone writes their own
    if (!note.trim() || HOLD_REASONS.some((x) => textFor(x.key) === note)) setNote(textFor(k));
    setKey(k); setShow(r.show);
  };
  const save = async () => {
    if (show === "message" && !note.trim()) return setErr("Write what the customer should see, or pick \"On hold\" only.");
    setBusy(true); setErr("");
    const r = await putOnHold(orderId, key, note, show);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onDone(r.flags);
  };
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Put this job on hold" onClick={onClose}>
      <div className="dla ohd" onClick={(e) => e.stopPropagation()}>
        <h3>Why is this job on hold?</h3>
        <p className="dla-sub">It keeps its place and goes back to it when you take it off hold.</p>
        <div className="ohd-reasons" role="radiogroup" aria-label="Reason">
          {HOLD_REASONS.map((r) => (
            <button key={r.key} type="button" role="radio" aria-checked={key === r.key} className={"ohd-r" + (key === r.key ? " on" : "")} onClick={() => pick(r.key)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={r.icon} /></svg>
              <span><b>{r.label}</b><small>{r.sub}</small></span>
            </button>
          ))}
        </div>
        <label className="ohd-l" htmlFor="ohd-note">What&apos;s going on</label>
        <textarea id="ohd-note" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setErr(""); }} placeholder="What's needed to take it off hold" />
        <div className="ohd-l">The customer sees</div>
        <div className="ohd-seg" role="radiogroup" aria-label="The customer sees">
          {([["message", "This message"], ["hold", "“On hold” only"], ["none", "Nothing"]] as [HoldShow, string][]).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={show === k} className={show === k ? "on" : ""} onClick={() => { setShow(k); setErr(""); }}>{l}</button>
          ))}
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="dla-acts"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Put on hold"}</button></div>
      </div>
    </div>
  );
}
