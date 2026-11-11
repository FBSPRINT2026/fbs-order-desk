"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useRole } from "@/components/RoleContext";
import { checkScreenPin, screenPinState, setScreenPin } from "@/app/shop/screen-pin-actions";

/** the pages that show pay: what each person makes, timecards, payroll */
const PAY_PAGES = ["/shop/time", "/shop/employees", "/shop/payroll"];
const IDLE_MS = 10 * 60_000;

/**
 * A PIN in front of the pay pages for anyone who runs the time clock from a shared shop computer (Nov 11, Nick: Jose stays
 * logged in; "someone shouldn't be able to go update the time clock if they're not Jose… have him create a pin").
 * Owner and admins sit at their own desks and aren't asked. The first visit makes the PIN; after that it's asked each
 * time one of these pages is opened, and again after 10 minutes without a click or key. Leaving the pages locks them.
 */
export default function ScreenPin() {
  const path = usePathname() || "";
  const { role, realRole, viewAs, perms } = useRole();
  const onPay = PAY_PAGES.some((p) => path === p || path.startsWith(p + "/"));
  const needs = onPay && !viewAs && realRole !== "owner" && role !== "admin" && perms.pay;
  const [open, setOpen] = useState(false);
  const [has, setHas] = useState<boolean | null>(null);
  const [pin, setPin] = useState(""), [pin2, setPin2] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const last = useRef(Date.now());

  // leaving the pay pages locks them again
  useEffect(() => { if (!onPay) setOpen(false); }, [onPay]);
  useEffect(() => { if (needs && has === null) screenPinState().then((r) => setHas(r.has)); }, [needs, has]);
  // 10 minutes without a click or key locks it
  useEffect(() => {
    if (!needs || !open) return;
    const poke = () => { last.current = Date.now(); };
    const t = setInterval(() => { if (Date.now() - last.current > IDLE_MS) setOpen(false); }, 15_000);
    ["pointerdown", "keydown", "wheel"].forEach((e) => window.addEventListener(e, poke, { passive: true }));
    return () => { clearInterval(t); ["pointerdown", "keydown", "wheel"].forEach((e) => window.removeEventListener(e, poke)); };
  }, [needs, open]);

  if (!needs || open) return null;
  const making = has === false;
  const go = async () => {
    setErr("");
    if (making && pin !== pin2) { setErr("The two PINs don't match."); return; }
    setBusy(true);
    const r = making ? await setScreenPin(pin) : await checkScreenPin(pin);
    setBusy(false);
    if (!r.ok) { setErr(("error" in r && r.error) || "Try again."); setPin(""); return; }
    if (making) setHas(true);
    setPin(""); setPin2(""); last.current = Date.now(); setOpen(true);
  };
  return (
    <div className="spn-bg" data-notranslate>
      <form className="spn-box" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div className="spn-ic" aria-hidden>🔒</div>
        <h2>{making ? "Make a PIN for pay screens" : "Enter your PIN"}</h2>
        <p className="faint">{making ? "Pay and timecards stay hidden until it's typed. 4 to 6 numbers." : "Pay and timecards are locked on this computer."}</p>
        {has === null ? <p className="faint">…</p> : <>
          <input className="spn-in" type="password" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" />
          {making && <input className="spn-in" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} placeholder="Again" />}
          {err && <div className="spn-err">{err}</div>}
          <button className="btn primary" type="submit" disabled={busy || pin.length < 4}>{making ? "Save PIN" : "Unlock"}</button>
          {!making && <p className="faint spn-f">Forgot it? Nick or Amanda can reset it.</p>}
        </>}
      </form>
    </div>
  );
}
