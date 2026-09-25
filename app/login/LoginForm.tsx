"use client";
import { SITE_URL } from "@/lib/config";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ shopName, logoUrl, next, linkError }: { shopName: string; logoUrl: string; next: string; linkError: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError ? "That sign-in link expired or was already used. Enter your email to get a new one." : "");
  const safeNext = next.startsWith("/") ? next : "/";

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
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
      {logoUrl ? <img src={logoUrl} alt={shopName} style={{ maxHeight: 48, width: "auto", alignSelf: "flex-start" }} /> : <div className="shopname">{shopName}</div>}
      {stage === "email" ? (
        <form onSubmit={sendCode} className="stack">
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>Enter the email we have on file for you. We&apos;ll send a sign-in link and a 6-digit code. No password needed.</p>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy} type="submit">{busy ? "Sending…" : "Email me a sign-in code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <div>
            <h1>Check your email</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>We sent a code to <b>{email}</b>. Click the link in the email, or type the code here.</p>
          </div>
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" disabled={busy || code.length < 6} type="submit">{busy ? "Checking…" : "Sign in"}</button>
          <button className="btn ghost" type="button" onClick={() => { setStage("email"); setCode(""); }}>Use a different email</button>
        </form>
      )}
    </div>
  );
}
