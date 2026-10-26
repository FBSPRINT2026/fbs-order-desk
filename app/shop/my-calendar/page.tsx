"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { NewEvent, PhoneLink } from "@/components/MyDay";
import { Pill } from "@/components/bits";
import { useSticky } from "@/lib/useSticky";
import { eventsBetween, jobDates, setEventStatus, updateEvent, type CalEvent, type CalJob } from "@/app/shop/myday-actions";

/**
 * Calendar (Oct 26, Nick: "two calendars… you would toggle between the two. One would be like your appointments. And
 * then one would be a job… here's what's due today. Here's what's due tomorrow. But then your… appointments calendar
 * would… act like just like an Outlook calendar"). Appointments: day / work week / week / month, click a time to add,
 * drag to move, drag the bottom edge to change the length; they go to your phone. Jobs: what's due by day, ours and
 * the ones still in Printavo; they stay here ("I don't need a reminder on my phone for that").
 */
const TZ = "America/Chicago";
const HOUR = 48, FIRST = 6, LAST = 21, SNAP = 15;
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(d + "T12:00:00Z").toLocaleDateString([], { ...o, timeZone: "UTC" });
/** minutes after midnight, shop time, of a moment */
const minsOf = (iso: string) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return +p.hour * 60 + +p.minute; };
/** a shop-time day + minutes as a moment */
function at(day: string, mins: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess)).toISOString();
}
const hm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const clock = (mins: number) => { const h = Math.floor(mins / 60) % 24, mm = mins % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`; };
const METHOD = { screen: "Screen print", embroidery: "Embroidery", dtf: "DTF" } as const;

type View = "day" | "work" | "week" | "month";
type Tab = "appts" | "jobs";

export default function CalendarPage() {
  const [tab, setTab] = useSticky<Tab>("calendar.tab", "appts");
  const today = todayStr();
  const [jobsToday, setJobsToday] = useState<number | null>(null), [apptsToday, setApptsToday] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ day: string; start?: string; end?: string } | null>(null), [phone, setPhone] = useState(false);
  return (
    <>
      <div className="page-head">
        <div><h1>Calendar</h1><div className="eyebrow">{tab === "appts" ? "Your appointments: click a time to add one. They go to your phone too." : "The shop's jobs by the day they're due. These stay here, not on your phone."}</div></div>
        <div className="row" style={{ gap: 8 }}>
          {tab === "appts" && <button type="button" className="btn" onClick={() => setPhone(true)}>On your phone</button>}
          {tab === "appts" && <button type="button" className="btn primary" onClick={() => setAdding({ day: today })}>+ Appointment</button>}
        </div>
      </div>
      {(() => { const tabs = (<div className="aa-sub apc-tabs" data-toolbar role="tablist" aria-label="Calendars">
        <button type="button" role="tab" aria-selected={tab === "appts"} className={tab === "appts" ? "on" : ""} onClick={() => setTab("appts")}>
          <svg className="apc-ic" viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>Appointments{apptsToday ? <span>{apptsToday} today</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === "jobs"} className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>
          <svg className="apc-ic" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16v13H4zM9 7V4h6v3M4 12h16" /></svg>Jobs{jobsToday ? <span>{jobsToday} due today</span> : null}
        </button>
      </div>);
      // the switch sits right on top of the calendar itself (Oct 26, Nick)
      return tab === "appts"
        ? <Appointments tabs={tabs} today={today} adding={adding} setAdding={setAdding} onToday={setApptsToday} />
        : <Jobs tabs={tabs} today={today} onToday={setJobsToday} />; })()}
      <TodayCounts today={today} tab={tab} setAppts={setApptsToday} setJobs={setJobsToday} />
      {phone && <PhoneLink onClose={() => setPhone(false)} />}
    </>
  );
}

/** the counts on the tab you're not looking at */
function TodayCounts({ today, tab, setAppts, setJobs }: { today: string; tab: Tab; setAppts: (n: number) => void; setJobs: (n: number) => void }) {
  useEffect(() => {
    if (tab === "jobs") eventsBetween(today, today).then((r) => { if (r.ok) setAppts(r.events.filter((e) => e.status === "added").length); });
    else jobDates(today, today, today).then((r) => { if (r.ok) setJobs(r.jobs.filter((j) => j.day === today).length); });
  }, [today, tab, setAppts, setJobs]);
  return null;
}

/* ───────────────────────── Appointments ───────────────────────── */

function Appointments({ tabs, today, adding, setAdding, onToday }: { tabs: React.ReactNode; today: string; adding: { day: string; start?: string; end?: string } | null; setAdding: (a: { day: string; start?: string; end?: string } | null) => void; onToday: (n: number) => void }) {
  const [view, setView] = useSticky<View>("calendar.view", "work");
  const [anchor, setAnchor] = useState(today);
  const [evs, setEvs] = useState<CalEvent[]>([]), [sel, setSel] = useState<string | null>(null), [err, setErr] = useState("");
  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "month") { const first = anchor.slice(0, 8) + "01", start = addDays(first, -dow(first)); return Array.from({ length: 42 }, (_, i) => addDays(start, i)); }
    const sun = addDays(anchor, -dow(anchor));
    return view === "work" ? Array.from({ length: 5 }, (_, i) => addDays(sun, i + 1)) : Array.from({ length: 7 }, (_, i) => addDays(sun, i));
  }, [view, anchor]);
  const load = useCallback(async () => {
    const r = await eventsBetween(days[0], days[days.length - 1]);
    if (r.ok) { setEvs(r.events); setErr(""); } else setErr(r.error);
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onToday(evs.filter((e) => e.day === today && e.status === "added").length); }, [evs, today, onToday]);
  const step = (n: number) => setAnchor((a) => (view === "day" ? addDays(a, n) : view === "month" ? (() => { const x = new Date(a.slice(0, 8) + "15T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); })() : addDays(a, 7 * n)));
  const title = view === "month" ? fmt(anchor.slice(0, 8) + "15", { month: "long", year: "numeric" })
    : view === "day" ? fmt(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : (() => { const a = days[0], b = days[days.length - 1]; return `${fmt(a, { month: "short", day: "numeric" })} – ${a.slice(5, 7) === b.slice(5, 7) ? Number(b.slice(8)) : fmt(b, { month: "short", day: "numeric" })}, ${b.slice(0, 4)}`; })();
  const picked = evs.find((e) => e.id === sel) || null;
  const sugg = evs.filter((e) => e.status === "suggested");
  const save = async (e: CalEvent, p: Parameters<typeof updateEvent>[1]) => {
    setEvs((xs) => xs.map((x) => (x.id === e.id ? { ...x, ...p } as CalEvent : x)));
    const r = await updateEvent(e.id, p);
    if (!r.ok) { setErr(r.error); void load(); }
  };
  const status = async (e: CalEvent, s: "added" | "dismissed") => {
    setEvs((xs) => (s === "dismissed" ? xs.filter((x) => x.id !== e.id) : xs.map((x) => (x.id === e.id ? { ...x, status: s } : x))));
    if (s === "dismissed") setSel(null);
    await setEventStatus(e.id, s);
  };

  return (
    <div className="apc-wrap">
      {tabs}
      <div className="toolbar" data-toolbar>
        <div className="chips" role="radiogroup" aria-label="View">
          {([["day", "Day"], ["work", "Work week"], ["week", "Week"], ["month", "Month"]] as [View, string][]).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={view === k} className={"chip" + (view === k ? " on" : "")} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => step(-1)} aria-label="Back">‹</button>
        <b className="apc-title">{title}</b>
        <button type="button" className="btn sm" onClick={() => step(1)} aria-label="Forward">›</button>
        <button type="button" className="btn sm" onClick={() => setAnchor(today)}>Today</button>
      </div>
        <section className="panel apc-main">
          {view === "month"
            ? <Month days={days} month={anchor.slice(0, 7)} today={today} evs={evs} onDay={(d) => { setAnchor(d); setView("day"); }} onPick={setSel} />
            : <TimeGrid days={days} today={today} evs={evs} onPick={setSel} sel={sel} onAdd={(day, mins) => setAdding({ day, start: hm(mins), end: hm(Math.min(mins + 60, 23 * 60 + 45)) })} onMove={(e, day, s, en) => save(e, { day, starts_at: at(day, s), ends_at: at(day, en), all_day: false })} />}
        </section>
        <aside className="panel apc-side">
          <div className="panel-b">
            {err && <div className="pv-err" style={{ marginBottom: 8 }}>{err}</div>}
            {adding ? <>
              <h2 className="apc-h">New appointment</h2>
              <NewEvent key={`${adding.day}-${adding.start}`} day={adding.day} start={adding.start} end={adding.end} onDone={(e) => { setAdding(null); if (e) { setEvs((xs) => [...xs, e]); setSel(e.id); } }} />
            </> : picked ? <EventCard e={picked} onClose={() => setSel(null)} onSave={(p) => save(picked, p)} onStatus={(s) => status(picked, s)} />
              : <p className="faint" style={{ margin: 0 }}>Click a time to add an appointment, or click one to see it. Drag to move it; drag its bottom edge to change the length.</p>}
            {sugg.length > 0 && <>
              <h2 className="apc-h" style={{ marginTop: 16 }}>From your email</h2>
              {sugg.map((e) => (
                <div key={e.id} className="md-sg">
                  <div className="md-sg-t"><b>{e.title}</b><span>{e.day ? fmt(e.day, { weekday: "short", month: "short", day: "numeric" }) : ""}{e.starts_at ? ` · ${clock(minsOf(e.starts_at))}` : ""}{e.place ? ` · ${e.place}` : ""}</span></div>
                  <div className="md-sg-a"><button type="button" className="btn sm primary" onClick={() => status(e, "added")}>Add</button><button type="button" className="btn sm ghost" onClick={() => status(e, "dismissed")}>Not now</button></div>
                </div>
              ))}
            </>}
          </div>
        </aside>
    </div>
  );
}

function EventCard({ e, onClose, onSave, onStatus }: { e: CalEvent; onClose: () => void; onSave: (p: Parameters<typeof updateEvent>[1]) => void; onStatus: (s: "added" | "dismissed") => void }) {
  const [t, setT] = useState(e.title), [pl, setPl] = useState(e.place || ""), [nt, setNt] = useState(e.notes || "");
  useEffect(() => { setT(e.title); setPl(e.place || ""); setNt(e.notes || ""); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = e.day ? `${fmt(e.day, { weekday: "long", month: "long", day: "numeric" })}${e.starts_at ? ` · ${clock(minsOf(e.starts_at))}${e.ends_at ? ` – ${clock(minsOf(e.ends_at))}` : ""}` : " · all day"}` : "";
  const dirty = t !== e.title || pl !== (e.place || "") || nt !== (e.notes || "");
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 className="apc-h">{e.status === "suggested" ? "Suggested from email" : "Appointment"}</h2><button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
      <div className="faint" style={{ fontSize: 12.5 }}>{when}{e.from ? ` · from ${e.from}` : ""}</div>
      <div className="field"><label htmlFor="ce-t">What</label><input id="ce-t" value={t} onChange={(x) => setT(x.target.value)} /></div>
      <div className="field"><label htmlFor="ce-p">Where</label><input id="ce-p" value={pl} onChange={(x) => setPl(x.target.value)} placeholder="Optional" /></div>
      <div className="field"><label htmlFor="ce-n">Notes</label><textarea id="ce-n" rows={3} value={nt} onChange={(x) => setNt(x.target.value)} /></div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        {e.status === "suggested" ? <button type="button" className="btn primary sm" onClick={() => onStatus("added")}>Add to calendar</button> : null}
        <button type="button" className="btn ghost sm" onClick={() => onStatus("dismissed")}>{e.status === "suggested" ? "Not now" : "Remove"}</button>
        {dirty && <button type="button" className="btn primary sm" onClick={() => onSave({ title: t, place: pl, notes: nt })}>Save</button>}
      </div>
    </div>
  );
}

/** Outlook-style day / week columns: the hours down the side, appointments as blocks */
function TimeGrid({ days, today, evs, sel, onPick, onAdd, onMove }: { days: string[]; today: string; evs: CalEvent[]; sel: string | null; onPick: (id: string) => void; onAdd: (day: string, mins: number) => void; onMove: (e: CalEvent, day: string, start: number, end: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null), cols = useRef<HTMLDivElement>(null), dragEnd = useRef(0);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "size"; day: string; start: number; end: number; moved: boolean } | null>(null);
  const [now, setNow] = useState(() => minsOf(new Date().toISOString()));
  useEffect(() => { const t = setInterval(() => setNow(minsOf(new Date().toISOString())), 60000); return () => clearInterval(t); }, []);
  // opens at 7am
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = (7 - FIRST) * HOUR - 10; }, []);
  const hours = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
  const timed = (d: string) => evs.filter((e) => e.day === d && e.starts_at).map((e) => {
    const s = minsOf(e.starts_at!), en = e.ends_at ? Math.max(minsOf(e.ends_at), s + 15) : s + 60;
    return drag && drag.id === e.id ? { e, day: drag.day, s: drag.start, en: drag.end } : { e, day: d, s, en };
  });
  const allDay = (d: string) => evs.filter((e) => e.day === d && !e.starts_at);
  const placed = days.flatMap((d) => timed(d)).filter((x) => days.includes(x.day));
  // side by side when two overlap
  const lanes = (list: typeof placed) => {
    const out = new Map<string, { i: number; n: number }>();
    const sorted = [...list].sort((a, b) => a.s - b.s || b.en - a.en);
    let group: typeof placed = [], end = -1;
    const flush = () => { const ends: number[] = []; for (const x of group) { let i = ends.findIndex((v) => v <= x.s); if (i < 0) { i = ends.length; ends.push(x.en); } else ends[i] = x.en; out.set(x.e.id, { i, n: 0 }); } for (const x of group) out.get(x.e.id)!.n = ends.length; group = []; };
    for (const x of sorted) { if (x.s >= end && group.length) flush(); group.push(x); end = Math.max(end, x.en); }
    if (group.length) flush();
    return out;
  };
  const yToMins = (y: number) => Math.max(FIRST * 60, Math.min(LAST * 60 + 45, FIRST * 60 + Math.round(((y / HOUR) * 60) / SNAP) * SNAP));
  const dayAt = (x: number) => { const r = cols.current!.getBoundingClientRect(); const i = Math.max(0, Math.min(days.length - 1, Math.floor(((x - r.left) / r.width) * days.length))); return days[i]; };
  function startDrag(ev: React.PointerEvent, e: CalEvent, s: number, en: number, mode: "move" | "size") {
    ev.stopPropagation(); ev.preventDefault();
    const y0 = ev.clientY, len = en - s;
    let cur = { id: e.id, mode, day: e.day!, start: s, end: en, moved: false };
    setDrag(cur);
    const mv = (p: PointerEvent) => {
      const dm = Math.round(((p.clientY - y0) / HOUR) * 60 / SNAP) * SNAP;
      if (mode === "move") { const ns = Math.max(0, Math.min(24 * 60 - len, s + dm)); cur = { ...cur, day: dayAt(p.clientX), start: ns, end: ns + len, moved: cur.moved || Math.abs(p.clientY - y0) > 4 || dayAt(p.clientX) !== e.day }; }
      else cur = { ...cur, end: Math.max(s + SNAP, Math.min(24 * 60, en + dm)), moved: true };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      setDrag(null); dragEnd.current = Date.now();
      if (cur.moved && (cur.day !== e.day || cur.start !== s || cur.end !== en)) onMove(e, cur.day, cur.start, cur.end); else onPick(e.id);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }
  const L = new Map<string, { i: number; n: number }>();
  for (const d of days) for (const [k, v] of lanes(placed.filter((x) => x.day === d))) L.set(k, v);
  return (
    <div className="apc-tg" style={{ ["--n" as string]: days.length }}>
      <div className="apc-sc" ref={scroller}>
      <div className="apc-stick">
      <div className="apc-hd">
        <div />
        {days.map((d) => <div key={d} className={"apc-dh" + (d === today ? " today" : "")}><span>{fmt(d, { weekday: "short" })}</span><b>{Number(d.slice(8))}</b></div>)}
      </div>
      {days.some((d) => allDay(d).length) && <div className="apc-ad">
        <div className="apc-adl">All day</div>
        {days.map((d) => <div key={d}>{allDay(d).map((e) => <button key={e.id} type="button" className={"apc-ev ad" + (e.status === "suggested" ? " sg" : "") + (sel === e.id ? " on" : "")} onClick={() => onPick(e.id)}><b>{e.title}</b></button>)}</div>)}
      </div>}
      </div>
        <div className="apc-body" style={{ height: (LAST - FIRST + 1) * HOUR }}>
          <div className="apc-hrs">{hours.map((h) => <div key={h} style={{ height: HOUR }}><span>{clock(h * 60).replace("m", "").replace("a", " AM").replace("p", " PM")}</span></div>)}</div>
          <div className="apc-cols" ref={cols}>
            {days.map((d) => (
              <div key={d} className={"apc-col" + (d === today ? " today" : "")} onClick={(ev) => { if (drag || Date.now() - dragEnd.current < 400) return; const r = (ev.currentTarget as HTMLDivElement).getBoundingClientRect(); onAdd(d, yToMins(ev.clientY - r.top)); }} role="presentation">
                {hours.map((h) => <div key={h} className="apc-slot" style={{ height: HOUR }} />)}
                {d === today && now >= FIRST * 60 && now <= (LAST + 1) * 60 && <div className="apc-now" style={{ top: ((now - FIRST * 60) / 60) * HOUR }} />}
                {placed.filter((x) => x.day === d).map(({ e, s, en }) => {
                  const ln = L.get(e.id) || { i: 0, n: 1 };
                  const top = ((Math.max(s, FIRST * 60) - FIRST * 60) / 60) * HOUR, h = Math.max(20, ((Math.min(en, (LAST + 1) * 60) - Math.max(s, FIRST * 60)) / 60) * HOUR - 2);
                  return (
                    <div key={e.id} className={"apc-ev" + (e.status === "suggested" ? " sg" : "") + (sel === e.id ? " on" : "") + (drag?.id === e.id ? " drag" : "")}
                      style={{ top, height: h, left: `calc(${(ln.i / ln.n) * 100}% + 2px)`, width: `calc(${100 / ln.n}% - 4px)` }}
                      onPointerDown={(ev) => startDrag(ev, e, s, en, "move")} onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} aria-label={`${e.title}, ${clock(s)} to ${clock(en)}`}
                      onKeyDown={(ev) => { if (ev.key === "Enter") onPick(e.id); }}>
                      <b>{e.title}</b><span>{clock(s)} – {clock(en)}{e.place ? ` · ${e.place}` : ""}</span>
                      {e.status !== "suggested" && <i className="apc-rs" onPointerDown={(ev) => startDrag(ev, e, s, en, "size")} aria-hidden />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Month({ days, month, today, evs, onDay, onPick }: { days: string[]; month: string; today: string; evs: CalEvent[]; onDay: (d: string) => void; onPick: (id: string) => void }) {
  return (
    <div className="mc-grid apc-month">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="mc-wd">{w}</div>)}
      {days.map((d) => {
        const e = evs.filter((x) => x.day === d).sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
        return (
          <div key={d} className={"mc-day" + (d.slice(0, 7) !== month ? " out" : "") + (d === today ? " today" : "")} onClick={() => onDay(d)} role="button" tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onDay(d); }} aria-label={`${d}: ${e.length} appointments`}>
            <span className="mc-n">{Number(d.slice(8))}</span>
            {e.slice(0, 3).map((x) => <button key={x.id} type="button" className={"mc-ev" + (x.status === "suggested" ? " sg" : "")} onClick={(k) => { k.stopPropagation(); onPick(x.id); }}>{x.starts_at ? <i>{clock(minsOf(x.starts_at))}</i> : null}{x.title}</button>)}
            {e.length > 3 && <span className="mc-more">+{e.length - 3}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Jobs ───────────────────────── */

function Jobs({ tabs, today, onToday }: { tabs: React.ReactNode; today: string; onToday: (n: number) => void }) {
  const [method, setMethod] = useSticky<"all" | "screen" | "embroidery" | "dtf">("calendar.jobs.method", "all");
  const [by, setBy] = useSticky<"due" | "print">("calendar.jobs.by", "due");
  const [wk, setWk] = useState(0);
  const [jobs, setJobs] = useState<CalJob[] | null>(null), [err, setErr] = useState(""), [open, setOpen] = useState<Record<string, boolean>>({});
  // this week: Late, Today, Tomorrow and the days after (a week in all); other weeks: Monday to Sunday
  const start = wk === 0 ? today : addDays(addDays(today, -((dow(today) + 6) % 7)), 7 * wk);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  useEffect(() => {
    setJobs(null);
    jobDates(days[0], days[6], today, by).then((r) => { if (r.ok) { setJobs(r.jobs); setErr(""); } else setErr(r.error); });
  }, [days[0], by, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jobs && by === "due") onToday(jobs.filter((j) => j.day === today).length); }, [jobs, by, today, onToday]);
  const fits = (j: CalJob) => method === "all" || j.methods.includes(method);
  const count = (m: string) => (jobs || []).filter((j) => (m === "all" || j.methods.includes(m)) && (j.day >= days[0] || (wk === 0 && j.day < today))).length;
  const cols: { key: string; label: string; late?: boolean; list: CalJob[] }[] = [
    ...(wk === 0 ? [{ key: "late", label: "Late", late: true, list: (jobs || []).filter((j) => j.day < today && fits(j)) }] : []),
    ...days.map((d) => ({ key: d, label: d === today ? `Today · ${fmt(d, { weekday: "short", day: "numeric" })}` : d === addDays(today, 1) ? `Tomorrow · ${fmt(d, { weekday: "short", day: "numeric" })}` : fmt(d, { weekday: "long", month: "short", day: "numeric" }), list: (jobs || []).filter((j) => j.day === d && fits(j)) })),
  ].filter((c) => !c.late || c.list.length);
  const label = wk === 0 ? "This week" : wk === 1 ? "Next week" : wk === -1 ? "Last week" : `Week of ${fmt(days[0], { month: "short", day: "numeric" })}`;
  return (
    <>
      {tabs}
      <div className="toolbar" data-toolbar>
        <div className="chips" role="radiogroup" aria-label="Kind of job">
          {(["all", "screen", "embroidery", "dtf"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={method === m} className={"chip" + (method === m ? " on" : "")} onClick={() => setMethod(m)}>{m === "all" ? "All" : METHOD[m]}{jobs ? <span className="chip-n">{count(m)}</span> : null}</button>)}
        </div>
        <div className="chips" role="radiogroup" aria-label="Which date">
          <button type="button" role="radio" aria-checked={by === "due"} className={"chip" + (by === "due" ? " on" : "")} onClick={() => setBy("due")}>Due date</button>
          <button type="button" role="radio" aria-checked={by === "print"} className={"chip" + (by === "print" ? " on" : "")} onClick={() => setBy("print")} title="The day it's scheduled to print (orders made here)">Print date</button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => setWk((w) => w - 1)} aria-label="Week before">‹</button>
        <b className="apc-title">{label}</b>
        <button type="button" className="btn sm" onClick={() => setWk((w) => w + 1)} aria-label="Week after">›</button>
        {wk !== 0 && <button type="button" className="btn sm" onClick={() => setWk(0)}>This week</button>}
      </div>
      {err && <div className="pv-err" style={{ marginBottom: 8 }}>{err}</div>}
      {by === "print" && <p className="faint" style={{ margin: "0 0 8px", fontSize: 12.5 }}>Print dates are set on orders made here; jobs still run in Printavo show under Due date.</p>}
      <div className="apc-jobs">
        {cols.map((c) => {
          const pcs = c.list.reduce((a, j) => a + (j.qty || 0), 0), more = c.list.length - 8;
          return (
            <section key={c.key} className={"panel apc-day" + (c.late ? " late" : "") + (c.key === today ? " today" : "")}>
              <div className="apc-dayh"><b>{c.label}</b><span>{jobs ? `${c.list.length} job${c.list.length === 1 ? "" : "s"}${pcs ? ` · ${pcs.toLocaleString()} pcs` : ""}` : "…"}</span></div>
              {jobs && !c.list.length ? <div className="faint apc-none">Nothing due</div> : null}
              {(open[c.key] ? c.list : c.list.slice(0, 8)).map((j) => (
                <Link key={j.id} href={j.href} className="apc-job">
                  <span className="apc-jt"><span className="ordno">#{j.number}</span><Pill status={j.printavo ? "production" : j.status} pv={j.printavo ? j.statusLabel : null} /></span>
                  <span className="apc-jc">{j.customer || "Customer"}</span>
                  <span className="sub">{[j.nickname, j.qty ? `${j.qty.toLocaleString()} pcs` : "", c.late ? `due ${fmt(j.day, { weekday: "short", month: "numeric", day: "numeric" })}` : ""].filter(Boolean).join(" · ")}</span>
                </Link>
              ))}
              {more > 0 && <button type="button" className="linkbtn apc-more" onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}>{open[c.key] ? "Show fewer" : `+ ${more} more`}</button>}
            </section>
          );
        })}
      </div>
    </>
  );
}
