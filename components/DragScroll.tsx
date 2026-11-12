"use client";
import { useEffect } from "react";

/**
 * Dragging anything scrolls the page with you (Nick, Nov 12: "as you're dragging it, use your scroll wheel to scroll… it's
 * not working smooth"). Mounted for every page like TableFit. While something is being dragged:
 *  - the mouse wheel scrolls (browsers often ignore it mid-drag, or jump in steps): each turn of the wheel is passed to the
 *    page, or to the scrolling box under the pointer, smoothly;
 *  - holding it near the top or bottom of the window (or of a scrolling box) scrolls that way, faster the closer it gets.
 * The page under the pointer keeps getting dragover, so drop previews follow the scroll.
 */
const EDGE = 90, MAX = 22;
function scroller(el: Element | null): HTMLElement | Window {
  for (let x = el as HTMLElement | null; x && x !== document.body; x = x.parentElement) {
    const cs = getComputedStyle(x);
    if (/(auto|scroll)/.test(cs.overflowY) && x.scrollHeight > x.clientHeight + 2) return x;
  }
  return window;
}

export default function DragScroll() {
  useEffect(() => {
    let dragging = false, y = 0, x = 0, raf = 0, wheelLeft = 0;
    const box = () => scroller(document.elementFromPoint(x, y));
    const tick = () => {
      raf = 0;
      if (!dragging) return;
      const sc = box();
      const r = sc === window ? { top: 0, bottom: window.innerHeight } : (sc as HTMLElement).getBoundingClientRect();
      let dy = 0;
      if (y < r.top + EDGE) dy = -Math.ceil(MAX * (1 - Math.max(0, y - r.top) / EDGE));
      else if (y > r.bottom - EDGE) dy = Math.ceil(MAX * (1 - Math.max(0, r.bottom - y) / EDGE));
      // the wheel, eased out over a few frames
      if (Math.abs(wheelLeft) > 0.5) { const step = wheelLeft * 0.35; dy += step; wheelLeft -= step; } else wheelLeft = 0;
      if (dy) sc.scrollBy({ top: dy, behavior: "auto" });
      raf = requestAnimationFrame(tick);
    };
    const start = () => { dragging = true; wheelLeft = 0; if (!raf) raf = requestAnimationFrame(tick); };
    const stop = () => { dragging = false; wheelLeft = 0; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const over = (e: DragEvent) => { x = e.clientX; y = e.clientY; if (!dragging) start(); };
    const wheel = (e: WheelEvent) => { if (!dragging) return; e.preventDefault(); wheelLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY; };
    window.addEventListener("dragstart", start, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", stop, true);
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => { stop(); window.removeEventListener("dragstart", start, true); window.removeEventListener("dragover", over, true); window.removeEventListener("dragend", stop, true); window.removeEventListener("drop", stop, true); window.removeEventListener("wheel", wheel, true); };
  }, []);
  return null;
}
