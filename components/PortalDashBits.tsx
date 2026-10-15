"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reorderRequest } from "@/app/portal/request-actions";
import { reorderArchived } from "@/app/portal/assist-actions";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { JobKind, PortalJob } from "@/lib/portalJobs";

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
 * Your jobs: tabs for screen printing and embroidery when the customer has both (Oct 15, Nick: "have a tab for
 * embroidery and screen printing to make the lists shorter"). A short list shows each job as a big card with its
 * timeline; a long one shows one row per job with a small timeline.
 */
const KIND_TABS: { k: string; label: string; test: (k: JobKind) => boolean }[] = [
  { k: "all", label: "All", test: () => true },
  { k: "screen", label: "Screen printing", test: (k) => k === "screen" || k === "mixed" },
  { k: "embroidery", label: "Embroidery", test: (k) => k === "embroidery" || k === "mixed" },
  { k: "dtf", label: "DTF", test: (k) => k === "dtf" || k === "mixed" },
];
const ICON = (key: string, done: boolean) => (done ? "✓" : key === "art" ? "✎" : key === "goods" ? "👕" : key === "print" ? "🖨" : key === "ready" ? "📦" : key === "out" ? "★" : "•");

export function DashJobs({ jobs, pastJobs, canAct, ordersHref }: { jobs: PortalJob[]; pastJobs: PortalJob[]; canAct: boolean; ordersHref: string }) {
  const [tab, setTab] = useSticky("portal.jobsKind", "all");
  const [more, setMore] = useState(false);
  const tabs = KIND_TABS.filter((t) => t.k === "all" || jobs.some((j) => t.test(j.kind)));
  const showTabs = tabs.length > 2;
  const cur = showTabs && tabs.some((t) => t.k === tab) ? tab : "all";
  const list = jobs.filter((j) => KIND_TABS.find((t) => t.k === cur)!.test(j.kind));
  const compact = list.length > 3;
  const shown = compact && !more ? list.slice(0, 8) : list;
  return (
    <section className="pdx-card">
      <div className="pdx-h"><h2>Your jobs{jobs.length ? <span className="pdx-count">{jobs.length} in progress</span> : null}</h2><Link href={ordersHref} className="pd-link">All orders</Link></div>
      {showTabs && (
        <div className="pdx-ktabs" role="tablist" aria-label="Kind of job">
          {tabs.map((t) => { const n = t.k === "all" ? jobs.length : jobs.filter((j) => t.test(j.kind)).length; return (
            <button key={t.k} type="button" role="tab" aria-selected={cur === t.k} className={cur === t.k ? "on" : ""} onClick={() => { setTab(t.k); setMore(false); }}>{t.label}<span>{n}</span></button>
          ); })}
        </div>
      )}
      {!jobs.length && !pastJobs.length && <div className="pdx-none">No jobs in progress right now. Start an order, or reorder one below.</div>}
      {compact ? (
        <div className="pdx-rows">
          {shown.map((j) => {
            const [dk, dv] = j.dueLabel.split("|");
            const curStep = j.steps.find((s) => s.state === "cur");
            return (
              <Link href={j.href} className="pdx-row" key={j.id}>
                <span className="pdx-rpic">{j.pic ? <img src={j.pic} alt="" /> : <span>#{j.number}</span>}</span>
                <span className="pdx-rt"><small>#{j.number}</small><b>{j.nickname}</b><em>{j.summary}</em></span>
                <span className="pdx-rtl" aria-label={curStep ? `Now: ${curStep.label}` : "Done"}>
                  {j.steps.map((s) => <i key={s.key} className={s.state} title={s.label}>{ICON(s.key, s.state === "done")}</i>)}
                  <small>{curStep?.label || "Done"}</small>
                </span>
                <span className="pdx-rdue">{dk ? <><small>{dk}</small><b>{dv}</b></> : null}</span>
                {j.reviewHref && j.steps.find((s) => s.key === "art")?.state === "cur" ? <span className="pdx-pill wait">Review art</span> : j.newMsgs ? <span className="pdx-pill info">💬 {j.newMsgs} new</span> : <span className={"pdx-pill " + j.badge.tone}>{j.badge.text}</span>}
              </Link>
            );
          })}
          {list.length > shown.length && <button type="button" className="pdx-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
        </div>
      ) : list.map((j) => <BigJob key={j.id} j={j} canAct={canAct} />)}
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
              <i aria-hidden>{ICON(s.key, s.state === "done")}</i>
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
