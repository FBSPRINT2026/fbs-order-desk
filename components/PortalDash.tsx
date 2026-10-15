import Link from "next/link";
import type { ReactNode } from "react";
import type { PortalJob } from "@/lib/portalJobs";
import { DashJobs, DashReorder } from "./PortalDashBits";

/**
 * The customer's dashboard (Oct 15, Nick: "rethink the dashboard… more visual, jobs moving through… the AI assistant
 * at the top, fleshed out… messages have to be a part of this"). A message center, not a live chat.
 */
export type DashThread = { key: string; label: string; title: string; from: string; text: string; when: string; isNew: boolean; href: string };
export type DashNeed = { key: string; kind: string; title: string; text: string; pic: string; href: string; cta: string };
export type DashPast = { id: string; number: number; nickname: string; when: string; qty: number; pic: string; href: string; archived?: boolean };

export default function PortalDash({ assistant, threads, newMsgs, msgHref, needs, jobs, pastJobs, past, art, artHref, account, goods, canAct, ordersHref }: {
  assistant: ReactNode; threads: DashThread[]; newMsgs: number; msgHref: string; needs: DashNeed[]; jobs: PortalJob[]; pastJobs: PortalJob[];
  past: DashPast[]; art: { id: string; url: string; name: string }[]; artHref: string; account: { label: string; value: string; tone?: "ok" | "bad" }[]; goods?: ReactNode; canAct: boolean; ordersHref: string;
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
        <section className="pdx-card pdx-acct">
          <div className="pdx-h"><h2>Your account</h2></div>
          {account.map((r) => <div className="pdx-kv" key={r.label}><span>{r.label}</span><b className={r.tone || ""}>{r.value}</b></div>)}
        </section>
      </div>
    </div>
  );
}
