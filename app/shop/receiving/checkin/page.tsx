"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CheckinModal, { ISSUE_WORD } from "@/components/CheckinModal";
import type { CheckJob, CheckinRow, JobState } from "@/lib/checkinShared";
import { useSticky } from "@/lib/useSticky";

/**
 * Check-In (Goods & Receiving): the week's jobs and their goods, so receiving can count each job in.
 *   Ready to count: the supplier manifest says everything shipped and every package has been delivered.
 *   Problems: check-ins that didn't match (short, damaged, wrong item, extra) until someone resolves them.
 * Click a job to count it in (components/CheckinModal.tsx).
 */
const STATE: Record<JobState, { label: string; c: string; hint: string }> = {
  ready: { label: "Ready to count", c: "#1E9E5A", hint: "Every package on the manifest has been delivered" },
  issue: { label: "Problem", c: "#C2352B", hint: "Counted in with a problem that isn't resolved yet" },
  partial: { label: "Partly here", c: "#C98A0C", hint: "Some of the packages have been delivered" },
  way: { label: "On the way", c: "#2F7FD0", hint: "Shipped (on a manifest), not delivered yet" },
  none: { label: "No tracking", c: "#7C8799", hint: "No supplier manifest for this job: count from the job's items when it shows up" },
  checked: { label: "Checked in", c: "#0A8FC0", hint: "Counted in, everything matched (or the problem was resolved)" },
};
const ORDER: JobState[] = ["ready", "issue", "partial", "way", "none", "checked"];
const dayName = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const short = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const when = (t: string) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const QUICK = ["Customer notified", "Customer sending more", "Reordered from the supplier", "Used extras", "Printing short, customer OK'd", "Counted again: it was all here"];

export default function CheckInPage() {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<{ from: string; to: string; today: string; jobs: CheckJob[]; problems: CheckJob[] } | null>(null);
  const [err, setErr] = useState(""), [setup, setSetup] = useState(false);
  const [filter, setFilter] = useSticky<JobState | "all">("checkin.filter", "all");
  const [q, setQ] = useState("");
  const [count, setCount] = useState<CheckJob | null>(null), [view, setView] = useState<CheckJob | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setErr("");
    const r = await fetch(`/api/goods/checkin${week ? `?week=${week}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || j.error) { setErr(j.error || "Couldn't load the week."); setSetup(!!j.setup); return; }
    setData(j);
  }, [week]);
  useEffect(() => { load(); }, [load]);

  const all = useMemo(() => {
    const m = new Map<string, CheckJob>();
    for (const j of [...(data?.jobs || []), ...(data?.problems || [])]) m.set(j.ref, j);
    return [...m.values()];
  }, [data]);
  const match = (j: CheckJob) => { const s = q.trim().toLowerCase(); return !s || [`#${j.number}`, j.customer, j.nickname, j.po].join(" ").toLowerCase().includes(s); };
  const counts = useMemo(() => Object.fromEntries(ORDER.map((k) => [k, (k === "issue" ? data?.problems || [] : data?.jobs || []).filter((j) => j.state === k).length])) as Record<JobState, number>, [data]);
  // every job stays on its own day (nothing gets counted early just because it's here); within a day the ones ready
  // to count go first. Problems have their own section up top (they can be from any day), so they aren't repeated.
  const RANK: Record<JobState, number> = { ready: 0, partial: 1, way: 2, none: 3, checked: 4, issue: 5 };
  const shown = (data?.jobs || []).filter(match).filter((j) => (filter === "all" ? j.state !== "issue" : j.state === filter))
    .sort((a, b) => a.day.localeCompare(b.day) || RANK[a.state] - RANK[b.state] || a.number - b.number);
  const problems = (data?.problems || []).filter(match);
  const days = [...new Set(shown.map((j) => j.day))].sort();
  const thisWeek = data && data.today >= data.from && data.today <= data.to;

  const row = (j: CheckJob) => {
    const s = STATE[j.state], last = j.checkins[0];
    return (
      <div key={j.ref} className={"ck-row ck-st-" + j.state}>
        <span className="pill" style={{ ["--sc" as string]: s.c }} title={s.hint}>{s.label}</span>
        <div className="ck-row-b">
          <b><Link href={j.href}>#{j.number}</Link> <span data-notranslate>{j.customer}</span></b>
          <span className="ck-row-n" data-notranslate>{j.nickname}{j.po ? ` · PO ${j.po}` : ""}</span>
          <small className="faint">{[
            `${j.ordered || j.items.reduce((s2, it) => s2 + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0)} pcs`,
            j.lines ? `${j.suppliers.join(" / ")}: ${j.arrived === j.shipped ? `all ${j.shipped} delivered` : `${j.arrived} of ${j.shipped} delivered`}${j.ordered && j.shipped < j.ordered ? ` (only ${j.shipped} of the ${j.ordered} on manifests)` : ""}${j.boxes ? ` · ${j.boxes} box${j.boxes === 1 ? "" : "es"}` : ""}` : "no manifest",
            j.start ? `prints ${short(j.start)}` : "", j.due ? `due ${short(j.due)}` : "",
          ].filter(Boolean).join(" · ")}</small>
          {last && <small className={"ck-last" + (last.status === "issue" && !last.resolved_at ? " bad" : "")}>Counted {last.received} of {last.expected} by {last.by}, {when(last.created_at)}{last.status === "issue" ? ` · ${last.lines.filter((l) => l.issue).map((l) => `${ISSUE_WORD[l.issue]} ${l.size}`).slice(0, 4).join(", ")}${last.resolved_at ? ` · resolved: ${last.resolution || "yes"}` : ""}` : ""}</small>}
        </div>
        <div className="ck-row-a">
          {j.checkins.length > 0 && <button type="button" className="btn sm ghost" onClick={() => setView(j)}>{j.state === "issue" ? "Resolve" : "View"}</button>}
          {j.items.length
            ? <button type="button" className={"btn sm" + (j.state === "ready" ? " primary" : "")} onClick={() => setCount(j)}>{j.checkins.length ? "Count Again" : "Check In"}</button>
            : <span className="faint" title="The job has no sizes to count">No items</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow"><Link href="/shop/receiving">Goods &amp; Receiving</Link></div><h1>Check-In</h1></div>
        <div className="row ck-week" style={{ gap: 6, alignItems: "center" }}>
          <button type="button" className="btn icon" aria-label="Previous week" onClick={() => setWeek(addDays(data?.from || new Date().toISOString().slice(0, 10), -7))}>‹</button>
          <span className="ck-week-l">{data ? <>{thisWeek ? "This week" : "Week of"} <b>{short(data.from)} – {short(data.to)}</b></> : "…"}</span>
          <button type="button" className="btn icon" aria-label="Next week" onClick={() => setWeek(addDays(data?.from || new Date().toISOString().slice(0, 10), 7))}>›</button>
          {!thisWeek && data && <button type="button" className="btn sm" onClick={() => setWeek(null)}>This Week</button>}
        </div>
      </div>
      {msg && <div className="ms-toast" role="status"><span>{msg}</span><button type="button" aria-label="Dismiss" onClick={() => setMsg("")}>×</button></div>}
      {err && <div className="pv-err">{err}{setup ? " Ask whoever manages the database to run it (Supabase → SQL editor)." : ""}</div>}

      <div className="ck-chips">
        <button type="button" className={"ck-chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>All jobs<b>{data?.jobs.length ?? "…"}</b></button>
        {ORDER.map((k) => <button key={k} type="button" className={"ck-chip" + (filter === k ? " on" : "")} style={{ ["--sc" as string]: STATE[k].c }} title={STATE[k].hint} onClick={() => setFilter(filter === k ? "all" : k)}><i />{STATE[k].label}<b>{counts[k] ?? 0}</b></button>)}
        <span className="spacer" />
        <input type="search" className="ck-q" placeholder="Job #, customer, PO…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
      </div>

      {!data ? (!err && <div className="empty">Loading the week…</div>) : <>
        {(filter === "all" || filter === "issue") && problems.length > 0 && (
          <section className="ck-sec ck-problems">
            <h2>Problems <span className="faint">counted in short, damaged, wrong or extra: resolve each one</span></h2>
            {problems.map(row)}
          </section>
        )}
        {filter !== "issue" && (days.length ? days.map((d) => (
          <section key={d} className="ck-sec">
            <h2>{d === data.today ? "Today · " : ""}{dayName(d)} <span className="faint">{shown.filter((j) => j.day === d).length} job{shown.filter((j) => j.day === d).length === 1 ? "" : "s"}{(() => { const n = shown.filter((j) => j.day === d && j.state === "ready").length; return n ? ` · ${n} ready to count` : ""; })()}</span></h2>
            {shown.filter((j) => j.day === d).map(row)}
          </section>
        )) : <div className="empty">{q ? `Nothing matches “${q}” this week.` : filter === "all" ? "No jobs on the schedule this week." : `No jobs "${STATE[filter as JobState].label}" this week.`}</div>)}
      </>}

      {count && <CheckinModal job={count} onClose={() => setCount(null)} onSaved={(c) => { setCount(null); setMsg(c.status === "issue" ? `#${count.number} checked in with ${c.lines.filter((l) => l.issue).length} problem(s): it's under Problems until resolved.` : `#${count.number} checked in: all ${c.received} here.`); load(); }} />}
      {view && <CheckinHistory job={view} onClose={() => setView(null)} onChanged={() => { setView(null); load(); }} />}
    </>
  );
}

/** A job's check-ins: what was counted, the problems, and resolving them. */
function CheckinHistory({ job, onClose, onChanged }: { job: CheckJob; onClose: () => void; onChanged: () => void }) {
  const [res, setRes] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  async function act(c: CheckinRow, reopen = false) {
    if (!reopen && !res.trim()) { setErr("Say what was done about it."); return; }
    setBusy(c.id); setErr("");
    const r = await fetch("/api/goods/checkin", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, resolution: res, reopen }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok || j.error) { setErr(j.error || "Couldn't save."); return; }
    onChanged();
  }
  return (
    <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="ckh-t">
      <div className="ck-modal ck-hist">
        <div className="ck-head"><div><h2 id="ckh-t">#{job.number} <span className="faint" data-notranslate>{job.customer}</span></h2><div className="ck-sub" data-notranslate>{job.nickname}</div></div>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="ck-body">
          {job.checkins.map((c) => {
            const probs = c.lines.filter((l) => l.issue);
            return (
              <section key={c.id} className={"ck-item" + (c.status === "issue" && !c.resolved_at ? " open" : "")}>
                <div className="ck-item-h"><b>Counted {c.received} of {c.expected}</b><span className="faint">by {c.by}, {when(c.created_at)}{c.boxes != null ? ` · ${c.boxes} boxes` : ""}</span></div>
                {probs.length > 0 && <ul className="ck-plist">{probs.map((l, i) => <li key={i}><span className="pill" style={{ ["--sc" as string]: "#C2352B" }}>{ISSUE_WORD[l.issue]}</span> <b data-notranslate>{l.item} · {l.size === "OTHER" ? "Other" : l.size}</b>: got {l.received} of {l.expected}{l.bad ? `, ${l.bad} ${l.issue === "mispick" ? "wrong" : "damaged"}` : ""}{l.note ? ` · ${l.note}` : ""}</li>)}</ul>}
                {c.note && <p className="ck-n">{c.note}</p>}
                {c.photos?.length > 0 && <p className="faint">{c.photos.length} photo{c.photos.length === 1 ? "" : "s"} on file</p>}
                {c.status === "issue" && (c.resolved_at
                  ? <p className="ck-resolved">Resolved by {c.resolved_by}, {when(c.resolved_at)}: {c.resolution} <button type="button" className="linkbtn" disabled={!!busy} onClick={() => act(c, true)}>Reopen</button></p>
                  : <div className="ck-resolve">
                      <div className="ck-quick">{QUICK.map((x) => <button key={x} type="button" className={"ck-qc" + (res === x ? " on" : "")} onClick={() => setRes(x)}>{x}</button>)}</div>
                      <input placeholder="What was done about it?" value={res} onChange={(e) => setRes(e.target.value)} />
                      <button type="button" className="btn primary" disabled={busy === c.id} onClick={() => act(c)}>{busy === c.id ? "Saving…" : "Resolve"}</button>
                    </div>)}
              </section>
            );
          })}
        </div>
        {err && <div className="pv-err">{err}</div>}
      </div>
    </div>
  );
}
