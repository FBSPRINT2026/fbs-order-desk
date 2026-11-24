"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ART = String.raw`
 ___  ___    _   ___ _____ ___ _   _ _  _ _  __
|   \| _ \  /_\ | __|_   _| _ \ | | | \| | |/ /
| |) |   / / _ \| _|  | | |  _/ |_| | .  | ' <
|___/|_|_\/_/ \_\_|   |_| |_|  \___/|_|\_|_|\_\
`;

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
    if (error) setErr(/signups? not allowed|not found/i.test(error.message) ? "THAT EMAIL ISN'T IN THE CLUB. ASK A CLUB ADMIN TO ADD YOU." : error.message.toUpperCase());
    else setSent(true);
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr("THAT CODE DIDN'T WORK. TRY AGAIN OR SEND A NEW ONE.");
    else router.refresh();
  };
  return (
    <div className="dp-door">
      <div className="dp-win">
        <span className="dp-wt">SYSTEM LOGIN</span>
        <pre aria-label="DraftPunk">{ART}</pre>
        <p>HOMEBREW RECIPE SYSTEM v1.0 · TEAM DRAFT PUNK</p>
        <p className="dp-dim">HOME OF THE 2017 NINKASI AWARD WINNERS</p>
        <p className="dp-dim">BUILD RECIPES · BREW THEM · LOG EVERY BATCH · SHARE THE GOOD ONES</p>
        {signedInAs ? (
          <p className="dp-red">{signedInAs.toUpperCase()} IS SIGNED IN BUT ISN&apos;T IN THE CLUB YET. ASK A CLUB ADMIN TO ADD YOU.</p>
        ) : !sent ? (
          <form onSubmit={send} className="dp-row" style={{ marginTop: 14 }}>
            <label className="dp-f" style={{ flex: "1 1 260px" }}><span>EMAIL&gt;</span>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button className="dp-btn dp-go" disabled={busy}>{busy ? "SENDING" : "SEND CODE"}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="dp-row" style={{ marginTop: 14 }}>
            <p style={{ flexBasis: "100%", margin: 0 }}>CODE SENT TO {email.toUpperCase()}. TYPE IT IN, OR TAP THE LINK IN THE EMAIL.</p>
            <label className="dp-f" style={{ flex: "1 1 160px" }}><span>CODE&gt;</span>
              <input inputMode="numeric" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
            </label>
            <button className="dp-btn dp-go" disabled={busy}>LOGIN</button>
            <button type="button" className="dp-btn" onClick={() => { setSent(false); setCode(""); }}>BACK</button>
          </form>
        )}
        {err && <p className="dp-red">{err}</p>}
        <p className="dp-dim" style={{ marginTop: 14 }}>READY.<span className="dp-blink">█</span></p>
      </div>
    </div>
  );
}
