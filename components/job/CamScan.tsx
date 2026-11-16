"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The phone's camera reading a work order's or box label's QR / barcode, inside the page: the built-in reader when the
 * phone has one (Android), else a small reader library (iPhone). Gives back the text read (a /j/<number> link, or a
 * barcode's number). Used by the crew menu's Find (Nov 13) and the employee app.
 */
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; ZXingBrowser?: { BrowserMultiFormatReader: new (hints?: unknown, options?: { delayBetweenScanAttempts?: number; delayBetweenScanSuccess?: number }) => { decodeFromStream: (s: MediaStream, v: HTMLVideoElement, cb: (r: { getText: () => string } | undefined) => void) => Promise<{ stop: () => void }> } } } }

const ZX = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
let zxLoad: Promise<void> | null = null;
/** the reader for phones without a built-in one (iPhones), loaded once and early (Nick, Nov 16 2026: "the QR code scanner
 * is really slow"): the menu calls it on open, so Scan a job starts reading at once */
export function preloadScanner() {
  if (typeof window === "undefined" || window.BarcodeDetector || window.ZXingBrowser) return Promise.resolve();
  zxLoad ||= new Promise<void>((res, rej) => { const sc = document.createElement("script"); sc.src = ZX; sc.async = true; sc.onload = () => res(); sc.onerror = () => { zxLoad = null; rej(new Error("load")); }; document.head.appendChild(sc); });
  return zxLoad;
}

export default function CamScan({ onCode, aim, noCam, look }: { onCode: (s: string) => void; aim: string; noCam: string; /** another page's look for the frame (the time app): [box, aim mark, error] classes */ look?: [string, string, string] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camErr, setCamErr] = useState(false);
  // the latest handler, so typing elsewhere on the page never restarts the camera
  const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, controls: { stop: () => void } | null = null, raf = 0;
    const found = (s: string) => { if (stop) return; stop = true; if (navigator.vibrate) navigator.vibrate(80); cb.current(s); };
    (async () => {
      try {
        // a sharper picture with the camera focusing by itself reads a small code from farther away
        const load = preloadScanner().catch(() => {});
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        try { const tr = stream.getVideoTracks()[0]; const caps = (tr.getCapabilities?.() || {}) as { focusMode?: string[] }; if (caps.focusMode?.includes("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch { /* not every camera lets us */ }
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play().catch(() => {});
        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13", "upc_a"] });
          const loop = async () => { if (stop || !video.current) return; try { const c = await det.detect(video.current); if (c[0]?.rawValue) return found(c[0].rawValue); } catch { /* keep trying */ } raf = requestAnimationFrame(loop); };
          loop();
        } else {
          await load; await preloadScanner();
          if (!window.ZXingBrowser || !video.current || !stream) throw new Error("no reader");
          // try every tenth of a second, not every half second (the reader's own default)
          controls = await new window.ZXingBrowser.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 100 }).decodeFromStream(stream, video.current, (r) => { if (r) found(r.getText()); });
        }
      } catch { setCamErr(true); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); controls?.stop(); stream?.getTracks().forEach((x) => x.stop()); };
  }, []);
  return !camErr ? <div className={look?.[0] || "cr-cam"}><video ref={video} playsInline muted /><i className={look?.[1] || undefined} /><span>{aim}</span></div> : <div className={look?.[2] || "jm-err"}>{noCam}</div>;
}
