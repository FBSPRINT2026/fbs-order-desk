"use client";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * In the customer portal a remembered tab or filter lasts while they're using it, but after an hour away everything
 * starts fresh: All, In progress… (Oct 24, Nick: "if it's been like an hour since they left… reset everything back to
 * standard"). The shop keeps its settings as before.
 */
const AWAY_MS = 60 * 60 * 1000;
const SEEN = "fbs:@portal.seen", RESET = "fbs:@portal.resetAt";
const inPortal = () => typeof window !== "undefined" && window.location.pathname.startsWith("/portal");
let installed = false;
/** once per page load: were they away an hour or more? then saved choices from before now are set aside */
function portalStart() {
  if (installed || !inPortal()) return;
  installed = true;
  try {
    const now = Date.now(), seen = +(localStorage.getItem(SEEN) || 0);
    if (seen && now - seen > AWAY_MS) localStorage.setItem(RESET, String(now));
    localStorage.setItem(SEEN, String(now));
    // still here: any click, key or leaving the tab counts as being here
    let last = 0;
    const touch = () => { const t = Date.now(); if (t - last < 30000) return; last = t; try { localStorage.setItem(SEEN, String(t)); } catch { /* blocked */ } };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    document.addEventListener("visibilitychange", () => { last = 0; touch(); });
  } catch { /* private window */ }
}

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
      portalStart();
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      if (inPortal()) {
        const reset = +(localStorage.getItem(RESET) || 0), at = +(localStorage.getItem("fbs:@t:" + key) || 0);
        if (reset && at < reset) return; // chosen before they were away an hour: the default again
      }
      setV(JSON.parse(raw) as T);
    } catch { /* private window or bad value */ }
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set: Dispatch<SetStateAction<T>> = useCallback((x) => {
    setV((prev) => {
      const next = typeof x === "function" ? (x as (p: T) => T)(prev) : x;
      try { localStorage.setItem(k, JSON.stringify(next)); localStorage.setItem("fbs:@t:" + key, String(Date.now())); } catch { /* storage full or blocked */ }
      return next;
    });
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, set];
}
