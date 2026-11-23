"use client";
import { useEffect, useState, type RefObject } from "react";

/**
 * Inches over the separation's proof, at the real print size (Nick, Nov 23 2026: "add a ruler to the top so he could have
 * seen that was wrong before he even printed it"): ticks across the top and down the left of the picture, and the ink's
 * own box dashed with its W × H, so a print the wrong size shows before any film is made.
 */
export default function SepRuler({ canvas, printW, resW, resH, box, w, h }: {
  canvas: RefObject<HTMLCanvasElement | null>;
  /** the whole picture's width in inches (the ink's width × how much wider the picture is) */
  printW: number; resW: number; resH: number;
  /** the ink's box in the picture's pixels (null: the ink fills it) */
  box: { x: number; y: number; w: number; h: number } | null;
  /** the print's W and H, inches */
  w: number; h: number;
}) {
  const [r, setR] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const c = canvas.current, p = c?.parentElement; if (!c || !p) return;
    const m = () => { const a = c.getBoundingClientRect(), b = p.getBoundingClientRect(); if (a.width > 0) setR({ l: a.left - b.left, t: a.top - b.top, w: a.width, h: a.height }); };
    m();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(m) : null;
    ro?.observe(c); ro?.observe(p);
    window.addEventListener("resize", m);
    return () => { ro?.disconnect(); window.removeEventListener("resize", m); };
  }, [canvas, resW, resH]);
  if (!r || !printW || !resW || r.w < 60) return null;
  const ppi = r.w / printW, inchesH = (r.h / ppi);
  // a tick every inch (every 2" when they'd crowd), halves when there's room
  const step = ppi < 14 ? 2 : 1, halves = ppi >= 26;
  const ticksX: { x: number; n: number | null; big: boolean }[] = [], ticksY: { y: number; n: number | null; big: boolean }[] = [];
  for (let i = 0; i <= printW + 0.001; i += halves ? 0.5 : step) { const big = Math.abs(i - Math.round(i)) < 0.01 && Math.round(i) % step === 0; ticksX.push({ x: i * ppi, n: big ? Math.round(i) : null, big }); }
  for (let i = 0; i <= inchesH + 0.001; i += halves ? 0.5 : step) { const big = Math.abs(i - Math.round(i)) < 0.01 && Math.round(i) % step === 0; ticksY.push({ y: i * ppi, n: big ? Math.round(i) : null, big }); }
  const k = r.w / resW, bx = box ? { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k } : { x: 0, y: 0, w: r.w, h: r.h };
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, "");
  return (
    <svg className="srl" style={{ left: r.l, top: r.t, width: r.w, height: r.h }} width={r.w} height={r.h} aria-hidden>
      <rect x={0} y={0} width={r.w} height={16} className="srl-band" />
      <rect x={0} y={0} width={16} height={r.h} className="srl-band" />
      {ticksX.map((t, i) => <g key={"x" + i}><line x1={t.x} x2={t.x} y1={0} y2={t.big ? 10 : 5} className="srl-t" />{t.n != null && t.n > 0 && <text x={t.x + 2} y={14} className="srl-n">{t.n}</text>}</g>)}
      {ticksY.map((t, i) => <g key={"y" + i}><line y1={t.y} y2={t.y} x1={0} x2={t.big ? 10 : 5} className="srl-t" />{t.n != null && t.n > 0 && <text y={t.y - 2} x={1} className="srl-n">{t.n}</text>}</g>)}
      <rect x={bx.x + 0.5} y={bx.y + 0.5} width={Math.max(0, bx.w - 1)} height={Math.max(0, bx.h - 1)} className="srl-box" />
      <text x={bx.x + bx.w / 2} y={Math.max(30, bx.y - 6)} className="srl-wh" textAnchor="middle">{fmt(w)}&quot; × {fmt(h)}&quot;</text>
    </svg>
  );
}
