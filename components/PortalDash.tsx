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

export type DashPay = { due: number; portalDue: number; pvDue: number; portalCount: number; pvCount: number; pastDue: number; last: string; terms: string; href: string; statementHref: string;
  /** what's owed by how late it is: Current, 1–30, 31–60, 61–90, Over 90 */ aging?: { k: string; amt: number; late: boolean }[] };

export default function PortalDash({ assistant, threads, newMsgs, msgHref, needs, jobs, pastJobs, past, art, artHref, pay, goods, canAct, ordersHref }: {
  assistant: ReactNode; threads: DashThread[]; newMsgs: number; msgHref: string; needs: DashNeed[]; jobs: PortalJob[]; pastJobs: PortalJob[];
  past: DashPast[]; art: { id: string; url: string; name: string }[]; artHref: string; pay: DashPay; goods?: ReactNode; canAct: boolean; ordersHref: string;
}) {
  // the dashboard (Oct 24, Nick, first look as a customer: "we don't want payments to be the first thing they see… where it
  // says message center, make that payments… a nice little customer statement looking… where you can pay now… past due
  // in 30 days… then where you have payments right now, I want that to be your jobs… get rid of the needs you section
  // and the customer supplied goods… your artwork underneath it"). Messages stay a tab.
  void threads; void newMsgs; void msgHref; void needs; void goods;
  return (
    <div className="pdx">

      <div className="pdx-top">
        <section className="pdx-card pdx-asst">
          <div className="pdx-h"><h2>✨ Your FBS AI Assistant</h2><span className="faint">Instant answers about your jobs, any time</span></div>
          {assistant}
        </section>
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
      </div>

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
            <Link href={artHref} className="add">＋ Upload<br />a logo</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
