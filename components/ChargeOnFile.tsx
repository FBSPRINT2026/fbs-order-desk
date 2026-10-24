"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { chargeableMethods, chargeSavedMethod, type ChargeableMethod } from "@/app/shop/charge-actions";

/**
 * Shop order page → Payments: charge the card or bank account the customer saved and let us charge when they ask
 * (Oct 24, Nick). Shows only when they turned that on in their portal Settings. Two clicks: Charge, then Charge it?
 */
export default function ChargeOnFile({ orderId, customerId, balance, feePct, onDone }: { orderId: string; customerId: string | null; balance: number; feePct: number; onDone: () => void }) {
  const [list, setList] = useState<ChargeableMethod[]>([]);
  const [pick, setPick] = useState("");
  const [amt, setAmt] = useState(balance.toFixed(2));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { if (customerId) void chargeableMethods(customerId).then((l) => { setList(l); if (l[0]) setPick(l[0].id); }); }, [customerId]);
  useEffect(() => { setAmt(balance.toFixed(2)); }, [balance]);
  if (!list.length) return null;
  const cur = list.find((x) => x.id === pick) || list[0];
  const sum = Math.max(0, +amt || 0), fee = cur.method !== "bank" ? Math.round(sum * feePct) / 100 : 0;
  const label = (x: ChargeableMethod) => `${x.method === "bank" ? x.brand || "Bank account" : x.brand ? x.brand.charAt(0).toUpperCase() + x.brand.slice(1) : "Card"} ending ${x.last4}${x.exp ? ` · exp ${x.exp}` : ""}`;
  return (
    <div className="cof">
      <div className="cof-h"><b>Charge their card on file</b><span className="faint">They allowed us to charge it when they ask{cur.staff_charge_at ? ` (since ${new Date(cur.staff_charge_at).toLocaleDateString()})` : ""}.</span></div>
      <div className="cof-row">
        <select aria-label="Saved payment method" value={cur.id} onChange={(e) => { setPick(e.target.value); setArmed(false); }}>{list.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select>
        <input type="number" step="0.01" min="1" aria-label="Amount to charge" value={amt} onChange={(e) => { setAmt(e.target.value); setArmed(false); }} />
        <button type="button" className={"btn" + (armed ? " primary armed" : "")} disabled={busy || sum < 1 || sum > balance + 0.004} onClick={async () => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
          setArmed(false); setBusy(true); setMsg(null);
          const r = await chargeSavedMethod({ orderId, savedId: cur.id, amount: sum });
          setBusy(false);
          if (!r.ok) return setMsg({ ok: false, t: r.error || "The charge didn't go through." });
          setMsg({ ok: true, t: `Charged ${money((r.paid || 0) + (r.fee || 0))}${r.fee ? ` (${money(r.paid || 0)} + ${money(r.fee)} card fee)` : ""}.` });
          onDone();
        }}>{busy ? "Charging…" : armed ? `Charge ${money(sum + fee)}?` : `Charge ${money(sum + fee)}`}</button>
      </div>
      {fee > 0 && <div className="faint" style={{ fontSize: 12 }}>Includes the {feePct}% card fee ({money(fee)}).</div>}
      {msg && <div className={msg.ok ? "okmsg" : "pv-err"}>{msg.t}</div>}
    </div>
  );
}
