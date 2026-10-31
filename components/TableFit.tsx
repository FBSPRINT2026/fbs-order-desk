"use client";
import { useEffect } from "react";

/**
 * Tables never squish and never scroll sideways (Oct 30, Nick: "we've literally talked about this like 25 times… why
 * can't you just write a rule so this doesn't happen again?" — a customer's name wrapping a letter or a word per line,
 * horizontal scroll bars). A written rule depended on every page being built right, and a page that was fine full
 * width still broke when a side panel squeezed it. So it's measured instead, on every page, for every table:
 *
 * when a table doesn't fit its box (it's wider than the box, or a cell is narrower than the longest word in it), it
 * turns into stacked rows: each row a block, each cell on its own line with its column's name in front. When there's
 * room again it goes back to a table. Nothing for a page to do; a table that must stay a table gets data-nofit.
 * The printed pages (/print) are left alone.
 */
const SEL = "main table, .main table, [role=dialog] table, .ap table";
let canvas: HTMLCanvasElement | null = null;

/** the widest single word in a cell, in its own font */
function longestWord(td: HTMLElement): number {
  const text = (td.innerText || "").trim();
  if (!text) return 0;
  // real words only: a file name, link or email (over 22 letters) may break anywhere without looking squished
  const words = text.split(/\s+/).filter((w) => w.length > 2 && w.length <= 22 && !/[@/_\\]|\.\w{2,4}$/.test(w)).sort((a, b) => b.length - a.length).slice(0, 2);
  if (!words.length) return 0;
  canvas ||= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const cs = getComputedStyle(td);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return Math.max(...words.map((w) => ctx.measureText(w).width));
}

/** column names onto each cell (data-label), for the stacked look */
function label(t: HTMLTableElement) {
  const heads = [...t.querySelectorAll<HTMLElement>("thead tr:last-child > th, thead tr:last-child > td")];
  if (!heads.length) return;
  const names: string[] = [];
  heads.forEach((h) => { const n = (h.innerText || h.getAttribute("aria-label") || "").trim(); for (let k = 0; k < (h as HTMLTableCellElement).colSpan; k++) names.push(n); });
  // a cell spanning rows (a customer's name beside all of its jobs) takes its column in the rows under it too
  let carry: number[] = [];
  t.querySelectorAll<HTMLTableRowElement>("tbody > tr").forEach((tr) => {
    let col = 0;
    const next = carry.map((n) => Math.max(0, n - 1));
    for (const c of [...tr.cells]) {
      while ((carry[col] || 0) > 0) col++;
      if (!c.hasAttribute("data-label") || c.dataset.autolabel) { c.setAttribute("data-label", c.colSpan > 1 ? "" : names[col] || ""); c.dataset.autolabel = "1"; }
      if (c.rowSpan > 1) for (let k = 0; k < c.colSpan; k++) next[col + k] = c.rowSpan - 1;
      col += c.colSpan;
    }
    carry = next;
  });
}

function squished(t: HTMLTableElement, box: HTMLElement): boolean {
  if (t.scrollWidth > box.clientWidth + 2) return true;
  const rows = [...t.querySelectorAll<HTMLTableRowElement>("tbody > tr")].slice(0, 25);
  // a number box too narrow to show its number ("2…" in a price grid on a phone, Oct 31): a long note in a text box can
  // scroll inside its box, but a number has to be read whole
  for (const tr of rows) for (const i of tr.querySelectorAll<HTMLInputElement>("input[type=number]"))
    if (i.value && i.clientWidth > 0 && i.scrollWidth > i.clientWidth + 1) return true;
  for (const tr of rows) for (const c of [...tr.cells]) {
    // a cell spanning rows (a board's name beside its jobs) sizes with the rows, not by its words
    if (c.colSpan > 1 || c.rowSpan > 1 || !c.innerText) continue;
    const cs = getComputedStyle(c);
    // only text that's allowed to break inside a word can be squished (a letter or two per line); normal text that
    // doesn't fit makes the table wider, which the check above catches
    if (!/anywhere|break-word/.test(cs.overflowWrap) && !/break-all|break-word/.test(cs.wordBreak)) continue;
    // a cell set to stay on one line (money, dates) or cut off with … on purpose isn't squished
    if (/nowrap/.test(cs.whiteSpace) || cs.textOverflow === "ellipsis") continue;
    const inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (inner > 0 && longestWord(c) > inner + 1) return true;
  }
  return false;
}

function fit(t: HTMLTableElement) {
  if (t.closest("[data-nofit]") || location.pathname.startsWith("/print")) return;
  const box = (t.parentElement as HTMLElement) || t;
  label(t);
  const was = t.classList.contains("tbl-stack");
  t.classList.remove("tbl-stack");
  const bad = squished(t, box);
  if (bad) t.classList.add("tbl-stack");
  if (bad !== was) t.dispatchEvent(new CustomEvent("tablefit", { bubbles: true, detail: { stacked: bad } }));
}

export default function TableFit() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const pending = new Set<HTMLTableElement>();
    let raf = 0;
    const flush = () => { raf = 0; pending.forEach(fit); pending.clear(); };
    const queue = (t: HTMLTableElement) => { pending.add(t); if (!raf) raf = requestAnimationFrame(flush); };
    // the table's box changing size (a side panel opening, the window narrowing) fits it again
    const ro = new ResizeObserver((es) => es.forEach((e) => { const t = (e.target as HTMLElement).matches("table") ? e.target as HTMLTableElement : (e.target as HTMLElement).querySelector("table"); if (t) queue(t); }));
    const scan = () => document.querySelectorAll<HTMLTableElement>(SEL).forEach((t) => {
      if (!seen.has(t)) { seen.add(t); if (t.parentElement) ro.observe(t.parentElement); }
      queue(t);
    });
    scan();
    let st = 0;
    const mo = new MutationObserver(() => { clearTimeout(st); st = window.setTimeout(scan, 120); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); clearTimeout(st); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
