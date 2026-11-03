import PortalGoods from "@/components/PortalGoods";
import BackLink from "@/components/BackLink";
import { termsPct } from "@/lib/payTerms";
import { StarOrder } from "@/components/PortalDashBits";
import { customerSendsGoods, GOODS, trackedGoods, type GoodsStatus } from "@/lib/goods";
import { loadGoodsItems } from "@/lib/goodsServer";
import { proofViewed } from "@/lib/proofs";
import { notFound, redirect } from "next/navigation";
import { getPortalCtx, signProofs } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { colorHex } from "@/lib/inkColors";
import { needsDetails } from "@/lib/productionDetails";
import PortalArtView from "@/components/PortalArtView";
import OrderRail from "@/components/OrderRail";
import { jobFor } from "@/lib/portalJobs";
import { calcOrder, FULL_COLOR, inkNames, methodLabel, orderGroups, PAY_TERMS, payDueDate, sizeLabel, SIZES, termsText, type Message, type Order, type Payment, type Proof, withoutShopPieces } from "@/lib/pricing";
import { fmtDate, fmtDateLong, money } from "@/lib/format";
import { pvStatusOf } from "@/components/bits";
import { customerHold, customerStatus, type Flag } from "@/lib/orderStages";
import { payState } from "@/lib/payReady";
import { MessageThread, OrderActions, PayButton, ProofCard, QuoteApproval } from "./client";
import { OldReorderButton } from "@/components/PortalOldReorder";
import { fmtPhone } from "@/lib/phone";
import { orderSteps } from "@/lib/customerSend";

// our garments in words, for the order's details (the customer's own goods use GOODS[…].portal)
const BLANKS: Record<GoodsStatus, string> = { waiting: "Ordered, not here yet", on_way: "On the way", arrived: "Arrived, checking them in", partial: "Partly here", received: "All here", issue: "Issue with the garments" };

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
  const o = withoutShopPieces(od as Order); // the customer's view: never the shop's own pieces (lib/pricing.ts withoutShopPieces)
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
  // what's waiting on them on their order page (the link our Send to customer email opens, lib/customerSend.ts)
  const { data: olk } = await createAdminClient().from("proof_links").select("id").eq("kind", "order").eq("order_id", id).limit(1).maybeSingle();
  const waitingOn = olk?.id ? ((await orderSteps(createAdminClient(), olk.id))?.steps || []).filter((x) => x.state === "todo") : [];
  const payments = (p.data || []) as Payment[];
  const proofs = await signProofs((pr.data || []) as Proof[]);
  // the order's goods record (theirs or ours): their own goods get the tracking panel; every order gets a Garments line
  const goodsAll = o.type === "invoice" ? await loadGoodsItems(createAdminClient(), [o] as never, "customer", (x) => `/portal/orders/${x}${ctx.preview ? `?as=${ctx.preview.id}` : ""}`) : [];
  const goodsHere = customerSendsGoods(o as never) ? goodsAll : [];
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
  const cs = runHere ? customerStatus({ status: o.status, flags: ((o as { flags?: Flag[] }).flags || []) as Flag[], delivery_method: o.delivery_method, simple_order: (o as { simple_order?: { reorder?: unknown } | null }).simple_order }, { proofSent: proofs.length > 0 }) : null;
  const hold = !["completed", "void"].includes(o.status) ? customerHold(((o as { flags?: Flag[] }).flags || []) as Flag[]) : null;
  const pendingProofs = proofs.filter((x) => x.status === "pending");
  // the customer's payment terms decide what's paid up front (lib/payTerms.ts)
  const terms = ctx.customers.find((x) => x.id === o.customer_id)?.payment_terms || "receipt";
  const tPct = termsPct(terms, ctx.settings.depositPct);
  const deposit = Math.min(c.balance, Math.round(c.total * (tPct > 0 && tPct < 100 ? tPct : ctx.settings.depositPct)) / 100);
  // what can be paid now (Oct 24, Nick: not always the whole balance; lib/payReady.ts)
  const ps = payState(o as typeof o & { pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, { paid: c.paid, depositPct: ctx.settings.depositPct, terms });
  const canPay = c.balance > 0.004 && ps.can !== "none" && (o.type === "invoice" || o.status === "quote_sent");

  const qsAs = preview ? `?as=${ctx.preview!.id}` : "";
  // where the order is: the same steps as the home page's jobs (lib/portalJobs.ts), drawn by one piece (OrderRail)
  const job = jobFor(o, { href: "", pic: "", pendingProof: pendingProofs.length ? "1" : undefined, approvedArt: proofs.some((x) => x.status === "approved") || !!o.approved_at,
    goods: goodsAll[0]?.goods.updated_at ? goodsAll[0].goods.status : null, customerGoods: o.price_type === "wholesale", newMsgs: 0 });
  // the full proof, the page they approve from (Nov 2, Nick: "almost like what the customer sees when they approve")
  const latestProof = proofs[0];
  const proofHref = olk?.id ? `/proof/${olk.id}` : latestProof ? `/portal/orders/${o.id}/review/${latestProof.id}${qsAs}` : "";
  const cust = ctx.customers.find((x) => x.id === o.customer_id);
  const approvedProof = proofs.find((x) => x.status === "approved");
  // the garments for this order, in one line (Nov 2, Nick: "add the goods there"): ours or theirs, the same goods record
  const gi0 = goodsAll[0];
  const gShips = gi0?.shipments || [];
  const gStatus = gi0 ? trackedGoods(gi0.goods.status, gShips) : null;
  const gBoxes = gShips.reduce((a, x) => a + (+(x.boxes ?? 0) || 0), 0);
  const garmentsLine = gi0 && (gi0.goods.updated_at || gShips.length)
    ? `${o.price_type === "wholesale" ? GOODS[gStatus!].portal : BLANKS[gStatus!]}${gBoxes ? ` · ${gBoxes} box${gBoxes === 1 ? "" : "es"}` : ""}`
    : "";
  const delivery = o.delivery_method === "ship" ? `Shipping${o.ship_method ? ` (${o.ship_method.trim()})` : ""}` : o.delivery_method === "deliver" ? "Delivery" : o.delivery_method === "pickup" ? "Pickup" : "";
  const extras = isReq ? [] : [
    ...(c.setup > 0 ? [{ k: "Setup (screens / digitizing)", v: money(c.setup) }] : []),
    ...(c.materials > 0 ? [{ k: "2XL+ materials charge", v: money(c.materials) }] : []),
    ...o.fees.filter((f) => +f.amount || (f as { free?: boolean }).free).map((f) => ({ k: f.label || "Fee", v: (f as { free?: boolean }).free ? "Free" : money(+f.amount) })),
  ];

  return (
    <>
      {preview && <div className="preview-bar">Preview of {ctx.preview!.company || ctx.preview!.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main pod">
        <BackLink href={back} label="All orders" trail={false} />
        {/* the order page in the shop's look, laid out like the proof (Nov 2, Nick: "it looks so different from our other
            screens… not enough information on the page… get rid of the little bubble tracker… more like what's on the
            proof… add the goods there", option C1): title and one status line, the summary card, then each job */}
        <div className="page-head">
          <div>
            <h1>{o.nickname || "Your Order"}</h1>
            <div className="eyebrow pod-eb">
              <span>{o.type === "quote" ? "Quote" : "Order"} #{o.number}{o.due_date ? ` · in hands ${fmtDateLong(o.due_date)}` : ""}</span>
            </div>
          </div>
          <div className="row pod-acts">
            {!["completed", "void"].includes(o.status) && <StarOrder id={o.id} on={!!(o as typeof o & { customer_starred_at?: string | null }).customer_starred_at} canAct={!preview} label />}
            {/* the same Reorder pop-up as an old-system order (Nov 2, Nick): sizes, art, notes; we price it and send it back */}
            {o.type === "invoice" && <OldReorderButton archivedId={`o:${o.id}`} as={preview ? ctx.preview!.id : undefined} primary={false} />}
            {(() => { const x = o as typeof o & { submitted_at?: string | null; staff_seen_at?: string | null; customer_archived_at?: string | null; cancel_requested_at?: string | null };
              const kind = x.status === "request" ? (x.staff_seen_at ? "seen" : "unseen") : x.type === "quote" ? "quote" : x.status === "completed" ? null : "order";
              return kind ? <OrderActions orderId={x.id} kind={kind} archived={!!x.customer_archived_at} cancelAsked={!!x.cancel_requested_at} disabled={preview} /> : null; })()}
            <a className="btn" href={`/print/${o.id}${qsAs}`} target="_blank" rel="noreferrer">Print or save PDF</a>
          </div>
        </div>

        {String(o.status) !== "void" && <div className="pod-railw"><OrderRail steps={job.steps} done={o.status === "completed"} />{hold && <span className="hold-stamp">On hold</span>}</div>}

        {/* the numbers in one summary card, like the shop's pages: what it costs, what's paid, what's left */}
        {!isReq && <div className="stats pod-stats">
          <a className="stat" href="#items"><span className="k">Pieces</span><span className="v">{c.qty.toLocaleString("en-US")}</span><small>{orderGroups(o).length === 1 ? "1 job" : `${orderGroups(o).length} jobs`}</small></a>
          <a className="stat" href="#pay"><span className="k">Total</span><span className="v">{money(c.total)}</span><small>with tax{c.tax ? ` (${money(c.tax)})` : o.tax_exempt ? " exempt" : ""}</small></a>
          <a className="stat" href="#pay"><span className="k">Paid</span><span className="v">{money(c.paid)}</span><small>{payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"}` : "Nothing yet"}</small></a>
          <a className="stat" href="#pay"><span className="k">Balance</span><span className={"v" + (c.balance <= 0.004 && c.total > 0 ? " pod-ok" : "")}>{c.balance <= 0.004 && c.total > 0 ? "Paid in full" : money(c.balance)}</span><small>{c.balance > 0.004 ? (canPay ? "Ready to pay" : "Not due yet") : o.type === "quote" ? "After you approve" : "Thank you"}</small></a>
        </div>}

        {/* one place for everything waiting on them: the same page our email's button opens */}
        {olk?.id && waitingOn.length > 0 && <div className="callout warn po-wait">
          <h2>Waiting on you: {waitingOn.map((x) => x.kind === "art" ? "your proof" : x.kind === "sewout" ? "your sew-out" : x.kind === "quote" ? "your quote" : "the deposit").filter((v, i, a) => a.indexOf(v) === i).join(", ")}</h2>
          <div className="muted">Look it over and approve it on one page.</div>
          <a className="btn primary" style={{ marginTop: 8 }} href={`/proof/${olk.id}`}>Review and approve</a>
        </div>}
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
            <a className="btn primary" href={`/portal/orders/${o.id}/sewout/${pendingSew[0].id}${qsAs}`} style={{ alignSelf: "flex-start" }}>Review the sew-out</a>
          </div>
        )}
        {justPaid && <div className="callout good"><h2>Thank you, payment received</h2><div className="muted">It can take a minute to show below. You&apos;ll get a receipt by email from our payment processor.</div></div>}
        {isReq && (
          <div className="callout good">
            <h2>{(o as { simple_order?: { reorder?: unknown } | null }).simple_order?.reorder ? "Reorder pending approval" : justSent ? "Thanks! Your order is in." : "We're reviewing your order"}</h2>
            <div className="muted">We&apos;ll check your garments and artwork, price everything and send it back here for your final OK. Questions? Send us a message below.</div>
          </div>
        )}
        {/* one way to approve: the review page when there is one (the "Waiting on you" box above), else here */}
        {o.status === "quote_sent" && !waitingOn.some((x) => x.kind === "quote") && <QuoteApproval orderId={o.id} total={money(c.total)} terms={[termsText(terms, o.delivery_method === "pickup"), /deposit|balance|due|pay/i.test(ctx.settings.shop.terms || "") ? "" : ctx.settings.shop.terms].filter(Boolean).join(" ")} disabled={preview} defaultName={cust?.name || ""} />}
        {/* the proof is already asked for in "Waiting on you" above: not a second box for it */}
        {pendingProofs.length > 0 && !waitingOn.some((x) => x.kind === "art") && (
          <div className="callout" style={{ borderColor: "color-mix(in srgb, #A152C9 45%, var(--line))", background: "color-mix(in srgb, #A152C9 10%, var(--surface))" }}>
            <h2>Artwork ready for your review</h2>
            <div className="muted">Please approve each proof or tell us what to change. We start printing once artwork is approved.</div>
            <a className="btn primary" href="#proofs" style={{ alignSelf: "flex-start" }}>Review artwork below</a>
          </div>
        )}

        <div className="two pod-two">
          <div className="stack" id="items">
            {/* each job like the proof: its mockups, what's printed where (method, size, inks with their colors), then the
                garments by size with their prices */}
            {orderGroups(o).map((g, gi) => {
              const cg = c.groups[gi];
              const pics = (g.mockupThumbs && g.mockupThumbs.length ? g.mockupThumbs : (g.customerMockups || []).map((x) => x.path)).filter((x) => mkUrls[x]);
              const used = SIZES.filter((s) => g.lines.some((l) => +(l.sizes?.[s] || 0) > 0));
              const grid = used.length > 0 && used.length <= 7;
              const gq = g.lines.reduce((a, _l, li) => a + (cg?.lines[li]?.qty || 0), 0);
              return (
                <section key={g.id} className="panel pod-grp">
                  <div className="panel-h"><h2>{g.name || (orderGroups(o).length > 1 ? `Job ${gi + 1}` : o.nickname || "Your order")}</h2><span className="faint">{gq.toLocaleString("en-US")} pieces{cg?.wholesale ? " · your garments" : ""}</span>{proofHref && <a className="btn sm pod-proof" href={proofHref}>View proof</a>}</div>
                  {g.description && <div className="panel-b pod-desc">{g.description}</div>}
                  <div className="panel-b pod-g">
                    {pics.length > 0 && <div className="pod-art"><PortalArtView pics={pics.slice(0, 8).map((x) => mkUrls[x])} open={proofHref || undefined} /></div>}
                    <div className="pod-spec">
                      {g.imprints.length > 0 ? (
                        <table className="tbl pod-prints">
                          <thead><tr><th>Print</th><th>Method</th><th>Size</th><th>Inks</th></tr></thead>
                          <tbody>{g.imprints.map((d, k) => {
                            const reorder = needsDetails(d);
                            const inks = inkNames(d.inks || "");
                            return (
                              <tr key={d.id || k}>
                                <td><b>{d.location || "Print"}</b></td>
                                <td>{methodLabel(d)}{(d.method === "screen" || d.method === "embroidery") && d.colors ? <div className="sub">{d.method === "screen" && d.colors >= FULL_COLOR ? "Full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`}</div> : null}</td>
                                <td className="pod-nw">{d.size || "—"}</td>
                                <td>{reorder ? <span className="faint">Matches your previous order</span> : inks.length ? <span className="pod-inks">{inks.map((n) => { const hx = colorHex(n); return <span key={n} className="pod-ink"><i style={{ background: hx || "var(--surface-2)" }} aria-hidden />{n}</span>; })}</span> : "—"}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      ) : <div className="faint">No prints on this job.</div>}
                      {(cg?.finishing.length || 0) > 0 && <div className="pod-fin"><span className="lbl">Finishing</span>{cg!.finishing.map((f) => f.name).join(", ")}</div>}
                    </div>
                  </div>
                  <div className="tbl-wrap pod-lines">
                    <table className="tbl">
                      <thead><tr><th>Garment</th>{grid ? used.map((s) => <th key={s} className="r">{sizeLabel(s)}</th>) : <th>Sizes</th>}<th className="r">Qty</th>{!isReq && <th className="r">Each</th>}{!isReq && <th className="r">Total</th>}</tr></thead>
                      <tbody>{g.lines.map((l, li) => {
                        const lc = cg?.lines[li];
                        return (
                          <tr key={l.id}>
                            <td><b>{l.style || "Garment"}</b> {garmentName(l.garment, l.style)}{l.color ? <div className="sub">{l.color}</div> : null}</td>
                            {grid ? used.map((s) => <td key={s} className="r num">{+(l.sizes?.[s] || 0) || ""}</td>) : <td><div className="sizechips">{SIZES.filter((s) => l.sizes?.[s]).map((s) => <span key={s}>{sizeLabel(s)} {l.sizes[s]}</span>)}</div></td>}
                            <td className="r num b">{lc?.qty}</td>
                            {!isReq && <td className="r num">{money(lc?.each)}</td>}
                            {!isReq && <td className="r num b">{money(lc?.sub)}</td>}
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            {(extras.length > 0 || o.notes) && (
              <section className="panel">
                <div className="panel-h"><h2>{extras.length ? "Other charges" : "Notes"}</h2></div>
                {extras.length > 0 && <div className="panel-b pod-x">{extras.map((x, i) => <div key={i} className="pod-row"><span>{x.k}</span><b className="num">{x.v}</b></div>)}</div>}
                {o.notes && <div className="panel-b" style={{ borderTop: extras.length ? "1px solid var(--line-2)" : 0, whiteSpace: "pre-wrap" }}>{extras.length ? <div className="lbl">Notes</div> : null}{o.notes}</div>}
              </section>
            )}

            {(proofs.length > 0 || mkGroups.length === 0) && <section className="panel" id="proofs">
              <div className="panel-h"><h2>Artwork proofs</h2></div>
              <div className="panel-b stack">
                {proofs.length ? (
                  <div className="proofs">{proofs.map((pf) => <ProofCard key={pf.id} proof={pf} reviewHref={`/portal/orders/${o.id}/review/${pf.id}${qsAs}`} />)}</div>
                ) : <div className="muted" style={{ fontSize: 13 }}>{o.type === "quote" ? "Mockups will show up here after you approve the quote." : "We'll post your artwork proof here for approval."}</div>}
              </div>
            </section>}

            {sewouts.length > 0 && (
              <section className="panel" id="sewouts">
                <div className="panel-h"><h2>Sew-outs</h2></div>
                <div className="panel-b">
                  <div className="proofs">{sewouts.map((x, i) => (
                    <a key={x.id} className="sow-card" href={`/portal/orders/${o.id}/sewout/${x.id}${qsAs}`}>
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
            {/* the order's facts in one place, like the top of the proof */}
            <section className="panel">
              <div className="panel-h"><h2>Order details</h2></div>
              <div className="panel-b pod-kv">
                <span>{o.type === "quote" ? "Quote" : "Order"}</span><b>#{o.number}</b>
                {o.po_number ? <><span>PO</span><b>{o.po_number}</b></> : null}
                <span>Ordered</span><b>{fmtDateLong(String(o.created_at || "").slice(0, 10))}</b>
                {o.due_date ? <><span>In hands</span><b>{fmtDateLong(o.due_date)}</b></> : null}
                {delivery ? <><span>Delivery</span><b>{delivery}</b></> : null}
                {o.delivery_method !== "pickup" && o.ship_to ? <><span>{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</span><b className="pod-addr">{o.ship_to}</b></> : null}
                {o.tracking ? <><span>Tracking</span><b className="pod-addr">{o.tracking}</b></> : null}
                {cust?.name ? <><span>Contact</span><b>{cust.name}</b></> : null}
                {o.approved_at ? <><span>Approved</span><b>{fmtDate(o.approved_at)}{o.approved_name ? ` by ${o.approved_name}` : ""}</b></> : null}
                {approvedProof ? <><span>Proof</span><b>Approved {fmtDate(approvedProof.decided_at || approvedProof.created_at)}</b></> : null}
                {garmentsLine ? <><span>Garments</span><b><a href={goodsHere.length ? "#goods" : `/portal?area=goods${preview ? `&as=${ctx.preview!.id}` : ""}`}>{garmentsLine}</a></b></> : null}
              </div>
            </section>

            {isReq ? (
              <section className="panel">
                <div className="panel-h"><h2>Pricing</h2></div>
                <div className="panel-b muted" style={{ fontSize: 13 }}><b>TBD.</b> We&apos;re pricing your order now. You&apos;ll get an email when it&apos;s ready to approve.</div>
              </section>
            ) : (
              <section className="panel" id="pay">
                <div className="panel-h"><h2>Payment</h2></div>
                <div className="panel-b stack">
                  {/* plain rows in the page's own type, like the rest of the shop (Nov 2, Nick: "hard to read, the dollar
                      amounts… doesn't look like the rest of our system"): each payment under the total, then what's left */}
                  <div className="pod-pay">
                    <div className="pod-row"><span>Subtotal</span><b>{money(c.items + c.setup + c.materials + c.fees)}</b></div>
                    {c.discount ? <div className="pod-row"><span>Discount{o.discount_type !== "amt" && o.discount_pct ? ` (${o.discount_pct}%)` : ""}</span><b>−{money(c.discount)}</b></div> : null}
                    <div className="pod-row"><span>Tax{o.tax_exempt ? " (exempt)" : ""}</span><b>{money(c.tax)}</b></div>
                    <div className="pod-row pod-tot"><span>Total</span><b>{money(c.total)}</b></div>
                    {payments.map((x) => <div key={x.id} className="pod-row pod-pd"><span>Paid {fmtDate(x.paid_on)} · {x.method}</span><b>−{money(+x.amount)}</b></div>)}
                    <div className={"pod-row pod-tot" + (c.balance <= 0.004 && c.total > 0 ? " pod-zero" : "")}><span>Balance</span><b>{money(Math.max(0, c.balance))}</b></div>
                    {(() => { const d = o.type === "invoice" ? payDueDate(o, terms) : null; return <div className="pod-row pod-terms"><span>Terms</span><b>{PAY_TERMS[terms]}{d && c.balance > 0.004 ? ` · due ${fmtDateLong(d)}` : ""}</b></div>; })()}
                  </div>
                  {canPay ? (
                    <PayButton item={{ id: o.id, number: o.number, nickname: o.nickname || "", balance: ps.can === "deposit" ? deposit : c.balance, deposit: c.paid < 0.005 && ps.can !== "deposit" ? deposit : undefined, quote: o.type === "quote", notFinal: ps.notFinal, notFinalNote: ps.note }}
                      pay={ctx.settings.pay} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} canAct={!preview} receiptEmail={preview ? "" : cust?.email || ctx.email} due={false} />
                  ) : c.balance > 0.004 && String(o.status) !== "void" ? (
                    <div className="pay-notready"><b>Not ready to pay yet</b><span>{o.type === "quote" && o.status !== "quote_sent" ? "You can pay once we send your quote." : ps.why}</span></div>
                  ) : o.type === "quote" ? (
                    <div className="muted" style={{ fontSize: 13 }}>You can pay online after you approve the quote.</div>
                  ) : <div className="okmsg"><b>Paid in full.</b> Thank you!</div>}
                  {canPay && ps.can === "deposit" && <div className="faint" style={{ fontSize: 12.5 }}>We&apos;re asking for the deposit now. The balance is due when your order is ready.</div>}
                  {canPay && ps.notFinal && <div className="pay-nf"><b>This invoice isn&apos;t final yet.</b> {ps.note || "There may be more charges (like shipping)."}</div>}
                </div>
              </section>
            )}

            {/* their goods for this order, in the side panel under Payment (Oct 24, Nick) */}
            {goodsHere.length > 0 && (
              <section className="panel" id="goods">
                <div className="panel-h"><h2>Customer supplied goods</h2><span className="faint">Your garments: send us tracking, see when they&apos;re here</span></div>
                <div className="panel-b"><PortalGoods items={goodsHere} canAct={!preview} qs={qsAs} empty="" /></div>
              </section>
            )}

            {/* the papers for this order: the invoice, each proof, each mockup */}
            <section className="panel">
              <div className="panel-h"><h2>Files</h2></div>
              <div className="panel-b pod-files">
                <a href={`/print/${o.id}${qsAs}`} target="_blank" rel="noreferrer"><span className="pod-fi">PDF</span>{o.type === "quote" ? "Quote" : "Invoice"} #{o.number}</a>
                {proofs.map((pf) => <a key={pf.id} href={pf.status === "pending" ? `/portal/orders/${o.id}/review/${pf.id}${qsAs}` : pf.url || "#"} target={pf.status === "pending" ? undefined : "_blank"} rel="noreferrer"><span className="pod-fi">{pf.file_type.includes("pdf") ? "PDF" : "IMG"}</span>{pf.title || `Proof v${pf.version || 1}`}<small>{pf.status === "approved" ? "Approved" : pf.status === "changes" ? "Changes asked" : "To review"}</small></a>)}
                {mkPaths.filter((x) => mkUrls[x]).slice(0, 8).map((x, i) => <a key={x} href={mkUrls[x]} target="_blank" rel="noreferrer"><span className="pod-fi">IMG</span>Mockup {i + 1}</a>)}
              </div>
            </section>

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
