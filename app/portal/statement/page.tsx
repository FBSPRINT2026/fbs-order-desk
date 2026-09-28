import Link from "next/link";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { openInvoices } from "@/lib/statementServer";
import { fmtDateLong, money } from "@/lib/format";
import { PAY_TERMS } from "@/lib/pricing";
import PrintButton from "./print";

/** A statement: every open invoice with what's still owed, aging, and one button to pay it all. Printable. */
export default async function Statement({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/statement");
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const open = await openInvoices(createAdminClient(), ctx.customerIds);
  const acct = ctx.customers[0];
  const shop = ctx.settings.shop;
  const today = new Date().toISOString().slice(0, 10);
  const age = (d: string | null) => (d ? Math.floor((Date.parse(today) - Date.parse(d)) / 86400000) : null);
  const buckets = [
    { k: "Current", f: (n: number | null) => n === null || n < 0 },
    { k: "1–30 days", f: (n: number | null) => n !== null && n >= 0 && n <= 30 },
    { k: "31–60 days", f: (n: number | null) => n !== null && n > 30 && n <= 60 },
    { k: "61–90 days", f: (n: number | null) => n !== null && n > 60 && n <= 90 },
    { k: "Over 90 days", f: (n: number | null) => n !== null && n > 90 },
  ].map((b) => ({ ...b, amt: open.filter((o) => b.f(age(o.pay_due))).reduce((a, o) => a + o.balance, 0) }));
  const total = open.reduce((a, o) => a + o.balance, 0);
  const payHref = `/portal${qs ? qs + "&" : "?"}area=payments&pay=all`;
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s statement.</div>}
      <main className="p-main st">
        <div className="st-bar no-print">
          <Link className="back" href={`/portal${qs}${qs ? "&" : "?"}area=payments`}>← Payments</Link>
          <span className="spacer" />
          <PrintButton />
          {open.length > 0 && <Link className="btn primary" href={payHref}>Pay this statement ({money(total)})</Link>}
        </div>
        <section className="st-page">
          <header className="st-h">
            <div>
              {shop.logoUrl ? <img src={shop.logoUrl} alt={shop.name} className="st-logo" /> : <b className="st-shop">{shop.name}</b>}
              <div className="st-small">{[shop.phone, shop.email].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="st-title"><h1>Statement</h1><div>{fmtDateLong(today)}</div></div>
          </header>
          <div className="st-to">
            <div><span>Account</span><b>{acct?.company || acct?.name}</b>{acct?.company && acct?.name && <div>{acct.name}</div>}{acct?.address && <div style={{ whiteSpace: "pre-line" }}>{acct.address}</div>}</div>
            <div><span>Terms</span><b>{PAY_TERMS[acct?.payment_terms || "receipt"]}</b></div>
            <div className="st-due"><span>Amount due</span><b>{money(total)}</b></div>
          </div>
          <table className="st-tbl">
            <thead><tr><th>Invoice</th><th>Date</th><th>Job</th><th>PO</th><th>Payment due</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {open.map((o) => { const a = age(o.pay_due); return (
                <tr key={o.id} className={a !== null && a > 0 ? "late" : ""}>
                  <td className="num">#{o.number}</td><td>{fmtDateLong(o.created_at.slice(0, 10))}</td><td>{o.nickname || "Order"}</td><td>{o.po_number || ""}</td>
                  <td>{o.pay_due ? `${fmtDateLong(o.pay_due)}${a !== null && a > 0 ? ` (${a}d late)` : ""}` : "When done"}</td>
                  <td className="r num">{money(o.total)}</td><td className="r num">{money(o.paid)}</td><td className="r num b">{money(o.balance)}</td>
                </tr>
              ); })}
              {!open.length && <tr><td colSpan={8} className="st-none">Nothing is owed right now. Thank you!</td></tr>}
            </tbody>
            {open.length > 0 && <tfoot><tr><td colSpan={7}>Total due · {open.length} invoice{open.length === 1 ? "" : "s"}</td><td className="r num b">{money(total)}</td></tr></tfoot>}
          </table>
          <div className="st-aging">{buckets.map((b) => <div key={b.k} className={b.amt > 0.004 && b.k !== "Current" ? "late" : ""}><span>{b.k}</span><b>{money(b.amt)}</b></div>)}</div>
          <p className="st-small">Pay online in your portal ({open.length ? "Payments → Pay this statement" : "Payments"}), by card or bank transfer (ACH, no card fee){ctx.settings.pay.zelle ? `, or Zelle to ${ctx.settings.pay.zelle}` : ""}{ctx.settings.pay.venmo ? `, or Venmo ${ctx.settings.pay.venmo}` : ""}. Questions? Message us in your portal.</p>
        </section>
      </main>
    </>
  );
}
