"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CheckinModal from "@/components/CheckinModal";
import GoodsIssues from "@/components/GoodsIssues";
import WorkOrderView, { PrinterIcon } from "@/components/WorkOrderView";
import { useSticky } from "@/lib/useSticky";
import { createClient } from "@/lib/supabase/client";
import type { CheckJob, JobKind, JobState } from "@/lib/checkinShared";

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
  // the day each job is really on the schedule (its first booking not done yet): Schedule mode goes by this, never by
  // a date typed on the order (Nov 11, Nick: "I don't have anything scheduled… everything should show as later")
  const [onSched, setOnSched] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState("");
  // Schedule · All · Today unless someone was just here: 5 minutes away and it's back (Nov 11, Nick)
  const AWAY = 5 * 60 * 1000;
  const [day, setDay] = useSticky<Day>("receiving.dashDay", "today", AWAY);
  // screen print / embroidery / heat press (Nov 11, Nick, option 1: a full-width switch over the list)
  const [kind, setKind] = useSticky<"all" | JobKind>("receiving.dashKind", "all", AWAY);
  // the days go by the press schedule or the due date (Nov 11, Nick: "we have nothing on the schedule right now")
  const [by, setBy] = useSticky<"schedule" | "due">("receiving.dashBy", "schedule", AWAY);
  const [truckDay, setTruckDay] = useSticky<"today" | "tomorrow">("receiving.truckDay", "today", AWAY);
  const [q, setQ] = useState("");
  // click a column to sort by it, again to reverse (Nov 11, Nick)
  const [sortBy, setSortBy] = useState<{ k: "number" | "customer" | "due" | "supplier" | "pcs" | "status"; dir: 1 | -1 } | null>(null);
  const [count, setCount] = useState<CheckJob | null>(null);
  const [wo, setWo] = useState<CheckJob | null>(null);
  const [msg, setMsg] = useState("");
  // old Printavo jobs (pv:) have no work order of ours
  const woBtn = (j: CheckJob) => j.ref.startsWith("pv:") ? null : <button type="button" className="btn sm rvd-wo" onClick={() => setWo(j)} title="Open this job's work order to print"><PrinterIcon />Work order</button>;
  const today = ymd(new Date()), d1 = nextWork(today), d2 = nextWork(d1);

  // this week and next (a Friday's "next day" is Monday)
  const load = useCallback(async () => {
    setErr("");
    const nextWeek = ymd(new Date(Date.now() + 7 * 86400000));
    const rs = await Promise.all([fetch("/api/goods/checkin?open=1", { cache: "no-store" }), fetch(`/api/goods/checkin?week=${nextWeek}`, { cache: "no-store" })].map((p) => p.then((r) => r.json()).catch(() => ({ error: "Couldn't reach the server." }))));
    if (rs[0].error) { setErr(rs[0].error); return; }
    const m = new Map<string, CheckJob>();
    for (const r of rs) for (const j of [...((r.jobs || []) as CheckJob[]), ...((r.problems || []) as CheckJob[])]) if (!m.has(j.ref)) m.set(j.ref, j);
    const list = [...m.values()], ids = list.map((j) => j.ref).filter((x) => !x.startsWith("pv:"));
    const pvIds = list.map((j) => j.ref).filter((x) => x.startsWith("pv:")).map((x) => x.slice(3));
    const on = new Set<string>(), sched = new Map<string, string>();
    const take = (ref: string, x: { status: string; day: string }) => {
      if (x.status === "running" || x.status === "done") on.add(ref);
      if (x.status !== "done" && (!sched.has(ref) || x.day < sched.get(ref)!)) sched.set(ref, x.day);
    };
    const sb = createClient();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("production_slots").select("order_id, status, day").in("order_id", ids.slice(i, i + 200));
      for (const x of (data || []) as { order_id: string; status: string; day: string }[]) take(x.order_id, x);
    }
    for (let i = 0; i < pvIds.length; i += 200) {
      const { data } = await sb.from("production_slots").select("archived_order_id, status, day").in("archived_order_id", pvIds.slice(i, i + 200));
      for (const x of (data || []) as { archived_order_id: string; status: string; day: string }[]) take("pv:" + x.archived_order_id, x);
    }
    setStarted(on); setOnSched(sched); setJobs(list);
  }, []);
  useEffect(() => { load(); }, [load]);

  // each job sits on the day it runs on the press (the Check-In's own day); a goods problem stays on Today
  // not on the schedule yet: Later (Nov 11, Nick)
  const dayOf = (j: CheckJob): Day => {
    const d = by === "due" ? j.due : onSched.get(j.ref) || null;
    return j.state === "issue" || (d && d <= today) ? "today" : !d ? "later" : d === d1 ? "tomorrow" : d === d2 ? "next" : "later";
  };
  const all = useMemo(() => (jobs || []).filter((j) => !started.has(j.ref)), [jobs, started]);
  const kindN = (k: "all" | JobKind) => all.filter((j) => j.state !== "checked" && (k === "all" || j.kind === k)).length;
  const live = useMemo(() => all.filter((j) => kind === "all" || j.kind === kind), [all, kind]);
  const open = useMemo(() => live.filter((j) => j.state !== "checked"), [live]);
  const counted = useMemo(() => live.filter((j) => j.state === "checked"), [live]);
  const n = (d: Day) => (d === "counted" ? counted.length : open.filter((j) => dayOf(j) === d).length);
  const pcsOf = (j: CheckJob) => j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
  const supOf = (j: CheckJob) => (j.suppliers.length ? j.suppliers.join(" / ") : "");
  const sort = (a: CheckJob, b: CheckJob) => {
    if (sortBy) {
      const k = sortBy.k, d = sortBy.dir;
      const c = k === "number" ? a.number - b.number : k === "customer" ? a.customer.localeCompare(b.customer, undefined, { sensitivity: "base" }) : k === "due" ? (a.due || "9999").localeCompare(b.due || "9999")
        : k === "supplier" ? (supOf(a) || "~").localeCompare(supOf(b) || "~") : k === "pcs" ? pcsOf(a) - pcsOf(b) : RANK[a.state] - RANK[b.state];
      if (c) return c * d;
    }
    return RANK[a.state] - RANK[b.state] || (a.due || "9999").localeCompare(b.due || "9999") || a.number - b.number;
  };
  // the day's jobs to count, then that day's counted ones grayed (waiting for the press); Counted: every counted job
  const { shown, grayed } = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, "");
    const hit = (j: CheckJob) => `${j.number} ${j.customer} ${j.nickname} ${j.po}`.toLowerCase().includes(s);
    if (s) return { shown: open.filter(hit).sort(sort), grayed: counted.filter(hit).sort(sort) };
    if (day === "counted") return { shown: [] as CheckJob[], grayed: counted.slice().sort((a, b) => (a.day || "").localeCompare(b.day || "") || a.number - b.number) };
    return { shown: open.filter((j) => dayOf(j) === day).sort(sort), grayed: counted.filter((j) => dayOf(j) === day).sort(sort) };
  }, [open, counted, q, day, by, sortBy, onSched]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const DAYS: [Day, string][] = [["today", "Today"], ["tomorrow", "Tomorrow"], ["next", "Next day"], ["later", "Later"]];
  const KINDS: ["all" | JobKind, string][] = [["all", "All"], ["sp", "SP"], ["emb", "EMB"], ["hp", "HP"]];
  return (
    <div className="rvd">
      <div className="rvd-blk">
        <div className="rvd-bh dark"><b>Counting</b><span>Jobs to count in</span>
          <div className="rvd-by" role="group" aria-label="Days by">{([["schedule", "Schedule"], ["due", "Due date"]] as const).map(([k, l]) => <button key={k} type="button" className={by === k ? "on" : ""} onClick={() => setBy(k)}>{l}</button>)}</div>
        </div>
        <div className="rvd-main">
        <section className="panel">
          <div className="rvd-top">
            <div className="rvd-kind" role="tablist">{KINDS.map(([k, l]) => <button key={k} type="button" title={k === "sp" ? "Screen print" : k === "emb" ? "Embroidery" : k === "hp" ? "Heat press" : "Everything"} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}<span className="rvd-n">{jobs ? kindN(k) : "…"}</span></button>)}</div>
            <input className="rvd-q" placeholder="Find an order or filter: All My Sons, 40478…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="rvd-dayrow">
            <div className="rvd-days" role="tablist">
              {DAYS.map(([k, l]) => <button key={k} type="button" className={!q.trim() && day === k ? "on" : ""} onClick={() => { setDay(k); setQ(""); }}>{l}<span className="rvd-n">{jobs ? n(k) : "…"}</span></button>)}
            </div>
            <button type="button" className={"rvd-cnt" + (!q.trim() && day === "counted" ? " on" : "")} onClick={() => { setDay("counted"); setQ(""); }}>✓ Counted<span className="rvd-n">{jobs ? n("counted") : "…"}</span></button>
          </div>
          {msg && <div className="banner" style={{ margin: "8px 12px 0" }}>{msg}</div>}
          {err ? <div className="empty">{err}</div> : !jobs ? <div className="empty">Loading…</div> : !shown.length && !grayed.length ? <div className="empty">{q.trim() ? "No order matches." : day === "counted" ? "Nothing counted is waiting for the press." : day === "today" ? "Nothing to count in today." : "Nothing to count in that day."}</div> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr>{([["number", "Order #"], ["customer", "Customer"], ["due", "Due date"], ["supplier", "Supplier"], ["pcs", "Pieces"], ["status", "Status"]] as const).map(([k, l]) => (
                <th key={k} className={"rvd-th" + (sortBy?.k === k ? " on" : "")} onClick={() => setSortBy((x) => (x?.k === k ? (x.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 }))} title="Sort by this">{l}<span className="rvd-ar" aria-hidden>{sortBy?.k === k ? (sortBy.dir === 1 ? "▲" : "▼") : "↕"}</span></th>
              ))}<th /></tr></thead>
              <tbody>{shown.map((j) => {
                const st = STATE[j.state], pcs = j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);
                return (
                  <tr key={j.ref} className={day === "today" && !q.trim() && j.state !== "way" && j.state !== "none" ? "rvd-urg" : ""}>
                    <td className="nw"><Link className="ordno" href={j.ref.startsWith("pv:") ? `/shop/archive/${j.ref.slice(3)}` : `/shop/orders/${j.ref}`}>#{j.number}</Link></td>
                    <td><b data-notranslate>{j.customer}</b>{j.nickname ? <div className="sub" data-notranslate>{j.nickname}</div> : null}</td>
                    <td className="rvd-from">{j.due ? short(j.due) : "—"}</td>
                    <td><span className="rvd-from">{supOf(j) || "No manifest"}</span>{j.lines ? <div className="sub">{`${j.arrived} of ${j.shipped} delivered${j.boxes ? ` · ${j.boxes} box${j.boxes === 1 ? "" : "es"}` : ""}`}</div> : null}</td>
                    <td className="rvd-pcs">{j.shipped && j.lines ? <span className="rvd-bar2"><i style={{ width: `${Math.min(100, Math.round((j.arrived / Math.max(1, j.shipped)) * 100))}%` }} /></span> : null}<b>{pcs}</b> <span className="sub">pcs</span></td>
                    <td><span className={"rvd-pill " + st.tone}>{st.label}</span></td>
                    <td className="rvd-act">{woBtn(j)}<button type="button" className={"btn sm" + (j.state === "ready" || j.state === "partial" || j.state === "none" ? " primary" : "")} onClick={() => setCount(j)}>{j.state === "issue" ? "Recount" : "Count in"}</button></td>
                  </tr>
                );
              })}
              {grayed.length > 0 && day !== "counted" && <tr className="rvd-sub"><td colSpan={7}>Counted · waiting for the press to start <span className="rvd-n">{grayed.length}</span></td></tr>}
              {grayed.map((j) => { const pcs = j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0), last = j.checkins[0]; return (
                <tr key={j.ref} className="rvd-done">
                  <td className="nw"><Link className="ordno" href={j.ref.startsWith("pv:") ? `/shop/archive/${j.ref.slice(3)}` : `/shop/orders/${j.ref}`}>#{j.number}</Link></td>
                  <td><b data-notranslate>{j.customer}</b>{j.nickname ? <div className="sub" data-notranslate>{j.nickname}</div> : null}</td>
                  <td className="rvd-from">{j.due ? short(j.due) : "—"}</td>
                  <td><span className="rvd-from">{supOf(j) || "No manifest"}</span></td>
                  <td className="rvd-pcs"><b>{pcs}</b> <span className="sub">pcs</span></td>
                  <td><span className="rvd-pill ok">✓ Counted{last ? ` · ${new Date(last.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span></td>
                  <td className="rvd-act">{woBtn(j)}<button type="button" className="btn sm ghost" onClick={() => setCount(j)}>Recount</button></td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </section>
        <div className="rvd-iss"><GoodsIssues href={(i) => (i.order_id ? `/shop/orders/${i.order_id}` : `/shop/archive/${i.archived_order_id}`)} /></div>
        </div>
      </div>
      <aside className="rvd-blk rvd-rcv">
        <div className="rvd-bh teal"><b>Receiving</b><span>Trucks and tracking</span></div>
        <div className="rvd-side">
        <section className="panel rvd-trk">
          <div className="panel-h"><h2>Trucks</h2><div className="chips">{(["today", "tomorrow"] as const).map((k) => <button key={k} type="button" className={"chip" + (truckDay === k ? " on" : "")} onClick={() => setTruckDay(k)}>{k === "today" ? "Today" : "Tomorrow"}</button>)}</div></div>
        </section>
        {truck("ss", "S&S", "ss")}
        {truck("sanmar", "SanMar", "sm")}
        </div>
      </aside>
      {wo && <WorkOrderView orderId={wo.ref} number={wo.number} title={[wo.customer, wo.nickname].filter(Boolean).join(" · ")} onClose={() => setWo(null)} />}
      {count && <CheckinModal job={count} onClose={() => setCount(null)} onSaved={(c) => { setCount(null); setMsg(c.status === "issue" ? `#${count.number} checked in with ${c.lines.filter((l) => l.issue).length} problem(s): it's under the issues until resolved.` : `#${count.number} checked in: all ${c.received} here.`); load(); }} />}
    </div>
  );
}
