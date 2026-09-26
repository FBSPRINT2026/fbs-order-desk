"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { designLabel, type Design } from "@/lib/pricing";

/** Does a design match a search ("10004", "D-10004", "fedex", an ink name)? */
export function designMatches(d: Design, q: string) {
  const t = q.trim().toLowerCase().replace(/^d-?/, "");
  if (!t) return true;
  return [String(d.number), d.name, d.file_name, d.inks, d.notes].some((x) => (x || "").toLowerCase().includes(t));
}

/**
 * Pick one of the customer's designs. The list opens on their starred (favorite) logos;
 * typing searches everything on file, so a customer with hundreds of logos stays manageable.
 */
export default function DesignSearch({ designs, urls, value, onPick, onStar, placeholder = "Choose a design…" }: {
  designs: Design[];
  urls: Record<string, string>;
  value?: string;
  onPick: (d: Design | null) => void;
  /** star / unstar a design right from the list */
  onStar?: (d: Design, starred: boolean) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const cur = designs.find((d) => d.id === value);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);
  const starred = useMemo(() => designs.filter((d) => d.starred), [designs]);
  const list = q.trim()
    ? designs.filter((d) => designMatches(d, q)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.number - a.number).slice(0, 40)
    : starred.length ? starred : designs.slice(0, 8);

  return (
    <div className="ds" ref={box}>
      <button type="button" className="ds-field" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(""); }}>
        {cur ? <>{urls[cur.id] ? <img className="ds-th" src={urls[cur.id]} alt="" /> : <span className="ds-th" />}<span className="ds-name">{cur.starred ? "★ " : ""}{designLabel(cur)}</span></>
          : <span className="ds-name faint">{value ? "Design from another customer" : designs.length ? placeholder : "No designs on this customer yet"}</span>}
        <span className="ds-caret">▾</span>
      </button>
      {open && (
        <div className="ds-pop">
          <input type="search" autoFocus placeholder={`Search ${designs.length} design${designs.length === 1 ? "" : "s"} (number, name, ink)`} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && list[0]) { onPick(list[0]); setOpen(false); } }} />
          <div className="ds-sub">{q.trim() ? `${list.length} match${list.length === 1 ? "" : "es"}` : starred.length ? "★ Starred designs · type to search all" : "No starred designs yet · newest shown · type to search all"}</div>
          <div className="ds-list" role="listbox">
            {list.map((d) => (
              <div key={d.id} role="option" aria-selected={d.id === value} className={"ds-item" + (d.id === value ? " on" : "")} onClick={() => { onPick(d); setOpen(false); }}>
                {urls[d.id] ? <img className="ds-th" src={urls[d.id]} alt="" /> : <span className="ds-th" />}
                <span className="ds-name">{designLabel(d)}{d.inks ? <span className="faint"> · {d.inks}</span> : null}</span>
                {onStar && <button type="button" className={"ds-star" + (d.starred ? " on" : "")} title={d.starred ? "Unstar" : "Star as a favorite"} aria-label={d.starred ? "Unstar" : "Star"} onClick={(e) => { e.stopPropagation(); onStar(d, !d.starred); }}>{d.starred ? "★" : "☆"}</button>}
              </div>
            ))}
            {!list.length && <div className="ds-empty faint">{q.trim() ? "No designs match." : "No designs yet."}</div>}
          </div>
          {value && <button type="button" className="btn sm ghost" style={{ margin: 6 }} onClick={() => { onPick(null); setOpen(false); }}>Clear design</button>}
        </div>
      )}
    </div>
  );
}
