"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayLabel, fullName, hm, jobMinutes, localDay, localMinutes, localToIso, timeLabel, type JobTime, type OpenJob } from "@/lib/timeclock";
import { loadOpenJobs } from "@/lib/jobsClient";
import type { TeamData } from "./types";

/** Every job-time entry for a date range, by day; fix one (times, task, pieces), void it, or add a missed one. */
export default function TeamTimes({ d }: { d: TeamData }) {
  const [to, setTo] = useState(localDay(new Date())); const [from, setFrom] = useState(addDays(localDay(new Date()), -6));
  const [who, setWho] = useState("");
  const [rows, setRows] = useState<JobTime[] | null>(null);
  const [edit, setEdit] = useState<Partial<JobTime> | null>(null);
  const load = useCallback(async () => {
    let q = createClient().from("job_time").select("*").gte("started_at", localToIso(from, 0)).lt("started_at", localToIso(addDays(to, 1), 0)).order("started_at", { ascending: false }).limit(2000);
    if (who) q = q.eq("employee_id", who);
    const { data } = await q; setRows((data || []) as JobTime[]);
  }, [from, to, who]);
  useEffect(() => { load(); }, [load]);
  const days = useMemo(() => { const m = new Map<string, JobTime[]>(); for (const r of rows || []) { const k = localDay(r.started_at); m.set(k, [...(m.get(k) || []), r]); } return [...m.entries()]; }, [rows]);
  const name = (id: string) => fullName(d.employees.find((e) => e.id === id) || { first_name: "?", last_name: "" });
  return (
    <div className="tmx">
      <div className="tmx-bar">
        <label className="row" style={{ gap: 6 }}>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} /></label>
        <label className="row" style={{ gap: 6 }}>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} /></label>
        <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: "auto" }} aria-label="Employee"><option value="">Everyone</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => setEdit({ started_at: localToIso(localDay(new Date()), 8 * 60), task: d.settings.tasks[0] || "" })}>+ Add Time</button>
      </div>
      {rows === null ? <div className="empty">Loading…</div> : !days.length ? <div className="empty">No job time in these dates.</div> : days.map(([day, list]) => (
        <section key={day} className="db-card db-blue">
          <div className="db-card-h"><h2>{dayLabel(day)}</h2><span className="faint db-h-note">{hm(list.filter((r) => !r.voided).reduce((a, r) => a + jobMinutes(r), 0))} logged</span></div>
          <table className="rv-tbl tj-tbl"><thead><tr><th>Employee</th><th>Job</th><th>Doing</th><th>Time</th><th className="r">Hours</th><th className="r">Pieces</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className={r.voided ? "tj-void" : ""} onClick={() => setEdit(r)} style={{ cursor: "pointer" }}>
                <td><b>{name(r.employee_id)}</b></td><td>{r.job_label}</td><td>{r.task}{r.station ? <span className="faint"> · {r.station}</span> : null}</td>
                <td>{timeLabel(r.started_at)}–{r.ended_at ? timeLabel(r.ended_at) : "now"}{r.auto_stopped ? <span className="faint"> (auto)</span> : null}{r.edited_by ? " ✎" : ""}</td>
                <td className="r num">{hm(jobMinutes(r))}</td><td className="r num">{r.pieces ?? "—"}</td>
              </tr>
            ))}</tbody></table>
        </section>
      ))}
      {edit && <EntryEditor d={d} e={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function EntryEditor({ d, e, onClose, onSaved }: { d: TeamData; e: Partial<JobTime>; onClose: () => void; onSaved: () => void }) {
  const t = (iso?: string | null) => (iso ? `${String(Math.floor(localMinutes(iso) / 60)).padStart(2, "0")}:${String(localMinutes(iso) % 60).padStart(2, "0")}` : "");
  const [emp, setEmp] = useState(e.employee_id || "");
  const [day, setDay] = useState(e.started_at ? localDay(e.started_at) : localDay(new Date()));
  const [start, setStart] = useState(t(e.started_at) || "08:00"), [end, setEnd] = useState(t(e.ended_at));
  const [task, setTask] = useState(e.task || ""), [pieces, setPieces] = useState(e.pieces != null ? String(e.pieces) : "");
  const [jobs, setJobs] = useState<OpenJob[] | null>(null), [job, setJob] = useState(e.id ? "" : "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => { if (!e.id) loadOpenJobs(createClient()).then(setJobs); }, [e.id]);
  const iso = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return localToIso(day, h * 60 + m); };
  async function save(voidIt = false) {
    setBusy(true); setErr("");
    const sb = createClient(); const now = new Date().toISOString();
    let r;
    if (e.id) r = await sb.from("job_time").update(voidIt ? { voided: !e.voided, edited_by: d.me, edited_at: now } : { started_at: iso(start), ended_at: end ? iso(end) : null, task, pieces: pieces === "" ? null : +pieces, edited_by: d.me, edited_at: now }).eq("id", e.id);
    else {
      const j = (jobs || []).find((x) => x.kind + x.id === job);
      if (!emp || !j || !task || !end) { setBusy(false); return setErr("Pick the person, job, what they did, and both times."); }
      r = await sb.from("job_time").insert({ employee_id: emp, order_id: j.kind === "o" ? j.id : null, archived_order_id: j.kind === "a" ? j.id : null, job_label: `#${j.number} ${j.name}`.trim(), task, started_at: iso(start), ended_at: iso(end), pieces: pieces === "" ? null : +pieces, source: "manual", edited_by: d.me, edited_at: now });
    }
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Job time">
        <div className="pp-sheet-h"><b>{e.id ? `Fix Time · ${e.job_label}` : "Add Job Time"}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          {!e.id && <>
            <label>Employee<select value={emp} onChange={(ev) => setEmp(ev.target.value)}><option value="">Choose…</option>{d.employees.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</select></label>
            <label>Job<select value={job} onChange={(ev) => setJob(ev.target.value)}><option value="">{jobs ? "Choose…" : "Loading…"}</option>{(jobs || []).map((j) => <option key={j.kind + j.id} value={j.kind + j.id}>#{j.number} {j.customer} · {j.name}</option>)}</select></label>
          </>}
          <label>Doing<input list="tj-tasks" value={task} onChange={(ev) => setTask(ev.target.value)} /><datalist id="tj-tasks">{[...d.settings.tasks, "Full Front", "Full Back", "Left Chest", "Sleeve"].map((x) => <option key={x} value={x} />)}</datalist></label>
          <div className="tmx-2"><label>Day<input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} /></label><label>Pieces<input type="number" min={0} value={pieces} onChange={(ev) => setPieces(ev.target.value)} /></label></div>
          <div className="tmx-2"><label>Started<input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} /></label><label>Finished<input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} /></label></div>
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {e.id && <button type="button" className="btn danger" disabled={busy} onClick={() => save(true)}>{e.voided ? "Restore" : "Void"}</button>}
            <button type="button" className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
