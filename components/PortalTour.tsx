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
type Step = { sel?: string; t: string; b: string; /** a picture in the card (the new proof email) */ img?: string; /** small print under it */ foot?: string; /** only for wholesale accounts */ forWholesale?: boolean };
const OLD_SITE: Step = { t: "Welcome to your new portal", b: "Everything you did on our old site is here: see your orders, approve proofs and pay your bill. Here's a quick look around." };
// proofs never came by email before (Nov 3, Nick: "say hey all new email proofs… a screenshot of how our new email looks")
const PROOF_EMAIL: Step = { t: "New: proofs come by email", b: "When a proof or quote is ready, we email it to you. One button takes you to it to approve or ask for changes.", img: "/tour/proof-email.png" };
// for customers who sent us orders through ClickUp before (Nov 3, Nick: "all the functionality of ClickUp… right into
// your portal… submit simple order"): only when the account came to us that way (customer_used_clickup)
const CLICKUP: Step[] = [
  { sel: '[data-tour="start"]', t: "Used to send orders in ClickUp?", b: "Everything you did there now happens right here. Click Start an order/quote, then Simple order / quote.", img: "/tour/simple-order-button.png" },
  { t: "Fill it in and send it to us", b: "Give it a name and a date, say what it is, and drop in your PO and art. Click Send to FBS: we build it and send you a confirmation.", img: "/tour/simple-order.png" },
  // so they know we got it (Nov 3, Nick: "a screenshot of the sent to FBS… so that it shows it in there, like they know
  // we got it"): lit where their own sent orders show (the full dashboard's panel, the simple view's open orders)
  { sel: '.pdx-sent, [data-tour="orders"]', t: "We've got it", b: "Once you send it, it shows here as Waiting on FBS, so you know we have it. When we confirm it, it becomes one of your jobs.", img: "/tour/sent-to-fbs.png" },
];
const NEW_THINGS: Step = { t: "A few new things", b: "We're rolling out the rest of the new site soon. For now, here are some new things you can do." };
const START: Step = { sel: '[data-tour="start"]', t: "Start an order", b: "Send us what you need and we'll confirm it. The Mockup Creator puts your logo on a shirt." };
// wholesale accounts hear why first (Nov 3, Nick: "the point of the mockup creator is for you to nail down all the
// details before you sell it to your client… that way you know exactly how to price it")
const WHOLESALE_WHY: Step = { t: "Why it's here for you", b: "Nail down every detail before you offer it to your client: the garment, the size and placement, and the exact colors. That way you know exactly how to price it, and it prints exactly like you sold it.", forWholesale: true };
// the Mockup Creator is one of the new things (Nov 3, Nick: "show the Mockup Creator button, and then a clip of what it
// looks like… the logo on it and the imprint")
const MOCKUP: Step = { sel: '[data-tour="start"] a.pd-act', t: "Mockup Creator", b: "Put your logo on a shirt before you order: pick the garment and color, add your logo, and see its size and ink colors. It walks you through it the first time you open it.", img: "/tour/mockup-creator.png" };
const ASK: Step = { sel: '[data-tour="ask"], [data-tour="ask"] > *', t: "Ask FBS AI", b: "Ask it anything: where's my order, what do I owe, reorder the volunteer shirts." };
// help is the last thing they hear (Nov 3, Nick: "we built this software for y'all… if you do have an issue… a screenshot
// and tell us what's going on and we'll fix it immediately")
const help = (sel: string): Step => ({ sel, t: "Something not right? Tell us", b: "We built this new site for you. If anything doesn't work the way it should, click Have an issue? at the bottom right, take a screenshot and tell us what's going on. We'll fix it right away.", foot: "You can watch this tour again any time in Settings, under Portal layout." });

type TourView = "simple" | "advanced" | "mockup";
const STEPS: Record<TourView, Step[]> = {
  // the Mockup Creator's own walk-through, the first time they open it (Nov 3, Nick: "a tutorial for the mockup creator
  // also… the first time, how to use")
  mockup: [
    { t: "Meet the new Mockup Creator", b: "We're excited to roll out our brand new Mockup Creator. Build a realistic mockup that shows exactly how your print will look on the garment.", img: "/tour/mockup-creator.png" },
    WHOLESALE_WHY,
    { sel: ".mk-setup", t: "1. Pick a garment", b: "It's synced with our suppliers' catalogs and pulls in the garment pictures for you to build on. Type a style number or a kind of shirt, pick the colors, or click Help me pick.", img: "/tour/mk-garment.png" },
    // the moves themselves, as little films (Nov 3, Nick: "show how you remove the shirt color… how you drag and drop it
    // and move it around in size")
    { sel: ".mk-setup", t: "Change the shirt color", b: "Click the × on a color to take it off, then type a new one. The shirt changes right away, and you can add as many colors as you want to compare.", img: "/tour/mk-color.gif" },
    { sel: ".mk-side > section.panel:first-child", t: "2. Add a location", b: "Click Add location and choose where it goes: front, back or sleeves, and how it's printed: screen print, embroidery, DTF or heat press.", img: "/tour/mk-location.png" },
    { sel: ".mk-side > section.panel:first-child", t: "3. Upload your art", b: "Every format works: AI, EPS, SVG, PDF, JPEG, PNG and more. Simple tools like remove background clean it up for you.", img: "/tour/mk-location.png" },
    { sel: ".mk-stage-wrap", t: "4. Size it and place it", b: "Drag it and size it right on the shirt until it looks the way you want. Grab the logo to move it, and pull the corner to make it bigger or smaller. That's the size and placement we print.", img: "/tour/mk-drag.gif" },
    { sel: ".mk-side > section.panel:first-child", t: "5. Get the colors right", b: "Not sure what color it'll print in? For each color in your logo, we suggest the closest standard ink or a PMS color, or you set your own PMS.", img: "/tour/mk-colors.png" },
    { sel: ".mk-side > section.panel:first-child", t: "Embroidery? Pick your threads", b: "Switch it to embroidery and it finds the closest threads we carry for each color, with a stitch estimate.", img: "/tour/mk-threads.png" },
    { sel: ".mk-more-box", t: "Need more than a logo?", b: "Add words, start from a ready-made design, have AI create one, or open the Design Lab for names and numbers." },
    { sel: ".mk-head .btn.primary", t: "6. Save it to your files", b: "Save mockup keeps it in your Artwork, ready to order from." },
    { sel: ".mk-head .row", t: "7. Share it with your customers", b: "Sales tools makes a sales sheet: every color on one page, your text and logo on top, ready to download as a picture or PDF. Export PDF makes a sheet you can send.", img: "/tour/mk-sales.png", foot: "You can watch this again from Settings, under Portal layout." },
  ],
  simple: [
    OLD_SITE,
    { sel: '[data-tour="orders"]', t: "Your orders", b: "Every order we're working on for you and where it is, from quote to completed. Click one to see everything: tracking, its art and proofs, and what's due." },
    { sel: '[data-tour="proofs"]', t: "Proofs to approve", b: "When a proof is ready for you to look over, it shows here. Approve it or ask for changes right from it." },
    PROOF_EMAIL,
    { sel: '[data-tour="pay"]', t: "Pay your bill", b: "Your balance and what's due. Pay online or download a statement." },
    { sel: '[data-tour="history"]', t: "Order history", b: "Your past orders with their pictures. Reorder runs one again." },
    { sel: '[data-tour="art"]', t: "Your artwork", b: "Your logos on file with us. All artwork shows every logo and mockup." },
    NEW_THINGS,
    START,
    MOCKUP,
    ASK,
    { sel: '[data-tour="account"] .psm-msg, [data-tour="account"]', t: "Messages and settings", b: "Message us any time; we reply here and by email. Settings has your contacts, addresses and how this page looks." },
    help('[data-tour="account"] .psm-acct-help'),
  ],
  advanced: [
    OLD_SITE,
    { sel: ".aa-nav", t: "Everything has a tab", b: "Your orders, payments, artwork and messages each have their own tab." },
    { sel: "#your-jobs", t: "Your jobs", b: "Every order we're working on for you and where it is. Click one to see everything: tracking, its art and proofs, and what's due." },
    // following an order (Nov 3, Nick: "add jobs you're following")
    { sel: ".pdx-track", t: "Orders you're following", b: "Click the star on any order to follow it. The ones you follow stay up here, with where each one is." },
    { sel: ".pdx-pf", t: "Proofs to approve", b: "When a proof is ready for you to look over, it shows here. Approve it or ask for changes right from it." },
    PROOF_EMAIL,
    { sel: ".pdx-stmt", t: "Pay your bill", b: "Your balance and what's due. Pay online or download a statement." },
    { sel: '.aa-nav [data-area="artwork"]', t: "Your artwork", b: "Every logo and mockup we have for you, drawn on the shirts they print on." },
    { sel: '.aa-nav [data-area="receive"]', t: "Your goods", b: "When you send us the garments, tell us what's coming and add tracking here, and see when it arrives." },
    NEW_THINGS,
    START,
    MOCKUP,
    ASK,
    help(".psup-tab"),
  ],
};

const shown = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0 && (el as HTMLElement).getBoundingClientRect().width > 0;

export default function PortalTour({ view, auto, clickup = false, wholesale = false }: { view: TourView; /** start by itself (first time, or ?tour=1) */ auto: boolean; /** they sent us orders through ClickUp before */ clickup?: boolean; /** a wholesale account */ wholesale?: boolean }) {
  const [steps] = useState(() => STEPS[view].filter((x) => !x.forWholesale || wholesale).flatMap((x) => (clickup && x === START ? [START, ...CLICKUP] : [x])));
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
  const cardStyle: React.CSSProperties = !box ? {} : below + 240 < vh
    ? { top: below, left: Math.max(16, Math.min(box.left, innerWidth - 376)) }
    : { top: Math.max(16, box.top - pad - 12 - 240), left: Math.max(16, Math.min(box.left, innerWidth - 376)) };
  // a step with a picture puts its card in the middle, so the picture has room (the part stays lit behind it)
  const mid = !box || !!s.img;
  return createPortal(
    <div className={"ptour" + (mid ? " mid" : "")} role="dialog" aria-modal="true" aria-label={s.t}>
      {box
        ? <div className="ptour-hole" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} aria-hidden />
        : <div className="ptour-dim" aria-hidden />}
      <div className="ptour-card" style={mid ? undefined : cardStyle}>
        <div className="ptour-n">Step {at} of {live.length}</div>
        <h3>{s.t}</h3>
        <p>{s.b}</p>
        {s.img && <img className="ptour-img" src={s.img} alt="" />}
        {s.foot && <p className="ptour-foot">{s.foot}</p>}
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
