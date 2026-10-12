"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NewEvent, PhoneLink, useMyDay } from "@/components/MyDay";
import { setEventStatus, shopDates, type CalEvent } from "@/app/shop/myday-actions";

/**
 * Calendar (top of the menu): your month. What you added (and accepted from email), the shop's in-hands dates, and
 * suggestions from email waiting for a tap. "On your phone" gives the private link the phone subscribes to.
 */
const tz = "America/Chicago";
const ymd = (d: Date) => d.toLocaleDateString("en-CA");
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(":00", "").replace(" ", "").toLowerCase();

export default function MyCalendar() {
  const { d, setD } = useMyDay();
  const today = d?.today || new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [sel, setSel] = useState(today), [adding, setAdding] = useState(false), [phone, setPhone] = useState(false), [showShop, setShowShop] = useState(true);
  const [shop, setShop] = useState<{ id: string; number: number; nickname: string; day: string; status: string; customer: string }[]>([]);
  const grid = useMemo(() => {
    const first = new Date(month + "-01T12:00:00"), start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return ymd(x); });
  }, [month]);
  useEffect(() => { shopDates(grid[0], grid[41]).then((r) => { if (r.ok) setShop(r.orders); }); }, [grid]);
  const evs = (d?.events || []).filter((e) => e.status === "added");
  const sugg = (d?.events || []).filter((e) => e.status === "suggested" && (e.day || "") >= today);
  const on = (day: string) => evs.filter((e) => e.day === day).sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
  const due = (day: string) => (showShop ? shop.filter((o) => o.day === day) : []);
  const shift = (n: number) => { const x = new Date(month + "-01T12:00:00"); x.setMonth(x.getMonth() + n); setMonth(ymd(x).slice(0, 7)); };
  const setStatus = async (e: CalEvent, status: "added" | "dismissed") => { setD((x) => (x ? { ...x, events: x.events.map((y) => (y.id === e.id ? { ...y, status } : y)) } : x)); await setEventStatus(e.id, status); };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">My Day</div><h1>Calendar</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="check"><input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} />In-hands dates</label>
          <button type="button" className="btn sm" onClick={() => setPhone(true)}>On your phone</button>
          <button type="button" className="btn sm primary" onClick={() => setAdding(true)}>+ Event</button>
        </div>
      </div>
      <div className="mc">
        <section className="mc-month" aria-label="Month">
          <div className="mc-nav">
            <button type="button" className="btn sm ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <h2>{new Date(month + "-01T12:00:00").toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
            <button type="button" className="btn sm ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
            <button type="button" className="btn sm ghost" onClick={() => { setMonth(today.slice(0, 7)); setSel(today); }}>Today</button>
          </div>
          <div className="mc-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="mc-wd">{w}</div>)}
            {grid.map((day) => {
              const e = on(day), o = due(day);
              return (
                <button key={day} type="button" className={"mc-day" + (day.slice(0, 7) !== month ? " out" : "") + (day === today ? " today" : "") + (day === sel ? " on" : "")} onClick={() => setSel(day)} aria-label={`${day}: ${e.length} events, ${o.length} orders due`}>
                  <span className="mc-n">{Number(day.slice(8))}</span>
                  {e.slice(0, 3).map((x) => <span key={x.id} className="mc-ev">{x.starts_at ? <i>{timeOf(x.starts_at)}</i> : null}{x.title}</span>)}
                  {o.length > 0 && <span className="mc-due">{o.length} due</span>}
                  {e.length > 3 && <span className="mc-more">+{e.length - 3}</span>}
                </button>
              );
            })}
          </div>
        </section>
        <aside className="mc-side">
          <h3>{new Date(sel + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h3>
          {adding && <NewEvent day={sel} onDone={(e) => { setAdding(false); if (e) setD((x) => (x ? { ...x, events: [...x.events, e] } : x)); }} />}
          {!on(sel).length && !due(sel).length ? <p className="faint">Nothing on this day.</p> : <ul className="md-evs">
            {on(sel).map((e) => (
              <li key={e.id} className="md-ev">
                <span className="md-ev-t">{e.starts_at ? timeOf(e.starts_at) : "All day"}</span>
                <div><b>{e.title}</b>{e.place && <span> · {e.place}</span>}{e.notes && <div className="faint md-ev-n">{e.notes}</div>}<button type="button" className="mc-x" onClick={() => setStatus(e, "dismissed")}>Remove</button></div>
              </li>
            ))}
            {due(sel).map((o) => <li key={o.id} className="md-ev due"><span className="md-ev-t">Due</span><Link href={`/shop/orders/${o.id}`}><b>#{o.number} {o.customer}</b>{o.nickname && <span> · {o.nickname}</span>}</Link></li>)}
          </ul>}
          {sugg.length > 0 && <>
            <h3 className="mc-h2">From your email</h3>
            {sugg.map((e) => (
              <div key={e.id} className="md-sg">
                <div className="md-sg-t"><b>{e.title}</b><span>{e.day ? new Date(e.day + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : ""}{e.starts_at ? ` · ${timeOf(e.starts_at)}` : ""}{e.place ? ` · ${e.place}` : ""}</span></div>
                <div className="md-sg-a"><button type="button" className="btn sm primary" onClick={() => setStatus(e, "added")}>Add</button><button type="button" className="btn sm ghost" onClick={() => setStatus(e, "dismissed")}>Not now</button></div>
              </div>
            ))}
          </>}
        </aside>
      </div>
      {phone && <PhoneLink onClose={() => setPhone(false)} />}
    </>
  );
}
