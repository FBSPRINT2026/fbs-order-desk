"use client";
import { useMemo, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { markWorkOrdersPrinted } from "./actions";

export type WoJob = { id: string; number: number; name: string; customer: string; qty: number; day: string; press: string; lead: string; start: number | null; done: boolean; printed: string | null };
const clock = (m: number | null) => (m == null ? "" : `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")}${m < 720 ? "a" : "p"}`);
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const at = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M/, (_, x) => x.toLowerCase());

export default function WorkOrders({ jobs, today }: { jobs: WoJob[]; today: string }) {
  const days = [...new Set(jobs.map((j) => j.day))].sort();
  const [tab, setTab] = useSticky<string>("wo.tab", "first");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [printed, setPrinted] = useState<Record<string, string>>({});
  const isPrinted = (j: WoJob) => printed[j.id] || j.printed;
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const label = (d: string, _i: number) => (d === today ? "Today" : d === tomorrow ? "Tomorrow" : dayName(d));
  const cur = tab === "open" ? "open" : days.includes(tab) ? tab : days[0] || "open";
  const w = q.trim().toLowerCase();
  const list = useMemo(() => jobs.filter((j) => (cur === "open" ? !isPrinted(j) && !j.done : j.day === cur))
    .filter((j) => !w || `${j.number} ${j.customer} ${j.name} ${j.press} ${j.lead}`.toLowerCase().includes(w))
    .sort((a, b) => a.day.localeCompare(b.day) || a.press.localeCompare(b.press) || (a.start ?? 9999) - (b.start ?? 9999)), [jobs, cur, w, printed]); // eslint-disable-line react-hooks/exhaustive-deps
  const uniq = (js: WoJob[]) => [...new Set(js.map((j) => j.id))];
  async function print(js: WoJob[]) {
    const ids = uniq(js).slice(0, 60);
    if (!ids.length) return;
    window.open(`/print/work?ids=${ids.join(",")}`, "_blank", "noopener");
    const now = new Date().toISOString();
    setPrinted((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, now])) }));
    setPick(new Set());
    await markWorkOrdersPrinted(ids).catch(() => null);
  }
  const notYet = list.filter((j) => !isPrinted(j));
  const picked = list.filter((j) => pick.has(j.id));
  return (
    <>
      <div className="page-head"><div><h1>Work Orders</h1><div className="eyebrow">The jobs on the schedule by the day they run: tick and print them together</div></div></div>
      <div className="toolbar" data-toolbar>
        <div className="chips">
          {days.slice(0, 5).map((d, i) => <button key={d} type="button" className={"chip" + (cur === d ? " on" : "")} onClick={() => setTab(d)}>{label(d, i)}<span className="chip-n">{uniq(jobs.filter((j) => j.day === d)).length}</span></button>)}
          <button type="button" className={"chip" + (cur === "open" ? " on" : "")} onClick={() => setTab("open")}>Not printed yet<span className="chip-n">{uniq(jobs.filter((j) => !isPrinted(j) && !j.done)).length}</span></button>
        </div>
        <input type="search" className="input" placeholder="Search a job, customer or press" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="wo-acts">
        <button type="button" className="btn primary" disabled={!list.length} onClick={() => print(list)}>Print all {uniq(list).length}{cur === "open" ? "" : ` for ${label(cur, days.indexOf(cur)).toLowerCase() === "today" ? "today" : label(cur, days.indexOf(cur))}`}</button>
        {notYet.length > 0 && notYet.length < list.length && <button type="button" className="btn" onClick={() => print(notYet)}>Print the {uniq(notYet).length} not printed</button>}
        <button type="button" className="btn" disabled={!picked.length} onClick={() => print(picked)}>Print the {picked.length} picked</button>
        {list.length > 0 && <button type="button" className="linkbtn" onClick={() => setPick(pick.size === list.length ? new Set() : new Set(list.map((j) => j.id)))}>{pick.size === list.length ? "Untick all" : "Tick all"}</button>}
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th></th><th>Job</th><th>Press</th><th>Runs</th><th>Pieces</th><th>Work order</th></tr></thead>
        <tbody>
          {list.map((j) => (
            <tr key={j.id + j.day} className={pick.has(j.id) ? "wo-on" : ""} onClick={() => setPick((p) => { const n = new Set(p); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })} style={{ cursor: "pointer" }}>
              <td><input type="checkbox" checked={pick.has(j.id)} readOnly aria-label={`Pick #${j.number}`} /></td>
              <td><span className="ordno">#{j.number}</span> <b data-notranslate>{j.customer}</b>{j.name ? <div className="sub" data-notranslate>{j.name}</div> : null}</td>
              <td>{j.press}{j.lead ? <div className="sub">{j.lead}</div> : null}</td>
              <td style={{ whiteSpace: "nowrap" }}>{dayName(j.day)}{j.start != null ? ` · ${clock(j.start)}` : ""}{j.done ? <div className="sub">Done</div> : null}</td>
              <td>{j.qty.toLocaleString()}</td>
              <td style={{ whiteSpace: "nowrap" }}>{isPrinted(j) ? <span className="wo-ok">Printed {at(isPrinted(j)!)}</span> : <span className="wo-no">Not printed</span>} <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); void print([j]); }}>Print</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} className="faint">{cur === "open" ? "Every scheduled job's work order is printed." : "Nothing on the schedule this day."}</td></tr>}
        </tbody>
      </table></div>
      <p className="faint" style={{ fontSize: 12.5 }}>A job that isn&apos;t on the schedule yet isn&apos;t listed: find it with the search at the top and print its work order from the job.</p>
    </>
  );
}
