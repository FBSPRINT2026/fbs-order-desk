"use client";
import { SITE_URL } from "@/lib/config";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { emailOnFile } from "@/app/login/actions";

export default function LoginForm({ shopName, logoUrl, sideLogoUrl = "", next, linkError, onShop = false }: { shopName: string; logoUrl: string; /** the light logo for a dark bar, the same as the portal's top bar */ sideLogoUrl?: string; next: string; linkError: boolean; /** on the shop's network: the employee and shop computer sign-ins show */ onShop?: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  // staff can sign in with a password they set in the shop menu (Oct 22, Nick); customers keep the emailed code
  const staff = /@fbsprint\.com$/i.test(email.trim());
  const [stage, setStage] = useState<"email" | "code" | "station">("email");
  // a shop computer (lib/stations.ts; Nov 13): its name and the shop computer PIN
  const [stName, setStName] = useState(""), [stPin, setStPin] = useState("");
  async function stationIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await fetch("/api/station/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: stName, pin: stPin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy(false);
    if (!r?.ok) { setErr(j.error || "Couldn't sign in."); return; }
    location.href = j.to || "/shop";
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError ? "That sign-in link expired or was already used. Enter your email to get a new one." : "");
  const safeNext = next.startsWith("/") ? next : "/";

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    if (staff && password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      setBusy(false);
      if (error) setErr(error.message.includes("rate") ? "Too many tries. Wait a minute, then try again." : "That email and password didn't match. No password yet? Leave it empty and we'll email you a code.");
      else { router.replace(safeNext); router.refresh(); }
      return;
    }
    // an email we don't have says so, instead of "check your email" for a code that can't let them in (Nov 2, Nick)
    if (!(await emailOnFile(email).catch(() => true))) {
      setBusy(false);
      setErr(`We don't have ${email.trim()} on file. Check it for a typo, or contact ${shopName} to get set up.`);
      return;
    }
    const site = SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${site}/auth/confirm?next=${encodeURIComponent(safeNext)}` },
    });
    setBusy(false);
    if (error) setErr(error.message.includes("rate") ? "Too many tries. Wait a minute, then try again." : error.message);
    else setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr("That code didn't work. Check the newest email, or send a new code.");
    else {
      router.replace(safeNext);
      router.refresh();
    }
  }

  return (
    <div className="auth-card">
      {/* the portal's own look at the door (Nov 2, launch day): its logo on the dark bar with the color line under it */}
      {sideLogoUrl ? <div className="auth-brand"><img src={sideLogoUrl} alt={shopName} /><span>Customer portal</span></div>
        : logoUrl ? <img src={logoUrl} alt={shopName} style={{ maxHeight: 48, width: "auto", alignSelf: "flex-start" }} /> : <div className="shopname">{shopName}</div>}
      {stage === "station" ? (
        <form onSubmit={stationIn} className="stack">
          <div>
            <h1>Shop Computer</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>The computer&apos;s name and the shop computer PIN. Works on the shop&apos;s network only.</p>
          </div>
          <div className="field">
            <label htmlFor="stname">Computer</label>
            <input id="stname" list="stnames" required autoComplete="username" value={stName} onChange={(e) => setStName(e.target.value)} placeholder="FBS-REC" />
            <datalist id="stnames"><option value="FBS-REC" /><option value="FBS-PRESS" /><option value="FBS-SHIP" /><option value="FBS-PO" /></datalist>
          </div>
          <div className="field">
            <label htmlFor="stpin">PIN</label>
            <input id="stpin" type="password" inputMode="numeric" required autoComplete="current-password" value={stPin} onChange={(e) => setStPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy || stPin.length < 4 || !stName.trim()} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
          <button className="btn ghost" type="button" onClick={() => { setStage("email"); setErr(""); }}>Back to email sign-in</button>
        </form>
      ) : stage === "email" ? (
        <form onSubmit={sendCode} className="stack">
          <div>
            <h1>Sign In</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>Enter the email we have on file for you. {staff ? "Type your password, or leave it empty and we'll email you a code." : <>We&apos;ll email you a sign-in link and a code. No password needed.</>}</p>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {staff && (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Empty: email me a code" />
            </div>
          )}
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy} type="submit">{busy ? (staff && password ? "Signing in…" : "Sending…") : staff && password ? "Sign in" : "Email me a sign-in code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <div>
            <h1>Check Your Email</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>We sent a code to <b>{email}</b>. Type the code here{typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone) ? " (the link in the email opens Safari, not this app)" : ", or click the link in the email"}. Use one or the other: each email works once.</p>
          </div>
          <div className="field">
            <label htmlFor="code">Code from the email</label>
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy || code.length < 6} type="submit">{busy ? "Checking…" : "Sign in"}</button>
          <button className="btn ghost" type="button" onClick={() => { setStage("email"); setCode(""); }}>Use a different email</button>
        </form>
      )}
      {/* a crew phone that landed here (an old Home Screen icon): their own sign-in is the employee number (Nov 13) */}
      {/* the shop's own sign-ins, only on the shop's network (Nick, Nov 13 2026, option A): an "At the shop" line, two buttons */}
      {onShop && stage !== "station" && <>
        <div className="auth-shop-sep">At the shop</div>
        <div className="auth-shop">
          <a href="/crew"><svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></svg>Shop employee</a>
          <button type="button" onClick={() => { setStage("station"); setErr(""); }}><svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>Shop computer</button>
        </div>
      </>}
    </div>
  );
}
