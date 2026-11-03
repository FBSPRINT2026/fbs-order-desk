import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/format";
import type { PortalJob } from "@/lib/portalJobs";
import type { DashPay, DashProof, DashSent } from "@/components/PortalDash";
import { DashReorder, JobRow } from "@/components/PortalDashBits";
import { LogoFace } from "@/components/LogoOnShirts";
import type { Design } from "@/lib/pricing";

/** a finished order in the simple portal's order history */
export type SimplePast = { id: string; number: number; nickname: string; when: string; qty: number; pic: string; href: string; archived?: boolean; total: number };

/**
 * The simple portal (Nov 3, Nick, the 80/20 rule: "we've kind of built the portal only for about 5% of our customers…
 * Michael Peticolas… never has more than one or two to go at a time"; then: "not too many panels… top should be open
 * orders, then order history, panel on the right for payments"). Two panels on the left (open orders, with a proof to
 * approve at the top of them; order history, each with Reorder) and payments on the right (balance, Pay, statement, a
 * message). The rest (all orders, artwork, settings) are quiet links at the foot, opening the full portal's pages.
 * Customers with many jobs at once get the full portal (customers.portal_view; View: Simple / Full at the foot).
 */
export default function PortalSimple({ search, jobs, proofs, sent, past, pay, art = [], designUrls = {}, newMsgs, msgHref, ordersHref, artHref, settingsHref, canAct, support }: {
  /** one search for everything (orders, payments, artwork), the portal's AI search bar */ search?: ReactNode;
  jobs: PortalJob[]; proofs: DashProof[]; sent: DashSent[]; past: SimplePast[]; pay: DashPay; /** their logos, small, under payments, drawn as the Artwork page draws them (on the shirt color they print on) */ art?: { d: Design; shirt?: string; shown?: { url: string; shirt: string } | null; printed?: Parameters<typeof LogoFace>[0]["printed"] }[]; designUrls?: Record<string, string>; newMsgs: number;
  msgHref: string; ordersHref: string; artHref: string; settingsHref: string; canAct: boolean;
  /** "Have a support issue?" with its button (Simple / Full is in Settings) */ support?: ReactNode;
}) {
  const owed = pay.due > 0.004;
  const open = sent.length + jobs.length;
  return (
    <>
    {/* the page's title, like the full portal's Dashboard (Nov 3, Nick: "add the dashboard header to the top and space it
        out some with description and headings") */}
    <div className="psm-top"><h2 className="aa-ptitle psm-title">Dashboard</h2><p className="psm-desc">Your open orders, payments and past work with us, all on one page.</p></div>
    <div className="psm">
      {/* one search at the top for everything, its examples rolling through (Nov 3, Nick: "search like everything, orders,
          payments, all that stuff… like the AI search where it rotates through") */}
      <div className="psm-main">
        <section className="panel psm-p" data-tour="orders">
          <div className="panel-h"><div className="psm-ht"><h2>Open orders</h2><span className="faint">What we&apos;re working on for you, and where each one is</span></div><Link className="pd-link psm-hl" href={ordersHref}>All orders</Link></div>
          <div className="panel-b psm-pb">
            {sent.map((x) => (
              <Link key={x.id} href={x.href} className="psm-sent-r"><span><b>#{x.number}{x.name ? ` ${x.name}` : ""}</b><small>Sent {x.when} · {x.note || x.label}</small></span><span className="psm-pill">{x.label}</span></Link>
            ))}
            {jobs.length > 0 && <div className="pjr-list">{jobs.map((j) => <JobRow key={j.id} j={j} canAct={canAct} detail={!!j.hold} />)}</div>}
            {!open && <p className="psm-none">Nothing in the works right now. Start an order up top, or reorder a past job below.</p>}
          </div>
        </section>

        {/* past orders as picture tiles, each with Reorder (Nov 3, Nick: option B) */}
        {past.length > 0 && (
          <section className="panel psm-p" data-tour="history">
            <div className="panel-h"><div className="psm-ht"><h2>Order history</h2><span className="faint">Your past orders. Reorder runs one again.</span></div><Link className="pd-link psm-hl" href={ordersHref}>All past orders</Link></div>
            <div className="panel-b psm-tiles">
              {past.map((p) => (
                <div key={p.id} className="psm-tile">
                  <Link href={p.href} className="psm-tile-pic" aria-label={`Open ${p.nickname || `#${p.number}`}`}>{p.pic ? <img src={p.pic} alt="" loading="lazy" />
                    : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z" /></svg>}</Link>
                  <Link href={p.href} className="psm-tile-t"><b title={p.nickname || undefined}>{p.nickname || `#${p.number}`}</b><small>#{p.number}{p.when ? ` · ${p.when}` : ""}</small></Link>
                  <div className="psm-tile-b"><span className="num">{p.total ? money(p.total) : ""}</span><DashReorder id={p.id} archived={p.archived} canAct={canAct} /></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="psm-side">
        {/* right above payments (Nov 3, Nick) */}
        {search && <div className="psm-search" data-tour="ask">{search}</div>}
        {/* proofs have their own panel, empty or not (Nov 3, Nick: "there's no proof section on the simple version… it
            should say oh no proofs for you right now") */}
        <section className="panel psm-p psm-proofs" data-tour="proofs">
          <div className="panel-h"><div className="psm-ht"><h2>Proofs to approve</h2><span className="faint">Look over your art before we print</span></div>{proofs.length > 0 && <span className="psm-pf-n">{proofs.length}</span>}</div>
          <div className="panel-b psm-pb">
            {proofs.length ? proofs.map((p) => (
              <div key={p.id} className="psm-pf">
                <span className="psm-nd-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</span>
                <span className="psm-nd-t"><b>{p.what || "Proof"} ready to look over</b><small>#{p.number}{p.name ? ` · ${p.name}` : ""}</small></span>
                <Link className="btn primary" href={p.href}>Review and approve</Link>
              </div>
            )) : <p className="psm-none">No proofs waiting on you right now. When one&apos;s ready, it shows here and we email you.</p>}
          </div>
        </section>
        <section className="panel psm-p psm-pay" data-tour="pay">
          <div className="panel-h"><div className="psm-ht"><h2>Payments</h2><span className="faint">What&apos;s due and how to pay it</span></div><Link className="pd-link psm-hl" href={pay.href}>History</Link></div>
          <div className="panel-b psm-pb">
            <div className="psm-bal"><small>Balance due</small><b className={"num" + (pay.pastDue > 0.004 ? " late" : "")}>{money(pay.due)}</b></div>
            {pay.pastDue > 0.004 && <div className="psm-late">{money(pay.pastDue)} past due</div>}
            <div className="psm-kv"><span>Terms</span><b>{pay.terms}</b></div>
            {pay.last && <div className="psm-kv"><span>Last payment</span><b>{pay.last}</b></div>}
            <div className="psm-pay-acts">
              {owed && <Link className="btn primary" href={pay.href}>Pay now</Link>}
              <a className="btn" href={pay.statementHref}>Statement</a>
            </div>
          </div>
        </section>
        {/* their logos, small (Nov 3, Nick: "the smaller artwork… on the bottom right") */}
        {art.length > 0 && (
          <section className="panel psm-p psm-artp" data-tour="art">
            <div className="panel-h"><div className="psm-ht"><h2>Your artwork</h2><span className="faint">Your logos on file with us</span></div><Link className="pd-link psm-hl" href={artHref}>All artwork</Link></div>
            <div className="panel-b psm-art">{art.map((a) => <Link key={a.d.id} href={artHref} className="psm-art-i" title={a.d.name}><LogoFace d={a.d} urls={designUrls} shirt={a.shirt} shown={a.shown || null} printed={a.printed || null} /></Link>)}</div>
          </section>
        )}
        {/* everything about the account in one small panel: a message to us, all orders, messages, settings and Simple /
            Full (Nov 3, Nick: "part of it under the artwork on the right, part of it at the bottom… just have a little panel
            where that's all in there") */}
        <section className="panel psm-p psm-acct" data-tour="account">
          <div className="panel-h"><div className="psm-ht"><h2>Your account</h2><span className="faint">Messages, settings and help</span></div></div>
          <div className="panel-b psm-acct-b">
            <Link href={msgHref} className="psm-msg">
              <span className="psm-nd-ico" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></svg></span>
              <span className="psm-nd-t"><b>{newMsgs ? `${newMsgs} new message${newMsgs === 1 ? "" : "s"}` : "Send us a message"}</b><small>We reply here and by email.</small></span>
            </Link>
            <nav className="psm-acct-links" aria-label="Your account">
              <Link href={ordersHref}>All orders</Link><Link href={msgHref}>Messages</Link><Link href={settingsHref}>Settings</Link>
            </nav>
            {support && <div className="psm-acct-help">{support}</div>}
          </div>
        </section>
      </aside>
    </div>
    </>
  );
}
