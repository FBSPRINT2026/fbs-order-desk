"use client";
import { useEffect } from "react";

/**
 * Nothing wraps a letter or a word per line, anywhere (Nov 1, Nick: "why I have to keep telling you this? …20 times,
 * maybe 30 times… write it in the rules so that it doesn't make this error"). Like TableFit for tables, it's measured
 * on every page instead of trusted to each page being built right: a side panel squeezing a row, a phone.
 *
 * A bit of text is squished when its box is narrower than its own longest word (or under four letters wide) and it runs
 * three lines or more. Then the row it sits in (its nearest flex or grid parent) lets it have the whole width: a flex row
 * wraps and the squeezed piece takes a line of its own; a grid puts it across every column. When there's room again,
 * the row goes back as it was. data-nosquish on anything keeps it out (vertical labels on purpose).
 */
let canvas: HTMLCanvasElement | null = null;
function wordW(el: HTMLElement, cs: CSSStyleDeclaration): number {
  const words = (el.textContent || "").trim().split(/\s+/).filter((w) => w.length > 1 && w.length <= 22).sort((a, b) => b.length - a.length).slice(0, 2);
  if (!words.length) return 0;
  canvas ||= document.createElement("canvas");
  const ctx = canvas.getContext("2d"); if (!ctx) return 0;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return Math.max(...words.map((w) => ctx.measureText(w).width));
}
/** its row: the nearest parent laid out as flex or grid, and which of that row's children holds it */
function rowOf(el: HTMLElement): { row: HTMLElement; cell: HTMLElement; grid: boolean } | null {
  let cell: HTMLElement = el;
  for (let p = el.parentElement, n = 0; p && n < 6; p = p.parentElement, n++) {
    const d = getComputedStyle(p).display;
    if (/flex|grid/.test(d)) {
      // a column of stacked pieces isn't the squeeze: keep going up to the row that sets things side by side
      if (/flex/.test(d) && getComputedStyle(p).flexDirection.startsWith("column")) { cell = p; continue; }
      return { row: p, cell, grid: /grid/.test(d) };
    }
    cell = p;
  }
  return null;
}
const fixed = new Set<HTMLElement>();
function squished(el: HTMLElement): boolean {
  const text = (el.textContent || "").trim();
  if (text.length < 6) return false;
  const r = el.getBoundingClientRect();
  // cheap first: only narrow, tall bits can be squeezed (most of a page is passed over without styles being read)
  if (!r.width || r.width > 170 || r.height < 28) return false;
  const cs = getComputedStyle(el);
  if (cs.writingMode !== "horizontal-tb" || cs.whiteSpace === "nowrap") return false;
  const fs = parseFloat(cs.fontSize) || 14, lh = parseFloat(cs.lineHeight) || fs * 1.35;
  if (r.height < lh * 2.6) return false;
  return r.width < fs * 4 || r.width + 1 < wordW(el, cs);
}
let resized = false;
function check() {
  // what was fixed: put back when the room is there again (the row as built, measured), after the window changes size
  if (resized) for (const cell of [...fixed]) {
    if (!cell.isConnected) { fixed.delete(cell); continue; }
    const row = cell.parentElement; if (!row) continue;
    const was = { fw: row.style.flexWrap, cf: cell.style.flex, gc: cell.style.gridColumn };
    row.style.flexWrap = row.dataset.sqWrap || ""; cell.style.flex = cell.dataset.sqFlex || ""; cell.style.gridColumn = cell.dataset.sqCol || "";
    const still = [...cell.querySelectorAll<HTMLElement>("*"), cell].some((x) => x.childElementCount === 0 && squished(x));
    if (still) { row.style.flexWrap = was.fw; cell.style.flex = was.cf; cell.style.gridColumn = was.gc; }
    else { fixed.delete(cell); delete cell.dataset.sqfit; }
  }
  resized = false;
  const all = document.querySelectorAll<HTMLElement>("body *:not(script):not(style):not(svg *):not(table *)");
  for (const el of all) {
    if (el.childElementCount > 0 || el.closest("[data-nosquish], .print-page, [contenteditable]")) continue;
    if (!squished(el)) continue;
    const at = rowOf(el); if (!at || at.cell.dataset.sqfit) continue;
    const { row, cell, grid } = at;
    cell.dataset.sqfit = "1"; cell.dataset.sqFlex = cell.style.flex; cell.dataset.sqCol = cell.style.gridColumn; row.dataset.sqWrap = row.style.flexWrap;
    if (grid) cell.style.gridColumn = "1 / -1";
    else { row.style.flexWrap = "wrap"; cell.style.flex = "1 1 100%"; }
    fixed.add(cell);
    if (process.env.NODE_ENV !== "production") console.warn("SquishFit: gave a squeezed piece its own line", el, row);
  }
}
export default function SquishFit() {
  useEffect(() => {
    if (location.pathname.startsWith("/print")) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; requestAnimationFrame(check); }, 250); };
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(() => { resized = true; soon(); });
    ro.observe(document.body);
    const rs = () => { resized = true; soon(); };
    window.addEventListener("resize", rs);
    soon();
    return () => { mo.disconnect(); ro.disconnect(); window.removeEventListener("resize", rs); if (t) clearTimeout(t); };
  }, []);
  return null;
}
