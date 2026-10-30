"use client";
import { useEffect } from "react";

/**
 * The work order's first page always fits its letter page (Oct 26, Nick: "the work order is spilling off the page…
 * more margin"): when the page's things don't fit, it tightens one step at a time until they do:
 *   f1 the count boxes shorter · f2 the mockups smaller · f3 the notes shorter · f4 long notes only on the next page ·
 *   f5 the mockups smaller again (a few short notes that must stay, like the ship-to, Oct 30 #40284).
 */
const STEPS = ["f1", "f2", "f3", "f4", "f5"];
export default function WoFit() {
  useEffect(() => {
    const fit = () => {
      // two close-ups a page: smaller until both fit (from 60% down to 40%)
      for (const sh of Array.from(document.querySelectorAll<HTMLElement>(".sheet.cu-pair"))) {
        let z = 0.6;
        sh.style.setProperty("--cu", String(z));
        while (sh.scrollHeight > sh.clientHeight + 1 && z > 0.4) { z = Math.round((z - 0.03) * 100) / 100; sh.style.setProperty("--cu", String(z)); }
      }
      for (const sh of Array.from(document.querySelectorAll<HTMLElement>(".sheet.wo-first"))) {
        STEPS.forEach((c) => sh.classList.remove(c));
        for (const c of STEPS) {
          if (sh.scrollHeight <= sh.clientHeight + 1) break;
          if (c === "f4" && !sh.querySelector(".notes.clip")) continue;
          sh.classList.add(c);
        }
      }
    };
    fit();
    const t = [setTimeout(fit, 300), setTimeout(fit, 1500)];
    void document.fonts?.ready.then(fit);
    window.addEventListener("load", fit);
    return () => { t.forEach(clearTimeout); window.removeEventListener("load", fit); };
  }, []);
  return null;
}
