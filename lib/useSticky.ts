"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * In the customer portal nothing is remembered: leave a screen and come back, and its tabs and filters are back to
 * the defaults (All…) (Nov 2, Nick: "if you navigate away from a screen like this and you come back to it, it should
 * just go back to all"; replaces the Oct 24 hour-away reset). The shop keeps its settings as before.
 */
const inPortal = () => typeof window !== "undefined" && window.location.pathname.startsWith("/portal");

/**
 * In the shop, a page's tabs and filters are remembered while someone's working in it, and go back to the defaults (All,
 * every status…) when they haven't been back to that page for a while (Nov 3, Nick: "I haven't clicked on it in… maybe
 * a day, and it was still on requested orders… if you haven't gone back to a page in a while, it should reset to all").
 * Each visit to the page starts the clock again. The left menu's own settings (nav.*) are kept: they aren't a page's view.
 */
export const STICKY_FOR_MS = 2 * 60 * 60 * 1000;
const keeps = (key: string) => key.startsWith("nav.");
type Saved<T> = { v: T; t: number };

/**
 * useState that remembers its value in this browser: a toggle, tab or filter someone sets stays set after a refresh
 * or when they come back to the page soon (e.g. the production calendar on Screen Print + My accounts).
 * Starts from the default on the server and the first render, then switches to the saved value right after.
 */
export function useSticky<T>(key: string, initial: T, /** how long away before it's back to the default (default 2 hours) */ forMs = STICKY_FOR_MS): [T, Dispatch<SetStateAction<T>>] {
  const k = "fbs:" + key;
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      if (inPortal()) return; // the customer portal starts every screen fresh
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      const s = JSON.parse(raw) as Saved<T> | T;
      const wrapped = !!s && typeof s === "object" && "t" in (s as object) && "v" in (s as object);
      // saved before the clock (a bare value) or not touched for a while: the default, and the old one forgotten
      if (!keeps(key) && (!wrapped || Date.now() - (s as Saved<T>).t > forMs)) { localStorage.removeItem(k); return; }
      const val = wrapped ? (s as Saved<T>).v : (s as T);
      setV(val);
      localStorage.setItem(k, JSON.stringify({ v: val, t: Date.now() })); // this visit starts the clock again
    } catch { /* private window or bad value */ }
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set: Dispatch<SetStateAction<T>> = useCallback((x) => {
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: T) => T)(prev) : x;
      try { if (!inPortal()) localStorage.setItem(k, JSON.stringify({ v: next, t: Date.now() })); } catch { /* storage full or blocked */ }
      return next;
    });
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, set];
}
