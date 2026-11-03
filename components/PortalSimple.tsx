import Link from "next/link";
import { money } from "@/lib/format";
import type { PortalJob } from "@/lib/portalJobs";
import type { DashPast, DashPay, DashProof, DashSent } from "@/components/PortalDash";
import { DashReorder, JobRow } from "@/components/PortalDashBits";

/**
 * The simple portal (Nov 3, Nick, the 80/20 rule: "we've kind of built the portal only for about 5% of our customers…
 * Michael Peticolas… never has more than one or two to go at a time… he wants to just basically see if he's got an
 * invoice there, approve a proof if he's got it, maybe send us a message… click on a previous order and do a simple
 * re-order"). One page, in the order they'd look: what needs them (a proof, a balance), their jobs, what they sent us,
 * order again, a message. Everything else (all orders, artwork, payments, settings) is a quiet link at the bottom and
 * opens the same pages the full portal has. Customers with many jobs at once get the full portal (customers.portal_view).
 */
export default function PortalSimple({ jobs, proofs, sent, past, pay, newMsgs, msgHref, ordersHref, artHref, settingsHref, canAct }: {
  jobs: PortalJob[]; proofs: DashProof[]; sent: DashSent[]; past: DashPast[]; pay: DashPay; newMsgs: number;
  msgHref: string; ordersHref: string; artHref: string; settingsHref: string; canAct: boolean;
}) {
  const owed = pay.due > 0.004;
  const needs = proofs.length > 0 || owed;
  return (
    <div className="psm">
      {needs && (
        <section className="psm-card psm-need">
          <h2 className="psm-h">Needs you</h2>
          <div className="psm-needs">
            {proofs.map((p) => (
              <div key={p.id} className="psm-nd">
                <span className="psm-nd-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</span>
                <span className="psm-nd-t"><b>{p.what || "Proof"} ready to look over</b><small>#{p.number}{p.name ? ` · ${p.name}` : ""}</small></span>
                <Link className="btn primary" href={p.href}>Review and approve</Link>
              </div>
            ))}
            {owed && (
              <div className="psm-nd">
                <span className="psm-nd-ico" aria-hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6.5 15h4" /></svg></span>
                <span className="psm-nd-t"><b>{money(pay.due)} due</b><small>{pay.pastDue > 0.004 ? `${money(pay.pastDue)} past due · ` : ""}{pay.terms}</small></span>
                <Link className="btn primary" href={pay.href}>Pay</Link>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="psm-card">
        <div className="psm-hr"><h2 className="psm-h">Your jobs</h2><Link className="pd-link" href={ordersHref}>All orders</Link></div>
        {sent.length > 0 && <div className="psm-sent">{sent.map((x) => (
          <Link key={x.id} href={x.href} className="psm-sent-r"><span><b>#{x.number}{x.name ? ` ${x.name}` : ""}</b><small>Sent {x.when} · {x.note || x.label}</small></span><span className="psm-pill">{x.label}</span></Link>
        ))}</div>}
        {jobs.length ? <div className="pjr-list">{jobs.map((j) => <JobRow key={j.id} j={j} canAct={canAct} detail={!!j.hold} />)}</div>
          : !sent.length && <p className="psm-none">Nothing in the works right now. Start an order up top, or order a past job again below.</p>}
      </section>

      {past.length > 0 && (
        <section className="psm-card">
          <div className="psm-hr"><h2 className="psm-h">Order again</h2><Link className="pd-link" href={ordersHref}>All past orders</Link></div>
          <div className="psm-again">{past.slice(0, 6).map((p) => (
            <div key={p.id} className="psm-ag">
              <Link href={p.href} className="psm-ag-pic">{p.pic ? <img src={p.pic} alt="" loading="lazy" /> : <span>#{p.number}</span>}</Link>
              <span className="psm-ag-t"><b>{p.nickname || `#${p.number}`}</b><small>#{p.number}{p.qty ? ` · ${p.qty.toLocaleString("en-US")} pcs` : ""}{p.when ? ` · ${p.when}` : ""}</small></span>
              <DashReorder id={p.id} archived={p.archived} canAct={canAct} />
            </div>
          ))}</div>
        </section>
      )}

      <Link href={msgHref} className="psm-card psm-msg">
        <span className="psm-nd-ico" aria-hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></svg></span>
        <span className="psm-nd-t"><b>{newMsgs ? `${newMsgs} new message${newMsgs === 1 ? "" : "s"} from us` : "Questions? Send us a message"}</b><small>We reply here and by email.</small></span>
        <span className="psm-go" aria-hidden>›</span>
      </Link>

      <nav className="psm-more" aria-label="More">
        <Link href={ordersHref}>All orders</Link><Link href={pay.href}>Payments</Link><Link href={artHref}>Artwork</Link><Link href={msgHref}>Messages</Link><Link href={settingsHref}>Settings</Link>
      </nav>
    </div>
  );
}
