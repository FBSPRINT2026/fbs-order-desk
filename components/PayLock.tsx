"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hidePay, showPay, usePayShown } from "@/lib/payLock";
import { payPinCheck, payPinSet, payPinState } from "@/app/shop/pay-lock-actions";

/**
 * Show pay / Hide pay, and the PIN pop-up behind it (Nick, Nov 16 2026). Everyone types their own PIN; the first time,
 * they make one. lib/payLock.ts keeps it shown in this tab until 10 minutes go by untouched.
 */
export function PayButton({ className = "btn" }: { className?: string }) {
  const on = usePayShown();
  const [ask, setAsk] = useState(false);
  return <>
    <button type="button" className={className} onClick={() => (on ? hidePay() : setAsk(true))} title={on ? "Hide pay figures again" : "Type your PIN to see pay figures"}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {on ? <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
          : <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>}
      </svg>
      <span>{on ? "Hide pay" : "Show pay"}</span>
    </button>
    {ask && <PinAsk onClose={() => setAsk(false)} />}
  </>;
}

/** a page or section that's all pay (the Payroll Center, the Payroll Report): a cover with Show pay until it's shown */
export function PayCover({ children, what = "Pay figures" }: { children: ReactNode; what?: string }) {
  const on = usePayShown();
  if (on) return <>{children}</>;
  return (
    <div className="payl-cover">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      <b>{what} are hidden</b>
      <span>Type your PIN to see them. They hide again after 10 minutes untouched.</span>
      <PayButton className="btn primary" />
    </div>
  );
}

function PinAsk({ onClose }: { onClose: () => void }) {
  const [has, setHas] = useState<boolean | null>(null), [change, setChange] = useState(false);
  const [pin, setPin] = useState(""), [pin2, setPin2] = useState(""), [old, setOld] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { void payPinState().then((r) => { setHas(r.ok ? !!r.has : false); if (!r.ok) setErr(r.error || ""); }); }, []);
  useEffect(() => { box.current?.focus(); }, [has, change]);
  const making = has === false || change;
  async function go() {
    if (busy) return;
    setErr("");
    if (making) {
      if (!/^\d{4,6}$/.test(pin)) return setErr("Use 4 to 6 numbers.");
      if (pin !== pin2) return setErr("The two PINs don't match.");
      setBusy(true); const r = await payPinSet(pin, change ? old : undefined); setBusy(false);
      if (!r.ok) return setErr(r.error || "Couldn't save.");
      showPay(); onClose(); return;
    }
    setBusy(true); const r = await payPinCheck(pin); setBusy(false);
    if (!r.ok) { setPin(""); return setErr(r.error || "That's not your PIN."); }
    showPay(); onClose();
  }
  const field = (v: string, set: (s: string) => void, label: string, first = false) => (
    <label className="payl-f"><span>{label}</span>
      <input ref={first ? box : undefined} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={v} onChange={(e) => set(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void go(); if (e.key === "Escape") onClose(); }} />
    </label>
  );
  return (
    <div className="payl-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="payl-pop" role="dialog" aria-modal="true" aria-label="Show pay">
        <h2>{making ? (change ? "Change your pay PIN" : "Make your pay PIN") : "Show pay"}</h2>
        <p className="faint">{making ? "Your own PIN for seeing pay. 4 to 6 numbers; only you know it." : "Type your PIN."}</p>
        {has === null ? <p className="faint">…</p> : making ? <>
          {change && field(old, setOld, "Current PIN", true)}
          {field(pin, setPin, "New PIN", !change)}
          {field(pin2, setPin2, "Again")}
        </> : field(pin, setPin, "PIN", true)}
        {err && <p className="bad">{err}</p>}
        <div className="payl-b">
          {has && !change && <button type="button" className="btn ghost sm" onClick={() => { setChange(true); setErr(""); setPin(""); }}>Change my PIN</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || has === null} onClick={() => void go()}>{busy ? "…" : making ? "Save and show" : "Show"}</button>
        </div>
      </div>
    </div>
  );
}
