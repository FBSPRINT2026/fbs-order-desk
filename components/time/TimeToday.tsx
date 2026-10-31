"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KIND_LABEL, withLunch, addDays, dayLabel, daysBetween, fullName, hm, localDay, localMinutes, localToIso, nextKinds, periodOf, timeLabel, timecard, weekOf, type Employee, type Punch, type Shift } from "@/lib/timeclock";
import { timeIssues } from "@/lib/timeIssues";
import { isBoss, type TimeData } from "./types";
import TimeAsk from "./TimeAsk";
import { IssueList, clearIssueCache } from "./TimeBubble";
import { PunchEditor, PunchList } from "./TimeCards";
import { EmployeeEditor } from "./TimeEmployees";
import { useSticky } from "@/lib/useSticky";
import { useRole } from "@/components/RoleContext";
import { allRows } from "@/lib/readAll";

/**
 * Today: the crew board (Oct 20, Nick: "a really nice user interface for myself and Jose Moreno that shows the
 * employees"). Who's on the clock, at lunch, done or not in yet, each with today's time as a bar, today's and this
 * week's hours (overtime marked), anything that needs fixing with a one-tap fix, and "Tell the time clock" to fix
 * the rest in plain words. Tap a person for their whole pay period. Everyone else sees the board without the fixes.
 */
const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#0F8C78", "#7C5CD6", "#D0487A", "#3F7F2E", "#B8621B"];
const greet = () => { const h = +new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function TimeToday({ d }: { d: TimeData }) {
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [who, setWho] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [layout, setLayout] = useSticky<"cards" | "list">("time.todayLayout", "cards");
  const boss = isBoss(d);
  const today = localDay(new Date());
  const period = periodOf(d.settings, today), week = weekOf(d.settings, today);
  // from the earlier of this pay period / two weeks back, for week hours, the pay period and the issues
  const from = [period.start, week.start, addDays(today, -15)].sort()[0];
  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: p }, { data: s }, { data: dm }] = await Promise.all([
      allRows((r0, r1) => sb.from("time_punches").select("*").eq("voided", false).gte("at", localToIso(addDays(from, -1), 0)).order("at").order("id").range(r0, r1)),
      sb.from("shifts").select("*").gte("starts_at", new Date(Date.parse(today + "T00:00:00Z") - 12 * 3600000).toISOString()).lte("starts_at", new Date(Date.parse(today + "T00:00:00Z") + 36 * 3600000).toISOString()),
      sb.from("time_issue_dismissals").select("key").gte("dismissed_at", new Date(Date.now() - 40 * 86400000).toISOString()),
    ]);
    const ps = (p || []) as Punch[];
    setPunches(ps); setShifts(((s || []) as Shift[]).filter((x) => localDay(x.starts_at) === today));
    setDismissed(new Set(((dm || []) as { key: string }[]).map((x) => x.key)));
    const withPhoto = ps.filter((x) => x.photo_path && localDay(x.at) === today);
    if (withPhoto.length) {
      const { data: sg } = await sb.storage.from("timeclock").createSignedUrls(withPhoto.map((x) => x.photo_path!), 3600);
      const m: Record<string, string> = {}; withPhoto.forEach((x, i) => { if (sg?.[i]?.signedUrl) m[x.id] = sg[i].signedUrl!; }); setPhotos(m);
    }
  }, [today, from]);
  useEffect(() => { load(); const t = setInterval(load, 60000); const re = () => load(); window.addEventListener("fbs:time-changed", re); return () => { clearInterval(t); window.removeEventListener("fbs:time-changed", re); }; }, [load]);
  const changed = () => { clearIssueCache(); load(); };

  const rows = useMemo(() => {
    if (!punches) return [];
    const nowMin = localMinutes(new Date());
    const ids = new Set([...d.employees.filter((e) => e.active).map((e) => e.id), ...punches.filter((p) => localDay(p.at) === today).map((p) => p.employee_id)]);
    return d.employees.filter((e) => ids.has(e.id)).map((e, i) => {
      const mine = punches.filter((p) => p.employee_id === e.id);
      const card = timecard(d.settings, e.id, mine, [], today, today);
      const wk = timecard(d.settings, e.id, mine, [], week.start, today);
      const todays = withLunch(mine.filter((p) => localDay(p.at) === today));
      const shift = shifts.find((s) => s.employee_id === e.id) || null;
      const late = !!shift && !todays.some((p) => p.kind === "in") && card.state === "out" && nowMin > localMinutes(shift.starts_at) + d.settings.graceMin;
      const lastPhoto = [...todays].reverse().find((p) => photos[p.id]);
      const status: "in" | "break" | "done" | "late" | "off" = card.state === "in" ? "in" : card.state === "break" ? "break" : todays.length ? "done" : late ? "late" : "off";
      return { e, color: e.color || COLORS[i % COLORS.length], card, week: wk.regular + wk.overtime, weekOt: wk.overtime, todays, shift, status, photo: lastPhoto ? photos[lastPhoto.id] : null };
    });
  }, [punches, shifts, photos, d.employees, d.settings, today, week.start]);
  const issues = useMemo(() => (punches ? timeIssues(d.settings, d.employees, punches, period.start, dismissed) : []), [punches, d.settings, d.employees, period.start, dismissed]);
  const groups = ([["in", "On the clock"], ["break", "At lunch or on break"], ["late", "Late"], ["done", "Done for today"], ["off", "Not in today"]] as const)
    .map(([k, l]) => ({ k, l, rows: rows.filter((r) => r.status === k).sort((a, b) => (a.e.last_name || a.e.first_name).localeCompare(b.e.last_name || b.e.first_name)) })).filter((g) => g.rows.length);
  const count = (k: string) => rows.filter((r) => r.status === k).length;
  const { staffName } = useRole();
  const myName = (staffName || "").split(/\s+/)[0] || d.employees.find((e) => e.staff_email?.toLowerCase() === d.me)?.first_name || "there";
  const sel = who ? rows.find((r) => r.e.id === who) || null : null;

  return (
    <div className="tmx tk">
      <MyPunch />
      <header className="tk-hi">
        <div>
          <h2>{greet()}, {myName}</h2>
          <p>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })} · Pay period {dayLabel(period.start)} – {dayLabel(period.end)} <span className="faint">({daysBetween(today, period.end) === 0 ? "ends today" : `${daysBetween(today, period.end)} day${daysBetween(today, period.end) === 1 ? "" : "s"} left`})</span></p>
        </div>
        <div className="tk-stats">
          <span className="tk-stat in"><b>{count("in")}</b>on the clock</span>
          <span className="tk-stat break"><b>{count("break")}</b>at lunch</span>
          <span className="tk-stat done"><b>{count("done")}</b>done</span>
          <span className={"tk-stat " + (count("late") ? "late" : "off")}><b>{count("late") + count("off")}</b>{count("late") ? "late / not in" : "not in"}</span>
          <span className="tk-stat hrs"><b>{hm(rows.reduce((a, r) => a + r.card.worked, 0))}</b>hours today</span>
        </div>
      </header>
      {boss && <TimeAsk onChanged={changed} />}
      {boss && <IssuesByPeriod d={d} current={period} onFixed={changed} />}
      <div className="tk-sec-h tk-board-h">
        <h3>The crew</h3>
        <span className="spacer" />
        <div className="rv-seg">{([["cards", "Cards"], ["list", "List"]] as const).map(([k, l]) => <button key={k} type="button" className={layout === k ? "on" : ""} onClick={() => setLayout(k)}>{l}</button>)}</div>
        {boss && <button type="button" className="btn sm primary" onClick={() => setAdding(true)}>+ Add Employee</button>}
      </div>
      {punches === null ? <div className="db-empty">Loading…</div> : !rows.length ? <div className="db-empty">No employees yet. Add everyone who clocks in.</div> : groups.map((g) => (
        <section key={g.k} className={"tk-grp " + g.k}>
          <h4><i aria-hidden />{g.l} <span>{g.rows.length}</span></h4>
          <div className={layout === "cards" ? "tk-cards" : "tk-rows"}>
            {g.rows.map((r) => {
              const ini = `${r.e.first_name[0] || ""}${r.e.last_name[0] || ""}`.toUpperCase();
              const flag = issues.filter((x) => x.employee_id === r.e.id).length;
              const near = r.week >= (d.settings.otWeekly - 4) * 60;
              return (
                <button key={r.e.id} type="button" className={"tk-card " + r.status} onClick={() => setWho(r.e.id)}>
                  {r.photo ? <img src={r.photo} alt="" className="tk-av" /> : <span className="tk-av" style={{ background: r.color }} aria-hidden>{ini}</span>}
                  <span className="tk-who"><b>{fullName(r.e)}</b><small>{r.e.department || r.e.title || " "}</small></span>
                  <span className={"tk-pill " + r.status}>{r.status === "in" ? `In since ${timeLabel(r.card.since!)}` : r.status === "break" ? `${r.todays[r.todays.length - 1]?.lunch ? "Lunch" : "Break"} since ${timeLabel(r.card.since!)}` : r.status === "done" ? `Out ${timeLabel(r.todays[r.todays.length - 1].at)}` : r.status === "late" ? `Due ${timeLabel(r.shift!.starts_at)}` : r.shift ? `Scheduled ${timeLabel(r.shift.starts_at)}` : "Off"}</span>
                  <DayBar ps={r.todays} live={r.status === "in"} />
                  <span className="tk-hrs"><b className="num">{hm(r.card.worked)}</b><small>today</small></span>
                  <span className={"tk-wk" + (r.weekOt ? " ot" : near ? " near" : "")}><b className="num">{hm(r.week)}</b><small>{r.weekOt ? `${hm(r.weekOt)} OT` : "this week"}</small></span>
                  {flag > 0 && <span className="tk-flag" title={`${flag} to fix`}>{flag}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {sel && <PersonSheet d={d} e={sel.e} punches={punches || []} start={period.start} end={period.end} onClose={() => setWho(null)} onChanged={changed} />}
      {adding && <EmployeeEditor d={d} e={{ first_name: "", last_name: "", email: "", phone: "", staff_email: null, department: "", title: "", pay_type: "hourly", paid_by: "payroll", color: "", active: true, hire_date: today, notes: "" }} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await d.reload(); }} />}
    </div>
  );
}

/**
 * Things to fix, one pay period at a time (Oct 20, Nick: "only show that pay period, or be able to go back and forth…
 * on the Friday after this pay period, we've got to be able to go back and correct"). Opens on the current period; when
 * the last period still has something to fix, a button says so and goes there.
 */
function IssuesByPeriod({ d, current, onFixed }: { d: TimeData; current: { start: string; end: string }; onFixed: () => void }) {
  const [start, setStart] = useState(current.start);
  const p = periodOf(d.settings, start);
  const prev = periodOf(d.settings, addDays(current.start, -1));
  const [list, setList] = useState<ReturnType<typeof timeIssues> | null>(null);
  const [prevCount, setPrevCount] = useState(0);
  const autoPrev = useRef(false);
  const load = useCallback(async () => {
    const sb = createClient();
    const read = (a: string, b: string) => allRows((r0, r1) => sb.from("time_punches").select("id, employee_id, kind, at, source, voided").eq("voided", false).gte("at", localToIso(addDays(a, -1), 0)).lt("at", localToIso(addDays(b, 2), 0)).order("at").order("id").range(r0, r1));
    const onCur = p.start === current.start;
    const [{ data: ps }, { data: dm }, pv] = await Promise.all([
      read(p.start, p.end),
      sb.from("time_issue_dismissals").select("key"),
      onCur ? read(prev.start, prev.end) : Promise.resolve({ data: null }),
    ]);
    const dis = new Set(((dm || []) as { key: string }[]).map((x) => x.key));
    setList(timeIssues(d.settings, d.employees, (ps || []) as Punch[], p.start, dis, new Date(), p.end));
    // the last period's leftovers, shown as a button while looking at this one
    if (onCur) {
      const left = timeIssues(d.settings, d.employees, (pv.data || []) as Punch[], prev.start, dis, new Date(), prev.end).length;
      setPrevCount(left);
      // payday (Oct 30, Nick: the badge said "28 to fix", the page said "Nothing to fix"): a new period has just started
      // and the one being paid still has problems, so open on that one; the badge counts both periods
      const mine = timeIssues(d.settings, d.employees, (ps || []) as Punch[], p.start, dis, new Date(), p.end).length;
      if (!mine && left && !autoPrev.current) { autoPrev.current = true; setStart(prev.start); }
    }
  }, [p.start, p.end, prev.start, prev.end, current.start, d.settings, d.employees]);
  useEffect(() => { load(); const re = () => load(); window.addEventListener("fbs:time-changed", re); return () => window.removeEventListener("fbs:time-changed", re); }, [load]);
  const isCur = p.start === current.start, isPrev = p.start === prev.start;
  const n = list?.length || 0;
  return (
    <section className={"tk-issues" + (n ? "" : " ok")}>
      <div className="tk-sec-h">
        <h3>{list === null ? "Things to fix" : n === 0 ? "Nothing to fix" : n === 1 ? "1 thing to fix" : `${n} things to fix`}</h3>
        <span className="spacer" />
        <div className="tk-per">
          <button type="button" className="btn sm" onClick={() => setStart(addDays(p.start, -1))} aria-label="Previous pay period">←</button>
          <b>{dayLabel(p.start)} – {dayLabel(p.end)}</b>
          <button type="button" className="btn sm" disabled={isCur} onClick={() => setStart(addDays(p.end, 1))} aria-label="Next pay period">→</button>
          <span className="faint">{isCur ? "this pay period" : isPrev ? "last pay period" : ""}</span>
        </div>
        {isCur && prevCount > 0 && <button type="button" className="tk-prev" onClick={() => setStart(prev.start)}>Last pay period: {prevCount} to fix</button>}
        {!isCur && <button type="button" className="linkbtn" onClick={() => setStart(current.start)}>Back to this period</button>}
      </div>
      {list === null ? <div className="faint" style={{ padding: "4px 0 6px" }}>Checking…</div> : n > 0 ? <IssueList issues={list} onFixed={onFixed} compact /> : <div className="faint" style={{ padding: "2px 0 6px", fontSize: 13 }}>Every punch in this pay period adds up.</div>}
    </section>
  );
}

/** today as a little bar, 5 AM – 7 PM: worked stretches solid, lunch hatched, still on the clock pulsing */
function DayBar({ ps, live }: { ps: (Punch & { lunch?: boolean })[]; live: boolean }) {
  const lo = 300, hi = 1140, now = localMinutes(new Date());
  const pct = (m: number) => `${((Math.max(lo, Math.min(hi, m)) - lo) / (hi - lo)) * 100}%`;
  const segs: { a: number; b: number; k: "work" | "lunch" | "live" }[] = [];
  let open: number | null = null, brk: number | null = null;
  for (const p of ps) {
    const m = localMinutes(p.at);
    if (p.kind === "in" || p.kind === "break_end") { if (brk != null) segs.push({ a: brk, b: m, k: "lunch" }); brk = null; open = m; }
    else if (p.kind === "break_start") { if (open != null) segs.push({ a: open, b: m, k: "work" }); open = null; brk = m; }
    else if (p.kind === "out") { if (open != null) segs.push({ a: open, b: m, k: "work" }); open = null; brk = null; }
  }
  if (open != null) segs.push({ a: open, b: now, k: live ? "live" : "work" });
  if (brk != null) segs.push({ a: brk, b: now, k: "lunch" });
  return (
    <span className="tk-bar-d" aria-hidden>
      <i className="noon" style={{ left: pct(720) }} />
      {segs.map((s, i) => <span key={i} className={s.k} style={{ left: pct(s.a), width: `calc(${pct(s.b)} - ${pct(s.a)})` }} />)}
    </span>
  );
}

/** one person: this pay period day by day (tap a time to fix it), and their details */
function PersonSheet({ d, e, punches, start, end, onClose, onChanged }: { d: TimeData; e: Employee; punches: Punch[]; start: string; end: string; onClose: () => void; onChanged: () => void }) {
  const [edit, setEdit] = useState<{ punch?: Punch; day: string; kind?: Punch["kind"] } | null>(null);
  const [editEmp, setEditEmp] = useState(false);
  const c = timecard(d.settings, e.id, punches, [], start, end);
  const days = Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
  const boss = isBoss(d);
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tk-person" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={fullName(e)}>
        <div className="pp-sheet-h"><b>{fullName(e)}{e.code ? <span className="faint"> · Clock ID {e.code}</span> : null}</b>
          {boss && <button type="button" className="btn sm" onClick={() => setEditEmp(true)}>Edit employee</button>}
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tk-person-b">
          <div className="tk-person-k"><span><b className="num">{hm(c.regular)}</b>regular</span><span className={c.overtime ? "ot" : ""}><b className="num">{hm(c.overtime)}</b>overtime</span><span><b className="num">{hm(c.regular + c.overtime)}</b>this pay period</span>{c.issues.length > 0 && <span className="bad"><b>{c.issues.length}</b>to fix</span>}</div>
          <PunchList e={e} c={c} days={days} punches={punches} otWeekly={d.settings.otWeekly} bare onEdit={boss ? (punch, day, kind) => setEdit({ punch, day, kind }) : () => {}} />
        </div>
        {edit && <PunchEditor d={d} emp={e.id} day={edit.day} punch={edit.punch} kind0={edit.kind} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
        {editEmp && <EmployeeEditor d={d} e={e} onClose={() => setEditEmp(false)} onSaved={async () => { setEditEmp(false); await d.reload(); }} />}
      </div>
    </div>
  );
}

/** The signed-in person's own clock (phone punching), when their login is linked to an employee. */
function MyPunch() {
  const [s, setS] = useState<{ linked: boolean; name?: string; phone?: boolean; geo?: boolean; next?: Punch["kind"][]; state?: string; since?: string | null; todayMinutes?: number } | null>(null);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/time/me", { cache: "no-store" }).catch(() => null); if (r?.ok) setS(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  if (!s?.linked || !s.phone) return null;
  async function punch(kind: Punch["kind"]) {
    setBusy(kind); setMsg("");
    const pos = await new Promise<GeolocationPosition | null>((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000 }); });
    const r = await fetch("/api/time/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, lat: pos?.coords.latitude, lng: pos?.coords.longitude, accuracy: pos?.coords.accuracy }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "No connection." };
    setBusy("");
    if (!r?.ok) return setMsg(j.error || "Couldn't punch.");
    setMsg(`${KIND_LABEL[kind]} at ${timeLabel(new Date())}.`); load();
  }
  return (
    <section className="db-card db-orange tmx-me">
      <div className="db-card-h"><h2>My Time</h2><span className="faint db-h-note">{s.state === "in" ? `In since ${timeLabel(s.since!)}` : s.state === "break" ? `On break since ${timeLabel(s.since!)}` : "Clocked out"} · {hm(s.todayMinutes || 0)} today</span></div>
      <div className="tmx-me-b">{(s.next || nextKinds(null)).map((k) => <button key={k} type="button" className={"btn " + (k === "in" ? "primary" : "")} disabled={!!busy} onClick={() => punch(k)}>{busy === k ? "…" : KIND_LABEL[k]}</button>)}
        {msg && <span className="faint">{msg}</span>}</div>
    </section>
  );
}
