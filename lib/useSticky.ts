"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState that remembers its value in this browser: a toggle, tab or filter someone sets stays set after a refresh
 * or when they come back to the page (e.g. the production calendar on Screen Print + My accounts).
 * Starts from the default on the server and the first render, then switches to the saved value right after.
 */
export function useSticky<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const k = "fbs:" + key;
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try { const raw = localStorage.getItem(k); if (raw != null) setV(JSON.parse(raw) as T); } catch { /* private window or bad value */ }
  }, [k]);
  const set: Dispatch<SetStateAction<T>> = useCallback((x) => {
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: T) => T)(prev) : x;
      try { localStorage.setItem(k, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, [k]);
  return [v, set];
}
