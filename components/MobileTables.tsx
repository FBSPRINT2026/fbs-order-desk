"use client";
import { useEffect } from "react";

/**
 * Phones: a table that doesn't fit the screen turns into stacked cards instead of scrolling sideways.
 * Each cell gets its column name (data-label) so the card reads "Due: Oct 1". Tables that fit are left alone;
 * grids you type into (sizes, box sizes) are marked data-keep and keep their own layout.
 */
const PHONE = 700;
const KEEP = ".matrix, .pv-grid, .sw-boxes, .sizes, .st-tbl, [data-keep]";

function label(t: HTMLTableElement) {
  const head = t.tHead?.rows[t.tHead.rows.length - 1];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) for (let i = 0; i < (th.colSpan || 1); i++) names.push((th.textContent || "").trim());
  for (const tb of Array.from(t.tBodies)) for (const tr of Array.from(tb.rows)) {
    let i = 0;
    for (const td of Array.from(tr.cells)) {
      const n = names[i] || "";
      if (td.colSpan > 1) td.setAttribute("data-wide", "");
      else if (n && td.getAttribute("data-label") !== n && !td.hasAttribute("data-l")) td.setAttribute("data-label", n);
      i += td.colSpan || 1;
    }
  }
}

function pass() {
  const phone = window.innerWidth <= PHONE;
  for (const t of Array.from(document.querySelectorAll<HTMLTableElement>("main table, .portal table"))) {
    if (t.matches(KEEP) || t.closest("[data-keep]")) { if (phone) label(t); continue; } // grids keep their own phone layout, but get the column names
    if (!phone) { t.classList.remove("m-card"); continue; }
    if (t.classList.contains("m-card")) { label(t); continue; }
    const box = t.parentElement;
    if (box && t.scrollWidth > box.clientWidth + 2) { label(t); t.classList.add("m-card"); }
  }
}

export default function MobileTables() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(pass, 120); };
    pass();
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", soon);
    return () => { mo.disconnect(); window.removeEventListener("resize", soon); if (timer) clearTimeout(timer); };
  }, []);
  return null;
}
