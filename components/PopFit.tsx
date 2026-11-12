"use client";
import { useEffect } from "react";

/**
 * Pop-ups and right-click menus always fit the window (Nick, Nov 12: "if you're at the bottom of the browser and you
 * right click… it doesn't pop up off the page"). Mounted for every page like TableFit: any element that floats over the
 * page by itself (position: fixed, placed with top / left: a right-click menu, a dropdown, a popover) is measured when it
 * appears or changes, and moved back inside the window: up when it runs off the bottom, left when it runs off the right.
 * One taller than the window keeps 8px clear top and bottom and scrolls inside. Full-screen layers (backdrops, modals,
 * side panels pinned to an edge) are left alone. Put `data-nopopfit` on one that must stay exactly where it's put.
 */
const PAD = 8;
function fit(el: HTMLElement) {
  if (el.hasAttribute("data-nopopfit")) return;
  const cs = getComputedStyle(el);
  if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // a layer that covers the window or hugs a whole edge (backdrop, modal, side panel, toast bar) isn't a pop-up
  if ((r.width >= vw - 2 && r.height >= vh - 2) || r.height >= vh - 2 || r.width >= vw - 2) return;
  if (cs.bottom !== "auto" && cs.top === "auto") return; // anchored to the bottom on purpose (a toast, a dock)
  const set = (k: "top" | "left" | "maxHeight" | "overflowY", v: string) => { if (el.style[k] !== v) el.style[k] = v; };
  if (r.height > vh - PAD * 2) { set("maxHeight", `${vh - PAD * 2}px`); set("overflowY", "auto"); }
  const h = Math.min(r.height, vh - PAD * 2);
  if (r.bottom > vh - PAD + 0.5 || r.top < PAD - 0.5) set("top", `${Math.round(Math.max(PAD, Math.min(r.top, vh - PAD - h)))}px`);
  if (r.right > vw - PAD + 0.5) set("left", `${Math.round(Math.max(PAD, vw - PAD - r.width))}px`);
  else if (r.left < PAD - 0.5) set("left", `${PAD}px`);
}

export default function PopFit() {
  useEffect(() => {
    let raf = 0;
    // only floating things are watched after they appear, so dragging cards or typing never costs a measurement
    const floating = new WeakSet<HTMLElement>();
    const pending = new Set<HTMLElement>();
    const run = () => { raf = 0; for (const el of pending) if (el.isConnected) fit(el); pending.clear(); };
    const kick = () => { if (!raf) raf = requestAnimationFrame(run); };
    const look = (el: HTMLElement) => { if (floating.has(el)) { pending.add(el); return; } if (getComputedStyle(el).position === "fixed") { floating.add(el); pending.add(el); } };
    const added = (n: Node) => {
      if (!(n instanceof HTMLElement)) return;
      look(n);
      n.querySelectorAll<HTMLElement>("[style*='top'],[style*='left'],[role='menu'],[role='dialog'],[class*='menu'],[class*='pop']").forEach(look);
      kick();
    };
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === "attributes") { const t = m.target as HTMLElement; if (floating.has(t)) { pending.add(t); kick(); } }
        else m.addedNodes.forEach(added);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    const onResize = () => { document.querySelectorAll<HTMLElement>("[style*='top']").forEach(look); kick(); };
    window.addEventListener("resize", onResize);
    return () => { mo.disconnect(); window.removeEventListener("resize", onResize); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
