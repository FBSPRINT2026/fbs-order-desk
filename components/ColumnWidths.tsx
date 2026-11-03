"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSticky } from "@/lib/useSticky";

/**
 * Columns you can widen, like the ClickUp Jobs list (Oct 22, Nick: drag a column's edge, double-click to fit it): drag an
 * edge and that column grows while the next one gives; double-click fits the column to what's in it. One column (the job)
 * takes what's left and always keeps its minimum; when the others don't leave it that, they all shrink together. Widths
 * stay for this person (useSticky). The Job Center's Requests list uses it (Nov 2, Nick: "make them kind of look the same…
 * it has the ability to move the stuff over"); the same classes and handle as the ClickUp list (.cu-rsz).
 */
export function useColumnWidths(store: string, defaults: Record<string, number>, flexKey: string, opts: { flexMin?: number; minW?: number } = {}) {
  const flexMin = opts.flexMin ?? 220, minW = opts.minW ?? 44;
  const [cw, setCw] = useSticky<Record<string, number>>(store, {});
  const [fitK, setFitK] = useState(1);
  const fitKRef = useRef(1); fitKRef.current = fitK;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const isFlex = (k?: string | null) => k === flexKey;
  const want = (k: string) => (isFlex(k) ? 0 : cw[k] || defaults[k] || 0);
  const save = (ws: Record<string, number>) => setCw((m) => { const n = { ...m }; for (const [k, v] of Object.entries(ws)) if (!isFlex(k)) n[k] = Math.round(v / (fitKRef.current || 1)); return n; });
  useEffect(() => {
    const fit = () => {
      const t = tableRef.current; if (!t || !t.parentElement) return;
      let sum = 0, fixed = 0;
      for (const th of t.querySelectorAll<HTMLElement>("thead th")) { if (isFlex(th.dataset.col)) continue; const w = +(th.dataset.w || 0); if (w) sum += w; else fixed += parseFloat(getComputedStyle(th).width) || 0; }
      const k = sum > 0 ? Math.max(0.3, Math.min(1, (t.parentElement.clientWidth - fixed - flexMin) / sum)) : 1;
      setFitK((k0) => (Math.abs(k0 - k) > 0.01 ? k : k0));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
  const th = (key: string, label: ReactNode, props: { className?: string; ariaSort?: "ascending" | "descending" | "none" } = {}, sizable = true) => {
    const w = want(key);
    return (
      <th key={key} className={props.className} aria-sort={props.ariaSort} data-col={key} data-w={w || undefined} style={w ? { width: Math.max(minW, Math.round(w * fitK)), position: "relative" } : { position: "relative" }}>{label}
        {sizable && <span className="cu-rsz" title="Drag to move this edge · double-click to fit the column to what's in it" aria-hidden
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            const th = e.currentTarget.parentElement as HTMLElement, table = th.closest("table");
            if (!table || isFlex(key)) return;
            const flex = th.parentElement?.querySelector<HTMLElement>(`th[data-col='${flexKey}']`);
            const w0 = th.getBoundingClientRect().width, flexW = flex ? flex.getBoundingClientRect().width : 9999;
            table.classList.add("cu-measure");
            const natural = th.getBoundingClientRect().width;
            table.classList.remove("cu-measure");
            const nw = Math.round(Math.max(56, Math.min(520, natural + 4, w0 + Math.max(0, flexW - flexMin))));
            th.style.width = `${nw}px`; save({ [key]: nw });
          }}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation();
            const th = e.currentTarget.parentElement as HTMLElement, next = th.nextElementSibling as HTMLElement | null;
            if (!next) return;
            const k1 = th.dataset.col, k2 = next.dataset.col || "";
            const x0 = e.clientX, w1 = th.getBoundingClientRect().width, w2 = next.getBoundingClientRect().width;
            const lo = -(w1 - (isFlex(k1) ? flexMin : minW)), hi = w2 - (isFlex(k2) ? flexMin : minW);
            let d = 0;
            const move = (ev: PointerEvent) => {
              d = Math.round(Math.min(hi, Math.max(lo, ev.clientX - x0)));
              if (!isFlex(k1)) th.style.width = `${w1 + d}px`;
              if (!isFlex(k2)) next.style.width = `${w2 - d}px`;
            };
            const up = () => {
              window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("cu-resizing");
              if (d) save({ ...(k1 ? { [k1]: w1 + d } : {}), ...(k2 && k2 !== "act" ? { [k2]: w2 - d } : {}) });
            };
            document.body.classList.add("cu-resizing");
            window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
          }} />}
      </th>
    );
  };
  return { th, tableRef };
}
