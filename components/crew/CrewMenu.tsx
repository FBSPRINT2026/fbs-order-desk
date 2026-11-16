"use client";
import { shortLabel } from "@/lib/jobLabel";
import { countSections } from "@/lib/checkinShared";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrewHome, CrewJob, CountJob, PeriodHours } from "@/lib/crewHome";
import { CREW_VIEWS } from "@/lib/crewView";
import { LangToggle, useT } from "@/components/job/lang";
import CamScan, { preloadScanner } from "@/components/job/CamScan";
import { ViewAsBar, ViewAsPick } from "@/components/crew/ViewAs";

/**
 * The crew phone's main menu (/crew; Nick, Nov 13 2026, look "A + B"): a light page with one dark card on top for the
 * thing this person is on right now (the job on their press, the next job to count in, the job coming off the oven,
 * the next to finish or ship), then their list for today with times, tiles (Scan a job, Tomorrow, Time card), and the
 * time clock buttons. Time card is its own screen: today's punches, fixes sent to a manager to approve.
 */
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const mins = (m: number) => (m >= 60 ? hm(m) : `${Math.round(m)}m`);
const clock = (iso: string | null, loc: string) => (iso ? new Date(iso).toLocaleTimeString(loc, { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M/i, (_, x) => x.toLowerCase()) : "");
const atMin = (m: number | null) => (m == null ? "" : `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")}${m < 720 ? "a" : "p"}`);
const day = (d: string, loc: string) => new Date(d + "T12:00").toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric" });
const PUNCH: Record<string, string> = { in: "Clock in", break_start: "Start lunch", break_end: "Back from lunch", out: "Clock out" };
const FIX: Record<string, string> = { lunch: "A lunch I didn't punch", missed_in: "I forgot to clock in", missed_out: "I forgot to clock out", other: "Something else" };
const Svg = ({ d, size = 24 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const IC = { scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10", cal: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4", time: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3", menu: "M4 6h16M4 12h16M4 18h16" };

export default function CrewMenu({ home }: { home: CrewHome }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [screen, setScreen] = useState<"home" | "time" | "scan" | "hours" | "cards">("home");
  // My time cards (Nov 13): every recent pay period; the one tapped opens on the hours screen
  const [cards, setCards] = useState<PeriodHours[] | null>(null), [card, setCard] = useState<PeriodHours | null>(null);
  const loadCards = () => fetch("/api/crew/cards").then((r) => r.json()).then((j) => setCards(j.cards || [])).catch(() => setCards([]));
  const [fixDay, setFixDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const view = CREW_VIEWS.find((v) => v.id === home.view);
  // someone with an extra (Linda: Receiving, also Deliveries; Nov 13) switches between them at the top; the phone
  // remembers the last one picked
  const modes = home.also.length ? [home.view as string, ...home.also] : [];
  const [mode, setMode0] = useState<string>(home.view);
  useEffect(() => { try { const m = localStorage.getItem("fbs:crew.mode"); if (m && modes.includes(m)) setMode0(m); } catch { /* private mode */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setMode = (m: string) => { setMode0(m); try { localStorage.setItem("fbs:crew.mode", m); } catch { /* private mode */ } };
  const delivering = mode === "delivery";
  const modeLabel = (m: string) => (m === "delivery" ? t("Deliveries") : t(CREW_VIEWS.find((v) => v.id === m)?.label || m));
  const tomorrow = home.day !== home.today;
  const open = (n: number | string, v = "") => { location.href = `/j/${n}${v ? `?v=${v}` : ""}`; };
  // the camera reader loads while the menu is open, so Scan a job reads at once (Nick, Nov 16 2026)
  useEffect(() => { const id = setTimeout(() => { void preloadScanner().catch(() => {}); }, 800); return () => clearTimeout(id); }, []);
  const go = (s: "home" | "time" | "scan" | "hours" | "cards") => { if (s === "cards") void loadCards(); if (s !== "home") history.pushState({ cr: s }, ""); setScreen(s); setErr(""); scrollTo(0, 0); };
  useEffect(() => { const on = (e: PopStateEvent) => setScreen((e.state?.cr as "time" | "scan" | "hours" | "cards") || "home"); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(String(body.kind || body.action)); setErr(""); setMsg("");
    const r = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy("");
    if (!r?.ok) { setErr(t(j.error || "Couldn't save.")); return false; }
    router.refresh(); return true;
  }
  const c = home.clock;
  const where = home.presses.length === 1 ? home.presses[0].name : t(view?.label || "Office");

  return (
    <div className="jm cr" translate="no">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="cr-where">{where}</span><LangToggle /></header>
      {home.viewAs && <ViewAsBar name={home.name} />}
      <main className="jm-main cr-main">
        {screen !== "home" && <button type="button" className="cr-backbtn" onClick={() => history.back()}><Svg d={IC.menu} size={18} />{t("Main menu")}</button>}
        <div className="cr-hello">
          <span className="cr-hi">{screen === "time" ? t("Time card") : screen === "hours" ? t("My time card") : screen === "cards" ? t("My time cards") : screen === "scan" ? t("Open a job") : tomorrow ? t("Tomorrow") : t("Hi, {0}", home.name.split(" ")[0])}</span>
          {c && <span className={"cr-in " + c.state}><i />{c.state === "in" ? t("In {0} · {1}", clock(c.since, locale), hm(c.minutes)) : c.state === "break" ? t("On lunch since {0}", clock(c.since, locale)) : t("Clocked out")}</span>}
        </div>
        {err && <div className="jm-err" role="alert">{err}</div>}
        {msg && <div className="jm-ok" role="status">{msg}</div>}
        {/* clocking in and out right on the main menu; not in yet today, it asks first (Nick, Nov 16 2026). A phone punch
            counts now and waits for a manager's OK on the Time Clock */}
        {screen === "home" && c && !tomorrow && (c.state === "out" && !c.minutes ? (
          <section className="cr-hero cr-notin">
            <div className="cr-k">{t("NOT CLOCKED IN")}</div>
            <div className="cr-n"><b>{t("You haven't clocked in today")}</b></div>
            <div className="cr-s">{t("Clock in now. Your manager OKs punches made on a phone.")}</div>
            <button type="button" className="cr-go" disabled={!!busy} onClick={async () => { if (await post({ action: "punch", kind: "in" })) setMsg(t("Clocked in. Your manager will OK it.")); }}>{busy === "in" ? t("Saving…") : t("Clock in")}</button>
          </section>
        ) : <button type="button" className="cr-clockbtn" onClick={() => go("time")}><Svg d={IC.time} />{t("My time clock")}<small>{t("Your hours this week")}</small></button>)}

        {/* payday: check your hours, first thing on the menu until they answer (Nick, Nov 13) */}
        {screen === "home" && home.hours?.ask && (
          <section className="cr-hero cr-pay">
            <div className="cr-k">{t("PAYDAY")}</div>
            <div className="cr-n"><b>{t("Check your hours")}</b></div>
            <div className="cr-s">{t("{0} – {1} · {2} hours", day(home.hours.start, locale).replace(/,.*/, ""), day(home.hours.end, locale).replace(/,.*/, ""), (home.hours.worked / 60).toFixed(1))}{home.hours.check?.status === "fix_asked" ? ` · ${t("fix sent")}` : ""}</div>
            <button type="button" className="cr-go" onClick={() => { setCard(home.hours); go("hours"); }}>{t("Look at my time card")}</button>
          </section>
        )}
        {screen === "home" && <Find open={open} />}
        {screen === "home" && modes.length > 1 && (
          <div className="cr-seg cr-modes" role="group" aria-label={t("View")} style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}>
            {modes.map((m) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{modeLabel(m)}</button>)}
          </div>
        )}
        {screen === "home" && delivering && <>
          {home.deliveries?.[0] && (
            <section className="cr-hero">
              <div className="cr-k">{t("DELIVER NEXT")}</div>
              <div className="cr-n"><b>#{home.deliveries[0].number}</b><span>{home.deliveries[0].customer}</span></div>
              <div className="cr-s">{t("{0} pcs", home.deliveries[0].qty)}{home.deliveries[0].address ? ` · ${home.deliveries[0].address}` : ""}</div>
              <button type="button" className="cr-go" onClick={() => open(home.deliveries![0].number)}>{t("Open the job")}</button>
            </section>
          )}
          <Deliveries list={home.deliveries || []} open={open} />
        </>}
        {screen === "home" && !delivering && <>
          {tomorrow && <button type="button" className="jm-link" onClick={() => { location.href = "/crew"; }}>{t("← Back to today")}</button>}
          <Hero home={home} open={open} />
          {home.presses.map((p) => <PressDay key={p.id} name={home.presses.length > 1 ? p.name : t("{0} · {1}", p.name, tomorrow ? day(home.day, locale) : t("today"))} jobs={p.jobs} view={home.view} open={open} />)}
          {["press", "assist", "catcher"].includes(home.view) && !home.presses.length && <div className="jm-card"><b>{t("No press set for you")}</b><p className="jm-faint">{t("You're not on a press crew yet. The office sets crews in Production settings.")}</p></div>}
          {home.counting && <Counting jobs={home.counting} open={open} />}
          {home.issues.length > 0 && (
            <div className="jm-card cr-list">
              <div className="jm-cardh"><b>{t("Goods problems")}</b><span className="jm-faint">{home.issues.length}</span></div>
              {home.issues.map((x) => <button key={x.number} type="button" className="cr-li" onClick={() => open(x.number, "checkin")}><span className="cr-t" /><b>#{x.number}</b><span className="cr-who">{x.name}<small>{x.what}</small></span><i className="cr-st issue">{t("Problem")}</i></button>)}
            </div>
          )}
          {home.queue && <Queue home={home} open={open} />}
          {home.deliveries && !modes.length && home.deliveries.length > 0 && <Deliveries list={home.deliveries} open={open} />}
        </>}
        {screen === "home" && <>
          <div className="cr-tiles">
            <button type="button" onClick={() => go("scan")}><Svg d={IC.scan} />{t("Scan a job")}</button>
            {home.presses.length > 0 && <button type="button" onClick={() => { location.href = tomorrow ? "/crew" : "/crew?day=next"; }}><Svg d={IC.cal} />{tomorrow ? t("Today") : t("Tomorrow")}</button>}
            {c && <button type="button" onClick={() => go("time")}><Svg d={IC.time} />{t("Time card")}{home.fixes.some((f) => f.status === "pending") && <small>{t("Fix waiting")}</small>}</button>}
            {c && <button type="button" onClick={() => go("cards")}><Svg d={IC.cal} />{t("My hours")}{home.hours?.ask ? <small>{t("Check them")}</small> : home.hours?.office || home.hours?.check?.status === "approved" ? <small>{t("Approved ✓")}</small> : null}</button>}
          </div>
          {home.staff && <a className="jm-alt" href="/shop">{t("Open the shop")}</a>}
        </>}

        {screen === "scan" && <ScanJob open={open} />}
        {screen === "time" && c && <TimeCard home={home} busy={busy} post={post} day0={fixDay} done={(m) => { setMsg(m); }} />}
        {screen === "cards" && <TimeCardList cards={cards} pick={(k) => { setCard(k); go("hours"); }} />}
        {screen === "hours" && (card || home.hours) && (() => { const h = card || home.hours!; return <Hours h={h} busy={busy} onOk={async () => { if (await post({ action: "hours_ok", start: h.start, hours: +(h.worked / 60).toFixed(2) })) { setMsg(t("Hours approved. Thanks!")); setCard({ ...h, ask: false, check: { status: "approved", at: new Date().toISOString() } }); void loadCards(); } }} onFix={(d) => { setFixDay(d); history.replaceState({ cr: "time" }, ""); setScreen("time"); scrollTo(0, 0); }} />; })()}
        {screen === "home" && home.canViewAs && <ViewAsPick />}
      </main>
    </div>
  );
}

/** the dark card on top: what this person is on right now */
/** a running clock, 1:42:08 (Nick, Nov 16 2026: the running job's clock on the main menu) */
const clockOf = (min: number) => { const s = Math.max(0, Math.floor(min * 60)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

function Hero({ home, open }: { home: CrewHome; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const v = home.view;
  if (home.day !== home.today) return null;
  const jobs = home.presses.flatMap((p) => p.jobs);
  if (["press", "assist", "catcher", "office"].includes(v) && jobs.length) {
    const run = jobs.find((j) => j.status === "running") || jobs.find((j) => j.status === "paused");
    const next = jobs.find((j) => j.status === "scheduled");
    const lastDone = [...jobs].filter((j) => j.status === "done").sort((a, b) => (b.finished || "").localeCompare(a.finished || ""))[0];
    // the catcher follows the press (Nick, Nov 16 2026: "whatever job their press operator is running… it's my job to put
    // in the final count… and the number of boxes"): the job on the press live (who, the side, how far), then the jobs
    // done that aren't counted yet
    if (v === "catcher") {
      const toCount = jobs.filter((x) => x.status === "done" && !x.posted).sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
      const j = run || toCount[0] || lastDone;
      if (!j) return null;
      const used = run?.started ? (now - Date.parse(run.started)) / 60000 : 0;
      const pct = run && j.minutes ? Math.min(100, Math.round((used / j.minutes) * 100)) : 0;
      const side = run?.onNow ? t(run.onNow.replace(/^\w+ · /, "")) : "";
      return (
        <section className="cr-hero">
          <div className="cr-k">{run ? (run.status === "paused" ? t("PAUSED ON THE PRESS") : run.onBy ? `${t(/^Setup/.test(run.onNow || "") ? "{0} IS SETTING UP" : "{0} IS RUNNING", run.onBy.toUpperCase())}${side ? ` · ${side.toUpperCase()}` : ""}` : t("COMING OFF THE PRESS")) : j.posted ? t("JUST FINISHED") : t("READY TO COUNT")}</div>
          <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span>{j.rush && <em>{t("Rush")}</em>}</div>
          <div className="cr-s">{t("{0} pcs", j.qty)}{j.label ? ` · ${shortLabel(j.label)}` : j.name ? ` · ${j.name}` : ""}</div>
          {run && run.status !== "paused" && <div className="cr-clock" aria-live="off">{clockOf(used)}</div>}
          {run && j.minutes > 0 && <div className="cr-bar"><i style={{ width: `${pct}%` }} /></div>}
          {run && (run.sidesDone || []).length > 0 && <div className="cr-time"><span>{(run.sidesDone || []).map((x) => t("{0} done", t(x))).join(" · ")}</span></div>}
          <button type="button" className="cr-go" onClick={() => open(j.number, "post")}>{t("Count it · box labels")}</button>
          {run && <small className="cr-last">{t("{0} marks the side done; you count what comes off the dryer", run.onBy || t("The operator"))}</small>}
          {toCount.filter((x) => x !== j).slice(0, 3).map((x) => (
            <button key={x.number} type="button" className="cr-ghost" onClick={() => open(x.number, "post")}>{t("To count")}: #{x.number} {x.customer}</button>
          ))}
        </section>
      );
    }
    const j = run || next;
    if (!j) return null;
    const used = run?.started ? (now - Date.parse(run.started)) / 60000 : 0;
    const pct = run && j.minutes ? Math.min(100, Math.round((used / j.minutes) * 100)) : 0;
    const over = run && j.minutes && used > j.minutes;
    return (
      <section className="cr-hero">
        <div className="cr-k">{run ? (run.status === "paused" ? t("PAUSED ON THE PRESS") : run.onNow ? `${/^Setup/.test(run.onNow) ? t("SETTING UP") : t("RUNNING")} · ${t(run.onNow.replace(/^\w+ · /, "")).toUpperCase()}` : t("RUNNING")) : t("UP NEXT")}</div>
        <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span>{j.rush && <em>{t("Rush")}</em>}{j.priority && <em className="prio">{t("Priority")}</em>}</div>
        <div className="cr-s">{t("{0} pcs", j.qty)}{j.label ? ` · ${shortLabel(j.label)}` : j.name ? ` · ${j.name}` : ""}</div>
        {/* running: the clock big, how far along, the sides done (Nick, Nov 16 2026, option A) */}
        {run && run.status !== "paused" && <div className="cr-clock" aria-live="off">{clockOf(used)}</div>}
        {run && j.minutes > 0 && <div className={"cr-bar" + (over ? " over" : "")}><i style={{ width: `${pct}%` }} /></div>}
        {run && <div className="cr-time"><span>{[run.status === "paused" ? t("Paused") : "", ...(run.sidesDone || []).map((x) => t("{0} done", t(x)))].filter(Boolean).join(" · ")}</span>{j.minutes > 0 && <span>{t("figured {0}", mins(j.minutes))}</span>}</div>}
        {!run && j.minutes > 0 && <div className="cr-time"><span>{j.startMin != null ? t("Starts {0}", atMin(j.startMin)) : ""}</span><span>{t("figured {0}", mins(j.minutes))}</span></div>}
        {j.counted !== "yes" && <div className="cr-warn">{j.counted === "issue" ? t("Goods problem on this job") : t("Goods not counted in yet")}</div>}
        {run ? (
          // back from lunch: Resume right here, no scanning the ticket (Nick, Nov 16 2026)
          <div className="cr-two">
            {run.status === "paused" && run.orderId
              ? <button type="button" className="cr-go" disabled={busy} onClick={async () => {
                  setBusy(true);
                  const r = await fetch("/api/jobs/timer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: { kind: "o", id: run.orderId }, action: "resume" }) }).catch(() => null);
                  setBusy(false);
                  if (r?.ok) open(j.number, "timer"); else open(j.number, "timer");
                }}>{busy ? t("One moment…") : t("Resume #{0}", j.number)}</button>
              : null}
            <button type="button" className={run.status === "paused" ? "cr-ghost" : "cr-go cr-wide"} onClick={() => open(j.number, "timer")}>{t("Open the timer")}</button>
          </div>
        ) : <button type="button" className="cr-go" onClick={() => open(j.number, v === "assist" ? "" : "timer")}>{v === "assist" ? t("Open the job") : t("Start #{0}", j.number)}</button>}
        {lastDone && <small className="cr-last">{t("Last done: #{0} at {1}", lastDone.number, clock(lastDone.finished, locale))}</small>}
      </section>
    );
  }
  if (v === "receiving" && home.counting?.length) {
    const j = home.counting.find((x) => x.when === "today" && (x.state === "ready" || x.state === "partial")) || home.counting[0];
    return (
      <section className="cr-hero">
        <div className="cr-k">{t("COUNT IN NEXT")}</div>
        <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span></div>
        <div className="cr-s">{t("{0} pcs", j.qty)}{j.day ? ` · ${t("runs {0}", day(j.day, locale))}` : ""}</div>
        <button type="button" className="cr-go" onClick={() => open(j.number, "checkin")}>{t("Count in")}</button>
      </section>
    );
  }
  if ((v === "fulfillment" || v === "shipping") && home.queue?.length) {
    const j = home.queue[0];
    return (
      <section className="cr-hero">
        <div className="cr-k">{v === "fulfillment" ? t("FINISH NEXT") : t("SHIP NEXT")}</div>
        <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span></div>
        <div className="cr-s">{t("{0} pcs", j.qty)}{j.due ? ` · ${t("due {0}", day(j.due, locale))}` : ""}</div>
        <button type="button" className="cr-go" onClick={() => open(j.number)}>{v === "fulfillment" ? t("Open the job") : t("Ship it")}</button>
      </section>
    );
  }
  return null;
}

function PressDay({ name, jobs, view, open }: { name: string; jobs: CrewJob[]; view: string; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const left = jobs.filter((j) => j.status !== "done");
  const next = left.find((j) => j.status === "scheduled");
  const tap = (j: CrewJob) => open(j.number, view === "press" ? "timer" : view === "catcher" ? "post" : "");
  const when = (j: CrewJob) => (j.status === "done" || j.status === "running" || j.status === "paused" ? clock(j.started, locale) : atMin(j.startMin));
  const pill = (j: CrewJob) => (j.status === "running" ? [t("Printing"), "running"] : j.status === "paused" ? [t("Paused"), "paused"] : j.status === "done" ? [t("Done {0}", clock(j.finished, locale)), "done"] : j === next ? [t("Next"), "next"] : j.counted === "issue" ? [t("Goods problem"), "issue"] : j.counted === "no" ? [t("Not counted"), "way"] : [t("Later"), "later"]);
  // what's still to run first, in order, then what's done
  const list = [...left, ...jobs.filter((j) => j.status === "done")];
  return (
    <div className="jm-card cr-list">
      <div className="jm-cardh"><b>{name}</b><span className="jm-faint">{t("{0} of {1} done", jobs.length - left.length, jobs.length)}</span></div>
      {!jobs.length && <p className="jm-faint">{t("Nothing on this press.")}</p>}
      {list.map((j, i) => { const [p, k] = pill(j); return (
        <button key={j.number + "-" + i} type="button" className={"cr-li " + j.status} onClick={() => tap(j)}>
          <span className="cr-t">{when(j)}</span><b>#{j.number}</b>
          <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.label ? ` · ${shortLabel(j.label)}` : ""}</small></span>
          <i className={"cr-st " + k}>{p}</i>
        </button>
      ); })}
    </div>
  );
}

function Counting({ jobs, open }: { jobs: CountJob[]; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const [kind, setKind] = useState("all");
  const show = jobs.filter((j) => kind === "all" || j.kind === kind);
  const parts: [CountJob["when"], string][] = [["today", "Today"], ["tomorrow", "Tomorrow"], ["later", "Later"]];
  return (
    <div className="jm-card cr-list">
      <div className="jm-cardh"><b>{t("To count in")}</b><span className="jm-faint">{show.length}</span></div>
      <div className="cr-seg four">{[["all", "All"], ["sp", "SP"], ["emb", "EMB"], ["hp", "HP"]].map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t(l)}</button>)}</div>
      {parts.map(([w, l]) => {
        const list = show.filter((j) => j.when === w);
        if (!list.length) return null;
        return (
          <div key={w} className="cr-part">
            <div className="jm-label">{t(l)} · {list.length}</div>
            {/* what's surely here first (Nick, Nov 13): Here · ready to count, Part here, Problem, Not sure, On the way */}
            {countSections(list).map((sec) => (
              <div key={sec.key} className="cr-sec">
                <div className="cr-sec-h">{t(sec.label)} · {sec.jobs.length}</div>
                {sec.jobs.map((j) => (
                  <button key={j.number} type="button" className="cr-li" onClick={() => open(j.number, "checkin")}>
                    <span className="cr-t">{j.day ? day(j.day, locale).replace(/,.*/, "") : ""}</span><b>#{j.number}</b>
                    <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.name ? ` · ${j.name}` : ""}</small></span>
                    <i className={"cr-st " + j.state}>{t(j.state === "issue" ? "Problem" : j.state === "partial" ? "Part here" : j.state === "ready" ? "Here" : j.state === "way" ? "On the way" : "Not sure")}</i>
                  </button>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Queue({ home, open }: { home: CrewHome; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const q = home.queue || [];
  return (
    <div className="jm-card cr-list">
      <div className="jm-cardh"><b>{home.view === "fulfillment" ? t("In fulfillment") : t("Ready to ship")}</b><span className="jm-faint">{q.length}</span></div>
      {!q.length && <p className="jm-faint">{t("Nothing waiting.")}</p>}
      {q.map((j) => (
        <button key={j.number} type="button" className="cr-li" onClick={() => open(j.number)}>
          <span className="cr-t">{j.due ? day(j.due, locale).replace(/,.*/, "") : ""}</span><b>#{j.number}</b>
          <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.name ? ` · ${j.name}` : ""}</small></span>
          <i className="cr-st later">{t(j.delivery === "ship" ? "Ship|delivery" : j.delivery === "deliver" ? "Delivery|delivery" : "Pickup|delivery")}</i>
        </button>
      ))}
    </div>
  );
}

function Punch({ next, busy, onPunch }: { next: string[]; busy: string; onPunch: (k: string) => void }) {
  const { t } = useT();
  return <div className="cr-two">{next.map((k) => <button key={k} type="button" className={"cr-punch " + k} disabled={!!busy} onClick={() => onPunch(k)}>{busy === k ? t("Saving…") : t(PUNCH[k] || k)}</button>)}</div>;
}

/** open a job by its number; the phone's camera app reads the work order's QR straight to the job */
/** Scan a work order QR or type its number (the main menu, and "Count in another job" after a count in) */
export function ScanJob({ open }: { open: (n: string) => void }) {
  const { t } = useT();
  const [num, setNum] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  // the camera opens right away (Nov 13, Nick: "when you click that button it's not opening the camera")
  const scanned = (text: string) => { const m = text.match(/\/j\/(\d{3,7}(?:-\d{1,3})?)/) || text.match(/(\d{3,7})/); if (m) open(m[1]); };
  return (
    <div className="jm-card">
      <CamScan onCode={scanned} aim={t("Point at the QR on the work order")} noCam={t("Can't use the camera. Type the number instead.")} />
      <p className="jm-faint">{t("Or type the job number.")}</p>
      <form className="cr-open" onSubmit={(e) => { e.preventDefault(); const m = num.match(/\d{3,7}/); if (m) open(m[0]); }}>
        <input ref={ref} inputMode="numeric" placeholder={t("Job #")} value={num} onChange={(e) => setNum(e.target.value)} aria-label={t("Job #")} />
        <button type="submit" className="jm-go" disabled={!/\d{3,7}/.test(num)}>{t("Open")}</button>
      </form>
    </div>
  );
}

/**
 * The time card on the phone (Nick, Nov 16 2026: "he should view his hours at all time… here's my punch from yesterday
 * and then he should click a button… here's what needs fixing"): today with Start lunch / Clock out (each asks first),
 * then every day of this pay period and the last one; a day opens its punches and "Something's wrong with this day",
 * which opens the fix for that day. Fixes and phone punches go to a manager to OK.
 */
const PK: Record<string, string> = { in: "Clocked in", break_start: "Lunch out", break_end: "Lunch in", out: "Clocked out" };
function TimeCard({ home, busy, post, done, day0 }: { home: CrewHome; busy: string; post: (b: Record<string, unknown>) => Promise<boolean>; done: (m: string) => void; /** opened from My hours on a day */ day0?: string | null }) {
  const { t, locale } = useT();
  const [fix, setFix] = useState({ day: day0 || home.today, kind: "lunch", time: "12:00", minutes: "30", note: "" });
  const [cards, setCards] = useState<PeriodHours[] | null>(null);
  type Day = PeriodHours["days"][number];
  const [at, setAt] = useState<{ v: "main" } | { v: "day"; d: Day } | { v: "why"; d: Day } | { v: "edit"; d: Day; why: string } | { v: "fix" }>(day0 ? { v: "fix" } : { v: "main" });
  const [rows, setRows] = useState<ERow[]>([]);
  const [eNote, setENote] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/crew/cards").then((r) => r.json()).then((j) => setCards(j.cards || [])).catch(() => setCards([])); }, []);
  const c = home.clock!;
  async function send() {
    const at0 = fix.time && fix.kind !== "other" ? new Date(`${fix.day}T${fix.time}:00`).toISOString() : null;
    if (await post({ action: "fix", day: fix.day, kind: fix.kind, at: at0, minutes: +fix.minutes || 30, note: fix.note })) { done(t("Sent to your manager to approve.")); setFix({ ...fix, note: "" }); setAt({ v: "main" }); }
  }
  const nowT = new Date().toLocaleTimeString(locale, { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  // the days of a period, today first; a working day with nothing punched (Mon–Fri, before today) shows too, in red
  const daysOf = (k: PeriodHours) => {
    const seen = new Map(k.days.map((d) => [d.day, d]));
    const out: PeriodHours["days"] = [];
    for (let d = k.end > home.today ? home.today : k.end; d >= k.start; d = addDay(d, -1)) {
      const x = seen.get(d); const wd = new Date(d + "T12:00:00").getDay();
      if (x) out.push(x); else if (wd >= 1 && wd <= 5 && d < home.today) out.push({ day: d, first: null, last: null, worked: 0, breaks: 0, fixed: false, issues: 0, punches: [] });
    }
    return out;
  };
  const dayRow = (d: PeriodHours["days"][number]) => (
    <button key={d.day} type="button" className={"cr-tday" + (d.day === home.today ? " today" : "") + (!d.first || d.issues ? " miss" : "")} onClick={() => { setAt({ v: "day", d }); scrollTo(0, 0); }}>
      <b>{day(d.day, locale).split(",")[0]} {+d.day.slice(8)}</b>
      <span>{!d.first ? t("No punches") : `${clock(d.first, locale)} – ${d.day === home.today && c.state !== "out" ? t("now") : d.last ? clock(d.last, locale) : "…"}${d.breaks ? ` · ${t("lunch {0} min", d.breaks)}` : ""}`}</span>
      <em>{d.worked ? (d.worked / 60).toFixed(1) : "—"}</em><i aria-hidden>›</i>
    </button>
  );
  if (at.v === "day") {
    const d = at.d;
    return (
      <>
        <button type="button" className="jm-link cr-tback" onClick={() => setAt({ v: "main" })}>← {t("Time card")}</button>
        <div className="jm-card">
          <div className="jm-cardh"><b>{day(d.day, locale)}</b><span className="jm-faint">{d.worked ? t("{0} hrs", (d.worked / 60).toFixed(1)) : ""}</span></div>
          {(d.punches || []).length ? (d.punches || []).map((p, i, all) => { const dbl = i > 0 && Date.parse(p.at) - Date.parse(all[i - 1].at) < 3 * 60000; return <div key={i} className={"cr-tpun" + (dbl ? " dbl" : "")}><span>{t(PK[p.kind] || p.kind)}{dbl && <small>{t("a minute after the last one: a double punch?")}</small>}</span><b>{clock(p.at, locale)}</b></div>; }) : <p className="jm-faint">{t("No punches")}</p>}
          {d.fixed && <small className="jm-faint">{t("fixed by the office")}</small>}
        </div>
        <button type="button" className="cr-tfix" onClick={() => { setAt({ v: "why", d }); scrollTo(0, 0); }}>{t("These aren't my hours")}</button>
        <p className="jm-faint" style={{ textAlign: "center" }}>{t("Fixes go to your manager to OK. Your punches don't change until they do.")}</p>
      </>
    );
  }
  // "These aren't my hours" (Nick, Nov 16 2026): what happened, then the day's punches to correct into the real hours
  if (at.v === "why") {
    const d = at.d;
    return (
      <>
        <button type="button" className="jm-link cr-tback" onClick={() => setAt({ v: "day", d })}>← {day(d.day, locale)}</button>
        <div className="cr-tt">{t("What happened?")}</div>
        <div className="cr-why">{WHY.map((w) => <button key={w} type="button" onClick={() => { setRows(startRows(d, w)); setENote(""); setAt({ v: "edit", d, why: w }); scrollTo(0, 0); }}>{t(w)}<i aria-hidden>›</i></button>)}</div>
        <p className="jm-faint" style={{ textAlign: "center" }}>{t("Then you write down your real hours for the day.")}</p>
      </>
    );
  }
  if (at.v === "edit") {
    const { d, why } = at;
    const live = rows.filter((r) => !r.gone && r.time);
    const mins = workedOf(live), was = d.worked || 0;
    const set = (i: number, v: Partial<ERow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...v } : r)));
    const sendDay = async () => {
      const punches = live.map((r) => ({ kind: r.kind, at: new Date(`${d.day}T${r.time}:00`).toISOString() }));
      if (await post({ action: "fixday", day: d.day, reason: why, note: eNote, punches })) { done(t("Sent to your manager to approve.")); setAt({ v: "main" }); }
    };
    return (
      <>
        <button type="button" className="jm-link cr-tback" onClick={() => setAt({ v: "why", d })}>← {t("What happened?")}</button>
        <div className="cr-tt">{t("My real hours")} · {day(d.day, locale).split(",")[0]} {+d.day.slice(8)}</div>
        <div className="jm-card cr-ed">
          <div className="jm-label">{t(why)}</div>
          {rows.map((r, i) => (
            <div key={i} className={"cr-er" + (r.gone ? " gone" : "")}>
              <select className="jm-select" value={r.kind} disabled={r.gone} onChange={(e) => set(i, { kind: e.target.value as ERow["kind"] })} aria-label={t("Punch")}>
                {(["in", "break_start", "break_end", "out"] as const).map((k) => <option key={k} value={k}>{t(PK[k])}</option>)}
              </select>
              <input type="time" value={r.time} disabled={r.gone} className={r.orig !== undefined && r.orig !== r.time ? "chg" : r.orig === undefined ? "chg" : ""} onChange={(e) => set(i, { time: e.target.value })} aria-label={t("The time")} />
              <button type="button" className="cr-erx" aria-label={r.gone ? t("Put it back") : t("Take it out")} onClick={() => (r.orig === undefined && !r.gone ? setRows(rows.filter((_, k) => k !== i)) : set(i, { gone: !r.gone }))}>{r.gone ? "↺" : "✕"}</button>
            </div>
          ))}
          <button type="button" className="jm-link" style={{ alignSelf: "flex-start" }} onClick={() => setRows([...rows, { kind: nextKind(rows), time: "" }])}>+ {t("Add a punch")}</button>
          <label className="cr-ednote">{t("Note (optional)")}<textarea rows={2} value={eNote} onChange={(e) => setENote(e.target.value)} /></label>
        </div>
        <div className="cr-ttot"><span>{t("Your hours")}</span><b>{t("{0} hrs", (mins / 60).toFixed(1))} <small className="jm-faint">· {t("was {0}", (was / 60).toFixed(1))}</small></b></div>
        <button type="button" className="jm-go" disabled={!!busy || (!live.length && !eNote.trim())} onClick={sendDay}>{t("Send to Jose")}</button>
        <p className="jm-faint" style={{ textAlign: "center" }}>{t("Fixes go to your manager to OK. Your punches don't change until they do.")}</p>
      </>
    );
  }
  if (at.v === "fix") return (
    <>
      <button type="button" className="jm-link cr-tback" onClick={() => setAt({ v: "main" })}>← {t("Time card")}</button>
      <div className="jm-card cr-fix">
        <b>{t("What needs fixing?")}</b>
        <div className="cr-seg">{Object.entries(FIX).map(([k, l]) => <button key={k} type="button" className={fix.kind === k ? "on" : ""} onClick={() => setFix({ ...fix, kind: k })}>{t(l)}</button>)}</div>
        <label>{t("Day")}<input type="date" value={fix.day} max={home.today} onChange={(e) => setFix({ ...fix, day: e.target.value })} /></label>
        {fix.kind !== "other" && <div className="cr-two">
          <label>{fix.kind === "lunch" ? t("Lunch started") : t("The time")}<input type="time" value={fix.time} onChange={(e) => setFix({ ...fix, time: e.target.value })} /></label>
          {fix.kind === "lunch" && <label>{t("Minutes")}<input inputMode="numeric" value={fix.minutes} onChange={(e) => setFix({ ...fix, minutes: e.target.value.replace(/\D/g, "") })} /></label>}
        </div>}
        <label>{fix.kind === "other" ? t("What happened") : t("Note (optional)")}<textarea rows={2} value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} /></label>
        <button type="button" className="jm-go" disabled={!!busy || (fix.kind === "other" && !fix.note.trim())} onClick={send}>{t("Send to my manager")}</button>
      </div>
    </>
  );
  return (
    <>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Today")}</b><span className="jm-faint">{hm(c.minutes)}</span></div>
        <p className="jm-faint">{c.state === "in" ? t("Clocked in since {0}", clock(c.since, locale)) : c.state === "break" ? t("On lunch since {0}", clock(c.since, locale)) : t("Clocked out")}</p>
        {/* every punch asks first, so a thumb can't clock anyone out (Nick, Nov 16 2026) */}
        {ask ? <div className="cr-ask">
          <b>{t("{0} at {1}?", t(PUNCH[ask] || ask), nowT)}</b>
          <small>{t("Your manager OKs punches made on a phone.")}</small>
          <div className="cr-two"><button type="button" className="jm-ghost" onClick={() => setAsk(null)}>{t("Cancel")}</button>
            <button type="button" className="jm-go" disabled={!!busy} onClick={async () => { const k = ask; setAsk(null); if (await post({ action: "punch", kind: k })) done(t("Saved. Your manager will OK it.")); }}>{t("Yes")}</button></div>
        </div> : <Punch next={c.next} busy={busy} onPunch={(k) => setAsk(k)} />}
      </div>
      {!cards ? <div className="jm-card"><p className="jm-faint">{t("Loading…")}</p></div> : cards.slice(0, 2).map((k, i) => {
        const ds = daysOf(k);
        return (
          <div key={k.start} className="jm-card cr-tlist">
            <div className="jm-cardh"><b>{i === 0 && k.open ? t("My hours") : t("Last pay period")}</b><span className="jm-faint">{day(k.start, locale).replace(/^[^,]*,\s*/, "")} – {day(k.end, locale).replace(/^[^,]*,\s*/, "")}</span></div>
            {ds.length ? ds.map(dayRow) : <p className="jm-faint">{t("No punches in this pay period.")}</p>}
            <div className="cr-ttot"><span>{k.open ? t("Total so far") : t("Total")}</span><b>{t("{0} hrs", (k.worked / 60).toFixed(1))}</b></div>
          </div>
        );
      })}
      <button type="button" className="jm-link" onClick={() => { setAt({ v: "fix" }); scrollTo(0, 0); }}>{t("Something's wrong? Send a fix")}</button>
      {home.fixes.length > 0 && (
        <div className="jm-card cr-fixes">
          <b>{t("Sent")}</b>
          {home.fixes.map((f) => (
            <div key={f.id} className="cr-fixrow"><span>{day(f.day, locale)} · {t(FIX[f.kind] || f.kind)}{f.at ? ` · ${clock(f.at, locale)}` : ""}{f.minutes ? ` · ${f.minutes}m` : ""}</span><i className={"cr-st " + f.status}>{t(f.status === "pending" ? "Waiting" : f.status === "approved" ? "Approved" : "Not approved")}</i>{f.decision_note && <small>{f.decision_note}</small>}</div>
          ))}
        </div>
      )}
    </>
  );
}

/** Fixing a day (Nick, Nov 16 2026): what happened, then the day's punches written as they really were */
const WHY = ["I punched twice", "I forgot to punch my lunch", "I forgot to clock in", "I forgot to clock out", "A time is wrong", "Something else"];
type ERow = { kind: "in" | "out" | "break_start" | "break_end"; time: string; orig?: string; gone?: boolean };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false });
const nextKind = (rs: ERow[]): ERow["kind"] => { const l = rs.filter((r) => !r.gone).at(-1)?.kind; return !l || l === "out" ? "in" : l === "in" || l === "break_end" ? "out" : "break_end"; };
function startRows(d: { punches?: { kind: string; at: string }[] }, why: string): ERow[] {
  const ps = d.punches || [];
  const rs: ERow[] = ps.map((p, i) => ({ kind: (["in", "out", "break_start", "break_end"].includes(p.kind) ? p.kind : "in") as ERow["kind"], time: hhmm(p.at), orig: hhmm(p.at),
    // a punch a few minutes after the one before is the double punch: struck through to start, one tap puts it back
    gone: why === "I punched twice" && i > 0 && Date.parse(p.at) - Date.parse(ps[i - 1].at) < 3 * 60000 }));
  const has = (k: string) => rs.some((r) => r.kind === k && !r.gone);
  if (why === "I forgot to punch my lunch" && !has("break_start")) rs.push({ kind: "break_start", time: "12:00" }, { kind: "break_end", time: "12:30" });
  if (why === "I forgot to clock in" && !has("in")) rs.unshift({ kind: "in", time: "" });
  if (why === "I forgot to clock out" && !has("out")) rs.push({ kind: "out", time: "" });
  return rs.sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : 0));
}
/** minutes worked from a day's punches in time order: in / lunch in start the clock, lunch out / out stop it */
function workedOf(rs: ERow[]): number {
  let on: number | null = null, m = 0;
  for (const r of [...rs].sort((a, b) => a.time.localeCompare(b.time))) {
    const [h, mi] = r.time.split(":").map(Number), x = h * 60 + mi;
    if (r.kind === "in" || r.kind === "break_end") { if (on === null) on = x; }
    else if (on !== null) { m += Math.max(0, x - on); on = null; }
  }
  return m;
}
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** My time cards (Nick, Nov 13 2026: "see your time cards from the past"): the period now running and the ones before it */
function TimeCardList({ cards, pick }: { cards: PeriodHours[] | null; pick: (c: PeriodHours) => void }) {
  const { t, locale } = useT();
  if (!cards) return <div className="jm-card"><p className="jm-faint">{t("Loading…")}</p></div>;
  if (!cards.length) return <div className="jm-card"><p className="jm-faint">{t("No time cards yet.")}</p></div>;
  return (
    <div className="jm-card cr-tcl">
      {cards.map((k) => (
        <button key={k.start} type="button" className="cr-tc" onClick={() => pick(k)}>
          <span className="cr-tcn"><b>{day(k.start, locale).replace(/^[^,]*,\s*/, "")} – {day(k.end, locale).replace(/^[^,]*,\s*/, "")}</b>
            <small className={k.open || (!k.office && k.check?.status !== "approved") ? "wait" : ""}>{k.open ? t("This period · so far") : k.office && k.check?.status === "approved" ? t("You approved · office approved") : k.office ? t("Approved by the office") : k.check?.status === "approved" ? t("You approved") : k.check?.status === "fix_asked" ? t("Fix sent") : t("Check them")}</small></span>
          <span className="cr-tch">{(k.worked / 60).toFixed(1)} h <i aria-hidden>›</i></span>
        </button>
      ))}
    </div>
  );
}

/**
 * Payday (Nick, Nov 13 2026: uAttend's printed time card sheets, on the phone): the pay period's days, in and out, lunch,
 * hours, the days a manager fixed; "My hours are right" approves them, "Something's wrong" opens the time card fix on
 * that day, which goes to the manager like any fix.
 */
function Hours({ h, busy, onOk, onFix }: { h: PeriodHours; busy: string; onOk: () => void; onFix: (day: string) => void }) {
  const { t, locale } = useT();
  const [wrong, setWrong] = useState(false);
  const ok = h.check?.status === "approved";
  return (
    <>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Pay period")}</b><span className="jm-faint">{day(h.start, locale).replace(/,.*/, "")} – {day(h.end, locale).replace(/,.*/, "")}</span></div>
        <div className="cr-htot"><div><b>{(h.worked / 60).toFixed(1)}</b><span>{t("Hours")}</span></div><div><b>{(h.overtime / 60).toFixed(1)}</b><span>{t("Overtime")}</span></div><div><b>{(h.breaks / 60).toFixed(1)}</b><span>{t("Lunches")}</span></div></div>
      </div>
      <div className="jm-card cr-hdays">
        {!h.days.length && <p className="jm-faint">{t("No punches in this pay period.")}</p>}
        {h.days.map((d) => (
          <button key={d.day} type="button" className={"cr-hday" + (wrong ? " pick" : "")} disabled={!wrong} onClick={() => onFix(d.day)}>
            <span className="cr-hd">{day(d.day, locale).split(",")[0]}<small>{day(d.day, locale).split(",").slice(1).join(",").trim()}</small></span>
            <span className="cr-hp">{d.first ? clock(d.first, locale) : "—"} – {d.last ? clock(d.last, locale) : "—"}{d.breaks ? <small>{t("lunch {0} min", d.breaks)}</small> : <small>{t("no lunch")}</small>}{d.fixed ? <small className="cr-hfix">{t("fixed by the office")}</small> : null}{d.issues ? <small className="cr-hbad">{t("needs a fix")}</small> : null}</span>
            <b className="cr-hh">{(d.worked / 60).toFixed(1)}</b>
          </button>
        ))}
      </div>
      {h.office ? <div className="jm-ok">{ok ? t("You and the office approved these hours.") : t("The office approved these hours.")}</div> : ok ? <div className="jm-ok">{t("You approved these hours. Thanks!")}</div> : h.open && !wrong ? <>
        <div className="jm-faint cr-hopen">{t("This pay period isn't over yet: these are your hours so far.")}</div>
        <button type="button" className="jm-ghost" onClick={() => setWrong(true)}>{t("Something's wrong")}</button>
      </> : wrong ? <>
        <div className="jm-warn">{t("Tap the day that's wrong.")}</div>
        <button type="button" className="jm-ghost" onClick={() => setWrong(false)}>{t("Cancel")}</button>
      </> : <>
        <button type="button" className="jm-go cr-hok" disabled={!!busy || !h.days.length} onClick={onOk}>✓ {t("My hours are right · Approve")}</button>
        <button type="button" className="jm-ghost" onClick={() => setWrong(true)}>{t("Something's wrong")}</button>
      </>}
    </>
  );
}

function Deliveries({ list, open }: { list: NonNullable<CrewHome["deliveries"]>; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  return (
    <div className="jm-card cr-list">
      <div className="jm-cardh"><b>{t("Deliveries")}</b><span className="jm-faint">{list.length}</span></div>
      {!list.length && <p className="jm-faint">{t("Nothing ready to deliver.")}</p>}
      {list.map((j) => (
        <button key={j.number} type="button" className="cr-li" onClick={() => open(j.number)}>
          <span className="cr-t">{j.due ? day(j.due, locale).replace(/,.*/, "") : ""}</span><b>#{j.number}</b>
          <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.address ? ` · ${j.address}` : ""}</small></span>
          <i className="cr-st ready">{t("Ready")}</i>
        </button>
      ))}
    </div>
  );
}

/** Find, first thing on the menu (Nov 13, Nick: "a search button so that you can search a PO… or open the camera to scan
 *  a work order"): type a PO, job #, job name or customer; or the camera reads the work order's QR and opens the job. */
function Find({ open }: { open: (n: number | string, v?: string) => void }) {
  const { t, locale } = useT();
  const [q, setQ] = useState(""), [cam, setCam] = useState(false);
  const [hits, setHits] = useState<{ number: string; name: string; po: string; customer: string; qty: number; status: string; due: string | null }[] | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits(null); return; }
    const c = new AbortController();
    const tm = setTimeout(() => { fetch(`/api/crew?q=${encodeURIComponent(s)}`, { signal: c.signal }).then((r) => r.json()).then((j) => setHits(j.jobs || [])).catch(() => null); }, 250);
    return () => { clearTimeout(tm); c.abort(); };
  }, [q]);
  const scanned = (text: string) => { setCam(false); const m = text.match(/\/j\/(\d{3,7}(?:-\d{1,3})?)/) || text.match(/(\d{3,7})/); if (m) open(m[1]); else setQ(text); };
  return (
    <div className="cr-findwrap">
      <form className="cr-find" onSubmit={(e) => { e.preventDefault(); if (hits?.length === 1) open(hits[0].number); else if (/^#?\d{3,7}$/.test(q.trim())) open(q.trim().replace("#", "")); }}>
        <input type="search" enterKeyHint="search" placeholder={t("Search a PO, job # or customer")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Search")} />
        <button type="button" className="cr-camb" onClick={() => setCam(!cam)} aria-label={t("Scan with the camera")}><Svg d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />{cam ? t("Close") : t("Scan")}</button>
      </form>
      {cam && <CamScan onCode={scanned} aim={t("Point at the QR on the work order")} noCam={t("Can't use the camera. Type the number instead.")} />}
      {hits && (
        <div className="jm-card cr-list">
          {!hits.length && <p className="jm-faint">{t("Nothing found for \"{0}\".", q.trim())}</p>}
          {hits.map((h) => (
            <button key={h.number} type="button" className="cr-li" onClick={() => open(h.number)}>
              <span className="cr-t">{h.due ? day(h.due, locale).replace(/,.*/, "") : ""}</span><b>#{h.number}</b>
              <span className="cr-who">{h.customer}<small>{[h.name, h.po ? `PO ${h.po}` : "", t("{0} pcs", h.qty)].filter(Boolean).join(" · ")}</small></span>
              <i className="cr-st later">{h.status}</i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
