"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { applyMyCredit, myCredit, refundMyCredit } from "@/app/portal/credit-actions";

/**
 * Their credit, in the portal's Payments (Nov 3, Nick: "hey, you've got a credit. How would you like to use it? Apply to
 * this invoice… refund the card on file"; lib/credits.ts): put it on an open invoice, or get it back on the card it was
 * paid with ($20 or less right away, more once FBS approves).
 */
type Data = { total: number; pending: number; from: { id: string; number: number; nickname: string; credit: number }[]; open: { id: string; number: number; nickname: string; balance: number }[] };
export default function CreditBox({ customerId, preview = false }: { customerId: string; preview?: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null), [to, setTo] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [ask, setAsk] = useState(false);
  const load = () => void myCredit(customerId).then((r) => { if (r.ok) { setD(r); setTo((x) => x || r.open[0]?.id || ""); } });
  useEffect(load, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || (d.total <= 0.004 && d.pending <= 0.004)) return null;
  const inv = d.open.find((o) => o.id === to);
  const apply = async () => {
    if (preview) return setMsg({ ok: false, t: "This is a preview." });
    if (!inv) return;
    setBusy("apply"); setMsg(null);
    const r = await applyMyCredit(customerId, inv.id, d.total);
    setBusy("");
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: `${money(r.applied)} of your credit is on #${inv.number} now.` }); load(); router.refresh();
  };
  const refund = async () => {
    if (preview) return setMsg({ ok: false, t: "This is a preview." });
    setBusy("refund"); setMsg(null); setAsk(false);
    const r = await refundMyCredit(customerId, d.total);
    setBusy("");
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: r.refunded ? `${money(r.refunded)} is on its way back to your card. It shows in a few business days.` : `We got your refund request for ${money(r.waiting)}. We'll send it back to your card shortly.` }); load(); router.refresh();
  };
  return (
    <section className="crb">
      <div className="crb-h">
        <div><b>You have a {money(d.total)} credit</b><small>From {d.from.map((x) => `#${x.number}`).join(", ")}{d.pending > 0.004 ? ` · ${money(d.pending)} refund waiting on FBS` : ""}</small></div>
      </div>
      {d.total > 0.004 && <div className="crb-acts">
        {d.open.length > 0 && <div className="crb-apply">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Invoice to use it on">{d.open.map((o) => <option key={o.id} value={o.id}>#{o.number}{o.nickname ? ` ${o.nickname}` : ""} · {money(o.balance)} due</option>)}</select>
          <button type="button" className="btn primary" disabled={!!busy || !inv} onClick={() => void apply()}>{busy === "apply" ? "Applying…" : `Apply ${money(Math.min(d.total, inv?.balance || 0))}`}</button>
        </div>}
        {ask ? <div className="crb-ask"><span>Send {money(d.total)} back to the card it was paid with?{d.total > 20 ? " FBS approves refunds over $20 first." : ""}</span><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void refund()}>Yes, refund it</button><button type="button" className="btn sm ghost" onClick={() => setAsk(false)}>Cancel</button></div>
          : <button type="button" className="btn" disabled={!!busy} onClick={() => setAsk(true)}>{busy === "refund" ? "Refunding…" : "Refund to my card"}</button>}
      </div>}
      {msg && <div className={msg.ok ? "crb-ok" : "err"} role="status">{msg.t}</div>}
    </section>
  );
}
