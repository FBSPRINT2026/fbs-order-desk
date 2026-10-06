"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import type { JobTime } from "@/lib/timeclock";
import type { PressOption } from "@/lib/pressActual";
import { useT } from "./lang";

/**
 * The press timer: Start setup → Setup done, start running → Finish run (pieces) → set up the next location, with
 * Pause (lunch, break…) and Resume, and "Whole job done". Every step is a dated job-time entry for the person signed in
 * on this phone. The timer lives on the server, so it's still running when the phone sleeps or the page is closed:
 * scanning the job again (or reopening the page) picks it right back up.
 */
type Row = JobTime & { who: string };
type State = { me: { name: string } | null; running: JobTime | null; paused: JobTime | null; log: Row[] };
const PAUSES = ["Lunch", "Break", "Running another location first", "Waiting on screens or ink", "Press problem", "End of shift"];
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
const hm = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const parse = (task: string) => { const [phase, ...rest] = task.split(" · "); return { phase: phase === "Setup" ? "setup" : phase === "Run" ? "run" : "other", loc: rest.join(" · ") || task }; };
const sticky = { get: (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export default function PressTimer({ card, presses }: { card: JobCard; presses: PressOption[] }) {
  const { t, locale } = useT();
  const job = { kind: card.kind, id: card.id };
  const locs = [...new Set(card.groups.flatMap((g) => g.prints.map((p) => p.location).filter(Boolean)))];
  const qtyOf = (loc: string) => card.groups.filter((g) => g.prints.some((p) => p.location === loc)).reduce((a, g) => a + g.rows.reduce((b, r) => b + r.total, 0), 0) || card.qty;
  const taskT = (task: string) => { const x = parse(task); return x.phase === "setup" ? t("Setup · {0}", t(x.loc)) : x.phase === "run" ? t("Run · {0}", t(x.loc)) : t(task); };
  const noteT = (n: string) => (/^Paused: /.test(n) ? t("Paused: {0}", t(n.slice(8))) : t(n));
  const [st, setSt] = useState<State | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [loc, setLoc] = useState(locs[0] || "Whole job"), [press, setPress] = useState("");
  const [pausing, setPausing] = useState(false), [finishing, setFinishing] = useState<number | null>(null), [now, setNow] = useState(Date.now());
  const [awake, setAwake] = useState(false);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/timer?kind=${job.kind}&id=${job.id}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    if (!r?.ok) setErr(t(j.error || "Couldn't load.")); else { setErr(""); setSt(j); }
  }, [job.kind, job.id, t]);
  useEffect(() => { setPress(sticky.get("jm.press") || presses[0]?.name || ""); load(); }, [load, presses]);
  // the phone woke up / came back to the page: the server has the truth
  useEffect(() => { const on = () => { if (document.visibilityState === "visible") { load(); if (awake) keepAwake(true); } }; document.addEventListener("visibilitychange", on); return () => document.removeEventListener("visibilitychange", on); });
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  async function keepAwake(on: boolean) {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (on && wl) { lock.current = await wl.request("screen"); setAwake(true); }
      else { await lock.current?.release(); lock.current = null; setAwake(false); }
    } catch { setAwake(false); }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setErr("");
    if (press) sticky.set("jm.press", press);
    const r = await fetch("/api/jobs/timer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, action, location: loc, press, ...extra }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy(""); setPausing(false); setFinishing(null);
    if (!r?.ok) return setErr(t(j.error || "Couldn't save."));
    setSt(j);
  }

  if (!st) return <div className="jm-card"><p className="jm-faint">{err || t("Loading…")}</p></div>;
  if (!st.me) return <div className="jm-card"><p>{t("The press timer is for the crew: sign in on this phone with your employee number and PIN.")}</p></div>;
  const run = st.running, onThis = run && (card.kind === "o" ? run.order_id : run.archived_order_id) === card.id ? run : null;
  const cur = onThis ? parse(onThis.task) : null;
  const doneRuns = new Set(st.log.filter((r) => r.ended_at && parse(r.task).phase === "run").map((r) => parse(r.task).loc));
  const left = locs.filter((l) => !doneRuns.has(l));

  return (
    <>
      {run && !onThis && <div className="jm-warn">{t("You're on {0} ({1}) for {2}. Starting here stops that.", run.job_label, taskT(run.task), hm(now - +new Date(run.started_at)))}</div>}

      {onThis ? (
        <div className={"jm-card jm-tm " + cur!.phase}>
          <div className="jm-tm-ph">{cur!.phase === "setup" ? t("Setting up") : cur!.phase === "run" ? t("Running") : taskT(onThis.task)}</div>
          <div className="jm-tm-loc">{t(cur!.loc)}{onThis.station ? <small> · {onThis.station}</small> : null}</div>
          <div className="jm-tm-clock" aria-live="off">{hms(now - +new Date(onThis.started_at))}</div>
          <div className="jm-faint">{t("Started {0}", new Date(onThis.started_at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }))} · {st.me.name}</div>
          {finishing !== null ? (
            <div className="jm-tm-fin">
              <div className="jm-label">{t("How many printed?")}</div>
              <div className="jm-count">
                <button type="button" onClick={() => setFinishing(Math.max(0, finishing - 1))}>−</button>
                <input inputMode="numeric" value={finishing} onChange={(e) => setFinishing(+e.target.value.replace(/\D/g, "") || 0)} aria-label={t("Pieces")} />
                <button type="button" onClick={() => setFinishing(finishing + 1)}>+</button>
              </div>
              <button type="button" className="jm-go" disabled={!!busy} onClick={() => act("finish", { pieces: finishing })}>{t("Finish run · {0} pcs", finishing)}</button>
              <button type="button" className="jm-ghost" onClick={() => setFinishing(null)}>{t("Cancel")}</button>
            </div>
          ) : pausing ? (
            <div className="jm-tm-pause">
              <div className="jm-label">{t("Why are you pausing?")}</div>
              <div className="jm-chips">{PAUSES.map((p) => <button key={p} type="button" className="jm-chip" disabled={!!busy} onClick={() => act("pause", { reason: p })}>{t(p)}</button>)}</div>
              <button type="button" className="jm-ghost" onClick={() => setPausing(false)}>{t("Cancel")}</button>
            </div>
          ) : (
            <div className="jm-tm-btns">
              {cur!.phase === "setup" && <button type="button" className="jm-go" disabled={!!busy} onClick={() => act("run", { location: cur!.loc })}>{t("Setup done · start running")}</button>}
              {cur!.phase === "run" && <button type="button" className="jm-go" disabled={!!busy} onClick={() => setFinishing(qtyOf(cur!.loc))}>{t("Finish run")}</button>}
              <div className="jm-row">
                <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => setPausing(true)}>{t("Pause")}</button>
                {cur!.phase === "setup" && <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => act("finish")}>{t("Stop setup")}</button>}
              </div>
            </div>
          )}
        </div>
      ) : st.paused ? (
        <div className="jm-card jm-tm paused">
          <div className="jm-tm-ph">{t("Paused")}</div>
          <div className="jm-tm-loc">{taskT(st.paused.task)}</div>
          <div className="jm-tm-clock">{hms(now - +new Date(st.paused.ended_at!))}</div>
          <div className="jm-faint">{noteT(st.paused.note)} · {t("since {0}", new Date(st.paused.ended_at!).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }))}</div>
          <button type="button" className="jm-go" disabled={!!busy} onClick={() => act("resume")}>▶ {t("Resume")}</button>
          <button type="button" className="jm-link" onClick={() => setSt({ ...st, paused: null })}>{t("Do something else")}</button>
        </div>
      ) : (
        <div className="jm-card">
          <div className="jm-label">{doneRuns.size ? t("What's next?") : t("What are you working on?")}</div>
          <div className="jm-chips">{[...locs, "Whole job"].map((l) => <button key={l} type="button" className={"jm-chip" + (loc === l ? " on" : "") + (doneRuns.has(l) ? " done" : "")} onClick={() => setLoc(l)}>{doneRuns.has(l) ? "✓ " : ""}{t(l)}</button>)}</div>
          {presses.length > 0 && <><div className="jm-label">{t("Press")}</div><div className="jm-chips">{presses.map((p) => <button key={p.id} type="button" className={"jm-chip" + (press === p.name ? " on" : "")} onClick={() => setPress(p.name)}>{p.name}</button>)}</div></>}
          <button type="button" className="jm-go" disabled={!!busy} onClick={() => act("setup")}>{t("Start setup · {0}", t(loc))}</button>
          <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => act("run")}>{t("Already set up · start running")}</button>
          {doneRuns.size > 0 && !left.length && <button type="button" className="jm-ghost done" disabled={!!busy} onClick={() => act("done")}>✓ {t("Whole job done")}</button>}
        </div>
      )}
      {onThis && cur?.phase === "run" && finishing === null && !pausing && left.filter((l) => l !== cur.loc).length === 0 && (
        <button type="button" className="jm-ghost done" disabled={!!busy} onClick={() => act("done", { pieces: qtyOf(cur.loc) })}>✓ {t("Last run · whole job done")}</button>
      )}
      {err && <div className="jm-err">{err}</div>}

      {st.log.length > 0 && (
        <div className="jm-card">
          <div className="jm-cardh"><b>{t("Today on this job")}</b><span className="jm-faint">{hm(st.log.reduce((a, r) => a + ((r.ended_at ? +new Date(r.ended_at) : now) - +new Date(r.started_at)), 0))}</span></div>
          <ul className="jm-tm-log">{st.log.map((r) => (
            <li key={r.id}><span><b>{taskT(r.task)}</b><small>{r.who}{r.station ? ` · ${r.station}` : ""}{r.note ? ` · ${noteT(r.note)}` : ""}</small></span>
              <span className="jm-tm-t">{new Date(r.started_at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}–{r.ended_at ? new Date(r.ended_at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : t("now")}<b>{hm((r.ended_at ? +new Date(r.ended_at) : now) - +new Date(r.started_at))}{r.pieces != null ? ` · ${r.pieces} ${t("pcs")}` : ""}</b></span></li>
          ))}</ul>
        </div>
      )}
      <label className="jm-check"><input type="checkbox" checked={awake} onChange={(e) => keepAwake(e.target.checked)} /> <span>{t("Keep this screen on while I work")}</span></label>
      <p className="jm-faint" style={{ margin: 0 }}>{t("The timer keeps going if your phone sleeps. Scan the job again (or add this page to your home screen) to get back to it.")}</p>
    </>
  );
}
