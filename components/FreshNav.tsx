"use client";
import { useEffect } from "react";
import { APP_VERSION } from "@/lib/version";

/**
 * After an update goes live, the next click on a link loads the page fresh (Nick, Nov 23 2026: Jose opening jobs from
 * the schedule "a lot of times it's just spinning and nothing's happening"). A page left open across an update asks
 * the server for the new page in the old version's terms and can hang on the spinner; a full load can't. Checked every
 * minute and when the tab comes back; nothing changes until a new version is out.
 */
export default function FreshNav() {
  useEffect(() => {
    let stale = false, on = true;
    const check = () => fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j: { ver?: string }) => { if (on && j.ver && j.ver !== APP_VERSION) stale = true; }).catch(() => null);
    void check();
    const t = setInterval(check, 60_000);
    const back = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", back);
    const click = (e: MouseEvent) => {
      if (!stale || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || (u.pathname === location.pathname && u.hash)) return;
      // a shop computer opens a job's link over its own page (components/StationShell.tsx): left to it
      if (document.querySelector(".app-stn") && /^\/shop\/(orders|archive)\//.test(u.pathname)) return;
      e.preventDefault(); e.stopPropagation();
      window.location.assign(u.href);
    };
    // before the page's own link handling (Next's links), so the load is a full one
    window.addEventListener("click", click, true);
    return () => { on = false; clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("click", click, true); };
  }, []);
  return null;
}
