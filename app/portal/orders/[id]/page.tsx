import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalCtx, signProofs } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, imprintLabel, orderGroups, sizeLabel, SIZES, type Message, type Order, type Payment, type Proof } from "@/lib/pricing";
import { fmtDate, fmtDateLong, fmtStamp, money } from "@/lib/format";
import { Pill } from "@/components/bits";
import { MessageThread, PayBox, ProofCard, QuoteApproval } from "./client";

const STEPS: { label: string; keys: string[] }[] = [
  { label: "Quote", keys: ["quote_sent"] },
  { label: "Approved", keys: ["approved"] },
  { label: "Artwork", keys: ["art"] },
  { label: "Garments", keys: ["blanks"] },
  { label: "Printing", keys: ["production"] },
  { label: "Ready", keys: ["ready"] },
  { label: "Done", keys: ["completed"] },
];

export default async function PortalOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string; paid?: string }> }) {
  const { id } = await params;
  const { as, paid: justPaid } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}`);
  const { data: od } = await ctx.db.from("orders").select("*").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).neq("status", "quote").maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  const [p, pr, m] = await Promise.all([
    ctx.db.from("payments").select("*").eq("order_id", id).order("paid_on"),
    ctx.db.from("proofs").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    ctx.db.from("messages").select("*").eq("order_id", id).order("created_at"),
  ]);
  const payments = (p.data || []) as Payment[];
  const proofs = await signProofs((pr.data || []) as Proof[]);
  const messages = (m.data || []) as Message[];
  const c = calcOrder(o, ctx.settings, payments);
  const preview = !!ctx.preview;
  const back = preview ? `/portal?as=${ctx.preview!.id}` : "/portal";

  // Log a "viewed" event at most once an hour, so the shop knows the customer looked.
  if (!preview) {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("order_events").select("id", { count: "exact", head: true }).eq("order_id", id).eq("kind", "viewed").gte("created_at", since);
    if (!count) await admin.from("order_events").insert({ order_id: id, kind: "viewed", detail: "", actor: ctx.email });
  }

  const curIdx = STEPS.findIndex((s) => s.keys.includes(o.status));
  const pendingProofs = proofs.filter((x) => x.status === "pending");
  const deposit = Math.min(c.balance, Math.round(c.total * ctx.settings.depositPct) / 100);
  const canPay = o.type === "invoice" && c.balance > 0.004;
  const onlinePay = !!process.env.STRIPE_SECRET_KEY; // online card payments turned on?

  return (
    <>
      {preview && <div className="preview-bar">Preview of {ctx.preview!.company || ctx.preview!.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <Link className="back" href={back}>← All orders</Link>
        <div className="page-head" style={{ margin: 0 }}>
          <div>
            <div className="eyebrow">{o.type === "quote" ? "Quote" : "Order"} #{o.number}</div>
            <h1>{o.nickname || "Your order"}</h1>
            <div className="muted" style={{ marginTop: 6 }}>{c.qty} pieces{o.due_date ? ` · in hands ${fmtDateLong(o.due_date)}` : ""}{o.po_number ? ` · PO ${o.po_number}` : ""}{o.delivery_method === "ship" ? " · shipping" : o.delivery_method === "deliver" ? " · delivery" : ""}{o.tracking ? ` · tracking ${o.tracking}` : ""}</div>
          </div>
          <div className="row">
            <Pill status={o.status} portal />
            <a className="btn" href={`/print/${o.id}${preview ? `?as=${ctx.preview!.id}` : ""}`} target="_blank" rel="noreferrer">Print or save PDF</a>
          </div>
        </div>

        <div className="panel"><div className="panel-b">
          <div className="stepper" aria-label="Order progress">
            {STEPS.map((s, i) => (
              <div key={s.label} className={"step" + (i < curIdx ? " done" : "") + (i === curIdx ? " cur" : "")}>
                <span className="dot">{i < curIdx ? "✓" : ""}</span>{s.label}
              </div>
            ))}
          </div>
        </div></div>

        {justPaid && <div className="callout good"><h2>Thank you, payment received</h2><div className="muted">It can take a minute to show below. You&apos;ll get a receipt by email from our payment processor.</div></div>}

        {o.status === "quote_sent" && <QuoteApproval orderId={o.id} total={money(c.total)} terms={ctx.settings.shop.terms} disabled={preview} defaultName={ctx.customers.find((x) => x.id === o.customer_id)?.name || ""} />}
        {o.approved_at && <div className="muted" style={{ fontSize: 13 }}>Quote approved by <b>{o.approved_name}</b> on {fmtStamp(o.approved_at)}.</div>}

        {pendingProofs.length > 0 && (
          <div className="callout" style={{ borderColor: "color-mix(in srgb, #A152C9 45%, var(--line))", background: "color-mix(in srgb, #A152C9 10%, var(--surface))" }}>
            <h2>Artwork ready for your review</h2>
            <div className="muted">Please approve each proof or tell us what to change. We start printing once artwork is approved.</div>
            <a className="btn primary" href="#proofs" style={{ alignSelf: "flex-start" }}>Review artwork below</a>
          </div>
        )}

        <div className="two">
          <div className="stack">
            <section className="panel">
              <div className="panel-h"><h2>Items</h2></div>
              <div style={{ overflowX: "auto" }}>
                <table className="items">
                  <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {orderGroups(o).map((g, gi) => g.lines.map((l, li) => {
                      const lc = c.groups[gi]?.lines[li];
                      return (
                        <tr key={l.id}>
                          <td>
                            <b>{[l.style, l.garment].filter(Boolean).join(" · ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}{c.groups[gi]?.wholesale ? " (your garments)" : ""}
                            {li === 0 && g.imprints.length > 0 && <div className="sub">{g.imprints.map(imprintLabel).join(" · ")}</div>}
                            {li === 0 && (c.groups[gi]?.finishing.length || 0) > 0 && <div className="sub">Finishing: {c.groups[gi].finishing.map((f) => f.name).join(", ")}</div>}
                            <div className="sizechips">{SIZES.filter((s) => l.sizes?.[s]).map((s) => <span key={s}>{sizeLabel(s)} {l.sizes[s]}</span>)}</div>
                          </td>
                          <td className="r">{lc?.qty}</td>
                          <td className="r">{money(lc?.each)}</td>
                          <td className="r">{money(lc?.sub)}</td>
                        </tr>
                      );
                    }))}
                    {c.setup > 0 && <tr><td>Setup (screens / digitizing)</td><td /><td /><td className="r">{money(c.setup)}</td></tr>}
            {c.materials > 0 && <tr><td>2XL+ Materials Charge</td><td /><td /><td className="r">{money(c.materials)}</td></tr>}
                    {o.fees.filter((f) => +f.amount).map((f, i) => <tr key={i}><td>{f.label || "Fee"}</td><td /><td /><td className="r">{money(+f.amount)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              {o.notes && <div className="panel-b" style={{ borderTop: "1px solid var(--line-2)", whiteSpace: "pre-wrap" }}><div className="lbl">Notes</div>{o.notes}</div>}
            </section>

            <section className="panel" id="proofs">
              <div className="panel-h"><h2>Artwork proofs</h2></div>
              <div className="panel-b">
                {proofs.length ? (
                  <div className="proofs">{proofs.map((pf) => <ProofCard key={pf.id} proof={pf} disabled={preview} defaultName={ctx.customers.find((x) => x.id === o.customer_id)?.name || ""} />)}</div>
                ) : <div className="muted" style={{ fontSize: 13 }}>{o.type === "quote" ? "Mockups will show up here after you approve the quote." : "We'll post your artwork proof here for approval."}</div>}
              </div>
            </section>

            <section className="panel" id="messages">
              <div className="panel-h"><h2>Messages</h2></div>
              <div className="panel-b"><MessageThread orderId={o.id} messages={messages} disabled={preview} shopName={ctx.settings.shop.name} /></div>
            </section>
          </div>

          <aside className="stack">
            <section className="panel">
              <div className="panel-h"><h2>Summary</h2></div>
              <div className="panel-b">
                <div className="totals">
                  <div className="tr"><span>Subtotal</span><span>{money(c.items + c.setup + c.materials + c.fees)}</span></div>
                  {c.discount ? <div className="tr"><span>Discount{o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}</span><span>−{money(c.discount)}</span></div> : null}
                  <div className="tr"><span>Tax{o.tax_exempt ? " (exempt)" : ""}</span><span>{money(c.tax)}</span></div>
                  <div className="tr big"><span>Total</span><span>{money(c.total)}</span></div>
                  <div className="tr"><span>Paid</span><span>{money(c.paid)}</span></div>
                  <div className="tr bal"><span>Balance</span><span style={{ color: c.balance > 0.004 ? "var(--ink)" : "var(--ok)" }}>{money(c.balance)}</span></div>
                </div>
              </div>
            </section>
            <section className="panel" id="pay">
              <div className="panel-h"><h2>Payment</h2></div>
              <div className="panel-b stack">
                {canPay && !onlinePay ? (
                  <div className="stack" style={{ gap: 6, fontSize: 13 }}>
                    <b className="num" style={{ fontSize: 15 }}>Balance due: {money(c.balance)}</b>
                    <span className="muted">Pay by card, cash or check when you pick up, or call us to pay by phone{ctx.settings.shop.phone ? ` at ${ctx.settings.shop.phone}` : ""}.</span>
                  </div>
                ) : canPay ? (
                  <PayBox orderId={o.id} disabled={preview} balance={money(c.balance)} deposit={c.paid < 0.005 && deposit < c.balance - 0.004 ? { pct: ctx.settings.depositPct, label: money(deposit) } : null} />
                ) : o.type === "quote" ? (
                  <div className="muted" style={{ fontSize: 13 }}>You can pay online after you approve the quote.</div>
                ) : <div className="okmsg"><b>Paid in full.</b> Thank you!</div>}
                {payments.length > 0 && <div>{payments.map((x) => <div key={x.id} className="pay-row"><span>{fmtDate(x.paid_on)} · {x.method}</span><b className="num">{money(x.amount)}</b></div>)}</div>}
              </div>
            </section>
            <section className="panel">
              <div className="panel-h"><h2>Questions?</h2></div>
              <div className="panel-b stack" style={{ fontSize: 13 }}>
                <span className="muted">Send us a message on this page, or reach {ctx.settings.shop.name} directly:</span>
                {ctx.settings.shop.phone && <span>{ctx.settings.shop.phone}</span>}
                {ctx.settings.shop.email && <span>{ctx.settings.shop.email}</span>}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
