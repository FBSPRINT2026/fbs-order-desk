"use client";
import { useEffect } from "react";

/**
 * On a phone, the paper in the approve page's frame (a proof, a quote, an invoice) grows to its full height instead of
 * scrolling inside a box (Nov 2, Nick: "on the phone the proof and invoice are very small and don't fill the screen").
 * The paper page posts its height (app/print/[id] with embed=1); the frame that sent it takes that height. Wider screens
 * keep the frame beside the steps, scrolling on its own.
 */
export default function FrameFit({ narrow = 820 }: { narrow?: number }) {
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || typeof e.data?.fbsFrameH !== "number") return;
      const f = [...document.querySelectorAll("iframe")].find((x) => x.contentWindow === e.source);
      if (!f) return;
      f.style.height = window.innerWidth <= narrow ? `${Math.ceil(e.data.fbsFrameH) + 4}px` : "";
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [narrow]);
  return null;
}
