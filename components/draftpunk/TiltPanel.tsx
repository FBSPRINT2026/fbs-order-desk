"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { abvOf, r1, sgFmt, spundPlan } from "@/lib/draftpunk/calc";
import { tiltUrl } from "@/app/draftpunk/actions";
import type { Recipe } from "@/lib/draftpunk/types";
import { F, Win } from "./ui";

export const TILT_COLORS = ["RED", "GREEN", "BLACK", "PURPLE", "ORANGE", "BLUE", "YELLOW", "PINK"];
type Reading = { sg: number; temp_f: number | null; read_at: string };

/** an amber line chart of gravity (and temperature, dimmer) over time */
function Chart({ rows, capSg, fg }: { rows: Reading[]; capSg?: number; fg: number }) {
  const W = 640, H = 200, P = 34;
  if (rows.length < 2) return null;
  const t0 = new Date(rows[0].read_at).getTime(), t1 = new Date(rows[rows.length - 1].read_at).getTime() || t0 + 1;
  const sgs = rows.map((r) => r.sg), lo = Math.min(...sgs, fg) - 0.002, hi = Math.max(...sgs) + 0.002;
  const temps = rows.map((r) => r.temp_f ?? NaN).filter(Number.isFinite), tlo = Math.min(...temps) - 2, thi = Math.max(...temps) + 2;
  const x = (t: string) => P + ((new Date(t).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - P * 2);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - P * 2);
  const yt = (v: number) => H - P - ((v - tlo) / Math.max(thi - tlo, 1)) * (H - P * 2);
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Gravity and temperature over time">
      <rect x={P} y={P} width={W - P * 2} height={H - P * 2} fill="none" stroke="var(--dp-faint)" />
      <line x1={P} x2={W - P} y1={y(fg)} y2={y(fg)} stroke="var(--dp-dim)" strokeDasharray="4 4" />
      <text x={W - P + 2} y={y(fg) + 4} fill="var(--dp-dim)" fontSize="12">FG</text>
      {capSg && <><line x1={P} x2={W - P} y1={y(capSg)} y2={y(capSg)} stroke="var(--dp-red)" strokeDasharray="2 4" /><text x={W - P + 2} y={y(capSg) + 4} fill="var(--dp-red)" fontSize="12">SPUND</text></>}
      {temps.length > 1 && <path d={line(rows.filter((r) => r.temp_f != null).map((r) => [x(r.read_at), yt(r.temp_f!)]))} fill="none" stroke="var(--dp-dim)" strokeWidth="1.5" />}
      <path d={line(rows.map((r) => [x(r.read_at), y(r.sg)]))} fill="none" stroke="var(--dp-amb)" strokeWidth="2.5" style={{ filter: "drop-shadow(0 0 3px var(--dp-amb))" }} />
      <text x={4} y={y(hi - 0.002) + 4} fill="var(--dp-amb)" fontSize="12">{sgFmt(hi - 0.002)}</text>
      <text x={4} y={y(lo + 0.002) + 4} fill="var(--dp-amb)" fontSize="12">{sgFmt(lo + 0.002)}</text>
    </svg>
  );
}

/** the brew log's Tilt: pick its color, see the readings, and get told when to put the spunding valve on */
export default function TiltPanel({ brewId, r, og, color, onColor }: { brewId: string; r: Recipe; og?: number; color?: string; onColor: (c: string) => void }) {
  const [rows, setRows] = useState<Reading[]>([]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const load = () => createClient().from("dp_readings").select("sg, temp_f, read_at").eq("brew_id", brewId).order("read_at").limit(5000).then(({ data }) => setRows((data || []) as Reading[]));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [brewId]);
  const fg = 1 + ((og || 1.05) - 1) * (1 - 0.76);
  const warm = Math.max(...r.ferment.map((s) => s.tempF), 60);
  const sp = r.carb.method === "spund" ? spundPlan(fg, r.carb.vols, warm, r.carb.spundPts) : undefined;
  const last = rows[rows.length - 1];
  const start = og || rows[0]?.sg;
  const att = last && start ? ((start - last.sg) / (start - 1)) * 100 : 0;
  // flat for a day: fermentation is probably done
  const dayAgo = last ? rows.filter((x) => new Date(last.read_at).getTime() - new Date(x.read_at).getTime() >= 86400000).pop() : undefined;
  const flat = last && dayAgo && Math.abs(dayAgo.sg - last.sg) <= 0.001;
  return (
    <Win title="TILT">
      <div className="dp-row">
        <F label="TILT COLOR">
          <select value={color || ""} onChange={(e) => onColor(e.target.value)}>
            <option value="">(none)</option>{TILT_COLORS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </F>
        {last && <span className="dp-v" style={{ fontSize: 26 }}>{sgFmt(last.sg)} · {last.temp_f != null ? `${r1(last.temp_f, 1)}°F` : ""}</span>}
        {last && start && <span>{r1(att, 0)}% ATTEN · {r1(abvOf(start, last.sg), 1)}% ABV SO FAR</span>}
      </div>
      {sp && last && last.sg <= sp.capSg + 0.0005 && last.sg > fg - 0.002 && <p className="dp-red dp-blink" style={{ fontSize: 26 }}>SET THE SPUNDING VALVE NOW: {r1(sp.psi, 1)} PSI</p>}
      {sp && <p className="dp-dim">SPUND AT {sgFmt(sp.capSg)} · EXPECTED FG ABOUT {sgFmt(fg)}</p>}
      {flat && <p className="dp-grn">NO CHANGE IN 24 HOURS: FERMENTATION LOOKS DONE.</p>}
      <Chart rows={rows} capSg={sp?.capSg} fg={fg} />
      {!rows.length && <p className="dp-dim">NO READINGS YET.</p>}
      <details style={{ marginTop: 8 }}>
        <summary className="dp-dim" style={{ cursor: "pointer" }}>HOOK UP YOUR TILT</summary>
        <p>IN THE TILT APP (OR TILTPI): LOGGING → CLOUD URL, PASTE YOUR ADDRESS, AND SET THE INTERVAL (15 MIN IS PLENTY). THEN PICK THIS BREW&apos;S TILT COLOR ABOVE.</p>
        {url ? <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /> : <button className="dp-btn" onClick={() => tiltUrl().then(setUrl)}>SHOW MY TILT ADDRESS</button>}
        <p className="dp-dim">KEEP IT PRIVATE: ANYONE WITH IT CAN SEND READINGS TO YOUR LOGS.</p>
      </details>
    </Win>
  );
}
