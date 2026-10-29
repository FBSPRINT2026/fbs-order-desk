"use client";
import { useState } from "react";
import type { Worksheet } from "@/lib/worksheet";
import { needleThreads } from "@/lib/needleThreads";

/**
 * What the digitizer's worksheet says to sew (Oct 23, Nick on PBF DIGITIZE POLO-2: "tons of colors… it's a sequence…
 * the same color might start and stop several times"): each thread once with its needle, then every stop in order.
 * The thread on each needle is lib/needleThreads.ts's (a worksheet that only names colors gets the order's threads).
 */
export default function SewSequence({ ws, inks = "", open: open0 = false }: { ws: Worksheet; inks?: string; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  const nt = needleThreads(ws, inks);
  const on = (needle: number) => nt.find((t) => t.needle === needle);
  return (
    <div className="sew">
      <div className="sew-h"><b>Sew sequence</b><span className="faint">{ws.threads.length} thread{ws.threads.length === 1 ? "" : "s"} · {ws.stops} stop{ws.stops === 1 ? "" : "s"} · {ws.trims} trims · {ws.stitches.toLocaleString()} stitches</span></div>
      {!ws.real && (nt.some((t) => t.from === "default")
        ? <p className="emb-warn-1">The worksheet only names colors, not threads, and the order doesn&apos;t say a thread for every needle: pick the threads on the order.</p>
        : <p className="faint" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>The worksheet only names colors (the number is the needle), so each needle shows the order&apos;s thread.</p>)}
      <table className="sew-t">
        <thead><tr><th>Needle</th><th>Thread</th><th className="r">Stitches</th><th className="r">Stops</th></tr></thead>
        <tbody>{ws.threads.map((t) => (
          <tr key={t.chart + t.code}><td className="num">{t.needle}</td><td><span className="sw sew-sw" style={{ background: on(t.needle)?.hex }} />{on(t.needle)?.label}{!ws.real && t.name ? <span className="faint"> · worksheet: {t.name}</span> : null}</td><td className="r num">{t.stitches.toLocaleString()}</td><td className="r num">{t.stops}</td></tr>
        ))}</tbody>
      </table>
      {ws.sequence.length > 1 && (
        <>
          <button type="button" className="lc-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"} the {ws.sequence.length} stops in order</button>
          {open && <ol className="sew-seq">{ws.sequence.map((s) => (
            <li key={s.n} title={`${on(s.needle)?.label || ""} · ${s.stitches.toLocaleString()} stitches`}><span className="sw sew-sw" style={{ background: on(s.needle)?.hex }} /><b>{s.needle}</b><small>{s.stitches.toLocaleString()}</small></li>
          ))}</ol>}
        </>
      )}
    </div>
  );
}
