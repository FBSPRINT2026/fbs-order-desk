"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dayLabel, localDay, timeLabel } from "@/lib/timeclock";
import { guessMapping, toPunches, type Mapping } from "@/lib/timeImport";
import type { TimeData } from "./types";

/**
 * Bring hours over from uAttend: export a report there (Timecard or Punch Detail, as Excel or CSV), drop it here,
 * check the columns, and import. Employees are matched by uAttend ID or name (new ones are added); loading the same
 * report twice doesn't double anything. The API sync takes over once uAttend sends the key.
 */
export default function TimeImport({ d }: { d: TimeData }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [name, setName] = useState("");
  const [headAt, setHeadAt] = useState(0);
  const [m, setM] = useState<Mapping | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState("");

  async function upload(f: File) {
    setBusy("Reading the file…"); setErr(""); setDone(""); setRows(null);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/time/import", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "No connection." };
    setBusy("");
    if (!r?.ok) return setErr(j.error || "Couldn't read that file.");
    const all = (j.rows || []) as string[][];
    // the header is the first row that names an employee column
    const h = Math.max(0, all.findIndex((x) => x.some((c) => /employee|name/i.test(c)) && x.some((c) => /date|in|time/i.test(c))));
    setName(j.name); setRows(all); setHeadAt(h); setM(guessMapping(all[h] || []));
  }
  const head = rows?.[headAt] || [];
  const body = useMemo(() => (rows || []).slice(headAt + 1), [rows, headAt]);
  const result = useMemo(() => (m && rows ? toPunches(body, m) : null), [m, rows, body]);
  const people = useMemo(() => new Set((result?.punches || []).map((p) => p.employeeId || p.employee)).size, [result]);
  const range = useMemo(() => { const ds = (result?.punches || []).map((p) => localDay(p.at)).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : null; }, [result]);

  async function commit() {
    if (!result?.punches.length) return;
    setBusy("Importing…"); setErr("");
    let saved = 0, skipped = 0, added = 0;
    for (let i = 0; i < result.punches.length; i += 2000) {
      setBusy(`Importing… ${Math.min(i + 2000, result.punches.length).toLocaleString()} of ${result.punches.length.toLocaleString()}`);
      const r = await fetch("/api/time/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ punches: result.punches.slice(i, i + 2000) }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "No connection." };
      if (!r?.ok) { setBusy(""); return setErr(j.error || "Import stopped."); }
      saved += j.saved || 0; skipped += j.skipped || 0; added += j.employeesAdded || 0;
    }
    setBusy(""); setDone(`Imported ${saved.toLocaleString()} punches${skipped ? ` (${skipped.toLocaleString()} were already here)` : ""}${added ? `, added ${added} employee${added === 1 ? "" : "s"}` : ""}.`);
    d.reload();
  }
  const col = (k: "employee" | "employeeId" | "department" | "date" | "datetime" | "type", label: string) => (
    <label>{label}<select value={m![k]} onChange={(e) => setM({ ...m!, [k]: +e.target.value })}><option value={-1}>—</option>{head.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>
  );

  return (
    <div className="tmx">
      <UattendLive />
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Import From uAttend (report file)</h2></div>
        <ol className="tmx-steps">
          <li>In uAttend, open <b>Reports</b> and run the <b>Punch Detail</b> (or Timecard) report for everyone, for a date range (a year at a time works well).</li>
          <li>Export it as <b>Excel</b> or <b>CSV</b>, and drop the file here.</li>
          <li>Check the columns below, then Import. Doing the same dates twice is safe.</li>
        </ol>
        <label className="tmx-drop">
          <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <b>{busy || "Choose a report file"}</b><span className="faint">Excel (.xlsx) or CSV</span>
        </label>
        {err && <div className="pv-err">{err}</div>}
        {done && <div className="tmx-done">✓ {done}</div>}
      </section>

      {rows && m && (
        <section className="db-card db-orange">
          <div className="db-card-h"><h2>{name}</h2><span className="faint db-h-note">{body.length.toLocaleString()} rows</span></div>
          <div className="tmx-map">
            <label>Header row<select value={headAt} onChange={(e) => { const h = +e.target.value; setHeadAt(h); setM(guessMapping(rows[h] || [])); }}>{rows.slice(0, 15).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60)}</option>)}</select></label>
            <label>Report layout<select value={m.mode} onChange={(e) => setM({ ...m, mode: e.target.value as Mapping["mode"] })}><option value="pairs">One row per day, In / Out columns</option><option value="rows">One row per punch</option></select></label>
            {col("employee", "Employee name")}{col("employeeId", "Employee ID")}{col("department", "Department")}
            {m.mode === "pairs" ? (<>
              {col("date", "Date")}
              <div className="tmx-io"><span className="lbl">In / Out columns</span>{head.map((h, i) => (
                <label key={i} className="check" style={{ fontSize: 12.5 }}><select value={m.ins.includes(i) ? "in" : m.outs.includes(i) ? "out" : ""} onChange={(e) => setM({ ...m, ins: e.target.value === "in" ? [...m.ins.filter((x) => x !== i), i].sort((a, b) => a - b) : m.ins.filter((x) => x !== i), outs: e.target.value === "out" ? [...m.outs.filter((x) => x !== i), i].sort((a, b) => a - b) : m.outs.filter((x) => x !== i) })} style={{ width: "auto" }}><option value="">—</option><option value="in">In</option><option value="out">Out</option></select>{h || `Column ${i + 1}`}</label>
              ))}</div>
            </>) : (<>{col("datetime", "Punch date & time")}{col("date", "Date (if separate)")}{col("type", "Punch type (In / Out)")}</>)}
          </div>
          {result && (
            <>
              <div className="tmx-sum">
                <b>{result.punches.length.toLocaleString()} punches</b> · {people} people{range ? ` · ${dayLabel(range[0])} – ${dayLabel(range[1])}` : ""}{result.skipped ? <span className="faint"> · {result.skipped} rows skipped (no time or name)</span> : null}
              </div>
              <table className="rv-tbl tmx-prev"><thead><tr><th>Employee</th><th>ID</th><th>Punch</th><th>When</th></tr></thead>
                <tbody>{result.punches.slice(0, 12).map((p) => <tr key={p.key}><td>{p.employee}</td><td className="faint">{p.employeeId}</td><td>{p.kind === "in" ? "In" : p.kind === "out" ? "Out" : p.kind === "break_start" ? "Break" : "Back"}</td><td>{dayLabel(localDay(p.at))} {timeLabel(p.at)}</td></tr>)}</tbody></table>
              <div className="row" style={{ gap: 10, marginTop: 10 }}><button type="button" className="btn primary" disabled={!!busy || !result.punches.length} onClick={commit}>{busy || `Import ${result.punches.length.toLocaleString()} Punches`}</button></div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

type UaStatus = { last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; last_summary: { from: string; to: string; punches: number; added: number; updated: number; linked: number; newEmployees: number; unknown: number; unmatched?: string[] } | null };
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`; };
const addD = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * The live uAttend connection (read-only from uAttend): every 2 minutes in shop hours the portal pulls yesterday's and
 * today's punches, so the Production calendar knows when each press operator clocks in. History comes over here, a
 * few months per request.
 */
function UattendLive() {
  const [st, setSt] = useState<UaStatus | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState("");
  const today = localDay(new Date());
  const [from, setFrom] = useState(() => addD(today, -365)), [to, setTo] = useState(today);
  const load = useCallback(async () => { const { data } = await createClient().from("uattend_sync").select("last_run_at, last_ok_at, last_error, last_error_at, last_summary").eq("id", 1).maybeSingle(); setSt((data as UaStatus) || null); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  async function go(a?: string, b?: string) {
    setErr(""); setDone("");
    // longer ranges go over 90 days at a time
    const steps: [string, string][] = [];
    if (a && b) for (let x = a; x <= b; x = addD(x, 90)) steps.push([x, addD(x, 89) < b ? addD(x, 89) : b]);
    else steps.push(["", ""]);
    let added = 0, punches = 0, linked = 0;
    for (let i = 0; i < steps.length; i++) {
      setBusy(steps.length > 1 ? `Bringing over ${dayLabel(steps[i][0])} – ${dayLabel(steps[i][1])} (${i + 1} of ${steps.length})…` : "Syncing…");
      const r = await fetch("/api/time/uattend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(steps[i][0] ? { from: steps[i][0], to: steps[i][1] } : {}) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "No connection." };
      if (!r?.ok) { setBusy(""); setErr(j.error || "The sync didn't work."); load(); return; }
      added += j.added || 0; punches += j.punches || 0; linked += j.linked || 0;
    }
    setBusy(""); load();
    setDone(`${punches.toLocaleString()} punches read, ${added.toLocaleString()} new${linked ? `, ${linked} employee${linked === 1 ? "" : "s"} linked by name` : ""}.`);
  }
  const noKey = !!st?.last_error && /key isn't set up/i.test(st.last_error);
  const healthy = !!st?.last_ok_at && (!st.last_error_at || Date.parse(st.last_ok_at) > Date.parse(st.last_error_at));
  return (
    <section className="db-card">
      <div className="db-card-h"><h2>uAttend Live Sync</h2><span className={"tmx-ua " + (healthy ? "ok" : noKey ? "" : st?.last_error ? "bad" : "")}>{healthy ? `Connected · synced ${ago(st!.last_ok_at!)}` : noKey ? "Waiting for the API key" : st?.last_error ? "Not syncing" : "Not set up yet"}</span></div>
      <p className="faint" style={{ fontSize: 13, margin: "0 0 8px" }}>Punches come over from uAttend every 2 minutes (5 AM – 8 PM), read only: nothing is ever changed in uAttend. When a press operator clocks in, that press&apos;s day starts on the Production calendar; until then its jobs wait.</p>
      {noKey && <div className="tmx-note">Add the key in <b>Vercel → fbs-order-desk → Settings → Environment Variables</b> as <code>UATTEND_API_KEY</code> (Production), then redeploy. It&apos;s never shown or typed here.</div>}
      {st?.last_error && !noKey && !healthy && <div className="pv-err">{st.last_error}</div>}
      {st?.last_summary && <div className="faint" style={{ fontSize: 12.5 }}>Last run: {st.last_summary.punches} punches read ({dayLabel(st.last_summary.from)} – {dayLabel(st.last_summary.to)}), {st.last_summary.added} new{st.last_summary.updated ? `, ${st.last_summary.updated} changed in uAttend` : ""}{st.last_summary.unknown ? `, ${st.last_summary.unknown} skipped (people not on our list)` : ""}.</div>}
      {!!st?.last_summary?.unmatched?.length && <div className="tmx-note">In uAttend but not on our employee list (their punches aren&apos;t brought over): {st.last_summary.unmatched.join(", ")}. Nobody is added from uAttend; if one of them is someone we have under another name, tell Claude who.</div>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => go()}>Sync Now</button>
        <span className="spacer" />
        <label className="tmx-f">History from<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="tmx-f">to<input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="btn sm primary" disabled={!!busy || !from || !to} onClick={() => go(from, to)}>Bring Over History</button>
      </div>
      {busy && <div className="faint" style={{ marginTop: 6 }}>{busy}</div>}
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="tmx-done">✓ {done}</div>}
    </section>
  );
}
