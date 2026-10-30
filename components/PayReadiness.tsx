"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { payState, type PayMode } from "@/lib/payReady";
import type { PayTerms } from "@/lib/pricing";

/**
 * Shop order page → Payments: when the customer can pay it online (Oct 24, Nick: "You can't pay an invoice just all the
 * time"). Auto follows where the order is (lib/payReady.ts); Not yet / Deposit only / Full balance set it by hand.
 * "Charges may still change" lets them pay with a note that the total isn't final (shipping later, extras).
 */
export default function PayReadiness({ order, paid, depositPct, deposit, terms }: {
  order: { id: string; status: string; type?: string | null; pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null };
  paid: number; depositPct: number; deposit: number; /** the customer's payment terms: Auto follows them (lib/payTerms.ts) */ terms?: PayTerms;
}) {
  const [mode, setMode] = useState<PayMode>((order.pay_mode as PayMode) || "auto");
  const [nf, setNf] = useState(!!order.pay_not_final);
  const [note, setNote] = useState(order.pay_note || "");
  const [state, setState] = useState("");
  const save = async (patch: { pay_mode?: string | null; pay_not_final?: boolean; pay_note?: string }) => {
    setState("Saving…");
    const { error } = await createClient().from("orders").update(patch).eq("id", order.id);
    setState(error ? `Couldn't save: ${error.message}` : "Saved");
    setTimeout(() => setState(""), 2000);
  };
  const ps = payState({ ...order, pay_mode: mode === "auto" ? null : mode, pay_not_final: nf, pay_note: note }, { paid, depositPct, terms });
  const auto = payState({ ...order, pay_mode: null }, { paid, depositPct, terms });
  const sees = ps.can === "none" ? `Not ready to pay · ${ps.why}` : ps.can === "deposit" ? `Can pay the deposit (${money(deposit)})` : "Can pay the full balance";
  const autoLabel = auto.can === "none" ? "not yet" : auto.can === "deposit" ? "deposit" : "full balance";
  return (
    <div className="prd">
      <div className="prd-row">
        <label className="field" style={{ flex: "1 1 220px" }}><span className="lbl">Online payment</span>
          <select value={mode} onChange={(e) => { const m = e.target.value as PayMode; setMode(m); void save({ pay_mode: m === "auto" ? null : m }); }}>
            <option value="auto">Auto (now: {autoLabel})</option>
            <option value="not_yet">Not yet</option>
            <option value="deposit">Deposit only</option>
            <option value="ready">Full balance</option>
          </select>
        </label>
        <label className="check prd-nf"><input type="checkbox" checked={nf} onChange={(e) => { setNf(e.target.checked); void save({ pay_not_final: e.target.checked }); }} /> Charges may still change</label>
      </div>
      {(nf || mode === "not_yet") && (
        <label className="field"><span className="lbl">{mode === "not_yet" && !nf ? "Why it can't be paid yet (they see this)" : "What may change (they see this)"}</span>
          <input type="text" placeholder={nf ? "Shipping will be added when it ships" : "We're confirming your sizes"} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (order.pay_note || "")) void save({ pay_note: note.trim() }); }} />
        </label>
      )}
      <div className="prd-sees"><span className="faint">They see:</span> {sees}{ps.notFinal ? ` · Not final: ${note || "there may be more charges"}` : ""}{state && <span className="faint"> · {state}</span>}</div>
    </div>
  );
}
