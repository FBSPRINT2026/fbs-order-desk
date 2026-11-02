"use client";
import { createContext } from "react";

/** The search on the portal Artwork tab row, handed to the Design catalog under it (null: the catalog shows its own box). */
export const ArtSearchContext = createContext<string | null>(null);

/**
 * The search at the right of a portal page's title (Nov 2, Nick: "every top of the page… the title, and then all the way to
 * the right… a search bar… you're filtering that page, whatever you're on"): handed to whatever the page shows (jobs,
 * messages, goods, projects), which then filters by it and hides its own box. null: not in the portal; each keeps its own.
 */
export const PageSearchContext = createContext<string | null>(null);
/** a page search's words match a row's text: every word somewhere in it (case, "#" and "$," ignored) */
export const pageHit = (q: string | null | undefined, ...texts: (string | number | null | undefined)[]) => {
  const ws = String(q || "").toLowerCase().replace(/[#$,]/g, " ").split(/\s+/).filter(Boolean);
  if (!ws.length) return true;
  const hay = texts.map((t) => String(t ?? "")).join(" ").toLowerCase().replace(/[#$,]/g, " ");
  return ws.every((w) => hay.includes(w));
};
