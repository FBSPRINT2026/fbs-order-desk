"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayLabel, fullName, hm, localDay, localMinutes, localToIso, timeLabel, weekOf, type Shift } from "@/lib/timeclock";
import type { TimeData } from "./types";

/** The weekly schedule: people down the side, days across; tap a day to add or change a shift. Copy last week in one click. */
export default function TimeSchedule({ d }: { d: TimeData }) {
  const [start, setStart] = useState(() => weekOf(d.settings, localDay(new Date())).start);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [edit, setEdit] = useState<{ emp: string; day: string; shift?: Shift } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dept, setDept] = useState("");
  const load = useCallback(async () => {
    const sb = createClient();
    const { data } = await sb.from("shifts").select("*").gte("starts_at", new Date(Date.parse(start + "T00:00:00Z") - 12 * 3600000).toISOString()).lt("starts_at", new Date(Date.parse(addDays(start, 8) + "T00:00:00Z")).toISOString()).order("starts_at");
    setShifts(((data || []) as Shift[]).filter((s) => localDay(s.starts_at) >= start && localDay(s.starts_at) <= addDays(start, 6)));
  }, [start]);
  useEffect(() => { load(); }, [load]);
  const emps = d.employees.filter((e) => e.active && (!dept || e.department === dept));
  const cell = (emp: string, day: string) => (shifts || []).filter((s) => s.employee_id === emp && localDay(s.starts_at) === day);
  const mins = (s: Shift) => (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000;
  const perDay = useMemo(() => days.map((day) => (shifts || []).filter((s) => localDay(s.starts_at) === day && emps.some((e) => e.id === s.employee_id)).length), [shifts, days, emps]);

  async function copyLastWeek() {
    setBusy(true);
    const sb = createClient();
    const prev = addDays(start, -7);
    const { data } = await sb.from("shifts").select("*").gte("starts_at", new Date(Date.parse(prev + "T00:00:00Z") - 12 * 3600000).toISOString()).lt("starts_at", new Date(Date.parse(start + "T00:00:00Z") + 12 * 3600000).toISOString());
    const src = ((data || []) as Shift[]).filter((s) => localDay(s.starts_at) >= prev && localDay(s.starts_at) < start);
    const have = new Set((shifts || []).map((s) => s.employee_id + localDay(s.starts_at)));
    const rows = src.filter((s) => !have.has(s.employee_id + addDays(localDay(s.starts_at), 7))).map((s) => {
      const day = addDays(localDay(s.starts_at), 7);
      return { employee_id: s.employee_id, starts_at: localToIso(day, localMinutes(s.starts_at)), ends_at: localToIso(localDay(s.ends_at) > localDay(s.starts_at) ? addDays(day, 1) : day, localMinutes(s.ends_at)), station: s.station, note: s.note, created_by: d.me };
    });
    if (rows.length) await sb.from("shifts").insert(rows);
    setBusy(false); load();
  }

  return (
    <div className="tmx">
      <div className="tmx-bar">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">←</button>
          <b className="tmx-period">Week of {dayLabel(start)}</b>
          <button type="button" className="btn sm" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">→</button>
          <button type="button" className="linkbtn" onClick={() => setStart(weekOf(d.settings, localDay(new Date())).start)}>This week</button>
        </div>
        <span className="spacer" />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" style={{ width: "auto" }}><option value="">All departments</option>{d.settings.departments.map((x) => <option key={x}>{x}</option>)}</select>
        <button type="button" className="btn" disabled={busy} onClick={copyLastWeek}>{busy ? "Copying…" : "Copy Last Week"}</button>
      </div>
      <section className="db-card db-salmon tmx-sched-card">
        {shifts === null ? <div className="db-empty">Loading…</div> : !emps.length ? <div className="db-empty">No employees yet.</div> : (
          <div className="tmx-sched" style={{ gridTemplateColumns: `minmax(120px,1.3fr) repeat(7, minmax(0,1fr)) 60px` }}>
            <div className="tmx-sh h" />
            {days.map((day, i) => <div key={day} className={"tmx-sh h" + (day === localDay(new Date()) ? " today" : "")}>{dayLabel(day).split(",")[0]}<small>{dayLabel(day).split(", ")[1]} · {perDay[i]}</small></div>)}
            <div className="tmx-sh h r">Hours</div>
            {emps.map((e) => {
              const total = days.reduce((a, day) => a + cell(e.id, day).reduce((b, s) => b + mins(s), 0), 0);
              return [
                <div key={e.id + "n"} className="tmx-sh n"><b>{fullName(e)}</b><small>{e.department}</small></div>,
                ...days.map((day) => (
                  <div key={e.id + day} data-d={dayLabel(day).split(",")[0] + " " + dayLabel(day).split(", ")[1]} className={"tmx-sh c" + (day === localDay(new Date()) ? " today" : "")}>
                    {cell(e.id, day).map((s) => <button key={s.id} type="button" className="tmx-shift" onClick={() => setEdit({ emp: e.id, day, shift: s })}>{timeLabel(s.starts_at).replace(":00", "").replace(" ", "").toLowerCase()}–{timeLabel(s.ends_at).replace(":00", "").replace(" ", "").toLowerCase()}{s.station ? <small>{s.station}</small> : null}</button>)}
                    {!cell(e.id, day).length && <button type="button" className="tmx-plus" onClick={() => setEdit({ emp: e.id, day })} aria-label={`Add a shift for ${fullName(e)} on ${dayLabel(day)}`}>+</button>}
                  </div>
                )),
                <div key={e.id + "t"} data-d="Week" className={"tmx-sh t" + (total > d.settings.otWeekly * 60 ? " over" : "")}>{hm(total)}</div>,
              ];
            })}
          </div>
        )}
      </section>
      {edit && <ShiftEditor d={d} {...edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ShiftEditor({ d, emp, day, shift, onClose, onSaved }: { d: TimeData; emp: string; day: string; shift?: Shift; onClose: () => void; onSaved: () => void }) {
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const [from, setFrom] = useState(shift ? t(localMinutes(shift.starts_at)) : "08:00");
  const [to, setTo] = useState(shift ? t(localMinutes(shift.ends_at)) : "16:30");
  const [station, setStation] = useState(shift?.station || "");
  const [repeat, setRepeat] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const name = fullName(d.employees.find((e) => e.id === emp) || { first_name: "", last_name: "" });
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekOf(d.settings, day).start, i));
  const iso = (dd: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return localToIso(dd, h * 60 + m); };
  async function save(del = false) {
    setBusy(true); setErr("");
    const sb = createClient();
    const overnight = to <= from;
    const row = (dd: string) => ({ employee_id: emp, starts_at: iso(dd, from), ends_at: iso(overnight ? addDays(dd, 1) : dd, to), station, created_by: d.me });
    let r;
    if (shift && del) r = await sb.from("shifts").delete().eq("id", shift.id);
    else if (shift) r = await sb.from("shifts").update(row(day)).eq("id", shift.id);
    else r = await sb.from("shifts").insert([day, ...repeat.filter((x) => x !== day)].map(row));
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  }
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Shift">
        <div className="pp-sheet-h"><b>{shift ? "Change Shift" : "Add Shift"} · {name} · {dayLabel(day)}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="tmx-2"><label>Starts<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Ends<input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
          <label>Station / press (optional)<input type="text" value={station} onChange={(e) => setStation(e.target.value)} placeholder="Press 2, Embroidery, Shipping…" /></label>
          {!shift && <div><div className="lbl" style={{ marginBottom: 4 }}>Same shift on</div><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{week.map((x) => <label key={x} className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={x === day || repeat.includes(x)} disabled={x === day} onChange={(e) => setRepeat(e.target.checked ? [...repeat, x] : repeat.filter((y) => y !== x))} />{dayLabel(x).split(",")[0]}</label>)}</div></div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {shift && <button type="button" className="btn danger" disabled={busy} onClick={() => save(true)}>Remove Shift</button>}
            <button type="button" className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
