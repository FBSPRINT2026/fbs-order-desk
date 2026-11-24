"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { untilText, type Alarm, type AutoState } from "@/lib/draftpunk/autopilot";
import { fmtDate } from "@/lib/draftpunk/defaults";
import type { Recipe } from "@/lib/draftpunk/types";
import { F, Num, Win } from "./ui";

export type Chamber = { id: string; name: string; device_id: string };

/**
 * The brew log's fermentation autopilot: which chamber the batch is in, the schedule with where it stands, start or
 * pause, the alarms now, and everything autopilot has done. The cron does the work every 15 minutes.
 */
export default function Autopilot({ r, userId, chamberId, auto, alarms, lastCheck, beerTolF, onChange }: {
  r: Recipe; userId: string; chamberId?: string; auto?: AutoState; alarms?: Alarm[]; lastCheck?: string; beerTolF?: number;
  onChange: (patch: { chamberId?: string; autopilot?: AutoState; beerTolF?: number }) => void;
}) {
  const [chambers, setChambers] = useState<Chamber[]>([]);
  useEffect(() => { createClient().from("dp_chambers").select("id, name, device_id").eq("owner_id", userId).order("name").then(({ data }) => setChambers((data || []) as Chamber[])); }, [userId]);
  const ch = chambers.find((c) => c.id === chamberId);
  const on = !!auto?.on;
  const start = () => { const now = new Date().toISOString(); onChange({ autopilot: { on: true, stage: auto?.stage ?? 0, stageStart: auto?.stageStart || now, startedAt: auto?.startedAt || now, events: [{ at: now, text: auto ? "Autopilot resumed" : "Autopilot started" }, ...(auto?.events || [])] } }); };
  const pause = () => onChange({ autopilot: { ...auto!, on: false, events: [{ at: new Date().toISOString(), text: "Autopilot paused" }, ...(auto?.events || [])] } });
  const jump = (i: number) => onChange({ autopilot: { ...(auto || { on: false, startedAt: new Date().toISOString(), events: [] }), stage: i, stageStart: new Date().toISOString(), events: [{ at: new Date().toISOString(), text: `Moved to ${r.ferment[i].name} by hand` }, ...(auto?.events || [])] } as AutoState });
  return (
    <Win title="Fermentation autopilot">
      <div className="dp-row">
        <F label="Chamber">
          <select value={chamberId || ""} onChange={(e) => onChange({ chamberId: e.target.value || undefined })}>
            <option value="">(none)</option>
            {chambers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.device_id ? " · Inkbird linked" : ""}</option>)}
          </select>
        </F>
        <F label="Beer temp alarm ±°F"><Num value={beerTolF ?? 4} onChange={(n) => onChange({ beerTolF: n })} /></F>
        {on ? <button className="dp-btn" onClick={pause}>Pause autopilot</button> : <button className="dp-btn dp-go" onClick={start} disabled={!r.ferment.length}>{auto ? "Resume autopilot" : "Start autopilot"}</button>}
        <span className="dp-dim">{on ? (lastCheck ? `Running · checked ${new Date(lastCheck).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Running · first check within 15 min") : "Off"}</span>
      </div>
      {!chambers.length && <p className="dp-dim">Add your fermentation chambers on the Equipment page (with each Inkbird&apos;s device id to let autopilot set it).</p>}
      {ch && !ch.device_id && <p className="dp-dim">{ch.name} has no Inkbird linked: autopilot will tell you what to set instead of setting it.</p>}
      <ol className="dp-steps" style={{ marginTop: 10 }}>
        {r.ferment.map((s, i) => {
          const cur = (auto?.stage ?? 0) === i, done = (auto?.stage ?? -1) > i;
          return (
            <li key={i} className={done ? "done" : ""}>
              <span aria-hidden>{cur ? "▶" : done ? "✓" : ""}</span>
              <div><span className="dp-phase">{s.tempF}°F</span><b>{s.name}</b> <span className="dp-dim">· moves on {untilText(s)}</span>{cur && auto?.stageStart && <div className="dp-dim">Since {fmtDate(auto.stageStart)}</div>}</div>
              {!cur ? <button className="dp-btn dp-sm" onClick={() => jump(i)}>Go to</button> : <span />}
            </li>
          );
        })}
      </ol>
      {!!alarms?.length && <div style={{ marginTop: 10 }}>{alarms.map((a) => <div key={a.key} className="dp-note">{a.text}</div>)}</div>}
      {!!auto?.events?.length && (
        <details style={{ marginTop: 10 }}>
          <summary className="dp-dim" style={{ cursor: "pointer" }}>What autopilot did ({auto.events.length})</summary>
          <table className="dp-tbl" data-nofit><tbody>{auto.events.slice(0, 40).map((e, i) => <tr key={i}><td className="dp-dim" style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>{e.text}</td></tr>)}</tbody></table>
        </details>
      )}
    </Win>
  );
}
