/**
 * How wide a piece of text draws in an element's own font (tabular numbers, letter spacing and all), for laying out
 * columns to fit their contents (the garment rows' sizes and prices, lib users in components/GroupEditor.tsx).
 *
 * Measured on one hidden probe inside a box with `contain: strict`, so changing the probe re-lays out only that box,
 * never the page, and each font + text is measured once and remembered. (Nov 16, Nick: #40400 and #50108 "really
 * loading slowly": every measurement re-laid out the whole page, about 8ms each, thousands per big order, over a minute
 * with the browser frozen.) Canvas can't be used: it has no tabular numbers, which are wider.
 */
let box: HTMLDivElement | null = null;
let probe: HTMLSpanElement | null = null;
const cache = new Map<string, number>();

const FONT_KEYS = ["fontStyle", "fontWeight", "fontStretch", "fontSize", "fontFamily", "fontVariantNumeric", "fontFeatureSettings", "letterSpacing", "textTransform"] as const;

function ensure(): HTMLSpanElement {
  if (box && probe && box.isConnected) return probe;
  box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.setAttribute("data-notranslate", "");
  box.setAttribute("data-nofit", "");
  box.setAttribute("data-nopopfit", "");
  box.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;contain:strict;pointer-events:none";
  probe = document.createElement("span");
  probe.style.cssText = "position:absolute;left:0;top:0;white-space:pre;padding:0;border:0;margin:0";
  box.appendChild(probe);
  document.body.appendChild(box);
  return probe;
}

/** the width in CSS pixels (rounded up) that `text` takes in `node`'s font */
export function textWidth(node: Element, text: string): number {
  if (!text) return 0;
  const cs = getComputedStyle(node);
  const key = FONT_KEYS.map((k) => cs[k]).join("|") + "\n" + text;
  const hit = cache.get(key);
  if (hit != null) return hit;
  const p = ensure(), ps = p.style;
  for (const k of FONT_KEYS) ps[k] = cs[k];
  p.textContent = text;
  const w = Math.ceil(p.getBoundingClientRect().width);
  if (cache.size > 5000) cache.clear();
  cache.set(key, w);
  return w;
}

/** forget every width (the page's fonts finished loading, so the same text draws at another width) */
export function clearTextWidths() { cache.clear(); }
