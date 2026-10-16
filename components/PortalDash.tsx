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

export type DashPay = { due: number; portalDue: number; pvDue: number; portalCount: number; pvCount: number; pastDue: number; last: string; terms: string; href: string; statementHref: string };

export default function PortalDash({ assistant, threads, newMsgs, msgHref, needs, jobs, pastJobs, past, art, artHref, pay, goods, canAct, ordersHref }: {
  assistant: ReactNode; threads: DashThread[]; newMsgs: number; msgHref: string; needs: DashNeed[]; jobs: PortalJob[]; pastJobs: PortalJob[];
  past: DashPast[]; art: { id: string; url: string; name: string }[]; artHref: string; pay: DashPay; goods?: ReactNode; canAct: boolean; ordersHref: string;
}) {
  return (
    <div className="pdx">

      <div className="pdx-top">
        <section className="pdx-card pdx-asst">
          <div className="pdx-h"><h2>✨ Your FBS AI Assistant</h2><span className="faint">Instant answers about your jobs, any time</span></div>
          {assistant}
        </section>
        <section className="pdx-card pdx-msgs">
          <div className="pdx-h"><h2>Message center</h2>{newMsgs > 0 ? <span className="pdx-badge">{newMsgs} new</span> : <Link href={msgHref} className="pd-link">Open</Link>}</div>
          {threads.length ? threads.map((t) => (
            <Link key={t.key} href={t.href} className={"pdx-th" + (t.isNew ? " new" : "")}>
              <span className={"pdx-ti" + (t.label === "FBS" ? " g" : "")}>{t.label}</span>
              <span className="pdx-tt"><b>{t.title}</b><small>{t.from}: {t.text}</small></span>
              <span className="pdx-tw">{t.when}</span>
            </Link>
          )) : <div className="pdx-none">No messages yet.</div>}
          <div className="pdx-note">Art, changes, questions about a job. <b>We reply within one business day.</b> Where your order is shows on its timeline below.</div>
          <div className="pdx-mc"><Link className="btn primary" href={msgHref}>New message</Link><Link className="btn" href={msgHref}>Open message center</Link></div>
        </section>
      </div>

      {/* payments: their own box (Oct 15, Nick) */}
      <section className="pdx-card pdx-pay">
        <div className="pdx-h"><h2>Payments</h2><Link href={pay.href} className="pd-link">Payment history</Link></div>
        <div className="pdx-pay-row">
          <div className={"pdx-pay-big" + (pay.due > 0.004 ? " owe" : " ok")}><small>Balance due</small><b>{money(pay.due)}</b>{pay.due <= 0.004 && <span>All paid up</span>}</div>
          {pay.due > 0.004 && <div className="pdx-pay-parts">
            {pay.portalDue > 0.004 && <div><span>New portal orders</span><b>{money(pay.portalDue)}</b><small>{pay.portalCount} order{pay.portalCount === 1 ? "" : "s"}</small></div>}
            {pay.pvDue > 0.004 && <div><span>Printavo orders</span><b>{money(pay.pvDue)}</b><small>{pay.pvCount} invoice{pay.pvCount === 1 ? "" : "s"}</small></div>}
            {pay.pastDue > 0.004 && <div className="late"><span>Past due</span><b>{money(pay.pastDue)}</b><small>included above</small></div>}
          </div>}
          <div className="pdx-pay-meta">
            <div><span>Payment terms</span><b>{pay.terms}</b></div>
            {pay.last && <div><span>Last payment</span><b>{pay.last}</b></div>}
          </div>
          <div className="pdx-pay-acts">{pay.due > 0.004 && <Link className="btn primary" href={pay.href}>Pay now</Link>}<a className="btn" href={pay.statementHref}>Statement</a></div>
        </div>
      </section>

      {needs.length > 0 && (
        <section className="pdx-card">
          <div className="pdx-h"><h2>Needs you</h2><span className="faint">{needs.length} thing{needs.length === 1 ? "" : "s"}</span></div>
          <div className="pdx-needs">
            {needs.map((n) => (
              <div className="pdx-need" key={n.key}>
                {n.pic ? <img src={n.pic} alt="" /> : <span className="pdx-need-ic" aria-hidden>{n.kind === "quote" || n.kind === "pay" ? "$" : n.kind === "receive" ? "📦" : "✎"}</span>}
                <div><div className="k">{n.title}</div><div className="t">{n.text}</div></div>
                <Link className="btn primary" href={n.href}>{n.cta}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <DashJobs jobs={jobs} pastJobs={pastJobs} canAct={canAct} ordersHref={ordersHref} />

      {goods}

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
            <Link href={artHref} className="add">＋ Upload<br />a logo</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
