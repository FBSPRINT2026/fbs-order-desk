"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrewHome, CrewJob, CountJob } from "@/lib/crewHome";
import { CREW_VIEWS } from "@/lib/crewView";
import { LangToggle, useT } from "@/components/job/lang";

/**
 * The crew phone's main menu (/crew). What shows depends on the person's phone view (lib/crewView.ts): the press team
 * sees their press's jobs today in order, receiving sees what's to count in by press day and the open goods problems,
 * the office sees both. Everyone: the time clock, fixes to their own time card (a manager approves them), and opening
 * a job by its number (or scanning the QR on its work order with the phone's camera).
 */
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const clock = (iso: string | null, loc: string) => (iso ? new Date(iso).toLocaleTimeString(loc, { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");
const day = (d: string, loc: string) => new Date(d + "T12:00").toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric" });
const PUNCH: Record<string, string> = { in: "Clock in", break_start: "Start lunch / break", break_end: "Back from lunch / break", out: "Clock out" };
const FIX: Record<string, string> = { lunch: "A lunch I didn't punch", missed_in: "I forgot to clock in", missed_out: "I forgot to clock out", other: "Something else" };

export default function CrewMenu({ home }: { home: CrewHome }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const [fix, setFix] = useState<null | { day: string; kind: string; time: string; minutes: string; note: string }>(null);
  const view = CREW_VIEWS.find((v) => v.id === home.view);
  const open = (n: number | string, v = "") => { location.href = `/j/${n}${v ? `?v=${v}` : ""}`; };

  async function post(body: Record<string, unknown>) {
    setBusy(String(body.kind || body.action)); setErr(""); setMsg("");
    const r = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy("");
    if (!r?.ok) { setErr(t(j.error || "Couldn't save.")); return false; }
    router.refresh(); return true;
  }
  async function sendFix() {
    if (!fix) return;
    const at = fix.time ? new Date(`${fix.day}T${fix.time}:00`).toISOString() : null;
    if (await post({ action: "fix", day: fix.day, kind: fix.kind, at, minutes: +fix.minutes || 30, note: fix.note })) { setFix(null); setMsg(t("Sent to your manager to approve.")); }
  }

  const c = home.clock;
  return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="jm-top-who">{home.name}</span><LangToggle /></header>
      <section className="jm-job">
        <div className="cr-hi">{t("Hi, {0}", home.name.split(" ")[0])}</div>
        <div className="jm-facts"><span>{t(view?.label || "Office")}</span><span>{day(home.today, locale)}</span></div>
      </section>
      <main className="jm-main">
        {err && <div className="jm-err" role="alert">{err}</div>}
        {msg && <div className="jm-ok" role="status">{msg}</div>}

        {/* open a job: the camera scans the work order's QR; or type its number */}
        <form className="cr-open" onSubmit={(e) => { e.preventDefault(); const m = num.match(/\d{3,7}/); if (m) open(m[0]); }}>
          <input inputMode="numeric" placeholder={t("Job # (or scan the QR on the work order)")} value={num} onChange={(e) => setNum(e.target.value)} aria-label={t("Job #")} />
          <button type="submit" className="jm-go" disabled={!/\d{3,7}/.test(num)}>{t("Open")}</button>
        </form>

        {/* the press team: their press today, in order */}
        {home.presses.map((p) => <PressDay key={p.id} name={p.name} jobs={p.jobs} view={home.view} open={open} />)}
        {["press", "assist", "catcher"].includes(home.view) && !home.presses.length && <div className="jm-card"><b>{t("No press set for you")}</b><p className="jm-faint">{t("You're not on a press crew yet. The office sets crews in Production settings.")}</p></div>}

        {/* receiving: what's to count in, by the day it runs */}
        {home.counting && <Counting jobs={home.counting} open={open} />}
        {home.issues.length > 0 && (
          <div className="jm-card">
            <div className="jm-cardh"><b>{t("Goods problems")}</b><span className="jm-faint">{home.issues.length}</span></div>
            {home.issues.map((x) => <button key={x.number} type="button" className="cr-row" onClick={() => open(x.number, "checkin")}><b>#{x.number}</b><span>{x.name}<small>{x.what}</small></span></button>)}
          </div>
        )}

        {/* the time clock */}
        {c && (
          <div className="jm-card">
            <div className="jm-cardh"><b>{t("Time clock")}</b><span className="jm-faint">{t("{0} today", hm(c.minutes))}</span></div>
            <p className="jm-faint">{c.state === "in" ? t("Clocked in since {0}", clock(c.since, locale)) : c.state === "break" ? t("On lunch / break since {0}", clock(c.since, locale)) : t("Clocked out")}</p>
            <div className="cr-punch">{c.next.map((k) => <button key={k} type="button" className={"jm-go" + (k === "out" ? " warn" : "")} disabled={!!busy} onClick={() => post({ action: "punch", kind: k })}>{busy === k ? t("Saving…") : t(PUNCH[k] || k)}</button>)}</div>
            {!fix ? <button type="button" className="jm-link" onClick={() => setFix({ day: home.today, kind: "lunch", time: "12:00", minutes: "30", note: "" })}>{t("Fix my time card")}</button> : (
              <div className="cr-fix">
                <div className="jm-label">{t("Fix my time card")}</div>
                <div className="cr-seg">{Object.entries(FIX).map(([k, l]) => <button key={k} type="button" className={fix.kind === k ? "on" : ""} onClick={() => setFix({ ...fix, kind: k })}>{t(l)}</button>)}</div>
                <label>{t("Day")}<input type="date" value={fix.day} max={home.today} onChange={(e) => setFix({ ...fix, day: e.target.value })} /></label>
                {fix.kind !== "other" && <label>{fix.kind === "lunch" ? t("Lunch started at") : t("The time")}<input type="time" value={fix.time} onChange={(e) => setFix({ ...fix, time: e.target.value })} /></label>}
                {fix.kind === "lunch" && <label>{t("Minutes")}<input inputMode="numeric" value={fix.minutes} onChange={(e) => setFix({ ...fix, minutes: e.target.value.replace(/\D/g, "") })} /></label>}
                <label>{t("Note (optional)")}<textarea rows={2} value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} /></label>
                <div className="cr-punch"><button type="button" className="jm-go" disabled={!!busy} onClick={sendFix}>{t("Send to my manager")}</button><button type="button" className="jm-link" onClick={() => setFix(null)}>{t("Cancel")}</button></div>
              </div>
            )}
            {home.fixes.length > 0 && <div className="cr-fixes">{home.fixes.map((f) => (
              <div key={f.id} className="cr-fixrow"><span>{day(f.day, locale)} · {t(FIX[f.kind] || f.kind)}{f.at ? ` · ${clock(f.at, locale)}` : ""}{f.minutes ? ` · ${f.minutes}m` : ""}</span><span className={"cr-st " + f.status}>{t(f.status === "pending" ? "Waiting" : f.status === "approved" ? "Approved" : "Not approved")}</span>{f.decision_note && <small>{f.decision_note}</small>}</div>
            ))}</div>}
          </div>
        )}
        {home.staff && <a className="jm-alt" href="/shop">{t("Open the shop")}</a>}
      </main>
    </div>
  );
}

function PressDay({ name, jobs, view, open }: { name: string; jobs: CrewJob[]; view: string; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const left = jobs.filter((j) => j.status !== "done");
  const now = jobs.find((j) => j.status === "running" || j.status === "paused");
  const next = left.find((j) => j !== now);
  // where a tap goes: the operator to the press timer, the assistant to the job, the catcher to the post count
  const tap = (j: CrewJob) => open(j.number, view === "press" ? "timer" : view === "catcher" ? "post" : "");
  const st = (j: CrewJob) => (j.status === "running" ? t("Printing") : j.status === "paused" ? t("Paused") : j.status === "done" ? t("Done {0}", clock(j.finished, locale)) : j === next ? t("Next") : t("Later"));
  return (
    <div className="jm-card">
      <div className="jm-cardh"><b>{name}</b><span className="jm-faint">{t("{0} of {1} done", jobs.length - left.length, jobs.length)}</span></div>
      {!jobs.length && <p className="jm-faint">{t("Nothing on this press today.")}</p>}
      {(now || next) && view !== "assist" && (
        <button type="button" className="jm-go cr-big" onClick={() => tap((now || next)!)}>
          {view === "catcher" ? t("Count #{0}", (now || next)!.number) : now ? t("#{0} · pause or complete", now.number) : t("Start #{0}", next!.number)}
        </button>
      )}
      {jobs.map((j) => (
        <button key={j.number + j.label} type="button" className={"cr-row " + j.status + (j === next ? " next" : "")} onClick={() => tap(j)}>
          <b>#{j.number}{j.rush && <em> {t("Rush")}</em>}</b>
          <span>{j.customer}{j.name && <small>{j.name}</small>}<small>{t("{0} pcs", j.qty)}{j.label ? ` · ${j.label}` : ""}{j.counted === "issue" ? ` · ${t("Goods problem")}` : j.counted === "no" && j.status !== "done" ? ` · ${t("Not counted in")}` : ""}</small></span>
          <i className={"cr-st " + j.status}>{st(j)}</i>
        </button>
      ))}
    </div>
  );
}

function Counting({ jobs, open }: { jobs: CountJob[]; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const [kind, setKind] = useState("all");
  const show = jobs.filter((j) => kind === "all" || j.kind === kind);
  const parts: [CountJob["when"], string][] = [["today", "Today"], ["tomorrow", "Tomorrow"], ["later", "Later"]];
  return (
    <div className="jm-card">
      <div className="jm-cardh"><b>{t("To count in")}</b><span className="jm-faint">{show.length}</span></div>
      <div className="cr-seg four">{[["all", "All"], ["sp", "SP"], ["emb", "EMB"], ["hp", "HP"]].map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t(l)}</button>)}</div>
      {parts.map(([w, l]) => {
        const list = show.filter((j) => j.when === w);
        if (!list.length) return null;
        return (
          <div key={w} className="cr-part">
            <div className="jm-label">{t(l)} · {list.length}</div>
            {list.map((j) => (
              <button key={j.number} type="button" className={"cr-row " + j.state} onClick={() => open(j.number, "checkin")}>
                <b>#{j.number}</b><span>{j.customer}{j.name && <small>{j.name}</small>}<small>{t("{0} pcs", j.qty)}{j.day ? ` · ${t("runs {0}", day(j.day, locale))}` : ""}</small></span>
                <i className={"cr-st " + j.state}>{t(j.state === "issue" ? "Problem" : j.state === "partial" ? "Part here" : j.state === "ready" ? "Here" : j.state === "way" ? "On the way" : "Not here")}</i>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
