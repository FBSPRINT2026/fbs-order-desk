"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrewHome, CrewJob, CountJob } from "@/lib/crewHome";
import { CREW_VIEWS } from "@/lib/crewView";
import { LangToggle, useT } from "@/components/job/lang";
import CamScan from "@/components/job/CamScan";

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
  const [screen, setScreen] = useState<"home" | "time" | "scan">("home");
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
  const go = (s: "home" | "time" | "scan") => { if (s !== "home") history.pushState({ cr: s }, ""); setScreen(s); setErr(""); scrollTo(0, 0); };
  useEffect(() => { const on = (e: PopStateEvent) => setScreen((e.state?.cr as "time" | "scan") || "home"); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);

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
    <div className="jm cr">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="cr-where">{where}</span><LangToggle /></header>
      <main className="jm-main cr-main">
        {screen !== "home" && <button type="button" className="cr-backbtn" onClick={() => history.back()}><Svg d={IC.menu} size={18} />{t("Main menu")}</button>}
        <div className="cr-hello">
          <span className="cr-hi">{screen === "time" ? t("Time card") : screen === "scan" ? t("Open a job") : tomorrow ? t("Tomorrow") : t("Hi, {0}", home.name.split(" ")[0])}</span>
          {c && <span className={"cr-in " + c.state}><i />{c.state === "in" ? t("In {0} · {1}", clock(c.since, locale), hm(c.minutes)) : c.state === "break" ? t("On lunch since {0}", clock(c.since, locale)) : t("Clocked out")}</span>}
        </div>
        {err && <div className="jm-err" role="alert">{err}</div>}
        {msg && <div className="jm-ok" role="status">{msg}</div>}

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
          </div>
          {c && <Punch next={c.next} busy={busy} onPunch={(k) => post({ action: "punch", kind: k })} />}
          {home.staff && <a className="jm-alt" href="/shop">{t("Open the shop")}</a>}
        </>}

        {screen === "scan" && <ScanJob open={open} />}
        {screen === "time" && c && <TimeCard home={home} busy={busy} post={post} done={(m) => { setMsg(m); }} />}
      </main>
    </div>
  );
}

/** the dark card on top: what this person is on right now */
function Hero({ home, open }: { home: CrewHome; open: (n: number, v?: string) => void }) {
  const { t, locale } = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const v = home.view;
  if (home.day !== home.today) return null;
  const jobs = home.presses.flatMap((p) => p.jobs);
  if (["press", "assist", "catcher", "office"].includes(v) && jobs.length) {
    const run = jobs.find((j) => j.status === "running") || jobs.find((j) => j.status === "paused");
    const next = jobs.find((j) => j.status === "scheduled");
    const lastDone = [...jobs].filter((j) => j.status === "done").sort((a, b) => (b.finished || "").localeCompare(a.finished || ""))[0];
    // the catcher: the job coming off the oven (printing now), else the last one done
    if (v === "catcher") {
      const j = run || lastDone;
      if (!j) return null;
      return (
        <section className="cr-hero">
          <div className="cr-k">{run ? t("COMING OFF THE PRESS") : t("JUST FINISHED")}</div>
          <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span></div>
          <div className="cr-s">{t("{0} pcs", j.qty)}{j.name ? ` · ${j.name}` : ""}</div>
          <button type="button" className="cr-go" onClick={() => open(j.number, "post")}>{t("Count it · box labels")}</button>
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
        <div className="cr-k">{run ? (run.status === "paused" ? t("PAUSED ON THE PRESS") : t("ON THE PRESS NOW")) : t("UP NEXT")}</div>
        <div className="cr-n"><b>#{j.number}</b><span>{j.customer}</span>{j.rush && <em>{t("Rush")}</em>}</div>
        <div className="cr-s">{t("{0} pcs", j.qty)}{j.label ? ` · ${j.label}` : j.name ? ` · ${j.name}` : ""}</div>
        {run && j.minutes > 0 && <>
          <div className={"cr-bar" + (over ? " over" : "")}><i style={{ width: `${pct}%` }} /></div>
          <div className="cr-time"><span>{run.status === "paused" ? t("Paused") : t("Printing {0}", mins(used))}</span><span>{t("figured {0}", mins(j.minutes))}</span></div>
        </>}
        {!run && j.minutes > 0 && <div className="cr-time"><span>{j.startMin != null ? t("Starts {0}", atMin(j.startMin)) : ""}</span><span>{t("figured {0}", mins(j.minutes))}</span></div>}
        {j.counted !== "yes" && <div className="cr-warn">{j.counted === "issue" ? t("Goods problem on this job") : t("Goods not counted in yet")}</div>}
        {run ? (
          <div className="cr-two">
            <button type="button" className="cr-ghost" onClick={() => open(j.number, "timer")}>{run.status === "paused" ? t("Resume") : t("Pause")}</button>
            <button type="button" className="cr-go" onClick={() => open(j.number, "timer")}>{t("Complete")}</button>
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
          <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.label ? ` · ${j.label}` : ""}</small></span>
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
            {list.map((j) => (
              <button key={j.number} type="button" className="cr-li" onClick={() => open(j.number, "checkin")}>
                <span className="cr-t">{j.day ? day(j.day, locale).replace(/,.*/, "") : ""}</span><b>#{j.number}</b>
                <span className="cr-who">{j.customer}<small>{t("{0} pcs", j.qty)}{j.name ? ` · ${j.name}` : ""}</small></span>
                <i className={"cr-st " + j.state}>{t(j.state === "issue" ? "Problem" : j.state === "partial" ? "Part here" : j.state === "ready" ? "Here" : j.state === "way" ? "On the way" : "Not here")}</i>
              </button>
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
function ScanJob({ open }: { open: (n: string) => void }) {
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

function TimeCard({ home, busy, post, done }: { home: CrewHome; busy: string; post: (b: Record<string, unknown>) => Promise<boolean>; done: (m: string) => void }) {
  const { t, locale } = useT();
  const [fix, setFix] = useState({ day: home.today, kind: "lunch", time: "12:00", minutes: "30", note: "" });
  const c = home.clock!;
  async function send() {
    const at = fix.time && fix.kind !== "other" ? new Date(`${fix.day}T${fix.time}:00`).toISOString() : null;
    if (await post({ action: "fix", day: fix.day, kind: fix.kind, at, minutes: +fix.minutes || 30, note: fix.note })) { done(t("Sent to your manager to approve.")); setFix({ ...fix, note: "" }); }
  }
  return (
    <>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Today")}</b><span className="jm-faint">{hm(c.minutes)}</span></div>
        <p className="jm-faint">{c.state === "in" ? t("Clocked in since {0}", clock(c.since, locale)) : c.state === "break" ? t("On lunch since {0}", clock(c.since, locale)) : t("Clocked out")}</p>
        <Punch next={c.next} busy={busy} onPunch={(k) => post({ action: "punch", kind: k })} />
      </div>
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
