"use client";
import { useEffect } from "react";

/**
 * Fits the quote / invoice page (Oct 30, Nick).
 *
 * The page: it starts roomy (big thumbnails, big rows) and only tightens when it has to (Nick: "you don't need to compress
 * it up unless you've got multiple products… variable width or height rules"): t1 less space between rows, t2 smaller
 * thumbnails, t3 slightly smaller type, t4 small thumbnails and tight rows for big orders; it stops at the first step where everything fits on the letter page. A really big
 * order runs onto a second page instead of shrinking past readable (paginate below).
 *
 * The pages: an invoice that still doesn't fit at the last step is split into real letter pages (each its own .sheet, so
 * Print and Save PDF both get them). A garment row is never split; a group that carries on repeats its heading and column
 * titles ("continued"); and the totals never sit on a page by themselves (Oct 30, Nick: "you can't have the total and the
 * balance hanging by itself on the page… you got to at least take one product with you").
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
/** split an over-long invoice sheet into letter pages, page by page */
function paginate(first: HTMLElement, page: number) {
  let sh = first;
  for (let guard = 0; guard < 20 && sh.scrollHeight > page + 1; guard++) {
    const foot = sh.querySelector<HTMLElement>(":scope > .ifoot");
    const cs = getComputedStyle(sh);
    const limit = sh.getBoundingClientRect().top + page - parseFloat(cs.paddingBottom) - (foot ? foot.offsetHeight + 12 : 0);
    // the pieces that can't be split, in order; a group's heading travels with its first row
    type Atom = { el: HTMLElement; group: HTMLElement | null; head: HTMLElement[] };
    const atoms: Atom[] = [];
    for (const ch of Array.from(sh.children) as HTMLElement[]) {
      if (ch === foot) continue;
      if (ch.classList.contains("iv2-g")) {
        const kids = Array.from(ch.children) as HTMLElement[];
        const head = kids.filter((k) => k.matches(".iv2-gh, .iv2-gd, .iv2-cols"));
        kids.filter((k) => !head.includes(k)).forEach((k, i) => atoms.push({ el: k, group: ch, head: i === 0 ? head : [] }));
      } else atoms.push({ el: ch, group: null, head: [] });
    }
    let at = atoms.findIndex((a) => a.el.getBoundingClientRect().bottom > limit);
    if (at <= 0) break;
    // the totals never go over alone: back up to the last garment row before them
    if (!atoms.slice(at).some((a) => a.el.classList.contains("iv2-ln"))) {
      const back = atoms.slice(0, at).map((a) => a.el.classList.contains("iv2-ln")).lastIndexOf(true);
      if (back > 0) at = back;
    }
    if (at <= 1) break; // nothing sensible to move
    const next = document.createElement("section");
    next.className = sh.className;
    next.dataset.cont = "1";
    const head = sh.querySelector<HTMLElement>(":scope > .iv2-head");
    if (head) next.appendChild(head.cloneNode(true));
    const made = new Map<HTMLElement, HTMLElement>();
    for (const a of atoms.slice(at)) {
      if (!a.group) { next.appendChild(a.el); continue; }
      let g = made.get(a.group);
      if (!g) {
        g = document.createElement("div");
        g.className = a.group.className;
        const heads = a.head.length ? a.head : (Array.from(a.group.children) as HTMLElement[]).filter((k) => k.matches(".iv2-gh, .iv2-cols")).map((k) => {
          const c = k.cloneNode(true) as HTMLElement;
          const t = c.matches(".iv2-gh") ? c.querySelector("span") : null;
          // "Bottles Onesies (continued)": right after the group's name
          if (t && !/continued/.test(t.textContent || "")) (t.firstChild as ChildNode | null)?.after(document.createTextNode(" (continued)"));
          return c;
        });
        heads.forEach((h) => g!.appendChild(h));
        made.set(a.group, g);
        next.appendChild(g);
      }
      g.appendChild(a.el);
    }
    for (const g of Array.from(sh.querySelectorAll<HTMLElement>(":scope > .iv2-g"))) if (!g.querySelector(".iv2-ln, .iv2-set")) g.remove();
    if (foot) next.appendChild(foot.cloneNode(true));
    sh.after(next);
    // the new page starts roomy and tightens only as far as it needs, like the first
    STEPS.forEach((c) => next.classList.remove(c));
    fitInks(next);
    for (const c of STEPS) {
      if (next.scrollHeight <= page + 1) break;
      next.classList.add(c);
      fitInks(next);
    }
    sh = next;
  }
}

/** fit every invoice sheet on the page: tighten step by step, then split into pages if it still doesn't fit */
export function fitInvoice() {
      // a sheet already split into pages (and its following pages) keeps its layout when this runs again
      for (const sh of Array.from(document.querySelectorAll<HTMLElement>(".sheet.iv2:not([data-paged]):not([data-cont])"))) {
        STEPS.forEach((c) => sh.classList.remove(c));
        const page = parseFloat(getComputedStyle(sh).minHeight) || 1056;
        fitInks(sh);
        for (const c of STEPS) {
          if (sh.scrollHeight <= page + 1) break;
          sh.classList.add(c);
          fitInks(sh);
        }
        if (sh.scrollHeight > page + 1) { sh.dataset.paged = "1"; paginate(sh, page); }
      }
}
export default function InkFit() {
  useEffect(() => {
    const fit = fitInvoice;
    fit();
    const t = [setTimeout(fit, 300), setTimeout(fit, 1500)];
    void document.fonts?.ready.then(fit);
    window.addEventListener("load", fit);
    return () => { t.forEach(clearTimeout); window.removeEventListener("load", fit); };
  }, []);
  return null;
}
