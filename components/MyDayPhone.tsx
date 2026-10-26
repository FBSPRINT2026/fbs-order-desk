"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type React from "react";
import { useSticky } from "@/lib/useSticky";
import { Pill } from "@/components/bits";
import { NewEvent, PhoneLink } from "@/components/MyDay";
import type { EmailGroups, EmailItem } from "@/components/EmailSummary";
import { addTask, jobDates, setEventStatus, setTaskDone, type CalEvent, type CalJob, type Task } from "@/app/shop/myday-actions";

/**
 * My Day on a phone (Oct 26, Nick: "redo or reimagine… the My Day view on the mobile phone? It's kind of hard to pull
 * anything from that"; he OK'd the mockups). Just today up front, the rest behind five tabs along the bottom:
 * Today (four numbers, what's next, who to answer, today's to-dos), Calendar (Appointments as a scrolling agenda, Jobs
 * day by day with the late ones folded up), Email (who's waiting on us first), To-do (today, this week, later) and
 * Business (two numbers, one chart, favorites as one-line cards). The computer keeps its own layout.
 */
type Day = { today: string; tasks: Task[]; events: CalEvent[]; others: { email: string; name: string }[]; hasFeed: boolean };
type Tab = "today" | "cal" | "email" | "todo" | "biz";
const TZ = "America/Chicago";
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(d + "T12:00:00Z").toLocaleDateString([], { ...o, timeZone: "UTC" });
const minsOf = (iso: string) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return +p.hour * 60 + +p.minute; };
const clock = (mins: number) => { const h = Math.floor(mins / 60) % 24, mm = mins % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`; };
const ago = (t: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const dayLabel = (d: string, today: string) => (d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : fmt(d, { weekday: "short", month: "short", day: "numeric" }));

export default function MyDayPhone({ d, setD, err, hello, name, groups, emailsLoading, business, cheer }: {
  d: Day | null; setD: (f: (x: Day | null) => Day | null) => void; err: string; hello: string; name: string;
  groups: EmailGroups | null; emailsLoading: boolean; business: ReactNode; cheer: ReactNode;
}) {
  const [tab, setTab] = useSticky<Tab>("myday.phone", "today");
  const [calMode, setCalMode] = useSticky<"appts" | "jobs">("calendar.tab", "appts");
  const today = d?.today || new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const [jobs, setJobs] = useState<CalJob[] | null>(null);
  useEffect(() => { jobDates(today, addDays(today, 6), today).then((r) => { if (r.ok) setJobs(r.jobs); }); }, [today]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);
  const open = (d?.tasks || []).filter((t) => t.status === "open" && (!t.snooze_until || t.snooze_until <= today));
  const dueTasks = open.filter((t) => t.due && t.due <= today);
  const added = (d?.events || []).filter((e) => e.status === "added");
  const apptsToday = added.filter((e) => e.day === today);
  const jobsToday = (jobs || []).filter((j) => j.day === today);
  const mails = groups ? groups.back.length + groups.fresh.length + groups.web.length : 0;
  const finish = async (t: Task) => {
    setD((x) => (x ? { ...x, tasks: x.tasks.map((y) => (y.id === t.id ? { ...y, status: "done", done_at: new Date().toISOString() } : y)) } : x));
    await setTaskDone(t.id, true);
  };
  const reopen = async (t: Task) => {
    setD((x) => (x ? { ...x, tasks: x.tasks.map((y) => (y.id === t.id ? { ...y, status: "open", done_at: null } : y)) } : x));
    await setTaskDone(t.id, false);
  };
  const go = (t: Tab, mode?: "appts" | "jobs") => { if (mode) setCalMode(mode); setTab(t); };

  return (
    <div className="mdp">
      {tab === "today" && <TodayTab d={d} err={err} hello={hello} name={name} today={today} cheer={cheer} apptsToday={apptsToday.length} jobsToday={jobs ? jobsToday : null} mails={emailsLoading ? null : mails} dueTasks={dueTasks}
        next={added.filter((e) => (e.day || "") > today || (e.day === today && (!e.starts_at || minsOf(e.starts_at) >= minsOf(new Date().toISOString()) - 30))).sort((a, b) => (a.day || "").localeCompare(b.day || "") || (a.starts_at || "").localeCompare(b.starts_at || "")).slice(0, 2)}
        reply={groups ? [...groups.back, ...groups.fresh, ...groups.web].slice(0, 2) : []} go={go} finish={finish} />}
      {tab === "cal" && <CalTab d={d} setD={setD} today={today} mode={calMode} setMode={setCalMode} jobs={jobs} />}
      {tab === "email" && <EmailTab groups={groups} loading={emailsLoading} />}
      {tab === "todo" && <TodoTab d={d} setD={setD} today={today} finish={finish} reopen={reopen} />}
      {tab === "biz" && <div className="mdp-pad"><h1 className="mdp-h">Business</h1>{business}</div>}

      <nav className="mdp-bar" aria-label="My Day">
        {([
          ["today", "Today", <><circle key="a" cx="12" cy="12" r="8" /><path key="b" d="M12 8v4l3 2" /></>, 0],
          ["cal", "Calendar", <><rect key="a" x="3" y="5" width="18" height="16" rx="2" /><path key="b" d="M3 10h18M8 3v4M16 3v4" /></>, 0],
          ["email", "Email", <><rect key="a" x="3" y="5" width="18" height="14" rx="2" /><path key="b" d="M3 7l9 6 9-6" /></>, mails],
          ["todo", "To-do", <path key="a" d="M4 7h16M4 12h16M4 17h10" />, dueTasks.length],
          ["biz", "Business", <path key="a" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />, 0],
        ] as [Tab, string, ReactNode, number][]).map(([k, l, ic, n]) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            <svg viewBox="0 0 24 24" aria-hidden>{ic}</svg>{l}{n > 0 && <em>{n > 99 ? "99+" : n}</em>}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ───────────── Today ───────────── */

function TodayTab({ d, err, hello, name, today, cheer, apptsToday, jobsToday, mails, dueTasks, next, reply, go, finish }: {
  d: Day | null; err: string; hello: string; name: string; today: string; cheer: ReactNode; apptsToday: number; jobsToday: CalJob[] | null; mails: number | null; dueTasks: Task[];
  next: CalEvent[]; reply: EmailItem[]; go: (t: Tab, mode?: "appts" | "jobs") => void; finish: (t: Task) => void;
}) {
  return (
    <div className="mdp-pad">
      <div className="mdp-hi"><span>{fmt(today, { weekday: "long", month: "long", day: "numeric" })}</span>{cheer}</div>
      <h1 className="mdp-h">{hello}{name ? `, ${name}` : ""}</h1>
      {err && <div className="pv-err">{err}</div>}
      <div className="mdp-tiles">
        <button type="button" onClick={() => go("cal", "appts")}><b>{d ? apptsToday : "–"}</b><span>{apptsToday === 1 ? "appointment" : "appointments"} today</span></button>
        <button type="button" onClick={() => go("cal", "jobs")}><b>{jobsToday ? jobsToday.length : "–"}</b><span>{jobsToday?.length === 1 ? "job" : "jobs"} due today</span></button>
        <button type="button" className={mails ? "hot" : ""} onClick={() => go("email")}><b>{mails ?? "–"}</b><span>customer {mails === 1 ? "email" : "emails"}</span></button>
        <button type="button" className={dueTasks.length ? "hot" : ""} onClick={() => go("todo")}><b>{d ? dueTasks.length : "–"}</b><span>{dueTasks.length === 1 ? "to-do" : "to-dos"} due</span></button>
      </div>

      <div className="mdp-sec">Next up</div>
      <div className="mdp-card">
        {next.map((e) => (
          <button key={e.id} type="button" className="mdp-row" onClick={() => go("cal", "appts")}>
            <span className="mdp-t">{e.day !== today && <small>{fmt(e.day || today, { weekday: "short" })}</small>}{e.starts_at ? clock(minsOf(e.starts_at)) : "All day"}</span>
            <span className="mdp-m"><b>{e.title}</b>{e.place ? <small>{e.place}</small> : null}</span><span className="mdp-chev" aria-hidden>›</span>
          </button>
        ))}
        {(jobsToday || []).slice(0, 3).map((j) => (
          <Link key={j.id} href={j.href} className="mdp-row">
            <span className="mdp-t">Due</span><span className="mdp-m"><b>#{j.number} {j.customer}</b><small>{[j.nickname, j.qty ? `${j.qty.toLocaleString()} pcs` : ""].filter(Boolean).join(" · ")}</small></span><span className="mdp-chev" aria-hidden>›</span>
          </Link>
        ))}
        {jobsToday && jobsToday.length > 3 && <button type="button" className="mdp-more" onClick={() => go("cal", "jobs")}>{jobsToday.length - 3} more due today</button>}
        {!next.length && jobsToday && !jobsToday.length && <div className="mdp-quiet">Nothing scheduled and nothing due today.</div>}
      </div>

      <div className="mdp-sec">Reply to</div>
      <div className="mdp-card">
        {reply.map((x) => <MailRow key={x.k} x={x} />)}
        {mails === null ? <div className="mdp-quiet">Loading…</div> : !reply.length ? <div className="mdp-quiet">You&apos;re caught up.</div> : <button type="button" className="mdp-more" onClick={() => go("email")}>See all {mails}</button>}
      </div>

      {dueTasks.length > 0 && <>
        <div className="mdp-sec">To-do</div>
        <div className="mdp-card">
          {dueTasks.slice(0, 4).map((t) => <TaskRow key={t.id} t={t} today={today} onDone={() => finish(t)} />)}
          {dueTasks.length > 4 && <button type="button" className="mdp-more" onClick={() => go("todo")}>{dueTasks.length - 4} more</button>}
        </div>
      </>}
    </div>
  );
}

function MailRow({ x }: { x: EmailItem }) {
  const old = Date.now() - Date.parse(x.at) > 864e5;
  return (
    <Link href={x.href} className="mdp-row">
      <span className="mdp-av" aria-hidden>{x.initials}</span>
      <span className="mdp-m"><b data-notranslate>{x.who}</b><small>{x.text}</small></span>
      <span className={"mdp-ago" + (old ? " w" : "")}>{ago(x.at)}{x.rush ? <i>rush</i> : null}</span>
    </Link>
  );
}

function TaskRow({ t, today, onDone, done }: { t: Task; today: string; onDone: () => void; done?: boolean }) {
  return (
    <div className="mdp-row">
      <button type="button" className={"mdp-box" + (done ? " on" : "")} aria-label={done ? `Open again: ${t.title}` : `Done: ${t.title}`} onClick={onDone}>{done ? "✓" : ""}</button>
      <span className="mdp-m"><b className={done ? "mdp-x" : ""}>{t.title}</b>{(t.from || t.notes) ? <small>{t.from ? `From ${t.from}` : t.notes}</small> : null}</span>
      {t.due && !done ? <span className={"mdp-due" + (t.due <= today ? " r" : "")}>{t.due < today ? "Late" : dayLabel(t.due, today).replace(/,.*/, "")}</span> : null}
    </div>
  );
}

/* ───────────── Calendar ───────────── */

function CalTab({ d, setD, today, mode, setMode, jobs }: { d: Day | null; setD: (f: (x: Day | null) => Day | null) => void; today: string; mode: "appts" | "jobs"; setMode: (m: "appts" | "jobs") => void; jobs: CalJob[] | null }) {
  const [sel, setSel] = useState(today), [adding, setAdding] = useState(false), [phone, setPhone] = useState(false);
  const [lateOpen, setLateOpen] = useState(false), [more, setMore] = useState<Record<string, boolean>>({});
  const evs = d?.events || [];
  const added = evs.filter((e) => e.status === "added");
  const sugg = evs.filter((e) => e.status === "suggested" && (e.day || "") >= today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  // the agenda: the picked day, then every day with something on it for the next two weeks
  const agenda = Array.from({ length: 14 }, (_, i) => addDays(sel, i)).filter((x, i) => i === 0 || added.some((e) => e.day === x));
  const setStatus = async (e: CalEvent, s: "added" | "dismissed") => { setD((x) => (x ? { ...x, events: x.events.map((y) => (y.id === e.id ? { ...y, status: s } : y)) } : x)); await setEventStatus(e.id, s); };
  const late = (jobs || []).filter((j) => j.day < today);
  return (
    <div className="mdp-pad">
      <div className="mdp-hrow"><h1 className="mdp-h">Calendar</h1>{mode === "appts" && <button type="button" className="btn primary sm" onClick={() => setAdding(!adding)}>+ Appointment</button>}</div>
      <div className="mdp-sw" role="tablist" aria-label="Calendars">
        <button type="button" role="tab" aria-selected={mode === "appts"} className={mode === "appts" ? "on" : ""} onClick={() => setMode("appts")}>Appointments</button>
        <button type="button" role="tab" aria-selected={mode === "jobs"} className={mode === "jobs" ? "on" : ""} onClick={() => setMode("jobs")}>Jobs</button>
      </div>
      {mode === "appts" ? <>
        <div className="mdp-week" role="group" aria-label="This week">{week.map((x) => (
          <button key={x} type="button" className={(sel === x ? "on" : "") + (x === today ? " today" : "")} onClick={() => setSel(x)} aria-label={dayLabel(x, today)}>
            <span>{fmt(x, { weekday: "narrow" })}</span><b>{Number(x.slice(8))}</b><i className={added.some((e) => e.day === x) ? "dot" : ""} />
          </button>
        ))}</div>
        {adding && <div className="mdp-card mdp-new"><NewEvent day={sel} onDone={(e) => { setAdding(false); if (e) setD((x) => (x ? { ...x, events: [...x.events, e] } : x)); }} /></div>}
        {agenda.map((x) => {
          const list = added.filter((e) => e.day === x).sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
          const allDay = list.filter((e) => !e.starts_at), timed = list.filter((e) => e.starts_at);
          return (
            <section key={x}>
              <div className="mdp-dayh"><b>{dayLabel(x, today)}</b><span>{list.length ? `${list.length} appointment${list.length === 1 ? "" : "s"}` : ""}</span></div>
              {!list.length && <div className="mdp-quiet">Nothing scheduled.</div>}
              {allDay.map((e) => <div key={e.id} className="mdp-blk"><b>{e.title}</b><small>All day{e.place ? ` · ${e.place}` : ""}</small></div>)}
              {timed.map((e, i) => {
                const s = minsOf(e.starts_at!), en = e.ends_at ? minsOf(e.ends_at) : s + 60;
                const prev = timed[i - 1], pe = prev ? (prev.ends_at ? minsOf(prev.ends_at) : minsOf(prev.starts_at!) + 60) : null;
                return (
                  <div key={e.id}>
                    {pe != null && s - pe >= 30 && <div className="mdp-free">Free {clock(pe)} – {clock(s)}</div>}
                    <div className="mdp-blk"><b>{e.title}</b><small>{clock(s)}{e.ends_at ? ` – ${clock(en)}` : ""}{e.place ? ` · ${e.place}` : ""}</small></div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {sugg.length > 0 && <>
          <div className="mdp-sec">From your email</div>
          {sugg.map((e) => (
            <div key={e.id} className="md-sg">
              <div className="md-sg-t"><b>{e.title}</b><span>{dayLabel(e.day || today, today)}{e.starts_at ? ` · ${clock(minsOf(e.starts_at))}` : ""}{e.place ? ` · ${e.place}` : ""}</span></div>
              <div className="md-sg-a"><button type="button" className="btn sm primary" onClick={() => setStatus(e, "added")}>Add</button><button type="button" className="btn sm ghost" onClick={() => setStatus(e, "dismissed")}>Not now</button></div>
            </div>
          ))}
        </>}
        <button type="button" className="mdp-link" onClick={() => setPhone(true)}>{d?.hasFeed ? "Your calendar on your phone" : "Put your appointments on your phone"}</button>
        {phone && <PhoneLink onClose={() => setPhone(false)} />}
      </> : <>
        {!jobs ? <div className="mdp-quiet">Loading jobs…</div> : <>
          {late.length > 0 && <>
            <button type="button" className="mdp-late" aria-expanded={lateOpen} onClick={() => setLateOpen(!lateOpen)}><b>{late.length} late</b><span>{lateOpen ? "Hide" : "Show"} ›</span></button>
            {lateOpen && <div className="mdp-card">{late.map((j) => <JobRow key={j.id} j={j} late />)}</div>}
          </>}
          {week.map((x) => {
            const list = jobs.filter((j) => j.day === x), pcs = list.reduce((a, j) => a + (j.qty || 0), 0), all = more[x];
            return (
              <section key={x}>
                <div className="mdp-dayh"><b>{dayLabel(x, today)}</b><span>{list.length} job{list.length === 1 ? "" : "s"}{pcs ? ` · ${pcs.toLocaleString()} pcs` : ""}</span></div>
                {!list.length ? <div className="mdp-quiet">Nothing due.</div> : <div className="mdp-card">
                  {(all ? list : list.slice(0, 2)).map((j) => <JobRow key={j.id} j={j} />)}
                  {list.length > 2 && <button type="button" className="mdp-more" onClick={() => setMore((m) => ({ ...m, [x]: !all }))}>{all ? "Show fewer" : `+ ${list.length - 2} more`}</button>}
                </div>}
              </section>
            );
          })}
          <Link href="/shop/my-calendar" className="mdp-link">Open the full calendar</Link>
        </>}
      </>}
    </div>
  );
}

function JobRow({ j, late }: { j: CalJob; late?: boolean }) {
  return (
    <Link href={j.href} className="mdp-row">
      <span className="mdp-m"><b>#{j.number} {j.customer}</b><small>{[j.nickname, j.qty ? `${j.qty.toLocaleString()} pcs` : "", late ? `due ${fmt(j.day, { month: "numeric", day: "numeric" })}` : ""].filter(Boolean).join(" · ")}</small></span>
      <Pill status={j.printavo ? "production" : j.status} pv={j.printavo ? j.statusLabel : null} />
    </Link>
  );
}

/* ───────────── Email ───────────── */

function EmailTab({ groups, loading }: { groups: EmailGroups | null; loading: boolean }) {
  const [k, setK] = useSticky<"back" | "fresh" | "web">("myday.phone.mail", "back");
  const list = groups ? groups[k] : [];
  const n = (x: "back" | "fresh" | "web") => (groups ? groups[x].length : 0);
  return (
    <div className="mdp-pad">
      <div className="mdp-hrow"><h1 className="mdp-h">Email</h1><span className="mdp-note">{groups ? `${n("back") + n("fresh") + n("web")} from customers` : ""}</span></div>
      <div className="mdp-sw three" role="tablist" aria-label="Email">
        {([["back", "Waiting on us"], ["fresh", "New"], ["web", "Web"]] as const).map(([x, l]) => (
          <button key={x} type="button" role="tab" aria-selected={k === x} className={k === x ? "on" : ""} onClick={() => setK(x)}>{l}{groups ? <small>{n(x)}</small> : null}</button>
        ))}
      </div>
      <div className="mdp-card">
        {loading || !groups ? <div className="mdp-quiet">Loading…</div> : !list.length ? <div className="mdp-quiet">{k === "back" ? "No one's waiting on us." : k === "fresh" ? "No new customers right now." : "No website quotes waiting."}</div> : list.map((x) => <MailRow key={x.k} x={x} />)}
      </div>
      <Link href="/shop/conversations" className="mdp-link">Open Conversations</Link>
    </div>
  );
}

/* ───────────── To-do ───────────── */

function TodoTab({ d, setD, today, finish, reopen }: { d: Day | null; setD: (f: (x: Day | null) => Day | null) => void; today: string; finish: (t: Task) => void; reopen: (t: Task) => void }) {
  const [k, setK] = useState<"open" | "done">("open"), [text, setText] = useState(""), [busy, setBusy] = useState(false), [later, setLater] = useState(false), [err, setErr] = useState("");
  const open = (d?.tasks || []).filter((t) => t.status === "open" && (!t.snooze_until || t.snooze_until <= today));
  const done = (d?.tasks || []).filter((t) => t.status === "done");
  const wk = addDays(today, 7);
  const groups = useMemo(() => [
    { k: "today", label: "Today", list: open.filter((t) => t.due && t.due <= today) },
    { k: "week", label: "This week", list: open.filter((t) => t.due && t.due > today && t.due <= wk) },
    { k: "later", label: "Later", list: open.filter((t) => !t.due || t.due > wk) },
  ], [open, today, wk]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr("");
    const r = await addTask({ title: text, area: "shop" });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setText(""); setD((x) => (x ? { ...x, tasks: [r.task, ...x.tasks] } : x));
  }
  return (
    <div className="mdp-pad">
      <div className="mdp-hrow"><h1 className="mdp-h">To-do</h1><span className="mdp-note">{open.length} open</span></div>
      <div className="mdp-sw" role="tablist" aria-label="To-dos">
        <button type="button" role="tab" aria-selected={k === "open"} className={k === "open" ? "on" : ""} onClick={() => setK("open")}>Open<small>{open.length}</small></button>
        <button type="button" role="tab" aria-selected={k === "done"} className={k === "done" ? "on" : ""} onClick={() => setK("done")}>Done today<small>{done.length}</small></button>
      </div>
      {k === "open" ? <>
        <form onSubmit={add} className="mdp-add"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do…" aria-label="Add a to-do" /><button type="submit" className="btn primary sm" disabled={busy || !text.trim()}>Add</button></form>
        {err && <div className="pv-err">{err}</div>}
        {groups.map((g) => g.list.length ? (
          <section key={g.k}>
            <div className="mdp-sec"><span>{g.label}</span><span>{g.list.length}</span></div>
            <div className="mdp-card">
              {(g.k === "later" && !later ? g.list.slice(0, 5) : g.list).map((t) => <TaskRow key={t.id} t={t} today={today} onDone={() => finish(t)} />)}
              {g.k === "later" && g.list.length > 5 && <button type="button" className="mdp-more" onClick={() => setLater(!later)}>{later ? "Show fewer" : `Show ${g.list.length - 5} more`}</button>}
            </div>
          </section>
        ) : null)}
        {!open.length && <div className="mdp-quiet">Nothing on your list.</div>}
      </> : <div className="mdp-card">{done.length ? done.map((t) => <TaskRow key={t.id} t={t} today={today} done onDone={() => reopen(t)} />) : <div className="mdp-quiet">Nothing finished yet today.</div>}</div>}
    </div>
  );
}
