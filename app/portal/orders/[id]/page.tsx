import PortalGoods from "@/components/PortalGoods";
import { StarOrder } from "@/components/PortalDashBits";
import { needsGoods } from "@/lib/goods";
import { loadGoodsItems } from "@/lib/goodsServer";
import { proofViewed } from "@/lib/proofs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalCtx, signProofs } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import ImprintSpecs from "@/components/ImprintSpecs";
import { calcOrder, orderGroups, PAY_TERMS, payDueDate, sizeLabel, SIZES, type Message, type Order, type Payment, type Proof } from "@/lib/pricing";
import { fmtDate, fmtDateLong, fmtStamp, money } from "@/lib/format";
import { Pill, pvStatusOf } from "@/components/bits";
import { customerHold, customerStatus, type Flag } from "@/lib/orderStages";
import { payState } from "@/lib/payReady";
import { MessageThread, OrderActions, PayButton, ProofCard, QuoteApproval, ReorderButton } from "./client";
import { fmtPhone } from "@/lib/phone";

// the order's steps the customer sees (Oct 24, Nick: "sent to FBS, quote, proof, approved, and then you'd have waiting on
// goods… in production, ready, and then done"); a quote and its proof usually go out together
const STEPS: { label: string; keys: string[] }[] = [
  { label: "Sent to FBS", keys: ["request"] },
  { label: "Quote", keys: ["quote_sent"] },
  { label: "Proof", keys: ["art"] },
  { label: "Approved", keys: ["approved"] },
  { label: "Waiting on goods", keys: ["blanks"] },
  { label: "In production", keys: ["production"] },
  { label: "Ready", keys: ["ready"] },
  { label: "Done", keys: ["completed"] },
];
// orders run here (not from Printavo): the customer statuses (Oct 21, the order statuses doc). The shop's steps
// (goods, film, screens, press) are never shown: it's all "In production"
const CSTEPS: { label: string; keys: string[] }[] = [
  { label: "Sent to FBS", keys: ["request"] },
  { label: "Quote", keys: ["quote", "quote_sent", "changes"] },
  { label: "Proof", keys: ["proof"] },
  { label: "Approved", keys: ["approved"] },
  { label: "Waiting on goods", keys: ["goods"] },
  { label: "In production", keys: ["production", "waiting", "delayed"] },
  { label: "Ready", keys: ["ready", "shipped", "delivered"] },
  { label: "Done", keys: ["completed"] },
];

/** "Unisex EcoSmart® Crewneck Sweatshirt - P160" after "P160": the style number once (Oct 24, Nick's phone photo) */
const garmentName = (g?: string | null, style?: string | null) => {
  const t = String(g || "").trim(), st = String(style || "").trim().toLowerCase();
  const head = t.slice(0, t.length - st.length);
  return st && t.toLowerCase().endsWith(st) && /(\s-|\.)\s*$/.test(head) ? head.replace(/(\s-|\.)\s*$/, "").trim() : t;
};

export default async function PortalOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string; paid?: string; sent?: string; reviewed?: string; sewout?: string }> }) {
  const { id } = await params;
  const { as, paid: justPaid, sent: justSent, reviewed, sewout: sewDone } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}`);
  const { data: od } = await ctx.db.from("orders").select("*").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).neq("status", "quote").maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  // a request the customer hasn't sent in yet opens in the order builder
  if (o.status === "request" && !o.submitted_at) redirect(`/portal/request/${id}${as ? `?as=${as}` : ""}`);
  const isReq = o.status === "request";
  const [p, pr, m] = await Promise.all([
    ctx.db.from("payments").select("*").eq("order_id", id).order("paid_on"),
    ctx.db.from("proofs").select("*").eq("order_id", id).not("version", "is", null).is("archived_at", null).order("created_at", { ascending: false }),
    ctx.db.from("messages").select("*").eq("order_id", id).order("created_at"),
  ]);
  // the customer opened their proof (not staff looking at their portal): shown to the shop on the order (lib/proofs.ts)
  if (!ctx.isStaff && (pr.data || []).length) await proofViewed(createAdminClient(), id).catch(() => null);
  const payments = (p.data || []) as Payment[];
  const proofs = await signProofs((pr.data || []) as Proof[]);
  const goodsHere = needsGoods(o as never) ? await loadGoodsItems(createAdminClient(), [o] as never, "customer", (x) => `/portal/orders/${x}${ctx.preview ? `?as=${ctx.preview.id}` : ""}`) : [];
  // the mockup they made comes with the order (Oct 24, Nick: "it doesn't show the art, even though they're the ones that
  // created it… it should just come along with it"): its shirts, from their Mockup Creator mockup or their own file
  // the mockup FBS made shows too once it's a real order (Oct 24, Nick on the order page: "Can't see the art"); a quote
  // still waits for its proof
  const realOrder = o.type === "invoice" && o.status !== "request";
  const mkGroups = orderGroups(o).filter((g) => g.fromMockup || (g.customerMockups || []).length || (realOrder && (g.mockupThumbs || []).length));
  const mkPaths = [...new Set(mkGroups.flatMap((g) => (g.mockupThumbs && g.mockupThumbs.length ? g.mockupThumbs : (g.customerMockups || []).map((x) => x.path)).filter((x) => !/\.pdf$/i.test(x))))];
  const mkUrls: Record<string, string> = {};
  if (mkPaths.length) { const { data: sg } = await createAdminClient().storage.from("proofs").createSignedUrls(mkPaths, 3600); mkPaths.forEach((pth, i) => { if (sg?.[i]?.signedUrl) mkUrls[pth] = sg[i].signedUrl!; }); }
  const messages = (m.data || []) as Message[];
  // sew-outs: the photo of their logo stitched on our machine, to approve (lib/sewouts.ts)
  const { data: swData } = await ctx.db.from("sewouts").select("id, version, photo_path, status, sent_at, decided_name, decided_at").eq("order_id", id).is("archived_at", null).order("created_at", { ascending: false });
  const sewouts = (swData || []) as { id: string; version: number; photo_path: string; status: string; sent_at: string | null; decided_name: string | null; decided_at: string | null }[];
  const swSigned = sewouts.length ? (await createAdminClient().storage.from("proofs").createSignedUrls(sewouts.map((x) => x.photo_path), 3600)).data || [] : [];
  const pendingSew = sewouts.filter((x) => x.status === "pending");
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

  // the customer status, for orders run here; a Printavo-run job keeps its old wording
  const runHere = !pvStatusOf(o as never);
  const cs = runHere ? customerStatus({ status: o.status, flags: ((o as { flags?: Flag[] }).flags || []) as Flag[], delivery_method: o.delivery_method }, { proofSent: proofs.length > 0 }) : null;
  const steps = cs ? CSTEPS : STEPS;
  const hold = !["completed", "void"].includes(o.status) ? customerHold(((o as { flags?: Flag[] }).flags || []) as Flag[]) : null;
  const curIdx = cs ? CSTEPS.findIndex((s) => s.keys.includes(cs.key)) : STEPS.findIndex((s) => s.keys.includes(o.status));
  const pendingProofs = proofs.filter((x) => x.status === "pending");
  const deposit = Math.min(c.balance, Math.round(c.total * ctx.settings.depositPct) / 100);
  // what can be paid now (Oct 24, Nick: not always the whole balance; lib/payReady.ts)
  const ps = payState(o as typeof o & { pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, { paid: c.paid, depositPct: ctx.settings.depositPct });
  const canPay = c.balance > 0.004 && ps.can !== "none" && (o.type === "invoice" || o.status === "quote_sent");

  return (
    <>
      {preview && <div className="preview-bar">Preview of {ctx.preview!.company || ctx.preview!.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <Link className="back" href={back}>← All orders</Link>
        <div className="page-head" style={{ margin: 0 }}>
          <div>
            <div className="eyebrow">{o.type === "quote" ? "Quote" : "Order"} #{o.number}</div>
            <h1>{o.nickname || "Your Order"}</h1>
            <div className="muted" style={{ marginTop: 6 }}>{c.qty} pieces{o.due_date ? ` · in hands ${fmtDateLong(o.due_date)}` : ""}{o.po_number ? ` · PO ${o.po_number}` : ""}{o.delivery_method === "ship" ? " · shipping" : o.delivery_method === "deliver" ? " · delivery" : ""}{o.tracking ? ` · tracking ${o.tracking}` : ""}</div>
          </div>
          <div className="row">
            {cs ? <span className="pill" title={cs.text}>{cs.label}</span> : <Pill status={o.status} portal />}
            {!["completed", "void"].includes(o.status) && <StarOrder id={o.id} on={!!(o as typeof o & { customer_starred_at?: string | null }).customer_starred_at} canAct={!preview} label />}
            {o.type === "invoice" && <ReorderButton orderId={o.id} disabled={preview} />}
            {(() => { const x = o as typeof o & { submitted_at?: string | null; staff_seen_at?: string | null; customer_archived_at?: string | null; cancel_requested_at?: string | null };
              const kind = x.status === "request" ? (x.staff_seen_at ? "seen" : "unseen") : x.type === "quote" ? "quote" : x.status === "completed" ? null : "order";
              return kind ? <OrderActions orderId={x.id} kind={kind} archived={!!x.customer_archived_at} cancelAsked={!!x.cancel_requested_at} disabled={preview} /> : null; })()}
            <a className="btn" href={`/print/${o.id}${preview ? `?as=${ctx.preview!.id}` : ""}`} target="_blank" rel="noreferrer">Print or save PDF</a>
          </div>
        </div>

        {/* on hold: a stamp across the steps, and why (Oct 24, Nick) */}
        <div className={"panel" + (hold ? " po-held" : "")}><div className="panel-b">
          {hold && <span className="hold-stamp big" aria-hidden>On hold</span>}
          <div className="stepper" aria-label="Order progress">
            {steps.map((s, i) => (
              <div key={s.label} className={"step" + (i < curIdx ? " done" : "") + (i === curIdx ? " cur" : "")}>
                <span className="dot">{i < curIdx ? "✓" : ""}</span>{s.label}
              </div>
            ))}
          </div>
        </div></div>

        {hold ? (
          <div className="callout warn po-hold">
            <h2>This order is on hold: {hold.title}</h2>
            <div className="muted">{hold.reason}</div>
            <div className="row" style={{ gap: 8 }}>
              <a className="btn primary sm" href={hold.fix === "pay" ? `/portal?area=payments${preview ? `&as=${ctx.preview!.id}` : ""}` : hold.fix === "goods" ? "#goods" : "#messages"}>{hold.fix === "pay" ? "Pay now" : hold.fix === "goods" ? "See your goods" : hold.fix === "art" ? "Send new art in Messages" : "Reply in Messages"}</a>
              {hold.fix !== "reply" && hold.fix !== "art" && <a className="btn sm" href="#messages">Ask us</a>}
            </div>
          </div>
        ) : cs && (cs.key === "waiting" || cs.key === "delayed") && <div className={"callout" + (cs.key === "waiting" ? " warn" : "")}><h2>{cs.label}</h2><div className="muted">{cs.text}</div></div>}
        {reviewed && <div className="callout good"><h2>{reviewed === "approved" ? "Thanks, your artwork is approved" : reviewed === "approved_changes" ? "Thanks, approved with your changes" : "Thanks, we got your changes"}</h2><div className="muted">{reviewed === "approved" ? "We'll start printing." : reviewed === "approved_changes" ? "We'll make those changes and print. You won't get another proof." : "We'll send you a new proof to look over."}</div></div>}
        {sewDone && <div className="callout good"><h2>{sewDone === "approved" ? "Thanks, your sew-out is approved" : "Thanks, we got your changes"}</h2><div className="muted">{sewDone === "approved" ? "We'll run your order. It's kept on file for reorders." : "We'll fix it and send you a new sew-out."}</div></div>}
        {pendingSew.length > 0 && (
          <div className="callout" style={{ borderColor: "color-mix(in srgb, #A152C9 45%, var(--line))", background: "color-mix(in srgb, #A152C9 10%, var(--surface))" }}>
            <h2>Your sew-out is ready to approve</h2>
            <div className="muted">Here&apos;s your logo stitched on our machine. Look it over and approve it, or tell us what to change.</div>
            <a className="btn primary" href={`/portal/orders/${o.id}/sewout/${pendingSew[0].id}${preview ? `?as=${ctx.preview!.id}` : ""}`} style={{ alignSelf: "flex-start" }}>Review the sew-out</a>
          </div>
        )}
        {justPaid && <div className="callout good"><h2>Thank you, payment received</h2><div className="muted">It can take a minute to show below. You&apos;ll get a receipt by email from our payment processor.</div></div>}

        {isReq && (
          <div className="callout good">
            <h2>{justSent ? "Thanks! Your order is in." : "We're reviewing your order"}</h2>
            <div className="muted">We&apos;ll check your garments and artwork, price everything and send it back here for your final OK. Questions? Send us a message below.</div>
          </div>
        )}
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
                  <thead><tr><th>Item</th><th className="r">Qty</th>{!isReq && <th className="r">Each</th>}{!isReq && <th className="r">Amount</th>}</tr></thead>
                  <tbody>
                    {orderGroups(o).map((g, gi) => [
                      // the group's mockup above its garments (Oct 24, Nick: "Can't see the art"; not tied to one garment)
                      ...(() => { const pics = (g.mockupThumbs && g.mockupThumbs.length ? g.mockupThumbs : (g.customerMockups || []).map((x) => x.path)).filter((x) => mkUrls[x]); return pics.length ? [<tr key={g.id + "-art"} className="po-grp-art"><td colSpan={4}><a className="po-item-pics" href="#proofs">{pics.slice(0, 4).map((x) => <img key={x} src={mkUrls[x]} alt="Mockup" loading="lazy" />)}</a></td></tr>] : []; })(),
                      ...g.lines.map((l, li) => {
                      const lc = c.groups[gi]?.lines[li];
                      return (
                        <tr key={l.id}>
                          <td>
                            <b>{[l.style, garmentName(l.garment, l.style)].filter(Boolean).join(" · ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}{c.groups[gi]?.wholesale ? " (your garments)" : ""}
                            {li === 0 && g.imprints.length > 0 && <div className="sub po-item-prints"><ImprintSpecs list={g.imprints} /></div>}
                            {li === 0 && (c.groups[gi]?.finishing.length || 0) > 0 && <div className="sub">Finishing: {c.groups[gi].finishing.map((f) => f.name).join(", ")}</div>}
                            <div className="sizechips">{SIZES.filter((s) => l.sizes?.[s]).map((s) => <span key={s}>{sizeLabel(s)} {l.sizes[s]}</span>)}</div>
                          </td>
                          <td className="r">{lc?.qty}</td>
                          {!isReq && <td className="r">{money(lc?.each)}</td>}
                          {!isReq && <td className="r">{money(lc?.sub)}</td>}
                        </tr>
                      );
                    })])}
                    {!isReq && c.setup > 0 && <tr><td>Setup (screens / digitizing)</td><td /><td /><td className="r">{money(c.setup)}</td></tr>}
            {!isReq && c.materials > 0 && <tr><td>2XL+ Materials Charge</td><td /><td /><td className="r">{money(c.materials)}</td></tr>}
                    {!isReq && o.fees.filter((f) => +f.amount || (f as { free?: boolean }).free).map((f, i) => <tr key={i}><td>{f.label || "Fee"}</td><td /><td /><td className="r">{(f as { free?: boolean }).free ? "Free" : money(+f.amount)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              {o.delivery_method !== "pickup" && o.ship_to && <div className="panel-b" style={{ borderTop: "1px solid var(--line-2)", whiteSpace: "pre-wrap" }}><div className="lbl">{o.delivery_method === "ship" ? `Shipping to${o.ship_method ? ` (${o.ship_method.trim()})` : ""}` : "Delivering to"}</div>{o.ship_to}{o.tracking ? `\nTracking: ${o.tracking}` : ""}</div>}
              {o.notes && <div className="panel-b" style={{ borderTop: "1px solid var(--line-2)", whiteSpace: "pre-wrap" }}><div className="lbl">Notes</div>{o.notes}</div>}
            </section>

            <section className="panel" id="proofs">
              <div className="panel-h"><h2>{mkGroups.length && !proofs.length ? "Artwork" : "Artwork proofs"}</h2></div>
              <div className="panel-b stack">
                {mkGroups.map((g) => { const pics = (g.mockupThumbs && g.mockupThumbs.length ? g.mockupThumbs : (g.customerMockups || []).map((x) => x.path)).filter((x) => mkUrls[x]); return (
                  <div key={g.id} className="po-mock">
                    <div className="po-mock-h"><b>{g.fromMockup ? `Your mockup${g.fromMockup.number ? ` M-${g.fromMockup.number}` : ""}` : (g.customerMockups || []).length ? "Your mockup" : "Mockup"}</b><span className="faint">{g.fromMockup ? "made in our Mockup Creator" : (g.customerMockups || []).length ? "your own file" : "by FBS Print"}{g.name ? ` · ${g.name}` : ""}</span></div>
                    <div className="po-mock-pics">{pics.map((x) => <a key={x} href={mkUrls[x]} target="_blank" rel="noreferrer"><img src={mkUrls[x]} alt="Mockup" /></a>)}</div>
                    {!proofs.length && <div className="faint" style={{ fontSize: 12.5 }}>This is the art we print from. If anything needs changing, we&apos;ll send you a proof to approve.</div>}
                  </div>
                ); })}
                {proofs.length ? (
                  <div className="proofs">{proofs.map((pf) => <ProofCard key={pf.id} proof={pf} reviewHref={`/portal/orders/${o.id}/review/${pf.id}${preview ? `?as=${ctx.preview!.id}` : ""}`} />)}</div>
                ) : mkGroups.length ? null : <div className="muted" style={{ fontSize: 13 }}>{o.type === "quote" ? "Mockups will show up here after you approve the quote." : "We'll post your artwork proof here for approval."}</div>}
              </div>
            </section>

            {sewouts.length > 0 && (
              <section className="panel" id="sewouts">
                <div className="panel-h"><h2>Sew-outs</h2></div>
                <div className="panel-b">
                  <div className="proofs">{sewouts.map((x, i) => (
                    <a key={x.id} className="sow-card" href={`/portal/orders/${o.id}/sewout/${x.id}${preview ? `?as=${ctx.preview!.id}` : ""}`}>
                      {swSigned[i]?.signedUrl ? <img src={swSigned[i].signedUrl!} alt={`Sew-out version ${x.version}`} /> : null}
                      <b>Sew-out v{x.version}</b>
                      <span className="muted">{x.status === "approved" ? `Approved${x.decided_name ? ` by ${x.decided_name}` : ""}` : x.status === "changes" ? "Changes requested" : "Waiting for your approval"}</span>
                    </a>
                  ))}</div>
                </div>
              </section>
            )}

            <section className="panel" id="messages">
              <div className="panel-h"><h2>Messages</h2></div>
              <div className="panel-b"><MessageThread orderId={o.id} messages={messages} disabled={preview} shopName={ctx.settings.shop.name} /></div>
            </section>
          </div>

          <aside className="stack">
            {isReq ? (
              <section className="panel">
                <div className="panel-h"><h2>Pricing</h2></div>
                <div className="panel-b muted" style={{ fontSize: 13 }}>We&apos;re pricing your order now. You&apos;ll get an email when it&apos;s ready to approve.</div>
              </section>
            ) : <>
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
                {(() => { const t = ctx.customers.find((x) => x.id === o.customer_id)?.payment_terms || "receipt"; const d = o.type === "invoice" ? payDueDate(o, t) : null; return <div className="aa-terms"><span>Payment terms</span><b>{PAY_TERMS[t]}{d && c.balance > 0.004 ? ` · due ${fmtDateLong(d)}` : ""}</b></div>; })()}
                {canPay ? (
                  <PayButton item={{ id: o.id, number: o.number, nickname: o.nickname || "", balance: ps.can === "deposit" ? deposit : c.balance, deposit: c.paid < 0.005 && ps.can !== "deposit" ? deposit : undefined, quote: o.type === "quote", notFinal: ps.notFinal, notFinalNote: ps.note }}
                    pay={ctx.settings.pay} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} canAct={!preview} receiptEmail={preview ? "" : ctx.customers.find((x) => x.id === o.customer_id)?.email || ctx.email} />
                ) : c.balance > 0.004 && String(o.status) !== "void" ? (
                  <div className="pay-notready"><b>Not ready to pay yet</b><span>{o.type === "quote" && o.status !== "quote_sent" ? "You can pay once we send your quote." : ps.why}</span></div>
                ) : o.type === "quote" ? (
                  <div className="muted" style={{ fontSize: 13 }}>You can pay online after you approve the quote.</div>
                ) : <div className="okmsg"><b>Paid in full.</b> Thank you!</div>}
                {canPay && ps.can === "deposit" && <div className="faint" style={{ fontSize: 12.5 }}>We&apos;re asking for the deposit now. The balance is due when your order is ready.</div>}
                {canPay && ps.notFinal && <div className="pay-nf"><b>This invoice isn&apos;t final yet.</b> {ps.note || "There may be more charges (like shipping)."}</div>}
                {payments.length > 0 && <div>{payments.map((x) => <div key={x.id} className="pay-row"><span>{fmtDate(x.paid_on)} · {x.method}</span><b className="num">{money(x.amount)}</b></div>)}</div>}
              </div>
            </section>
            </>}
            {/* their goods for this order, in the side panel under Payment (Oct 24, Nick: "move the customer supplied goods to the right panel below pay") */}
            {/* earlier: (Oct 24, Nick: "another tab… customer supplied goods when it's a wholesale order… waiting on
                goods, goods received… upload tracking… it should be on each order too") */}
            {goodsHere.length > 0 && (
              <section className="panel" id="goods">
                <div className="panel-h"><h2>Customer supplied goods</h2><span className="faint">Your garments: send us tracking, see when they&apos;re here</span></div>
                <div className="panel-b"><PortalGoods items={goodsHere} canAct={!preview} qs={preview ? `?as=${ctx.preview!.id}` : ""} empty="" /></div>
              </section>
            )}
            <section className="panel">
              <div className="panel-h"><h2>Questions?</h2></div>
              <div className="panel-b stack" style={{ fontSize: 13 }}>
                <span className="muted">Send us a message on this page, or reach {ctx.settings.shop.name} directly:</span>
                {ctx.settings.shop.phone && <span>{fmtPhone(ctx.settings.shop.phone)}</span>}
                {ctx.settings.shop.email && <span>{ctx.settings.shop.email}</span>}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
