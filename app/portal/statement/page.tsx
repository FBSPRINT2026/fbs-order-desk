import Link from "next/link";
import BackLink from "@/components/BackLink";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { openInvoices } from "@/lib/statementServer";
import { fmtDateLong, money } from "@/lib/format";
import { PAY_TERMS } from "@/lib/pricing";
import PrintButton from "./print";
import { fmtPhone } from "@/lib/phone";
import { allRows } from "@/lib/readAll";
import PrintavoMark from "@/components/PrintavoMark";

/** A statement: every open invoice (new and old-system) with what's still owed, aging, how to pay, and a stub. Printable. */
export default async function Statement({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/statement");
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const admin = createAdminClient();
  const open = await openInvoices(admin, ctx.customerIds);
  // invoices from our old system still owed (Nov 2 portal check: the dashboard's balance counted them, the statement
  // didn't, so the two disagreed): listed under their own heading, each paid through its own link
  type Old = { id: string; visual_id: string; nickname: string | null; order_date: string | null; due_date: string | null; total: number; paid: number; balance: number; pay: string | null };
  const { data: oldRows } = ctx.customerIds.length ? await allRows<Old>((ra, rb) => admin.from("archived_orders").select("id, visual_id, nickname, order_date, due_date, total, paid, balance, pay:data->urls->>publicUrl").is("removed_at", null).in("customer_id", ctx.customerIds).eq("kind", "invoice").gt("balance", 0.004).order("order_date").order("id").range(ra, rb)) : { data: [] as Old[] };
  const old = (oldRows || []) as Old[];
  const acct = ctx.customers[0];
  const shop = ctx.settings.shop;
  const today = new Date().toISOString().slice(0, 10);
  const age = (d: string | null) => (d ? Math.floor((Date.parse(today) - Date.parse(d)) / 86400000) : null);
  // one table of every open invoice (Nov 2, Nick: "rethink the statement"): new ones and old-system ones (the P) together,
  // "Ready to pay" then "Being made", subtotals, the total; a due date is red only once it's more than a week past
  type Row = { id: string; num: string; old: boolean; date: string; job: string; po: string; due: string | null; total: number; paid: number; balance: number; href: string };
  const rows: Row[] = [
    ...open.map((o) => ({ id: o.id, num: String(o.number), old: false, date: o.created_at.slice(0, 10), job: o.nickname || "Order", po: o.po_number || "", due: o.pay_due, total: o.total, paid: o.paid, balance: o.balance, href: `/portal/orders/${o.id}${qs}` })),
    ...old.map((o) => ({ id: o.id, num: String(o.visual_id), old: true, date: (o.order_date || "").slice(0, 10), job: o.nickname || "Order", po: "", due: o.due_date ? o.due_date.slice(0, 10) : (o.order_date || "").slice(0, 10) || null, total: +o.total || 0, paid: +o.paid || 0, balance: +o.balance || 0, href: `/portal/archive/${o.id}${qs}` })),
  ];
  const ready = rows.filter((r) => r.due).sort((a, b) => (a.due || "").localeCompare(b.due || "") || a.num.localeCompare(b.num));
  const making = rows.filter((r) => !r.due).sort((a, b) => a.num.localeCompare(b.num));
  const sum = (l: Row[]) => l.reduce((a, r) => a + r.balance, 0);
  const total = sum(rows);
  const buckets = [
    { k: "Not due yet", f: (n: number | null) => n === null || n < 0 },
    { k: "1–30 days", f: (n: number | null) => n !== null && n >= 0 && n <= 30 },
    { k: "31–60 days", f: (n: number | null) => n !== null && n > 30 && n <= 60 },
    { k: "61–90 days", f: (n: number | null) => n !== null && n > 60 && n <= 90 },
    { k: "Over 90 days", f: (n: number | null) => n !== null && n > 90 },
  ].map((b) => ({ ...b, amt: sum(rows.filter((r) => b.f(age(r.due)))) }));
  const { data: lastPay } = ctx.customerIds.length && open.length ? await admin.from("payments").select("amount, paid_on").in("order_id", open.map((o) => o.id).slice(0, 300)).order("paid_on", { ascending: false }).limit(1) : { data: [] };
  const payHref = `/portal${qs ? qs + "&" : "?"}area=payments&pay=all`;
  const line = (r: Row) => { const a = age(r.due); return (
    <tr key={(r.old ? "o" : "n") + r.id}>
      <td className="num st-n"><Link href={r.href}>{r.num}</Link>{r.old && <PrintavoMark />}</td>
      <td className="st-d">{r.date ? fmtDateLong(r.date).replace(/, \d{4}$/, "") : ""}</td>
      <td className="st-j">{r.job}</td>
      <td className="st-po">{r.po ? <span className="stx-po" title={r.po}><span className="st-ph">PO </span>{r.po}</span> : ""}</td>
      <td className={"st-pd" + (a !== null && a > 7 ? " st-late" : "")}><span className="st-ph">Due </span>{r.due ? fmtDateLong(r.due).replace(/, \d{4}$/, "") : "—"}</td>
      <td className="r num st-t"><span className="st-ph">of </span>{money(r.total)}</td><td className="r num st-p">{money(r.paid)}</td><td className="r num b st-b">{money(r.balance)}</td>
    </tr>); };
  const pay = ctx.settings.pay;
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s statement.</div>}
      <main className="p-main st">
        <div className="st-bar no-print">
          <BackLink href={`/portal${qs}${qs ? "&" : "?"}area=payments`} label="Payments" trail={false} here />
          <span className="spacer" />
          <PrintButton />
          {rows.length > 0 && <Link className="btn primary" href={payHref}>Pay this statement ({money(total)})</Link>}
        </div>
        <section className="st-page stx">
          <header className="stx-h">
            <div>
              {shop.logoUrl ? <img src={shop.logoUrl} alt={shop.name} className="st-logo" /> : <img src="/brand/fbs-logo.svg" alt={shop.name} className="stx-logo" />}
              <div className="stx-shop">{[shop.name, shop.address].filter(Boolean).join(" · ")}<br />{[fmtPhone(shop.phone), shop.email].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="stx-title"><h1>Statement</h1><div>Date <b>{fmtDateLong(today)}</b></div><div>Account <b>{acct?.company || acct?.name}</b></div><div>Terms <b>{PAY_TERMS[acct?.payment_terms || "receipt"]}</b></div></div>
          </header>
          <div className="stx-strip" />
          <div className="stx-info">
            <div><span className="stx-lb">Bill to</span><b>{acct?.company || acct?.name}</b>{acct?.company && acct?.name && <div>{acct.name}</div>}{acct?.address && <div style={{ whiteSpace: "pre-line" }}>{acct.address}</div>}</div>
            <div><span className="stx-lb">Summary</span><div>Open invoices <b>{rows.length}</b></div>{lastPay?.[0] && <div>Last payment <b>{fmtDateLong(String(lastPay[0].paid_on || "").slice(0, 10))} · {money(+lastPay[0].amount)}</b></div>}</div>
            <div className="stx-due"><span className="stx-lb">Amount due</span><b>{money(total)}</b>{sum(making) > 0.004 && <small>{money(sum(making))} of it is still being made</small>}</div>
          </div>
          <div className="stx-age">{buckets.map((b) => <div key={b.k}><span>{b.k}</span><b>{money(b.amt)}</b></div>)}</div>
          <table className="st-tbl stx-tbl" data-nofit>
            <thead><tr><th>Invoice</th><th>Date</th><th>Job</th><th>PO</th><th>Due date</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {ready.length > 0 && <tr className="stx-grp"><td colSpan={8}>Ready to pay</td></tr>}
              {ready.map(line)}
              {ready.length > 0 && <tr className="stx-sub"><td colSpan={7}>Ready to pay · {ready.length} invoice{ready.length === 1 ? "" : "s"}</td><td className="r num">{money(sum(ready))}</td></tr>}
              {making.length > 0 && <tr className="stx-grp"><td colSpan={8}>Being made (due when it&apos;s done)</td></tr>}
              {making.map(line)}
              {making.length > 0 && <tr className="stx-sub"><td colSpan={7}>Being made · {making.length} order{making.length === 1 ? "" : "s"}</td><td className="r num">{money(sum(making))}</td></tr>}
              {!rows.length && <tr><td colSpan={8} className="st-none">Nothing is owed right now. Thank you!</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="stx-tot"><td colSpan={7}>Total due · {rows.length} invoice{rows.length === 1 ? "" : "s"}</td><td className="r num">{money(total)}</td></tr></tfoot>}
          </table>
          {old.length > 0 && <p className="stx-note"><PrintavoMark /> an invoice from our old system. A due date in red is more than a week past.</p>}
          <div className="stx-pay">
            <div><span className="stx-lb">Pay online</span>Your portal → Payments, by card or bank (ACH, no card fee).{rows.length > 0 && <> <Link className="no-print" href={payHref}>Pay this statement</Link></>}</div>
            {(pay.zelle || pay.venmo) && <div><span className="stx-lb">{pay.zelle && pay.venmo ? "Zelle / Venmo" : pay.zelle ? "Zelle" : "Venmo"}</span>{pay.zelle && <div>Zelle {pay.zelle}</div>}{pay.venmo && <div>Venmo {pay.venmo}</div>}<div>Put the invoice numbers in the note.</div></div>}
            <div><span className="stx-lb">By check</span>Payable to {shop.name}{shop.address && <div>{shop.address}</div>}</div>
          </div>
          <div className="stx-stub"><span>✂ Return with your payment · <b>{acct?.company || acct?.name}</b> · Statement {fmtDateLong(today)}</span><span>Amount due <b>{money(total)}</b> · Amount paid ____________</span></div>
        </section>
      </main>
    </>
  );
}
