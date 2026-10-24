"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reorderRequest } from "@/app/portal/request-actions";
import { reorderArchived } from "@/app/portal/assist-actions";
import { starMyOrder } from "@/app/portal/actions";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { JobKind, JobStage, PortalJob } from "@/lib/portalJobs";

/** Order again: a new order with the same garments, sizes and logos (a past Printavo job becomes a reorder request). */
export function DashReorder({ id, archived, canAct }: { id: string; archived?: boolean; canAct: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (msg) return <span className="pdx-done">{msg}</span>;
  return (
    <button type="button" className="btn sm" disabled={!canAct || pending} title={canAct ? "Start a new order with the same garments, sizes and logos" : "Turned off in preview"}
      onClick={() => start(async () => {
        if (archived) { const r = await reorderArchived(id); setMsg(r.ok ? "Sent! We'll quote it and message you." : r.error || "Couldn't send it."); return; }
        const r = await reorderRequest(id);
        if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else setMsg(r.error || "Couldn't start the reorder.");
      })}>{pending ? "Starting…" : "Reorder"}</button>
  );
}

/**
 * Your jobs (Oct 15, Nick: "it should be dynamic… if they're waiting to approve a proof, it should say click here to
 * approve proof… if it ships, it should have tracking… flesh out the little symbols… it needs to be useful to the
 * client"). One row per job: what it is, where it is (six labeled steps with real icons), and the one thing they can
 * do next. Jobs that need them come first. Filters: Needs you / In progress / Ready / On the way, and Screen printing /
 * Embroidery / DTF when they have more than one kind.
 */
const KIND_TABS: { k: string; label: string; test: (k: JobKind) => boolean }[] = [
  { k: "all", label: "All kinds", test: () => true },
  { k: "screen", label: "Screen printing", test: (k) => k === "screen" || k === "mixed" },
  { k: "embroidery", label: "Embroidery", test: (k) => k === "embroidery" || k === "mixed" },
  { k: "dtf", label: "DTF", test: (k) => k === "dtf" || k === "mixed" },
];
const STAGE_TABS: { k: string; label: string; test: (s: JobStage) => boolean }[] = [
  { k: "need", label: "Needs you", test: (s) => s === "need" },
  { k: "all", label: "All", test: () => true },
  { k: "work", label: "In progress", test: (s) => s === "work" },
  { k: "ready", label: "Ready", test: (s) => s === "ready" },
  { k: "out", label: "On the way", test: (s) => s === "out" },
];
const ORDER: Record<JobStage, number> = { need: 0, out: 1, ready: 2, work: 3, done: 4 };

const PATHS: Record<string, string> = {
  check: "M5 12l4 4 10-10",
  placed: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  art: "M4 20l4-1 11-11-3-3L5 16zM14 7l3 3",
  goods: "M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z",
  print: "M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z",
  ready: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  ship: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
  pickup: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  out: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
};
export function StepIcon({ k, done }: { k: string; done: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden><path d={PATHS[done ? "check" : k] || PATHS.out} /></svg>;
}

function JobSteps({ j }: { j: PortalJob }) {
  const curI = j.steps.findIndex((s) => s.state === "cur");
  const doneN = j.steps.filter((s) => s.state === "done").length;
  const fill = j.done ? 100 : ((curI >= 0 ? curI : doneN) / (j.steps.length - 1)) * 100;
  return (
    <span className="pjs" style={{ ["--fill" as string]: String(Math.round(fill)) }} aria-label={j.steps.map((s) => `${s.label}${s.state === "done" ? " done" : s.state === "cur" ? " (now)" : ""}`).join(", ")}>
      {j.steps.map((s) => <span key={s.key} className={"pjs-st " + s.state} title={s.sub ? `${s.label}: ${s.sub}` : s.label}><i><StepIcon k={s.key} done={s.state === "done"} /></i><b>{s.label}</b></span>)}
    </span>
  );
}

/** ☆ / ★: track this order on the dashboard (Oct 24, Nick) */
export function StarOrder({ id, on, canAct, label = false }: { id: string; on: boolean; canAct: boolean; label?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(on);
  const [pending, start] = useTransition();
  return (
    <button type="button" className={"ostar" + (v ? " on" : "") + (label ? " lbl" : "")} disabled={!canAct || pending} aria-pressed={v}
      title={!canAct ? "Turned off in preview" : v ? "Tracking this order. Click to stop tracking it." : "Track this order on your dashboard"}
      onClick={() => { const n = !v; setV(n); start(async () => { const r = await starMyOrder(id, n); if (!r.ok) setV(!n); else router.refresh(); }); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={v ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" /></svg>
      {label && <span>{v ? "Tracking" : "Track this order"}</span>}
    </button>
  );
}

function JobRow({ j, canAct }: { j: PortalJob; canAct: boolean }) {
  const a = j.action;
  return (
    <div className={"pjr" + (j.stage === "need" ? " need" : "")}>
      <span className="pjr-picw"><Link href={j.href} className="pjr-pic">{j.pic ? <img src={j.pic} alt="" loading="lazy" /> : <span>#{j.number}</span>}</Link><StarOrder id={j.id} on={!!j.starred} canAct={canAct} /></span>
      <Link href={j.href} className="pjr-t"><small>#{j.number}</small><b>{j.nickname}</b><em>{j.summary}</em></Link>
      <div className="pjr-mid">
        <JobSteps j={j} />
        {(j.nowK || j.nowT) && <div className="pjr-now"><b>{j.nowK}</b> {j.nowT}</div>}
      </div>
      <div className="pjr-act">
        {a && (a.external
          ? <a className={"btn pjr-btn " + a.tone} href={a.href} target="_blank" rel="noreferrer">{a.label}</a>
          : <Link className={"btn pjr-btn " + a.tone} href={a.href}>{a.label}</Link>)}
        {a?.sub && <span className="pjr-sub">{a.sub}</span>}
        {j.owe && (j.owe.external ? <a className="pjr-owe" href={j.owe.href} target="_blank" rel="noreferrer">{j.owe.text} · Pay</a> : <Link className="pjr-owe" href={j.owe.href}>{j.owe.text} · Pay</Link>)}
        {j.newMsgs > 0 && j.lastMsg && <Link className="pjr-msg" href={j.lastMsg.href}>💬 {j.newMsgs} new message{j.newMsgs === 1 ? "" : "s"} · Read</Link>}
      </div>
    </div>
  );
}

export function DashJobs({ jobs, pastJobs, canAct, ordersHref }: { jobs: PortalJob[]; pastJobs: PortalJob[]; canAct: boolean; ordersHref: string }) {
  const [tab, setTab] = useSticky("portal.jobsKind", "all");
  const [stg, setStg] = useSticky("portal.jobsStage", "all");
  const [more, setMore] = useState(0);
  const sorted = [...jobs].sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || (a.inHandsIso || "9999").localeCompare(b.inHandsIso || "9999") || b.number - a.number);
  const kinds = KIND_TABS.filter((t) => t.k === "all" || jobs.some((j) => t.test(j.kind)));
  const showKinds = kinds.length > 2;
  const curK = showKinds && kinds.some((t) => t.k === tab) ? tab : "all";
  const byKind = sorted.filter((j) => KIND_TABS.find((t) => t.k === curK)!.test(j.kind));
  const stages = STAGE_TABS.filter((t) => t.k === "all" || byKind.some((j) => t.test(j.stage)));
  const showStages = jobs.length > 3 && stages.length > 2;
  const curS = showStages && stages.some((t) => t.k === stg) ? stg : "all";
  const list = byKind.filter((j) => STAGE_TABS.find((t) => t.k === curS)!.test(j.stage));
  // five on the dashboard (Oct 24, Nick: "cap it at 5 and then say view all orders… we don't want that list to go down and
  // be like 50 things long")
  const shown = list.slice(0, 5 + more * 10);
  return (
    <section className="pdx-card">
      <div className="pdx-h"><h2>Your jobs{jobs.length ? <span className="pdx-count">{jobs.length} in progress</span> : null}</h2><Link href={ordersHref} className="pd-link">All orders</Link></div>
      {(showStages || showKinds) && (
        <div className="pjf">
          {showStages && <div className="pdx-ktabs" role="tablist" aria-label="Where the job is">
            {stages.map((t) => { const n = byKind.filter((j) => t.test(j.stage)).length; return (
              <button key={t.k} type="button" role="tab" aria-selected={curS === t.k} className={(curS === t.k ? "on" : "") + (t.k === "need" ? " need" : "")} onClick={() => { setStg(t.k); setMore(0); }}>{t.label}<span>{n}</span></button>
            ); })}
          </div>}
          {showKinds && <div className="pdx-ktabs" role="tablist" aria-label="Kind of job">
            {kinds.map((t) => { const n = t.k === "all" ? jobs.length : jobs.filter((j) => t.test(j.kind)).length; return (
              <button key={t.k} type="button" role="tab" aria-selected={curK === t.k} className={curK === t.k ? "on" : ""} onClick={() => { setTab(t.k); setMore(0); }}>{t.label}<span>{n}</span></button>
            ); })}
          </div>}
        </div>
      )}
      {!jobs.length && !pastJobs.length && <div className="pdx-none">No jobs in progress right now. Start an order, or reorder one below.</div>}
      {jobs.length > 0 && !list.length && <div className="pdx-none">Nothing here right now.</div>}
      <div className="pjr-list">
        {shown.map((j) => <JobRow key={j.id} j={j} canAct={canAct} />)}
        {list.length > 5 && <div className="pdx-more-row">
          {list.length > shown.length && <button type="button" className="pdx-more" onClick={() => setMore((m) => m + 1)}>Show the next {Math.min(10, list.length - shown.length)}</button>}
          <Link href={ordersHref} className="pdx-more">View all orders ({list.length})</Link>
        </div>}
      </div>
      {pastJobs.map((j) => <BigJob key={j.id} j={j} canAct={canAct} />)}
    </section>
  );
}

function BigJob({ j, canAct }: { j: PortalJob; canAct: boolean }) {
  const [dk, dv] = j.dueLabel.split("|");
  const doneCount = j.steps.filter((s) => s.state === "done").length, curI = j.steps.findIndex((s) => s.state === "cur");
  const fill = j.done ? 100 : ((curI >= 0 ? curI : doneCount) / (j.steps.length - 1)) * 100;
  return (
    <div className={"pdx-job" + (j.done ? " quiet" : "")}>
      <Link href={j.href} className="pdx-pic">{j.pic ? <img src={j.pic} alt="" /> : <span className="pdx-nopic">#{j.number}</span>}{dk && <span className={"pdx-due" + (j.done ? " done" : "")}>{dk}<b>{dv}</b></span>}</Link>
      <div className="pdx-jb">
        <div className="pdx-jt"><span className="n">#{j.number}</span><Link href={j.href} className="t">{j.nickname}</Link><span className={"pdx-pill " + j.badge.tone}>{j.badge.text}</span></div>
        <div className="pdx-js">{j.summary}</div>
        <div className={"pdx-tl" + (j.done ? " small" : "")} style={{ ["--fill" as string]: String(Math.round(fill)) }}>
          {j.steps.map((s) => (
            <div key={s.key} className={"pdx-st " + s.state}>
              <i aria-hidden><StepIcon k={s.key} done={s.state === "done"} /></i>
              {!j.done && <><b>{s.label}</b><small>{s.sub}</small></>}
            </div>
          ))}
        </div>
        {!j.done && <div className="pdx-now"><b>Now:</b> {j.now} <b>Next:</b> {j.next}{j.reviewHref && j.steps.find((s) => s.key === "art")?.state === "cur" && <> <Link href={j.reviewHref} className="pdx-go">Review art ›</Link></>}</div>}
        {j.lastMsg && <Link href={j.lastMsg.href} className="pdx-jmsg">💬 {j.newMsgs ? <b>{j.newMsgs} new message{j.newMsgs === 1 ? "" : "s"}</b> : <b>Last message</b>} from {j.lastMsg.from}: “{j.lastMsg.text}” <span>Read</span></Link>}
      </div>
      {j.done && <div className="pdx-jr"><DashReorder id={j.id} canAct={canAct} /></div>}
    </div>
  );
}
