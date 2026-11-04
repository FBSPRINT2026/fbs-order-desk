"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The simple portal's way around (Nov 3, Nick: "when you click on payments or artwork, you're brought to the page that
 * has the full portal's toolbar… put a drop down menu on the right… so they can go view past things"). Simple accounts
 * never see the full tab bar: every page has this Menu at the top right, and every page but the dashboard has
 * "← Dashboard" before its title. The pages listed are the same ones the full portal's tab bar shows (AccountAreas
 * hands them down), so the two can't drift apart.
 */
export type SimpleMenuItem = { id: string; label: string; icon: ReactNode; n?: number };
type Ctx = { go: (id: string) => void; items: SimpleMenuItem[]; current: string; settingsHref?: string; settingsIcon?: ReactNode };
export const SimpleMenuContext = createContext<Ctx | null>(null);

export default function PortalSimpleMenu() {
  const c = useContext(SimpleMenuContext);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!c) return null;
  return (
    <span className="psmn" ref={box}>
      <button type="button" className="btn psmn-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        <span>Menu</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <span className="psmn-m" role="menu">
          {c.items.map((x) => (
            <button key={x.id} type="button" role="menuitem" className={"psmn-i" + (c.current === x.id ? " on" : "")} onClick={() => { setOpen(false); c.go(x.id); window.scrollTo({ top: 0 }); }}>
              {x.icon}<span>{x.label}</span>{x.n ? <span className="psmn-n">{x.n}</span> : null}
            </button>
          ))}
          {c.settingsHref && <Link role="menuitem" className="psmn-i" href={c.settingsHref} onClick={() => setOpen(false)}>{c.settingsIcon}<span>Settings</span></Link>}
        </span>
      )}
    </span>
  );
}

/** "← Dashboard", before the page's title on every simple page but the dashboard */
export function SimpleBack() {
  const c = useContext(SimpleMenuContext);
  if (!c || c.current === "home") return null;
  return (
    // the small arrow in front of the title, as on every other page (components/BackLink.tsx's look; Nov 4, Nick: the big
    // "Dashboard" button pushed the title over: "the arrow, like we've been doing… next to messages")
    <button type="button" className="back-ic psmn-back" title="Back to Dashboard" aria-label="Back to Dashboard" onClick={() => { c.go("home"); window.scrollTo({ top: 0 }); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="M5 12l6 6" /><path d="M5 12l6-6" /></svg>
    </button>
  );
}
