"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { calcRecipe, r1, weatherFactor } from "@/lib/draftpunk/calc";
import { brewSteps } from "@/lib/draftpunk/steps";
import type { Recipe, Weather } from "@/lib/draftpunk/types";
import { F, Num, Win } from "./ui";

const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
/** a short square-wave beep, like the PC speaker */
function beep(times = 3) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
  } catch { /* no sound on this device */ }
}

/** the weather now at the equipment's brewing place, or else at the phone's location (Open-Meteo: free, no key) */
async function fetchWeather(place?: { lat: number; lon: number }): Promise<Weather> {
  const at: { lat: number; lon: number } = place || await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })).then((p) => ({ lat: p.coords.latitude, lon: p.coords.longitude }));
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(3)}&longitude=${at.lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const j = await (await fetch(u)).json();
  return { tempF: Math.round(j.current.temperature_2m), rh: Math.round(j.current.relative_humidity_2m), windMph: Math.round(j.current.wind_speed_10m) };
}

/**
 * Brew day: the weather (it moves the boil-off and so every water amount), the step-by-step sheet with check boxes,
 * a timer for any step with minutes, and a boil timer that beeps at each hop and late addition. Printable.
 */
export default function BrewDay({ r, onStartLog, onWeather }: { r: Recipe; onStartLog: () => void; onWeather?: (w: Weather | undefined) => void }) {
  const steps = useMemo(() => brewSteps(r), [r]);
  const c = useMemo(() => calcRecipe(r), [r]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [timer, setTimer] = useState<{ id: string; title: string; ends: number; total: number; boil: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [wErr, setWErr] = useState("");
  const alerted = useRef<Set<number>>(new Set());
  const boilAdds = steps.filter((s) => s.at != null);

  useEffect(() => { if (!timer) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [timer]);
  const left = timer ? (timer.ends - now) / 1000 : 0;
  // beep when the timer ends, and in the boil at each addition's minute
  useEffect(() => {
    if (!timer) return;
    if (left <= 0 && !alerted.current.has(-1)) { alerted.current.add(-1); beep(5); setDone((d) => ({ ...d, [timer.id]: true })); }
    if (timer.boil) for (const a of boilAdds) if (a.at! < timer.total / 60 && left <= a.at! * 60 && !alerted.current.has(a.at!)) { alerted.current.add(a.at!); beep(3); }
  }, [left, timer, boilAdds]);
  const start = (id: string, title: string, min: number, boil: boolean) => { alerted.current = new Set(); setNow(Date.now()); setTimer({ id, title, ends: Date.now() + min * 60000, total: min * 60, boil }); };
  const nextAdd = timer?.boil ? boilAdds.filter((a) => a.at! * 60 < left).sort((a, b) => b.at! - a.at!)[0] : undefined;
  const w = r.weather;

  return (
    <>
      <Win title="BREW DAY WEATHER" className="dp-noprint">
        <div className="dp-row">
          <F label="AIR °F"><Num value={w?.tempF} onChange={(n) => onWeather?.({ tempF: n, rh: w?.rh ?? 50, windMph: w?.windMph ?? 0 })} /></F>
          <F label="HUMIDITY %"><Num value={w?.rh} onChange={(n) => onWeather?.({ tempF: w?.tempF ?? 70, rh: n, windMph: w?.windMph ?? 0 })} /></F>
          <F label="WIND MPH"><Num value={w?.windMph} onChange={(n) => onWeather?.({ tempF: w?.tempF ?? 70, rh: w?.rh ?? 50, windMph: n })} /></F>
          {onWeather && <button className="dp-btn" onClick={() => { setWErr(""); fetchWeather(r.equipment.place).then(onWeather).catch(() => setWErr("COULDN'T GET THE WEATHER: ALLOW LOCATION, OR TYPE IT IN")); }}>{r.equipment.place ? `WEATHER IN ${r.equipment.place.name.toUpperCase()}` : "GET MY WEATHER"}</button>}
          {onWeather && w && <button className="dp-btn dp-x" onClick={() => onWeather(undefined)}>CLEAR</button>}
        </div>
        <p className="dp-dim">BOIL-OFF {r1(c.boilOffGal, 2)} GAL/HR {w ? `(${weatherFactor(w) >= 1 ? "+" : ""}${r1((weatherFactor(w) - 1) * 100, 0)}% FOR THE WEATHER; CALM 70°F DAY = ${r1(r.equipment.boilOffGal, 2)})` : "(CALM 70°F DAY; ENTER THE WEATHER TO ADJUST)"}</p>
        {wErr && <p className="dp-red">{wErr}</p>}
      </Win>

      {timer && (
        <Win title={timer.boil ? "BOIL TIMER" : "TIMER"} className="dp-noprint">
          <div className="dp-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="dp-clock">{mmss(left)}</div>
              <div>{timer.title}</div>
              {nextAdd && <div className="dp-hi">NEXT: {nextAdd.title.replace(/^With /, "").toUpperCase()} → {nextAdd.detail} (IN {mmss(left - nextAdd.at! * 60)})</div>}
            </div>
            <button className="dp-btn" onClick={() => setTimer(null)}>STOP</button>
          </div>
        </Win>
      )}

      <Win title={`BREW SHEET: ${r.name.toUpperCase()}`}>
        <div className="dp-row dp-dim" style={{ marginBottom: 8 }}>
          <span>{r.equipment.name}</span><span>OG {c.og.toFixed(3)}</span><span>FG {c.fg.toFixed(3)}</span><span>{r1(c.ibu, 0)} IBU</span><span>{r1(c.abv, 1)}% ABV</span><span>{r1(c.intoFermGal, 2)} GAL</span>
        </div>
        <ol className="dp-steps">
          {steps.map((s) => (
            <li key={s.id} className={done[s.id] ? "done" : ""}>
              <input type="checkbox" checked={!!done[s.id]} onChange={(e) => setDone((d) => ({ ...d, [s.id]: e.target.checked }))} />
              <div><span className="dp-phase">{s.phase}</span>{s.title}{s.detail && <div className="dp-dim">{s.detail}</div>}</div>
              {s.min ? <button className="dp-btn dp-sm dp-noprint" onClick={() => start(s.id, s.title, s.min!, s.phase === "boil" && s.at == null)}>{s.min}M</button> : <span />}
            </li>
          ))}
        </ol>
      </Win>
      <p className="dp-row dp-noprint">
        <button className="dp-btn dp-go" onClick={onStartLog}>START A BREW LOG</button>
        <button className="dp-btn" onClick={() => window.print()}>PRINT SHEET</button>
      </p>
    </>
  );
}
