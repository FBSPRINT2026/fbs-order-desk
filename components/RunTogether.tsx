"use client";
import { useState } from "react";
import type { RunCtx } from "@/lib/pricing";
import { runOptions, setRun } from "@/app/shop/run-actions";

/**
 * Run together, in Job details & type (Nick, Nov 16 2026: "it's not really a common thing… just to start, it should just
 * be like a little check mark… on that panel"): ticked, the order runs with the customer's other orders it's linked
 * to: one run on the schedule, the same print priced on all their pieces, each with its own invoice (lib/runTogether.ts).
 */
type Opt = { id: string; number: number; nickname: string; qty: number; status: string; shares: boolean; inRun: boolean };

export default function RunTogether({ orderId, runId, ctx, onChanged }: { orderId: string; runId?: string | null; ctx?: RunCtx | null; onChanged: () => void }) {
  const mates = ctx?.mates || [];
  const on = !!runId && mates.length > 0;
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setOpen(true); setOpts(null); setErr("");
    const r = await runOptions(orderId);
    if (!r.ok) { setErr(r.error); setOpts([]); return; }
    setOpts(r.rows);
    setPick(new Set(r.rows.filter((x) => x.inRun).map((x) => x.id)));
  }
  async function save(ids: string[]) {
    setBusy(true); setErr("");
    const r = await setRun(orderId, ids);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); onChanged();
  }

  return (
    <div className="rtg">
      <label className="check ot-conf" title="Separate orders, invoices and POs that print in one run, the same print priced on all their pieces">
        <input type="checkbox" checked={on || open} disabled={busy} onChange={(e) => { if (e.target.checked) void load(); else if (on) void save([]); else setOpen(false); }} />Run together with other orders
      </label>
      {on && !open && (
        <div className="rtg-sum">
          <span>With {mates.map((m) => `#${m.number}`).join(", ")} · {mates.reduce((a, m) => a + m.qty, 0)} more pcs</span>
          <button type="button" className="linkbtn" onClick={() => void load()}>Change</button>
        </div>
      )}
      {open && (
        <div className="rtg-box">
          {opts === null ? <span className="faint">Finding their open orders…</span> : !opts.length ? <span className="faint">No other open orders for this customer.</span> : (
            <ul className="rtg-list">
              {opts.map((x) => (
                <li key={x.id}><label className="rtg-r">
                  <input type="checkbox" checked={pick.has(x.id)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} />
                  <span className="rtg-n"><b>#{x.number}</b> {x.nickname}</span>
                  <span className="rtg-q">{x.qty} pcs{x.shares ? " · same print" : ""}</span>
                </label></li>
              ))}
            </ul>
          )}
          {err && <span className="rtg-err">{err}</span>}
          <div className="rtg-b">
            <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn sm primary" disabled={busy || opts === null || (!pick.size && !on)} onClick={() => void save([...pick])}>{busy ? "Saving…" : pick.size ? "Run together" : "Run on its own"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
