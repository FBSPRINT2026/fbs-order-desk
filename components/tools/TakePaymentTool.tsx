"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CustomerPick from "@/components/CustomerPick";
import BillAddressFields from "@/components/BillAddressFields";
import { billMissing, emptyBill, staxAddress } from "@/lib/billAddress";
import { staxReason } from "@/lib/staxReason";
import { fmtDate, money } from "@/lib/format";
import { paymentContext, setPayOptions, takePayment, type TPInvoice, type TPMethod, type TPResult } from "@/app/shop/take-payment-actions";

/**
 * Take a Payment (Nov 3, Nick; app/shop/take-payment-actions.ts): pick the customer, tick invoices from their statement,
 * pick the card (on file and OK'd, or a new one typed in while they're on the phone), one charge or one per invoice, the
 * card fee on or off, charge. The one place the shop runs a customer's card: the Shop Tools page, a customer's page and
 * an order's page all open this.
 */
type StaxJsT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
declare global { interface Window { StaxJs?: new (token: string, opts: Record<string, unknown>) => StaxJsT } }
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";
type Ctx = { customer: { id: string; name: string; company: string; no_card_fee: boolean; charge_split: boolean }; invoices: TPInvoice[]; methods: TPMethod[]; feePct: number };

export default function TakePaymentTool({ customerId: c0 = "", orderId = "", staxToken = "" }: { customerId?: string; orderId?: string; staxToken?: string }) {
  const [cid, setCid] = useState(c0), [cLabel, setCLabel] = useState("");
  const [ctx, setCtx] = useState<Ctx | null>(null), [err, setErr] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pm, setPm] = useState<string>(""); // a saved id, or "new"
  const [split, setSplit] = useState(false), [fee, setFee] = useState(true), [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false), [results, setResults] = useState<TPResult[] | null>(null);
  const [f, setF] = useState({ first: "", last: "", month: "", year: "" }), [bill, setBill] = useState(emptyBill());
  const stax = useRef<StaxJsT | null>(null), [ready, setReady] = useState(false);

  const load = (id: string) => {
    setErr(""); setResults(null); setCtx(null);
    if (!id) return;
    void paymentContext(id).then((r) => {
      if (!r.ok) return setErr(r.error);
      setCtx(r); setCLabel(r.customer.company || r.customer.name);
      setSplit(r.customer.charge_split); setFee(!r.customer.no_card_fee);
      // the order it was opened from, else everything owed
      setPick(new Set(orderId && r.invoices.some((o) => o.id === orderId) ? [orderId] : r.invoices.map((o) => o.id)));
      const ok = r.methods.find((m) => m.ok);
      setPm(ok ? ok.id : "new");
    });
  };
  useEffect(() => { load(cid); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stax's secure card fields, when a new card is typed in
  useEffect(() => {
    if (pm !== "new" || !staxToken || stax.current) return;
    let dead = false;
    const start = () => {
      if (dead || !window.StaxJs || stax.current) return;
      stax.current = new window.StaxJs(staxToken, {
        number: { id: "tpy-card-number", placeholder: "Card number", style: "height:34px;width:100%;font-size:16px;border:0;outline:0;", type: "text", format: "prettyFormat" },
        cvv: { id: "tpy-card-cvv", placeholder: "CVV", style: "height:34px;width:100%;font-size:16px;border:0;outline:0;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setErr("Couldn't load the secure card form. Refresh and try again."));
    };
    if (window.StaxJs) start();
    else { const el = document.createElement("script"); el.src = STAX_SRC; el.async = true; el.onload = start; document.head.appendChild(el); }
    return () => { dead = true; };
  }, [pm, staxToken]);

  const chosen = useMemo(() => (ctx?.invoices || []).filter((o) => pick.has(o.id)), [ctx, pick]);
  const saved = ctx?.methods.find((m) => m.id === pm);
  const isBank = saved?.method === "bank";
  const pct = !isBank && fee ? ctx?.feePct || 0 : 0;
  const sum = Math.round(chosen.reduce((a, o) => a + o.balance, 0) * 100) / 100;
  const groups = split ? chosen.map((o) => [o]) : chosen.length ? [chosen] : [];
  const feeOf = (n: number) => Math.round(n * pct) / 100;
  const total = Math.round(groups.reduce((a, g) => { const s = g.reduce((x, o) => x + o.balance, 0); return a + s + feeOf(s); }, 0) * 100) / 100;
  const owed = Math.round((ctx?.invoices || []).reduce((a, o) => a + o.balance, 0) * 100) / 100;

  const run = async () => {
    if (!ctx || !chosen.length) return setErr("Tick at least one invoice.");
    setErr(""); setBusy(true);
    let newPmId = "";
    if (pm === "new") {
      if (!stax.current || !ready) { setBusy(false); return setErr("The card form is still loading."); }
      if (!f.first.trim() || !f.last.trim()) { setBusy(false); return setErr("Enter the name on the card."); }
      if (!/^\d{1,2}$/.test(f.month) || !/^\d{2,4}$/.test(f.year)) { setBusy(false); return setErr("Enter the card's expiration month and year."); }
      const miss = billMissing(bill); if (miss) { setBusy(false); return setErr(miss); }
      try {
        const t = await stax.current.tokenize({ firstname: f.first.trim(), lastname: f.last.trim(), method: "card", month: f.month, year: f.year.length === 2 ? `20${f.year}` : f.year, total, match_customer: false, validate: false, ...staxAddress(bill) });
        newPmId = t.id;
      } catch (e) { setBusy(false); return setErr(staxReason(e) || "Check the card details and try again."); }
    }
    const r = await takePayment({ customerId: ctx.customer.id, orderIds: chosen.map((o) => o.id), savedId: pm !== "new" ? pm : undefined, newPmId: newPmId || undefined, newMethod: "card", split, fee: pct > 0, save: pm === "new" && keep });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setResults(r.results);
    // the statement again, without what's paid
    const again = await paymentContext(ctx.customer.id);
    if (again.ok) { setCtx(again); setPick(new Set()); }
  };

  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="tpy">
      <section className="panel tpy-left">
        <div className="panel-h"><h2>Take a payment</h2><span className="faint">Run a customer&apos;s card for their invoices</span></div>
        <div className="panel-b stack" style={{ gap: 12 }}>
          <div className="field"><label>Customer</label><CustomerPick field value={cid || null} label={cLabel} onPick={(id, l) => { setCid(id || ""); setCLabel(l); }} /></div>
          {err && !ctx && <div className="err">{err}</div>}
          {ctx && (ctx.invoices.length ? <>
            <div className="tpy-sum"><b>Open invoices</b><span className="faint">{ctx.invoices.length} open · {money(owed)} owed</span><span className="spacer" />
              <button type="button" className="linkbtn" onClick={() => setPick(pick.size === ctx.invoices.length ? new Set() : new Set(ctx.invoices.map((o) => o.id)))}>{pick.size === ctx.invoices.length ? "Clear" : "Select all"}</button></div>
            <div className="tbl-wrap"><table className="tbl tpy-t">
              <thead><tr><th aria-label="Pick" /><th>Invoice</th><th>Job</th><th>Due</th><th className="num">Balance</th></tr></thead>
              <tbody>{ctx.invoices.map((o) => (
                <tr key={o.id} className={pick.has(o.id) ? "on" : ""} onClick={() => toggle(o.id)}>
                  <td><input type="checkbox" checked={pick.has(o.id)} onChange={() => toggle(o.id)} onClick={(e) => e.stopPropagation()} aria-label={`Invoice ${o.number}`} /></td>
                  <td className="ordno">#{o.number}</td>
                  <td>{o.nickname || "Order"}{o.po_number ? <div className="sub">PO {o.po_number}</div> : null}{o.paid > 0.004 ? <div className="sub">{money(o.paid)} of {money(o.total)} paid</div> : null}</td>
                  <td className="nowrap">{o.pay_due ? fmtDate(o.pay_due) : "—"}</td>
                  <td className="num nowrap">{money(o.balance)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </> : <p className="faint" style={{ margin: 0 }}>Nothing is owed right now.</p>)}
          {results && (
            <div className="tpy-res" role="status">
              {results.map((r) => (
                <div key={r.orderIds.join()} className={r.ok ? "ok" : "bad"}>
                  <span>{r.ok ? "✓" : "!"}</span><span className="tpy-res-n">{r.numbers.map((n) => `#${n}`).join(", ")}</span>
                  <span className="nowrap">{r.ok ? `${money(r.amount + r.fee)}${r.ref ? ` · Ref ${r.ref.slice(0, 8)}` : ""}` : r.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {ctx && ctx.invoices.length > 0 && (
        <section className="panel tpy-right">
          <div className="panel-h"><h2>Charge</h2></div>
          <div className="panel-b stack" style={{ gap: 12 }}>
            <div className="tpy-pms" role="radiogroup" aria-label="Card">
              {ctx.methods.map((m) => (
                <label key={m.id} className={"tpy-pm" + (pm === m.id ? " on" : "") + (m.ok ? "" : " off")} title={m.ok ? undefined : "The customer hasn't OK'd us charging this one (their portal Settings)"}>
                  <input type="radio" name="tpy-pm" disabled={!m.ok} checked={pm === m.id} onChange={() => setPm(m.id)} />
                  <span><b>{m.method === "bank" ? `${m.brand || "Bank account"} ending ${m.last4}` : `${m.brand} ending ${m.last4}`}</b><small>{m.ok ? `On file · OK to charge when they ask${m.exp ? ` · exp ${m.exp}` : ""}` : "On file · not OK'd for us to charge"}{m.method === "bank" ? " · no card fee" : ""}</small></span>
                </label>
              ))}
              <label className={"tpy-pm" + (pm === "new" ? " on" : "")}>
                <input type="radio" name="tpy-pm" checked={pm === "new"} onChange={() => setPm("new")} />
                <span><b>New card</b><small>Type it in while they&apos;re on the phone</small></span>
              </label>
            </div>
            <div className="tpy-new" hidden={pm !== "new"}>
              <div className="grid g2">
                <div className="field"><label htmlFor="tpy-first">First name</label><input id="tpy-first" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
                <div className="field"><label htmlFor="tpy-last">Last name</label><input id="tpy-last" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
              </div>
              <div className="field"><label>Card number</label><div className="pp-stax" id="tpy-card-number" /></div>
              <div className="grid g3">
                <div className="field"><label htmlFor="tpy-mm">Exp. month</label><input id="tpy-mm" inputMode="numeric" placeholder="MM" maxLength={2} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></div>
                <div className="field"><label htmlFor="tpy-yy">Exp. year</label><input id="tpy-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></div>
                <div className="field"><label>CVV</label><div className="pp-stax" id="tpy-card-cvv" /></div>
              </div>
              <BillAddressFields v={bill} set={setBill} id="tpy-bl" />
              <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep it on file, OK to charge when they ask (they said so)</label>
              {!staxToken && <div className="err">Stax web payments aren&apos;t set up here.</div>}
            </div>

            <div>
              <div className="tpy-l">How to charge it</div>
              <div className="tpy-seg" role="radiogroup" aria-label="How to charge it">
                <button type="button" role="radio" aria-checked={!split} className={!split ? "on" : ""} onClick={() => { setSplit(false); void setPayOptions(ctx.customer.id, { charge_split: false }); }}>One charge</button>
                <button type="button" role="radio" aria-checked={split} className={split ? "on" : ""} onClick={() => { setSplit(true); void setPayOptions(ctx.customer.id, { charge_split: true }); }}>Each invoice separately</button>
              </div>
              <div className="faint tpy-hint">{split ? `${chosen.length} charge${chosen.length === 1 ? "" : "s"}, one per invoice, each with its own receipt.` : "One charge for everything ticked."} Remembered for this customer.</div>
            </div>

            {!isBank && (
              <label className="tpy-fee">
                <input type="checkbox" checked={fee} onChange={(e) => { setFee(e.target.checked); void setPayOptions(ctx.customer.id, { no_card_fee: !e.target.checked }); }} />
                <span>Card fee ({ctx.feePct}%)<small>{fee ? "Charged" : "Waived for this customer, here and in their portal"}</small></span>
              </label>
            )}

            <div className="tpy-tot">
              {groups.length > 1 ? groups.map((g) => <div key={g[0].id}><span>#{g[0].number}</span><b>{money(g[0].balance + feeOf(g[0].balance))}</b></div>)
                : <div><span>{chosen.length} invoice{chosen.length === 1 ? "" : "s"}</span><b>{money(sum)}</b></div>}
              {pct > 0 && groups.length <= 1 && <div><span>Card fee</span><b>{money(feeOf(sum))}</b></div>}
              <div className="tpy-grand"><span>Total</span><b>{money(total)}</b></div>
            </div>
            {err && ctx && <div className="err">{err}</div>}
            <button type="button" className="btn primary tpy-go" disabled={busy || !chosen.length || (!pm) || (pm === "new" && !ready)} onClick={() => void run()}>
              {busy ? "Charging…" : `Charge ${groups.length > 1 ? `${groups.length} invoices separately` : `${chosen.length} invoice${chosen.length === 1 ? "" : "s"}`} · ${money(total)}`}
            </button>
            <div className="faint tpy-hint" style={{ textAlign: "center" }}>Receipts go to whoever gets receipts at {ctx.customer.company || ctx.customer.name}.</div>
          </div>
        </section>
      )}
    </div>
  );
}
