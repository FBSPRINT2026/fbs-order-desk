import Link from "next/link";
import { money } from "@/lib/format";
import type { PortalJob } from "@/lib/portalJobs";
import type { DashPay, DashProof, DashSent } from "@/components/PortalDash";
import { DashReorder, JobRow } from "@/components/PortalDashBits";

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
export default function PortalSimple({ jobs, proofs, sent, past, pay, newMsgs, msgHref, ordersHref, artHref, settingsHref, canAct }: {
  jobs: PortalJob[]; proofs: DashProof[]; sent: DashSent[]; past: SimplePast[]; pay: DashPay; newMsgs: number;
  msgHref: string; ordersHref: string; artHref: string; settingsHref: string; canAct: boolean;
}) {
  const owed = pay.due > 0.004;
  const open = proofs.length + sent.length + jobs.length;
  return (
    <div className="psm">
      <div className="psm-main">
        <section className="panel psm-p">
          <div className="panel-h"><h2>Open orders</h2><span className="faint">{open ? `${jobs.length + sent.length} in the works` : ""}</span><Link className="pd-link psm-hl" href={ordersHref}>All orders</Link></div>
          <div className="panel-b psm-pb">
            {proofs.map((p) => (
              <div key={p.id} className="psm-nd">
                <span className="psm-nd-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</span>
                <span className="psm-nd-t"><b>{p.what || "Proof"} ready to look over</b><small>#{p.number}{p.name ? ` · ${p.name}` : ""}</small></span>
                <Link className="btn primary" href={p.href}>Review and approve</Link>
              </div>
            ))}
            {sent.map((x) => (
              <Link key={x.id} href={x.href} className="psm-sent-r"><span><b>#{x.number}{x.name ? ` ${x.name}` : ""}</b><small>Sent {x.when} · {x.note || x.label}</small></span><span className="psm-pill">{x.label}</span></Link>
            ))}
            {jobs.length > 0 && <div className="pjr-list">{jobs.map((j) => <JobRow key={j.id} j={j} canAct={canAct} detail={!!j.hold} />)}</div>}
            {!open && <p className="psm-none">Nothing in the works right now. Start an order up top, or reorder a past job below.</p>}
          </div>
        </section>

        {past.length > 0 && (
          <section className="panel psm-p">
            <div className="panel-h"><h2>Order history</h2><Link className="pd-link psm-hl" href={ordersHref}>All past orders</Link></div>
            <div className="panel-b psm-pb">
              {past.map((p) => (
                <div key={p.id} className="psm-ag">
                  <Link href={p.href} className="psm-ag-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</Link>
                  <Link href={p.href} className="psm-ag-t"><b>{p.nickname || `#${p.number}`}</b><small>#{p.number}{p.qty ? ` · ${p.qty.toLocaleString("en-US")} pcs` : ""}{p.when ? ` · ${p.when}` : ""}</small></Link>
                  <span className="psm-ag-m num">{p.total ? money(p.total) : ""}</span>
                  <DashReorder id={p.id} archived={p.archived} canAct={canAct} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="psm-side">
        <section className="panel psm-p psm-pay">
          <div className="panel-h"><h2>Payments</h2><Link className="pd-link psm-hl" href={pay.href}>History</Link></div>
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
        <Link href={msgHref} className="psm-msg">
          <span className="psm-nd-ico" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></svg></span>
          <span className="psm-nd-t"><b>{newMsgs ? `${newMsgs} new message${newMsgs === 1 ? "" : "s"}` : "Send us a message"}</b><small>We reply here and by email.</small></span>
        </Link>
        <nav className="psm-more" aria-label="More">
          <Link href={ordersHref}>All orders</Link><Link href={artHref}>Artwork</Link><Link href={msgHref}>Messages</Link><Link href={settingsHref}>Settings</Link>
        </nav>
      </aside>
    </div>
  );
}
