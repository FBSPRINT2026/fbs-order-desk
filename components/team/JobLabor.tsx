"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName, hm, jobMinutes, timeLabel, dayLabel, localDay, type Employee, type JobTime } from "@/lib/timeclock";
import { money } from "@/lib/format";

/** Labor on one order: time logged per step (setup, front, back…), who did it, pieces per labor hour and (owners/admins) cost. */
export default function JobLabor({ orderId, archivedId, qty, total }: { orderId?: string; archivedId?: string; qty?: number; total?: number }) {
  const [rows, setRows] = useState<JobTime[] | null>(null);
  const [emps, setEmps] = useState<Record<string, Employee>>({});
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const q = sb.from("job_time").select("*").eq("voided", false).order("started_at");
      const { data } = orderId ? await q.eq("order_id", orderId) : await q.eq("archived_order_id", archivedId!);
      const js = (data || []) as JobTime[]; setRows(js);
      const ids = [...new Set(js.map((j) => j.employee_id))];
      if (!ids.length) return;
      const [{ data: es }, { data: pr, error }] = await Promise.all([sb.from("employees").select("*").in("id", ids), sb.from("employee_pay").select("employee_id, rate, salary").in("employee_id", ids)]);
      setEmps(Object.fromEntries(((es || []) as Employee[]).map((e) => [e.id, e])));
      if (!error && pr?.length) setRates(Object.fromEntries((pr as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, x.rate != null ? +x.rate : x.salary ? +x.salary / 2080 : 0])));
    })();
  }, [orderId, archivedId]);
  if (!rows || !rows.length) return null;
  const mins = rows.reduce((a, r) => a + jobMinutes(r), 0);
  const byTask = new Map<string, number>(); for (const r of rows) byTask.set(r.task, (byTask.get(r.task) || 0) + jobMinutes(r));
  const cost = rates ? rows.reduce((a, r) => a + (jobMinutes(r) / 60) * (rates[r.employee_id] || 0), 0) : null;
  return (
    <section className="panel jl">
      <div className="panel-h"><h2>Labor</h2><span className="faint">{hm(mins)} logged</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <div className="tj-steps">{[...byTask.entries()].map(([t, m]) => <span key={t} className="tmx-p">{t} <b>{hm(m)}</b></span>)}</div>
        <div className="jl-k">
          {qty ? <span>{(qty / (mins / 60)).toFixed(1)} <small>pcs / labor hr</small></span> : null}
          {cost != null && <span>{money(cost)} <small>labor cost</small></span>}
          {cost != null && total ? <span>{((cost / total) * 100).toFixed(0)}% <small>of the price</small></span> : null}
        </div>
        <button type="button" className="linkbtn" onClick={() => setOpen(!open)} style={{ alignSelf: "flex-start" }}>{open ? "Hide entries" : `Show ${rows.length} entries`}</button>
        {open && <ul className="jl-list">{rows.map((r) => <li key={r.id}><b>{emps[r.employee_id] ? fullName(emps[r.employee_id]) : "?"}</b> {r.task} · {dayLabel(localDay(r.started_at))} {timeLabel(r.started_at)}–{r.ended_at ? timeLabel(r.ended_at) : "now"} · {hm(jobMinutes(r))}{r.pieces != null ? ` · ${r.pieces} pcs` : ""}</li>)}</ul>}
      </div>
    </section>
  );
}
