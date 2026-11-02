"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A list's search kept in the page's address (?q=…), so opening a result and pressing Back brings the same search
 * back (Nov 2, Nick: "I search Take Heart, and I click on the order. When I go back, it should take me back to the
 * search results… I got to research every time"). The address changes in place: no reload, no new history step.
 * Use it for the search box of a list you open things from; not for a picker's type-to-find. Give each search on one
 * page its own key.
 */
export function useUrlSearch(key = "q"): [string, Dispatch<SetStateAction<string>>] {
  const [v, setV] = useState("");
  useEffect(() => {
    try { const x = new URLSearchParams(window.location.search).get(key); if (x) setV(x); } catch { /* no address */ }
  }, [key]);
  const set: Dispatch<SetStateAction<string>> = useCallback((x) => {
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: string) => string)(prev) : x;
      try {
        const u = new URL(window.location.href);
        if (next.trim()) u.searchParams.set(key, next); else u.searchParams.delete(key);
        if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, "", u.toString());
      } catch { /* no address */ }
      return next;
    });
  }, [key]);
  return [v, set];
}
