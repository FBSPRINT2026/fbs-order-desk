"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { payOrders, sentPaymentNotice } from "@/app/portal/pay-actions";

export type PayItem = { id: string; number: number; nickname: string; balance: number; deposit?: number; quote?: boolean };
type Method = "card" | "bank" | "Zelle" | "Venmo";
type StaxJsT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
declare global { interface Window { StaxJs?: new (token: string, opts: Record<string, unknown>) => StaxJsT } }

const r2 = (n: number) => Math.round(n * 100) / 100;
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";

/**
 * Pay one order or several together: credit card (with the card fee), ACH bank transfer, Zelle or Venmo.
 * Card and bank numbers go into Stax's own secure fields; we only get back a one-time token to charge.
 */
export default function PayPanel({ items, pay, staxToken, canAct = true, onClose }: {
  items: PayItem[];
  pay: { cardFeePct: number; zelle: string; venmo: string };
  staxToken: string;
  canAct?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const single = items.length === 1 ? items[0] : null;
  const [kind, setKind] = useState<"deposit" | "balance">(single?.deposit && single.deposit < single.balance - 0.004 ? "deposit" : "balance");
  const [method, setMethod] = useState<Method>("card");
  const [f, setF] = useState({ first: "", last: "", month: "", year: "", zip: "", routing: "", account: "", bankType: "checking", holder: "personal", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const stax = useRef<StaxJsT | null>(null);

  const sum = r2(items.reduce((a, it) => a + (single && kind === "deposit" && it.deposit ? it.deposit : it.balance), 0));
  const fee = method === "card" ? r2((sum * pay.cardFeePct) / 100) : 0;
  const total = r2(sum + fee);
  const online = !!staxToken;

  // load Stax.js and its secure card fields once
  useEffect(() => {
    if (!online) return;
    let dead = false;
    const start = () => {
      if (dead || !window.StaxJs || stax.current) return;
      stax.current = new window.StaxJs(staxToken, {
        number: { id: "stax-card-number", placeholder: "Card number", style: "height:34px;width:100%;font-size:15px;border:0;outline:0;", type: "text", format: "prettyFormat" },
        cvv: { id: "stax-card-cvv", placeholder: "CVV", style: "height:34px;width:100%;font-size:15px;border:0;outline:0;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setMsg({ ok: false, text: "Couldn't load the secure card form. Refresh and try again." }));
    };
    if (window.StaxJs) start();
    else {
      const el = document.createElement("script");
      el.src = STAX_SRC; el.async = true; el.onload = start;
      el.onerror = () => setMsg({ ok: false, text: "Couldn't reach the payment service. Check your connection and try again." });
      document.head.appendChild(el);
    }
    return () => { dead = true; };
  }, [online, staxToken]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const itemsReq = items.map((it) => ({ orderId: it.id, kind: single && kind === "deposit" ? ("deposit" as const) : ("balance" as const) }));

  async function submit() {
    setMsg(null);
    if (method === "Zelle" || method === "Venmo") {
      setBusy(true);
      const r = await sentPaymentNotice({ items: itemsReq, method, note: f.note });
      setBusy(false);
      if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't send that." });
      setMsg({ ok: true, text: `Thanks! We'll confirm your ${method} payment of ${money(r.paid)} and mark it paid.` });
      return router.refresh();
    }
    if (!stax.current) return setMsg({ ok: false, text: "The secure payment form is still loading." });
    if (!f.first.trim() || !f.last.trim()) return setMsg({ ok: false, text: "Enter the name on the account." });
    const details: Record<string, unknown> = { firstname: f.first.trim(), lastname: f.last.trim(), total, match_customer: false, validate: false };
    if (method === "card") {
      if (!/^\d{1,2}$/.test(f.month) || !/^\d{2,4}$/.test(f.year)) return setMsg({ ok: false, text: "Enter the card's expiration month and year." });
      Object.assign(details, { method: "card", month: f.month, year: f.year.length === 2 ? `20${f.year}` : f.year, address_zip: f.zip });
    } else {
      if (!/^\d{9}$/.test(f.routing)) return setMsg({ ok: false, text: "The routing number should be 9 digits." });
      if (!/^\d{4,17}$/.test(f.account)) return setMsg({ ok: false, text: "Check the account number." });
      Object.assign(details, { method: "bank", bank_type: f.bankType, bank_holder_type: f.holder, bank_account: f.account, bank_routing: f.routing, person_name: `${f.first} ${f.last}`.trim() });
    }
    setBusy(true);
    try {
      const pm = await stax.current.tokenize(details);
      const r = await payOrders({ items: itemsReq, method: method === "card" ? "card" : "bank", paymentMethodId: pm.id });
      if (!r.ok) setMsg({ ok: false, text: r.error || "The payment didn't go through." });
      else { setMsg({ ok: true, text: `Payment of ${money(r.paid)} received. Thank you!` }); router.refresh(); }
    } catch (e) {
      const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Check your payment details and try again.";
      setMsg({ ok: false, text: m });
    }
    setBusy(false);
  }

  const done = msg?.ok;
  return (
    <div className="pay-panel">
      <div className="pp-h"><b>{items.length > 1 ? `Pay ${items.length} orders together` : `Pay order #${single?.number}`}</b>{onClose && <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button>}</div>

      {single && single.deposit && single.deposit < single.balance - 0.004 ? (
        <div className="pp-amt">
          <label className={kind === "deposit" ? "on" : ""}><input type="radio" name="pp-kind" checked={kind === "deposit"} onChange={() => setKind("deposit")} /> Deposit <b>{money(single.deposit)}</b></label>
          <label className={kind === "balance" ? "on" : ""}><input type="radio" name="pp-kind" checked={kind === "balance"} onChange={() => setKind("balance")} /> Full balance <b>{money(single.balance)}</b></label>
        </div>
      ) : items.length > 1 ? (
        <div className="pp-list">{items.map((it) => <div key={it.id}><span>#{it.number} {it.nickname}</span><b className="num">{money(it.balance)}</b></div>)}</div>
      ) : null}

      {items.some((it) => it.quote) && (method === "card" || method === "bank") && <div className="pp-note">Paying {items.filter((it) => it.quote).map((it) => `quote #${it.number}`).join(", ")} approves {items.filter((it) => it.quote).length > 1 ? "them" : "it"} and our terms, so we can get started.</div>}
      <div className="pp-methods" role="tablist" aria-label="How do you want to pay?">
        {([["card", "Credit card"], ["bank", "ACH bank transfer"], ["Zelle", "Zelle"], ["Venmo", "Venmo"]] as [Method, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} className={"pp-m" + (method === k ? " on" : "")} onClick={() => { setMethod(k); setMsg(null); }}>{label}</button>
        ))}
      </div>

      {(method === "card" || method === "bank") && !online && <div className="pp-note">Online card and bank payments are being set up. Please pay by Zelle or Venmo, or contact us.</div>}

      {/* Stax's secure card fields stay mounted so the form only loads once */}
      <div className="pp-form" hidden={!(online && (method === "card" || method === "bank"))}>
        <div className="grid g2">
          <div className="field"><label htmlFor="pp-first">First name</label><input id="pp-first" autoComplete="given-name" value={f.first} onChange={set("first")} /></div>
          <div className="field"><label htmlFor="pp-last">Last name</label><input id="pp-last" autoComplete="family-name" value={f.last} onChange={set("last")} /></div>
        </div>
        <div hidden={method !== "card"} className="stack" style={{ gap: 10 }}>
          <div className="field"><label>Card number</label><div className="pp-stax" id="stax-card-number" /></div>
          <div className="grid g3">
            <div className="field"><label htmlFor="pp-mm">Exp. month</label><input id="pp-mm" inputMode="numeric" placeholder="MM" maxLength={2} value={f.month} onChange={set("month")} /></div>
            <div className="field"><label htmlFor="pp-yy">Exp. year</label><input id="pp-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} value={f.year} onChange={set("year")} /></div>
            <div className="field"><label>CVV</label><div className="pp-stax" id="stax-card-cvv" /></div>
          </div>
          <div className="field" style={{ maxWidth: 180 }}><label htmlFor="pp-zip">Billing ZIP</label><input id="pp-zip" inputMode="numeric" autoComplete="postal-code" value={f.zip} onChange={set("zip")} /></div>
        </div>
        {method === "bank" && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="grid g2">
              <div className="field"><label htmlFor="pp-rt">Routing number</label><input id="pp-rt" inputMode="numeric" maxLength={9} value={f.routing} onChange={set("routing")} /></div>
              <div className="field"><label htmlFor="pp-ac">Account number</label><input id="pp-ac" inputMode="numeric" maxLength={17} value={f.account} onChange={set("account")} /></div>
            </div>
            <div className="grid g2">
              <div className="field"><label htmlFor="pp-bt">Account type</label><select id="pp-bt" value={f.bankType} onChange={set("bankType")}><option value="checking">Checking</option><option value="savings">Savings</option></select></div>
              <div className="field"><label htmlFor="pp-bh">Account holder</label><select id="pp-bh" value={f.holder} onChange={set("holder")}><option value="personal">Personal</option><option value="business">Business</option></select></div>
            </div>
          </div>
        )}
        {!ready && <div className="faint" style={{ fontSize: 12 }}>Loading the secure payment form…</div>}
      </div>

      {(method === "Zelle" || method === "Venmo") && (
        <div className="pp-form">
          <div className="pp-note">
            {method === "Zelle"
              ? pay.zelle ? <>Send <b>{money(total)}</b> by Zelle to <b>{pay.zelle}</b>. Put your order number{items.length > 1 ? "s" : ""} in the memo.</> : "Ask us for our Zelle details."
              : pay.venmo ? <>Send <b>{money(total)}</b> on Venmo to <b>{pay.venmo}</b>. Put your order number{items.length > 1 ? "s" : ""} in the note.</> : "Ask us for our Venmo details."}
          </div>
          <div className="field"><label htmlFor="pp-note">Anything we should know? (optional)</label><textarea id="pp-note" rows={2} value={f.note} onChange={set("note")} placeholder={`e.g. sent from ${method === "Venmo" ? "@myhandle" : "my business account"}`} /></div>
        </div>
      )}

      <div className="pp-sum">
        <div><span>{items.length > 1 ? `${items.length} orders` : single && kind === "deposit" ? "Deposit" : "Balance"}</span><b className="num">{money(sum)}</b></div>
        {method === "card" && <div className="pp-fee"><span>Credit card fee ({pay.cardFeePct}%)</span><b className="num">{money(fee)}</b></div>}
        <div className="pp-total"><span>Total</span><b className="num">{money(total)}</b></div>
        {method === "card" && <div className="faint" style={{ fontSize: 12 }}>A {pay.cardFeePct}% fee applies to credit card payments. Pay by ACH, Zelle or Venmo to avoid it.</div>}
      </div>

      {msg && <div className={msg.ok ? "okmsg" : "banner"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      {!done && (
        <button type="button" className="btn primary pp-go" disabled={!canAct || busy || sum <= 0 || ((method === "card" || method === "bank") && (!online || !ready))} onClick={submit}>
          {busy ? "Working…" : method === "Zelle" || method === "Venmo" ? `I sent ${money(total)} by ${method}` : `Pay ${money(total)}`}
        </button>
      )}
      {!canAct && <div className="faint" style={{ fontSize: 12 }}>Payments are turned off in the preview.</div>}
    </div>
  );
}
