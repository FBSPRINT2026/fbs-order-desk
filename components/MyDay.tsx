"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { cheerWin, setCheerOn } from "@/components/Cheer";
import { addEvent, addTask, calendarLink, getCheer, setCheer, deleteTask, getMyDay, handTask, setCalendarShop, setEventStatus, setTaskDone, shopDates, updateTask, type CalEvent, type Task } from "@/app/shop/myday-actions";

/**
 * My Day (the dashboard's top, Oct 12): one place for the day. Three columns: replies owed (customers: email and portal
 * messages, texts once the Mac is set up), to-dos (from email, the shop, or typed in), and the calendar (added events,
 * suggestions from email, the shop's in-hands dates). On a phone the three are tabs.
 */
export const AREAS: Record<string, { label: string; c: string }> = {
  personal: { label: "Personal", c: "#A152C9" },
  money: { label: "Money", c: "#0F8C78" },
  shop: { label: "Shop", c: "#0E9BD8" },
  customer: { label: "Customer", c: "#F26660" },
};
const tz = "America/Chicago";
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: tz });
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
const dayName = (d: string, t = todayStr()) => d === t ? "Today" : d === addDays(t, 1) ? "Tomorrow" : d === addDays(t, -1) ? "Yesterday" : new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(":00", "").replace(" ", "").toLowerCase();

type Day = { today: string; tasks: Task[]; events: CalEvent[]; others: { email: string; name: string }[]; hasFeed: boolean };

export function useMyDay() {
  const [d, setD] = useState<Day | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await getMyDay(); if (r.ok) { setD(r); setErr(""); } else setErr(r.error); }, []);
  useEffect(() => { load(); const t = setInterval(load, 90000); return () => clearInterval(t); }, [load]);
  return { d, setD, load, err };
}

export default function MyDay({ name, replies, replyCount, urgentCount, side, children }: { name: string; replies: React.ReactNode; replyCount: number; urgentCount: number;
  /** the owners' My Day (Oct 24, Nick: "the calendar, the to-dos, can you make that a side panel… and then go right into the
   * favorites"): calendar, to-dos and replies stacked on the right, the page's own sections (children) on the left */ side?: boolean; children?: React.ReactNode }) {
  const { d, setD, load, err } = useMyDay();
  const [tab, setTab] = useState<"replies" | "todo" | "cal">("todo");
  const [shop, setShop] = useState<{ id: string; number: number; nickname: string; day: string; status: string; customer: string }[]>([]);
  const today = d?.today || todayStr();
  useEffect(() => { shopDates(addDays(today, -1), addDays(today, 30)).then((r) => { if (r.ok) setShop(r.orders); }); }, [today]);
  const open = (d?.tasks || []).filter((t) => t.status === "open" && (!t.snooze_until || t.snooze_until <= today));
  const due = open.filter((t) => t.due && t.due <= today).length;
  const evToday = (d?.events || []).filter((e) => e.status === "added" && e.day === today).length;
  const hello = (() => { const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: tz })); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })();
  const line = [replyCount ? (side ? `${replyCount} ${replyCount === 1 ? "email" : "emails"} from customers` : `${replyCount} ${replyCount === 1 ? "reply" : "replies"} to send`) : "", due ? `${due} to-do${due === 1 ? "" : "s"} due` : "", evToday ? `${evToday} on the calendar` : ""].filter(Boolean);

  return (
    <section className="md" aria-label="My Day">
      <header className="md-head">
        <div>
          <div className="md-date">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: tz })}</div>
          <h1>{hello}{name ? `, ${name}` : ""}</h1>
          <p className="md-line">{line.length ? line.join(" · ") : "Nothing waiting on you. Enjoy it."}</p>
        </div>
        <CheerSwitch />
      </header>
      {side ? (
        <div className="md2">
          <aside className="md2-side" aria-label="Calendar and to-dos">
            <div className="md-col md-cal"><CalendarPanel d={d} setD={setD} shop={shop} /></div>
            <div className="md-col md-todo"><Todos d={d} setD={setD} load={load} err={err} /></div>
            {/* an Email summary now, not a red Replies list (Oct 26, Nick: "anxiety in a box") */}
            <div className="md-col md-replies md-email">
              <div className="md-col-h"><h2>Email</h2><span className="spacer" /><Link href="/shop/conversations" className="md-link">Conversations</Link></div>
              {replies}
            </div>
          </aside>
          <div className="md2-main">{children}</div>
        </div>
      ) : <>
      <div className="md-tabs" role="tablist" aria-label="My Day">
        <button type="button" role="tab" aria-selected={tab === "replies"} className={tab === "replies" ? "on" : ""} onClick={() => setTab("replies")}>Replies<b className={urgentCount ? "hot" : ""}>{replyCount}</b></button>
        <button type="button" role="tab" aria-selected={tab === "todo"} className={tab === "todo" ? "on" : ""} onClick={() => setTab("todo")}>To-do<b className={due ? "hot" : ""}>{open.length}</b></button>
        <button type="button" role="tab" aria-selected={tab === "cal"} className={tab === "cal" ? "on" : ""} onClick={() => setTab("cal")}>Calendar<b>{evToday}</b></button>
      </div>
      <div className="md-cols" data-tab={tab}>
        <div className="md-col md-replies">
          <div className="md-col-h"><h2>Replies</h2>{replyCount > 0 && <span className="md-n">{replyCount}</span>}{urgentCount > 0 && <span className="md-hot">{urgentCount} urgent</span>}<span className="spacer" /><Link href="/shop/conversations" className="md-link">Conversations</Link></div>
          {replies}
        </div>
        <div className="md-col md-todo">
          <Todos d={d} setD={setD} load={load} err={err} />
        </div>
        <div className="md-col md-cal">
          <CalendarPanel d={d} setD={setD} shop={shop} />
        </div>
      </div>
      </>}
    </section>
  );
}

/* ───────────────────────── to-dos ───────────────────────── */

export function Todos({ d, setD, load, compact, err }: { d: Day | null; setD: (f: (x: Day | null) => Day | null) => void; load: () => Promise<void>; compact?: boolean; err?: string }) {
  const today = d?.today || todayStr();
  const [area, setArea] = useState<string>("all");
  const [text, setText] = useState(""), [newDue, setNewDue] = useState<string>(""), [newArea, setNewArea] = useState("shop");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [menu, setMenu] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [showDone, setShowDone] = useState(false);
  // just the list (Oct 26, Nick picked option A: "way too complicated"): the first few, the rest one click away; a
  // to-do's details (who it's from, its link, notes) open when you click it
  const [all, setAll] = useState(false), [open1, setOpen1] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (t: string, undo?: () => void) => { setToast({ text: t, undo }); if (toastT.current) clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 6000); };
  const patchTask = (id: string, p: Partial<Task>) => setD((x) => (x ? { ...x, tasks: x.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) } : x));
  useEffect(() => { const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".md-menu, .md-more")) setMenu(null); }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, []);

  const open = (d?.tasks || []).filter((t) => t.status === "open" && (!t.snooze_until || t.snooze_until <= today));
  const done = (d?.tasks || []).filter((t) => t.status === "done");
  const counts = useMemo(() => { const c: Record<string, number> = { all: open.length }; for (const t of open) c[t.area] = (c[t.area] || 0) + 1; return c; }, [open]);
  const shown = open.filter((t) => area === "all" || t.area === area);
  const sorted = [...shown].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (b.created_at || "").localeCompare(a.created_at || ""));
  const FIRST = 6, list = all ? sorted : sorted.slice(0, FIRST);
  const dueShort = (dd: string) => dd === today ? "Today" : dd === addDays(today, 1) ? "Tmrw" : dd > today && dd <= addDays(today, 6) ? new Date(dd + "T12:00:00").toLocaleDateString([], { weekday: "short" }) : new Date(dd + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    const title = text.trim();
    if (!title) return;
    setText("");
    const r = await addTask({ title, area: newArea, due: newDue || null });
    if (r.ok) { setD((x) => (x ? { ...x, tasks: [r.task, ...x.tasks] } : x)); setNewDue(""); } else say(r.error);
  }
  async function finish(t: Task) {
    patchTask(t.id, { status: "done", done_at: new Date().toISOString() });
    const r = await setTaskDone(t.id, true);
    if (!r.ok) { patchTask(t.id, { status: "open" }); say(r.error); return; }
    cheerWin("todo", { allDone: open.filter((x) => x.id !== t.id).length === 0 });
    say(r.archived ? "Done. The email is archived in Outlook." : "Done.", async () => { patchTask(t.id, { status: "open", done_at: null }); await setTaskDone(t.id, false); setToast(null); });
  }
  async function reopen(t: Task) { patchTask(t.id, { status: "open", done_at: null }); await setTaskDone(t.id, false); }
  async function setDue(t: Task, due: string | null) { setMenu(null); patchTask(t.id, { due }); const r = await updateTask(t.id, { due }); if (!r.ok) say(r.error); }
  async function hand(t: Task, to: { email: string; name: string }) { setMenu(null); setD((x) => (x ? { ...x, tasks: x.tasks.filter((y) => y.id !== t.id) } : x)); const r = await handTask(t.id, to.email); say(r.ok ? `Handed to ${to.name}.` : r.error); if (!r.ok) load(); }
  async function drop(t: Task) { setMenu(null); setD((x) => (x ? { ...x, tasks: x.tasks.filter((y) => y.id !== t.id) } : x)); await deleteTask(t.id); say("Removed. It wasn't a to-do."); }

  return (
    <>
      <div className="md-col-h"><h2>To-do</h2>{open.length > 0 && <span className="md-n">{open.length}</span>}</div>
      <form className="md-add" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do…" aria-label="Add a to-do" />
        {text.trim() && <div className="md-add-opts">
          <select value={newArea} onChange={(e) => setNewArea(e.target.value)} aria-label="Area">{Object.entries(AREAS).filter(([k]) => k !== "customer").map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</select>
          <div className="md-seg" role="group" aria-label="Due">
            {[["", "Anytime"], [today, "Today"], [addDays(today, 1), "Tomorrow"]].map(([v, l]) => <button key={l} type="button" className={newDue === v ? "on" : ""} onClick={() => setNewDue(v)}>{l}</button>)}
            <input type="date" value={newDue && newDue !== today && newDue !== addDays(today, 1) ? newDue : ""} onChange={(e) => setNewDue(e.target.value)} aria-label="Pick a day" />
          </div>
          <button type="submit" className="btn sm primary">Add</button>
        </div>}
      </form>
      <div className="md-scroll">
        {!d ? <div className="md-empty">{err ? <><b>Couldn&apos;t load your to-dos</b><span>{err}</span></> : "Loading…"}</div> : !shown.length ? (
          <div className="md-empty"><b>{area === "all" ? "All clear" : `Nothing for ${AREAS[area]?.label || area}`}</b><span>To-dos from your email show up here on their own. Add your own above.</span></div>
        ) : <>
          <ul className="md-list md-flat">{list.map((t) => (
            <li key={t.id} className={"md-task md-task-a" + (open1 === t.id ? " open" : "")} style={{ ["--ac" as string]: AREAS[t.area]?.c || AREAS.shop.c }}>
              <button type="button" className="md-check" aria-label={`Done: ${t.title}`} title="Done" onClick={() => finish(t)}><svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg></button>
              <div className="md-task-b">
                {editing === t.id
                  ? <input className="md-edit" autoFocus defaultValue={t.title} aria-label="To-do" onBlur={async (e) => { setEditing(null); const v = e.target.value.trim(); if (v && v !== t.title) { patchTask(t.id, { title: v }); await updateTask(t.id, { title: v }); } }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
                  : <button type="button" className="md-task-t" onClick={() => setOpen1(open1 === t.id ? null : t.id)} onDoubleClick={() => setEditing(t.id)} title={t.title}>{t.title}</button>}
                {open1 === t.id && <>
                  <div className="md-task-m">
                    <span className="md-area"><i />{AREAS[t.area]?.label || t.area}</span>
                    {t.from && <Link href={t.mail_inbox_id ? `/shop/inbox?item=${t.mail_inbox_id}` : "/shop/inbox"} className="md-from" title={t.subject || ""}>✉ {t.from}</Link>}
                    {t.url && <Link href={t.url} className="md-from md-job">{t.source === "jobs" ? (/order-goods/.test(t.url) ? "Order goods ›" : /receiving/.test(t.url) ? "Receiving ›" : "Open the job ›") : "Open ›"}</Link>}
                    {t.handed_by && <span className="md-handed">from {t.handed_by}</span>}
                  </div>
                  {t.notes && <div className="md-task-n open">{t.notes}</div>}
                </>}
              </div>
              {t.due && <span className={"md-due" + (t.due < today ? " late" : "")}>{dueShort(t.due)}</span>}
              <button type="button" className="md-more" aria-label="More" aria-expanded={menu === t.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === t.id ? null : t.id); }}>⋯</button>
              {menu === t.id && <div className="md-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => setDue(t, today)}>Today</button>
                <button type="button" role="menuitem" onClick={() => setDue(t, addDays(today, 1))}>Tomorrow</button>
                <button type="button" role="menuitem" onClick={() => setDue(t, addDays(today, 7))}>Next week</button>
                <label className="md-menu-date">Pick a day<input type="date" defaultValue={t.due || ""} onChange={(e) => setDue(t, e.target.value || null)} /></label>
                {t.due && <button type="button" role="menuitem" onClick={() => setDue(t, null)}>No date</button>}
                <hr />
                <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing(t.id); }}>Rename</button>
                {(d?.others || []).map((o) => <button key={o.email} type="button" role="menuitem" onClick={() => hand(t, o)}>Hand to {o.name}</button>)}
                <div className="md-menu-areas">{Object.entries(AREAS).map(([k, a]) => <button key={k} type="button" title={a.label} className={t.area === k ? "on" : ""} style={{ ["--ac" as string]: a.c }} onClick={async () => { setMenu(null); patchTask(t.id, { area: k }); await updateTask(t.id, { area: k }); }}>{a.label}</button>)}</div>
                <hr />
                <button type="button" role="menuitem" className="danger" onClick={() => drop(t)}>Not a to-do</button>
              </div>}
            </li>
          ))}</ul>
          {sorted.length > FIRST && <button type="button" className="md-link md-all" onClick={() => setAll(!all)}>{all ? "Show fewer" : `${sorted.length - FIRST} more`}</button>}
        </>}
        {done.length > 0 && <div className="md-done">
          <button type="button" className="md-done-h" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>Done today · {done.length}</button>
          {showDone && <ul className="md-list">{done.map((t) => (
            <li key={t.id} className="md-task done" style={{ ["--ac" as string]: AREAS[t.area]?.c }}>
              <button type="button" className="md-check on" aria-label={`Not done: ${t.title}`} title="Not done" onClick={() => reopen(t)}><svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg></button>
              <div className="md-task-b"><div className="md-task-t">{t.title}</div>{t.done_by === "Archived in Outlook" && <div className="md-task-m"><span>Archived in Outlook</span></div>}</div>
            </li>
          ))}</ul>}
        </div>}
      </div>
      {toast && <div className="md-toast" role="status">{toast.text}{toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}</div>}
    </>
  );
}

/* ───────────────────────── calendar ───────────────────────── */

function CalendarPanel({ d, setD, shop }: { d: Day | null; setD: (f: (x: Day | null) => Day | null) => void; shop: { id: string; number: number; nickname: string; day: string; status: string; customer: string }[] }) {
  const today = d?.today || todayStr();
  const [sel, setSel] = useState(today), [adding, setAdding] = useState(false), [phone, setPhone] = useState(false);
  const evs = (d?.events || []);
  const added = evs.filter((e) => e.status === "added");
  const sugg = evs.filter((e) => e.status === "suggested" && (e.day || "") >= today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const on = (day: string) => added.filter((e) => e.day === day);
  const dueOn = (day: string) => shop.filter((o) => o.day === day);
  const upcoming = added.filter((e) => (e.day || "") > sel && (e.day || "") <= addDays(today, 30)).slice(0, 8);
  const setStatus = async (e: CalEvent, status: "added" | "dismissed") => { setD((x) => (x ? { ...x, events: x.events.map((y) => (y.id === e.id ? { ...y, status } : y)) } : x)); await setEventStatus(e.id, status); };

  return (
    <>
      <div className="md-col-h"><h2>Calendar</h2><span className="spacer" /><button type="button" className="md-link" onClick={() => setAdding(!adding)}>+ Event</button></div>
      <div className="md-week" role="group" aria-label="This week">{days.map((day) => {
        const n = on(day).length, o = dueOn(day).length;
        return (
          <button key={day} type="button" className={(sel === day ? "on" : "") + (day === today ? " today" : "")} onClick={() => setSel(day)} aria-label={`${dayName(day, today)}: ${n} events, ${o} orders due`}>
            <span>{new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "narrow" })}</span><b>{Number(day.slice(8))}</b>
            <i>{n > 0 && <em className="ev" />}{o > 0 && <em className="due" />}</i>
          </button>
        );
      })}</div>
      {adding && <NewEvent day={sel} onDone={(e) => { setAdding(false); if (e) setD((x) => (x ? { ...x, events: [...x.events, e] } : x)); }} />}
      <div className="md-scroll">
        <div className="md-grp"><div className="md-grp-h">{dayName(sel, today)}</div>
          {!on(sel).length && !dueOn(sel).length ? <div className="md-quiet">Nothing on the calendar.</div> : <ul className="md-evs">
            {on(sel).map((e) => <EventRow key={e.id} e={e} />)}
            {dueOn(sel).map((o) => <li key={o.id} className="md-ev due"><span className="md-ev-t">Due</span><Link href={`/shop/orders/${o.id}`}><b>#{o.number} {o.customer}</b>{o.nickname && <span> · {o.nickname}</span>}</Link></li>)}
          </ul>}
        </div>
        {sugg.length > 0 && <div className="md-grp md-sugg"><div className="md-grp-h">From your email<span>{sugg.length}</span></div>
          {sugg.map((e) => (
            <div key={e.id} className="md-sg">
              <div className="md-sg-t"><b>{e.title}</b><span>{dayName(e.day || today, today)}{e.starts_at ? ` · ${timeOf(e.starts_at)}` : ""}{e.place ? ` · ${e.place}` : ""}</span>{e.from && <span className="faint">from {e.from}</span>}</div>
              <div className="md-sg-a"><button type="button" className="btn sm primary" onClick={() => setStatus(e, "added")}>Add</button><button type="button" className="btn sm ghost" onClick={() => setStatus(e, "dismissed")}>Not now</button></div>
            </div>
          ))}
        </div>}
        {upcoming.length > 0 && <div className="md-grp"><div className="md-grp-h">Coming up</div><ul className="md-evs">{upcoming.map((e) => <EventRow key={e.id} e={e} showDay today={today} />)}</ul></div>}
      </div>
      <div className="md-cal-foot">
        <Link href="/shop/my-calendar" className="md-link">Month view</Link>
        <button type="button" className="md-link" onClick={() => setPhone(true)}>{d?.hasFeed ? "Calendar on your phone" : "Put it on your phone"}</button>
      </div>
      {phone && <PhoneLink onClose={() => setPhone(false)} />}
    </>
  );
}

export function EventRow({ e, showDay, today }: { e: CalEvent; showDay?: boolean; today?: string }) {
  return (
    <li className="md-ev">
      <span className="md-ev-t">{showDay && e.day ? dayName(e.day, today) + (e.starts_at ? " " : "") : ""}{e.starts_at ? timeOf(e.starts_at) : showDay ? "" : "All day"}</span>
      <div><b>{e.title}</b>{e.place && <span> · {e.place}</span>}{e.notes && <div className="faint md-ev-n">{e.notes}</div>}</div>
    </li>
  );
}

export function NewEvent({ day, onDone }: { day: string; onDone: (e: CalEvent | null) => void }) {
  const [t, setT] = useState(""), [dd, setDd] = useState(day), [s, setS] = useState(""), [en, setEn] = useState(""), [pl, setPl] = useState(""), [err, setErr] = useState("");
  return (
    <form className="md-newev" onSubmit={async (ev) => { ev.preventDefault(); const r = await addEvent({ title: t, day: dd, start: s || null, end: en || null, place: pl }); if (r.ok) onDone(r.event); else setErr(r.error); }}>
      <input autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="What's happening?" aria-label="Event" />
      <div className="md-newev-r">
        <input type="date" value={dd} onChange={(e) => setDd(e.target.value)} aria-label="Day" />
        <input type="time" value={s} onChange={(e) => setS(e.target.value)} aria-label="Starts" />
        <input type="time" value={en} onChange={(e) => setEn(e.target.value)} aria-label="Ends" />
      </div>
      <input value={pl} onChange={(e) => setPl(e.target.value)} placeholder="Where (optional)" aria-label="Where" />
      {err && <div className="err">{err}</div>}
      <div className="md-newev-r"><button type="submit" className="btn sm primary" disabled={!t.trim()}>Add to calendar</button><button type="button" className="btn sm ghost" onClick={() => onDone(null)}>Cancel</button></div>
    </form>
  );
}

export function PhoneLink({ onClose }: { onClose: () => void }) {
  const [l, setL] = useState<{ https: string; webcal: string; shop: boolean } | null>(null), [err, setErr] = useState(""), [copied, setCopied] = useState(false);
  useEffect(() => { calendarLink().then((r) => (r.ok ? setL(r) : setErr(r.error))); }, []);
  return (
    <div className="md-modal" role="dialog" aria-modal="true" aria-label="Your calendar on your phone" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="md-modal-b">
        <h3>Your calendar on your phone</h3>
        <p>Events you add here show up in your phone&apos;s calendar, with a reminder an hour before. Set it up once.</p>
        {err && <div className="err">{err}</div>}
        {!l ? !err && <p className="faint">Making your link…</p> : <>
          <a className="btn primary md-modal-go" href={l.webcal}>Tap to add it to this phone</a>
          <ol className="md-steps">
            <li>On your iPhone, open this page and tap the blue button, then <b>Subscribe</b>.</li>
            <li>Or: Settings → Calendar → Accounts → Add Account → Other → <b>Add Subscribed Calendar</b>, and paste the link below.</li>
            <li>In Outlook: Add Calendar → From Internet, and paste the link.</li>
          </ol>
          <div className="md-copy"><code>{l.https}</code><button type="button" className="btn sm" onClick={async () => { await navigator.clipboard.writeText(l.https).catch(() => null); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy link"}</button></div>
          <label className="check"><input type="checkbox" defaultChecked={l.shop} onChange={(e) => setCalendarShop(e.target.checked)} />Include the shop&apos;s in-hands dates</label>
          <p className="faint md-small">This link is private to you. Anyone who has it can see your calendar, so don&apos;t share it.</p>
        </>}
        <div className="md-modal-x"><button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** the crew dashboard's to-do card (their own to-dos, e.g. handed to them) */
export function CrewTodos() {
  const { d, setD, load } = useMyDay();
  return <section className="db-card db-blue md-crew"><Todos d={d} setD={setD} load={load} compact /></section>;
}

/** Cheer mode's switch on My Day: fireworks and a kind note when you finish something */
function CheerSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void getCheer().then((r) => setOn(r.ok ? r.on : false)); }, []);
  if (on === null) return null;
  return (
    <label className={"md-cheer" + (on ? " on" : "")} title="Fireworks and a kind note when you finish something">
      <input type="checkbox" checked={on} onChange={(e) => { const v = e.target.checked; setOn(v); setCheerOn(v); void setCheer(v); if (v) setTimeout(() => cheerWin("todo"), 50); }} />
      <span aria-hidden>✨</span> Cheer mode
    </label>
  );
}
