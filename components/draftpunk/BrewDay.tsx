"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calcRecipe, r1, sgFmt, weatherFactor } from "@/lib/draftpunk/calc";
import { brewSteps, type BrewStep } from "@/lib/draftpunk/steps";
import type { Recipe, Weather } from "@/lib/draftpunk/types";
import { F, Num, Win } from "./ui";
import HopAdjust from "./HopAdjust";
import type { MineItem } from "./RecipeTabs";

/**
 * Brew day (Nick, Nov 24 2026: "brewday layout is important. Steps… timers… easy to use"): built for a phone on the
 * stand by the kettle.
 * - One big card for the step you're on, with its timer and one big button to move on.
 * - Any number of timers at once (a mash rest while the sparge water heats), always in a strip at the top.
 * - The boil timer counts down to every hop and late addition and calls each one out (beep, buzz, a banner to tap).
 * - The whole checklist beside it (under it on a phone); tap any step to jump there.
 * - Where you are, what's done and every running timer survive a refresh or a locked phone (kept on this device).
 * - The screen stays awake while a timer runs.
 */
type Timer = { id: string; title: string; total: number; endsAt: number | null; left: number; boil: boolean };
type Saved = { cur: number; done: Record<string, boolean>; timers: Timer[]; called: Record<string, boolean> };

const mmss = (s: number) => { const t = Math.max(0, Math.ceil(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`; };
const PHASES: [BrewStep["phase"], string][] = [["prep", "Prep"], ["mash", "Mash"], ["boil", "Boil"], ["chill", "Chill"], ["ferment", "Ferment"], ["package", "Package"]];

/** a short square-wave beep, like a kitchen timer, and a buzz on phones */
function alarm(times = 3) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880; g.gain.value = 0.1;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
  } catch { /* no sound here */ }
  try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* no buzz */ }
}
function notify(text: string) {
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("DraftPunk", { body: text }); } catch { /* fine */ }
}

/** the day's weather at the equipment's brewing place, or the phone's location (Open-Meteo: free, no key) */
async function fetchWeather(place?: { lat: number; lon: number }): Promise<Weather> {
  const at: { lat: number; lon: number } = place || await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })).then((p) => ({ lat: p.coords.latitude, lon: p.coords.longitude }));
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(3)}&longitude=${at.lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const j = await (await fetch(u)).json();
  return { tempF: Math.round(j.current.temperature_2m), rh: Math.round(j.current.relative_humidity_2m), windMph: Math.round(j.current.wind_speed_10m) };
}

export default function BrewDay({ r, storeKey, onStartLog, onWeather, set, mine }: { r: Recipe; storeKey?: string; onStartLog: () => void; onWeather?: (w: Weather | undefined) => void; set?: (fn: (x: Recipe) => Recipe) => void; mine?: MineItem[] }) {
  const steps = useMemo(() => brewSteps(r), [r]);
  const c = useMemo(() => calcRecipe(r), [r]);
  const key = `dp:brewday:${storeKey || r.name}`;
  const [s, setS] = useState<Saved>({ cur: 0, done: {}, timers: [], called: {} });
  const [now, setNow] = useState(Date.now());
  const [banner, setBanner] = useState<string[]>([]);
  const [wErr, setWErr] = useState("");
  const [hopFix, setHopFix] = useState(false);
  const loaded = useRef(false);

  // where you were on this device
  useEffect(() => { try { const v = localStorage.getItem(key); if (v) setS(JSON.parse(v)); } catch { /* fresh */ } loaded.current = true; }, [key]);
  useEffect(() => { if (loaded.current) try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* private mode */ } }, [s, key]);
  const running = s.timers.some((t) => t.endsAt);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), running ? 250 : 5000); return () => clearInterval(t); }, [running]);
  // keep the screen on while anything is timing
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [running]);

  const leftOf = useCallback((t: Timer) => (t.endsAt ? (t.endsAt - now) / 1000 : t.left), [now]);
  const boilStep = steps.find((x) => x.phase === "boil" && x.min && x.at == null);
  const adds = useMemo(() => steps.filter((x) => x.at != null).sort((a, b) => b.at! - a.at!), [steps]);
  const boilTimer = s.timers.find((t) => t.boil);
  const boilLeft = boilTimer ? leftOf(boilTimer) : undefined;

  // timers ending, and boil additions coming due
  useEffect(() => {
    const fire: string[] = [];
    const called = { ...s.called };
    for (const t of s.timers) if (t.endsAt && leftOf(t) <= 0 && !called[`end:${t.id}`]) { called[`end:${t.id}`] = true; fire.push(`${t.title}: time's up`); }
    if (boilTimer?.endsAt && boilLeft != null) for (const a of adds) {
      const k = `add:${a.id}`;
      if (a.at! * 60 < boilTimer.total && boilLeft <= a.at! * 60 && !called[k]) { called[k] = true; fire.push(`Add now: ${a.detail}`); }
    }
    if (fire.length) {
      alarm(fire.length > 1 ? 5 : 3); fire.forEach(notify);
      setBanner((b) => [...b, ...fire]);
      setS((x) => ({ ...x, called, timers: x.timers.map((t) => (t.endsAt && (t.endsAt - Date.now()) / 1000 <= 0 ? { ...t, endsAt: null, left: 0 } : t)) }));
    }
  }, [now, s.timers, s.called, boilTimer, boilLeft, adds, leftOf]);

  const startTimer = (st: BrewStep) => {
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* fine */ }
    setS((x) => {
      const have = x.timers.find((t) => t.id === st.id);
      if (have) return { ...x, timers: x.timers.map((t) => (t.id === st.id ? { ...t, endsAt: Date.now() + (t.left > 0 ? t.left : t.total) * 1000 } : t)) };
      return { ...x, timers: [...x.timers, { id: st.id, title: st === boilStep ? "Boil" : st.title.replace(/:.*$/, ""), total: st.min! * 60, endsAt: Date.now() + st.min! * 60000, left: st.min! * 60, boil: st === boilStep }] };
    });
  };
  const pause = (id: string) => setS((x) => ({ ...x, timers: x.timers.map((t) => (t.id === id && t.endsAt ? { ...t, left: (t.endsAt - Date.now()) / 1000, endsAt: null } : t)) }));
  const addMin = (id: string, m: number) => setS((x) => ({ ...x, timers: x.timers.map((t) => (t.id === id ? (t.endsAt ? { ...t, endsAt: t.endsAt + m * 60000 } : { ...t, left: Math.max(0, t.left + m * 60) }) : t)) }));
  const clear = (id: string) => setS((x) => {
    const wasBoil = x.timers.find((t) => t.id === id)?.boil;
    return { ...x, timers: x.timers.filter((t) => t.id !== id), called: Object.fromEntries(Object.entries(x.called).filter(([k]) => k !== `end:${id}` && !(wasBoil && k.startsWith("add:")))) };
  });
  const go = (i: number) => setS((x) => ({ ...x, cur: Math.max(0, Math.min(steps.length - 1, i)) }));
  const doneAndNext = () => setS((x) => ({ ...x, done: { ...x.done, [steps[x.cur].id]: true }, cur: Math.min(steps.length - 1, x.cur + 1) }));
  const toggle = (id: string, v: boolean) => setS((x) => ({ ...x, done: { ...x.done, [id]: v } }));
  const restart = () => { if (confirm("Start brew day over? Timers and checkmarks clear.")) { setS({ cur: 0, done: {}, timers: [], called: {} }); setBanner([]); } };

  const cur = steps[s.cur];
  const curTimer = cur ? s.timers.find((t) => t.id === cur.id) : undefined;
  const doneCount = steps.filter((x) => s.done[x.id]).length;
  const w = r.weather;
  const nextAdd = boilLeft != null && boilTimer ? adds.find((a) => a.at! * 60 < boilLeft && a.at! * 60 < boilTimer.total) : undefined;

  return (
    <div className="dp-bd">
      {/* every running timer, always in view */}
      {!!s.timers.length && (
        <div className="dp-bd-timers dp-noprint" role="timer">
          {s.timers.map((t) => (
            <div key={t.id} className={`dp-bd-chip ${t.endsAt ? "run" : ""} ${leftOf(t) <= 0 ? "end" : ""}`}>
              <span>{t.title}</span><b>{mmss(leftOf(t))}</b>
              {t.endsAt ? <button onClick={() => pause(t.id)} aria-label={`Pause ${t.title}`}>❚❚</button> : leftOf(t) > 0 ? <button onClick={() => startTimer(steps.find((x) => x.id === t.id)!)} aria-label={`Resume ${t.title}`}>▶</button> : null}
              <button onClick={() => clear(t.id)} aria-label={`Clear ${t.title}`}>✕</button>
            </div>
          ))}
        </div>
      )}
      {!!banner.length && (
        <div className="dp-bd-alert dp-noprint" role="alert">
          <div>{banner.map((b, i) => <div key={i}>{b}</div>)}</div>
          <button className="dp-btn dp-go" onClick={() => setBanner([])}>Got it</button>
        </div>
      )}

      {/* first thing on brew day: the hops you actually bought */}
      {set && !!r.hops.length && s.cur <= 1 && !hopFix && (
        <div className="dp-card dp-noprint dp-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div><b>Got your hops?</b> <span className="dp-dim">Snap each package (or type its alpha), or swap a variety, and the amounts adjust.</span></div>
          <button className="dp-btn dp-go" onClick={() => setHopFix(true)}>📷 Adjust or substitute hops</button>
        </div>
      )}
      {set && hopFix && <HopAdjust r={r} set={set} mine={mine} onDone={() => setHopFix(false)} />}

      {/* where the day stands */}
      <div className="dp-bd-phases dp-noprint">
        {PHASES.filter(([p]) => steps.some((x) => x.phase === p)).map(([p, l]) => {
          const of = steps.filter((x) => x.phase === p), d = of.filter((x) => s.done[x.id]).length;
          return <button key={p} className={`${cur?.phase === p ? "on" : ""} ${d === of.length ? "done" : ""}`} onClick={() => go(steps.indexOf(of.find((x) => !s.done[x.id]) || of[0]))}><span>{l}</span><i style={{ width: `${(d / of.length) * 100}%` }} /></button>;
        })}
        <span className="dp-dim" style={{ marginLeft: "auto", fontSize: 13 }}>{doneCount} of {steps.length} done</span>
      </div>

      <div className="dp-bd-grid">
        <div>
          {cur && (
            <section className="dp-card dp-bd-now dp-noprint">
              <div className="dp-bd-step">Step {s.cur + 1} of {steps.length} · {PHASES.find(([p]) => p === cur.phase)?.[1]}</div>
              <h2 className="dp-bd-title">{cur.title}</h2>
              {cur.detail && (cur.detail.includes(" · ") && cur.detail.length > 60
                ? <ul className="dp-bd-detail" style={{ paddingLeft: 20 }}>{cur.detail.split(" · ").map((d) => <li key={d}>{d}</li>)}</ul>
                : <p className="dp-bd-detail">{cur.detail}</p>)}
              {cur.min ? (
                <div className="dp-bd-timer">
                  <div className="dp-clock">{mmss(curTimer ? leftOf(curTimer) : cur.min * 60)}</div>
                  <div className="dp-row" style={{ gap: 8 }}>
                    {curTimer?.endsAt ? <button className="dp-btn dp-big-btn" onClick={() => pause(cur.id)}>Pause</button>
                      : <button className="dp-btn dp-go dp-big-btn" onClick={() => startTimer(cur)}>{curTimer && curTimer.left > 0 && curTimer.left < curTimer.total ? "Resume" : `Start ${cur.min} min`}</button>}
                    {curTimer && <button className="dp-btn" onClick={() => addMin(cur.id, 1)}>+1 min</button>}
                    {curTimer && <button className="dp-btn" onClick={() => addMin(cur.id, 5)}>+5 min</button>}
                  </div>
                </div>
              ) : null}
              {cur === boilStep && !!adds.length && (
                <ol className="dp-bd-adds">
                  {adds.map((a) => {
                    const dueIn = boilLeft != null ? boilLeft - a.at! * 60 : undefined;
                    const passed = dueIn != null && dueIn <= 0;
                    return (
                      <li key={a.id} className={`${passed ? "passed" : ""} ${a === nextAdd ? "next" : ""}`}>
                        <b>{a.at === 0 ? "Flameout" : `${a.at} min`}</b>
                        <span>{a.detail}</span>
                        <em>{dueIn == null ? "" : passed ? "added" : `in ${mmss(dueIn)}`}</em>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="dp-row" style={{ marginTop: 16, gap: 8 }}>
                <button className="dp-btn" onClick={() => go(s.cur - 1)} disabled={s.cur === 0}>← Back</button>
                <button className="dp-btn dp-go dp-big-btn" style={{ flex: 1 }} onClick={doneAndNext}>{s.cur === steps.length - 1 ? "Done" : "Done, next step →"}</button>
              </div>
              {steps[s.cur + 1] && <p className="dp-dim" style={{ margin: "12px 0 0" }}>Up next: {steps[s.cur + 1].title}</p>}
            </section>
          )}

          <Win title="Brew day weather" className="dp-noprint" note={`boil-off ${r1(c.boilOffGal, 2)} gal/hr${w ? ` (${weatherFactor(w) >= 1 ? "+" : ""}${r1((weatherFactor(w) - 1) * 100, 0)}% for the weather)` : ""}`}>
            <div className="dp-row">
              <F label="Air °F"><Num value={w?.tempF} onChange={(n) => onWeather?.({ tempF: n, rh: w?.rh ?? 50, windMph: w?.windMph ?? 0 })} /></F>
              <F label="Humidity %"><Num value={w?.rh} onChange={(n) => onWeather?.({ tempF: w?.tempF ?? 70, rh: n, windMph: w?.windMph ?? 0 })} /></F>
              <F label="Wind mph"><Num value={w?.windMph} onChange={(n) => onWeather?.({ tempF: w?.tempF ?? 70, rh: w?.rh ?? 50, windMph: n })} /></F>
              {onWeather && <button className="dp-btn" onClick={() => { setWErr(""); fetchWeather(r.equipment.place).then(onWeather).catch(() => setWErr("Couldn't get the weather. Allow location, or type it in.")); }}>{r.equipment.place ? `Weather in ${r.equipment.place.name}` : "Get my weather"}</button>}
            </div>
            <p className="dp-dim" style={{ marginBottom: 0 }}>The water amounts in the steps already allow for it. Calm 70°F day: {r1(r.equipment.boilOffGal, 2)} gal/hr.</p>
            {wErr && <p className="dp-red">{wErr}</p>}
          </Win>
        </div>

        <Win title={`Brew sheet: ${r.name}`} note={`OG ${sgFmt(c.og)} · FG ${sgFmt(c.fg)} · ${r1(c.ibu, 0)} IBU · ${r1(c.abv, 1)}% · ${r1(c.intoFermGal, 2)} gal`}>
          <ol className="dp-steps dp-bd-list">
            {steps.map((st, i) => (
              <li key={st.id} className={`${s.done[st.id] ? "done" : ""} ${i === s.cur ? "cur" : ""}`}>
                <input type="checkbox" aria-label={`Done: ${st.title}`} checked={!!s.done[st.id]} onChange={(e) => toggle(st.id, e.target.checked)} />
                <div onClick={() => go(i)} style={{ cursor: "pointer" }}><span className="dp-phase">{st.phase}</span>{st.title}{st.detail && <div className="dp-dim" style={{ fontSize: 13 }}>{st.detail}</div>}</div>
                {st.min ? <button className="dp-btn dp-sm dp-noprint" onClick={() => { go(i); startTimer(st); }}>{st.min}m</button> : <span />}
              </li>
            ))}
          </ol>
          <div className="dp-row dp-noprint" style={{ marginTop: 14 }}>
            <button className="dp-btn dp-go" onClick={onStartLog}>Start a brew log</button>
            <button className="dp-btn" onClick={() => window.print()}>Print sheet</button>
            <button className="dp-btn dp-x" onClick={restart}>Start over</button>
          </div>
        </Win>
      </div>
    </div>
  );
}
