"use client";
import { useEffect, useState, type RefObject } from "react";

/**
 * Inches along the top and left outside the separation's proof, at the real print size, starting where the art starts
 * (Nick, Nov 23 2026: "add a ruler to the top so he could have seen that was wrong before he even printed it… the ruler
 * outside of the proof box… up at the top and on the left side, and it should start where the art starts"). The ink's
 * stretch of each ruler is shaded and ends with its W / H, and a thin dashed box marks the ink on the proof.
 */
export const RULER_PAD = { top: 22, left: 26 };
export default function SepRuler({ canvas, host, printW, resW, box, w, h }: {
  canvas: RefObject<HTMLCanvasElement | null>;
  /** the box around the proof the rulers sit in (its top and left padding hold them) */
  host: RefObject<HTMLDivElement | null>;
  /** the whole picture's width in inches (the ink's width × how much wider the picture is) */
  printW: number; resW: number;
  /** the ink's box in the picture's pixels (null: the ink fills it) */
  box: { x: number; y: number; w: number; h: number } | null;
  /** the print's W and H, inches */
  w: number; h: number;
}) {
  const [g, setG] = useState<{ cl: number; ct: number; cw: number; ch: number; hw: number; hh: number; sl: number; st: number } | null>(null);
  useEffect(() => {
    const c = canvas.current, hs = host.current; if (!c || !hs) return;
    const m = () => {
      const a = c.getBoundingClientRect(), b = hs.getBoundingClientRect(), s = (hs.querySelector(".sep-stage") as HTMLElement | null)?.getBoundingClientRect();
      if (a.width > 0) setG({ cl: a.left - b.left, ct: a.top - b.top, cw: a.width, ch: a.height, hw: b.width, hh: b.height, sl: (s?.left ?? b.left) - b.left, st: (s?.top ?? b.top) - b.top });
    };
    m();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(m) : null;
    ro?.observe(c); ro?.observe(hs);
    window.addEventListener("resize", m); window.addEventListener("scroll", m, true);
    return () => { ro?.disconnect(); window.removeEventListener("resize", m); window.removeEventListener("scroll", m, true); };
  }, [canvas, host, resW]);
  if (!g || !printW || !resW || g.cw < 60) return null;
  const ppi = g.cw / printW, k = g.cw / resW;
  // the ink's box on the screen; 0" is where the art starts
  const bx = box ? { x: g.cl + box.x * k, y: g.ct + box.y * k, w: box.w * k, h: box.h * k } : { x: g.cl, y: g.ct, w: g.cw, h: g.ch };
  const step = ppi < 14 ? 2 : 1, sub = ppi >= 26 ? 0.5 : step;
  const ticks = (len: number) => { const out: { at: number; n: number | null }[] = []; for (let i = 0; i * ppi <= len + 0.5; i = +(i + sub).toFixed(2)) { const whole = Math.abs(i - Math.round(i)) < 0.01 && Math.round(i) % step === 0; out.push({ at: i * ppi, n: whole ? Math.round(i) : null }); } return out; };
  const T = RULER_PAD.top, L = RULER_PAD.left;
  const right = g.hw - bx.x, down = g.hh - bx.y;
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, "");
  return (
    <svg className="srl" width={g.hw} height={g.hh} aria-hidden>
      {/* top ruler, above the proof */}
      <rect x={g.sl} y={0} width={g.hw - g.sl} height={T - 2} className="srl-band" />
      <rect x={bx.x} y={0} width={bx.w} height={T - 2} className="srl-ink" />
      {ticks(right).map((t, i) => <g key={"x" + i}><line x1={bx.x + t.at} x2={bx.x + t.at} y1={T - 2} y2={t.n != null ? T - 12 : T - 7} className="srl-t" />{t.n != null && <text x={bx.x + t.at + 2} y={10} className="srl-n">{t.n}</text>}</g>)}
      <text x={bx.x + bx.w - 3} y={T - 6} textAnchor="end" className="srl-wh">{fmt(w)}&quot;</text>
      {/* left ruler, beside the proof */}
      <rect x={0} y={g.st} width={L - 2} height={g.hh - g.st} className="srl-band" />
      <rect x={0} y={bx.y} width={L - 2} height={bx.h} className="srl-ink" />
      {ticks(down).map((t, i) => <g key={"y" + i}><line y1={bx.y + t.at} y2={bx.y + t.at} x1={L - 2} x2={t.n != null ? L - 12 : L - 7} className="srl-t" />{t.n != null && <text y={bx.y + t.at + 10} x={2} className="srl-n">{t.n}</text>}</g>)}
      <text x={L / 2 - 1} y={bx.y + bx.h - 4} textAnchor="middle" className="srl-wh srl-v" transform={`rotate(-90 ${L / 2 - 1} ${bx.y + bx.h - 4})`}>{fmt(h)}&quot;</text>
      {/* the ink, marked on the proof */}
      <rect x={bx.x + 0.5} y={bx.y + 0.5} width={Math.max(0, bx.w - 1)} height={Math.max(0, bx.h - 1)} className="srl-box" />
    </svg>
  );
}
