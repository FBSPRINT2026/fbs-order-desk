"use client";
import { useEffect, useState } from "react";

/**
 * Pictures blown up big on top of the page, without leaving it (Oct 22, Nick on the separations mockups: "click on them
 * and zoom… blows them up big and then doesn't leave the window and just X out"). Arrows (and ← →) step through them;
 * Esc, the ✕ or a click outside closes it.
 */
export default function PicZoom({ pics, at, onClose }: { pics: { url: string; cap?: string }[]; at: number | null; onClose: () => void }) {
  const [i, setI] = useState(at ?? 0);
  useEffect(() => { if (at != null) setI(at); }, [at]);
  const n = pics.length;
  useEffect(() => {
    if (at == null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") setI((x) => (x + 1) % n); else if (e.key === "ArrowLeft") setI((x) => (x - 1 + n) % n); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [at, n, onClose]);
  if (at == null || !n) return null;
  const p = pics[Math.min(i, n - 1)];
  return (
    <div className="mkz" role="dialog" aria-modal="true" aria-label={p.cap || "Picture"} onClick={onClose}>
      <div className="mkz-in pz-in" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pz-x" aria-label="Close" onClick={onClose}>✕</button>
        <div className="mkz-pic">
          {n > 1 && <button type="button" className="mkz-arr l" aria-label="Previous" onClick={() => setI((x) => (x - 1 + n) % n)}>‹</button>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.cap || ""} />
          {n > 1 && <button type="button" className="mkz-arr r" aria-label="Next" onClick={() => setI((x) => (x + 1) % n)}>›</button>}
        </div>
        {(p.cap || n > 1) && <div className="mkz-bar"><span className="pz-cap">{p.cap}</span>{n > 1 && <span className="faint">{Math.min(i, n - 1) + 1} of {n}</span>}</div>}
      </div>
    </div>
  );
}
