"use client";
import { holdShort } from "@/lib/orderStages";
import OrderRail from "@/components/OrderRail";
import { useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { PageSearchContext, pageHit } from "@/components/ArtSearchContext";
import { useRouter } from "next/navigation";
import { OldReorderButton } from "@/components/PortalOldReorder";
import { starMyOrder } from "@/app/portal/actions";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { JobKind, JobStage, PortalJob, JobAction } from "@/lib/portalJobs";

/** Order again: the Reorder pop-up (sizes, art, notes; we price it and send it back), for an old-system job or one of
 *  theirs in the new system alike (Nov 2, Nick: "exact same functionality") */
export function DashReorder({ id, archived, canAct }: { id: string; archived?: boolean; canAct: boolean }) {
  return <OldReorderButton archivedId={archived ? id : `o:${id}`} disabled={!canAct} primary={false} small />;
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
// the jobs' toolbar (Nov 2, Nick: "on the right… on hold and all… on the left… in progress, ready, and completed"; All
// picked when the page opens, "Needs you" gone: what needs them is On hold, or the job's own button)
const STAGE_TABS: { k: string; label: string; side: "l" | "r"; test: (j: PortalJob) => boolean }[] = [
  { k: "work", label: "In progress", side: "l", test: (j) => j.stage === "need" || j.stage === "work" },
  { k: "ready", label: "Ready", side: "l", test: (j) => j.stage === "ready" || j.stage === "out" },
  // recently completed (Oct 24, Nick: not a big card under the jobs)
  { k: "done", label: "Completed", side: "l", test: (j) => j.stage === "done" },
  // every order on hold, each with why and what fixes it; the On hold panel at the top opens it
  { k: "hold", label: "On hold", side: "r", test: (j) => !!j.hold },
  { k: "all", label: "All", side: "r", test: () => true },
];
/** the On hold panel's links: open Your jobs on its On hold tab and scroll there */
const HOLD_EVT = "fbs:jobs-hold";
export function HoldJump({ className, children }: { className?: string; children: ReactNode }) {
  return <button type="button" className={className} onClick={() => { window.dispatchEvent(new Event(HOLD_EVT)); document.getElementById("your-jobs")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{children}</button>;
}
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

/** ☆ / ★: track this order on the dashboard (Oct 24, Nick) */
/** stop following an order: a small × in its row's corner on the dashboard (Nov 2, Nick) */
export function Unfollow({ id, canAct }: { id: string; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="pdx-fo-x" disabled={!canAct || pending} title={canAct ? "Stop following this order" : "Turned off in preview"} aria-label="Stop following this order"
      onClick={() => start(async () => { const r = await starMyOrder(id, false); if (r.ok) router.refresh(); })}>×</button>
  );
}
export function StarOrder({ id, on, canAct, label = false }: { id: string; on: boolean; canAct: boolean; label?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(on);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="ostar-w">
    <button type="button" className={"ostar" + (v ? " on" : "") + (label ? " lbl" : "")} disabled={!canAct || pending} aria-pressed={v}
      title={!canAct ? "Turned off in preview" : v ? "Following. Click to stop following it." : "Follow this order on your home page"}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); const n = !v; setV(n); setErr(""); start(async () => { const r = await starMyOrder(id, n); if (!r.ok) { setV(!n); setErr(r.error || "Couldn't save that."); setTimeout(() => setErr(""), 4500); } else router.refresh(); }); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={v ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" /></svg>
      {/* not "track" (Nov 2, Nick: "people are going to think that… means actually like get UPS tracking") */}
      {/* "Orders I'm following" (Nov 2, Nick) */}
      {label && <span>{v ? "Following" : "Follow this order"}</span>}
    </button>
    {err && <span className="ostar-err" role="status">{err}</span>}
    </span>
  );
}

function JobRow({ j, canAct, detail = false }: { j: PortalJob; canAct: boolean; /** the On hold tab: why, in full, under the row */ detail?: boolean }) {
  // on hold, the button is what fixes it (Nov 2, Nick: the stamp right above it, the row in salmon)
  // a held job's button says what to do, plainly: Reply, Pay now, Send art, Check goods (Nov 2, Nick: no "see why and reply")
  const a: JobAction | undefined = j.hold ? { label: j.hold.fixLabel, href: j.hold.href, tone: "need" } : j.action;
  return (
    <div className={"pjr" + (j.stage === "need" ? " need" : "") + (j.hold ? " held" : "")}>
      <span className="pjr-picw"><Link href={j.href} className="pjr-pic">{j.pic ? <img src={j.pic} alt="" loading="lazy" /> : <span>#{j.number}</span>}</Link><StarOrder id={j.id} on={!!j.starred} canAct={canAct} /></span>
      <Link href={j.href} className="pjr-t"><small>#{j.number}</small><b>{j.nickname}</b><em>{j.summary}</em></Link>
      <div className={"pjr-mid" + (j.hold ? " held" : "")}>
        <OrderRail steps={j.steps} done={j.done} />
        {j.hold
          ? <div className={"pjr-now hold" + (detail ? " full" : "")}><b>{holdShort(j.hold.key)}:</b> {j.hold.reason || j.hold.title}</div>
          : (j.nowK || j.nowT) && <div className="pjr-now"><b>{j.nowK}</b> {j.nowT}</div>}
      </div>
      <div className="pjr-act">
        {/* the stamp says ON HOLD; why is on the line under the order's steps; the button says what to do (Nov 2, Nick) */}
        {j.hold && <span className="hold-stamp">On hold</span>}
        {a && (a.external
          ? <a className={"btn pjr-btn " + a.tone} href={a.href} target="_blank" rel="noreferrer">{a.label}</a>
          : <Link className={"btn pjr-btn " + a.tone} href={a.href}>{a.label}</Link>)}
        {a?.sub && <span className="pjr-sub">{a.sub}</span>}
        {j.owe && (j.owe.external ? <a className="pjr-owe" href={j.owe.href} target="_blank" rel="noreferrer">{j.owe.text} · Pay</a> : <Link className="pjr-owe" href={j.owe.href}>{j.owe.text} · Pay</Link>)}
        {detail && j.hold && j.hold.fixLabel !== "Reply" && <Link className="pjr-ask" href={`${j.href}#messages`}>Ask us about it</Link>}
        {j.newMsgs > 0 && j.lastMsg && <Link className="pjr-msg" href={j.lastMsg.href}>💬 {j.newMsgs} new message{j.newMsgs === 1 ? "" : "s"} · Read</Link>}
      </div>
    </div>
  );
}

export function DashJobs({ jobs, pastJobs, canAct, ordersHref }: { jobs: PortalJob[]; pastJobs: PortalJob[]; canAct: boolean; ordersHref: string }) {
  const [tab, setTab] = useSticky("portal.jobsKind", "all");
  const [stg, setStg] = useSticky("portal.jobsStage", "all");
  const [more, setMore] = useState(0);
  useEffect(() => { const go = () => { setStg("hold"); setMore(0); }; addEventListener(HOLD_EVT, go); return () => removeEventListener(HOLD_EVT, go); }, [setStg]);
  // "Search the dashboard" at the right of the page title filters the jobs (Nov 2, Nick)
  const pq = useContext(PageSearchContext);
  const sorted = [...jobs].filter((j) => pageHit(pq, j.number, j.nickname, j.summary, j.kind)).sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || (a.inHandsIso || "9999").localeCompare(b.inHandsIso || "9999") || b.number - a.number);
  const kinds = KIND_TABS.filter((t) => t.k === "all" || jobs.some((j) => t.test(j.kind)));
  const showKinds = kinds.length > 2;
  const curK = showKinds && kinds.some((t) => t.k === tab) ? tab : "all";
  const byKind = sorted.filter((j) => KIND_TABS.find((t) => t.k === curK)!.test(j.kind));
  const doneK = pastJobs.filter((j) => pageHit(pq, j.number, j.nickname)).filter((j) => KIND_TABS.find((t) => t.k === curK)!.test(j.kind)).map((j) => ({ ...j, stage: "done" as JobStage }));
  const stages = STAGE_TABS;
  const curS = stages.some((t) => t.k === stg) ? stg : "all";
  const list = curS === "done" ? doneK : byKind.filter((j) => STAGE_TABS.find((t) => t.k === curS)!.test(j));
  // five on the dashboard (Oct 24, Nick: "cap it at 5 and then say view all orders… we don't want that list to go down and
  // be like 50 things long")
  const shown = list.slice(0, 5 + more * 10);
  return (
    <section className="pdx-card" id="your-jobs">
      <div className="pdx-h"><h2>Your jobs{jobs.length ? <span className="pdx-count">{jobs.length} in progress</span> : null}</h2><Link href={ordersHref} className="pd-link">All orders</Link></div>
      {(jobs.length > 0 || doneK.length > 0) && (
        <div className="pjf">
          {/* on a phone the three switches are two dropdowns on one line (Nov 3, Nick: "find an easier way to put these three
              menus together"): where the job is (on hold and all included), and what kind */}
          <div className="pjf-ph">
            <label className="pjf-sel"><span>Show</span><select value={curS} onChange={(e) => { setStg(e.target.value); setMore(0); }}>
              {stages.map((t) => { const n = t.k === "done" ? doneK.length : byKind.filter((j) => t.test(j)).length; return <option key={t.k} value={t.k}>{t.label}{n ? ` (${n})` : ""}</option>; })}
            </select></label>
            {showKinds && <label className="pjf-sel"><span>Kind</span><select value={curK} onChange={(e) => { setTab(e.target.value); setMore(0); }}>
              {kinds.map((t) => { const n = t.k === "all" ? jobs.length : jobs.filter((j) => t.test(j.kind)).length; return <option key={t.k} value={t.k}>{t.label}{n ? ` (${n})` : ""}</option>; })}
            </select></label>}
          </div>
          <div className="toolbar aa-otabs pdx-stabs pjt" data-toolbar>
            {(["l", "r"] as const).map((side) => (
              <div key={side} className={"chips pjt-" + side} role="tablist" aria-label={side === "l" ? "Where the job is" : "On hold or all"}>
                {stages.filter((t) => t.side === side).map((t) => { const n = t.k === "done" ? doneK.length : byKind.filter((j) => t.test(j)).length; return (
                  <button key={t.k} type="button" role="tab" aria-selected={curS === t.k} className={"chip" + (curS === t.k ? " on" : "")} onClick={() => { setStg(t.k); setMore(0); }}>
                    {t.label}{n ? <span className={"chip-n" + (t.k === "hold" ? " pjt-hn" : "")}>{n}</span> : null}
                  </button>
                ); })}
              </div>
            ))}
          </div>
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
        {shown.map((j) => <JobRow key={j.id} j={j} canAct={canAct} detail={curS === "hold"} />)}
        {list.length > 5 && <div className="pdx-more-row">
          {list.length > shown.length && <button type="button" className="pdx-more" onClick={() => setMore((m) => m + 1)}>Show the next {Math.min(10, list.length - shown.length)}</button>}
          <Link href={ordersHref} className="pdx-more">View all orders ({list.length})</Link>
        </div>}
      </div>
    </section>
  );
}

export function BigJob({ j, canAct }: { j: PortalJob; canAct: boolean }) {
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
