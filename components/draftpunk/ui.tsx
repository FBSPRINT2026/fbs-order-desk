"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/** a number box that lets you type freely ("1.", "0.0") and hands back a number */
export function Num({ value, onChange, step, className = "dp-n", digits, disabled, title }: { value: number | undefined; onChange: (n: number) => void; step?: number; className?: string; digits?: number; disabled?: boolean; title?: string }) {
  const show = (v: number | undefined) => (v == null || !Number.isFinite(v) ? "" : digits != null ? String(Math.round(v * 10 ** digits) / 10 ** digits) : String(v));
  const [txt, setTxt] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(show(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return (
    <input className={className} inputMode="decimal" value={txt} disabled={disabled} title={title} step={step}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onBlur={() => { focused.current = false; setTxt(show(value)); }}
      onChange={(e) => { setTxt(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); else if (e.target.value === "") onChange(0); }} />
  );
}

/** a labeled field */
export function F({ label, children, grow }: { label: string; children: React.ReactNode; grow?: string }) {
  return <label className="dp-f" style={grow ? { flex: grow } : undefined}><span>{label}</span>{children}</label>;
}

export function Win({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`dp-win ${className || ""}`}><span className="dp-wt">{title}</span>{children}</section>;
}

/** where a number sits in its style's range: the range shaded, a marker at the value (red when outside) */
export function StyleBar({ v, lo, hi, min, max }: { v: number; lo?: number; hi?: number; min: number; max: number }) {
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  const out = lo != null && hi != null && (v < lo || v > hi);
  return (
    <div className={`dp-bar ${out ? "dp-out" : ""}`}>
      {lo != null && hi != null && <i style={{ left: `${pct(lo)}%`, width: `${Math.max(1, pct(hi) - pct(lo))}%` }} />}
      <u style={{ left: `calc(${pct(v)}% - 2px)` }} />
    </div>
  );
}

export type PickItem = { key: string; name: string; sub?: string; cols?: string[] };
/** the ingredient picker: type to search, Enter takes the first match, or add a custom one by name */
export function Picker({ title, items, head, onPick, onCustom, onClose }: { title: string; items: PickItem[]; head?: string[]; onPick: (key: string) => void; onCustom?: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => words.every((w) => `${i.name} ${i.sub || ""}`.toLowerCase().includes(w))).slice(0, 200);
  }, [items, q]);
  useEffect(() => { const on = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); }, [onClose]);
  return (
    <div className="dp-modal" onClick={onClose}>
      <div className="dp-win" onClick={(e) => e.stopPropagation()}>
        <span className="dp-wt">{title}</span>
        <div className="dp-row">
          <F label="Search" grow="1 1 240px"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) onPick(shown[0].key); }} /></F>
          {onCustom && <button className="dp-btn" onClick={() => onCustom(q.trim() || "Custom")}>Add &quot;{q.trim() || "custom"}&quot;</button>}
          <button className="dp-btn" onClick={onClose}>Esc</button>
        </div>
        <table className="dp-tbl" data-nofit style={{ marginTop: 10 }}>
          {head && <thead><tr><th>Name</th>{head.map((h) => <th key={h} className="dp-num">{h}</th>)}</tr></thead>}
          <tbody>
            {shown.map((i) => (
              <tr key={i.key} className="dp-pick" onClick={() => onPick(i.key)}>
                <td>{i.name}{i.sub && <span className="dp-dim"> · {i.sub}</span>}</td>
                {(i.cols || []).map((c, k) => <td key={k} className="dp-num">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="dp-dim">Nothing matches.{onCustom ? " Add it as a custom ingredient." : ""}</p>}
      </div>
    </div>
  );
}
