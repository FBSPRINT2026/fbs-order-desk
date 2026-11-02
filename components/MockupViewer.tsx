"use client";
import { useEffect, useState, type ReactNode } from "react";
import Overlay from "@/components/Overlay";
import { useSticky } from "@/lib/useSticky";
import type { MockupDetail } from "@/lib/mockupDetail";

export type ViewerMockup = { id: string; title: string; url: string; thumb: string; detail?: MockupDetail };

/**
 * A mockup set opened big (Nov 2, Nick: "it's just a picture that pops up… there's four different mockups… more of a
 * dynamic mock-up screen"): the shirts large with Front & back / Front / Back, every garment and color of the set along
 * the bottom (arrows and ← → step through them), and on the side the garment, each print with its size and inks, and
 * the set's actions (Order this, Open the order, Download).
 */
export default function MockupViewer({ set, start = 0, name, sub, actions, onClose }: { set: ViewerMockup[]; start?: number; name: string; sub?: ReactNode; actions?: (m: ViewerMockup) => ReactNode; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, set.length - 1));
  const [side, setSide] = useSticky<"both" | "front" | "back">("mockup.viewerSide", "both");
  // the picture's own shape (width ÷ height), so one side is exactly its half
  const [ratio, setRatio] = useState<Record<string, number>>({});
  const m = set[i], d = m?.detail;
  const go = (n: number) => setI((x) => (x + n + set.length) % set.length);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const label = (x: ViewerMockup) => x.detail ? [x.detail.garment, x.detail.color].filter(Boolean).join(" ") : x.title.split(" — ")[1] || x.title;
  return (
    <Overlay>
      <div className="mk-modal-back mkv-back" onClick={onClose}>
        <div className="mkv" role="dialog" aria-label={name} onClick={(e) => e.stopPropagation()}>
          <div className="mkv-stage">
            <div className="mkv-top">
              <div className="mkv-t"><b data-notranslate>{name}</b>{sub ? <span className="mkv-sub">{sub}</span> : null}</div>
              {/* the picture holds the front on the left and the back on the right: one side is that half, shown big */}
              <div className="mkv-seg" role="tablist" aria-label="Show">
                {(["both", "front", "back"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={side === k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>{k === "both" ? "Front & back" : k === "front" ? "Front" : "Back"}</button>)}
              </div>
              <button type="button" className="mkv-x" aria-label="Close" onClick={onClose}>×</button>
            </div>
            <div className={"mkv-pic s-" + side}>
              {set.length > 1 && <button type="button" className="mkv-arr l" aria-label="Previous" onClick={() => go(-1)}>‹</button>}
              {(() => { const r = ratio[m.id] || 2, half = side !== "both"; return (
                <div className="mkv-crop" style={{ aspectRatio: String(half ? r / 2 : r), width: `min(100%, calc(min(62vh, 640px) * ${half ? r / 2 : r}))` }}>
                  <img src={m.url || m.thumb} alt={m.title} onLoad={(e) => { const t = e.currentTarget; if (t.naturalWidth && t.naturalHeight) setRatio((x) => ({ ...x, [m.id]: t.naturalWidth / t.naturalHeight })); }}
                    style={half ? { width: "200%", marginLeft: side === "back" ? "-100%" : 0 } : undefined} />
                </div>); })()}
              {set.length > 1 && <button type="button" className="mkv-arr r" aria-label="Next" onClick={() => go(1)}>›</button>}
            </div>
            {set.length > 1 && (
              <div className="mkv-strip" role="tablist" aria-label="Garments and colors">
                {set.map((x, k) => (
                  <button key={x.id} type="button" role="tab" aria-selected={k === i} className={"mkv-th" + (k === i ? " on" : "")} onClick={() => setI(k)} title={x.title}>
                    {x.thumb ? <img src={x.thumb} alt="" loading="lazy" /> : null}<span>{label(x)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <aside className="mkv-side">
            <div className="mkv-count">{set.length > 1 ? `${i + 1} of ${set.length}` : "Mockup"}</div>
            {d ? <>
              <div><div className="mkv-cap">Garment</div><div className="mkv-g">{d.garment || label(m)}</div>{d.color && <div className="mkv-sm">{d.color}</div>}</div>
              {d.prints.length > 0 && (
                <div><div className="mkv-cap">Prints</div>
                  {d.prints.map((p, k) => (
                    <div key={k} className="mkv-pr"><b>{p.where}</b>{p.size ? <span className="mkv-sm"> · {p.size}</span> : null}
                      {p.inks.length > 0 && <div className="mkv-inks">{p.inks.map((n, j) => <span key={j}>{n.hex ? <i style={{ background: n.hex }} /> : null}{n.name}</span>)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </> : <div className="mkv-sm">{m.title}</div>}
            <div className="mkv-acts">
              {actions?.(m)}
              <a className="btn" href={m.url} target="_blank" rel="noreferrer" download>Download this one</a>
            </div>
          </aside>
        </div>
      </div>
    </Overlay>
  );
}
