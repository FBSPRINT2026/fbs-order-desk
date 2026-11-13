"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/job/lang";

/**
 * A picture full screen on a phone, zoomed with two fingers (Nick, Nov 13 2026: "very easy to zoom in and out, like with
 * your fingers, just pinch and go"): pinch to zoom around the fingers, drag to move around once zoomed, double-tap to zoom
 * in or back out, swipe between pictures when there are several, X to close. Works with a mouse too (wheel zooms).
 */
export default function PinchView({ urls, start = 0, titles = [], onClose }: { urls: string[]; start?: number; titles?: string[]; onClose: () => void }) {
  const { t } = useT();
  const [i, setI] = useState(start);
  const [v, setV] = useState({ s: 1, x: 0, y: 0 });
  const vRef = useRef(v); vRef.current = v;
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number; mx: number; my: number; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const reset = () => setV({ s: 1, x: 0, y: 0 });
  useEffect(() => { reset(); }, [i]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((n) => Math.min(urls.length - 1, n + 1)); if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1)); };
    addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [onClose, urls.length]);

  const clampS = (s: number) => Math.max(1, Math.min(6, s));
  // zoom to scale s keeping the point (cx, cy) (relative to the box's center) where it is
  const zoomAt = (s: number, cx: number, cy: number, from = vRef.current) => {
    const ns = clampS(s), k = ns / from.s;
    setV(ns === 1 ? { s: 1, x: 0, y: 0 } : { s: ns, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k });
  };
  const center = (x: number, y: number) => { const r = box.current!.getBoundingClientRect(); return { cx: x - r.left - r.width / 2, cy: y - r.top - r.height / 2 }; };

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()], m = center((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vRef.current.s, mx: m.cx, my: m.cy, x: vRef.current.x, y: vRef.current.y };
      drag.current = null;
    } else if (pts.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, vx: vRef.current.x, vy: vRef.current.y, t: Date.now() };
    }
  }
  function move(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()], p = pinch.current;
      const s = clampS((p.s * Math.hypot(a.x - b.x, a.y - b.y)) / (p.d || 1)), m = center((a.x + b.x) / 2, (a.y + b.y) / 2), k = s / p.s;
      setV(s === 1 ? { s: 1, x: 0, y: 0 } : { s, x: m.cx - (p.mx - p.x) * k, y: m.cy - (p.my - p.y) * k });
    } else if (drag.current && vRef.current.s > 1) {
      const d = drag.current;
      setV({ ...vRef.current, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y });
    }
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (d && pts.current.size === 0) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y, quick = Date.now() - d.t < 300;
      // a swipe at normal size changes the picture
      if (vRef.current.s === 1 && quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) setI((n) => Math.max(0, Math.min(urls.length - 1, n + (dx < 0 ? 1 : -1))));
      // a double tap zooms in to 2.5x where tapped, or back out
      else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        const now = Date.now();
        if (now - lastTap.current < 300) { const c = center(e.clientX, e.clientY); if (vRef.current.s > 1) reset(); else zoomAt(2.5, c.cx, c.cy, { s: 1, x: 0, y: 0 }); lastTap.current = 0; }
        else lastTap.current = now;
      }
      drag.current = null;
    }
  }
  function wheel(e: React.WheelEvent) { const c = center(e.clientX, e.clientY); zoomAt(vRef.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), c.cx, c.cy); }

  return (
    <div className="pzv" role="dialog" aria-modal="true" aria-label="Picture">
      <div className="pzv-top">
        <span className="pzv-t">{titles[i] || ""}{urls.length > 1 ? ` · ${t("{0} of {1}", i + 1, urls.length)}` : ""}</span>
        {v.s > 1 && <button type="button" className="pzv-b" onClick={reset}>{t("Fit")}</button>}
        <button type="button" className="pzv-b pzv-x" onClick={onClose} aria-label={t("Close")}>✕</button>
      </div>
      <div ref={box} className="pzv-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <img src={urls[i]} alt={titles[i] || ""} draggable={false} style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }} />
      </div>
      {urls.length > 1 && <div className="pzv-dots">{urls.map((_, k) => <button key={k} type="button" className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Picture ${k + 1}`} />)}</div>}
      <div className="pzv-hint">{t("Pinch to zoom · double-tap · drag to move")}</div>
    </div>
  );
}
