"use client";
import { useEffect } from "react";

/**
 * A garment's print lines on the quote / invoice (Front, Back…) always fit inside the page (Oct 30, Nick: "you can't go past
 * the margin… cap it at two lines… abbreviate… never cut off the colors… all the font should remain the same"). Each
 * garment's block of print lines (.iv2-prs) tries, in order:
 *   1. full names, every line on one line;
 *   2. short names (W, B, A Gld, Kly G, 186: lib/inkShort.ts), every line on one line;
 *   3. short names, every line on at most two lines;
 *   4. short names on two lines, the type a step smaller until it fits.
 * Every line of one garment uses the same names and the same size; the Front / Back labels never change. Nothing is cut off.
 */
const lines = (el: HTMLElement) => new Set(Array.from(el.children).map((c) => (c as HTMLElement).offsetTop)).size;
export default function InkFit() {
  useEffect(() => {
    const fit = () => {
      for (const b of Array.from(document.querySelectorAll<HTMLElement>(".iv2-prs"))) {
        const rows = Array.from(b.querySelectorAll<HTMLElement>(".iv2-inks"));
        if (!rows.length) continue;
        b.dataset.m = "full"; b.style.removeProperty("--ik");
        if (rows.every((r) => lines(r) <= 1)) continue;
        b.dataset.m = "short";
        if (rows.every((r) => lines(r) <= 2)) continue;
        const base = parseFloat(getComputedStyle(rows[0]).fontSize) || 10;
        for (let px = base - 0.5; px >= 5; px -= 0.5) {
          b.style.setProperty("--ik", `${px}px`);
          if (rows.every((r) => lines(r) <= 2)) break;
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
