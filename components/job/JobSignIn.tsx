"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Scanned a job's QR code but not signed in on this phone yet: the crew signs in with their employee number and PIN
 * (the same as the employee app, and it stays signed in for 120 days); office staff can use their portal login.
 */
export default function JobSignIn({ code, offNetwork = false }: { code: string; offNetwork?: boolean }) {
  const router = useRouter();
  const [emp, setEmp] = useState(""), [pin, setPin] = useState(""), [field, setField] = useState<"emp" | "pin">("emp");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ERR: Record<string, string> = { bad: "Wrong employee # or PIN.", locked: "Too many tries. Wait 5 minutes.", nopin: "You don't have a PIN yet. Ask a manager." };
  async function go() {
    setBusy(true); setErr("");
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", code: emp, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    setBusy(false); setPin("");
    if (!r?.ok) return setErr(ERR[j.error] || j.error || "Couldn't sign in.");
    router.refresh();
  }
  const val = field === "emp" ? emp : pin, set = field === "emp" ? setEmp : setPin;
  if (offNetwork) return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="jm-top-job">Job #{code.replace(/-.*/, "")}</span></header>
      <main className="jm-main jm-signin">
        <h1>Shop tools work on the FBS Wi-Fi</h1>
        <p>You&apos;re signed in with your employee PIN, but this phone isn&apos;t on the shop&apos;s network. Connect to the FBS Wi-Fi and scan again.</p>
        <a className="jm-alt" href={`/login?next=${encodeURIComponent(`/j/${code}`)}`}>Office staff: sign in with your portal login</a>
        <a className="jm-alt" href={`/j/${code}?customer=1`}>Customer? See your order</a>
      </main>
    </div>
  );
  return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="jm-top-job">Job #{code.replace(/-.*/, "")}</span></header>
      <main className="jm-main jm-signin">
        <h1>Sign in to open this job</h1>
        <p>Use your employee number and PIN, like the time app. This phone stays signed in.</p>
        <div className="jm-fields">
          <button type="button" className={"jm-field" + (field === "emp" ? " on" : "")} onClick={() => setField("emp")}><span>Employee #</span><b>{emp || "—"}</b></button>
          <button type="button" className={"jm-field" + (field === "pin" ? " on" : "")} onClick={() => setField("pin")}><span>PIN</span><b>{pin ? "•".repeat(pin.length) : "—"}</b></button>
        </div>
        {err && <div className="jm-err" role="alert">{err}</div>}
        <div className="jm-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "next"].map((k) => (
          <button key={k} type="button" className={k.length > 1 ? "fn" : ""} onClick={() => {
            if (k === "back") return set(val.slice(0, -1));
            if (k === "next") return field === "emp" ? setField("pin") : go();
            set((val + k).slice(0, 6));
          }} aria-label={k === "back" ? "Delete" : k === "next" ? "Next" : k}>{k === "back" ? "⌫" : k === "next" ? (field === "emp" ? "→" : "✓") : k}</button>
        ))}</div>
        <button type="button" className="jm-go" disabled={!emp || pin.length < 4 || busy} onClick={go}>{busy ? "Signing in…" : "Sign in"}</button>
        <a className="jm-alt" href={`/login?next=${encodeURIComponent(`/j/${code}`)}`}>Office staff: sign in with your portal login</a>
        <a className="jm-alt" href={`/j/${code}?customer=1`}>Customer? See your order</a>
      </main>
    </div>
  );
}
