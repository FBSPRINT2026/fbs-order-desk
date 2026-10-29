"use client";
import { useMemo } from "react";
import { qrSvg } from "@/lib/qr";

/**
 * THE "take it with your phone" pop-up (lib/phoneSnap.ts): any photo button on a computer opens this. The QR code opens
 * the short link on a phone, the picture is taken there, and `status` turns green when it arrives. "Use a photo on this
 * computer" still picks a file here.
 */
export default function PhoneSnapAsk({ title, sub, path, status, done, error, onFile, onClose }: {
  title: string; sub: string; path: string | null; status: string; done?: boolean; error?: string; onFile: (f: File) => void; onClose: () => void;
}) {
  const url = path && typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : "";
  const qr = useMemo(() => (url ? qrSvg(url, 2).svg : ""), [url]);
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label={title} onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dla psn" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="dla-sub" data-notranslate>{sub}</p>
        <div className="psn-row">
          <div className="psn-qr" aria-label="QR code for your phone">{qr ? <span dangerouslySetInnerHTML={{ __html: qr }} /> : <span className="faint">Making the code…</span>}</div>
          <div className="psn-how">
            <b>Scan with your phone&apos;s camera</b>
            <span>It opens this on your phone. Take the picture, crop it there, and it shows up here.</span>
            <small className="faint">The link works for 30 minutes, for this one only.</small>
          </div>
        </div>
        {error ? <div className="pv-err">{error}</div> : <div className={"psn-st" + (done ? " ok" : "")} role="status">{!done && <span className="psn-dot" aria-hidden />}{status}</div>}
        <div className="dla-acts psn-acts">
          <label className="btn" style={{ cursor: "pointer" }}>
            Use a photo on this computer
            <input type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
          </label>
          <button type="button" className="btn" onClick={onClose}>{done ? "Close" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}
