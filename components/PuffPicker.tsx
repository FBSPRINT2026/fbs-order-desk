"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeArt, drawPuff, puffedShapes, puffWidths, shapeAt, type PuffMap, type PuffRow, type PuffSel } from "@/lib/puff";

/**
 * What's puffed on an embroidered logo, and whether it's big enough to puff (Oct 26, Nick: "the cross gets puffed, but
 * not the text"; "hey, this is too small to do 3D Puff"). All of it, or only some parts: thread colors ticked, and any
 * shape clicked on or off on the picture. The puffed part's strokes are checked against the shop's puff limits.
 */
const inch = (v: number) => `${v.toFixed(2).replace(/^0/, "")}"`;
const frac = (v: number) => (Math.abs(v - 0.125) < 0.001 ? '1/8"' : Math.abs(v - 0.25) < 0.001 ? '1/4"' : Math.abs(v - 0.5) < 0.001 ? '1/2"' : inch(v));

export default function PuffPicker({ artUrl, rows, wIn, sel, minIn, maxIn, onChange, onSummary }: {
  artUrl: string; rows: PuffRow[]; wIn: number; sel: PuffSel; minIn: number; maxIn: number;
  onChange: (s: PuffSel) => void;
  /** a line for the work order and the digitizing request, and a warning when it's too small */
  onSummary: (note: string, warn: string) => void;
}) {
  const [map, setMap] = useState<PuffMap | null>(null);
  const rowKey = rows.map((r) => r.key).join("|");
  useEffect(() => {
    if (!artUrl) return;
    let live = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { const m = analyzeArt(img, rows); if (live) setMap(m); };
    img.src = artUrl;
    return () => { live = false; };
  }, [artUrl, rowKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = sel.all !== false && !sel.colors?.length && !sel.on?.length;
  const shapes = useMemo(() => (map ? puffedShapes(map, rows, all ? {} : { ...sel, all: false }) : new Set<number>()), [map, rowKey, JSON.stringify(sel)]); // eslint-disable-line react-hooks/exhaustive-deps
  const widths = useMemo(() => (map ? puffWidths(map, shapes, wIn) : []), [map, shapes, wIn]);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (map && cv.current) drawPuff(map, shapes, cv.current); }, [map, shapes]);

  // the check, each puffed color on its own
  const label = (i: number) => rows[i]?.label || "the logo";
  const thin = widths.filter((x) => x.thin > 0 && x.thin < minIn);
  const wide = widths.filter((x) => x.wide > maxIn);
  const worst = thin.length ? Math.min(...thin.map((x) => x.thin)) : 0;
  const okMsg = widths.length && !thin.length ? `Thick enough to puff: thinnest stroke ${inch(Math.min(...widths.map((x) => x.thin)))} (needs ${frac(minIn)} to ${frac(maxIn)})` : "";
  const warn = [
    ...thin.map((x) => `${label(x.row)}: strokes about ${inch(x.thin)}, too thin to puff (needs ${frac(minIn)})`),
    ...(worst ? [`It would need to be about ${Math.ceil((minIn / worst) * 10) / 10}× bigger (${inch(wIn * (minIn / worst))} wide), or puff only the bold parts.`] : []),
    ...wide.map((x) => `${label(x.row)}: parts about ${inch(x.wide)} wide, more than ${frac(maxIn)}: the digitizer splits them or the puff flattens.`),
  ];
  const note = !map ? "" : all ? "3D puff: all of it" : shapes.size === 0 ? "3D puff: nothing picked yet" : `3D puff: ${[
    ...(sel.colors || []).map((k) => rows.find((r) => r.key === k)?.label).filter(Boolean) as string[],
    ...(sel.on?.length ? [`${sel.on.length} shape${sel.on.length === 1 ? "" : "s"} picked on the logo`] : []),
  ].join(", ")}${sel.off?.length ? ` (not ${sel.off.length} shape${sel.off.length === 1 ? "" : "s"} clicked off)` : ""}; the rest flat. Sew the puff last, with a stop for the foam`;
  const warnText = warn.join(" ");
  useEffect(() => { if (map) onSummary(note, warnText); }, [note, warnText]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!map) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pt: [number, number] = [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000];
    const s = shapeAt(map, pt); if (s < 0) return;
    const sameShape = (p: [number, number]) => shapeAt(map, p) === s;
    // from "All of it": every color on, this shape off
    const base: PuffSel = all ? { all: false, colors: rows.map((x) => x.key), on: [], off: [] } : { all: false, colors: sel.colors || [], on: sel.on || [], off: sel.off || [] };
    let on = (base.on || []).filter((p) => !sameShape(p)), off = (base.off || []).filter((p) => !sameShape(p));
    const byColor = (base.colors || []).includes(rows[map.compCls[s]]?.key || "");
    if (shapes.has(s) && !all) { if (byColor) off = [...off, pt]; }
    else if (all) off = [...off, pt];
    else if (!byColor) on = [...on, pt];
    onChange({ ...base, on, off });
  };
  const toggleColor = (k: string, v: boolean) => {
    const cur = all ? rows.map((x) => x.key) : sel.colors || [];
    onChange({ all: false, colors: v ? [...new Set([...cur, k])] : cur.filter((x) => x !== k), on: all ? [] : sel.on || [], off: all ? [] : sel.off || [] });
  };

  return (
    <div className="puff">
      <div className="puff-h">
        <span className="emb-l">What&apos;s puffed</span>
        <span className="chips">
          <button type="button" className={"chip" + (all ? " on" : "")} onClick={() => onChange({})}>All of it</button>
          <button type="button" className={"chip" + (!all ? " on" : "")} onClick={() => { if (all) onChange({ all: false, colors: [], on: [], off: [] }); }}>Only some parts</button>
        </span>
      </div>
      <div className="puff-b">
        <div className="puff-pic">
          <canvas ref={cv} onClick={click} title="Click a part of the logo to puff it or keep it flat" aria-label="The logo: click a part to puff it or keep it flat" />
          <span className="faint">Raised = puffed. Click a part to switch it.</span>
        </div>
        {rows.length > 1 && (
          <div className="puff-cols">
            {rows.map((r) => {
              const on = all || (sel.colors || []).includes(r.key);
              return (
                <label key={r.key} className="check">
                  <input type="checkbox" checked={on} onChange={(e) => toggleColor(r.key, e.target.checked)} />
                  <i className="puff-sw" style={{ background: r.hexes[0] }} />{r.label}
                </label>
              );
            })}
          </div>
        )}
      </div>
      {okMsg && <p className="puff-ok">✓ {okMsg}</p>}
      {warn.length > 0 && <ul className="emb-warn">{warn.map((w, i) => <li key={i} className="bad">{w}</li>)}</ul>}
    </div>
  );
}
