"use client";
import { useState } from "react";

/**
 * Test account switch on a customer's page (e.g. "ABC Test Company"). When on: add sample jobs (a mix of screen print,
 * embroidery and DTF, due over the next few weeks, about half booked on the production calendar) or clear every job
 * on the account so testing can start fresh. Only works on accounts marked as test; owner / admin only.
 */
export default function TestAccount({ customerId, isTest, jobs, onChange }: { customerId: string; isTest: boolean; jobs: number; onChange: (isTest?: boolean) => void }) {
  const [on, setOn] = useState(isTest);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [armed, setArmed] = useState(false);
  async function call(body: Record<string, unknown>, label: string) {
    setBusy(label); setMsg("");
    const r = await fetch("/api/test-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) { setMsg(j.error || "That didn't work."); return null; }
    return j;
  }
  async function flag(v: boolean) { const j = await call({ action: "flag", on: v }, "flag"); if (j) { setOn(v); onChange(v); } }
  async function generate() { const j = await call({ action: "generate", count: 25 }, "gen"); if (j) { setMsg(`Added ${j.created} sample jobs; ${j.booked} booked on the production calendar.`); onChange(); } }
  async function clear() { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; } setArmed(false); const j = await call({ action: "clear" }, "clear"); if (j) { setMsg(`Cleared ${j.cleared} job${j.cleared === 1 ? "" : "s"}.`); onChange(); } }
  return (
    <div className={"ta-bar" + (on ? " on" : "")}>
      <label className="ta-sw"><input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => flag(e.target.checked)} /><b>Test account</b></label>
      {on ? (<>
        <span className="ta-note">Fake company for trying things out. Sample jobs show on the production calendar and can be cleared any time.</span>
        <span className="spacer" />
        <button type="button" className="btn sm" disabled={!!busy} onClick={generate}>{busy === "gen" ? "Adding…" : "+ Add 25 sample jobs"}</button>
        <button type="button" className={"btn sm danger" + (armed ? " armed" : "")} disabled={!!busy || !jobs} onClick={clear}>{busy === "clear" ? "Clearing…" : armed ? `Yes, clear all ${jobs}` : `Clear all jobs (${jobs})`}</button>
      </>) : <span className="ta-note faint">Turn on for a fake account used to try out the calendar and other tools.</span>}
      {msg && <span className="ta-msg">{msg}</span>}
    </div>
  );
}
