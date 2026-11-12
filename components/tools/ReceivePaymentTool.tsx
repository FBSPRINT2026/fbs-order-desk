"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import BillAddressFields from "@/components/BillAddressFields";
import MoneyField from "@/components/MoneyField";
import { billMissing, emptyBill, staxAddress } from "@/lib/billAddress";
import { staxReason } from "@/lib/staxReason";
import { fmtDate, money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { recordLumpPayment } from "@/app/shop/pay-actions";
import { decideRefund, findPayers, waitingOnPayment, type Waiting, paymentContext, pinInfo, receivedToday, savePin, setPayOptions, shopApplyCredit, shopCredit, shopRefundCredit, takePayment, type PayerHit, type TodayPay, type TPInvoice, type TPMethod, type TPResult } from "@/app/shop/take-payment-actions";

/**
 * Receive a payment (Nov 11, Nick; it was Take a Payment): one tool for every way money comes in.
 *  - "Run a customer's card… click the invoices, select the amount": the cards they OK'd us to charge, or a new one typed
 *    in on the phone (Stax's own fields), the card fee on or off, one charge or one per invoice, the person's PIN.
 *  - "I go to the mail every day and I get like 15 checks… I should just be able to quickly go: check came in, this
 *    customer paid these invoices, boom": Check / ACH / Cash recorded straight onto the invoices (one payment applied
 *    to each, as QuickBooks gets it), then the search is ready for the next one, and today's list grows underneath.
 * One search at the top finds a customer or an invoice # / PO, with what's owed. A long statement ("a customer has like
 * 50 invoices") is grouped by how late it is, with quick picks (past due, over 60 days) and "Pay an amount", which ticks
 * the oldest first and shows the one left partly paid. Old Printavo invoices are on it too: a check can pay them, a card
 * can't. Opened from the left menu, a customer's page and an order's page.
 */
type StaxJsT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
declare global { interface Window { StaxJs?: new (token: string, opts: Record<string, unknown>) => StaxJsT } }
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";
type Ctx = { customer: { id: string; name: string; company: string; no_card_fee: boolean; charge_split: boolean }; invoices: TPInvoice[]; methods: TPMethod[]; feePct: number };
// how it came in (Nov 11, Nick: "I got a payment from Alicia today via credit card. I don't need to run it"): a card we
// run here, or a payment that already happened somewhere else (a card through a Stax link or Square, a check, ACH, cash,
// Venmo / Zelle), recorded straight onto the invoices with nothing charged
type How = "card" | "cardx" | "check" | "ach" | "cash" | "app";
const HOW: [How, string][] = [["card", "Run a card"], ["cardx", "Card · already paid"], ["check", "Check"], ["ach", "ACH"], ["cash", "Cash"], ["app", "Venmo / Zelle"]];
const METHOD: Record<Exclude<How, "card">, string> = { cardx: "Card", check: "Check", ach: "ACH", cash: "Cash", app: "Venmo" };
const APPS = ["Venmo", "Zelle", "Cash App", "PayPal"];
const THROUGH = ["Stax link", "Square", "PayPal", "Their portal"];
const initials = (n: string) => (n.match(/\b[A-Za-z0-9]/g) || []).slice(0, 2).join("").toUpperCase() || "?";
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
/** days past due (negative: not due yet); no due date reads as 30 days after the invoice */
const lateBy = (o: TPInvoice) => {
  const due = o.pay_due || (o.created_at ? new Date(Date.parse(o.created_at) + 30 * 86400000).toISOString().slice(0, 10) : "");
  return due ? Math.floor((Date.parse(today()) - Date.parse(due.slice(0, 10))) / 86400000) : 0;
};
const BUCKETS: { k: string; label: string; has: (d: number) => boolean }[] = [
  { k: "60", label: "Over 60 days past due", has: (d) => d > 60 },
  { k: "30", label: "31–60 days past due", has: (d) => d > 30 && d <= 60 },
  { k: "1", label: "1–30 days past due", has: (d) => d > 0 && d <= 30 },
  { k: "0", label: "Not due yet", has: (d) => d <= 0 },
];

export default function ReceivePaymentTool({ customerId: c0 = "", orderId = "", staxToken = "" }: { customerId?: string; orderId?: string; staxToken?: string }) {
  const [cid, setCid] = useState(c0), [focusId, setFocusId] = useState(orderId);
  const [ctx, setCtx] = useState<Ctx | null>(null), [err, setErr] = useState("");
  const [q, setQ] = useState(""), [hits, setHits] = useState<PayerHit[] | null>(null), [hitAt, setHitAt] = useState(0);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [how, setHow] = useSticky<How>("pay.how", "check");
  const [find, setFind] = useState(""), [open, setOpen] = useState<Set<string>>(new Set()), [amtMode, setAmtMode] = useState(false), [payAmt, setPayAmt] = useState("");
  // check / ACH / cash
  const [amount, setAmount] = useState(""), [ref, setRef] = useState(""), [day, setDay] = useState(today());
  const [via, setVia] = useState(""), [app, setApp] = useState("Venmo");
  const [waiting, setWaiting] = useState<{ rows: Waiting[]; pastDue: number; owed: number } | null>(null);
  const [prev, setPrev] = useState<{ applied?: { number: number; amount: number; full: boolean }[]; error?: string } | null>(null);
  const [done, setDone] = useState(""), [todayRows, setTodayRows] = useState<TodayPay[]>([]);
  // card
  const [pm, setPm] = useState<string>("");
  const [split, setSplit] = useState(false), [fee, setFee] = useState(true), [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false), [results, setResults] = useState<TPResult[] | null>(null);
  const [f, setF] = useState({ first: "", last: "", month: "", year: "" }), [bill, setBill] = useState(emptyBill());
  const stax = useRef<StaxJsT | null>(null), [ready, setReady] = useState(false);
  const [pins, setPins] = useState<{ mine: boolean; owner: boolean; people: { email: string; name: string; has: boolean }[] } | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false), [pinAsk, setPinAsk] = useState(false), [pin, setPin] = useState(""), [pinErr, setPinErr] = useState("");
  // their credit (lib/credits.ts)
  const [cr, setCr] = useState<{ total: number; from: { id: string; number: number; credit: number }[]; pending: { id: string; order_id: string; amount: number; requested_by: string; requested_at: string }[] } | null>(null);
  const [crPin, setCrPin] = useState(""), [crAmt, setCrAmt] = useState(""), [crMsg, setCrMsg] = useState(""), [crBusy, setCrBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadPins = () => void pinInfo().then((r) => { if (r.ok) setPins(r); });
  const loadToday = () => void receivedToday().then((r) => { if (r.ok) setTodayRows(r.rows); });
  const loadWaiting = () => void waitingOnPayment().then((r) => { setWaiting(r.ok ? r : { rows: [], pastDue: 0, owed: 0 }); if (!r.ok) setErr(r.error); }).catch(() => setWaiting({ rows: [], pastDue: 0, owed: 0 }));
  useEffect(() => { loadPins(); loadToday(); loadWaiting(); }, []);

  const load = (id: string, focus = "") => {
    setErr(""); setResults(null); setCtx(null); setFind(""); setAmtMode(false); setPayAmt(""); setPrev(null); setRef("");
    if (!id) return;
    void paymentContext(id).then((r) => {
      if (!r.ok) return setErr(r.error);
      setCtx(r); void shopCredit(id).then((c) => { if (c.ok) setCr(c); });
      setSplit(r.customer.charge_split); setFee(!r.customer.no_card_fee);
      // nothing ticked (Nov 11, Nick: "by default… none should be checked"), except the invoice it was opened on or searched for
      setPick(new Set(focus && r.invoices.some((o) => o.id === focus) ? [focus] : []));
      const ok = r.methods.find((m) => m.ok);
      setPm(ok ? ok.id : "new");
    });
  };
  useEffect(() => { load(cid, focusId); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps

  // the search at the top: customers, and invoices by number or PO
  useEffect(() => {
    const t = q.trim();
    if (!t) { setHits(null); return; }
    const h = setTimeout(() => void findPayers(t).then((r) => { if (r.ok) { setHits(r.hits); setHitAt(0); } }), 220);
    return () => clearTimeout(h);
  }, [q]);
  const choose = (h: PayerHit) => {
    setQ(""); setHits(null);
    if (h.kind === "customer") { setFocusId(""); if (h.id === cid) load(h.id); else setCid(h.id); }
    else { setFocusId(h.id); if (h.customerId === cid) load(h.customerId, h.id); else setCid(h.customerId); }
  };

  // Stax's secure card fields, when a new card is typed in
  useEffect(() => {
    if (how !== "card" || pm !== "new" || !staxToken || stax.current) return;
    let dead = false;
    const start = () => {
      if (dead || !window.StaxJs || stax.current) return;
      stax.current = new window.StaxJs(staxToken, {
        number: { id: "rcv-card-number", placeholder: "Card number", style: "height:34px;width:100%;font-size:16px;border:0;outline:0;", type: "text", format: "prettyFormat" },
        cvv: { id: "rcv-card-cvv", placeholder: "CVV", style: "height:34px;width:100%;font-size:16px;border:0;outline:0;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setErr("Couldn't load the secure card form. Refresh and try again."));
    };
    if (window.StaxJs) start();
    else { const el = document.createElement("script"); el.src = STAX_SRC; el.async = true; el.onload = start; document.head.appendChild(el); }
    return () => { dead = true; };
  }, [how, pm, staxToken]);

  const inv = useMemo(() => ctx?.invoices || [], [ctx]);
  const owed = r2(inv.reduce((a, o) => a + o.balance, 0));
  const pastDue = r2(inv.filter((o) => lateBy(o) > 0).reduce((a, o) => a + o.balance, 0));
  const chosen = useMemo(() => inv.filter((o) => pick.has(o.id)), [inv, pick]);
  const pickedSum = r2(chosen.reduce((a, o) => a + o.balance, 0));
  // "Pay an amount": the oldest first, the last one partly
  const amtN = r2(+String(payAmt).replace(/[$,\s]/g, "") || 0);
  useEffect(() => {
    if (!amtMode || !(amtN > 0)) return;
    let left = amtN; const ids: string[] = [];
    for (const o of inv) { if (left <= 0.004) break; ids.push(o.id); left = r2(left - o.balance); }
    setPick(new Set(ids)); setAmount(amtN.toFixed(2));
  }, [amtMode, amtN, inv]);
  // the amount follows what's ticked (unless an amount is being paid)
  const pickKey = [...pick].sort().join(",");
  useEffect(() => { if (!amtMode) setAmount(pickedSum ? pickedSum.toFixed(2) : ""); }, [pickKey, amtMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const amountN = r2(+String(amount).replace(/[$,\s]/g, "") || 0);
  // where a check goes, before it's saved
  useEffect(() => {
    if (how === "card" || !ctx || !(amountN > 0) || !chosen.length) { setPrev(null); return; }
    const t = setTimeout(() => void recordLumpPayment(ctx.customer.id, { amount: amountN, method: how === "app" ? app : METHOD[how], paid_on: day, note: "", orderIds: chosen.map((o) => o.id), preview: true }).then(setPrev), 300);
    return () => clearTimeout(t);
  }, [how, amountN, pickKey, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = async () => {
    if (!ctx || how === "card") return;
    if (!chosen.length) return setErr("Tick the invoices it pays.");
    if (!(amountN > 0)) return setErr("Enter the amount received.");
    setErr(""); setBusy(true);
    const method = how === "app" ? app : METHOD[how];
    const label = how === "check" ? (ref.trim() ? `Check #${ref.trim()}` : "Check") : how === "ach" ? (ref.trim() ? `ACH ${ref.trim()}` : "ACH") : how === "cash" ? "Cash"
      : how === "cardx" ? ["Card", via.trim() ? `paid through ${via.trim()}` : "paid outside the portal", ref.trim()].filter(Boolean).join(" · ") : [app, ref.trim()].filter(Boolean).join(" · ");
    const r = await recordLumpPayment(ctx.customer.id, { amount: amountN, method, paid_on: day, note: label, orderIds: chosen.map((o) => o.id) });
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't record it.");
    setDone(`${money(amountN)} ${label.toLowerCase().startsWith("check") ? label : method} from ${ctx.customer.company || ctx.customer.name} recorded on ${(r.applied || []).map((a) => `#${a.number}`).join(", ")}.`);
    loadToday(); loadWaiting(); setVia("");
    // ready for the next one in the stack
    setCid(""); setCtx(null); setRef(""); setAmount(""); setPick(new Set()); setFocusId("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  // card
  const saved = ctx?.methods.find((m) => m.id === pm);
  const isBank = saved?.method === "bank";
  const cardable = chosen.filter((o) => !o.old);
  const pct = !isBank && fee ? ctx?.feePct || 0 : 0;
  const groups = split ? cardable.map((o) => [o]) : cardable.length ? [cardable] : [];
  const feeOf = (n: number) => Math.round(n * pct) / 100;
  const feeBase = (g: TPInvoice[]) => g.filter((o) => !((o.cardFeeIn || 0) > 0.004)).reduce((x, o) => x + o.balance, 0);
  const cardSum = r2(cardable.reduce((a, o) => a + o.balance, 0));
  const total = r2(groups.reduce((a, g) => a + g.reduce((x, o) => x + o.balance, 0) + feeOf(feeBase(g)), 0));
  const charge = async () => {
    if (!ctx || !cardable.length) return setErr("Tick at least one invoice.");
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
    const r = await takePayment({ customerId: ctx.customer.id, orderIds: cardable.map((o) => o.id), savedId: pm !== "new" ? pm : undefined, newPmId: newPmId || undefined, newMethod: "card", split, fee: pct > 0, save: pm === "new" && keep, pin });
    setBusy(false); setPin("");
    if (!r.ok) { if (r.pin) return setPinErr(r.error); setPinAsk(false); return setErr(r.error); }
    setPinAsk(false); setResults(r.results); loadToday(); loadWaiting();
    load(ctx.customer.id);
  };

  const toggle = (id: string) => { setAmtMode(false); setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const quick = (k: "all" | "late" | "60" | "none") => { setAmtMode(false); setPick(new Set(k === "none" ? [] : inv.filter((o) => k === "all" || (k === "late" ? lateBy(o) > 0 : lateBy(o) > 60)).map((o) => o.id))); };
  const fl = find.trim().toLowerCase().replace(/^#/, "");
  const shown = fl ? inv.filter((o) => `${o.number} ${o.nickname} ${o.po_number}`.toLowerCase().includes(fl)) : inv;
  const grouped = !fl && inv.length > 8;
  const partial = how !== "card" && prev?.applied?.find((a) => !a.full);

  const row = (o: TPInvoice) => {
    const d = lateBy(o);
    return (
      <label key={o.id} className={"rcv-inv" + (pick.has(o.id) ? " on" : "")}>
        <input type="checkbox" checked={pick.has(o.id)} onChange={() => toggle(o.id)} />
        <b className="ordno">#{o.number}</b>
        <span className="rcv-inv-n">{o.nickname || "Order"}{o.po_number ? <span className="faint"> · PO {o.po_number}</span> : null}
          <span className="faint"> · {d > 0 ? `${d} days late` : o.pay_due ? `due ${fmtDate(o.pay_due)}` : "not due yet"}</span>
          {o.paid > 0.004 && <span className="faint"> · {money(o.paid)} of {money(o.total)} paid</span>}{o.old && <span className="faint"> · Printavo</span>}</span>
        <b className="nowrap">{money(o.balance)}</b>
      </label>
    );
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Receive a Payment</h1><div className="eyebrow">Run a card, or record the checks, ACH and cash that came in</div></div>
        <div className="row" style={{ gap: 8 }}>{pins && <button type="button" className="btn" onClick={() => setPinsOpen(true)}>{pins.owner ? "Payment PINs" : pins.mine ? "Change my PIN" : "Set my PIN"}</button>}</div>
      </div>
      {pinsOpen && pins && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Payment PINs" onClick={() => setPinsOpen(false)}>
          <div className="dla tpy-pin" onClick={(e) => e.stopPropagation()}>
            <h3>{pins.owner ? "Payment PINs" : "Your payment PIN"}</h3>
            <p className="dla-sub">{pins.owner ? "Everyone who can take payments. Each types their own PIN at every card charge." : "4 to 8 numbers, typed at every card charge."}</p>
            {pins.owner ? pins.people.map((p) => <SetPin key={p.email} email={p.email} title={`${p.name}${p.has ? " · PIN set" : " · no PIN yet"}`} button={p.has ? "Change PIN" : "Set PIN"} onDone={loadPins} compact />)
              : <SetPin title={pins.mine ? "Change your PIN" : "Set your PIN"} onDone={() => { loadPins(); setPinsOpen(false); }} />}
            <div className="dla-acts"><button type="button" className="btn" onClick={() => setPinsOpen(false)}>Done</button></div>
          </div>
        </div>
      )}

      <div className="rcv2">
        <div className="rcv2-main">
          {/* one search: a customer, or an invoice # / PO */}
          <div className="rcv-search">
            <input ref={searchRef} type="search" autoFocus={!c0} value={q} placeholder="Customer, invoice # or PO" aria-label="Find a customer or invoice"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (!hits?.length) return; if (e.key === "ArrowDown") { e.preventDefault(); setHitAt((i) => Math.min(hits.length - 1, i + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setHitAt((i) => Math.max(0, i - 1)); } else if (e.key === "Enter") { e.preventDefault(); choose(hits[hitAt]); } else if (e.key === "Escape") setQ(""); }} />
            {hits && (
              <div className="rcv-hits" role="listbox">
                {hits.length ? hits.map((h, i) => (
                  <button key={h.kind + h.id} type="button" role="option" aria-selected={i === hitAt} className={i === hitAt ? "on" : ""} onMouseEnter={() => setHitAt(i)} onClick={() => choose(h)}>
                    {h.kind === "customer" ? <><span><b>{h.name}</b><span className="faint"> · {h.open ? `${h.open} open invoice${h.open === 1 ? "" : "s"}` : "nothing owed"}</span></span><b className="nowrap">{money(h.balance)}</b></>
                      : <><span><b>#{h.number}</b> {h.nickname}<span className="faint"> · {h.customer}</span></span><b className="nowrap">{h.balance > 0.004 ? money(h.balance) : "paid"}</b></>}
                  </button>
                )) : <div className="faint rcv-none">Nothing found</div>}
              </div>
            )}
          </div>
          {done && !ctx && <div className="rcv-done" role="status">✓ {done} <span className="faint">Next one?</span></div>}
          {err && !ctx && <div className="err">{err}</div>}
          {/* today at a glance (Nov 11, Nick: "received today should be a nice list of… total amount by customer") */}
          {(() => {
            const sum = (f: (r: TodayPay) => boolean) => r2(todayRows.filter(f).reduce((a, r) => a + r.amount, 0));
            const isCard = (r: TodayPay) => /card|visa|master|amex|discover|stax/i.test(`${r.method} ${r.note}`);
            const isBank = (r: TodayPay) => /check|ach/i.test(r.method);
            return (
              <div className="stats rcv2-stats">
                <div className="stat"><span className="v">{money(sum(() => true))}</span><span className="k">Received today</span></div>
                <div className="stat"><span className="v">{todayRows.length}</span><span className="k">Payments</span></div>
                <div className="stat"><span className="v">{money(sum(isCard))}</span><span className="k">By card</span></div>
                <div className="stat"><span className="v">{money(sum(isBank))}</span><span className="k">Check &amp; ACH</span></div>
                <div className="stat"><span className={"v" + ((waiting?.pastDue || 0) > 0 ? " alert" : "")}>{waiting ? money(waiting.pastDue) : "…"}</span><span className="k">Past due</span></div>
              </div>
            );
          })()}
          <section className="panel">
            <div className="panel-h"><h2>Received today</h2><span className="faint">by customer</span></div>
            <div className="panel-b rcv2-today">
              {!todayRows.length ? <div className="faint">Nothing received yet today. Each payment you record shows up here.</div> : (() => {
                const by = new Map<string, { name: string; id: string; amount: number; n: number; numbers: number[]; methods: Set<string> }>();
                for (const r of todayRows) {
                  const k = r.customerId || r.customer || "?";
                  const x = by.get(k) || { name: r.customer || "Customer", id: r.customerId || "", amount: 0, n: 0, numbers: [] as number[], methods: new Set<string>() };
                  x.amount = r2(x.amount + r.amount); x.n++; r.numbers.forEach((nn) => { if (!x.numbers.includes(nn)) x.numbers.push(nn); }); x.methods.add(r.method || "Payment");
                  by.set(k, x);
                }
                const list = [...by.values()].sort((a2, b2) => b2.amount - a2.amount);
                return <>
                  {list.map((x) => (
                    <button key={x.id || x.name} type="button" className="rcv2-tr" disabled={!x.id} onClick={() => { if (x.id) { setFocusId(""); if (x.id === cid) load(x.id); else setCid(x.id); } }} title={x.numbers.length ? x.numbers.map((nn) => `#${nn}`).join(", ") : undefined}>
                      <span className="rcv2-av" aria-hidden>{initials(x.name)}</span>
                      <span className="rcv2-tn"><b>{x.name}</b><span className="faint">{x.n} payment{x.n === 1 ? "" : "s"}{x.numbers.length ? ` · ${x.numbers.length} invoice${x.numbers.length === 1 ? "" : "s"}` : ""}</span></span>
                      <span className="rcv2-m">{[...x.methods].map((m) => <span key={m} className="rcv2-chip">{m}</span>)}</span>
                      <b className="nowrap">{money(x.amount)}</b>
                    </button>
                  ))}
                  <div className="rcv2-tt"><b>Total</b><b className="nowrap">{money(r2(todayRows.reduce((a2, r) => a2 + r.amount, 0)))}</b></div>
                </>;
              })()}
            </div>
          </section>
        </div>

        <aside className="panel rcv rcv2-side">
          <div className="panel-b rcv-b">
          {!ctx && !cid && <>
            <div className="rcv2-empty"><b>Pick a customer</b>Search on the left, or pick one waiting on payment.</div>
            <div className="rcv2-lab">Waiting on payment{waiting ? <span className="faint"> · {money(waiting.owed)} owed</span> : null}</div>
            {!waiting ? <div className="faint">Loading…</div> : !waiting.rows.length ? <div className="faint">Nobody owes anything right now.</div> : (
              <div className="rcv2-wait">{waiting.rows.slice(0, 12).map((w) => (
                <button key={w.id} type="button" className="rcv2-wr" onClick={() => { setFocusId(""); setCid(w.id); }}>
                  <span><b>{w.name}</b><span className="faint">{w.open} invoice{w.open === 1 ? "" : "s"}{w.late > 0 ? ` · ${w.late} days late` : ""}</span></span>
                  <b className={"nowrap" + (w.pastDue > 0 ? " rcv2-late" : "")}>{money(w.owed)}</b>
                </button>
              ))}</div>
            )}
          </>}
          {cid && !ctx && !err && <p className="faint" style={{ margin: 0 }}>Loading…</p>}
          {cid && !ctx && err && <div className="err">{err}</div>}
          {ctx && <>
            <div className="rcv-who">
              <div className="rcv2-cc"><span className="rcv2-av" aria-hidden>{initials(ctx.customer.company || ctx.customer.name)}</span><div><b>{ctx.customer.company || ctx.customer.name}</b>{ctx.customer.company && ctx.customer.name && ctx.customer.company !== ctx.customer.name ? <div className="faint">{ctx.customer.name}</div> : null}</div>
                <span className="rcv2-sp" /><a className="btn sm" href={`/shop/customers/${ctx.customer.id}`}>Customer</a><button type="button" className="btn sm" onClick={() => { setCid(""); setCtx(null); setFocusId(""); setTimeout(() => searchRef.current?.focus(), 30); }}>Change</button></div>
              <div className="stats rcv-stats">
                <button type="button" className="stat" onClick={() => quick("all")}><span className="v">{money(owed)}</span><span className="k">Balance</span></button>
                <button type="button" className="stat" onClick={() => quick("late")}><span className={"v" + (pastDue > 0 ? " alert" : "")}>{money(pastDue)}</span><span className="k">Past due</span></button>
                <button type="button" className="stat" onClick={() => quick("all")}><span className="v">{inv.length}</span><span className="k">Open invoices</span></button>
              </div>
            </div>

            {cr && (cr.total > 0.004 || cr.pending.length > 0) && (
              <div className="tpy-cr">
                {cr.total > 0.004 && <>
                  <div><b>Credit: {money(cr.total)}</b> <span className="faint">from {cr.from.map((x) => `#${x.number}`).join(", ")}</span></div>
                  <div className="tpy-cr-row">
                    <button type="button" className="btn sm" disabled={crBusy || !chosen.length} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await shopApplyCredit(ctx.customer.id, chosen.filter((o) => !o.old).map((o) => o.id)); setCrBusy(false); setCrMsg(r.ok ? `${money(r.applied)} of credit applied.` : r.error); load(ctx.customer.id); }}>Apply to the ticked invoices</button>
                    <span className="faint">or refund</span>
                    <input inputMode="decimal" placeholder={cr.total.toFixed(2)} value={crAmt} onChange={(e) => setCrAmt(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Refund amount" />
                    <input type="password" inputMode="numeric" placeholder="PIN" maxLength={8} value={crPin} onChange={(e) => setCrPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" />
                    <button type="button" className="btn sm" disabled={crBusy || crPin.length < 4} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await shopRefundCredit(ctx.customer.id, +(crAmt || cr.total), crPin); setCrBusy(false); setCrPin(""); setCrMsg(r.ok ? `${money(r.refunded)} refunded to the card it was paid with.` : r.error); if (r.ok) { setCrAmt(""); load(ctx.customer.id); } }}>Refund to their card</button>
                  </div>
                </>}
                {cr.pending.map((p) => (
                  <div key={p.id} className="tpy-rq">
                    <span style={{ flex: 1, minWidth: 180 }}><b>Refund pending: {money(+p.amount)}</b> <span className="faint">asked by {p.requested_by} · {fmtDate(p.requested_at.slice(0, 10))}</span></span>
                    <input type="password" inputMode="numeric" placeholder="PIN" maxLength={8} value={crPin} onChange={(e) => setCrPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" />
                    <button type="button" className="btn sm primary" disabled={crBusy || crPin.length < 4} onClick={async () => { setCrBusy(true); setCrMsg(""); const r = await decideRefund(p.id, true, crPin); setCrBusy(false); setCrPin(""); setCrMsg(r.ok ? `Refunded ${money(+p.amount)} to their card.` : r.error); load(ctx.customer.id); }}>Approve</button>
                    <button type="button" className="btn sm ghost" disabled={crBusy} onClick={async () => { const r = await decideRefund(p.id, false, ""); setCrMsg(r.ok ? "Declined. The credit stays on their account." : r.error); load(ctx.customer.id); }}>Decline</button>
                  </div>
                ))}
                {crMsg && <div className="faint" role="status">{crMsg}</div>}
              </div>
            )}

            {inv.length ? <>
              <div className="toolbar rcv-tools">
                <div className="chips">
                  <button type="button" className={"chip" + (!amtMode && pick.size === inv.length ? " on" : "")} onClick={() => quick("all")}>All</button>
                  <button type="button" className={"chip" + (!amtMode && pick.size > 0 && chosen.every((o) => lateBy(o) > 0) && chosen.length === inv.filter((o) => lateBy(o) > 0).length ? " on" : "")} onClick={() => quick("late")}>Past due</button>
                  {inv.some((o) => lateBy(o) > 60) && <button type="button" className="chip" onClick={() => quick("60")}>Over 60 days</button>}
                  <button type="button" className={"chip" + (!amtMode && !pick.size ? " on" : "")} onClick={() => quick("none")}>None</button>
                  <button type="button" className={"chip" + (amtMode ? " on" : "")} onClick={() => { setAmtMode(true); setPayAmt(""); }}>Pay an amount…</button>
                </div>
                {inv.length > 8 && <input type="search" className="rcv-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an invoice # or PO" aria-label="Find in their invoices" />}
              </div>
              {amtMode && (
                <div className="rcv-amt"><label>Amount paid<MoneyField value={payAmt} onChange={(e) => setPayAmt(e.target.value)} placeholder="0.00" autoFocus /></label>
                  <span className="faint">{amtN > 0 ? (amtN > owed + 0.004 ? `More than they owe (${money(owed)}).` : "Ticked oldest first; the last one is paid partly.") : "Ticks their invoices oldest first."}</span></div>
              )}
              <div className="rcv-list">
                {grouped ? BUCKETS.map((b) => {
                  const xs = shown.filter((o) => b.has(lateBy(o)));
                  if (!xs.length) return null;
                  const all = xs.every((o) => pick.has(o.id)), some = xs.some((o) => pick.has(o.id));
                  const isOpen = open.has(b.k) || (b.k !== "0" && xs.length <= 4);
                  const folded = b.k === "0" && !open.has(b.k);
                  const list = folded ? [] : isOpen ? xs : xs.slice(0, 4);
                  return (
                    <div key={b.k} className="rcv-grp">
                      <div className="rcv-gh">
                        <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={() => { setAmtMode(false); setPick((s) => { const n = new Set(s); xs.forEach((o) => (all ? n.delete(o.id) : n.add(o.id))); return n; }); }} aria-label={`Pick ${b.label}`} />
                        <b>{b.label}</b><span className="faint">{xs.length} invoice{xs.length === 1 ? "" : "s"}</span>
                        <b className="nowrap rcv-gsum">{money(r2(xs.reduce((a, o) => a + o.balance, 0)))}</b>
                        {(folded || xs.length > 4) && <button type="button" className="linkbtn" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(b.k)) n.delete(b.k); else n.add(b.k); return n; })}>{folded ? "Show" : isOpen ? "Fewer" : `All ${xs.length}`}</button>}
                      </div>
                      {list.map(row)}
                      {!folded && !isOpen && xs.length > 4 && <button type="button" className="rcv-more" onClick={() => setOpen((s) => new Set(s).add(b.k))}>+ {xs.length - 4} more</button>}
                    </div>
                  );
                }) : shown.length ? shown.map(row) : <div className="faint rcv-none">No invoice matches “{find}”.</div>}
              </div>

              {/* how it was paid */}
              <div className="rcv-seg" role="radiogroup" aria-label="How they paid">
                {HOW.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={how === k} className={how === k ? "on" : ""} onClick={() => setHow(k)}>{l}</button>)}
              </div>

              {how !== "card" ? <>
                <div className="rcv-fields">
                  <label>Amount<MoneyField value={amount} onChange={(e) => { setAmount(e.target.value); }} placeholder="0.00" /></label>
                  {how === "cardx" && <label>Paid through<input list="rcv-through" value={via} onChange={(e) => setVia(e.target.value.slice(0, 40))} placeholder="Stax link, Square…" /><datalist id="rcv-through">{THROUGH.map((t) => <option key={t} value={t} />)}</datalist></label>}
                  {how === "app" && <label>Paid with<select value={app} onChange={(e) => setApp(e.target.value)}>{APPS.map((x) => <option key={x}>{x}</option>)}</select></label>}
                  {how !== "cash" && <label>{how === "check" ? "Check #" : "Reference"}<input value={ref} onChange={(e) => setRef(e.target.value.slice(0, 40))} placeholder={how === "check" ? "" : how === "cardx" ? "Last 4 or receipt #" : "Optional"} /></label>}
                  <label>Received<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
                </div>
                {(how === "cardx" || how === "app") && <div className="faint rcv2-note">Recorded only: nothing is charged here.</div>}
                <div className="rcv-go">
                  <span className="faint">{!chosen.length ? "Tick the invoices it pays." : prev?.error ? <span className="err-inline">{prev.error}</span> : prev?.applied ? `Pays ${prev.applied.filter((a) => a.full).length ? prev.applied.filter((a) => a.full).map((a) => `#${a.number}`).join(", ") + " in full" : ""}${partial ? `${prev.applied.some((a) => a.full) ? "; " : ""}#${partial.number} partly (${money(partial.amount)})` : ""}` : `${chosen.length} invoice${chosen.length === 1 ? "" : "s"} · ${money(pickedSum)}`}</span>
                  <button type="button" className="btn primary" disabled={busy || !chosen.length || !(amountN > 0) || !!prev?.error} onClick={() => void record()}>{busy ? "Recording…" : `Record ${amountN > 0 ? money(amountN) : ""}`}</button>
                </div>
              </> : <>
                <div className="tpy-pms" role="radiogroup" aria-label="Card">
                  {ctx.methods.map((m) => (
                    <label key={m.id} className={"tpy-pm" + (pm === m.id ? " on" : "") + (m.ok ? "" : " off")} title={m.ok ? undefined : "The customer hasn't OK'd us charging this one (their portal Settings)"}>
                      <input type="radio" name="rcv-pm" disabled={!m.ok} checked={pm === m.id} onChange={() => setPm(m.id)} />
                      <span><b>{m.method === "bank" ? `${m.brand || "Bank account"} ending ${m.last4}` : `${m.brand} ending ${m.last4}`}</b><small>{m.ok ? `On file · OK to charge${m.exp ? ` · exp ${m.exp}` : ""}` : "On file · not OK'd for us to charge"}{m.method === "bank" ? " · no card fee" : ""}</small></span>
                    </label>
                  ))}
                  <label className={"tpy-pm" + (pm === "new" ? " on" : "")}><input type="radio" name="rcv-pm" checked={pm === "new"} onChange={() => setPm("new")} /><span><b>New card</b><small>Type it in while they&apos;re on the phone</small></span></label>
                </div>
                <div className="tpy-new" hidden={pm !== "new"}>
                  <div className="grid g2">
                    <div className="field"><label htmlFor="rcv-first">First name</label><input id="rcv-first" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
                    <div className="field"><label htmlFor="rcv-last">Last name</label><input id="rcv-last" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
                  </div>
                  <div className="field"><label>Card number</label><div className="pp-stax" id="rcv-card-number" /></div>
                  <div className="grid g3">
                    <div className="field"><label htmlFor="rcv-mm">Exp. month</label><input id="rcv-mm" inputMode="numeric" placeholder="MM" maxLength={2} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></div>
                    <div className="field"><label htmlFor="rcv-yy">Exp. year</label><input id="rcv-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></div>
                    <div className="field"><label>CVV</label><div className="pp-stax" id="rcv-card-cvv" /></div>
                  </div>
                  <BillAddressFields v={bill} set={setBill} id="rcv-bl" />
                  <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep it on file, OK to charge when they ask (they said so)</label>
                  {!staxToken && <div className="err">Stax web payments aren&apos;t set up here.</div>}
                </div>
                <div className="rcv-cardopts">
                  {!isBank && <label className="check"><input type="checkbox" checked={fee} onChange={(e) => { setFee(e.target.checked); void setPayOptions(ctx.customer.id, { no_card_fee: !e.target.checked }); }} /> Card fee ({ctx.feePct}%){!fee && <span className="faint"> · waived for this customer</span>}</label>}
                  {cardable.length > 1 && <label className="check"><input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); void setPayOptions(ctx.customer.id, { charge_split: e.target.checked }); }} /> One charge per invoice</label>}
                </div>
                {chosen.length > cardable.length && <div className="faint" style={{ fontSize: 12.5 }}>{chosen.length - cardable.length} old Printavo invoice{chosen.length - cardable.length === 1 ? "" : "s"} ticked: a card can&apos;t pay {chosen.length - cardable.length === 1 ? "it" : "them"} here (a check can).</div>}
                {amtMode && <div className="faint" style={{ fontSize: 12.5 }}>A card pays the ticked invoices in full.</div>}
                <div className="rcv-go">
                  <span className="faint">{cardable.length ? `${cardable.length} invoice${cardable.length === 1 ? "" : "s"} ${money(cardSum)}${pct > 0 ? ` + fee ${money(r2(total - cardSum))}` : ""}` : "Tick the invoices to charge."}</span>
                  <button type="button" className="btn primary" disabled={busy || !cardable.length || !pm || (pm === "new" && !ready) || !pins?.mine} onClick={() => { setPin(""); setPinErr(""); setPinAsk(true); }}>{busy ? "Charging…" : `Charge ${money(total)}`}</button>
                </div>
                {pins && !pins.mine && <SetPin title="Set your payment PIN first" sub="4 to 8 numbers. You'll type it every time you charge a card." onDone={loadPins} />}
              </>}
              {err && <div className="err">{err}</div>}
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
            </> : <p className="faint" style={{ margin: 0 }}>Nothing is owed right now.</p>}
          </>}
          </div>
        </aside>
      </div>

      {pinAsk && ctx && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Enter your PIN" onClick={() => !busy && setPinAsk(false)}>
          <form className="dla tpy-pin" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void charge(); }}>
            <h3>Enter your PIN to charge {money(total)}</h3>
            <p className="dla-sub">{ctx.customer.company || ctx.customer.name} · {groups.length > 1 ? `${groups.length} charges, one per invoice` : `${cardable.length} invoice${cardable.length === 1 ? "" : "s"}`}</p>
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinErr(""); }} aria-label="PIN" placeholder="PIN" />
            {pinErr && <div className="err">{pinErr}</div>}
            <div className="dla-acts"><button type="button" className="btn ghost" disabled={busy} onClick={() => setPinAsk(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy || pin.length < 4}>{busy ? "Charging…" : `Charge ${money(total)}`}</button></div>
          </form>
        </div>
      )}
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
