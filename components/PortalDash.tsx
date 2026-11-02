import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/format";
import type { PortalJob } from "@/lib/portalJobs";
import { DashJobs, DashReorder, HoldJump } from "./PortalDashBits";
import OrderRail from "@/components/OrderRail";

/**
 * The customer's dashboard (Oct 15, Nick: "rethink the dashboard… more visual, jobs moving through… the AI assistant
 * at the top, fleshed out… messages have to be a part of this"). A message center, not a live chat.
 */
export type DashThread = { key: string; label: string; title: string; from: string; text: string; when: string; isNew: boolean; href: string };
export type DashNeed = { key: string; kind: string; title: string; text: string; pic: string; href: string; cta: string };
export type DashPast = { id: string; number: number; nickname: string; when: string; qty: number; pic: string; href: string; archived?: boolean };

/** an order they sent us, until we've confirmed it (and two weeks after) */
export type DashSent = { id: string; href: string; number: number; name: string; when: string; pcs: number; simple: boolean; step: number; label: string; tone: "wait" | "act" | "ok" | "off"; note: string };

/** an order they're tracking (★) */
export type DashTracked = { id: string; href: string; number: number; name: string; status: string; due: string; health: { text: string; tone: "ok" | "act" | "wait" | "bad" }; action: { label: string; href: string; external: boolean } | null;
  /** its picture and steps, so a starred order looks like its job below (Nov 2, Nick: "doesn't stand out like the rest") */ pic?: string; steps?: PortalJob["steps"]; done?: boolean };

/** an order on hold, with why (Oct 24, Nick: "there's got to be an on hold panel on the dashboard for the customer") */
export type DashHeld = { id: string; href: string; number: number; name: string; msgHref: string; hold: { key?: string; title: string; reason: string; href: string; fixLabel: string } };

/** the On hold panel's sections, by the hold's flag (lib/orderStages.ts customerHold) */
const HOLD_KINDS: { label: string; keys: string[]; c: string; none: string }[] = [
  { label: "Needs payment", keys: ["hold_payment"], c: "var(--danger)", none: "Nothing waiting on a payment" },
  { label: "Waiting on you", keys: ["hold_customer"], c: "var(--warn)", none: "Nothing waiting on you" },
  { label: "Art problem", keys: ["art_problem"], c: "#7F77DD", none: "No art problems" },
  { label: "Issue with goods", keys: ["goods_wrong"], c: "var(--ink-3)", none: "Nothing wrong with your goods" },
];

export type DashPay = { due: number; portalDue: number; pvDue: number; portalCount: number; pvCount: number; pastDue: number; last: string; terms: string; href: string; statementHref: string;
  /** what's owed by how late it is: Current, 1–30, 31–60, 61–90, Over 90 */ aging?: { k: string; amt: number; late: boolean }[] };

export default function PortalDash({ held = [], tracked = [], sent = [], draft, assistant, threads, newMsgs, msgHref, needs, jobs, pastJobs, past, art, mocks = [], mockupHref, artHref, pay, goods, canAct, ordersHref }: {
  assistant: ReactNode; threads: DashThread[]; newMsgs: number; msgHref: string; needs: DashNeed[]; jobs: PortalJob[]; pastJobs: PortalJob[];
  past: DashPast[]; art: { id: string; url: string; name: string }[]; artHref: string;
  /** Orders sent to FBS, above the jobs (Oct 24, Nick) */ sent?: DashSent[];
  /** the orders they starred to track */ tracked?: DashTracked[];
  /** orders on hold */ held?: DashHeld[];
  /** an order they started and didn't send (Oct 24, Nick: "I saw you were making this order… bring it back up?") */ draft?: { href: string; name: string; when: string } | null;
  /** their mockups, under the artwork */ mocks?: { id: string; url: string; name: string }[]; mockupHref?: string; pay: DashPay; goods?: ReactNode; canAct: boolean; ordersHref: string;
}) {
  // the dashboard (Oct 24, Nick, first look as a customer: "we don't want payments to be the first thing they see… where it
  // says message center, make that payments… a nice little customer statement looking… where you can pay now… past due
  // in 30 days… then where you have payments right now, I want that to be your jobs… get rid of the needs you section
  // and the customer supplied goods… your artwork underneath it"). Messages stay a tab.
  // lists that never grow the page (Oct 24, Nick: "make that variable… without creating scroll bars… we don't want to create more page"): three show, the rest fold under "more"
  // a starred order: its picture, name, the same rainbow steps as its job, and how it's doing (Nov 2, Nick: "the starred
  // orders doesn't look like it stands out like the rest")
  const trackRow = (t: DashTracked) => (
            <div key={t.id} className={"pdx-st1 t-" + t.health.tone}>
              <Link href={t.href} className="pdx-st1-pic" aria-hidden tabIndex={-1}>{t.pic ? <img src={t.pic} alt="" loading="lazy" /> : <span>#{t.number}</span>}</Link>
              <div className="pdx-st1-b">
                <div className="pdx-st1-top"><Link href={t.href} className="pdx-st1-t"><span className="onum">#{t.number}</span> {t.name || "Order"}</Link><span className="pdx-st1-h">{t.health.text}</span></div>
                {t.steps?.length ? <OrderRail steps={t.steps} done={t.done} /> : <small className="faint">{t.status}</small>}
                <small className="pdx-st1-d">{t.due ? `In hands ${t.due}` : t.status}{t.action && t.health.tone === "act" ? <> · {t.action.external ? <a href={t.action.href} target="_blank" rel="noreferrer">{t.action.label}</a> : <Link href={t.action.href}>{t.action.label}</Link>}</> : null}</small>
              </div>
            </div>
  );
  const sentRow = (x: DashSent) => (
            <Link key={x.id} href={x.href} className={"pdx-sent-row t-" + x.tone}>
              <span className="pdx-sent-name"><b><span className="onum">#{x.number}</span>{x.name ? ` ${x.name}` : ""}</b><small>Sent {x.when}{x.pcs ? ` · ${x.pcs} pcs` : ""}{x.simple ? " · Simple order" : ""}</small></span>
              <span className="pdx-sent-steps" aria-hidden>{["Sent", "Reviewing", "Confirmed"].map((t, i) => <i key={t} className={x.step >= i ? "on" : ""} title={t} />)}</span>
              <span className="pdx-sent-st"><span className="pdx-sent-pill">{x.label}</span><small>{x.note}</small></span>
            </Link>
  );
  void mockupHref; void threads; void newMsgs; void msgHref; void needs; void goods;
  return (
    <div className="pdx">
      {draft && <div className="draft-rec pdx-draft" role="status"><b>Pick it back up?</b><span>You started <Link href={draft.href}>{draft.name || "an order"}</Link>{draft.when ? ` (${draft.when})` : ""} and haven&apos;t sent it yet.</span><Link className="btn sm primary" href={draft.href}>Continue</Link></div>}

      <div className="pdx-top">
        <div className="pdx-col pdx-left">
        <section className="pdx-card pdx-asst">
          <div className="pdx-h"><h2>✨ Your FBS AI Assistant</h2><span className="faint">Instant answers about your jobs, any time</span></div>
          {assistant}
        </section>
        {/* Order tracking, under the assistant (Oct 24, Nick: "keep track of all your high priority orders, star to add to this list"… "underneath the panel where the FBS assistant is… the same width") */}
        <section className="pdx-card pdx-track">
          <div className="pdx-h"><h2>Starred orders</h2><span className="faint" style={{ fontSize: 12 }}>Your high-priority orders. Star one (☆) to keep it here.</span></div>
          {/* more than three: two columns, never a "more" (Oct 24, Nick) */}{tracked.length ? <div className={"pdx-track-list" + (tracked.length > 6 ? " three" : tracked.length > 3 ? " two" : "")}>{tracked.slice(0, 9).map((t) => trackRow(t))}</div> : <div className="pdx-caught">
            {/* the same look as "You're all caught up" below, with a star (Nov 2, Nick) */}
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden><circle cx="28" cy="28" r="26" fill="color-mix(in srgb, var(--fbs-orange) 16%, transparent)" /><circle cx="28" cy="28" r="18" fill="var(--fbs-orange)" /><path d="m28 17.5 3.1 6.4 7 .9-5.1 4.9 1.3 6.9L28 33.3l-6.3 3.3 1.3-6.9-5.1-4.9 7-.9z" fill="#fff" /></svg>
            <div><b>Star an order to keep track of it</b><span>Click the ☆ on any of your current jobs and it shows here: its status, its in-hands date, and whether it&apos;s on time.</span></div>
          </div>}
        </section>
        {/* Orders sent to FBS, under tracking (Oct 24, Nick: "move the orders sent to FBS up underneath the order tracking") */}
      <section className="pdx-card pdx-sent">
        <div className="pdx-h"><h2>Orders sent to FBS</h2><Link href={ordersHref} className="pd-link">All orders</Link></div>
        {!sent.length && (
          <div className="pdx-caught">
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden><circle cx="28" cy="28" r="26" fill="color-mix(in srgb, var(--ok) 12%, transparent)" /><circle cx="28" cy="28" r="18" fill="var(--ok)" /><path d="m20 28.5 5.5 5.5L37 22.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div><b>You&apos;re all caught up</b><span>Everything you&apos;ve sent us has been confirmed. New orders you send show here until we confirm them.</span></div>
          </div>
        )}
        {sent.length > 0 && <div className="pdx-sent-list">
          {sent.slice(0, 3).map((x) => sentRow(x))}{sent.length > 3 && <details className="pdx-more-fold"><summary>{sent.length - 3} more</summary><div className="pdx-sent-list">{sent.slice(3).map((x) => sentRow(x))}</div></details>}
        </div>}
      </section>

        </div>
        <div className="pdx-col">
        {/* payments: a small statement, with Pay now */}
        <section className="pdx-card pdx-stmt">
          <div className="pdx-h"><h2>Payments</h2><Link href={pay.href} className="pd-link">Payment history</Link></div>
          <div className="pdx-stmt-top">
            {/* just the balance (Nov 2, Nick: "take the past due off… take red off"): no aging boxes, no red */}
            <div className={"pdx-stmt-due" + (pay.due > 0.004 ? " owe" : " ok")}>
              <small>Balance</small><b>{money(pay.due)}</b>
              <span>{pay.due <= 0.004 ? "All paid up. Thank you!" : "Pay one, several or all of them on Payments."}</span>
            </div>
            <div className="pdx-stmt-acts">{pay.due > 0.004 && <Link className="btn primary" href={pay.href}>Pay now</Link>}<a className="btn" href={pay.statementHref}>Statement</a></div>
          </div>
          <div className="pdx-stmt-meta"><span>Terms <b>{pay.terms}</b></span>{pay.last && <span>Last payment <b>{pay.last}</b></span>}</div>
        </section>
        {/* on hold: a short list and why, one line each (Nov 2, Nick: "just be like a list and like a quick thing of why
            they're on hold… zero orders on hold, everything's good to go… when you click it… an on hold section" in Your jobs) */}
        <section className={"pdx-card pdx-hs" + (held.length ? " has" : "")}>
          <div className="pdx-h"><h2>On hold</h2>{held.length > 0 && <span className="pdx-hold-n">{held.length}</span>}</div>
          {held.length ? <>
            {/* by why it's on hold, every kind always shown so the panel fills its column (Nov 2, Nick: "should always fill
                that space… sections to it too, like needs payment, issue with goods") */}
            {HOLD_KINDS.map((k) => { const xs = held.filter((x) => (HOLD_KINDS.some((y) => y.keys.includes(x.hold.key || "")) ? k.keys.includes(x.hold.key || "") : k.keys.includes("hold_customer"))); return (
              <div key={k.label} className={"pdx-hs-sec" + (xs.length ? " has" : "")} style={{ ["--hk" as string]: k.c }}>
                <div className="pdx-hs-st"><i aria-hidden />{k.label}<small>{xs.length}</small></div>
                {xs.length ? <ul className="pdx-hs-list">{xs.map((x) => (
                  <li key={x.id}><HoldJump className="pdx-hs-row"><b><span className="onum">#{x.number}</span>{x.name ? ` ${x.name}` : ""}</b><span>{x.hold.fixLabel}</span><i aria-hidden>›</i></HoldJump></li>
                ))}</ul> : <div className="pdx-hs-none">✓ {k.none}</div>}
              </div>
            ); })}
            <span className="pdx-hs-gap" />
            <HoldJump className="pd-link pdx-hs-all">See why, in your jobs below</HoldJump>
          </> : <div className="pdx-hold-ok" role="status">
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden><circle cx="28" cy="28" r="26" fill="color-mix(in srgb, var(--ok) 12%, transparent)" /><circle cx="28" cy="28" r="18" fill="var(--ok)" /><path d="m20 28.5 5.5 5.5L37 22.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <b>No orders on hold</b>
            <span>Everything&apos;s good to go.</span>
          </div>}
        </section>
        </div>
      </div>




      <DashJobs jobs={jobs} pastJobs={pastJobs} canAct={canAct} ordersHref={ordersHref} />

      <div className="pdx-bottom">
        <section className="pdx-card">
          {past.length > 0 && <>
            <div className="pdx-h"><h2>Order again</h2><Link href={ordersHref} className="pd-link">All past orders</Link></div>
            <div className="pdx-again">
              {past.map((p) => (
                <div className="pdx-ag" key={p.id}>
                  <Link href={p.href} className="pdx-ag-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span className="pdx-ag-none" aria-hidden><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z" /></svg></span>}</Link>
                  {/* the job's name, its number and when under it (Oct 24: it said "#34501" twice) */}
                  <span className="pdx-ag-t"><b title={p.nickname || undefined}>{p.nickname || `#${p.number}`}</b><small>#{p.number}{p.qty ? ` · ${p.qty.toLocaleString("en-US")} pcs` : ""}</small>{p.when && <small>{p.when}</small>}</span>
                  <DashReorder id={p.id} archived={p.archived} canAct={canAct} />
                </div>
              ))}
            </div>
          </>}
          {/* artwork and mockups side by side, small (Oct 24, Nick: "collapse that down. These are just little thumbnails") */}
          <div className="pdx-thumbs" style={past.length ? { marginTop: 16 } : undefined}>
            <div>
              <div className="pdx-h"><h2>Your artwork</h2><Link href={artHref} className="pd-link">All artwork</Link></div>
              <div className="pdx-art">{art.slice(0, 8).map((a) => <Link key={a.id} href={artHref} title={a.name}><img src={a.url} alt={a.name} loading="lazy" /></Link>)}</div>
            </div>
            <div>
              <div className="pdx-h"><h2>Your mockups</h2><Link href={artHref} className="pd-link">All mockups</Link></div>
              <div className="pdx-art">{mocks.slice(0, 8).map((m) => <Link key={m.id} href={artHref} title={m.name}><img src={m.url} alt={m.name} loading="lazy" /></Link>)}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
