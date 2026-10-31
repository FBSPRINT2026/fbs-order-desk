"use client";
import { useEffect } from "react";

/**
 * A row you swipe sideways (the tab and filter rows on a phone) shows a small arrow at the edge that has more: › on the
 * right while there are tabs off to the right, ‹ on the left once you've swiped past some (Oct 31, Nick: "put a small
 * arrow to the right so that it indicates left or right scrolling of the menu"). Tapping the arrow slides the row.
 *
 * Any row counts, wherever it is, with nothing for a page to do: a flex row of buttons or links that scrolls sideways
 * and doesn't fit. A table or a picture strip isn't a row of buttons and gets no arrow.
 */
const W = 26;

function isRow(el: HTMLElement) {
  const cs = getComputedStyle(el);
  if (!/flex/.test(cs.display) || !/(auto|scroll)/.test(cs.overflowX) || cs.flexWrap === "wrap") return false;
  const kids = [...el.children];
  return kids.length > 1 && kids.filter((k) => k.matches("button, a, details, label, [role=tab], [role=radio]")).length >= kids.length / 2;
}

/** the color behind the row, so the arrow's fade blends into it */
function bgOf(el: HTMLElement) {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return "#fff";
}

function mark(el: HTMLElement) {
  const on = el.classList.contains("swh");
  // the arrows overlap the row (no width of their own), so measuring with them on is the same as without
  const over = el.scrollWidth > el.clientWidth + 2;
  if (!over || !isRow(el)) { if (on) el.classList.remove("swh", "swh-l", "swh-r"); return; }
  if (!on) { el.classList.add("swh"); el.style.setProperty("--swh-bg", bgOf(el)); }
  el.classList.toggle("swh-l", el.scrollLeft > 2);
  el.classList.toggle("swh-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
}

export default function SwipeHint() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const ro = new ResizeObserver((es) => es.forEach((e) => mark(e.target as HTMLElement)));
    const onScroll = (e: Event) => mark(e.currentTarget as HTMLElement);
    const scan = () => document.querySelectorAll<HTMLElement>("main *, .main *, [role=dialog] *").forEach((el) => {
      if (el.scrollWidth <= el.clientWidth + 2 && !seen.has(el)) return;
      if (!seen.has(el)) {
        if (!isRow(el)) return;
        seen.add(el); ro.observe(el); el.addEventListener("scroll", onScroll, { passive: true });
      }
      mark(el);
    });
    // a tap on an arrow slides the row about a screen's worth that way
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el?.classList?.contains("swh")) return;
      const r = el.getBoundingClientRect();
      const dir = el.classList.contains("swh-r") && e.clientX > r.right - W - 4 ? 1 : el.classList.contains("swh-l") && e.clientX < r.left + W + 4 ? -1 : 0;
      if (dir) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
    };
    document.addEventListener("click", onClick);
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); };
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", later);
    scan();
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); document.removeEventListener("click", onClick); window.removeEventListener("resize", later); };
  }, []);
  return null;
}
