"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = {
  enabled: boolean; listing: boolean; sweep_no: number; sweep_started_at: string | null; sweep_done_at: string | null; last_run_at: string | null;
  last_error: string | null; last_error_at: string | null;
  orders: number; pending: number; files_waiting: number; done: number; errors: number; gone: number; customers: number;
  files_total: number; files_copied: number; storage_bytes: number; oldest_done: string | null; last_hour: number;
  recent_errors: { visual_id: string; error: string }[];
};

const size = (b: number) => { const u = ["bytes", "KB", "MB", "GB", "TB"]; let i = 0, x = b; while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; } return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`; };
const ago = (t: string | null) => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

/**
 * Printavo sync: imports everything, then keeps our copy up to date. It runs on the server every minute (no need to keep
 * this page open) and only ever READS from Printavo.
 */
export default function PrintavoSync() {
  const sb = createClient();
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("printavo_sync_status");
    if (error) setErr(error.message); else setS(data as Status);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  async function toggle(on: boolean) {
    setBusy(true); setErr("");
    const { error } = await sb.from("printavo_sync").update({ enabled: on }).eq("id", 1);
    if (error) setErr(error.message);
    await load(); setBusy(false);
  }

  if (!s) return <section className="panel" style={{ marginTop: 14 }}><div className="panel-b faint">{err || "Loading…"}</div></section>;
  const imported = s.done + s.files_waiting;
  const eta = s.last_hour > 0 && s.pending > 0 ? s.pending / s.last_hour : null;
  const phase = !s.enabled ? (s.orders ? "Paused" : "Off")
    : s.listing ? "Step 1 of 2: listing every order in Printavo"
    : s.pending > 0 ? "Step 2 of 2: importing orders, newest first"
    : s.files_waiting > 0 ? "Copying the last files"
    : "Up to date · watching Printavo for changes";
  const stale = s.enabled && s.last_run_at && Date.now() - new Date(s.last_run_at).getTime() > 5 * 60000;

  return (
    <section className="panel psy" style={{ marginTop: 14 }}>
      <div className="panel-h">
        <div><h2>Printavo sync</h2><div className="faint" style={{ fontSize: 12.5 }}>Read-only: it never changes anything in Printavo.</div></div>
        <div className="row" style={{ gap: 10 }}>
          <span className={"psy-state" + (s.enabled ? " on" : "")}>{s.enabled ? "● Running" : "Paused"}</span>
          {s.enabled
            ? <button type="button" className="btn" disabled={busy} onClick={() => toggle(false)}>Pause</button>
            : <button type="button" className="btn primary" disabled={busy} onClick={() => toggle(true)}>{s.orders ? "Resume" : "Start importing everything"}</button>}
        </div>
      </div>
      <div className="panel-b stack" style={{ gap: 12 }}>
        <div className="psy-phase"><b>{phase}</b>{s.enabled && <span className="faint"> · last run {ago(s.last_run_at)}</span>}</div>
        {s.orders > 0 && (
          <>
            {s.listing
              ? <div style={{ fontSize: 13.5 }}>Found <b>{s.orders.toLocaleString()}</b> orders so far…</div>
              : <div className="pv-prog"><span>Orders {imported.toLocaleString()} / {s.orders.toLocaleString()}</span><i style={{ ["--p" as string]: pct(imported, s.orders) + "%" }} /></div>}
            <div className="pv-prog"><span>Files {s.files_copied.toLocaleString()} / {s.files_total.toLocaleString()}</span><i style={{ ["--p" as string]: pct(s.files_copied, s.files_total) + "%" }} /></div>
            <div className="pvc-kpis">
              <div><span>Customers</span><b>{s.customers.toLocaleString()}</b><small>imported</small></div>
              <div><span>Last hour</span><b>{s.last_hour.toLocaleString()}</b><small>orders imported</small></div>
              <div><span>Time left</span><b>{eta == null ? "—" : eta < 1 ? `${Math.max(1, Math.round(eta * 60))} min` : `${eta.toFixed(eta < 10 ? 1 : 0)} h`}</b><small>{s.pending.toLocaleString()} orders to go</small></div>
              <div><span>Storage used</span><b>{size(s.storage_bytes)}</b><small>{s.oldest_done ? `back to ${new Date(s.oldest_done).toLocaleDateString([], { month: "short", year: "numeric" })}` : "files copied"}</small></div>
            </div>
          </>
        )}
        <div className="faint" style={{ fontSize: 12.5 }}>
          {s.sweep_no > 0 && <>Last full check of Printavo {ago(s.sweep_done_at)}. </>}
          Runs on our server every minute, so this page doesn&apos;t need to stay open. New orders, changes, payments and status updates in Printavo come over automatically; recent orders are re-read in full once a day for new messages and files.
          {s.gone > 0 && <> {s.gone} order{s.gone === 1 ? " was" : "s were"} removed in Printavo (our copies are kept).</>}
        </div>
        {stale && <div className="banner">The sync hasn&apos;t run in a few minutes. It usually picks up again by itself; if it stays like this, let us know.</div>}
        {s.last_error && s.last_error_at && Date.now() - new Date(s.last_error_at).getTime() < 3600000 && <div className="pv-err">Last problem ({ago(s.last_error_at)}): {s.last_error}</div>}
        {s.errors > 0 && (
          <details><summary className="faint" style={{ fontSize: 13, cursor: "pointer" }}>{s.errors} order{s.errors === 1 ? "" : "s"} couldn&apos;t be imported (tried 3 times)</summary>
            <ul className="faint" style={{ fontSize: 12.5, margin: "6px 0 0 16px" }}>{s.recent_errors.map((e, i) => <li key={i}>#{e.visual_id}: {e.error}</li>)}</ul>
          </details>
        )}
        {err && <div className="pv-err">{err}</div>}
      </div>
    </section>
  );
}
