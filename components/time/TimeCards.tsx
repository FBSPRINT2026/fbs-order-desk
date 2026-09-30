"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KIND_LABEL, addDays, dayLabel, daysBetween, dec, fullName, hm, localDay, localMinutes, localToIso, periodOf, timeLabel, timecard, type Punch, type TimeOff } from "@/lib/timeclock";
import { useSticky } from "@/lib/useSticky";
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
  const [edit, setEdit] = useState<{ emp: string; punch?: Punch; day: string; kind?: Punch["kind"] } | null>(null);
  // Summary (hours per person) or Punches (every in and out, day by day, for everyone)
  const [view, setView] = useSticky<"summary" | "punches">("time.cardsView", "summary");
  const [q, setQ] = useState("");
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
      <div className="tmx-vbar">
        <div className="rv-seg">{([["summary", "Summary"], ["punches", "All Punches"]] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
        {view === "punches" && <input className="tmx-q" type="search" placeholder="Find someone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find someone" />}
      </div>
      {view === "punches" ? (
        punches === null ? <div className="db-empty">Loading…</div> : !cards.length ? <div className="db-empty">No hours in this period.</div> : (
          <div className="tpl-list">
            {cards.filter(({ e }) => !q.trim() || fullName(e).toLowerCase().includes(q.trim().toLowerCase())).map(({ e, c }) => (
              <PunchList key={e.id} e={e} c={c} days={days} punches={punches} otWeekly={d.settings.otWeekly} onEdit={(punch, day, kind) => setEdit({ emp: e.id, punch, day, kind })} />
            ))}
          </div>
        )
      ) : (
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
                    <PunchList e={e} c={c} days={days} punches={punches || []} otWeekly={d.settings.otWeekly} bare onEdit={(punch, day, kind) => setEdit({ emp: e.id, punch, day, kind })} />
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </section>
      )}
      {edit && <PunchEditor d={d} emp={edit.emp} day={edit.day} punch={edit.punch} kind0={edit.kind} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/** Fix a punch: change its time (the original is kept), void it, or add a missed one. */
function PunchEditor({ d, emp, day, punch, kind0, onClose, onSaved }: { d: TimeData; emp: string; day: string; punch?: Punch; kind0?: Punch["kind"]; onClose: () => void; onSaved: () => void }) {
  const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [date, setDate] = useState(punch ? localDay(punch.at) : day);
  const [time, setTime] = useState(punch ? toHHMM(localMinutes(punch.at)) : kind0 === "out" ? "16:00" : "08:00");
  const [kind, setKind] = useState<Punch["kind"]>(punch?.kind || kind0 || "in");
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

const t12 = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`; };
type Seg = { a: number; b: number | null; inP: Punch; outP: Punch | null; brk: boolean };
/** a day's punches as in → out stretches (a break splits one); an in with nothing after it is left open */
function pairsOf(ps: Punch[]): Seg[] {
  const out: Seg[] = [];
  let cur: { p: Punch; brk: boolean } | null = null;
  for (const p of ps) {
    if (p.kind === "in" || p.kind === "break_end") { if (cur) out.push({ a: localMinutes(cur.p.at), b: null, inP: cur.p, outP: null, brk: cur.brk }); cur = { p, brk: p.kind === "break_end" }; }
    else if (cur) { out.push({ a: localMinutes(cur.p.at), b: localMinutes(p.at), inP: cur.p, outP: p, brk: cur.brk }); cur = null; }
  }
  if (cur) out.push({ a: localMinutes(cur.p.at), b: null, inP: cur.p, outP: null, brk: cur.brk });
  return out;
}

/**
 * One person's pay period as a list: each day (Friday → Thursday), a bar of the day from early morning to evening with
 * the time they were on the clock, their ins and outs (tap one to fix it), and the day's hours. A day with no
 * clock-out shows it in red; hours past the weekly overtime line are marked.
 */
function PunchList({ e, c, days, punches, otWeekly, onEdit, bare }: { e: { id: string; first_name: string; last_name: string; department: string }; c: ReturnType<typeof timecard>; days: string[]; punches: Punch[]; otWeekly: number; onEdit: (p: Punch | undefined, day: string, kind?: Punch["kind"]) => void; bare?: boolean }) {
  const today = localDay(new Date()), nowMin = localMinutes(new Date());
  const mine = punches.filter((p) => p.employee_id === e.id && !p.voided).sort((a, b) => a.at.localeCompare(b.at));
  const byDay = days.map((day) => ({ day, segs: pairsOf(mine.filter((p) => localDay(p.at) === day)) }));
  // the bar spans 5 AM – 7 PM, stretched for anyone earlier or later
  const all = byDay.flatMap((x) => x.segs.flatMap((s) => [s.a, s.b ?? s.a]));
  const lo = Math.min(300, ...all.map((m) => Math.floor(m / 60) * 60)), hi = Math.max(1140, ...all.map((m) => Math.ceil(m / 60) * 60));
  const pct = (m: number) => `${((Math.max(lo, Math.min(hi, m)) - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo + i * 60).filter((m) => (m - lo) % 180 === 0);
  let cum = 0;
  const cap = otWeekly * 60, total = c.regular + c.overtime;
  const initials = `${e.first_name[0] || ""}${e.last_name[0] || ""}`.toUpperCase();
  return (
    <section className={"tpl" + (bare ? " bare" : "")}>
      {!bare && (
        <div className="tpl-h">
          <span className="tpl-av" aria-hidden>{initials}</span>
          <div className="tpl-n"><b>{e.last_name ? `${e.last_name}, ${e.first_name}` : e.first_name}</b><small>{e.department || "\u00a0"}</small></div>
          <span className="spacer" />
          <span className="tpl-tot"><b className="num">{hm(total)}</b><small>worked</small></span>
          {c.overtime > 0 && <span className="tpl-tot ot"><b className="num">{hm(c.overtime)}</b><small>overtime</small></span>}
          {c.issues.length > 0 && <span className="tpl-flag">{c.issues.length} to fix</span>}
        </div>
      )}
      <div className="tpl-rows">
        <div className="tpl-r tpl-axis" aria-hidden><span /><div className="tpl-track">{ticks.map((m) => <i key={m} style={{ left: pct(m) }}>{t12(m).replace(":00", "")}</i>)}</div><span /><span /></div>
        {byDay.map(({ day, segs }) => {
          const dh = c.days[day], w = dh?.worked || 0, before = cum; cum += w;
          const ot = Math.max(0, cum - Math.max(cap, before));
          const dl = dayLabel(day).split(", ");
          const isToday = day === today;
          return (
            <div key={day} className={"tpl-r" + (segs.length ? "" : " none") + (isToday ? " today" : "") + (dh?.issues.length ? " bad" : "")}>
              <div className="tpl-d"><b>{dl[0]}</b><small>{dl[1] || ""}</small></div>
              <div className="tpl-track">
                {ticks.map((m) => <i key={m} className="g" style={{ left: pct(m) }} />)}
                {segs.map((s, k) => {
                  const end = s.b ?? (isToday ? nowMin : Math.min(hi, s.a + 60));
                  return <span key={k} className={"tpl-seg" + (s.b == null ? (isToday ? " live" : " open") : "")} style={{ left: pct(s.a), width: `calc(${pct(end)} - ${pct(s.a)})` }} title={`${t12(s.a)} – ${s.b != null ? t12(s.b) : isToday ? "now" : "no clock-out"}`} />;
                })}
              </div>
              <div className="tpl-ps">
                {!segs.length ? <span className="faint">No punches</span> : segs.map((s, k) => (
                  <span key={k} className="tpl-pair">
                    <button type="button" className={"tpl-p in" + (s.inP.original_at ? " ed" : "")} onClick={() => onEdit(s.inP, day)} title={`${s.brk ? "Back from break" : "In"} ${timeLabel(s.inP.at)} · ${s.inP.source}${s.inP.original_at ? ` · changed (was ${timeLabel(s.inP.original_at)})` : ""}`}>{t12(s.a)}</button>
                    <span className="tpl-dash" aria-hidden>→</span>
                    {s.outP ? <button type="button" className={"tpl-p out" + (s.outP.original_at ? " ed" : "")} onClick={() => onEdit(s.outP!, day)} title={`${s.outP.kind === "break_start" ? "Break" : "Out"} ${timeLabel(s.outP.at)} · ${s.outP.source}`}>{t12(s.b!)}</button>
                      : isToday ? <span className="tpl-p live">on the clock</span>
                      : <button type="button" className="tpl-p miss" onClick={() => onEdit(undefined, day, "out")} title="No clock-out: add it">missing out</button>}
                  </span>
                ))}
                <button type="button" className="tpl-add" onClick={() => onEdit(undefined, day)} aria-label={`Add a punch on ${dayLabel(day)}`} title="Add a punch">+</button>
              </div>
              <div className="tpl-hrs num">{w ? hm(w) : "—"}{ot > 0 && <small className="ot">{hm(ot)} OT</small>}</div>
            </div>
          );
        })}
        <div className="tpl-r tpl-foot"><div className="tpl-d"><b>Total</b></div><div /><div className="tpl-ps faint">{c.overtime > 0 ? `${hm(c.regular)} regular + ${hm(c.overtime)} overtime` : `${hm(c.regular)} regular`}</div><div className="tpl-hrs num"><b>{hm(total)}</b></div></div>
      </div>
    </section>
  );
}
