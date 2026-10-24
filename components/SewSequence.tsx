"use client";
import { useState } from "react";
import { threads as allThreads } from "@/lib/embroidery";
import { sheetThreadName, type Worksheet } from "@/lib/worksheet";

/**
 * What the digitizer's worksheet says to sew (Oct 23, Nick on PBF DIGITIZE POLO-2: "tons of colors… it's a sequence…
 * the same color might start and stop several times"): each thread once with its needle, then every stop in order.
 */
export const sheetHex = (x: { code: string; chart: string; name?: string }) => {
  if (/^default$/i.test(x.chart)) return /black/i.test(x.name || "") ? "#222" : /white/i.test(x.name || "") ? "#f4f4f4" : "#9aa1ab";
  const line = /isacord/i.test(x.chart) ? "Isacord 40" : /classic|rayon/i.test(x.chart) ? "Classic Rayon 40" : "Polyneon 40";
  return allThreads().find((t) => t.line === line && t.code === x.code)?.hex || "#9aa1ab";
};
const nameOf = (x: { code: string; chart: string; name: string }) => {
  if (x.name || /^default$/i.test(x.chart)) return sheetThreadName(x);
  const line = /isacord/i.test(x.chart) ? "Isacord 40" : /classic|rayon/i.test(x.chart) ? "Classic Rayon 40" : "Polyneon 40";
  const t = allThreads().find((y) => y.line === line && y.code === x.code);
  return sheetThreadName({ ...x, name: t?.name || "" });
};

export default function SewSequence({ ws, open: open0 = false }: { ws: Worksheet; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  return (
    <div className="sew">
      <div className="sew-h"><b>Sew sequence</b><span className="faint">{ws.threads.length} thread{ws.threads.length === 1 ? "" : "s"} · {ws.stops} stop{ws.stops === 1 ? "" : "s"} · {ws.trims} trims · {ws.stitches.toLocaleString()} stitches</span></div>
      {!ws.real && <p className="emb-warn-1">The worksheet uses Wilcom&apos;s default colors, not real threads: pick the threads for each needle.</p>}
      <table className="sew-t">
        <thead><tr><th>Needle</th><th>Thread</th><th className="r">Stitches</th><th className="r">Stops</th></tr></thead>
        <tbody>{ws.threads.map((t) => (
          <tr key={t.chart + t.code}><td className="num">{t.needle}</td><td><span className="sw sew-sw" style={{ background: sheetHex(t) }} />{nameOf(t)}{/classic|rayon/i.test(t.chart) ? <span className="faint"> · Classic Rayon</span> : null}</td><td className="r num">{t.stitches.toLocaleString()}</td><td className="r num">{t.stops}</td></tr>
        ))}</tbody>
      </table>
      {ws.sequence.length > 1 && (
        <>
          <button type="button" className="lc-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"} the {ws.sequence.length} stops in order</button>
          {open && <ol className="sew-seq">{ws.sequence.map((s) => (
            <li key={s.n} title={`${nameOf(s)} · ${s.stitches.toLocaleString()} stitches`}><span className="sw sew-sw" style={{ background: sheetHex(s) }} /><b>{s.needle}</b><small>{s.stitches.toLocaleString()}</small></li>
          ))}</ol>}
        </>
      )}
    </div>
  );
}
