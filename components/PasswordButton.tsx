"use client";
/**
 * Set a password (staff, Oct 22 2026, Nick: "is there a way we can just do a regular password to get into our accounts?
 * …it's a pain… I have to always go into my email and check it and then do the code"). Each person sets their own, here
 * in the shop menu by Sign out; after that the sign-in page takes email + password. The emailed code still works, so a
 * forgotten password is never a lock-out. Customers stay on codes (Nick: staff only).
 * If Supabase wants proof it's really you before a password change, it emails a code and this asks for it.
 */
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PasswordButton() {
  const sb = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState(false);

  const reset = () => { setPw(""); setPw2(""); setCode(""); setNeedCode(false); setErr(""); setDone(false); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser(needCode ? { password: pw, nonce: code.trim() } : { password: pw });
    if (error && !needCode && /reauth|nonce/i.test(error.message)) {
      const r = await sb.auth.reauthenticate();
      setBusy(false);
      if (r.error) { setErr(r.error.message); return; }
      setNeedCode(true);
      return;
    }
    setBusy(false);
    if (error) { setErr(/same|different/i.test(error.message) ? "That's already your password." : /weak|short|length/i.test(error.message) ? "That password is too easy to guess. Try a longer one." : needCode ? "That code didn't work. Check the newest email." : error.message); return; }
    setDone(true);
    setTimeout(() => { setOpen(false); reset(); }, 2200);
  }

  return (
    <>
      <button type="button" className="nav-support" onClick={() => { reset(); setOpen(true); }} data-tip="Set a password" aria-label="Set a password for signing in">
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M17 6l3 3M15 8l2 2" /></svg>
        <span className="lbl-t">Set a password</span>
      </button>
      {open && (
        <div className="sup-back" role="dialog" aria-modal="true" aria-label="Set a password">
          <form className="sup-box" onSubmit={save}>
            <h3>Set a password</h3>
            {done ? <p className="sep-ok">Saved. Next time, sign in with your email and this password.</p> : <>
              <p className="faint" style={{ margin: 0 }}>Sign in with your email and this password instead of waiting for a code. The emailed code still works if you forget it. Let your browser save it, and Windows Hello or Face ID can fill it in for you.</p>
              <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
              <div className="field"><label htmlFor="pw-again">Type it again</label><input id="pw-again" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
              {needCode && <div className="field"><label htmlFor="pw-code">We emailed you a code to confirm it&apos;s you</label><input id="pw-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>}
              {err && <div className="pv-err">{err}</div>}
              <div className="ibx2-send">
                <button type="submit" className="btn primary" disabled={busy || !pw || !pw2 || (needCode && code.length < 6)}>{busy ? "Saving…" : "Save password"}</button>
                <span className="spacer" />
                <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </>}
          </form>
        </div>
      )}
    </>
  );
}
