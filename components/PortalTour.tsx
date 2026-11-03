"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tourDone } from "@/app/portal/tour-actions";

/**
 * The portal's tutorial (Nov 3, Nick: "grays out… this is where you view your order… start with just re-showing them
 * what they had in Printavo… view your orders, pay your bill, view your proofs… then… here's some exciting things you
 * can do for now"). The page goes gray, one part at a time is lit, and a small card says what it is. It shows by itself
 * the first time someone signs in (per person, per layout: lib/portalTour.ts), again after the shop's Reset tutorial,
 * and from Settings → Portal layout → View tutorial again. A step whose part isn't on the page (no artwork yet, a phone
 * layout) is skipped.
 */
type Step = { sel?: string; t: string; b: string };
const OLD_SITE: Step = { t: "Welcome to your new portal", b: "Everything you did on our old site is here: see your orders, approve proofs and pay your bill. Here's a quick look around." };
const NEW_THINGS: Step = { t: "A few new things", b: "We're rolling out the rest of the new site soon. For now, here are some new things you can do." };
const DONE: Step = { t: "You're all set", b: "You can watch this tour again any time in Settings, under Portal layout." };

const STEPS: Record<"simple" | "advanced", Step[]> = {
  simple: [
    OLD_SITE,
    { sel: '[data-tour="orders"]', t: "Your orders", b: "Every order we're working on for you and where it is, from quote to completed. Click one to see everything: tracking, its art and proofs, and what's due." },
    { sel: '[data-tour="proofs"]', t: "Proofs to approve", b: "When a proof is ready for you to look over, it shows here and we email you. Approve it or ask for changes right from it." },
    { sel: '[data-tour="pay"]', t: "Pay your bill", b: "Your balance and what's due. Pay online or download a statement." },
    { sel: '[data-tour="history"]', t: "Order history", b: "Your past orders with their pictures. Reorder runs one again." },
    { sel: '[data-tour="art"]', t: "Your artwork", b: "Your logos on file with us." },
    NEW_THINGS,
    { sel: '[data-tour="start"]', t: "Start an order", b: "Send us what you need and we'll confirm it. The Mockup Creator puts your logo on a shirt." },
    { sel: '[data-tour="ask"], [data-tour="ask"] > *', t: "Ask FBS AI", b: "Ask it anything: where's my order, what do I owe, reorder the volunteer shirts." },
    { sel: '[data-tour="account"]', t: "Messages and help", b: "Message us, change your settings, or report a problem with a screenshot." },
    DONE,
  ],
  advanced: [
    OLD_SITE,
    { sel: ".aa-nav", t: "Everything has a tab", b: "Your orders, quotes, payments, artwork and messages each have their own tab." },
    { sel: "#your-jobs", t: "Your jobs", b: "Every order we're working on for you and where it is. Click one to see everything: tracking, its art and proofs, and what's due." },
    { sel: ".pdx-pf", t: "Proofs to approve", b: "When a proof is ready for you to look over, it shows here and we email you." },
    { sel: ".pdx-stmt", t: "Pay your bill", b: "Your balance and what's due. Pay online or download a statement." },
    NEW_THINGS,
    { sel: '[data-tour="start"]', t: "Start an order", b: "Send us what you need and we'll confirm it. The Mockup Creator puts your logo on a shirt." },
    { sel: '[data-tour="ask"], [data-tour="ask"] > *', t: "Ask FBS AI", b: "Ask it anything: where's my order, what do I owe, reorder the volunteer shirts." },
    { sel: ".psup-foot-row", t: "Need help?", b: "Report a problem with a screenshot, and we'll get back to you in Messages." },
    DONE,
  ],
};

const shown = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0 && (el as HTMLElement).getBoundingClientRect().width > 0;

export default function PortalTour({ view, auto }: { view: "simple" | "advanced"; /** start by itself (first time, or ?tour=1) */ auto: boolean }) {
  const steps = STEPS[view];
  const [i, setI] = useState(-1);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => { if (auto) { const t = setTimeout(() => setI(0), 600); return () => clearTimeout(t); } }, [auto]);

  // the first of the step's parts that's on the page (a wrapper that draws no box of its own gives its child)
  const target = useCallback((k: number) => { const s = steps[k]; return s?.sel ? [...document.querySelectorAll(s.sel)].find(shown) || null : null; }, [steps]);
  // a step whose part isn't on the page is passed over, in the direction they were going
  const go = useCallback((k: number, dir: 1 | -1) => {
    let n = k;
    while (n > 0 && n < steps.length - 1 && steps[n].sel && !shown(target(n))) n += dir;
    setI(Math.max(0, Math.min(steps.length - 1, n)));
  }, [steps, target]);
  const finish = useCallback(() => { setI(-1); void tourDone(view); }, [view]);

  useLayoutEffect(() => {
    if (i < 0) return;
    const el = target(i);
    if (!shown(el)) { setBox(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    const read = () => { raf = 0; setBox(el.getBoundingClientRect()); };
    const later = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    const t = setTimeout(read, 450);
    addEventListener("scroll", later, true); addEventListener("resize", later);
    return () => { clearTimeout(t); removeEventListener("scroll", later, true); removeEventListener("resize", later); if (raf) cancelAnimationFrame(raf); };
  }, [i, target]);

  useEffect(() => {
    if (i < 0) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (i === steps.length - 1) finish(); else go(i + 1, 1); }
      else if (e.key === "ArrowLeft" && i > 0) go(i - 1, -1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [i, steps.length, go, finish]);

  if (i < 0 || typeof document === "undefined") return null;
  const s = steps[i], last = i === steps.length - 1;
  // which step this is, counting only the ones on this page
  const live = steps.filter((x, k) => !x.sel || shown(target(k)) || k === i);
  const at = live.indexOf(s) + 1;
  // the card under the lit part when there's room, else over it; with nothing lit, in the middle
  const pad = 8, vh = typeof window !== "undefined" ? innerHeight : 800;
  const below = box ? box.bottom + pad + 12 : 0;
  const cardStyle: React.CSSProperties = !box ? {} : below + 200 < vh
    ? { top: below, left: Math.max(16, Math.min(box.left, innerWidth - 376)) }
    : { top: Math.max(16, box.top - pad - 12 - 200), left: Math.max(16, Math.min(box.left, innerWidth - 376)) };
  return createPortal(
    <div className={"ptour" + (box ? "" : " mid")} role="dialog" aria-modal="true" aria-label={s.t}>
      {box
        ? <div className="ptour-hole" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} aria-hidden />
        : <div className="ptour-dim" aria-hidden />}
      <div className="ptour-card" style={cardStyle}>
        <div className="ptour-n">Step {at} of {live.length}</div>
        <h3>{s.t}</h3>
        <p>{s.b}</p>
        <div className="ptour-acts">
          {!last && <button type="button" className="linkbtn ptour-skip" onClick={finish}>Skip tour</button>}
          {i > 0 && <button type="button" className="btn sm" onClick={() => go(i - 1, -1)}>Back</button>}
          <button type="button" className="btn sm primary" autoFocus onClick={() => (last ? finish() : go(i + 1, 1))}>{last ? "Done" : i === 0 ? "Show me" : "Next"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
