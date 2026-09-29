"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayLabel, fullName, hm, jobKey, jobMinutes, localDay, localToIso, timeLabel, type JobTime, type OpenJob, type Shift } from "@/lib/timeclock";
import { loadOpenJobs } from "@/lib/jobsClient";
import type { TeamData } from "./types";

type Asg = { id: string; employee_id: string; day: string; order_id: string | null; archived_order_id: string | null; job_label: string; position: number; note: string; station: string; done_at: string | null };

/** The day's plan: who works which jobs, in order. Shows up in each person's employee app. */
export default function TeamPlan({ d }: { d: TeamData }) {
  const [day, setDay] = useState(localDay(new Date()));
  const [asg, setAsg] = useState<Asg[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logged, setLogged] = useState<JobTime[]>([]);
  const [jobs, setJobs] = useState<OpenJob[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: a }, { data: s }, { data: j }] = await Promise.all([
      sb.from("job_assignments").select("*").eq("day", day).order("position"),
      sb.from("shifts").select("*").gte("starts_at", localToIso(day, 0)).lt("starts_at", localToIso(day, 1439)),
      sb.from("job_time").select("*").eq("voided", false).gte("started_at", localToIso(day, 0)).lt("started_at", localToIso(addDays(day, 1), 0)),
    ]);
    setAsg((a || []) as Asg[]); setShifts((s || []) as Shift[]); setLogged((j || []) as JobTime[]);
  }, [day]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (adding && !jobs) loadOpenJobs(createClient()).then(setJobs); }, [adding, jobs]);

  const emps = d.employees.filter((e) => e.active);
  const people = useMemo(() => [...emps].sort((a, b) => Number(!shifts.some((s) => s.employee_id === a.id)) - Number(!shifts.some((s) => s.employee_id === b.id)) || fullName(a).localeCompare(fullName(b))), [emps, shifts]);
  const list = useMemo(() => { const t = q.trim().toLowerCase().replace(/^#/, ""); return (jobs || []).filter((j) => !t || j.number.startsWith(t) || `${j.customer} ${j.name}`.toLowerCase().includes(t)).slice(0, 12); }, [jobs, q]);

  async function add(emp: string, j: OpenJob) {
    const mine = (asg || []).filter((a) => a.employee_id === emp);
    await createClient().from("job_assignments").insert({ employee_id: emp, day, order_id: j.kind === "o" ? j.id : null, archived_order_id: j.kind === "a" ? j.id : null, job_label: `#${j.number} ${j.customer || j.name}`.trim(), position: mine.length ? Math.max(...mine.map((a) => a.position)) + 1 : 0, created_by: d.me });
    setQ(""); load();
  }
  async function move(a: Asg, dir: -1 | 1) {
    const mine = (asg || []).filter((x) => x.employee_id === a.employee_id).sort((x, y) => x.position - y.position);
    const i = mine.findIndex((x) => x.id === a.id), o = mine[i + dir];
    if (!o) return;
    const sb = createClient();
    await Promise.all([sb.from("job_assignments").update({ position: o.position }).eq("id", a.id), sb.from("job_assignments").update({ position: a.position }).eq("id", o.id)]);
    load();
  }
  async function remove(a: Asg) { await createClient().from("job_assignments").delete().eq("id", a.id); load(); }
  async function copyYesterday() {
    const sb = createClient();
    const { data } = await sb.from("job_assignments").select("*").eq("day", addDays(day, -1)).is("done_at", null);
    const have = new Set((asg || []).map((a) => a.employee_id + jobKey(a)));
    const rows = ((data || []) as Asg[]).filter((a) => !have.has(a.employee_id + jobKey(a))).map((a) => ({ employee_id: a.employee_id, day, order_id: a.order_id, archived_order_id: a.archived_order_id, job_label: a.job_label, position: a.position, note: a.note, station: a.station, created_by: d.me }));
    if (rows.length) await sb.from("job_assignments").insert(rows);
    load();
  }

  return (
    <div className="tmx">
      <div className="tmx-bar">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">←</button>
          <b className="tmx-period">{day === localDay(new Date()) ? "Today · " : ""}{dayLabel(day)}</b>
          <button type="button" className="btn sm" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">→</button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={copyYesterday}>Bring Over Unfinished From Yesterday</button>
      </div>
      {asg === null ? <div className="empty">Loading…</div> : !people.length ? <div className="empty">Add employees on Time Clock → Employees first.</div> : (
        <div className="tp-grid">{people.map((e) => {
          const mine = (asg || []).filter((a) => a.employee_id === e.id).sort((a, b) => a.position - b.position);
          const sh = shifts.find((s) => s.employee_id === e.id);
          const run = logged.find((j) => j.employee_id === e.id && !j.ended_at);
          return (
            <section key={e.id} className="db-card db-salmon tp-col">
              <div className="db-card-h"><h2>{fullName(e)}</h2><span className="faint db-h-note">{sh ? `${timeLabel(sh.starts_at)}–${timeLabel(sh.ends_at)}` : "not scheduled"}</span></div>
              {run && <div className="tp-run">▶ {run.job_label} · {run.task} · {hm(jobMinutes(run))}</div>}
              <ol className="tp-list">{mine.map((a, i) => {
                const mins = logged.filter((j) => j.employee_id === e.id && jobKey(j) === jobKey(a)).reduce((x, j) => x + jobMinutes(j), 0);
                return (
                  <li key={a.id} className={a.done_at ? "done" : ""}>
                    <span className="tp-n">{a.done_at ? "✓" : i + 1}</span>
                    <span className="tp-l"><b>{a.job_label}</b>{mins ? <small>{hm(mins)} logged</small> : null}</span>
                    <span className="tp-a"><button type="button" className="btn icon ghost sm" onClick={() => move(a, -1)} aria-label="Up" disabled={i === 0}>↑</button><button type="button" className="btn icon ghost sm" onClick={() => move(a, 1)} aria-label="Down" disabled={i === mine.length - 1}>↓</button><button type="button" className="btn icon ghost sm" onClick={() => remove(a)} aria-label="Remove">✕</button></span>
                  </li>
                );
              })}</ol>
              {adding === e.id ? (
                <div className="tp-add">
                  <input autoFocus type="text" placeholder="Order # or customer" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter" && list[0]) add(e.id, list[0]); if (ev.key === "Escape") setAdding(null); }} />
                  <ul>{jobs === null ? <li className="faint">Loading jobs…</li> : list.map((j) => <li key={j.kind + j.id}><button type="button" onClick={() => add(e.id, j)}><b>#{j.number}</b> {j.customer} <span className="faint">{j.name}{j.due ? ` · due ${dayLabel(j.due)}` : ""}</span></button></li>)}</ul>
                  <button type="button" className="linkbtn" onClick={() => { setAdding(null); setQ(""); }}>Done</button>
                </div>
              ) : <button type="button" className="btn sm" onClick={() => { setAdding(e.id); setQ(""); }}>+ Add Job</button>}
            </section>
          );
        })}</div>
      )}
    </div>
  );
}
