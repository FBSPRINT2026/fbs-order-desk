"use client";
import { useEffect } from "react";
import { useSticky } from "@/lib/useSticky";

/**
 * The right-side tool panels (the order check chat, Create order, Order goods, the Digitizer) are one width the person
 * sets by dragging the panel's left edge, like a column (Oct 31, Nick: "the order chat is huge… make it so that you can
 * drag it over… when you get to half screen mode… it's half the screen"). Mounted once for every shop page; it works on
 * any `.dla-bg.dock`, so a new panel gets it too. The width is remembered (useSticky "dock.w"); none set = the panel's
 * own default (narrower than before).
 */
export default function DockSizer() {
  const [w, setW] = useSticky<number>("dock.w", 0);
  useEffect(() => {
    const root = document.documentElement;
    if (w > 0) root.style.setProperty("--dock-w", `${w}px`); else root.style.removeProperty("--dock-w");
  }, [w]);
  useEffect(() => {
    let drag: { el: HTMLElement } | null = null;
    const clamp = (x: number) => Math.round(Math.max(340, Math.min(window.innerWidth * 0.7, x)));
    const down = (e: PointerEvent) => {
      const panel = (e.target as HTMLElement | null)?.closest?.(".dla-bg.dock > .dla") as HTMLElement | null;
      if (!panel || e.button !== 0) return;
      if (e.clientX - panel.getBoundingClientRect().left > 7) return;
      e.preventDefault();
      drag = { el: panel };
      document.body.classList.add("dock-dragging");
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      document.documentElement.style.setProperty("--dock-w", `${clamp(window.innerWidth - e.clientX)}px`);
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove("dock-dragging");
      setW(clamp(window.innerWidth - e.clientX));
    };
    // a double-click on the edge goes back to the panel's own width
    const dbl = (e: MouseEvent) => {
      const panel = (e.target as HTMLElement | null)?.closest?.(".dla-bg.dock > .dla") as HTMLElement | null;
      if (panel && e.clientX - panel.getBoundingClientRect().left <= 7) setW(0);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("dblclick", dbl, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("dblclick", dbl, true); };
  }, [setW]);
  return null;
}
