"use client";
import { useEffect } from "react";

/**
 * Toolbars never scroll sideways (Oct 15, Nick: "this toolbar should never horizontally scroll.. make that a rule on
 * all toolbars"). Watches every toolbar on the page: when its buttons don't fit, they drop their words and show
 * just their icons (the name stays as a tooltip); if even the icons don't fit, the row wraps onto a second line.
 * New toolbars: give them one of these classes or a data-toolbar attribute.
 */
const SEL = ".aa-nav, .ot-nav, .ibx2-tabs, .mf-bar, [data-toolbar]";

function fit(el: HTMLElement) {
  el.classList.remove("tb-tight", "tb-icons", "tb-wrap");
  if (el.scrollWidth <= el.clientWidth + 1) return;
  // first just tighter spacing, then icons only, then wrap
  el.classList.add("tb-tight");
  if (el.scrollWidth <= el.clientWidth + 1) return;
  if (el.querySelector(":scope > * > svg")) {
    el.classList.add("tb-icons");
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
  el.classList.add("tb-wrap");
}

export default function ToolbarFit() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target as HTMLElement)));
    const scan = () => document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
      if (!seen.has(el)) { seen.add(el); ro.observe(el); }
      fit(el);
    });
    scan();
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
