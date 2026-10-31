"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayLabel, fullName, localDay, localToIso, payFor, periodOf, r2, timecard, timeLabel, weekOf, type Employee, type Punch, type TimeOff, type PayLine } from "@/lib/timeclock";
import { isBoss, type TimeData } from "./types";
import { allRows } from "@/lib/readAll";

/**
 * Payroll Report (Oct 20, Nick): one master sheet at the end of each pay period. Every employee's regular and
 * overtime hours, and their pay already worked out: regular pay, overtime pay (time and a half, past 40 hours a
 * week), total. Split by how they're paid: QuickBooks Payroll and Contract Labor. Print it or download it for Excel.
 * Below it, the audit records: every punch (or hours by week) for any dates, everyone, former employees too.
 */
type Row = { e: Employee; pay: PayLine; issues: number };
const $ = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const h2 = (n: number) => n.toFixed(2);

export default function TimePayroll({ d }: { d: TimeData }) {
  const today = localDay(new Date());
  // the last finished pay period, unless they move it
  const [start, setStart] = useState(() => periodOf(d.settings, addDays(periodOf(d.settings, today).start, -1)).start);
  const period = periodOf(d.settings, start);
  const running = period.end >= today;
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [offs, setOffs] = useState<TimeOff[]>([]);
  const [pay, setPay] = useState<Record<string, { rate: number | null; salary: number | null }>>({});
  const [approved, setApproved] = useState<{ approved_at: string | null; approved_by: string | null } | null>(null);
  const [err, setErr] = useState("");
  const boss = isBoss(d);

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: p }, { data: o }, { data: ap }, { data: pr }] = await Promise.all([
      allRows((r0, r1) => sb.from("time_punches").select("*").gte("at", localToIso(addDays(period.start, -1), 0)).lt("at", localToIso(addDays(period.end, 2), 0)).order("at").order("id").range(r0, r1)),
      sb.from("time_off").select("*").lte("starts_on", period.end).gte("ends_on", period.start),
      sb.from("time_periods").select("approved_at, approved_by").eq("starts_on", period.start).maybeSingle(),
      sb.from("employee_pay").select("employee_id, rate, salary"),
    ]);
    setPunches((p || []) as Punch[]); setOffs((o || []) as TimeOff[]); setApproved(ap || null);
    setPay(Object.fromEntries(((pr || []) as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, x])));
  }, [period.start, period.end]);
  useEffect(() => { setPunches(null); load(); }, [load]);

  const rows = useMemo(() => {
    if (!punches) return [] as Row[];
    const worked = new Set([...punches.filter((p) => !p.voided).map((p) => p.employee_id), ...offs.filter((o) => o.status === "approved").map((o) => o.employee_id)]);
    return d.employees
      .filter((e) => worked.has(e.id) || (e.active && e.pay_type === "salary"))
      .map((e) => { const c = timecard(d.settings, e.id, punches, offs, period.start, period.end); return { e, pay: payFor(d.settings, c, pay[e.id], e.pay_type), issues: c.issues.length }; })
      .filter((r) => r.pay.regHours + r.pay.otHours + r.pay.offHours > 0 || (r.e.pay_type === "salary" && r.e.active))
      .sort((a, b) => (a.e.last_name || a.e.first_name).localeCompare(b.e.last_name || b.e.first_name) || a.e.first_name.localeCompare(b.e.first_name));
  }, [punches, offs, pay, d.employees, d.settings, period.start, period.end]);
  const groups = ([["payroll", "QuickBooks Payroll"], ["contract", "Contract Labor"]] as const).map(([k, l]) => ({ k, l, rows: rows.filter((r) => (r.e.paid_by || "payroll") === k) }));
  const sum = (rs: Row[]) => rs.reduce((a, r) => ({ reg: a.reg + r.pay.regHours, ot: a.ot + r.pay.otHours, off: a.off + r.pay.offHours, regPay: a.regPay + (r.pay.regPay || 0), otPay: a.otPay + (r.pay.otPay || 0), offPay: a.offPay + (r.pay.offPay || 0), total: a.total + (r.pay.total || 0) }), { reg: 0, ot: 0, off: 0, regPay: 0, otPay: 0, offPay: 0, total: 0 });
  const all = sum(rows);
  const anyOff = rows.some((r) => r.pay.offHours > 0);
  const toFix = rows.filter((r) => r.issues > 0), noRate = rows.filter((r) => r.pay.total == null);

  async function setPaidBy(e: Employee, to: "payroll" | "contract") {
    setErr("");
    const { error } = await createClient().from("employees").update({ paid_by: to, updated_at: new Date().toISOString() }).eq("id", e.id);
    if (error) return setErr(error.message);
    await d.reload();
  }
  async function approve(on: boolean) {
    await createClient().from("time_periods").upsert({ starts_on: period.start, ends_on: period.end, approved_at: on ? new Date().toISOString() : null, approved_by: on ? d.me : null });
    load();
  }
  function download() {
    const head = ["Paid Through", "Employee", "Clock ID", "Department", "Pay Type", "Rate", "Regular Hours", "Overtime Hours", ...(anyOff ? ["Time Off Hours"] : []), "Regular Pay", "Overtime Pay", ...(anyOff ? ["Time Off Pay"] : []), "Total Pay"];
    const line = (g: string, r: Row) => [g, fullName(r.e), r.e.code ?? "", r.e.department, r.e.pay_type === "salary" ? "Salary" : "Hourly", r.e.pay_type === "salary" ? (r.pay.salary ?? "") : (r.pay.rate ?? ""), h2(r.pay.regHours), h2(r.pay.otHours), ...(anyOff ? [h2(r.pay.offHours)] : []), r.pay.regPay ?? "", r.pay.otPay ?? "", ...(anyOff ? [r.pay.offPay ?? ""] : []), r.pay.total ?? ""];
    const out: (string | number)[][] = [[`Payroll Report, ${dayLabel(period.start)} – ${dayLabel(period.end)}${running ? " (not finished yet)" : ""}`], head];
    for (const g of groups) {
      if (!g.rows.length) continue;
      for (const r of g.rows) out.push(line(g.l, r));
      const s = sum(g.rows);
      out.push([`${g.l} total`, "", "", "", "", "", h2(s.reg), h2(s.ot), ...(anyOff ? [h2(s.off)] : []), r2(s.regPay), r2(s.otPay), ...(anyOff ? [r2(s.offPay)] : []), r2(s.total)]);
    }
    out.push(["All employees", "", "", "", "", "", h2(all.reg), h2(all.ot), ...(anyOff ? [h2(all.off)] : []), r2(all.regPay), r2(all.otPay), ...(anyOff ? [r2(all.offPay)] : []), r2(all.total)]);
    saveCsv(out, `payroll-report-${period.start}-to-${period.end}.csv`);
  }

  return (
    <div className="tmx tk-pay">
      <div className="tmx-bar tk-noprint">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(period.start, -1))} aria-label="Previous pay period">←</button>
          <b className="tmx-period">{dayLabel(period.start)} – {dayLabel(period.end)}</b>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(period.end, 1))} aria-label="Next pay period">→</button>
          <button type="button" className="linkbtn" onClick={() => setStart(periodOf(d.settings, today).start)}>This period</button>
          <button type="button" className="linkbtn" onClick={() => setStart(periodOf(d.settings, addDays(periodOf(d.settings, today).start, -1)).start)}>Last period</button>
        </div>
        <span className="spacer" />
        {approved?.approved_at ? <span className="tmx-ok">✓ Approved by {approved.approved_by} {new Date(approved.approved_at).toLocaleDateString()}{boss && <button type="button" className="linkbtn" onClick={() => approve(false)}> Undo</button>}</span>
          : boss && !running && <button type="button" className="btn" disabled={toFix.length > 0} title={toFix.length ? "Fix the missed punches first" : ""} onClick={() => approve(true)}>Approve Period</button>}
        <button type="button" className="btn" onClick={() => window.print()} disabled={!rows.length}>Print</button>
        <button type="button" className="btn primary" onClick={download} disabled={!rows.length}>Download for Excel</button>
      </div>
      {running && <div className="tmx-note tk-noprint">This pay period isn&apos;t over yet ({dayLabel(period.end)} is the last day). The hours below are so far.</div>}
      {toFix.length > 0 && <div className="tk-warn tk-noprint"><b>{toFix.length === 1 ? "1 person has" : `${toFix.length} people have`} a missed punch:</b> {toFix.map((r) => r.e.first_name).join(", ")}. Their hours may be short. <Link href="/shop/time">Fix on Today</Link></div>}
      {noRate.length > 0 && <div className="tk-warn soft tk-noprint"><b>No pay rate:</b> {noRate.map((r) => fullName(r.e)).join(", ")}. Add it on Employees and their pay fills in.</div>}
      {err && <div className="pv-err">{err}</div>}
      <section className="tk-report">
        <header className="tk-report-h">
          <div><h2>Payroll Report</h2><p>Pay period {dayLabel(period.start)} – {dayLabel(period.end)}, {period.start.slice(0, 4)}{running ? " · so far" : ""}</p></div>
          <div className="tk-report-k">
            <span><small>Regular</small><b className="num">{h2(all.reg)}</b><em>hours</em></span>
            <span className={all.ot ? "ot" : ""}><small>Overtime</small><b className="num">{h2(all.ot)}</b><em>hours</em></span>
            <span className="tot"><small>Total pay</small><b className="num">{$(r2(all.total))}</b><em>{rows.length} people</em></span>
          </div>
        </header>
        {punches === null ? <div className="db-empty">Loading…</div> : !rows.length ? <div className="db-empty">No hours in this pay period.</div> : groups.map((g) => g.rows.length > 0 && (
          <div key={g.k} className={"tk-rgrp " + g.k}>
            <h3>{g.l} <span>{g.rows.length} {g.rows.length === 1 ? "person" : "people"}</span></h3>
            <div className="tk-tbl-wrap">
              <table className="tk-tbl">
                <thead><tr><th>Employee</th><th className="r">Rate</th><th className="r">Regular hrs</th><th className="r">Overtime hrs</th>{anyOff && <th className="r">Time off hrs</th>}<th className="r">Regular pay</th><th className="r">Overtime pay</th>{anyOff && <th className="r">Time off pay</th>}<th className="r">Total pay</th><th className="tk-noprint" /></tr></thead>
                <tbody>{g.rows.map((r) => (
                  <tr key={r.e.id} className={r.issues ? "flag" : ""}>
                    <td><b>{fullName(r.e)}</b>{!r.e.active && <span className="faint"> · former</span>}<small>{[r.e.code ? `ID ${r.e.code}` : "", r.e.department].filter(Boolean).join(" · ")}</small></td>
                    <td className="r num">{r.e.pay_type === "salary" ? <span title="Salary: the year's pay ÷ pay periods">{r.pay.salary ? `$${Math.round(r.pay.salary / 1000)}k/yr` : "Salary"}</span> : r.pay.rate != null ? `$${r.pay.rate.toFixed(2)}` : <span className="bad">no rate</span>}</td>
                    <td className="r num">{h2(r.pay.regHours)}</td>
                    <td className={"r num" + (r.pay.otHours ? " ot" : "")}>{h2(r.pay.otHours)}</td>
                    {anyOff && <td className="r num">{h2(r.pay.offHours)}</td>}
                    <td className="r num">{$(r.pay.regPay)}</td>
                    <td className={"r num" + (r.pay.otPay ? " ot" : "")}>{r.e.pay_type === "salary" ? "—" : $(r.pay.otPay)}</td>
                    {anyOff && <td className="r num">{$(r.pay.offPay)}</td>}
                    <td className="r num"><b>{$(r.pay.total)}</b></td>
                    <td className="tk-noprint">{boss && <button type="button" className="tk-move" onClick={() => setPaidBy(r.e, g.k === "payroll" ? "contract" : "payroll")} title={`Move to ${g.k === "payroll" ? "Contract Labor" : "QuickBooks Payroll"}`}>{g.k === "payroll" ? "→ Contract" : "→ Payroll"}</button>}</td>
                  </tr>
                ))}</tbody>
                <tfoot>{(() => { const s = sum(g.rows); return <tr><td>{g.l} total</td><td /><td className="r num">{h2(s.reg)}</td><td className="r num">{h2(s.ot)}</td>{anyOff && <td className="r num">{h2(s.off)}</td>}<td className="r num">{$(r2(s.regPay))}</td><td className="r num">{$(r2(s.otPay))}</td>{anyOff && <td className="r num">{$(r2(s.offPay))}</td>}<td className="r num"><b>{$(r2(s.total))}</b></td><td className="tk-noprint" /></tr>; })()}</tfoot>
              </table>
            </div>
          </div>
        ))}
        <p className="tk-report-f">Overtime is hours past {d.settings.otWeekly} in a workweek ({dayLabel(weekOf(d.settings, period.start).start).split(",")[0]} – {dayLabel(weekOf(d.settings, period.start).end).split(",")[0]}), paid at {d.settings.otRate || 1.5}× the rate. Hours are rounded to hundredths. Salaried pay is the yearly salary ÷ {d.settings.period === "biweekly" ? 26 : d.settings.period === "weekly" ? 52 : 24}. Printed {new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}.</p>
      </section>
      <AuditExport d={d} />
    </div>
  );
}

function saveCsv(rows: (string | number)[][], name: string) {
  const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = name; a.click();
}

/**
 * Records for an audit (Oct 20, Nick: "I have to be able to go back… and show everybody's punches" to the Department
 * of Labor): every punch for any dates, for everyone (former employees too), with where it came from and any change
 * (original time, who changed it, removed ones marked), or each person's hours by workweek.
 */
function AuditExport({ d }: { d: TimeData }) {
  const today = localDay(new Date());
  const [from, setFrom] = useState(addDays(today, -365)), [to, setTo] = useState(today);
  const [busy, setBusy] = useState(""), [aErr, setAErr] = useState(""), [range, setRange] = useState<{ first: string; count: number } | null>(null);
  useEffect(() => {
    const sb = createClient();
    Promise.all([sb.from("time_punches").select("at").order("at").limit(1), sb.from("time_punches").select("id", { count: "exact", head: true })])
      .then(([a, b]) => setRange({ first: (a.data?.[0]?.at as string) || "", count: b.count || 0 }));
  }, []);
  async function fetchAll(): Promise<Punch[]> {
    const sb = createClient();
    const out: Punch[] = [];
    for (let i = 0; ; i += 1000) {
      setBusy(`Reading punches… ${out.length.toLocaleString()}`);
      const { data, error } = await sb.from("time_punches").select("id, employee_id, kind, at, source, note, original_at, edited_by, edited_at, voided").gte("at", localToIso(from, 0)).lt("at", localToIso(addDays(to, 1), 0)).order("at").order("id").range(i, i + 999);
      if (error) throw new Error(error.message);
      out.push(...((data || []) as Punch[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const emp = new Map(d.employees.map((e) => [e.id, e]));
  async function punchesCsv() {
    setAErr("");
    try {
      const ps = await fetchAll();
      const K = { in: "Clock In", out: "Clock Out", break_start: "Lunch/Break Out", break_end: "Lunch/Break In" } as const;
      const src = (s: string) => ({ uattend: "uAttend clock", zkteco: "Face clock", kiosk: "Tablet clock", phone: "Phone", manual: "Added by a manager" } as Record<string, string>)[s] || s;
      const rows: (string | number)[][] = [["Employee", "Clock ID", "uAttend ID", "Date", "Day", "Time", "Punch", "Recorded by", "Changed", "Original time", "Changed by", "Changed on", "Removed", "Note"]];
      for (const p of ps) {
        const e = emp.get(p.employee_id); const day = localDay(p.at);
        const pe = p as Punch & { edited_at?: string | null };
        rows.push([e ? fullName(e) : p.employee_id, e?.code ?? "", e?.uattend_id ?? "", day, dayLabel(day).split(",")[0], timeLabel(p.at), K[p.kind], src(p.source), p.original_at ? "Yes" : "", p.original_at ? `${localDay(p.original_at)} ${timeLabel(p.original_at)}` : "", p.edited_by || "", pe.edited_at ? localDay(pe.edited_at) : "", p.voided ? "Removed (kept on record)" : "", p.note || ""]);
      }
      saveCsv(rows, `all-punches-${from}-to-${to}.csv`);
    } catch (e) { setAErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  async function weeksCsv() {
    setAErr("");
    try {
      const ps = await fetchAll();
      setBusy("Adding up hours…");
      const rows: (string | number)[][] = [["Employee", "Clock ID", "Week Starting", "Week Ending", "Regular Hours", "Overtime Hours", "Total Hours"]];
      const ids = [...new Set(ps.map((p) => p.employee_id))];
      const people = ids.map((id) => emp.get(id)).filter(Boolean).sort((a, b) => fullName(a!).localeCompare(fullName(b!))) as Employee[];
      for (const e of people) {
        const mine = ps.filter((p) => p.employee_id === e.id);
        for (let w = weekOf(d.settings, from).start; w <= to; w = addDays(w, 7)) {
          const c = timecard(d.settings, e.id, mine, [], w, addDays(w, 6));
          if (c.worked <= 0) continue;
          rows.push([fullName(e), e.code ?? "", w, addDays(w, 6), h2(c.regular / 60), h2(c.overtime / 60), h2(c.worked / 60)]);
        }
      }
      saveCsv(rows, `hours-by-week-${from}-to-${to}.csv`);
    } catch (e) { setAErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  return (
    <section className="db-card tk-audit tk-noprint">
      <div className="db-card-h"><h2>Records for an audit</h2>{range?.first && <span className="faint db-h-note">{range.count.toLocaleString()} punches on file, back to {new Date(range.first).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" })}</span>}</div>
      <p className="faint" style={{ margin: "0 0 10px", fontSize: 13 }}>Everyone&apos;s punches for any dates, former employees included: where each came from (uAttend, the face clock, a manager), and every change with the original time and who made it. Nothing is ever deleted; removed punches stay on record, marked.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="tmx-f">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="tmx-f">To<input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        {range?.first && <button type="button" className="linkbtn" onClick={() => { setFrom(localDay(range.first)); setTo(today); }}>Everything</button>}
        <span className="spacer" />
        <button type="button" className="btn" disabled={!!busy} onClick={weeksCsv}>Hours by week</button>
        <button type="button" className="btn primary" disabled={!!busy} onClick={punchesCsv}>Every punch</button>
      </div>
      {busy && <div className="faint" style={{ marginTop: 6 }}>{busy}</div>}
      {aErr && <div className="pv-err">{aErr}</div>}
    </section>
  );
}
