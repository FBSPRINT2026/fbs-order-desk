"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LangToggle, useT } from "./lang";

/**
 * Scanned a job's QR code but not signed in on this phone yet: the crew signs in with their employee number and PIN
 * (the same as the employee app; it stays signed in for good while it's used); office staff can use their portal login.
 */
export default function JobSignIn({ code, offNetwork = false }: { code: string; offNetwork?: boolean }) {
  const router = useRouter();
  const { t } = useT();
  const [emp, setEmp] = useState(""), [pin, setPin] = useState(""), [pin2, setPin2] = useState(""), [field, setField] = useState<"emp" | "pin" | "pin2">("emp");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  // after the number: who it is, and whether they still make their PIN (the first time ever; Nov 13)
  const [who, setWho] = useState<{ name: string; hasPin: boolean } | null>(null);
  const ERR: Record<string, string> = { bad: "Wrong employee # or PIN.", locked: "Too many tries. Wait 5 minutes.", nopin: "You don't have a PIN yet. Ask a manager." };
  const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null); return { ok: !!r?.ok, j: r ? await r.json().catch(() => ({})) : { error: "Offline" } }; };
  async function next() {
    setBusy(true); setErr("");
    const { ok, j } = await post({ action: "who", code: emp });
    setBusy(false);
    if (!ok) return setErr(t("No employee with that number."));
    setWho(j); setField("pin");
  }
  async function go() {
    if (who && !who.hasPin && field === "pin") { setField("pin2"); return; }
    if (who && !who.hasPin && pin2 !== pin) { setPin2(""); setPin(""); setField("pin"); return setErr(t("The two PINs don't match. Make it again.")); }
    setBusy(true); setErr("");
    const { ok, j } = await post({ action: who && !who.hasPin ? "firstpin" : "login", code: emp, pin });
    setBusy(false); setPin(""); setPin2("");
    if (!ok) { if (who && !who.hasPin) setField("pin"); return setErr(t(ERR[j.error] || j.error || "Couldn't sign in.")); }
    router.refresh();
  }
  const val = field === "emp" ? emp : field === "pin" ? pin : pin2, set = field === "emp" ? setEmp : field === "pin" ? setPin : setPin2;
  if (offNetwork) return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" />{code ? <span className="jm-top-job">{t("Job #{0}", code.replace(/-.*/, ""))}</span> : <span className="jm-top-job">{t("Crew")}</span>}<LangToggle /></header>
      <main className="jm-main jm-signin">
        <h1>{t("Shop tools work on the FBS Wi-Fi")}</h1>
        <p>{t("You're signed in with your employee PIN, but this phone isn't on the shop's network. Connect to the FBS Wi-Fi and scan again.")}</p>
        <a className="jm-alt" href={`/login?next=${encodeURIComponent(code ? `/j/${code}` : "/crew")}`}>{t("Office staff: sign in with your portal login")}</a>
        {code && <a className="jm-alt" href={`/j/${code}?customer=1`}>{t("Customer? See your order")}</a>}
      </main>
    </div>
  );
  return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" />{code ? <span className="jm-top-job">{t("Job #{0}", code.replace(/-.*/, ""))}</span> : <span className="jm-top-job">{t("Crew")}</span>}<LangToggle /></header>
      <main className="jm-main jm-signin">
        <h1>{who ? t("Hi, {0}", who.name) : code ? t("Sign in to open this job") : t("Sign in")}</h1>
        <p>{!who ? t("Type your employee number. You only do this once on this phone.") : who.hasPin ? t("Now your PIN.") : field === "pin2" ? t("Type the same PIN again.") : t("First time: make your own PIN, 4 to 6 numbers you'll remember. It keeps anyone else from clocking in as you.")}</p>
        <div className="jm-fields">
          <button type="button" className={"jm-field" + (field === "emp" ? " on" : "")} onClick={() => { setWho(null); setPin(""); setPin2(""); setField("emp"); }}><span>{t("Employee #")}</span><b>{emp || "—"}</b></button>
          {who && <button type="button" className={"jm-field" + (field !== "emp" ? " on" : "")} onClick={() => setField("pin")}><span>{who.hasPin ? "PIN" : field === "pin2" ? t("PIN again") : t("New PIN")}</span><b>{(field === "pin2" ? pin2 : pin) ? "•".repeat((field === "pin2" ? pin2 : pin).length) : "—"}</b></button>}
        </div>
        {err && <div className="jm-err" role="alert">{err}</div>}
        <div className="jm-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "next"].map((k) => (
          <button key={k} type="button" className={k.length > 1 ? "fn" : ""} onClick={() => {
            if (k === "back") return set(val.slice(0, -1));
            if (k === "next") return field === "emp" ? next() : go();
            set((val + k).slice(0, 6));
          }} aria-label={k === "back" ? t("Delete") : k === "next" ? t("Next") : k}>{k === "back" ? "⌫" : k === "next" ? (field === "emp" ? "→" : "✓") : k}</button>
        ))}</div>
        {field === "emp" ? <button type="button" className="jm-go" disabled={!emp || busy} onClick={next}>{busy ? t("One moment…") : t("Next")}</button>
          : <button type="button" className="jm-go" disabled={(field === "pin2" ? pin2 : pin).length < 4 || busy} onClick={go}>{busy ? t("Signing in…") : who && !who.hasPin && field === "pin" ? t("Next") : t("Sign in")}</button>}
        <a className="jm-alt" href={`/login?next=${encodeURIComponent(code ? `/j/${code}` : "/crew")}`}>{t("Office staff: sign in with your portal login")}</a>
        {code && <a className="jm-alt" href={`/j/${code}?customer=1`}>{t("Customer? See your order")}</a>}
      </main>
    </div>
  );
}
