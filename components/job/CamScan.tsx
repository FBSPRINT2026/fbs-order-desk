"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The phone's camera reading a work order's or box label's QR / barcode, inside the page: the built-in reader when the
 * phone has one (Android), else a small reader library (iPhone). Gives back the text read (a /j/<number> link, or a
 * barcode's number). Used by the crew menu's Find (Nov 13) and the employee app.
 */
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; ZXingBrowser?: { BrowserMultiFormatReader: new () => { decodeFromStream: (s: MediaStream, v: HTMLVideoElement, cb: (r: { getText: () => string } | undefined) => void) => Promise<{ stop: () => void }> } } } }

export default function CamScan({ onCode, aim, noCam }: { onCode: (s: string) => void; aim: string; noCam: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camErr, setCamErr] = useState(false);
  // the latest handler, so typing elsewhere on the page never restarts the camera
  const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, controls: { stop: () => void } | null = null, raf = 0;
    const found = (s: string) => { if (stop) return; stop = true; if (navigator.vibrate) navigator.vibrate(80); cb.current(s); };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play().catch(() => {});
        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13", "upc_a"] });
          const loop = async () => { if (stop || !video.current) return; try { const c = await det.detect(video.current); if (c[0]?.rawValue) return found(c[0].rawValue); } catch { /* keep trying */ } raf = requestAnimationFrame(loop); };
          loop();
        } else {
          await new Promise<void>((res, rej) => { if (window.ZXingBrowser) return res(); const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js"; sc.onload = () => res(); sc.onerror = () => rej(new Error("load")); document.head.appendChild(sc); });
          if (!window.ZXingBrowser || !video.current || !stream) throw new Error("no reader");
          controls = await new window.ZXingBrowser.BrowserMultiFormatReader().decodeFromStream(stream, video.current, (r) => { if (r) found(r.getText()); });
        }
      } catch { setCamErr(true); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); controls?.stop(); stream?.getTracks().forEach((x) => x.stop()); };
  }, []);
  return !camErr ? <div className="cr-cam"><video ref={video} playsInline muted /><i /><span>{aim}</span></div> : <div className="jm-err">{noCam}</div>;
}
