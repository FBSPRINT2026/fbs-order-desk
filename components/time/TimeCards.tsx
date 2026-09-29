"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KIND_LABEL, addDays, dayLabel, daysBetween, dec, fullName, hm, localDay, localMinutes, localToIso, periodOf, timeLabel, timecard, type Punch, type TimeOff } from "@/lib/timeclock";
import { isBoss, type TimeData } from "./types";

/**
 * Timecards for a pay period: regular, overtime (over the weekly limit), breaks and time off per person, each day's
 * punches, fixes (edit a time, add a missed punch, void one — the original is kept), approval, and the payroll file.
 */
export default function TimeCards({ d }: { d: TimeData }) {
  const [start, setStart] = useState(() => periodOf(d.settings, localDay(new Date())).start);
  const period = periodOf(d.settings, start);
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [offs, setOffs] = useState<TimeOff[]>([]);
  const [pay, setPay] = useState<Record<string, { rate: number | null; salary: number | null }>>({});
  const [approved, setApproved] = useState<{ approved_at: string | null; approved_by: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ emp: string; punch?: Punch; day: string } | null>(null);
  const boss = isBoss(d);

  const load = useCallback(async () => {
    const sb = createClient();
    // a day of slack on each side so shifts across midnight and open punches are seen
    const from = new Date(Date.parse(addDays(period.start, -1) + "T00:00:00Z")).toISOString(), to = new Date(Date.parse(addDays(period.end, 2) + "T00:00:00Z")).toISOString();
    const [{ data: p }, { data: o }, { data: ap }, pr] = await Promise.all([
      sb.from("time_punches").select("*").gte("at", from).lt("at", to).order("at"),
      sb.from("time_off").select("*").lte("starts_on", period.end).gte("ends_on", period.start),
      sb.from("time_periods").select("approved_at, approved_by").eq("starts_on", period.start).maybeSingle(),
      boss ? sb.from("employee_pay").select("employee_id, rate, salary") : Promise.resolve({ data: [] }),
    ]);
    setPunches((p || []) as Punch[]); setOffs((o || []) as TimeOff[]); setApproved(ap || null);
    setPay(Object.fromEntries(((pr.data || []) as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, { rate: x.rate, salary: x.salary }])));
  }, [period.start, period.end, boss]);
  useEffect(() => { load(); }, [load]);

  const cards = useMemo(() => {
    if (!punches) return [];
    const ids = new Set([...d.employees.filter((e) => e.active).map((e) => e.id), ...punches.map((p) => p.employee_id), ...offs.map((o) => o.employee_id)]);
    return d.employees.filter((e) => ids.has(e.id)).map((e) => ({ e, c: timecard(d.settings, e.id, punches, offs, period.start, period.end) }));
  }, [punches, offs, d.employees, d.settings, period.start, period.end]);
  const tot = cards.reduce((a, { c }) => ({ reg: a.reg + c.regular, ot: a.ot + c.overtime, off: a.off + c.pto + c.sick + c.holiday, issues: a.issues + c.issues.length }), { reg: 0, ot: 0, off: 0, issues: 0 });
  const days = Array.from({ length: daysBetween(period.start, period.end) + 1 }, (_, i) => addDays(period.start, i));

  function exportCsv() {
    const head = ["Employee", "Employee ID", "Department", "Period Start", "Period End", "Regular Hours", "Overtime Hours", "PTO Hours", "Sick Hours", "Holiday Hours", "Unpaid Hours", "Total Paid Hours", ...(boss ? ["Pay Rate", "Gross Pay"] : [])];
    const rows = cards.map(({ e, c }) => {
      const r = pay[e.id]?.rate ?? null;
      const paid = c.regular + c.overtime + c.pto + c.sick + c.holiday;
      const gross = r != null ? (c.regular / 60) * r + (c.overtime / 60) * r * 1.5 + ((c.pto + c.sick + c.holiday) / 60) * r : null;
      return [fullName(e), e.uattend_id || e.id.slice(0, 8), e.department, period.start, period.end, dec(c.regular), dec(c.overtime), dec(c.pto), dec(c.sick), dec(c.holiday), dec(c.unpaid), dec(paid), ...(boss ? [r != null ? r.toFixed(2) : "", gross != null ? gross.toFixed(2) : ""] : [])];
    });
    const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `payroll-${period.start}-to-${period.end}.csv`; a.click();
  }
  async function approve(on: boolean) {
    const sb = createClient();
    await sb.from("time_periods").upsert({ starts_on: period.start, ends_on: period.end, approved_at: on ? new Date().toISOString() : null, approved_by: on ? d.me : null });
    load();
  }

  return (
    <div className="tmx">
      <div className="tmx-bar">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(period.start, -1))} aria-label="Previous period">←</button>
          <b className="tmx-period">{dayLabel(period.start)} – {dayLabel(period.end)}</b>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(period.end, 1))} aria-label="Next period">→</button>
          <button type="button" className="linkbtn" onClick={() => setStart(periodOf(d.settings, localDay(new Date())).start)}>This period</button>
        </div>
        <span className="spacer" />
        {approved?.approved_at ? <span className="tmx-ok">✓ Approved by {approved.approved_by} {new Date(approved.approved_at).toLocaleDateString()}{boss && <button type="button" className="linkbtn" onClick={() => approve(false)}> Undo</button>}</span>
          : boss && <button type="button" className="btn" disabled={tot.issues > 0} title={tot.issues ? "Fix the missed punches first" : ""} onClick={() => approve(true)}>Approve Period</button>}
        <button type="button" className="btn primary" onClick={exportCsv} disabled={!cards.length}>Payroll Export (CSV)</button>
      </div>
      <div className="sc-kpis tmx-kpis">
        <div className="sc-kpi blue"><span>Regular</span><b>{dec(tot.reg)}</b><small>hours</small></div>
        <div className={"sc-kpi " + (tot.ot ? "orange" : "")}><span>Overtime</span><b>{dec(tot.ot)}</b><small>over {d.settings.otWeekly} a week</small></div>
        <div className="sc-kpi teal"><span>Time Off</span><b>{dec(tot.off)}</b><small>PTO, sick, holiday</small></div>
        <div className={"sc-kpi " + (tot.issues ? "bad" : "")}><span>To Fix</span><b>{tot.issues}</b><small>missed or odd punches</small></div>
        <div className="sc-kpi"><span>People</span><b>{cards.length}</b><small>on this period</small></div>
      </div>
      <section className="db-card db-blue">
        {punches === null ? <div className="db-empty">Loading…</div> : !cards.length ? <div className="db-empty">No hours in this period.</div> : (
          <table className="rv-tbl tmx-tbl">
            <thead><tr><th>Employee</th><th className="r">Regular</th><th className="r">Overtime</th><th className="r">Breaks</th><th className="r">Time Off</th><th className="r">Total Paid</th><th>Flags</th></tr></thead>
            <tbody>{cards.map(({ e, c }) => (
              <Fragment key={e.id}>
                <tr className={"tmx-emp" + (open === e.id ? " on" : "")} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td><b>{fullName(e)}</b><div className="faint">{e.department}</div></td>
                  <td className="r num">{dec(c.regular)}</td>
                  <td className={"r num" + (c.overtime ? " tmx-ot" : "")}>{dec(c.overtime)}</td>
                  <td className="r num">{hm(c.breaks)}</td>
                  <td className="r num">{dec(c.pto + c.sick + c.holiday)}</td>
                  <td className="r num"><b>{dec(c.regular + c.overtime + c.pto + c.sick + c.holiday)}</b></td>
                  <td>{c.issues.length ? <span className="tmx-flag">{c.issues.length} to fix</span> : <span className="faint">—</span>}</td>
                </tr>
                {open === e.id && (
                  <tr className="tmx-detail"><td colSpan={7}>
                    <div className="tmx-days">{days.map((day) => {
                      const dh = c.days[day];
                      const ps = (punches || []).filter((p) => p.employee_id === e.id && localDay(p.at) === day);
                      return (
                        <div key={day} className={"tmx-day" + (dh?.issues.length ? " bad" : "")}>
                          <div className="tmx-dh"><b>{dayLabel(day)}</b><span className="num">{dh ? hm(dh.worked) : "0:00"}</span></div>
                          {ps.map((p) => (
                            <button key={p.id} type="button" className={"tmx-pp " + p.kind + (p.voided ? " void" : "") + (p.original_at ? " edited" : "")} onClick={() => setEdit({ emp: e.id, punch: p, day })} title={[p.source, p.original_at ? `was ${timeLabel(p.original_at)}, changed by ${p.edited_by}` : "", p.note].filter(Boolean).join(" · ")}>
                              {KIND_LABEL[p.kind].replace("Clock ", "")} <b>{timeLabel(p.at)}</b>{p.original_at ? " ✎" : ""}{p.voided ? " (voided)" : ""}
                            </button>
                          ))}
                          {dh?.issues.map((i, k) => <div key={k} className="tmx-issue">{i.text}</div>)}
                          <button type="button" className="linkbtn tmx-add" onClick={() => setEdit({ emp: e.id, day })}>+ Add punch</button>
                        </div>
                      );
                    })}</div>
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </section>
      {edit && <PunchEditor d={d} emp={edit.emp} day={edit.day} punch={edit.punch} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/** Fix a punch: change its time (the original is kept), void it, or add a missed one. */
function PunchEditor({ d, emp, day, punch, onClose, onSaved }: { d: TimeData; emp: string; day: string; punch?: Punch; onClose: () => void; onSaved: () => void }) {
  const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [date, setDate] = useState(punch ? localDay(punch.at) : day);
  const [time, setTime] = useState(punch ? toHHMM(localMinutes(punch.at)) : "08:00");
  const [kind, setKind] = useState<Punch["kind"]>(punch?.kind || "in");
  const [note, setNote] = useState(punch?.note || "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const name = fullName(d.employees.find((e) => e.id === emp) || { first_name: "", last_name: "" });
  async function save(voidIt = false) {
    setBusy(true); setErr("");
    const sb = createClient();
    const [h, m] = time.split(":").map(Number);
    const at = localToIso(date, h * 60 + m);
    const now = new Date().toISOString();
    const r = punch
      ? await sb.from("time_punches").update(voidIt ? { voided: !punch.voided, edited_by: d.me, edited_at: now, note } : { at, kind, note, original_at: punch.original_at || (at !== punch.at ? punch.at : null), edited_by: d.me, edited_at: now }).eq("id", punch.id)
      : await sb.from("time_punches").insert({ employee_id: emp, kind, at, source: "manual", note, edited_by: d.me, edited_at: now });
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Punch">
        <div className="pp-sheet-h"><b>{punch ? "Fix Punch" : "Add Punch"} · {name}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <label>Punch<select value={kind} onChange={(e) => setKind(e.target.value as Punch["kind"])}>{(Object.keys(KIND_LABEL) as Punch["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <div className="tmx-2"><label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label></div>
          <label>Note (why it changed)<input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Forgot to clock out, etc." /></label>
          {punch?.original_at && <div className="faint">Originally {new Date(punch.original_at).toLocaleString("en-US", { timeZone: "America/Chicago" })} · changed by {punch.edited_by}</div>}
          {punch && <div className="faint">From: {punch.source}</div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {punch && <button type="button" className="btn danger" disabled={busy} onClick={() => save(true)}>{punch.voided ? "Restore" : "Void"}</button>}
            <button type="button" className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
