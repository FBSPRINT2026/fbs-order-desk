"use client";
import { useEffect, useRef, useState } from "react";

/**
 * An order's work order in a pop-up over the page, with Print at the top (Nov 11, Nick: "a button next to count in…
 * it just pulls up the work order for that job, and then we can just hit print right from there"). It is the same
 * work order the order page prints (/print/<id>?work=1), shown in a frame; Print prints that frame.
 */
export default function WorkOrderView({ orderId, number, title, onClose }: { orderId: string; number: string | number; title?: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const loaded = () => {
    // the page's own Save PDF / Print / Close bar is replaced by this pop-up's
    try { const d = frame.current?.contentDocument; if (d) { const st = d.createElement("style"); st.textContent = ".print-bar{display:none!important}"; d.head.appendChild(st); } } catch { /* other origin: leave it */ }
    setReady(true);
  };
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } };
  return (
    <div className="wov-bg" onClick={onClose}>
      <div className="wov" role="dialog" aria-label={`Work order #${number}`} onClick={(e) => e.stopPropagation()}>
        <div className="wov-h">
          <b className="wov-t">Work order · <span data-notranslate>#{number}</span></b>
          {title ? <span className="wov-s" data-notranslate>{title}</span> : null}
          <span className="wov-sp" />
          <button type="button" className="btn primary" onClick={print} disabled={!ready}><PrinterIcon />Print</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="wov-b">
          {!ready && <div className="wov-wait faint">Loading the work order…</div>}
          <iframe ref={frame} src={`/print/${orderId}?work=1`} title={`Work order #${number}`} onLoad={loaded} />
        </div>
      </div>
    </div>
  );
}

export function PrinterIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>;
}
