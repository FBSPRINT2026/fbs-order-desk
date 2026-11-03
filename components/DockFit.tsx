"use client";
import { useEffect } from "react";

/**
 * A page behaves the same when a side panel squeezes it as when the window is that narrow (Nov 3, Nick: "when you scale
 * down the job center the width it looks good but when you create an order in that panel comes up then it gets weird…
 * it acts completely different").
 *
 * Why it happened: a side panel (Create order, Create reorder, the AI order helper, Order goods… any `.dla-bg.dock`)
 * takes room by padding the page on the right, but every layout rule asks the WINDOW how wide it is (`@media
 * (max-width:900px)`), so the page kept its wide layout in a narrow space and things ran over each other.
 *
 * The fix, for every rule on every page: while a panel is open, each width rule is moved by the panel's width, so it
 * answers for the room the page really has: `(max-width:900px)` becomes `(max-width:1440px)` with a 540px panel (the
 * page is 900 wide when the window is 1440), and `(min-width:…)` the same way. When the panel closes, every rule goes
 * back as written. Nothing to do per page: new pages and new rules are covered by themselves.
 */
const orig = new WeakMap<CSSMediaRule, string>();
const WIDTH = /\((max|min)-width:\s*(\d+(?:\.\d+)?)px\)/g;
// range syntax too: (width <= 900px), (width > 600px)
const RANGE = /\(width\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)px\)/g;

function shift(text: string, d: number) {
  if (!d) return text;
  return text
    .replace(WIDTH, (_m, k: string, n: string) => `(${k}-width: ${+n + d}px)`)
    .replace(RANGE, (_m, op: string, n: string) => `(width ${op} ${+n + d}px)`);
}

function walk(list: CSSRuleList, d: number) {
  for (const r of Array.from(list)) {
    if (r instanceof CSSMediaRule) {
      let o = orig.get(r);
      if (o == null) {
        o = r.media.mediaText;
        // the panels' own rules stay with the window (the panel isn't squeezed, and its room is what's measured)
        if (!/width/.test(o) || /device-width/.test(o) || /\.dock\b|dla-bg/.test(r.cssText)) { walk(r.cssRules, d); continue; }
        orig.set(r, o);
      }
      const want = shift(o, d);
      if (r.media.mediaText !== want) r.media.mediaText = want;
      walk(r.cssRules, d);
    } else if ("cssRules" in r && (r as CSSGroupingRule).cssRules) {
      walk((r as CSSGroupingRule).cssRules, d);
    }
  }
}

function apply(d: number) {
  for (const sh of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try { rules = sh.cssRules; } catch { continue; } // another site's sheet (fonts): not ours to read
    if (rules) walk(rules, d);
  }
}

export default function DockFit() {
  useEffect(() => {
    let cur = -1, sheets = -1, raf = 0;
    const measure = () => {
      raf = 0;
      // the room the panel takes is the page's right padding (none on a phone, where the panel covers the page)
      const open = document.querySelector(".dla-bg.dock:not(.og-hidden)");
      const d = open ? Math.round(parseFloat(getComputedStyle(document.body).paddingRight) || 0) : 0;
      // a page's styles loading later (another page opened with the panel up) get moved too
      const n = document.styleSheets.length;
      if (d === cur && n === sheets) return;
      cur = d; sheets = n; apply(d);
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    addEventListener("resize", later);
    measure();
    return () => { mo.disconnect(); removeEventListener("resize", later); if (raf) cancelAnimationFrame(raf); apply(0); };
  }, []);
  return null;
}
