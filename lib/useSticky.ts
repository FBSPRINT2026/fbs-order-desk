"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * In the customer portal nothing is remembered: leave a screen and come back, and its tabs and filters are back to
 * the defaults (All…) (Nov 2, Nick: "if you navigate away from a screen like this and you come back to it, it should
 * just go back to all"; replaces the Oct 24 hour-away reset). The shop keeps its settings as before.
 */
const inPortal = () => typeof window !== "undefined" && window.location.pathname.startsWith("/portal");

/**
 * useState that remembers its value in this browser: a toggle, tab or filter someone sets stays set after a refresh
 * or when they come back to the page (e.g. the production calendar on Screen Print + My accounts).
 * Starts from the default on the server and the first render, then switches to the saved value right after.
 */
export function useSticky<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const k = "fbs:" + key;
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      if (inPortal()) return; // the customer portal starts every screen fresh
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      setV(JSON.parse(raw) as T);
    } catch { /* private window or bad value */ }
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set: Dispatch<SetStateAction<T>> = useCallback((x) => {
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: T) => T)(prev) : x;
      try { if (!inPortal()) localStorage.setItem(k, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, set];
}
