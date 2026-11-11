"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CustomerPick from "@/components/CustomerPick";
import BillAddressFields from "@/components/BillAddressFields";
import { billMissing, emptyBill, staxAddress } from "@/lib/billAddress";
import { staxReason } from "@/lib/staxReason";
import { fmtDate, money } from "@/lib/format";
import { decideRefund, paymentContext, pinInfo, savePin, setPayOptions, shopApplyCredit, shopCredit, shopRefundCredit, takePayment, type TPInvoice, type TPMethod, type TPResult } from "@/app/shop/take-payment-actions";

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
  // the PIN (Nov 3, Nick: "once you hit go, you have to put in the PIN"): asked for at every charge
  const [pins, setPins] = useState<{ mine: boolean; owner: boolean; people: { email: string; name: string; has: boolean }[] } | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  // their credit (lib/credits.ts): put it on the ticked invoices, refund it, and refunds waiting for approval
  const [cr, setCr] = useState<{ total: number; from: { id: string; number: number; credit: number }[]; pending: { id: string; order_id: string; amount: number; requested_by: string; requested_at: string }[] } | null>(null);
  const [crPin, setCrPin] = useState(""), [crAmt, setCrAmt] = useState(""), [crMsg, setCrMsg] = useState(""), [crBusy, setCrBusy] = useState(false);
  const loadCr = (id: string) => void shopCredit(id).then((r) => { if (r.ok) setCr(r); });
  const [pinAsk, setPinAsk] = useState(false), [pin, setPin] = useState(""), [pinErr, setPinErr] = useState("");
  const loadPins = () => void pinInfo().then((r) => { if (r.ok) setPins(r); });
  useEffect(loadPins, []);

  const load = (id: string) => {
    setErr(""); setResults(null); setCtx(null);
    if (!id) return;
    void paymentContext(id).then((r0) => {
      let r = r0;
      if (!r.ok) return setErr(r.error);
      r = { ...r, invoices: r.invoices.filter((o) => !o.old) };
      setCtx(r); setCLabel(r.customer.company || r.customer.name); loadCr(id);
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
  // no second card fee on an invoice that already has one (lib/cardFeeIn.ts; Nov 4, Nick)
  const feeBase = (g: TPInvoice[]) => g.filter((o) => !((o.cardFeeIn || 0) > 0.004)).reduce((x, o) => x + o.balance, 0);
  const already = chosen.filter((o) => (o.cardFeeIn || 0) > 0.004).length;
  const total = Math.round(groups.reduce((a, g) => { const s = g.reduce((x, o) => x + o.balance, 0); return a + s + feeOf(feeBase(g)); }, 0) * 100) / 100;
  const owed = Math.round((ctx?.invoices || []).reduce((a, o) => a + o.balance, 0) * 100) / 100;

  const run = async () => {
    if (!ctx || !chosen.length) return setErr("Tick at least one invoice.");
    if (!/^\d{4,8}$/.test(pin)) return setPinErr("Enter your PIN.");
    setErr(""); setPinErr(""); setBusy(true);
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
    const r = await takePayment({ customerId: ctx.customer.id, orderIds: chosen.map((o) => o.id), savedId: pm !== "new" ? pm : undefined, newPmId: newPmId || undefined, newMethod: "card", split, fee: pct > 0, save: pm === "new" && keep, pin });
    setBusy(false); setPin("");
    if (!r.ok) { if (r.pin) return setPinErr(r.error); setPinAsk(false); return setErr(r.error); }
    setPinAsk(false);
    setResults(r.results);
    // the statement again, without what's paid
    const again = await paymentContext(ctx.customer.id);
    if (again.ok) { setCtx(again); setPick(new Set()); }
  };

  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="stack">
    {/* the page's top: the title, and the PINs at the far right (Nov 3, Nick: "all the way to the right… set the pin") */}
    <div className="page-head">
      <div><h1>Take a Payment</h1><div className="eyebrow">Run a customer&apos;s card for their open invoices: one charge, or one per invoice</div></div>
      <div className="row" style={{ gap: 8 }}>{pins && <button type="button" className="btn" onClick={() => setPinsOpen(true)}>{pins.owner ? "Payment PINs" : pins.mine ? "Change my PIN" : "Set my PIN"}</button>}</div>
    </div>
    {pinsOpen && pins && (
      <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Payment PINs" onClick={() => setPinsOpen(false)}>
        <div className="dla tpy-pin" onClick={(e) => e.stopPropagation()}>
          <h3>{pins.owner ? "Payment PINs" : "Your payment PIN"}</h3>
          <p className="dla-sub">{pins.owner ? "Everyone who can take payments. Each types their own PIN at every charge." : "4 to 8 numbers, typed at every charge."}</p>
          {pins.owner ? pins.people.map((p) => <SetPin key={p.email} email={p.email} title={`${p.name}${p.has ? " · PIN set" : " · no PIN yet"}`} button={p.has ? "Change PIN" : "Set PIN"} onDone={loadPins} compact />)
            : <SetPin title={pins.mine ? "Change your PIN" : "Set your PIN"} onDone={() => { loadPins(); setPinsOpen(false); }} />}
          <div className="dla-acts"><button type="button" className="btn" onClick={() => setPinsOpen(false)}>Done</button></div>
        </div>
      </div>
    )}
    <div className="tpy">
      <section className="panel tpy-left">
        <div className="panel-h"><h2>Customer</h2><span className="faint">Their open invoices</span></div>
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
          {cr && (cr.total > 0.004 || cr.pending.length > 0) && ctx && (
            <div className="tpy-cr">
              {cr.total > 0.004 && <>
                <div><b>Credit: {money(cr.total)}</b> <span className="faint">from {cr.from.map((x) => `#${x.number}`).join(", ")}</span></div>
                <div className="tpy-cr-row">
                  <button type="button" className="btn sm" disabled={crBusy || !chosen.length} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await shopApplyCredit(ctx.customer.id, chosen.map((o) => o.id)); setCrBusy(false); setCrMsg(r.ok ? `${money(r.applied)} of credit applied.` : r.error); load(ctx.customer.id); }}>Apply to the ticked invoices</button>
                  <span className="faint">or refund</span>
                  <input inputMode="decimal" placeholder={cr.total.toFixed(2)} value={crAmt} onChange={(e) => setCrAmt(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Refund amount" />
                  <input type="password" inputMode="numeric" placeholder="PIN" maxLength={8} value={crPin} onChange={(e) => setCrPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" />
                  <button type="button" className="btn sm" disabled={crBusy || crPin.length < 4} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await shopRefundCredit(ctx.customer.id, +(crAmt || cr.total), crPin); setCrBusy(false); setCrPin(""); setCrMsg(r.ok ? `${money(r.refunded)} refunded to the card it was paid with.` : r.error); if (r.ok) { setCrAmt(""); load(ctx.customer.id); } }}>Refund to their card</button>
                </div>
              </>}
              {cr.pending.map((q) => (
                <div key={q.id} className="tpy-rq">
                  <span style={{ flex: 1, minWidth: 180 }}><b>Refund pending: {money(+q.amount)}</b> <span className="faint">asked by {q.requested_by} · {fmtDate(q.requested_at.slice(0, 10))}</span></span>
                  <input type="password" inputMode="numeric" placeholder="PIN" maxLength={8} value={crPin} onChange={(e) => setCrPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" />
                  <button type="button" className="btn sm primary" disabled={crBusy || crPin.length < 4} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await decideRefund(q.id, true, crPin); setCrBusy(false); setCrPin(""); setCrMsg(r.ok ? `Refunded ${money(+q.amount)} to their card.` : r.error); load(ctx.customer.id); }}>Approve</button>
                  <button type="button" className="btn sm ghost" disabled={crBusy} onClick={async () => { const r = await decideRefund(q.id, false, ""); setCrMsg(r.ok ? "Declined. The credit stays on their account." : r.error); load(ctx.customer.id); }}>Decline</button>
                </div>
              ))}
              {crMsg && <div className="faint" role="status">{crMsg}</div>}
            </div>
          )}
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

      {pinAsk && ctx && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Enter your PIN" onClick={() => !busy && setPinAsk(false)}>
          <form className="dla tpy-pin" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void run(); }}>
            <h3>Enter your PIN to charge {money(total)}</h3>
            <p className="dla-sub">{ctx.customer.company || ctx.customer.name} · {groups.length > 1 ? `${groups.length} charges, one per invoice` : `${chosen.length} invoice${chosen.length === 1 ? "" : "s"}`}</p>
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinErr(""); }} aria-label="PIN" placeholder="PIN" />
            {pinErr && <div className="err">{pinErr}</div>}
            <div className="dla-acts"><button type="button" className="btn ghost" disabled={busy} onClick={() => setPinAsk(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy || pin.length < 4}>{busy ? "Charging…" : `Charge ${money(total)}`}</button></div>
          </form>
        </div>
      )}
      <section className="panel tpy-right">
          <div className="panel-h"><h2>Charge</h2></div>
          {!ctx || !ctx.invoices.length ? <div className="panel-b faint">{!ctx ? "Pick a customer to see their cards and what's owed." : "Nothing to charge: they don't owe anything."}</div> : (
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
              {groups.length > 1 ? groups.map((g) => <div key={g[0].id}><span>#{g[0].number}</span><b>{money(g[0].balance + feeOf(feeBase(g)))}</b></div>)
                : <div><span>{chosen.length} invoice{chosen.length === 1 ? "" : "s"}</span><b>{money(sum)}</b></div>}
              {pct > 0 && groups.length <= 1 && <div><span>Card fee{already ? ` (${already} already ${already === 1 ? "has" : "have"} it)` : ""}</span><b>{money(feeOf(feeBase(chosen)))}</b></div>}
              <div className="tpy-grand"><span>Total</span><b>{money(total)}</b></div>
            </div>
            {err && ctx && <div className="err">{err}</div>}
            {pins && !pins.mine && <SetPin title="Set your payment PIN first" sub="4 to 8 numbers. You'll type it every time you charge a card." onDone={loadPins} />}
            <button type="button" className="btn primary tpy-go" disabled={busy || !chosen.length || (!pm) || (pm === "new" && !ready) || !pins?.mine} onClick={() => { setPin(""); setPinErr(""); setPinAsk(true); }}>
              {busy ? "Charging…" : `Charge ${groups.length > 1 ? `${groups.length} invoices separately` : `${chosen.length} invoice${chosen.length === 1 ? "" : "s"}`} · ${money(total)}`}
            </button>
            <div className="faint tpy-hint" style={{ textAlign: "center" }}>Receipts go to whoever gets receipts at {ctx.customer.company || ctx.customer.name}.</div>
          </div>)}
        </section>
    </div>
    </div>
  );
}

/** a PIN set (yours, or the owner setting someone's): typed twice, never shown */
function SetPin({ email, title, sub, button = "Save PIN", onDone, compact = false }: { email?: string; title: string; sub?: string; button?: string; onDone: () => void; compact?: boolean }) {
  const [a, setA] = useState(""), [b, setB] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState(!compact);
  const save = async () => {
    if (!/^\d{4,8}$/.test(a)) return setMsg("4 to 8 numbers.");
    if (a !== b) return setMsg("The two don't match.");
    setBusy(true); const r = await savePin({ email, pin: a }); setBusy(false);
    if (!r.ok) return setMsg(r.error);
    setA(""); setB(""); setMsg("Saved."); if (compact) setOpen(false); onDone();
  };
  const num = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  return (
    <div className="tpy-setpin">
      <div className="tpy-setpin-h"><b>{title}</b>{compact && !open && <button type="button" className="btn sm" onClick={() => { setOpen(true); setMsg(""); }}>{button}</button>}</div>
      {sub && <div className="faint" style={{ fontSize: 12 }}>{sub}</div>}
      {open && <div className="tpy-setpin-f">
        <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN" aria-label="New PIN" value={a} onChange={(e) => { setA(num(e.target.value)); setMsg(""); }} />
        <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="Again" aria-label="New PIN again" value={b} onChange={(e) => { setB(num(e.target.value)); setMsg(""); }} />
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : button}</button>
        {compact && <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>}
      </div>}
      {msg && <div className="faint" style={{ fontSize: 12 }}>{msg}</div>}
    </div>
  );
}
