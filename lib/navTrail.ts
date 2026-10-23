"use client";
/**
 * Where you've been in the shop, in this browser tab (Oct 14, Nick: "the navigation needs to work on breadcrumbs:
 * Customer on Cheri's email took me to the customer, then back at the top took me to all customers, not the email").
 * Each page visited, with its address as you left it (the email page keeps the open email in its address, ?item=…),
 * so the back link at the top of a page goes to where you actually came from.
 */
export type TrailStep = { path: string; url: string; label: string; at: number };
const KEY = "shop.trail";

export function readTrail(): TrailStep[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(t: TrailStep[]) { try { sessionStorage.setItem(KEY, JSON.stringify(t.slice(-30))); } catch { /* fine */ } }

const NAMES: [RegExp, string][] = [
  [/^\/shop\/inbox/, "Email"], [/^\/shop\/conversations/, "Conversations"], [/^\/shop\/customers\/import/, "Import customers"],
  [/^\/shop\/customers\/[^/]+/, "Customer"], [/^\/shop\/customers/, "Customers"], [/^\/shop\/orders\/[^/]+/, "Order"], [/^\/shop\/orders/, "Orders"],
  [/^\/shop\/projects\/[^/]+/, "Project"], [/^\/shop\/projects/, "Projects"], [/^\/shop\/archive\/[^/]+/, "Printavo order"], [/^\/shop\/artwork\/[^/]+/, "Artwork"],
  [/^\/shop\/artwork/, "Artwork"], [/^\/shop\/order-goods/, "Order goods"], [/^\/shop\/board/, "Board"], [/^\/shop\/calendar/, "Calendar"], [/^\/shop\/goods/, "Goods"],
  [/^\/shop\/receiving/, "Receiving"], [/^\/shop\/separations/, "Separations"], [/^\/shop\/ai/, "AI Workbench"], [/^\/shop\/settings/, "Settings"], [/^\/shop\/?$/, "Dashboard"],
];
/** what to call a page in "← …": the page's own heading when it has a short one (a customer's or order's name), else its kind */
export function labelFor(path: string): string {
  const kind = NAMES.find(([re]) => re.test(path))?.[1] || (path.split("/")[2] || "Back").replace(/^\w/, (c) => c.toUpperCase());
  if (/^\/shop\/(inbox|conversations)/.test(path)) return kind;
  try {
    const h = (document.querySelector("main h1, .page-h h1, h1")?.textContent || "").replace(/\s+/g, " ").trim();
    if (h && h.length <= 40 && /^\/shop\/(customers|orders|projects|archive)\/[^/]+/.test(path)) return h;
  } catch { /* fine */ }
  return kind;
}

/** a page was opened: add it (or bring it to the end if it's the page you came back to) */
export function recordVisit(path: string, url: string) {
  const t = readTrail();
  const last = t[t.length - 1];
  if (last && last.path === path) { last.url = url; last.at = Date.now(); write(t); return; }
  // came back to the page before: drop the page you came back from, so "back" keeps working step by step
  const prev = t[t.length - 2];
  if (prev && prev.path === path) { t.pop(); prev.url = url; prev.at = Date.now(); write(t); return; }
  t.push({ path, url, label: labelFor(path), at: Date.now() });
  write(t);
}
/** the page you're on changed its address (the email page's ?item=…) or now has its heading: keep it */
export function touchCurrent() {
  const t = readTrail(), last = t[t.length - 1];
  if (!last || last.path !== window.location.pathname) return;
  last.url = window.location.pathname + window.location.search;
  last.label = labelFor(last.path);
  write(t);
}
/** where "back" should go from this page: the step before it, if there is one. `skip`: pages passed through on the way
 *  (the Mockup Creator after Create order) that "back" goes past. This page not in the trail yet (its visit is
 *  recorded a moment later): the last step is where you came from. */
export function previousStep(skip?: RegExp): TrailStep | null {
  const t = readTrail(), here = window.location.pathname;
  const hereAt = t.length && t[t.length - 1].path === here ? t.length - 1 : t.length;
  for (let i = hereAt - 1; i >= 0; i--) if (t[i].path !== here && !(skip && skip.test(t[i].path))) return t[i];
  return null;
}
