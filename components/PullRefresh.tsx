"use client";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import type React from "react";
import { useRouter } from "next/navigation";

/**
 * Pull down to refresh on phones and tablets (Oct 12, Nick: "if you drag down it refreshes the page, sort of like the
 * Mail app does"). Drag down from the very top of the page: a round arrow follows the finger, let go past the line and
 * it refreshes. A page can do its own refresh (Email checks for new mail instead of reloading): it listens for
 * "fbs:refresh" and calls e.detail.wait(promise). Anything else refreshes just this page in place (Oct 12, Nick: "very
 * slow, like it's refreshing the whole website"): the page's data is asked for again and the page redrawn, without
 * reloading the whole portal.
 */
export type RefreshDetail = { wait: (p: Promise<unknown>) => void };
export function onPullRefresh(fn: () => Promise<unknown>) {
  const h = (e: Event) => (e as CustomEvent<RefreshDetail>).detail.wait(fn());
  window.addEventListener("fbs:refresh", h);
  return () => window.removeEventListener("fbs:refresh", h);
}

const LINE = 70; // how far to pull before letting go refreshes

export default function PullRefresh({ children }: { children?: React.ReactNode }) {
  const [pull, setPull] = useState(0), [busy, setBusy] = useState(false), [gen, setGen] = useState(0);
  const router = useRouter(), [pending, startT] = useTransition(), doneRef = useRef<(() => void) | null>(null);
  useEffect(() => { if (!pending && doneRef.current) { doneRef.current(); doneRef.current = null; } }, [pending]);
  // a newer version of the portal: picked up when you come back to it or pull to refresh (Oct 12: a phone kept running
  // the old code after a fix went out, because refreshing only reloads the data)
  const built = useRef(""), newer = useRef(false);
  const checkVersion = useRef(async () => {
    try {
      const r = await fetch("/api/version", { cache: "no-store" }); const { v } = (await r.json()) as { v: string };
      if (!v) return false;
      if (!built.current) built.current = v;
      newer.current = v !== built.current;
      return newer.current;
    } catch { return false; }
  });
  useEffect(() => {
    void checkVersion.current();
    const back = () => { if (document.visibilityState === "visible") void checkVersion.current().then((n) => { if (n && ![...document.querySelectorAll("textarea, input[type=text]")].some((t) => (t as HTMLInputElement).value.trim())) window.location.reload(); }); // not while something's being written };
    document.addEventListener("visibilitychange", back);
    const t = setInterval(() => void checkVersion.current(), 10 * 60000);
    return () => { document.removeEventListener("visibilitychange", back); clearInterval(t); };
  }, []);
  // this page only: the server part asked for again, then the page drawn fresh (its own lists load again)
  const refreshPage = useRef<() => Promise<void>>(async () => {});
  refreshPage.current = () => new Promise<void>((res) => { doneRef.current = () => { setGen((g) => g + 1); res(); }; startT(() => router.refresh()); });
  const s = useRef<{ y: number; x: number; on: boolean; off: boolean } | null>(null);
  const pullRef = useRef(0), busyRef = useRef(false);
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    document.documentElement.classList.add("ptr-on");
    const atTop = () => (document.scrollingElement?.scrollTop || window.scrollY) <= 0;
    // not while something that scrolls on its own (a list, a menu, a dialog) is being dragged
    const inScroller = (t: EventTarget | null) => {
      for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollTop > 0) return true;
        if (el.matches?.("dialog, [role=dialog], .tb-menu, .tx, textarea, input, select")) return true;
      }
      return false;
    };
    const set = (v: number) => { pullRef.current = v; setPull(v); };
    const down = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || !atTop() || inScroller(e.target)) { s.current = null; return; }
      s.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, on: false, off: false };
    };
    const move = (e: TouchEvent) => {
      const g = s.current; if (!g || g.off) return;
      const dy = e.touches[0].clientY - g.y, dx = e.touches[0].clientX - g.x;
      if (!g.on) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { g.off = true; return; } // sliding sideways (an email row)
        if (dy < 8 || !atTop()) { if (dy < -4) g.off = true; return; }
        g.on = true;
      }
      if (e.cancelable) e.preventDefault();
      set(Math.min(130, Math.max(0, (dy - 8) * 0.55)));
    };
    const up = async () => {
      const g = s.current; s.current = null;
      if (!g?.on) return;
      if (pullRef.current < LINE) { set(0); return; }
      busyRef.current = true; setBusy(true); set(LINE * 0.8);
      // a newer version is out: load it fresh instead
      if (await checkVersion.current()) { window.location.reload(); return; }
      const waits: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent<RefreshDetail>("fbs:refresh", { detail: { wait: (p) => waits.push(p) } }));
      if (!waits.length) waits.push(refreshPage.current());
      await Promise.race([Promise.allSettled(waits), new Promise((r) => setTimeout(r, 15000))]);
      busyRef.current = false; setBusy(false); set(0);
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    document.addEventListener("touchcancel", up);
    return () => {
      document.documentElement.classList.remove("ptr-on");
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", up);
    };
  }, []);
  const ready = pull >= LINE;
  return (
    <>
    {(pull > 0 || busy) && <div className={"ptr" + (busy ? " busy" : "") + (s.current ? " drag" : "")} style={{ transform: `translate(-50%, ${pull - 44}px)` }} role="status" aria-label={busy ? "Refreshing" : ready ? "Let go to refresh" : "Pull to refresh"}>
      <svg viewBox="0 0 24 24" aria-hidden style={{ transform: busy ? undefined : `rotate(${Math.min(1, pull / LINE) * 300}deg)`, opacity: busy ? 1 : 0.35 + Math.min(1, pull / LINE) * 0.65 }}>
        <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
      </svg>
    </div>}
    <Fragment key={gen}>{children}</Fragment>
    </>
  );
}
