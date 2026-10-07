"use client";
import { useCallback, useEffect, useState } from "react";
import { zipStore } from "@/lib/zipStore";

/**
 * Restore points: a full copy of every database table, to download and keep (owner only). The first one is meant to
 * be made before customers start moving off Printavo; the matching code version is the GitHub branch
 * release/v1.0-before-customer-move. Built in rounds by /api/backup/full; this keeps calling until it's done.
 */
type RP = { id: string; status: string; created_at: string; finished_at: string | null; created_by: string; error: string | null; label: string; tables: number; done: number; rows: number; links: { name: string; bytes: number; url: string }[] };
const when = (d: string) => new Date(d).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : b ? `${b} B` : "");

export default function RestorePoint() {
  const [list, setList] = useState<RP[] | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [denied, setDenied] = useState(false);
  const [label, setLabel] = useState("Before moving customers off Printavo");
  const load = useCallback(async () => {
    const r = await fetch("/api/backup/full", { cache: "no-store" }); const j = await r.json().catch(() => ({}));
    if (r.status === 403) { setDenied(true); return; }
    if (!r.ok) { setErr(j.error || "Couldn't load the restore points."); return; }
    setList(j.backups);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function make(resume?: string) {
    setErr("");
    let id = resume || "", tries = 0;
    for (;;) {
      setBusy(id ? "Saving tables…" : "Starting…");
      const r = await fetch("/api/backup/full", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { label }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
      if (j.id) id = j.id;
      if (j.status === "done") break;
      if (!r?.ok) { if (++tries > 2 || !id) { setErr(j.error || "The restore point didn't finish. Press Continue to pick up where it stopped."); break; } }
      setBusy(`Saving tables… ${j.done || 0} of ${j.total || "?"}`);
      await load();
    }
    setBusy(""); load();
  }
  /** every file of a restore point in one .zip (fresh links first: they last an hour) */
  const [zipping, setZipping] = useState(""), [zipMsg, setZipMsg] = useState("");
  async function downloadZip(id: string) {
    setErr(""); setZipping(id);
    try {
      const r = await fetch("/api/backup/full", { cache: "no-store" }); const j = await r.json().catch(() => ({}));
      const b = ((j.backups || []) as RP[]).find((x) => x.id === id);
      if (!b?.links.length) throw new Error("No files to download yet.");
      const folder = `restore-point-${b.created_at.slice(0, 16).replace(/[:T]/g, "-")}`;
      const files: { name: string; data: Uint8Array }[] = [];
      for (const [i, f] of b.links.entries()) {
        setZipMsg(`Downloading ${i + 1} of ${b.links.length}…`);
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`${f.name}: ${res.status}`);
        files.push({ name: `${folder}/${f.name}`, data: new Uint8Array(await res.arrayBuffer()) });
      }
      setZipMsg("Making the zip…");
      const url = URL.createObjectURL(zipStore(files));
      const a = document.createElement("a"); a.href = url; a.download = `${folder}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErr("Couldn't make the zip: " + (e instanceof Error ? e.message : String(e))); }
    setZipMsg(""); setZipping("");
  }
  if (denied) return null;
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="panel-h">
        <div><h2>Restore points</h2><div className="faint" style={{ fontSize: 12.5 }}>A full copy of every table (customers, orders, the Printavo copy, settings, staff, production…) to download and keep. Artwork files stay in storage.</div></div>
      </div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input type="text" aria-label="Name for this restore point" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "1 1 280px" }} />
          <button type="button" className="btn primary" disabled={!!busy || !label.trim()} onClick={() => make()}>{busy || "Make a restore point"}</button>
        </div>
        {err && <div className="err">{err}</div>}
        {!list && !err && <div className="faint">Loading…</div>}
        {list?.map((b) => (
          <div key={b.id} className="pvk-backup">
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <b>{b.label || "Restore point"} · {when(b.created_at)}</b>
              <span className="faint">{b.status === "done" ? `${b.tables} tables, ${b.rows.toLocaleString()} rows` : `${b.done} of ${b.tables} tables saved`}{b.created_by ? ` · ${b.created_by}` : ""}</span>
            </div>
            {b.status !== "done" && !busy && <button type="button" className="btn sm" onClick={() => make(b.id)}>Continue</button>}
            {b.links.length > 0 && <button type="button" className="btn primary sm" style={{ alignSelf: "flex-start" }} disabled={!!zipping || !!busy} onClick={() => downloadZip(b.id)}>{zipping === b.id ? zipMsg || "Working…" : `Download all ${b.links.length} files as one .zip`}</button>}
            {b.links.length > 0 && <details><summary>Or download them one by one</summary>
              <ul className="rp-files">{b.links.map((f) => <li key={f.name}><a href={f.url} download={f.name}>{f.name}</a> <span className="faint">{size(f.bytes)}</span></li>)}</ul>
              <div className="faint" style={{ fontSize: 12 }}>Links last an hour. Start with README.txt. Keep the files somewhere private: they include customer details and pay rates.</div>
            </details>}
          </div>
        ))}
      </div>
    </section>
  );
}
