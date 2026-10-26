"use client";
import { useState } from "react";

/** Refresh from Printavo (Oct 26): one imported order read again now, as Printavo has it. Read-only toward Printavo. */
export default function RefreshFromPrintavo({ archivedId, locked, onDone }: { archivedId: string; locked?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (locked) return <button type="button" className="btn" disabled title="Orders from before 2026 are locked history, kept as imported">Refresh from Printavo</button>;
  async function go() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/printavo/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivedId }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: r.filesLeft ? `Updated. ${r.filesLeft} file${r.filesLeft === 1 ? "" : "s"} still copying.` : "Updated from Printavo." });
    onDone?.();
  }
  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" className="btn" disabled={busy} onClick={() => void go()} title="Read this order again from Printavo now">{busy ? "Refreshing…" : "Refresh from Printavo"}</button>
      {msg && <span className={msg.ok ? "faint" : "pv-err"} style={{ fontSize: 12.5 }} role="status">{msg.text}</span>}
    </span>
  );
}
