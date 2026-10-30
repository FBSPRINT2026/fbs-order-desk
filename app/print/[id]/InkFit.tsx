"use client";
import { useEffect } from "react";

/**
 * Fits the quote / invoice page (Oct 30, Nick).
 *
 * The page: it starts roomy (big thumbnails, big rows) and only tightens when it has to (Nick: "you don't need to compress
 * it up unless you've got multiple products… variable width or height rules"): t1 less space between rows, t2 smaller
 * thumbnails, t3 slightly smaller type, t4 small thumbnails and tight rows for big orders; it stops at the first step where everything fits on the letter page. A really big
 * order runs onto a second page instead of shrinking past readable.
 *
 * The inks: a garment's print lines (Front, Back…) always stay inside the page ("you can't go past the margin… cap it at
 * two lines… abbreviate… never cut off the colors… all the font should remain the same"). Each garment's block of print
 * lines (.iv2-prs) tries, in order: full names on one line; short names (W, B, A Gld, Kly G, 186: lib/inkShort.ts) on one
 * line; short names on at most two lines; then the type a step smaller until it fits in two. Every line of one garment uses
 * the same names and size; the Front / Back labels never change. Nothing is cut off.
 */
const STEPS = ["t1", "t2", "t3", "t4"];
const lines = (el: HTMLElement) => new Set(Array.from(el.children).map((c) => (c as HTMLElement).offsetTop)).size;
function fitInks(root: ParentNode) {
  for (const b of Array.from(root.querySelectorAll<HTMLElement>(".iv2-prs"))) {
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
}
export default function InkFit() {
  useEffect(() => {
    const fit = () => {
      for (const sh of Array.from(document.querySelectorAll<HTMLElement>(".sheet.iv2"))) {
        STEPS.forEach((c) => sh.classList.remove(c));
        const page = parseFloat(getComputedStyle(sh).minHeight) || 1056;
        fitInks(sh);
        for (const c of STEPS) {
          if (sh.scrollHeight <= page + 1) break;
          sh.classList.add(c);
          fitInks(sh);
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
