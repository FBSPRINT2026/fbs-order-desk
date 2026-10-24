import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/format";
import type { PortalJob } from "@/lib/portalJobs";
import { DashJobs, DashReorder } from "./PortalDashBits";

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
export type DashTracked = { id: string; href: string; number: number; name: string; status: string; due: string; health: { text: string; tone: "ok" | "act" | "wait" | "bad" }; action: { label: string; href: string; external: boolean } | null };

/** an order on hold, with why (Oct 24, Nick: "there's got to be an on hold panel on the dashboard for the customer") */
export type DashHeld = { id: string; href: string; number: number; name: string; msgHref: string; hold: { title: string; reason: string; href: string; fixLabel: string } };

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
  void mockupHref; void threads; void newMsgs; void msgHref; void needs; void goods;
  return (
    <div className="pdx">
      {draft && <div className="draft-rec pdx-draft" role="status"><b>Pick it back up?</b><span>You started <Link href={draft.href}>{draft.name || "an order"}</Link>{draft.when ? ` (${draft.when})` : ""} and haven&apos;t sent it yet.</span><Link className="btn sm primary" href={draft.href}>Continue</Link></div>}

      <div className="pdx-top">
        <section className="pdx-card pdx-asst">
          <div className="pdx-h"><h2>✨ Your FBS AI Assistant</h2><span className="faint">Instant answers about your jobs, any time</span></div>
          {assistant}
        </section>
        <div className="pdx-col">
        {/* payments: a small statement, with Pay now */}
        <section className="pdx-card pdx-stmt">
          <div className="pdx-h"><h2>Payments</h2><Link href={pay.href} className="pd-link">Payment history</Link></div>
          <div className="pdx-stmt-top">
            <div className={"pdx-stmt-due" + (pay.due > 0.004 ? (pay.pastDue > 0.004 ? " late" : " owe") : " ok")}>
              <small>Balance due</small><b>{money(pay.due)}</b>
              <span>{pay.due <= 0.004 ? "All paid up. Thank you!" : pay.pastDue > 0.004 ? `${money(pay.pastDue)} is past due` : "Nothing past due"}</span>
            </div>
            <div className="pdx-stmt-acts">{pay.due > 0.004 && <Link className="btn primary" href={pay.href}>Pay now</Link>}<a className="btn" href={pay.statementHref}>Statement</a></div>
          </div>
          {pay.due > 0.004 && pay.aging && <div className="pdx-aging">{pay.aging.map((a) => (
            <div key={a.k} className={a.late && a.amt > 0.004 ? "late" : a.amt > 0.004 ? "has" : ""}><span>{a.k}</span><b>{money(a.amt)}</b></div>
          ))}</div>}
          <div className="pdx-stmt-meta"><span>Terms <b>{pay.terms}</b></span>{pay.last && <span>Last payment <b>{pay.last}</b></span>}</div>
        </section>
        {/* the orders they starred (Oct 24, Nick: "a priority order tracker… tracking this order, here's the current status… on time or waiting on you") */}
        <section className="pdx-card pdx-track">
          <div className="pdx-h"><h2>Tracking</h2>{tracked.length > 0 && <span className="faint" style={{ fontSize: 12 }}>{tracked.length} starred</span>}</div>
          {tracked.length ? <div className="pdx-track-list">{tracked.map((t) => (
            <div key={t.id} className={"pdx-trk t-" + t.health.tone}>
              <Link href={t.href} className="pdx-trk-t"><b>#{t.number}{t.name ? ` ${t.name}` : ""}</b><small>{t.status}{t.due ? ` · In hands ${t.due}` : ""}</small></Link>
              <span className="pdx-trk-h">{t.health.text}</span>
              {t.action && t.health.tone === "act" && (t.action.external ? <a className="pd-link" href={t.action.href} target="_blank" rel="noreferrer">{t.action.label}</a> : <Link className="pd-link" href={t.action.href}>{t.action.label}</Link>)}
            </div>
          ))}</div> : <p className="pdx-track-none">Star an order (☆ on a job below) to keep an eye on it here.</p>}
        </section>
        </div>
      </div>

      {held.length > 0 && (
        <section className="pdx-card pdx-hold">
          <div className="pdx-h"><h2>On hold: needs your attention</h2><span className="faint" style={{ fontSize: 12 }}>{held.length === 1 ? "1 order is" : `${held.length} orders are`} stopped until this is sorted out</span></div>
          <div className="pdx-hold-list">
            {held.map((x) => (
              <div key={x.id} className="pdx-hold-row">
                <span className="hold-stamp" aria-hidden>On hold</span>
                <div className="pdx-hold-t">
                  <Link href={x.href}><b>#{x.number}{x.name ? ` ${x.name}` : ""}</b></Link>
                  <span>{x.hold.title}</span>
                  <details className="hold-why"><summary>See why</summary><p>{x.hold.reason}</p></details>
                </div>
                <div className="pdx-hold-acts">
                  <Link className="btn sm primary" href={x.hold.href}>{x.hold.fixLabel}</Link>
                  {x.hold.fixLabel !== "Reply" && <Link className="btn sm" href={x.msgHref}>Ask us</Link>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sent.length > 0 && (
        <section className="pdx-card pdx-sent">
          <div className="pdx-h"><h2>Orders sent to FBS</h2><Link href={ordersHref} className="pd-link">All orders</Link></div>
          <div className="pdx-sent-list">
            {sent.map((x) => (
              <Link key={x.id} href={x.href} className={"pdx-sent-row t-" + x.tone}>
                <span className="pdx-sent-name"><b>#{x.number}{x.name ? ` ${x.name}` : ""}</b><small>Sent {x.when}{x.pcs ? ` · ${x.pcs} pcs` : ""}{x.simple ? " · Simple order" : ""}</small></span>
                <span className="pdx-sent-steps" aria-hidden>{["Sent", "Reviewing", "Confirmed"].map((t, i) => <i key={t} className={x.step >= i ? "on" : ""} title={t} />)}</span>
                <span className="pdx-sent-st"><span className="pdx-sent-pill">{x.label}</span><small>{x.note}</small></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <DashJobs jobs={jobs} pastJobs={pastJobs} canAct={canAct} ordersHref={ordersHref} />

      <div className="pdx-bottom">
        <section className="pdx-card">
          {past.length > 0 && <>
            <div className="pdx-h"><h2>Order again</h2><Link href={ordersHref} className="pd-link">All past orders</Link></div>
            <div className="pdx-again">
              {past.map((p) => (
                <div className="pdx-ag" key={p.id}>
                  <Link href={p.href} className="pdx-ag-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</Link>
                  <b>{p.nickname || `Order #${p.number}`}</b>
                  <small>#{p.number}{p.when ? ` · ${p.when}` : ""}{p.qty ? ` · ${p.qty} pcs` : ""}</small>
                  <DashReorder id={p.id} archived={p.archived} canAct={canAct} />
                </div>
              ))}
            </div>
          </>}
          <div className="pdx-h" style={past.length ? { marginTop: 18 } : undefined}><h2>Your artwork</h2><Link href={artHref} className="pd-link">All artwork</Link></div>
          <div className="pdx-art">
            {art.map((a) => <Link key={a.id} href={artHref} title={a.name}><img src={a.url} alt={a.name} loading="lazy" /></Link>)}
          </div>
          <div className="pdx-h" style={{ marginTop: 18 }}><h2>Your mockups</h2><Link href={artHref} className="pd-link">All mockups</Link></div>
          <div className="pdx-art">
            {/* just a look at their work: every picture goes to Your artwork (Oct 24, Nick) */}
            {mocks.map((m) => <Link key={m.id} href={artHref} title={m.name}><img src={m.url} alt={m.name} loading="lazy" /></Link>)}
          </div>
        </section>
      </div>
    </div>
  );
}
