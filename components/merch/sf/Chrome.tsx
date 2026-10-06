"use client";
import { useState } from "react";
import { findMyOrders } from "@/app/s/actions";
import type { PublicStore } from "@/lib/merchServer";
import { storeImg } from "@/lib/merch";
import { closeTime, day, money, useCountdown } from "./kit";

/* The store's frame: the top bar, the school's banner, how a pre-order works, the store's progress, the footer. */

const schoolOf = (s: PublicStore) => s.brand?.school || s.name;
const whereTo = (s: PublicStore) => (s.delivery?.org?.on ? s.delivery.org.label || s.brand?.school || "school" : "");

/** a store that isn't open yet (draft, waiting for FBS, or before its open date) */
export const notYet = (s: PublicStore) => ["draft", "review"].includes(s.status) || (s.status === "open" && !!s.opens_at && Date.parse(s.opens_at) > Date.now());

function Badge({ store, size }: { store: PublicStore; size: number }) {
  const b = store.brand || {};
  if (b.logo) return <span className="sf-badge" style={{ width: size, height: size }}><img src={storeImg(b.logo)} alt="" /></span>;
  // no logo: the school's initials on its colors
  const ini = schoolOf(store).replace(/\b(elementary|middle|high|school|academy|the|of)\b/gi, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return <span className="sf-badge ini" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{ini}</span>;
}

/** Sticky bar: the school (always back to the store's front page) and the bag. */
export function TopBar({ store, count, onHome, onBag, back }: { store: PublicStore; count: number; onHome: () => void; onBag?: () => void; back?: { label: string; onClick: () => void } }) {
  return (
    <div className="sf-top">
      <div className="sf-wrap sf-top-in">
        <a className="sf-home" href={`/s/${store.slug}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onHome(); }} aria-label={`${schoolOf(store)}: store home`}>
          <Badge store={store} size={38} />
          <span className="sf-home-t"><b data-notranslate>{schoolOf(store)}</b><small data-notranslate>{store.name}</small></span>
        </a>
        {back && <button type="button" className="sf-top-back" onClick={back.onClick}>{back.label}</button>}
        {onBag && (
          <button type="button" className={"sf-bagbtn" + (count ? " has" : "")} onClick={onBag} aria-label={`Your bag: ${count} item${count === 1 ? "" : "s"}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path d="M6 8h12l-1 12H7L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            <span>Bag</span>{count > 0 && <i>{count}</i>}
          </button>
        )}
      </div>
    </div>
  );
}

/** The school's banner: its name set big, the close date on a pennant, and the fundraiser meter. */
export function Hero({ store, compact }: { store: PublicStore; compact?: boolean }) {
  const b = store.brand || {};
  const cd = useCountdown(store.open ? store.closes_at : null);
  const soon = notYet(store);
  const closed = !store.open && !soon;
  const goal = +(store.giveback?.goal || 0);
  const t = closeTime(store.closes_at);
  return (
    <header className={"sf-hero" + (compact ? " compact" : "")}>
      {b.banner && <img className="sf-hero-img" src={storeImg(b.banner)} alt="" />}
      <div className="sf-wrap sf-hero-in">
        <div className="sf-hero-text">
          <p className="sf-kicker" data-notranslate>{store.name}</p>
          <h1 className="sf-school" data-notranslate>{schoolOf(store)}</h1>
          {b.tagline && <p className="sf-tagline" data-notranslate>{b.tagline}</p>}
          {!compact && (
            <div className="sf-hero-row">
              <div className={"sf-pennant" + (cd.soon ? " hot" : "")}>
                {store.open ? <><b>Order by {day(store.closes_at)}{t ? `, ${t}` : ""}</b><span>{cd.text}</span></>
                  : soon ? <><b>Opens {store.opens_at ? day(store.opens_at) : "soon"}</b><span>Check back then</span></>
                  : <><b>Ordering closed {store.closes_at ? day(store.closes_at, false) : ""}</b><span>Orders are on their way</span></>}
              </div>
              {store.deliver_by && <p className="sf-when">{whereTo(store) ? <>Delivered to {whereTo(store)}<br />around <b>{day(store.deliver_by)}</b></> : <>Ready around <b>{day(store.deliver_by)}</b></>}</p>}
            </div>
          )}
          {!compact && goal > 0 && <div className="sf-raised-m"><Raised store={store} goal={goal} closed={closed} /></div>}
        </div>
        <div className="sf-hero-side">
          <Badge store={store} size={compact ? 76 : 132} />
          {!compact && goal > 0 && <Raised store={store} goal={goal} closed={closed} />}
        </div>
      </div>
    </header>
  );
}

/** The fundraiser meter: what the school has raised so far toward its goal. */
function Raised({ store, goal, closed }: { store: PublicStore; goal: number; closed: boolean }) {
  const pct = Math.min(100, (store.raised / goal) * 100);
  const m = (n: number) => money(n).replace(/\.00$/, "");
  return (
    <div className="sf-raised" role="img" aria-label={`${m(store.raised)} raised of a ${m(goal)} goal`}>
      <div className="sf-raised-n"><b>{m(store.raised)}</b> raised{closed ? "" : " so far"}</div>
      <div className="sf-meter"><i style={{ width: `${Math.max(pct, store.raised > 0 ? 3 : 0)}%` }} /></div>
      <small>for {store.brand?.school || "the school"} · goal {m(goal)}</small>
    </div>
  );
}

/** How a pre-order works, in three plain steps (people think it ships right away). */
export function HowItWorks({ store }: { store: PublicStore }) {
  const where = whereTo(store);
  return (
    <section className="sf-how" aria-label="How this pre-order works">
      <div className="sf-wrap sf-how-in">
        <div><b>1</b><p><strong>Order by {store.closes_at ? day(store.closes_at, false) : "the close date"}</strong><span>Pick sizes for everyone. Pay once.</span></p></div>
        <div><b>2</b><p><strong>We print after the store closes</strong><span>Nothing ships right away: it&apos;s a pre-order.</span></p></div>
        <div><b>3</b><p><strong>{where ? `Delivered to ${where}` : store.delivery?.pickup?.on ? "Ready for pickup" : "Shipped to you"}{store.deliver_by ? ` around ${day(store.deliver_by, false)}` : ""}</strong><span>{where ? "Each order in its own labeled bag, sorted by classroom." : "Each order packed in its own labeled bag."}</span></p></div>
      </div>
    </section>
  );
}

/** After the store closes: where everything is (the same steps shoppers get emails about). */
export function StoreProgress({ store }: { store: PublicStore }) {
  const order = ["closed", "ordered", "production", "packing", "ready", "delivered", "archived"];
  const at = order.indexOf(store.status);
  if (at < 0) return null;
  const steps = [
    { k: "closed", t: "Store closed" },
    { k: "ordered", t: "Shirts ordered" },
    { k: "production", t: "Printing" },
    { k: "packing", t: "Packing bags" },
    { k: "delivered", t: whereTo(store) ? `At ${whereTo(store)}` : "Ready" },
  ];
  const reached = (k: string) => at >= order.indexOf(k) || (k === "packing" && at >= order.indexOf("ready"));
  const now = steps.findIndex((s) => !reached(s.k));
  return (
    <section className="sf-progress" aria-label="Where this store's orders are">
      <h2>Where everything is</h2>
      <ol>{steps.map((s, i) => <li key={s.k} className={reached(s.k) ? "done" : i === now ? "now" : ""}><i aria-hidden>{reached(s.k) ? "✓" : ""}</i><span>{s.t}</span></li>)}</ol>
      {store.deliver_by && at < order.indexOf("delivered") && <p>We expect everything {whereTo(store) ? `at ${whereTo(store)}` : "ready"} around <b>{day(store.deliver_by)}</b>.</p>}
    </section>
  );
}

/** Footer: who runs the store, the card statement, and "email me my order links". */
export function Footer({ store }: { store: PublicStore }) {
  const [email, setEmail] = useState(""), [sent, setSent] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  return (
    <footer className="sf-foot">
      <div className="sf-wrap sf-foot-in">
        <div>
          <p className="sf-foot-brand">Printed &amp; fulfilled by <b>FBS Print</b></p>
          <p>Richardson, Texas. Card charges show as <b>FBS Print</b>. Questions? Reply to your order email.</p>
        </div>
        <form className="sf-find" onSubmit={async (e) => {
          e.preventDefault(); setErr(""); setBusy(true);
          const r = await findMyOrders(store.slug, email).catch(() => ({ ok: false, error: "Couldn't send that. Try again." }));
          setBusy(false);
          if (!r.ok) return setErr(r.error || "Couldn't send that.");
          setSent(email.trim()); setEmail("");
        }}>
          <label htmlFor="sf-find">Already ordered? Get your order links by email.</label>
          {sent ? <p className="sf-find-ok" role="status">If {sent} placed an order here, the links are on their way.</p> : (
            <div><input id="sf-find" type="email" autoComplete="email" placeholder="Email you ordered with" value={email} onChange={(e) => setEmail(e.target.value)} /><button disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send"}</button></div>
          )}
          {err && <p className="sf-find-err" role="alert">{err}</p>}
        </form>
      </div>
    </footer>
  );
}
