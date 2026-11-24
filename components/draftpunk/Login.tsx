"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * DraftPunk's own sign-in: a club member's email gets a code (and a link) from the same sign-in system as the portal.
 * Only people a club admin has added can get one (shouldCreateUser off), and signing in lands back here, never in the
 * shop or the customer portal.
 */
export default function Login({ signedInAs }: { signedInAs?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/draftpunk` } });
    setBusy(false);
    if (error) setErr(/signups? not allowed|not found/i.test(error.message) ? "That email isn't in the club yet. Ask a club admin to add you." : error.message);
    else setSent(true);
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr("That code didn't work. Try again, or send a new one.");
    else router.refresh();
  };
  return (
    <div className="dp-door">
      <div className="dp-door-art">
        <div>
          <span className="dp-award">★ Home of the 2017 Ninkasi Award winners</span>
          <h1>Draft<br />Punk</h1>
          <p>Build recipes, brew them, log every batch, and share the good ones with the club.</p>
        </div>
      </div>
      <div className="dp-door-form">
        <div>
          <h2 className="dp-h1" style={{ fontSize: 32 }}>Sign in</h2>
          {signedInAs ? (
            <>
              <p className="dp-red">{signedInAs} is signed in but isn&apos;t in the club yet. Ask a club admin to add you.</p>
              <button className="dp-btn" onClick={async () => { await createClient().auth.signOut(); router.refresh(); }}>Use another email</button>
            </>
          ) : !sent ? (
            <form onSubmit={send} style={{ display: "grid", gap: 12 }}>
              <label className="dp-f"><span>Email</span>
                <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
              </label>
              <button className="dp-btn dp-go" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
              <p className="dp-dim" style={{ margin: 0, fontSize: 13 }}>Club members only. No password: we email you a code.</p>
            </form>
          ) : (
            <form onSubmit={verify} style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0 }}>We sent a code to <b>{email}</b>. Type it in, or tap the link in the email.</p>
              <label className="dp-f"><span>Code</span>
                <input inputMode="numeric" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
              </label>
              <button className="dp-btn dp-go" disabled={busy}>Sign in</button>
              <button type="button" className="dp-btn" onClick={() => { setSent(false); setCode(""); }}>Back</button>
            </form>
          )}
          {err && <p className="dp-red">{err}</p>}
        </div>
      </div>
    </div>
  );
}
