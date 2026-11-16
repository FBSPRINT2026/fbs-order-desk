"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import type { JobTime } from "@/lib/timeclock";
import type { PressOption } from "@/lib/pressActual";
import { useT } from "./lang";
import FinishSide, { type Wrap } from "./FinishSide";

/**
 * The press timer: Start setup → Setup done, start running → Finish run (pieces) → set up the next location, with
 * Pause (lunch, break…) and Resume, and "Whole job done". Every step is a dated job-time entry for the person signed in
 * on this phone. The timer lives on the server, so it's still running when the phone sleeps or the page is closed:
 * scanning the job again (or reopening the page) picks it right back up.
 */
type Row = JobTime & { who: string };
type State = { me: { name: string } | null; /** the shift clock: "in", "break", "out" */ clock?: string | null; /** sides printed on this job, any day */ done?: string[]; running: JobTime | null; paused: JobTime | null; log: Row[] };
// why a job stops: a problem first (Nick, Nov 16 2026: Ana's bad screen mid-setup went down as "Lunch", the old default)
const PAUSES = ["Bad screen · needs a remake", "Waiting on ink", "Waiting on screens", "Press problem", "Garment problem", "Lunch", "Break", "Running another side first", "End of shift", "Something else"];
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
const hm = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const parse = (task: string) => { const [phase, ...rest] = task.split(" · "); return { phase: phase === "Setup" ? "setup" : phase === "Run" ? "run" : "other", loc: rest.join(" · ") || task }; };
const sticky = { get: (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

/** the order a press runs a job's spots in: the front (chest, pocket) first, then the back, then sleeves, then the rest */
const rankOf = (l: string) => /front|chest|pocket|crest/i.test(l) ? 0 : /back|yoke|nape|neck/i.test(l) ? 1 : /sleeve|arm|cuff/i.test(l) ? 2 : 3;

export default function PressTimer({ card, presses, myPress = "", mockups = [] }: { card: JobCard; presses: PressOption[]; /** the press this job is booked on, or this person crews */ myPress?: string; /** each group's mockup pictures, to pick a group by its picture */ mockups?: { name: string; urls: string[]; thumb?: string }[] }) {
  const { t, locale } = useT();
  const job = { kind: card.kind, id: card.id };
  // a job of several groups runs one group at a time (Nick, Nov 16 2026, #40382's five groups: "which group are you
  // running?"): each group's work order page has its own QR (?g=2) that opens on it, else the timer asks. Its sides are
  // "Group 2 · Full Back" on the timer, the job's log and the schedule's card
  const pgs = card.groups.map((g, i) => ({ g, i })).filter(({ g }) => g.prints.some((p) => p.location && !/embroid|dtf|heat|transfer|dtg|sublim/i.test(p.method || "")));
  const multi = pgs.length > 1;
  const gname = (i: number) => card.groups[i]?.name || `Group ${i + 1}`;
  const [gPick, setGPick] = useState<number | null>(() => { if (typeof window === "undefined") return null; const g = +(new URLSearchParams(location.search).get("g") || 0); return g > 0 && g <= card.groups.length ? g - 1 : null; });
  const sideLocs = (gs: typeof card.groups) => [...new Set(gs.flatMap((g) => g.prints.map((p) => p.location).filter(Boolean)))].map((l, i) => ({ l, i })).sort((a, b) => rankOf(a.l) - rankOf(b.l) || a.i - b.i).map((x) => x.l);
  const locsOf = (gi: number | null) => (multi ? (gi == null ? [] : sideLocs([card.groups[gi]]).map((l) => `${gname(gi)} · ${l}`)) : sideLocs(card.groups));
  const locs = locsOf(gPick);
  const qtyOf = (loc: string) => (multi && gPick != null ? card.groups[gPick].rows.reduce((b, r) => b + r.total, 0) : card.groups.filter((g) => g.prints.some((p) => p.location === loc)).reduce((a, g) => a + g.rows.reduce((b, r) => b + r.total, 0), 0)) || card.qty;
  const taskT = (task: string) => { const x = parse(task); return x.phase === "setup" ? t("Setup · {0}", t(x.loc)) : x.phase === "run" ? t("Run · {0}", t(x.loc)) : t(task); };
  const noteT = (n: string) => (/^Paused: /.test(n) ? t("Paused: {0}", t(n.slice(8))) : t(n));
  const [st, setSt] = useState<State | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [locPick, setLoc] = useState(""), [press, setPress] = useState("");
  const [why, setWhy] = useState("");
  const [pausing, setPausing] = useState(false), [finishing, setFinishing] = useState<number | null>(null), [now, setNow] = useState(Date.now());
  const [awake, setAwake] = useState(false);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/timer?kind=${job.kind}&id=${job.id}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    if (!r?.ok) setErr(t(j.error || "Couldn't load.")); else { setErr(""); setSt(j); }
  }, [job.kind, job.id, t]);
  useEffect(() => { setPress(myPress || sticky.get("jm.press") || presses[0]?.name || ""); load(); }, [load, presses, myPress]);
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
  const doneRuns = new Set([...(st.done || []), ...st.log.filter((r) => r.ended_at && parse(r.task).phase === "run").map((r) => parse(r.task).loc)]);
  // the side to set up next, picked for them (Nick, Nov 16 2026: "by default… the front should be the first thing that's
  // already selected"): the first spot not printed yet, front first
  const nextLoc = locs.find((l) => !doneRuns.has(l)) || "";
  const loc = locPick && locs.includes(locPick) && !doneRuns.has(locPick) ? locPick : nextLoc || (locs.length ? locs[0] : "Whole job");
  if (!st.me) return <div className="jm-card"><p>{t("The press timer is for the crew: sign in on this phone with your employee number and PIN.")}</p></div>;
  const run = st.running, onThis = run && (card.kind === "o" ? run.order_id : run.archived_order_id) === card.id ? run : null;
  const cur = onThis ? parse(onThis.task) : null;
  // what's still to print after the side on the press now, across the WHOLE job (Nick, Nov 16 2026, #40382: Ana ran
  // Renegades' Full Front and the timer only offered Complete job, with four groups still to print). The group on the press
  // is read off the side itself ("Renegades · Full Front"), so it holds after a refresh or coming in from the main menu
  const groupOf = (l: string) => (multi ? pgs.find(({ i }) => l.startsWith(gname(i) + " · "))?.i ?? null : null);
  const curG = cur ? groupOf(cur.loc) : null;
  const allLocs = multi ? pgs.flatMap(({ i }) => locsOf(i)) : locs;
  const leftAfter = cur ? allLocs.filter((l) => l !== cur.loc && !doneRuns.has(l)) : [];
  // this group's next side first; none left in it, the next group (asked which, on the start screen)
  const sameNext = cur ? (curG != null ? locsOf(curG) : locs).find((l) => l !== cur.loc && !doneRuns.has(l)) || "" : "";
  const groupsLeft = multi ? pgs.filter(({ i }) => i !== curG && locsOf(i).some((l) => !doneRuns.has(l))).length : 0;
  // a side done: the finish sheet's count and what happened; the last side completes the job
  async function finishSide(pieces: number, wrap: Wrap, last: boolean) {
    const g = curG;
    await act(last ? "done" : "finish", { pieces, wrap });
    if (multi) setGPick(sameNext && g != null ? g : null);
    setLoc("");
  }
  const runQty = (l: string) => (curG != null ? card.groups[curG].rows.reduce((b, r) => b + r.total, 0) || card.qty : qtyOf(l));

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
            <FinishSide card={card} side={cur!.loc} group={curG} pieces0={finishing} last={leftAfter.length === 0} busy={!!busy}
              press={presses.find((p) => p.name === onThis.station || p.name === press)}
              onCancel={() => setFinishing(null)} onSave={(pieces, wrap) => void finishSide(pieces, wrap, leftAfter.length === 0)} />
          ) : pausing ? (
            <div className="jm-tm-pause">
              {/* one drop-down, lunch picked to start with, and one button (Nick, Nov 16 2026: "this should be a drop-down") */}
              <label className="jm-label" htmlFor="jm-why">{t("Why are you pausing?")}</label>
              <select id="jm-why" className="jm-select" value={why} onChange={(e) => setWhy(e.target.value)}><option value="" disabled>{t("Pick why")}</option>{PAUSES.map((p) => <option key={p} value={p}>{t(p)}</option>)}</select>
              <button type="button" className="jm-go" disabled={!!busy || !why} onClick={() => act("pause", { reason: why })}>{t("Pause")}</button>
              <button type="button" className="jm-ghost" onClick={() => setPausing(false)}>{t("Cancel")}</button>
            </div>
          ) : (
            <div className="jm-tm-btns">
              {cur!.phase === "setup" && <button type="button" className="jm-go" disabled={!!busy} onClick={() => act("run", { location: cur!.loc })}>{t("Setup done · start running")}</button>}
              {/* the one button that matters (Nov 13): the job is printed, the schedule moves on */}
              {/* a side done with another still to print: finish it, then the next side's setup is asked (Nick, Nov 16 2026) */}
              {cur!.phase === "run" && leftAfter.length > 0 && <button type="button" className="jm-go ok" disabled={!!busy} onClick={() => setFinishing(runQty(cur!.loc))}>✓ {sameNext
                ? t("{0} done · set up {1}", t(cur!.loc.replace(/^.* · /, "")), t(sameNext.replace(/^.* · /, "")))
                : t("{0} done · next group ({1} left)", curG != null ? gname(curG) : t(cur!.loc), groupsLeft)}</button>}
              {cur!.phase !== "setup" && leftAfter.length === 0 && <button type="button" className="jm-go ok" disabled={!!busy} onClick={() => (cur!.phase === "run" ? setFinishing(runQty(cur!.loc)) : act("done", { pieces: card.qty }))}>✓ {t("Complete job")}</button>}
              <div className="jm-row">
                <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => setPausing(true)}>{t("Pause")}</button>
                {cur!.phase === "setup" && <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => act("finish")}>{t("Stop setup")}</button>}
                {cur!.phase === "run" && leftAfter.length > 0 && <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => { if (confirm(t("Complete #{0}? The whole job is printed.", card.number))) act("done", { pieces: card.qty }); }}>✓ {t("Complete job")}</button>}
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
          {/* the wrong reason picked: change it right here (Nov 16 2026, Ana's bad screen saved as Lunch) */}
          <label className="jm-tm-rewhy"><span>{t("Why it's paused")}</span>
            <select className="jm-select" value={PAUSES.includes(st.paused.note.replace(/^Paused: /, "")) ? st.paused.note.replace(/^Paused: /, "") : ""} onChange={(e) => e.target.value && act("why", { reason: e.target.value })}>
              <option value="" disabled>{t("Pick why")}</option>{PAUSES.map((p) => <option key={p} value={p}>{t(p)}</option>)}</select></label>
          <button type="button" className="jm-link" onClick={() => setSt({ ...st, paused: null })}>{t("Do something else")}</button>
        </div>
      ) : (
        /* one question and one big button (Nick, Nov 16 2026: "hi Miguel, we're working on this press… what are you
           setting up, front first… start setup… are you starting up the next side"): the press is picked for them (where
           the job is booked, else their crew's press) with a small drop-down to change it; the side is picked, front first */
        <div className="jm-card jm-tm-start">
          <div className="jm-tm-hi">{t("Hi, {0}", st.me.name.split(" ")[0])}</div>
          {multi && (gPick == null ? <>
            <div className="jm-label">{doneRuns.size ? t("Which group is next?") : t("Which group are you running?")}</div>
            <div className="jm-tm-groups">{pgs.map(({ g, i }) => { const all = locsOf(i), left = all.filter((l) => !doneRuns.has(l)).length; return (
              <button key={i} type="button" className={"jm-tm-grp" + (!left ? " done" : "")} onClick={() => setGPick(i)}>
                {/* its mockup, to pick it without reading (Nick, Nov 16 2026) */}
                {(() => { const m = mockups.find((x) => x.name === gname(i)) || mockups[i]; const src = m?.thumb || m?.urls[0]; return src ? <img className="jm-tm-gimg" src={src} alt="" /> : <span className="jm-tm-gimg" aria-hidden />; })()}
                <span className="jm-tm-gtx"><b>{!left ? "✓ " : ""}{gname(i)}</b>
                <small>{[...new Set(g.rows.map((r) => [r.style, r.color].filter(Boolean).join(" ")))].slice(0, 2).join(", ")}{g.rows.length > 2 ? "…" : ""} · {t("{0} pcs", g.rows.reduce((a, r) => a + r.total, 0))}</small>
                <small>{sideLocs([g]).map((l) => t(l)).join(" + ")}</small></span>
              </button>); })}</div>
          </> : <div className="jm-tm-gnow"><span>{gname(gPick)}</span><button type="button" className="jm-link" onClick={() => setGPick(null)}>{t("Another group")}</button></div>)}
          {/* not clocked in: ask first (Nick, Nov 16 2026); a phone punch waits for a manager's OK */}
          {st.clock === "out" && <div className="jm-tm-notin"><b>{t("You haven't clocked in today")}</b><span>{t("Clock in now. Your manager OKs punches made on a phone.")}</span>
            <button type="button" className="jm-go warn" disabled={!!busy} onClick={async () => {
              setBusy("in"); setErr("");
              const r = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "punch", kind: "in" }) }).catch(() => null);
              const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
              setBusy("");
              if (!r?.ok) return setErr(t(j.error || "Couldn't save."));
              setSt({ ...st, clock: "in" });
            }}>{busy === "in" ? t("Saving…") : t("Clock in")}</button></div>}
          {presses.length > 0 && <label className="jm-tm-press"><span>{t("Press")}</span>
            <select value={press} onChange={(e) => setPress(e.target.value)} aria-label={t("Press")}>{!presses.some((p) => p.name === press) && <option value="">{t("Pick a press")}</option>}{presses.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>}
          {multi && gPick == null ? null : locs.length > 0 && !nextLoc ? <div className="jm-label">{t("Every side is printed.")}</div> : <>
            <div className="jm-label">{doneRuns.size ? t("Setting up the next side?") : t("What are you setting up?")}</div>
            {locs.length > 1 && <div className="jm-tm-sides" style={{ gridTemplateColumns: `repeat(${Math.min(locs.length, 3)}, minmax(0, 1fr))` }}>{locs.map((l) => <button key={l} type="button" className={"jm-tm-side" + (loc === l ? " on" : "") + (doneRuns.has(l) ? " done" : "")} disabled={doneRuns.has(l)} onClick={() => setLoc(l)}>{doneRuns.has(l) ? "✓ " : ""}{t(multi ? l.replace(/^.* · /, "") : l)}</button>)}</div>}
            <button type="button" className="jm-go" disabled={!!busy || (presses.length > 0 && !press)} onClick={() => { void keepAwake(true); act("setup", { location: loc }); }}>▶ {t("Start setup")}{loc !== "Whole job" ? ` · ${t(multi ? loc.replace(/^.* · /, "") : loc)}` : ""}</button>
            <button type="button" className="jm-link" disabled={!!busy || (presses.length > 0 && !press)} onClick={() => { void keepAwake(true); act("run", { location: loc }); }}>{t("Already set up · start printing")}</button>
            {/* a side or two now, the rest another day: one job, paused with what's printed (Nick, Nov 16 2026) */}
            {doneRuns.size > 0 && <button type="button" className="jm-ghost" disabled={!!busy} onClick={() => { const left = locs.filter((l) => !doneRuns.has(l)); act("later", { done: doneRuns.size / Math.max(1, locs.length), why: t("{0} later", left.map((l) => t(l)).join(", ")) }); }}>{t("{0} later · not now", locs.filter((l) => !doneRuns.has(l)).map((l) => t(l)).join(", "))}</button>}
          </>}
          <button type="button" className="jm-ghost done" disabled={!!busy} onClick={() => { if (confirm(t("Complete #{0}? The whole job is printed.", card.number))) act("done", { pieces: card.qty }); }}>✓ {t("Complete job")}</button>
        </div>
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
      <p className="jm-faint" style={{ margin: 0 }}>{t("The timer keeps going if your phone sleeps. Scan the job again to get back to it.")}</p>
    </>
  );
}
