"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName, hm, jobMinutes, localDay, localToIso, timeLabel, type JobTime } from "@/lib/timeclock";
import type { TeamData } from "./types";

/** Right now: who's on which job and for how long, and what each person has logged today. Refreshes every 30 seconds. */
export default function TeamFloor({ d }: { d: TeamData }) {
  const [rows, setRows] = useState<JobTime[] | null>(null);
  const [, tick] = useState(0);
  const load = useCallback(async () => {
    const { data } = await createClient().from("job_time").select("*").eq("voided", false).gte("started_at", localToIso(localDay(new Date()), 0)).order("started_at");
    setRows((data || []) as JobTime[]);
  }, []);
  useEffect(() => { load(); const i = setInterval(() => { load(); tick((x) => x + 1); }, 30000); return () => clearInterval(i); }, [load]);
  const name = (id: string) => fullName(d.employees.find((e) => e.id === id) || { first_name: "?", last_name: "" });
  const running = (rows || []).filter((r) => !r.ended_at);
  const byEmp = new Map<string, JobTime[]>();
  for (const r of rows || []) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) || []), r]);
  return (
    <div className="tmx">
      <div className="sc-kpis tmx-kpis">
        <div className="sc-kpi teal"><span>On A Job Now</span><b>{running.length}</b><small>{running.map((r) => name(r.employee_id).split(" ")[0]).slice(0, 4).join(", ") || "no one"}</small></div>
        <div className="sc-kpi blue"><span>Job Time Today</span><b>{hm((rows || []).reduce((a, r) => a + jobMinutes(r), 0))}</b><small>everyone</small></div>
        <div className="sc-kpi orange"><span>Jobs Touched</span><b>{new Set((rows || []).map((r) => r.order_id || r.archived_order_id)).size}</b><small>today</small></div>
        <div className="sc-kpi"><span>Pieces Logged</span><b>{(rows || []).reduce((a, r) => a + (r.pieces || 0), 0).toLocaleString()}</b><small>today</small></div>
      </div>
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>On The Floor</h2><span className="faint db-h-note">what people are working on right now</span></div>
        {rows === null ? <div className="db-empty">Loading…</div> : !running.length ? <div className="db-empty">No one is on a job right now. People start jobs in the employee app.</div> : (
          <ul className="db-list">{running.map((r) => (
            <li key={r.id} className="db-row tmx-row"><span className="tmx-dot in" /><span className="db-main"><b>{name(r.employee_id)}</b><span className="faint">{r.job_label} · {r.task}{r.station ? ` · ${r.station}` : ""}{r.team_id ? " · team" : ""}</span></span>
              <span className="db-side"><span className="faint">since {timeLabel(r.started_at)}</span><b className="num">{hm(jobMinutes(r))}</b></span></li>
          ))}</ul>
        )}
      </section>
      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Today So Far</h2></div>
        {!byEmp.size ? <div className="db-empty">Nothing logged yet today.</div> : (
          <ul className="db-list">{[...byEmp.entries()].map(([id, js]) => (
            <li key={id} className="db-row"><span className="db-main"><b>{name(id)}</b><span className="tmx-punches">{js.map((j) => <span key={j.id} className={"tmx-p " + (j.ended_at ? "" : "in")}>{j.job_label.split(" ")[0]} {j.task} {hm(jobMinutes(j))}{j.pieces != null ? ` · ${j.pieces} pcs` : ""}</span>)}</span></span>
              <span className="db-side"><b className="num">{hm(js.reduce((a, j) => a + jobMinutes(j), 0))}</b></span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
