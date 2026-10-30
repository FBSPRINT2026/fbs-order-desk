"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { previousStep, type TrailStep } from "@/lib/navTrail";

/**
 * The back arrow beside a page's title, the one breadcrumb for every page (Oct 29, Nick: "find a better way to do the
 * breadcrumbs… keep the style the same on every page", option A): a small square arrow to the LEFT of the page's h1.
 * Pointing at it says where it goes ("Back to Fedex Shirts #40209 (saves first)").
 *
 * Where it goes (Oct 14, Nick: breadcrumbs): the page you came from in this tab (the email, the order, the customer),
 * else the usual list (`href` / `label`). `go`: run instead of a plain link (the order page saves first). `hard`: a full
 * page load (the Mockup Creator back to the order, so the new pictures show). `trail={false}`: always `href` (the portal).
 *
 * Drop it anywhere in a page: it puts itself in front of the page's title (the first h1 in <main>), even when the title
 * is drawn by a component further down; a page with no title (not found) shows it where it was placed.
 */
export default function BackLink({ href, label, go, saves, hard, trail = true }: {
  href: string; label: string; go?: () => void | Promise<void>; saves?: boolean; hard?: boolean; trail?: boolean;
}) {
  const [prev, setPrev] = useState<TrailStep | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [inPlace, setInPlace] = useState(false);
  const holder = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { if (trail) setPrev(previousStep()); }, [trail]);

  // find the title and keep the arrow in front of it: React rewrites a title's text by replacing its contents, and a
  // page can redraw its title, so a watcher puts the arrow back whenever it's knocked out
  useEffect(() => {
    const el = document.createElement("span");
    el.className = "back-slot";
    holder.current = el;
    const main = document.querySelector("main") || document.body;
    let raf = 0;
    const place = () => {
      raf = 0;
      const h1 = main.querySelector("h1");
      if (!h1) return false;
      if (h1.firstChild !== el) h1.insertBefore(el, h1.firstChild);
      setSlot(el);
      return true;
    };
    const found = place();
    const watch = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(place); });
    watch.observe(main, { childList: true, subtree: true });
    const giveUp = found ? 0 : window.setTimeout(() => { if (!el.isConnected) setInPlace(true); }, 1500);
    return () => { watch.disconnect(); if (raf) cancelAnimationFrame(raf); if (giveUp) clearTimeout(giveUp); el.remove(); };
  }, []);

  const to = prev && !go ? prev : { url: href, label };
  const tip = `Back to ${to.label}${saves ? " (saves first)" : ""}`;
  const icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" /><path d="M5 12l6 6" /><path d="M5 12l6-6" />
    </svg>
  );
  const click = go ? (e: MouseEvent) => { e.preventDefault(); void go(); } : undefined;
  const btn = hard || go
    ? <a className="back-ic" href={to.url} title={tip} aria-label={tip} onClick={click}>{icon}</a>
    : <Link className="back-ic" href={to.url} title={tip} aria-label={tip}>{icon}</Link>;

  // the arrow stays inside its holder while the watcher moves the holder back in front of the title
  if (slot) return createPortal(btn, slot);
  if (inPlace) return <div className="back-row">{btn}</div>;
  return null;
}
