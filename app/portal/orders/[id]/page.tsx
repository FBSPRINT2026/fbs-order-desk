import { asCustomerSees, designSpecsFor, SENT_OR_SHOWN } from "@/lib/portalView";
import { cardFeeInOrder } from "@/lib/cardFeeIn";
import PortalGoods from "@/components/PortalGoods";
import PortalAttachments from "@/components/PortalAttachments";
import { Fragment } from "react";
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
import { MessageThread, OrderActions, PayButton, ProofCard } from "./client";
import { OldReorderButton } from "@/components/PortalOldReorder";
import { fmtPhone } from "@/lib/phone";
import { orderSteps } from "@/lib/customerSend";
import { approveHref, REVIEW_KINDS, reviewWords } from "@/lib/portalApprove";
import PortalItems from "@/components/PortalItems";
import { isSimpleKind, kindLabel, linePic } from "@/lib/simpleOrders";

// our garments in words, for the order's details (the customer's own goods use GOODS[…].portal)
const BLANKS: Record<GoodsStatus, string> = { waiting: "Ordered, not here yet", on_way: "On the way", arrived: "Arrived, checking them in", partial: "Partly here", received: "All here", issue: "Issue with the garments" };

/** "Unisex EcoSmart® Crewneck Sweatshirt - P160" after "P160": the style number once (Oct 24, Nick's phone photo) */
const garmentName = (g?: string | null, style?: string | null) => {
  const t = String(g || "").trim(), st = String(style || "").trim().toLowerCase();
  const head = t.slice(0, t.length - st.length);
  return st && t.toLowerCase().endsWith(st) && /(\s-|\.)\s*$/.test(head) ? head.replace(/(\s-|\.)\s*$/, "").trim() : t;
};

export default async function PortalOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string; paid?: string; sent?: string; reviewed?: string; sewout?: string; view?: string; pay?: string }> }) {
  const { id } = await params;
  const { as, paid: justPaid, sent: justSent, reviewed, sewout: sewDone, view, pay: payOpen } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}`);
  const { data: od } = await ctx.db.from("orders").select("*").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).or(SENT_OR_SHOWN).maybeSingle();
  if (!od) notFound();
  const o0 = od ? (await (await import("@/lib/orderFollows")).withMyFollows(createAdminClient(), [od as Order], ctx.email, !!ctx.preview))[0] : od;
  const o = withoutShopPieces(asCustomerSees(o0 as Order, ctx.settings, await designSpecsFor(ctx.db, [o0 as Order]))); // the customer's view: never the shop's own pieces (lib/pricing.ts withoutShopPieces)
  // a request the customer hasn't sent in yet opens in the order builder
  if (o.status === "request" && !o.submitted_at) redirect(`/portal/request/${id}${as ? `?as=${as}` : ""}`);
  const isReq = o.status === "request";
  // a simple order: what they sent (Nov 2, Nick: the McKenna job brought in from ClickUp "as if they had filled it out")
  const so = (o as typeof o & { simple_order?: { about?: string; garments?: string; qty?: number | null; method?: string; reorder?: unknown; fields?: Record<string, string>; prints?: string; sizes?: { group?: string; garment?: string; sizes: Record<string, number> }[]; files?: { path: string; name: string; kind?: string }[] } | null }).simple_order || null;
  // the order as they sent it in, before we've built it (Nov 2, Nick: "rethink this order intake… just like in ClickUp…
  // exactly what they wrote"): only what they gave us, their message, their attachments, and a way to ask us
  const intake = isReq && !!so && !so.reorder;
  // the day they sent it, on our clock (an evening send isn't tomorrow)
  const sentDay = o.submitted_at ? new Date(o.submitted_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : "";
  const soFiles = so?.files?.length ? await (async () => {
    const { data } = await createAdminClient().storage.from("proofs").createSignedUrls(so.files!.map((f) => f.path), 3600);
    return so.files!.map((f, i) => ({ ...f, url: data?.[i]?.signedUrl || "" }));
  })() : [];
  const [p, pr, m] = await Promise.all([
    ctx.db.from("payments").select("*").eq("order_id", id).order("paid_on"),
    ctx.db.from("proofs").select("*").eq("order_id", id).not("version", "is", null).is("archived_at", null).order("created_at", { ascending: false }),
    ctx.db.from("messages").select("*").is("hidden_at", null).eq("order_id", id).order("created_at"),
  ]);
  // the customer opened their proof (not staff looking at their portal): shown to the shop on the order (lib/proofs.ts)
  if (!ctx.isStaff && (pr.data || []).length) await proofViewed(createAdminClient(), id).catch(() => null);
  // what's waiting on them on their order page (the link our Send to customer email opens, lib/customerSend.ts)
  const { data: olk } = await createAdminClient().from("proof_links").select("id").eq("kind", "order").eq("order_id", id).limit(1).maybeSingle();
  const linkSteps = olk?.id ? (await orderSteps(createAdminClient(), olk.id))?.steps || [] : [];
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
  // a signage / promo / paper order: each item's picture, to look at and approve (components/PortalItems.tsx)
  const simple = isSimpleKind((o as { product_kind?: string | null }).product_kind);
  const itemPaths = simple ? [...new Set(orderGroups(o).flatMap((g) => g.lines.map((l) => linePic(l.spec)).filter((x): x is string => !!x)))] : [];
  const itemUrls: Record<string, string> = {};
  if (itemPaths.length) { const { data: sg } = await createAdminClient().storage.from("proofs").createSignedUrls(itemPaths, 3600); itemPaths.forEach((pth, i) => { if (sg?.[i]?.signedUrl) itemUrls[pth] = sg[i].signedUrl!; }); }
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
  // what they still have to look over and answer: the steps of the review page our email opens (proof, sew-out, quote,
  // final invoice), or, before that page was ever made, the same things worked out here
  const reviewKinds = [...new Set(olk?.id
    ? linkSteps.filter((x) => (REVIEW_KINDS as string[]).includes(x.kind) && (x.state === "todo" || x.state === "locked")).map((x) => x.kind as string)
    : [...(pendingProofs.some((x) => (x as { sent_at?: string | null }).sent_at) ? ["art"] : []), ...(pendingSew.some((x) => x.sent_at) ? ["sewout"] : []), ...(o.status === "quote_sent" ? ["quote"] : [])])];
  const reviewHref = reviewKinds.length ? approveHref(o.id, ctx.preview?.id) : "";
  // (Nov 2, Nick: "you shouldn't be able to get into the quotes page until you've gone through that… you view the proof
  // and then you review the quote"): an order waiting on their answer opens on its review page first; that page's "See the
  // whole order" comes back here with view=1
  if (reviewHref && !view && !reviewed && !sewDone && !justPaid && !justSent) redirect(reviewHref);
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
  const proofHref = reviewHref || (latestProof ? `/portal/orders/${o.id}/review/${latestProof.id}${qsAs}` : "");
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
              <span>{o.type === "quote" ? "Quote" : "Order"} #{o.number}{intake && sentDay ? ` · sent ${fmtDate(sentDay)}` : ""}{o.due_date ? ` · in hands ${intake ? fmtDate(o.due_date) : fmtDateLong(o.due_date)}` : ""}</span>
              {reviewHref && <span className="pod-wait">Waiting on you: your {reviewWords(reviewKinds)}</span>}
            </div>
          </div>
          <div className="row pod-acts">
            {!["completed", "void"].includes(o.status) && <StarOrder id={o.id} on={!!(o as typeof o & { customer_starred_at?: string | null }).customer_starred_at} canAct={!preview} label />}
            {/* the same Reorder pop-up as an old-system order (Nov 2, Nick): sizes, art, notes; we price it and send it back */}
            {o.type === "invoice" && <OldReorderButton archivedId={`o:${o.id}`} as={preview ? ctx.preview!.id : undefined} primary={false} />}
            {(() => { const x = o as typeof o & { submitted_at?: string | null; staff_seen_at?: string | null; customer_archived_at?: string | null; cancel_requested_at?: string | null };
              const kind = x.status === "request" ? (x.staff_seen_at ? "seen" : "unseen") : x.type === "quote" ? "quote" : x.status === "completed" ? null : "order";
              return kind ? <OrderActions orderId={x.id} kind={kind} archived={!!x.customer_archived_at} cancelAsked={!!x.cancel_requested_at} disabled={preview} /> : null; })()}
            {!intake && <a className="btn" href={`/print/${o.id}${qsAs}`} target="_blank" rel="noreferrer">Print or save PDF</a>}
            {/* the one way to answer: the same page our email opens (Nov 2, Nick: "small button that says review and approve") */}
            {reviewHref && <a className="btn primary" href={reviewHref}>Review and approve</a>}
          </div>
        </div>

        {String(o.status) !== "void" && !(o.status === "completed" && o.type === "quote") && <div className="pod-railw"><OrderRail steps={job.steps} done={o.status === "completed"} />{hold && <span className="hold-stamp">On hold</span>}</div>}

        {/* the numbers in one summary card, like the shop's pages: what it costs, what's paid, what's left */}
        {!isReq && <div className="stats pod-stats">
          <a className="stat" href="#items"><span className="k">Pieces</span><span className="v">{c.qty.toLocaleString("en-US")}</span><small>{orderGroups(o).length === 1 ? "1 job" : `${orderGroups(o).length} jobs`}</small></a>
          <a className="stat" href="#pay"><span className="k">Total</span><span className="v">{money(c.total)}</span><small>with tax{c.tax ? ` (${money(c.tax)})` : o.tax_exempt ? " exempt" : ""}</small></a>
          <a className="stat" href="#pay"><span className="k">Paid</span><span className="v">{money(c.paid)}</span><small>{payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"}` : "Nothing yet"}</small></a>
          <a className="stat" href="#pay"><span className="k">Balance</span><span className={"v" + (c.balance <= 0.004 && c.total > 0 ? " pod-ok" : "")}>{c.balance < -0.004 ? `${money(-c.balance)} credit` : c.balance <= 0.004 && c.total > 0 ? "Paid in full" : money(c.balance)}</span><small>{c.balance > 0.004 ? (canPay ? "Ready to pay" : "Not due yet") : o.type === "quote" ? "After you approve" : "Thank you"}</small></a>
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
        {justPaid && <div className="callout good"><h2>Thank you, payment received</h2><div className="muted">It can take a minute to show below. You&apos;ll get a receipt by email from our payment processor.</div></div>}
        {intake && <div className="pod-in-st" role="status"><i aria-hidden />{justSent ? "Thanks, we got it." : "We got it."} We&apos;re reviewing your order and will send you a quote to approve. Questions? Message us below.</div>}
        {isReq && !intake && (
          <div className="callout good">
            <h2>{(o as { simple_order?: { reorder?: unknown } | null }).simple_order?.reorder ? "Reorder pending approval" : justSent ? "Thanks! Your order is in." : "We're reviewing your order"}</h2>
            <div className="muted">We&apos;ll check your garments and artwork, price everything and send it back here for your final OK. Questions? Send us a message below.</div>
          </div>
        )}
        <div className="two pod-two">
          <div className="stack" id="items">
            {/* what they sent, exactly as they sent it (Nov 2, Nick: "I want it like bullet points… exactly as they wrote it…
                if they give a sizing… in like kind of grid form"): their message in the blue box, line by line; the form's answers
                one per row; their sizes in a grid by box or group; then their files */}
            {intake && so && (() => {
              const lines = String(so.about || "").split(/\n+/).map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
              const rows: [string, string][] = ([
                ["Decoration", so.method ? ({ screen: "Screen printing", embroidery: "Embroidery", transfer: "Transfers", mixed: "Mixed" } as Record<string, string>)[so.method] || so.method : ""],
                ["Pieces", so.qty && !(so.sizes || []).length ? `About ${so.qty.toLocaleString("en-US")}` : ""],
                ["Garments", so.garments || ""],
                ["Prints", so.prints || ""],
              ] as [string, string][]).filter(([, v]) => v);
              const sz = (so.sizes || []).filter((r) => Object.values(r.sizes || {}).some((v) => +v > 0));
              const cols = SIZES.filter((k) => sz.some((r) => +(r.sizes?.[k] || 0) > 0));
              const tot = (r: { sizes: Record<string, number> }) => cols.reduce((a0, k) => a0 + (+(r.sizes?.[k] || 0)), 0);
              return (
                <section className="panel pod-so">
                  <div className="panel-h"><h2>What you sent us</h2><span className="faint">Exactly as you sent it</span></div>
                  <div className="panel-b">
                    {/* their words with their own line breaks and spacing, like ClickUp shows them (Nov 2, Nick: "it can't all be bullet points") */}
                    {lines.length > 0 && <div className="pod-om"><b className="pod-om-h">Original message</b><p className="pod-om-t">{String(so.about || "").trim()}</p></div>}
                    {rows.length > 0 && <><div className="pod-so-sec">Order form</div><div className="pod-so-rows">{rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><b>{v}</b></Fragment>)}</div></>}
                    {sz.length > 0 && <><div className="pod-so-sec">Sizes</div>
                      <div className="tbl-wrap pod-so-szw"><table className="tbl pod-so-sz" data-nofit>
                        <thead><tr><th>{sz.some((r) => r.group) ? "Box" : "Garment"}</th>{cols.map((k) => <th key={k} className="r">{sizeLabel(k as never)}</th>)}<th className="r">Total</th></tr></thead>
                        <tbody>
                          {sz.map((r, i) => <tr key={i}><td><b>{r.group || r.garment || `Line ${i + 1}`}</b>{r.group && r.garment ? <div className="sub">{r.garment}</div> : null}</td>{cols.map((k) => <td key={k} className="r num">{+(r.sizes?.[k] || 0) || ""}</td>)}<td className="r num b">{tot(r).toLocaleString("en-US")}</td></tr>)}
                          {sz.length > 1 && <tr className="pod-so-all"><td><b>All</b></td>{cols.map((k) => <td key={k} className="r num">{sz.reduce((a0, r) => a0 + (+(r.sizes?.[k] || 0)), 0) || ""}</td>)}<td className="r num b">{sz.reduce((a0, r) => a0 + tot(r), 0).toLocaleString("en-US")}</td></tr>}
                        </tbody>
                      </table></div></>}
                    <div className="pod-so-sec">Attachments</div>
                    <PortalAttachments files={soFiles} />
                  </div>
                </section>
              );
            })()}
            {/* each job like the proof: its mockups, what's printed where (method, size, inks with their colors), then the
                garments by size with their prices */}
            {simple && <PortalItems orderId={o.id} groups={orderGroups(o)} urls={itemUrls} title={o.nickname || kindLabel((o as { product_kind?: string | null }).product_kind)} preview={!!preview} />}
            {!simple && orderGroups(o).map((g, gi) => {
              // a simple order's blank starting job isn't shown: "What you sent us" says it all until we build it
              if (intake && !g.lines.some((l) => l.style || Object.values(l.sizes || {}).some((v) => +v > 0))) return null;
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
                        <table className="tbl pod-prints" data-nofit>
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
                      {/* phones: each print in two short lines (Nov 2, Nick: "nothing's good there… look at the mobile debug") */}
                      {g.imprints.length > 0 && <ul className="pod-pl">{g.imprints.map((d, k) => {
                        const inks = inkNames(d.inks || "");
                        const cols = (d.method === "screen" || d.method === "embroidery") && d.colors ? (d.method === "screen" && d.colors >= FULL_COLOR ? "full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`) : "";
                        return (
                          <li key={d.id || k}>
                            <div className="pod-pl-a"><b>{d.location || "Print"}</b><span>{[methodLabel(d), cols].filter(Boolean).join(" · ")}</span></div>
                            <div className="pod-pl-b">{d.size && <span className="pod-nw">{d.size}</span>}{needsDetails(d) ? <span className="faint">Matches your previous order</span> : inks.map((n) => { const hx = colorHex(n); return <span key={n} className="pod-ink"><i style={{ background: hx || "var(--surface-2)" }} aria-hidden />{n}</span>; })}</div>
                          </li>);
                      })}</ul>}
                      {(cg?.finishing.length || 0) > 0 && <div className="pod-fin"><span className="lbl">Finishing</span>{cg!.finishing.map((f) => f.name).join(", ")}</div>}
                    </div>
                  </div>
                  <div className="tbl-wrap pod-lines">
                    <table className="tbl" data-nofit>
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
                  {/* phones: each garment as the name, its sizes in a row of boxes (size over count), then qty × each = total */}
                  <ul className="pod-gl">{g.lines.map((l, li) => {
                    const lc = cg?.lines[li];
                    const sz = SIZES.filter((s) => +(l.sizes?.[s] || 0) > 0);
                    return (
                      <li key={l.id}>
                        <div className="pod-gl-n"><b>{l.style || "Garment"}</b> {garmentName(l.garment, l.style)}{l.color ? <small>{l.color}</small> : null}</div>
                        {sz.length > 0 && <div className="pod-gl-sz">{sz.map((s) => <span key={s}><small>{sizeLabel(s)}</small><b>{l.sizes[s]}</b></span>)}</div>}
                        <div className="pod-gl-t"><span>{(lc?.qty || 0).toLocaleString("en-US")} pcs{!isReq ? ` × ${money(lc?.each)}` : ""}</span>{!isReq && <b>{money(lc?.sub)}</b>}</div>
                      </li>);
                  })}</ul>
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

            {(proofs.length > 0 || (mkGroups.length === 0 && !intake)) && <section className="panel" id="proofs">
              <div className="panel-h"><h2>Artwork proofs</h2></div>
              <div className="panel-b stack">
                {proofs.length ? (
                  <div className="proofs">{proofs.map((pf) => <ProofCard key={pf.id} proof={pf} reviewHref={pf.status === "pending" && reviewHref ? reviewHref : `/portal/orders/${o.id}/review/${pf.id}${qsAs}`} />)}</div>
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
            {/* the order's facts in one place, like the top of the proof (first thing under the title on a phone) */}
            <section className="panel pod-det">
              <div className="panel-h"><h2>Order details</h2></div>
              <div className="panel-b pod-kv">
                <span>{o.type === "quote" ? "Quote" : "Order"}</span><b>#{o.number}</b>
                {o.po_number ? <><span>PO</span><b>{o.po_number}</b></> : null}
                {intake ? <><span>Sent</span><b>{fmtDateLong(sentDay || String(o.created_at || "").slice(0, 10))}</b></> : <><span>Ordered</span><b>{fmtDateLong(String(o.created_at || "").slice(0, 10))}</b></>}
                {o.due_date ? <><span>In hands</span><b>{fmtDateLong(o.due_date)}</b></> : null}
                {delivery ? <><span>Delivery</span><b>{delivery}</b></> : null}
                {o.delivery_method !== "pickup" && o.ship_to ? <><span>{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</span><b className="pod-addr">{o.ship_to}</b></> : null}
                {o.tracking ? <><span>Tracking</span><b className="pod-addr">{o.tracking}</b></> : null}
                {cust?.name ? <><span>Contact</span><b>{cust.name}</b></> : null}
                {/* what they filled in on their side (ClickUp's Customer Name), word for word */}
                {intake && Object.entries(so?.fields || {}).filter(([, v]) => String(v || "").trim()).map(([k, v]) => <Fragment key={k}><span>{k.replace(/^Customer Name$/i, "Customer")}</span><b>{v}</b></Fragment>)}
                {intake ? <><span>Pricing</span><b>On its way</b></> : null}
                {o.approved_at ? <><span>Approved</span><b>{fmtDate(o.approved_at)}{o.approved_name ? ` by ${o.approved_name}` : ""}</b></> : null}
                {approvedProof ? <><span>Proof</span><b>Approved {fmtDate(approvedProof.decided_at || approvedProof.created_at)}</b></> : null}
                {garmentsLine ? <><span>Garments</span><b><a href={goodsHere.length ? "#goods" : `/portal?area=goods${preview ? `&as=${ctx.preview!.id}` : ""}`}>{garmentsLine}</a></b></> : null}
              </div>
            </section>

            {intake ? null : isReq ? (
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
                    <div className={"pod-row pod-tot" + (c.balance <= 0.004 && c.total > 0 ? " pod-zero" : "")}><span>{c.balance < -0.004 ? "Your credit" : "Balance"}</span><b>{c.balance < -0.004 ? money(-c.balance) : money(Math.max(0, c.balance))}</b></div>
                    {(() => { const d = o.type === "invoice" ? payDueDate(o, terms) : null; return <div className="pod-row pod-terms"><span>Terms</span><b>{PAY_TERMS[terms]}{d && c.balance > 0.004 ? ` · due ${fmtDateLong(d)}` : ""}</b></div>; })()}
                  </div>
                  {canPay ? (
                    <PayButton item={{ id: o.id, number: o.number, nickname: o.nickname || "", balance: ps.can === "deposit" ? deposit : c.balance, deposit: c.paid < 0.005 && ps.can !== "deposit" ? deposit : undefined, quote: o.type === "quote", notFinal: ps.notFinal, notFinalNote: ps.note, cardFeeIn: cardFeeInOrder(o as never, c.balance), part: ps.can === "deposit" }}
                      pay={ctx.settings.pay} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} canAct={!preview} receiptEmail={preview ? "" : cust?.email || ctx.email} due={false} autoOpen={payOpen === "1" && !preview} />
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
            {!intake && <section className="panel">
              <div className="panel-h"><h2>Files</h2></div>
              <div className="panel-b pod-files">
                <a href={`/print/${o.id}${qsAs}`} target="_blank" rel="noreferrer"><span className="pod-fi">PDF</span>{o.type === "quote" ? "Quote" : "Invoice"} #{o.number}</a>
                {proofs.map((pf) => <a key={pf.id} href={pf.status === "pending" ? reviewHref || `/portal/orders/${o.id}/review/${pf.id}${qsAs}` : pf.url || "#"} target={pf.status === "pending" ? undefined : "_blank"} rel="noreferrer"><span className="pod-fi">{pf.file_type.includes("pdf") ? "PDF" : "IMG"}</span>{pf.title || `Proof v${pf.version || 1}`}<small>{pf.status === "approved" ? "Approved" : pf.status === "changes" ? "Changes asked" : "To review"}</small></a>)}
                {mkPaths.filter((x) => mkUrls[x]).slice(0, 8).map((x, i) => <a key={x} href={mkUrls[x]} target="_blank" rel="noreferrer"><span className="pod-fi">IMG</span>Mockup {i + 1}</a>)}
              </div>
            </section>}

            {!intake && <section className="panel">
              <div className="panel-h"><h2>Questions?</h2></div>
              <div className="panel-b stack" style={{ fontSize: 13 }}>
                <span className="muted">Send us a message on this page, or reach {ctx.settings.shop.name} directly:</span>
                {ctx.settings.shop.phone && <span>{fmtPhone(ctx.settings.shop.phone)}</span>}
                {ctx.settings.shop.email && <span>{ctx.settings.shop.email}</span>}
              </div>
            </section>}
          </aside>
        </div>
      </main>
    </>
  );
}
