"use client";
import { useCallback, useEffect, useState } from "react";

type Missed = { kind: "failed" | "too-big"; archivedId: string; visualId: string; date: string | null; nickname: string | null; name: string; url: string; mb?: number };
type Backup = { id: string; status: string; created_at: string; finished_at: string | null; created_by: string | null; error: string | null; summary: { orders: number; customers: number; dollars: number; files: number; filesCopied: number; from: string; before: string } | null; links: { name: string; bytes: number; url: string }[] };

const size = (b: number) => { const u = ["bytes", "KB", "MB", "GB"]; let i = 0, x = b; while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; } return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`; };
const when = (t: string) => new Date(t).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Printavo files that didn't copy: why, the original link to save each one by hand, and Try again. */
export function PrintavoMissedFiles() {
  const [d, setD] = useState<{ files: Missed[]; maxMb: number; copying: number } | null>(null);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [mb, setMb] = useState(45);
  const load = useCallback(async () => {
    const r = await fetch("/api/printavo/files-report", { cache: "no-store" }); const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't load the file report."); return; }
    setD(j); setMb(Math.max(j.maxMb, 45));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function retry(action: "retry-failed" | "retry-big") {
    setBusy(action); setErr(""); setMsg("");
    const r = await fetch("/api/printavo/files-report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, maxMb: action === "retry-big" ? mb : undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "Couldn't start it."); else setMsg(`${j.files} file${j.files === 1 ? "" : "s"} on ${j.orders} order${j.orders === 1 ? "" : "s"} are back in line; the copier picks them up within a minute. Check back here in a few minutes.`);
    setBusy(""); load();
  }
  if (!d) return <section className="panel" style={{ marginTop: 14 }}><div className="panel-b faint">{err || "Checking Printavo files…"}</div></section>;
  const failed = d.files.filter((f) => f.kind === "failed"), big = d.files.filter((f) => f.kind === "too-big");
  const list = (fs: Missed[]) => (
    <ul className="pvk-list">{fs.map((f, i) => (
      <li key={i}>
        <a href={`/shop/archive/${f.archivedId}`}>#{f.visualId}</a>
        <span className="pvk-name" title={f.name}>{f.name}</span>
        <span className="faint">{f.date ? new Date(f.date + "T12:00").toLocaleDateString([], { month: "short", year: "numeric" }) : ""}{f.mb ? ` · ${f.mb} MB` : ""}</span>
        <a href={f.url} target="_blank" rel="noreferrer" title="The original in Printavo: save it by hand (works until Printavo is cancelled)">Original ↗</a>
      </li>
    ))}</ul>
  );
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="panel-h"><div><h2>Files that didn&apos;t copy</h2><div className="faint" style={{ fontSize: 12.5 }}>Every Printavo mockup and file is copied to our storage. These are the ones that aren&apos;t yet.{d.copying ? ` (${d.copying.toLocaleString()} orders still copying files right now.)` : ""}</div></div></div>
      <div className="panel-b stack" style={{ gap: 12 }}>
        {!d.files.length && <div className="ok-note">Every file is copied. Nothing is left in Printavo only.</div>}
        {failed.length > 0 && (
          <div className="pvk-group">
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <b>{failed.length} file{failed.length === 1 ? "" : "s"} the download didn&apos;t work for</b>
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => retry("retry-failed")}>{busy === "retry-failed" ? "Starting…" : "Try again"}</button>
            </div>
            <details><summary className="faint">See them</summary>{list(failed)}</details>
          </div>
        )}
        {big.length > 0 && (
          <div className="pvk-group">
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <b>{big.length} file{big.length === 1 ? "" : "s"} over {d.maxMb} MB</b>
              <span className="row" style={{ gap: 6 }}>
                <label className="faint" style={{ fontSize: 12.5 }}>Take files up to <input type="number" min={45} max={2000} step={5} value={mb} onChange={(e) => setMb(+e.target.value || 45)} style={{ width: 70 }} /> MB</label>
                <button type="button" className="btn sm" disabled={!!busy || mb <= d.maxMb} onClick={() => retry("retry-big")}>{busy === "retry-big" ? "Starting…" : "Copy big files"}</button>
              </span>
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>Supabase takes files up to 50 MB unless its limit is raised: Supabase → Storage → Settings → Upload file size limit (set it to at least the size here), then Copy big files. Or save each one by hand from its Original link before Printavo is cancelled.</div>
            <details><summary className="faint">See them</summary>{list(big)}</details>
          </div>
        )}
        {msg && <div className="ok-note">{msg}</div>}
        {err && <div className="pv-err">{err}</div>}
      </div>
    </section>
  );
}

/** The Printavo history backup (everything before 2026, locked): make a package and download it. Owner only. */
export function PrintavoBackup() {
  const [list, setList] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/backup/printavo", { cache: "no-store" }); const j = await r.json().catch(() => ({}));
    if (r.status === 403) { setDenied(true); return; }
    if (!r.ok) { setErr(j.error || "Couldn't load the backups."); return; }
    setList(j.backups);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function make() {
    setBusy(true); setErr("");
    const r = await fetch("/api/backup/printavo", { method: "POST" }); const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "The backup didn't finish.");
    setBusy(false); load();
  }
  if (denied) return null;
  const latest = list?.find((b) => b.status === "ready");
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="panel-h">
        <div><h2>History backup (2018–2025)</h2><div className="faint" style={{ fontSize: 12.5 }}>Everything Printavo created before 2026 is locked: it can&apos;t be changed or deleted, and neither can its copied artwork. 2026 keeps syncing.</div></div>
        <button type="button" className="btn" disabled={busy} onClick={make}>{busy ? "Making the backup… (a minute or two)" : latest ? "Make a new backup" : "Make the backup"}</button>
      </div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        {!list && !err && <div className="faint">Loading…</div>}
        {list && !list.length && <div className="faint">No backup yet. Make one, then download the files and keep them somewhere safe (your computer, Google Drive, a USB drive).</div>}
        {list?.map((b, i) => (
          <div key={b.id} className={"pvk-backup" + (i ? " old" : "")}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <b>{when(b.created_at)}{i === 0 && b.status === "ready" ? " · latest" : ""}</b>
              <span className={"pvk-st " + b.status}>{b.status === "ready" ? "Ready" : b.status === "building" ? "Making…" : "Didn't finish"}</span>
            </div>
            {b.summary && <div className="faint" style={{ fontSize: 12.5 }}>{b.summary.orders.toLocaleString()} orders · {b.summary.customers.toLocaleString()} customers · ${Math.round(b.summary.dollars).toLocaleString()} · {b.summary.filesCopied.toLocaleString()} of {b.summary.files.toLocaleString()} artwork files copied (listed in files.csv; the artwork itself stays in our storage, locked)</div>}
            {b.error && <div className="pv-err">{b.error}</div>}
            {b.links.length > 0 && (i === 0 ? <div className="pvk-links">{b.links.map((l) => <a key={l.name} className="btn sm" href={l.url}>{l.name} <small className="faint">{size(l.bytes)}</small></a>)}</div>
              : <details><summary className="faint">Files</summary><div className="pvk-links">{b.links.map((l) => <a key={l.name} className="btn sm" href={l.url}>{l.name} <small className="faint">{size(l.bytes)}</small></a>)}</div></details>)}
          </div>
        ))}
        {err && <div className="pv-err">{err}</div>}
        <div className="faint" style={{ fontSize: 12.5 }}>Each order file is one order per line with its complete Printavo record; manifest.json has the counts and a checksum for every file; README.txt explains how to restore. Download links last an hour (reload for fresh ones).</div>
      </div>
    </section>
  );
}
