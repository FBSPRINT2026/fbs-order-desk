"use client";
import { useMemo, useState } from "react";
import type { OpenJob } from "@/lib/timeclock";

/**
 * Start a job: pick the order (type or scan the number, or tap one of the soonest), what you're doing, the press,
 * and anyone working it with you. Used on the wall clock (dark) and on phones / shop screens (light).
 */
export type StartJob = { job: { kind: "o" | "a"; id: string }; task: string; station: string; team: string[] };

export default function JobPicker({ jobs, tasks, stations, mates, busy, startLabel = "Start Job", onStart, onCancel }: {
  jobs: OpenJob[] | null; tasks: string[]; stations: string[]; mates: { id: string; name: string }[]; busy?: boolean; startLabel?: string;
  onStart: (s: StartJob) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [job, setJob] = useState<OpenJob | null>(null);
  const [task, setTask] = useState(""), [station, setStation] = useState("");
  const [team, setTeam] = useState<string[]>([]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^#/, "");
    const all = jobs || [];
    if (!t) return all.slice(0, 24);
    return all.filter((j) => j.number.startsWith(t) || `${j.customer} ${j.name}`.toLowerCase().includes(t)).slice(0, 24);
  }, [jobs, q]);
  const due = (d: string | null) => (d ? new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

  if (!job) return (
    <div className="jp">
      <div className="jp-h"><b>Which order?</b><button type="button" className="jp-x" onClick={onCancel} aria-label="Cancel">✕</button></div>
      <input className="jp-find" autoFocus inputMode="search" placeholder="Type or scan the order #, or a customer" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && list[0]) setJob(list[0]); }} />
      {jobs === null ? <div className="jp-none">Loading jobs…</div> : (
        <div className="jp-jobs">{list.map((j) => (
          <button key={j.kind + j.id} type="button" className="jp-job" onClick={() => setJob(j)}>
            <b>#{j.number}</b><span className="jp-c">{j.customer || "—"}</span><span className="jp-n">{j.name}</span><small>{[j.qty ? `${j.qty} pcs` : "", due(j.due) ? `due ${due(j.due)}` : ""].filter(Boolean).join(" · ")}</small>
          </button>
        ))}{!list.length && <div className="jp-none">No open order matches “{q}”.</div>}</div>
      )}
    </div>
  );
  return (
    <div className="jp">
      <div className="jp-h"><button type="button" className="jp-back" onClick={() => setJob(null)}>← #{job.number} {job.customer}</button><button type="button" className="jp-x" onClick={onCancel} aria-label="Cancel">✕</button></div>
      <div className="jp-lbl">What are you doing?</div>
      <div className="jp-tiles">{tasks.map((t) => <button key={t} type="button" className={"jp-tile" + (task === t ? " on" : "")} onClick={() => setTask(t)}>{t}</button>)}</div>
      {stations.length > 0 && <>
        <div className="jp-lbl">Where? <span>(optional)</span></div>
        <div className="jp-tiles sm">{stations.map((t) => <button key={t} type="button" className={"jp-tile" + (station === t ? " on" : "")} onClick={() => setStation(station === t ? "" : t)}>{t}</button>)}</div>
      </>}
      {mates.length > 0 && <>
        <div className="jp-lbl">Working with anyone? <span>(they&apos;re clocked onto it too)</span></div>
        <div className="jp-tiles sm">{mates.map((m) => <button key={m.id} type="button" className={"jp-tile" + (team.includes(m.id) ? " on" : "")} onClick={() => setTeam(team.includes(m.id) ? team.filter((x) => x !== m.id) : [...team, m.id])}>{m.name}</button>)}</div>
      </>}
      <button type="button" className="jp-go" disabled={!task || busy} onClick={() => onStart({ job: { kind: job.kind, id: job.id }, task, station, team })}>{busy ? "Starting…" : task ? `${startLabel}: ${task}` : "Pick what you're doing"}</button>
    </div>
  );
}

/** Stopping a job: how many pieces got done (optional), then Stop. */
export function JobStop({ label, busy, onStop, onCancel }: { label: string; busy?: boolean; onStop: (pieces: number | null) => void; onCancel: () => void }) {
  const [p, setP] = useState("");
  const add = (k: string) => setP((x) => (k === "back" ? x.slice(0, -1) : (x + k).slice(0, 5)));
  return (
    <div className="jp">
      <div className="jp-h"><b>Stop {label}</b><button type="button" className="jp-x" onClick={onCancel} aria-label="Cancel">✕</button></div>
      <div className="jp-lbl">How many pieces did you finish? <span>(skip if you don&apos;t know)</span></div>
      <div className="jp-pieces">{p || "—"}</div>
      <div className="jp-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map((k, i) => k ? <button key={i} type="button" onClick={() => add(k)}>{k === "back" ? "⌫" : k}</button> : <span key={i} />)}</div>
      <div className="jp-row"><button type="button" className="jp-skip" disabled={busy} onClick={() => onStop(null)}>Skip</button><button type="button" className="jp-go stop" disabled={busy} onClick={() => onStop(p ? +p : null)}>{busy ? "Stopping…" : p ? `Stop · ${p} pcs` : "Stop Job"}</button></div>
    </div>
  );
}
