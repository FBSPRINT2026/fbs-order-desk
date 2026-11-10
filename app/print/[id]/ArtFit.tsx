"use client";
import { useEffect } from "react";

/**
 * The art on a proof's print page always shows whole (Nov 10, Amanda, #40407: the starburst ran off the bottom of its
 * panel). The page stacks its parts in a column, so when a lot sits under the art (a thread change's A / B versions and
 * their garments) the panel is squeezed shorter than it was drawn for, while the art, its measurements and its print
 * area keep their size. Each panel says how tall its drawing is (data-need, inches); when the panel ends up shorter, the
 * drawing is scaled down from the top center to fit, so the art and its measurements stay together and readable.
 */
export default function ArtFit() {
  useEffect(() => {
    const fit = () => {
      for (const panel of Array.from(document.querySelectorAll<HTMLElement>(".pf-art[data-need]"))) {
        const inner = panel.querySelector<HTMLElement>(".pf-art-in");
        if (!inner) continue;
        inner.style.transform = "";
        const need = parseFloat(panel.dataset.need || "0") * 96, have = panel.clientHeight;
        if (need > 0 && have > 0 && have < need) inner.style.transform = `scale(${Math.max(0.3, have / need).toFixed(4)})`;
      }
    };
    fit();
    const t = [setTimeout(fit, 300), setTimeout(fit, 1500)];
    void document.fonts?.ready.then(fit);
    window.addEventListener("load", fit);
    window.addEventListener("beforeprint", fit);
    return () => { t.forEach(clearTimeout); window.removeEventListener("load", fit); window.removeEventListener("beforeprint", fit); };
  }, []);
  return null;
}
