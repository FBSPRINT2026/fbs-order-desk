"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, dec, fullName, hm, jobKey, jobMinutes, localDay, localToIso, timecard, type JobTime, type Punch } from "@/lib/timeclock";
import { money, payMoney } from "@/lib/format";
import type { TeamData } from "./types";

type Ord = { key: string; label: string; customer: string; qty: number; total: number; href: string };

/**
 * Efficiency from logged job time: per job (labor hours, cost, pieces per labor hour, labor as % of the price),
 * per task (how long setup / printing / folding usually takes), and per person (job hours vs clocked hours).
 * Cost uses each person's hourly rate (owners and admins only).
 */
export default function TeamEfficiency({ d }: { d: TeamData }) {
  /** labor cost: owners / admins and the "pay" permission; order totals and labor % stay owner / admin */
  const pay = d.boss || !!d.seesPay;
  const [to, setTo] = useState(localDay(new Date())); const [from, setFrom] = useState(addDays(localDay(new Date()), -29));
  const [rows, setRows] = useState<JobTime[] | null>(null);
  const [orders, setOrders] = useState<Record<string, Ord>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [punches, setPunches] = useState<Punch[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = createClient();
    const lo = localToIso(from, 0), hi = localToIso(addDays(to, 1), 0);
    const [{ data: j }, pr, { data: p }] = await Promise.all([
      sb.from("job_time").select("*").eq("voided", false).gte("started_at", lo).lt("started_at", hi).limit(10000),
      pay ? sb.from("employee_pay").select("employee_id, rate, salary") : Promise.resolve({ data: [] }),
      sb.from("time_punches").select("*").eq("voided", false).gte("at", lo).lt("at", hi).limit(20000),
    ]);
    const js = (j || []) as JobTime[];
    setRows(js); setPunches((p || []) as Punch[]);
    setRates(Object.fromEntries(((pr.data || []) as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, x.rate != null ? +x.rate : x.salary ? +x.salary / 2080 : 0])));
    const oIds = [...new Set(js.map((x) => x.order_id).filter(Boolean))] as string[], aIds = [...new Set(js.map((x) => x.archived_order_id).filter(Boolean))] as string[];
    const [{ data: os }, { data: as }] = await Promise.all([
      oIds.length ? sb.from("orders").select("id, number, nickname, qty, total, customer_id").in("id", oIds) : Promise.resolve({ data: [] }),
      aIds.length ? sb.from("archived_orders").select("id, visual_id, nickname, qty, total, customer_id").in("id", aIds) : Promise.resolve({ data: [] }),
    ]);
    const cIds = [...new Set([...((os || []) as { customer_id: string | null }[]), ...((as || []) as { customer_id: string | null }[])].map((x) => x.customer_id).filter(Boolean))] as string[];
    const { data: cs } = cIds.length ? await sb.from("customers").select("id, company, name").in("id", cIds) : { data: [] };
    const cn = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name]));
    const m: Record<string, Ord> = {};
    for (const o of (os || []) as { id: string; number: number; nickname: string; qty: number; total: number; customer_id: string | null }[]) m["o:" + o.id] = { key: "o:" + o.id, label: `#${o.number} ${o.nickname || ""}`.trim(), customer: cn.get(o.customer_id || "") || "", qty: +o.qty || 0, total: +o.total || 0, href: `/shop/orders/${o.id}` };
    for (const o of (as || []) as { id: string; visual_id: string; nickname: string; qty: number; total: number; customer_id: string | null }[]) m["a:" + o.id] = { key: "a:" + o.id, label: `#${o.visual_id} ${o.nickname || ""}`.trim(), customer: cn.get(o.customer_id || "") || "", qty: +o.qty || 0, total: +o.total || 0, href: `/shop/archive/${o.id}` };
    setOrders(m);
  }, [from, to, pay]);
  useEffect(() => { load(); }, [load]);

  const cost = (r: JobTime) => (jobMinutes(r) / 60) * (rates[r.employee_id] || 0);
  const v = useMemo(() => {
    const rs = rows || [];
    const byJob = new Map<string, JobTime[]>(), byTask = new Map<string, JobTime[]>(), byEmp = new Map<string, JobTime[]>();
    for (const r of rs) {
      const k = jobKey(r); byJob.set(k, [...(byJob.get(k) || []), r]);
      byTask.set(r.task || "—", [...(byTask.get(r.task || "—") || []), r]);
      byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) || []), r]);
    }
    const mins = (l: JobTime[]) => l.reduce((a, r) => a + jobMinutes(r), 0);
    const jobs = [...byJob.entries()].map(([k, l]) => {
      const o = orders[k]; const m = mins(l), c = l.reduce((a, r) => a + cost(r), 0);
      const tasks = new Map<string, number>(); for (const r of l) tasks.set(r.task, (tasks.get(r.task) || 0) + jobMinutes(r));
      return { k, o, label: o?.label || l[0].job_label, m, c, people: new Set(l.map((r) => r.employee_id)).size, pph: o?.qty && m ? o.qty / (m / 60) : null, pct: o?.total ? (c / o.total) * 100 : null, tasks: [...tasks.entries()].sort((a, b) => b[1] - a[1]), last: l.reduce((a, r) => (r.started_at > a ? r.started_at : a), "") };
    }).sort((a, b) => b.last.localeCompare(a.last));
    const tasks = [...byTask.entries()].map(([t, l]) => {
      const withP = l.filter((r) => r.pieces != null && r.ended_at);
      const pm = mins(withP), pcs = withP.reduce((a, r) => a + (r.pieces || 0), 0);
      return { t, m: mins(l), n: l.length, jobs: new Set(l.map(jobKey)).size, avgPerJob: mins(l) / Math.max(1, new Set(l.map(jobKey)).size), pph: pm ? pcs / (pm / 60) : null, c: l.reduce((a, r) => a + cost(r), 0) };
    }).sort((a, b) => b.m - a.m);
    const people = [...byEmp.entries()].map(([id, l]) => {
      const e = d.employees.find((x) => x.id === id);
      const clocked = timecard(d.settings, id, punches, [], from, to, new Date().toISOString()).worked;
      const withP = l.filter((r) => r.pieces != null && r.ended_at);
      const pm = mins(withP), pcs = withP.reduce((a, r) => a + (r.pieces || 0), 0);
      return { id, name: e ? fullName(e) : "?", m: mins(l), clocked, util: clocked ? (mins(l) / clocked) * 100 : null, pcs, pph: pm ? pcs / (pm / 60) : null, jobs: new Set(l.map(jobKey)).size };
    }).sort((a, b) => b.m - a.m);
    const total = mins(rs), totalCost = rs.reduce((a, r) => a + cost(r), 0);
    const withQty = jobs.filter((j) => j.pph != null);
    const qty = withQty.reduce((a, j) => a + (j.o?.qty || 0), 0), qm = withQty.reduce((a, j) => a + j.m, 0);
    return { jobs, tasks, people, total, totalCost, pph: qm ? qty / (qm / 60) : null };
  }, [rows, orders, rates, punches, d.employees, d.settings, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tmx">
      <div className="tmx-bar">
        <label className="row" style={{ gap: 6 }}>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} /></label>
        <label className="row" style={{ gap: 6 }}>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} /></label>
        <div className="rv-seg">{[["7 days", 6], ["30 days", 29], ["90 days", 89]].map(([l, n]) => <button key={l} type="button" className={from === addDays(to, -(n as number)) ? "on" : ""} onClick={() => setFrom(addDays(to, -(n as number)))}>{l}</button>)}</div>
      </div>
      <div className="sc-kpis tmx-kpis">
        <div className="sc-kpi blue"><span>Job Hours</span><b>{dec(v.total)}</b><small>logged on jobs</small></div>
        {pay && <div className="sc-kpi orange"><span>Labor Cost</span><b>{payMoney(v.totalCost)}</b><small>at each person&apos;s rate</small></div>}
        <div className="sc-kpi teal"><span>Pieces / Labor Hour</span><b>{v.pph != null ? v.pph.toFixed(1) : "—"}</b><small>order pieces ÷ hours</small></div>
        <div className="sc-kpi"><span>Jobs Worked</span><b>{v.jobs.length}</b><small>{v.people.length} people</small></div>
      </div>
      {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">No job time logged in these dates yet. Once people start logging jobs in the employee app, this fills in.</div> : (<>
        <section className="db-card db-blue">
          <div className="db-card-h"><h2>By Job</h2><span className="faint db-h-note">tap a job for its steps</span></div>
          <table className="rv-tbl tj-tbl"><thead><tr><th>Job</th><th className="r">Labor</th><th className="r">People</th><th className="r">Pieces</th><th className="r">Pcs / Hr</th>{pay && <th className="r">Labor Cost</th>}{d.boss && <><th className="r">Order</th><th className="r">Labor %</th></>}</tr></thead>
            <tbody>{v.jobs.map((j) => (
              <Fragment key={j.k}>
                <tr onClick={() => setOpen(open === j.k ? null : j.k)} style={{ cursor: "pointer" }} className={open === j.k ? "tmx-emp on" : ""}>
                  <td><b>{j.label}</b>{j.o?.customer ? <div className="faint">{j.o.customer}</div> : null}</td>
                  <td className="r num">{hm(j.m)}</td><td className="r num">{j.people}</td><td className="r num">{j.o?.qty || "—"}</td>
                  <td className="r num">{j.pph != null ? j.pph.toFixed(1) : "—"}</td>
                  {pay && <td className="r num">{payMoney(j.c)}</td>}{d.boss && <><td className="r num">{j.o?.total ? money(j.o.total) : "—"}</td><td className={"r num" + (j.pct != null && j.pct > 35 ? " tmx-ot" : "")}>{j.pct != null ? `${j.pct.toFixed(0)}%` : "—"}</td></>}
                </tr>
                {open === j.k && <tr className="tmx-detail"><td colSpan={5 + (pay ? 1 : 0) + (d.boss ? 2 : 0)}><div className="tj-steps">{j.tasks.map(([t, m]) => <span key={t} className="tmx-p">{t} <b>{hm(m)}</b></span>)}{j.o && <a className="linkbtn" href={j.o.href}>Open order →</a>}</div></td></tr>}
              </Fragment>
            ))}</tbody></table>
        </section>
        <div className="dash-row dash-2">
          <section className="db-card db-orange">
            <div className="db-card-h"><h2>By Task</h2><span className="faint db-h-note">how long each step usually takes</span></div>
            <table className="rv-tbl tj-tbl"><thead><tr><th>Task</th><th className="r">Hours</th><th className="r">Jobs</th><th className="r">Avg / Job</th><th className="r">Pcs / Hr</th></tr></thead>
              <tbody>{v.tasks.map((t) => <tr key={t.t}><td><b>{t.t}</b></td><td className="r num">{dec(t.m)}</td><td className="r num">{t.jobs}</td><td className="r num">{hm(t.avgPerJob)}</td><td className="r num">{t.pph != null ? t.pph.toFixed(1) : "—"}</td></tr>)}</tbody></table>
          </section>
          <section className="db-card db-teal">
            <div className="db-card-h"><h2>By Person</h2><span className="faint db-h-note">job time vs time on the clock</span></div>
            <table className="rv-tbl tj-tbl"><thead><tr><th>Employee</th><th className="r">On Jobs</th><th className="r">Clocked</th><th className="r">On Jobs %</th><th className="r">Pcs / Hr</th></tr></thead>
              <tbody>{v.people.map((p) => <tr key={p.id}><td><b>{p.name}</b><div className="faint">{p.jobs} jobs</div></td><td className="r num">{dec(p.m)}</td><td className="r num">{p.clocked ? dec(p.clocked) : "—"}</td><td className="r num">{p.util != null ? `${Math.round(p.util)}%` : "—"}</td><td className="r num">{p.pph != null ? p.pph.toFixed(1) : "—"}</td></tr>)}</tbody></table>
          </section>
        </div>
      </>)}
    </div>
  );
}
