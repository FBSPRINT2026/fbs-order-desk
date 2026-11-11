"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CheckinModal from "@/components/CheckinModal";
import GoodsIssues from "@/components/GoodsIssues";
import { useSticky } from "@/lib/useSticky";
import { createClient } from "@/lib/supabase/client";
import type { CheckJob, JobState } from "@/lib/checkinShared";

/**
 * Goods & Receiving's dashboard (Nov 11 2026, Nick, option E: "the first thing you should see… is what needs to be
 * counted in… today, tomorrow, next day… S&S and SanMar… a list on the right… issues that need to be worked"). One list
 * of the jobs to count in, picked by day (the schedule day each job is listed under, from the Check-In's own list, so
 * the two never disagree), Count in opens the Check-In tool on that job; the issues to work under it; on the right,
 * what the S&S and SanMar trucks bring today or tomorrow.
 */
export type DashTruckRow = { key: string; number: number; href: string; who: string; boxes: number; supplier: string; at: string | null; state: string };
type Day = "today" | "tomorrow" | "next" | "later" | "counted";

const STATE: Record<JobState, { label: string; tone: string }> = {
  ready: { label: "All here", tone: "ok" }, partial: { label: "Partly here", tone: "warn" }, issue: { label: "Problem", tone: "bad" },
  way: { label: "On the way", tone: "info" }, none: { label: "No tracking", tone: "gray" }, checked: { label: "Counted", tone: "ok" },
};
const RANK: Record<JobState, number> = { ready: 0, partial: 1, issue: 2, way: 3, none: 4, checked: 5 };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** the next working day after a day (Mon–Fri) */
const nextWork = (day: string) => { const d = new Date(day + "T12:00:00"); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); return ymd(d); };
const wkd = (day: string) => new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
const short = (day: string | null) => (day ? new Date(day.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export default function ReceivingDash({ trucks, localDay, onTruck }: { trucks: DashTruckRow[]; localDay: (iso: string | null | undefined) => string; onTruck: () => void }) {
  const [jobs, setJobs] = useState<CheckJob[] | null>(null);
  // jobs the press has started (or finished): their goods are on the press, off this list (Nov 11, Nick)
  const [started, setStarted] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [day, setDay] = useSticky<Day>("receiving.dashDay", "today");
  const [truckDay, setTruckDay] = useSticky<"today" | "tomorrow">("receiving.truckDay", "today");
  const [q, setQ] = useState("");
  const [count, setCount] = useState<CheckJob | null>(null);
  const [msg, setMsg] = useState("");
  const today = ymd(new Date()), d1 = nextWork(today), d2 = nextWork(d1);

  // this week and next (a Friday's "next day" is Monday)
  const load = useCallback(async () => {
    setErr("");
    const nextWeek = ymd(new Date(Date.now() + 7 * 86400000));
    const rs = await Promise.all([fetch("/api/goods/checkin", { cache: "no-store" }), fetch(`/api/goods/checkin?week=${nextWeek}`, { cache: "no-store" })].map((p) => p.then((r) => r.json()).catch(() => ({ error: "Couldn't reach the server." }))));
    if (rs[0].error) { setErr(rs[0].error); return; }
    const m = new Map<string, CheckJob>();
    for (const r of rs) for (const j of [...((r.jobs || []) as CheckJob[]), ...((r.problems || []) as CheckJob[])]) if (!m.has(j.ref)) m.set(j.ref, j);
    const list = [...m.values()], ids = list.map((j) => j.ref).filter((x) => !x.startsWith("pv:"));
    const on = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await createClient().from("production_slots").select("order_id").in("order_id", ids.slice(i, i + 200)).in("status", ["running", "done"]);
      for (const x of (data || []) as { order_id: string }[]) on.add(x.order_id);
    }
    setStarted(on); setJobs(list);
  }, []);
  useEffect(() => { load(); }, [load]);

  // each job sits on the day it runs on the press (the Check-In's own day); a goods problem stays on Today
  const dayOf = (j: CheckJob): Day => (!j.day || j.day <= today || j.state === "issue" ? "today" : j.day === d1 ? "tomorrow" : j.day === d2 ? "next" : "later");
  const live = useMemo(() => (jobs || []).filter((j) => !started.has(j.ref)), [jobs, started]);
  const open = useMemo(() => live.filter((j) => j.state !== "checked"), [live]);
  const counted = useMemo(() => live.filter((j) => j.state === "checked"), [live]);
  const n = (d: Day) => (d === "counted" ? counted.length : open.filter((j) => dayOf(j) === d).length);
  const sort = (a: CheckJob, b: CheckJob) => RANK[a.state] - RANK[b.state] || (a.day || "").localeCompare(b.day || "") || a.number - b.number;
  // the day's jobs to count, then that day's counted ones grayed (waiting for the press); Counted: every counted job
  const { shown, grayed } = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, "");
    const hit = (j: CheckJob) => `${j.number} ${j.customer} ${j.nickname} ${j.po}`.toLowerCase().includes(s);
    if (s) return { shown: open.filter(hit).sort(sort), grayed: counted.filter(hit).sort(sort) };
    if (day === "counted") return { shown: [] as CheckJob[], grayed: counted.slice().sort((a, b) => (a.day || "").localeCompare(b.day || "") || a.number - b.number) };
    return { shown: open.filter((j) => dayOf(j) === day).sort(sort), grayed: counted.filter((j) => dayOf(j) === day).sort(sort) };
  }, [open, counted, q, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const tDay = truckDay === "today" ? today : d1;
  const truckOf = (sup: string) => trucks.filter((r) => r.supplier === sup && localDay(r.at) === tDay && (truckDay === "tomorrow" || r.state !== "arrived" || localDay(r.at) === today));
  const truck = (sup: string, name: string, cls: string) => {
    const rs = truckOf(sup), boxes = rs.reduce((a, r) => a + (r.boxes || 0), 0);
    return (
      <div className={"rvd-sup " + cls}>
        <div className="rvd-sup-h"><span>{name}</span><small>{rs.length ? `${rs.length} order${rs.length === 1 ? "" : "s"} · ${boxes} box${boxes === 1 ? "" : "es"}` : "nothing"}</small></div>
        {rs.map((r) => <div key={r.key} className="rvd-sup-r"><span>{r.number ? <Link className="ordno" href={r.href}>#{r.number}</Link> : null} <span data-notranslate>{r.who}</span></span><small>{r.boxes} box{r.boxes === 1 ? "" : "es"}</small></div>)}
        {!rs.length && <div className="rvd-sup-r faint">Nothing on the manifests for {truckDay === "today" ? "today" : wkd(d1)}.</div>}
        {sup === "ss" && truckDay === "today" && <div className="rvd-sup-f"><button type="button" className="btn sm" onClick={onTruck}>Receive the truck</button></div>}
      </div>
    );
  };

  const tmr = ymd(new Date(new Date(today + "T12:00:00").getTime() + 86400000));
  const d1Label = d1 === tmr ? "Tomorrow" : wkd(d1);
  const DAYS: [Day, string][] = [["today", "Today"], ["tomorrow", d1Label], ["next", wkd(d2)], ["later", "Later"]];
  return (
    <div className="rvd">
      <div className="rvd-main">
        <section className="panel">
          <div className="rvd-bar" data-toolbar>
            <div className="chips">{DAYS.map(([k, l]) => <button key={k} type="button" className={"chip" + (!q.trim() && day === k ? " on" : "")} onClick={() => { setDay(k); setQ(""); }}>{l}<span className="rvd-n">{jobs ? n(k) : "…"}</span></button>)}</div>
            <div className="rvd-bar-r"><button type="button" className={"chip" + (!q.trim() && day === "counted" ? " on" : "")} onClick={() => { setDay("counted"); setQ(""); }}>✓ Counted<span className="rvd-n">{jobs ? n("counted") : "…"}</span></button>
            <input className="rvd-q" placeholder="Find an order" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {msg && <div className="banner" style={{ margin: "8px 12px 0" }}>{msg}</div>}
          {err ? <div className="empty">{err}</div> : !jobs ? <div className="empty">Loading…</div> : !shown.length && !grayed.length ? <div className="empty">{q.trim() ? "No order matches." : day === "counted" ? "Nothing counted is waiting for the press." : day === "today" ? "Nothing to count in today." : "Nothing to count in that day."}</div> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Order</th><th>From</th><th>Pieces</th><th>Status</th><th /></tr></thead>
              <tbody>{shown.map((j) => {
                const st = STATE[j.state], pcs = j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
                return (
                  <tr key={j.ref} className={day === "today" && !q.trim() && j.state !== "way" && j.state !== "none" ? "rvd-urg" : ""}>
                    <td><Link className="ordno" href={j.ref.startsWith("pv:") ? `/shop/archive/${j.ref.slice(3)}` : `/shop/orders/${j.ref}`}>#{j.number}</Link> <b data-notranslate>{j.customer}</b><div className="sub" data-notranslate>{[j.nickname, j.start ? `prints ${short(j.start)}` : "", j.due ? `due ${short(j.due)}` : ""].filter(Boolean).join(" · ")}</div></td>
                    <td><span className="rvd-from">{j.suppliers.length ? j.suppliers.join(" / ") : "Customer / other"}</span><div className="sub">{j.lines ? `${j.arrived} of ${j.shipped} delivered${j.boxes ? ` · ${j.boxes} box${j.boxes === 1 ? "" : "es"}` : ""}` : "no manifest"}</div></td>
                    <td className="rvd-pcs">{j.shipped && j.lines ? <span className="rvd-bar2"><i style={{ width: `${Math.min(100, Math.round((j.arrived / Math.max(1, j.shipped)) * 100))}%` }} /></span> : null}<b>{pcs}</b> <span className="sub">pcs</span></td>
                    <td><span className={"rvd-pill " + st.tone}>{st.label}</span></td>
                    <td className="rvd-act"><button type="button" className={"btn sm" + (j.state === "ready" || j.state === "partial" || j.state === "none" ? " primary" : "")} onClick={() => setCount(j)}>{j.state === "issue" ? "Recount" : "Count in"}</button></td>
                  </tr>
                );
              })}
              {grayed.length > 0 && day !== "counted" && <tr className="rvd-sub"><td colSpan={5}>Counted · waiting for the press to start <span className="rvd-n">{grayed.length}</span></td></tr>}
              {grayed.map((j) => { const pcs = j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0), last = j.checkins[0]; return (
                <tr key={j.ref} className="rvd-done">
                  <td><Link className="ordno" href={j.ref.startsWith("pv:") ? `/shop/archive/${j.ref.slice(3)}` : `/shop/orders/${j.ref}`}>#{j.number}</Link> <b data-notranslate>{j.customer}</b><div className="sub" data-notranslate>{[j.nickname, j.start ? `prints ${short(j.start)}` : ""].filter(Boolean).join(" · ")}</div></td>
                  <td><span className="rvd-from">{j.suppliers.length ? j.suppliers.join(" / ") : "Customer / other"}</span></td>
                  <td className="rvd-pcs"><b>{pcs}</b> <span className="sub">pcs</span></td>
                  <td><span className="rvd-pill ok">✓ Counted{last ? ` · ${new Date(last.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span></td>
                  <td className="rvd-act"><button type="button" className="btn sm ghost" onClick={() => setCount(j)}>Recount</button></td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </section>
        <div className="rvd-iss"><GoodsIssues href={(i) => (i.order_id ? `/shop/orders/${i.order_id}` : `/shop/archive/${i.archived_order_id}`)} /></div>
      </div>
      <aside className="rvd-side">
        <section className="panel rvd-trk">
          <div className="panel-h"><h2>Trucks</h2><div className="chips">{(["today", "tomorrow"] as const).map((k) => <button key={k} type="button" className={"chip" + (truckDay === k ? " on" : "")} onClick={() => setTruckDay(k)}>{k === "today" ? "Today" : d1Label}</button>)}</div></div>
        </section>
        {truck("ss", "S&S", "ss")}
        {truck("sanmar", "SanMar", "sm")}
      </aside>
      {count && <CheckinModal job={count} onClose={() => setCount(null)} onSaved={(c) => { setCount(null); setMsg(c.status === "issue" ? `#${count.number} checked in with ${c.lines.filter((l) => l.issue).length} problem(s): it's under the issues until resolved.` : `#${count.number} checked in: all ${c.received} here.`); load(); }} />}
    </div>
  );
}
