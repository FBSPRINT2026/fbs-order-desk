"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { daysTo, type ProjectSummary } from "@/lib/projects";
import { money } from "@/lib/format";

type Ev = { date: string; label: string; sub: string; kind: "event" | "due" | "task"; href?: string };
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const iso = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/**
 * The top of the customer's Projects page (Nov 2, Nick: "flesh this out… projects, timelines… orders and quotes within
 * that… a calendar"): the numbers across all their projects, a timeline of the next eight weeks, a month calendar with the
 * project dates on it, and what's coming up. Everything comes from the projects, their orders and their checklists.
 */
export default function ProjectsOverview({ projects, hrefOf, orderHref }: { projects: ProjectSummary[]; hrefOf: (id: string) => string; orderHref: (id: string) => string }) {
  const live = projects.filter((p) => p.status === "planning" || p.status === "active");
  const today = iso(new Date());
  const evs = useMemo(() => {
    const out: Ev[] = [];
    for (const p of live) {
      if (p.event_date) out.push({ date: p.event_date, label: p.name, sub: "Event", kind: "event", href: hrefOf(p.id) });
      if (p.in_hands_date) out.push({ date: p.in_hands_date, label: p.name, sub: "Everything needed by", kind: "due", href: hrefOf(p.id) });
      for (const o of p.items || []) if (o.due_date) out.push({ date: o.due_date, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, sub: "In hands", kind: "due", href: orderHref(o.id) });
      for (const t of p.tasks || []) if (t.due_date && !t.done) out.push({ date: t.due_date, label: t.title, sub: p.name, kind: "task", href: hrefOf(p.id) });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [live, hrefOf, orderHref]);
  const ahead = evs.filter((e) => e.date >= today);
  const orderCount = live.reduce((a, p) => a + (p.items?.length || p.orders || 0), 0);
  const value = live.reduce((a, p) => a + (p.total || 0), 0);
  // the timeline: today to eight weeks out
  const span = 56;
  const pos = (d: string) => Math.max(0, Math.min(100, ((daysTo(d) ?? 0) / span) * 100));
  const onLine = ahead.filter((e) => (daysTo(e.date) ?? 99) <= span && e.kind !== "task").slice(0, 8);
  // the calendar
  const [mo, setMo] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const first = mo.getDay(), days = new Date(mo.getFullYear(), mo.getMonth() + 1, 0).getDate();
  const byDay = new Map<string, Ev[]>();
  for (const e of evs) byDay.set(e.date, [...(byDay.get(e.date) || []), e]);
  const cell = (n: number) => iso(new Date(mo.getFullYear(), mo.getMonth(), n));
  if (!live.length) return null;
  return (
    <div className="pjo">
      <div className="stats pjo-stats">
        <div className="stat"><span className="k">Active projects</span><span className="v">{live.length}</span></div>
        <div className="stat"><span className="k">Next date</span><span className="v">{ahead[0] ? day(ahead[0].date) : "—"}</span><small>{ahead[0] ? `${ahead[0].label} · ${ahead[0].sub.toLowerCase()}` : "Nothing scheduled"}</small></div>
        <div className="stat"><span className="k">Orders in projects</span><span className="v">{orderCount}</span></div>
        <div className="stat"><span className="k">Project total</span><span className="v">{money(value)}</span></div>
      </div>
      <div className="pjo-g">
        <section className="pjo-card pjo-tl" style={{ ["--hc" as string]: "var(--fbs-violet)" }}>
          <div className="pjo-h"><h2>Timeline</h2><span className="faint">The next 8 weeks</span></div>
          <div className="pjo-tl-b">
            <div className="pjo-line"><span className="pjo-today" style={{ left: "0%" }}><small>Today</small></span>
              {onLine.map((e, k) => (
                <Link key={k} href={e.href || "#"} className={"pjo-ev " + e.kind + (k % 2 ? " lo" : "")} style={{ left: `${pos(e.date)}%` }} title={`${e.label} · ${e.sub}`}>
                  <i /><small><b>{day(e.date)}</b><span>{e.label}</span></small>
                </Link>))}
            </div>
            {!onLine.length && <p className="faint pjo-none">No project dates in the next 8 weeks.</p>}
          </div>
        </section>
        <section className="pjo-card pjo-cal" style={{ ["--hc" as string]: "var(--fbs-orange)" }}>
          <div className="pjo-h"><h2>{mo.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
            <span className="pjo-nav"><button type="button" aria-label="Last month" onClick={() => setMo(new Date(mo.getFullYear(), mo.getMonth() - 1, 1))}>‹</button><button type="button" aria-label="Next month" onClick={() => setMo(new Date(mo.getFullYear(), mo.getMonth() + 1, 1))}>›</button></span></div>
          <div className="pjo-cal-b">
            <div className="pjo-grid">{["S", "M", "T", "W", "T", "F", "S"].map((d, k) => <span key={"h" + k} className="hd">{d}</span>)}
              {Array.from({ length: first }, (_, k) => <span key={"b" + k} />)}
              {Array.from({ length: days }, (_, k) => { const d = cell(k + 1), es = byDay.get(d) || []; return (
                <span key={d} className={[es.some((e) => e.kind === "event") ? "ev" : es.length ? "due" : "", d === today ? "today" : ""].join(" ")} title={es.map((e) => `${e.label} · ${e.sub}`).join("\n") || undefined}>{k + 1}</span>); })}
            </div>
            <div className="pjo-leg"><span><i className="ev" />Event</span><span><i className="due" />Due / in hands</span><span><i className="today" />Today</span></div>
            {ahead.length > 0 && <ul className="pjo-up">{ahead.slice(0, 4).map((e, k) => <li key={k}><b>{day(e.date)}</b><span>{e.label}</span><small>{e.sub}</small></li>)}</ul>}
          </div>
        </section>
      </div>
    </div>
  );
}
