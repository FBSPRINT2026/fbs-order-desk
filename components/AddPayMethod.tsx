"use client";
import { useEffect, useRef, useState } from "react";
import { addSavedMethod } from "@/app/portal/pay-actions";

type StaxT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";

/**
 * Add a card or bank account in Settings without paying (Oct 24, Nick: "add new payment"). Stax's secure fields take
 * the numbers; we only keep Stax's id, the brand and the last 4. The authorization is shown right above Save.
 */
export default function AddPayMethod({ staxToken, consent, staffConsent, onDone, onCancel }: {
  staxToken: string; consent: { card: string; bank: string }; staffConsent: { card: string; bank: string }; onDone: () => void; onCancel: () => void;
}) {
  const [method, setMethod] = useState<"card" | "bank">("card");
  const [f, setF] = useState({ first: "", last: "", month: "", year: "", zip: "", routing: "", account: "", bankType: "checking", holder: "personal" });
  const [staffOk, setStaffOk] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ready, setReady] = useState(false);
  const stax = useRef<StaxT | null>(null);
  useEffect(() => {
    let dead = false;
    const W = window as unknown as { StaxJs?: new (t: string, o: Record<string, unknown>) => StaxT };
    const start = () => {
      if (dead || !W.StaxJs || stax.current) return;
      stax.current = new W.StaxJs(staxToken, {
        number: { id: "stax-add-number", placeholder: "Card number", style: "height:34px;width:100%;font-size:15px;border:0;outline:0;", type: "text", format: "prettyFormat" },
        cvv: { id: "stax-add-cvv", placeholder: "CVV", style: "height:34px;width:100%;font-size:15px;border:0;outline:0;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setErr("Couldn't load the secure card form. Refresh and try again."));
    };
    if (W.StaxJs) start();
    else { const el = document.createElement("script"); el.src = STAX_SRC; el.async = true; el.onload = start; el.onerror = () => setErr("Couldn't reach the payment service."); document.head.appendChild(el); }
    return () => { dead = true; };
  }, [staxToken]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setErr("");
    if (!stax.current) return setErr("The secure form is still loading.");
    if (!f.first.trim() || !f.last.trim()) return setErr("Enter the name on the account.");
    const d: Record<string, unknown> = { firstname: f.first.trim(), lastname: f.last.trim(), total: 1, match_customer: false, validate: false };
    if (method === "card") {
      if (!/^\d{1,2}$/.test(f.month) || !/^\d{2,4}$/.test(f.year)) return setErr("Enter the card's expiration month and year.");
      Object.assign(d, { method: "card", month: f.month, year: f.year.length === 2 ? `20${f.year}` : f.year, address_zip: f.zip });
    } else {
      if (!/^\d{9}$/.test(f.routing)) return setErr("The routing number should be 9 digits.");
      if (!/^\d{4,17}$/.test(f.account)) return setErr("Check the account number.");
      Object.assign(d, { method: "bank", bank_type: f.bankType, bank_holder_type: f.holder, bank_account: f.account, bank_routing: f.routing, person_name: `${f.first} ${f.last}`.trim() });
    }
    setBusy(true);
    try {
      const pm = await stax.current.tokenize(d);
      const r = await addSavedMethod({ paymentMethodId: pm.id, method, staffOk });
      if (!r.ok) throw new Error(r.error || "Couldn't save it.");
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message || "Couldn't save it.")); }
    setBusy(false);
  }
  return (
    <div className="apm">
      <div className="chips apm-tabs">{(["card", "bank"] as const).map((k) => <button key={k} type="button" className={"chip" + (method === k ? " on" : "")} onClick={() => setMethod(k)}>{k === "card" ? "Card" : "Bank account (ACH)"}</button>)}</div>
      <div className="grid g2">
        <div className="field"><label htmlFor="apm-f">First name</label><input id="apm-f" autoComplete="given-name" value={f.first} onChange={set("first")} /></div>
        <div className="field"><label htmlFor="apm-l">Last name</label><input id="apm-l" autoComplete="family-name" value={f.last} onChange={set("last")} /></div>
      </div>
      <div hidden={method !== "card"} className="stack" style={{ gap: 10 }}>
        <div className="field"><label>Card number</label><div className="pp-stax" id="stax-add-number" /></div>
        <div className="grid g3">
          <div className="field"><label htmlFor="apm-mm">Exp. month</label><input id="apm-mm" inputMode="numeric" placeholder="MM" maxLength={2} value={f.month} onChange={set("month")} /></div>
          <div className="field"><label htmlFor="apm-yy">Exp. year</label><input id="apm-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} value={f.year} onChange={set("year")} /></div>
          <div className="field"><label>CVV</label><div className="pp-stax" id="stax-add-cvv" /></div>
        </div>
        <div className="field" style={{ maxWidth: 180 }}><label htmlFor="apm-zip">Billing ZIP</label><input id="apm-zip" inputMode="numeric" autoComplete="postal-code" value={f.zip} onChange={set("zip")} /></div>
      </div>
      {method === "bank" && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid g2">
            <div className="field"><label htmlFor="apm-rt">Routing number</label><input id="apm-rt" inputMode="numeric" maxLength={9} value={f.routing} onChange={set("routing")} /></div>
            <div className="field"><label htmlFor="apm-ac">Account number</label><input id="apm-ac" inputMode="numeric" maxLength={17} value={f.account} onChange={set("account")} /></div>
          </div>
          <div className="grid g2">
            <div className="field"><label htmlFor="apm-bt">Account type</label><select id="apm-bt" value={f.bankType} onChange={set("bankType")}><option value="checking">Checking</option><option value="savings">Savings</option></select></div>
            <div className="field"><label htmlFor="apm-bh">Account holder</label><select id="apm-bh" value={f.holder} onChange={set("holder")}><option value="personal">Personal</option><option value="business">Business</option></select></div>
          </div>
        </div>
      )}
      <label className="check apm-ok"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>{consent[method]}</span></label>
      <label className="check apm-ok"><input type="checkbox" checked={staffOk} onChange={(e) => setStaffOk(e.target.checked)} /><span><b>Let FBS charge it when I ask</b> (optional). {staffConsent[method]}</span></label>
      {err && <div className="pv-err">{err}</div>}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !ok || (method === "card" && !ready)} onClick={() => void save()}>{busy ? "Saving…" : `Save ${method === "card" ? "card" : "bank account"}`}</button>
      </div>
    </div>
  );
}
