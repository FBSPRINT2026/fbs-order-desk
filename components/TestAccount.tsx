"use client";
import { useState } from "react";

/**
 * The bar on a test account's page (ABC Test Company, XYZ Test Company…): one button that clears the account out on our
 * side so testing can start fresh (Nov 2, Nick: "just go under their account and clear all their stuff… put that back").
 * Every order, request and message is put away, never deleted. Shows only on accounts marked as test; owner / admin only.
 */
export default function TestAccount({ customerId, jobs, onChange }: { customerId: string; jobs: number; onChange: () => void }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [armed, setArmed] = useState(false);
  async function clear() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setArmed(false); setBusy(true); setMsg("");
    const r = await fetch("/api/test-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, action: "clear" }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || "That didn't work."); return; }
    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
    setMsg(`Cleared ${n(j.cleared || 0, "order")} and ${n(j.messages || 0, "message")}.`);
    onChange();
  }
  return (
    <div className="ta-bar on">
      <b>Test account</b>
      <span className="ta-note">Clear puts away every order, request and message here so you can start fresh. Nothing is deleted.</span>
      <span className="spacer" />
      <button type="button" className={"btn sm danger" + (armed ? " armed" : "")} disabled={busy} onClick={clear}>{busy ? "Clearing…" : armed ? "Yes, clear everything" : `Clear everything${jobs ? ` (${jobs})` : ""}`}</button>
      {msg && <span className="ta-msg">{msg}</span>}
    </div>
  );
}
