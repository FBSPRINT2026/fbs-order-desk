import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, PAY_TERMS, payDueDate, type Design, type Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import PortalDash, { type DashNeed, type DashPast, type DashThread } from "@/components/PortalDash";
import { jobFor, kindFromWords, type JobKind } from "@/lib/portalJobs";
import { ourStatusFor } from "@/lib/printavoSend";
import StartPanel from "@/components/StartPanel";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type AOrder, type APayment } from "@/components/AccountAreas";
import { customerGeneralMessage, starMyDesign, starMyMockup } from "@/app/portal/actions";
import { archiveDesign, deleteDesign } from "@/app/artwork-actions";
import { orderSearchText } from "@/lib/search";
import { withFiles, type HubMsg } from "@/lib/messages";
import PortalMessages from "@/components/PortalMessages";
import PortalGoods from "@/components/PortalGoods";
import { unmatchedGroups } from "@/lib/manifest";
import PortalAssistant from "@/components/PortalAssistant";
import PortalProjects from "@/components/PortalProjects";
import ProgramOrder from "@/components/ProgramOrder";
import { projectSummaries } from "@/lib/projectsServer";
import type { Program, ProgramItem } from "@/lib/programs";
import { aiPaySelect } from "@/app/portal/pay-select";
import { needsGoods } from "@/lib/goods";
import { loadGoodsItems } from "@/lib/goodsServer";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvOrder, type PvTransaction } from "@/lib/archive";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string; c?: string }> }) {
  const { as, c: startConvo } = await searchParams;
  const ctx = await getPortalCtx(as);
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const admin = createAdminClient();

  let orders: Order[] = [];
  const paid: Record<string, number> = {};
  const pendingProofs: Record<string, number> = {};
  const firstPending: Record<string, string> = {};
  const approvedArt: Record<string, boolean> = {};
  let rawMsgs: { id: string; order_id: string | null; project_id?: string | null; topic?: string | null; author_type: string; author_name: string | null; body: string; created_at: string; read_at: string | null }[] = [];
  let hubMsgs: HubMsg[] = [];
  let payments: APayment[] = [], designs: Design[] = [], mockups: AMockup[] = [], messages: AMessage[] = [];
  const usedIds: string[] = [];
  const designUrls: Record<string, string> = {};
  // past orders from before the portal (read with the server key: only the summary and payments leave the server)
  let archived: (ArchiveSummary & { transactions: PvTransaction[] | null })[] = [];
  if (ctx.customerIds.length) {
    const { data: ar } = await admin.from("archived_orders").select(`${ARCHIVE_LIST_COLS}, search:search_text, transactions:data->transactions`).in("customer_id", ctx.customerIds).order("order_date", { ascending: false });
    archived = (ar || []) as never;
    const { data } = await ctx.db.from("orders").select("*").in("customer_id", ctx.customerIds).neq("status", "quote").order("number", { ascending: false });
    orders = (data || []) as Order[];
    const ids = orders.map((o) => o.id);
    const num = (id: string | null) => orders.find((o) => o.id === id)?.number ?? null;
    const [p, pr, d, m, msg] = await Promise.all([
      ids.length ? ctx.db.from("payments").select("*").in("order_id", ids).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
      ids.length ? ctx.db.from("proofs").select("id, order_id, status").in("order_id", ids).is("archived_at", null) : Promise.resolve({ data: [] }),
      ctx.db.from("designs").select("*").in("customer_id", ctx.customerIds).order("number", { ascending: false }),
      ctx.db.from("mockups").select("*").in("customer_id", ctx.customerIds).is("archived_at", null).order("created_at", { ascending: false }),
      ctx.db.from("messages").select("*").or(`customer_id.in.(${ctx.customerIds.join(",")})${ids.length ? `,order_id.in.(${ids.join(",")})` : ""}`).order("created_at"),
    ]);
    const pays = (p.data || []) as { id: string; order_id: string; amount: number; method: string; paid_on: string | null; created_at: string }[];
    pays.forEach((x) => { paid[x.order_id] = (paid[x.order_id] || 0) + (+x.amount || 0); });
    payments = pays.map((x) => ({ ...x, amount: +x.amount || 0, number: num(x.order_id) || 0 }));
    ((pr.data || []) as { id: string; order_id: string; status: string }[]).forEach((x) => {
      if (x.status === "pending") { pendingProofs[x.order_id] = (pendingProofs[x.order_id] || 0) + 1; if (!firstPending[x.order_id]) firstPending[x.order_id] = x.id; }
      if (x.status === "approved") approvedArt[x.order_id] = true;
    });
    rawMsgs = (msg.data || []) as typeof rawMsgs;
    designs = (d.data || []) as Design[];
    for (const cid of ctx.customerIds) { const { data: u } = await ctx.db.rpc("designs_in_use", { p_customer: cid }); usedIds.push(...((u || []) as string[])); }
    const withPv = designs.filter((x) => x.preview_path);
    if (withPv.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(withPv.map((x) => x.preview_path), 3600);
      withPv.forEach((x, i) => { if (sg?.[i]?.signedUrl) designUrls[x.id] = sg[i].signedUrl!; });
    }
    const ml = (m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string; starred?: boolean }[];
    if (ml.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]), 3600);
      mockups = ml.map((x, i) => ({ id: x.id, title: x.title, starred: !!x.starred, order_id: x.order_id, number: num(x.order_id), created_at: x.created_at, url: sg?.[i * 2]?.signedUrl || "", thumb: sg?.[i * 2 + 1]?.signedUrl || sg?.[i * 2]?.signedUrl || "" }));
    }
    messages = ((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) }));
    hubMsgs = await withFiles((msg.data || []) as never[], async (paths) => {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
      return (sg || []).map((x) => x.signedUrl || null);
    });
  }
  const bal = (o: Order) => Math.round(((+o.total || 0) - (paid[o.id] || 0)) * 100) / 100;
  const aOrders: AOrder[] = orders.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", status: o.status, type: o.type, total: +o.total || 0, paid: paid[o.id] || 0, balance: bal(o), due_date: o.due_date, created_at: o.created_at, qty: o.qty, price_type: o.price_type, search: orderSearchText(o),
    pay_due: o.type === "invoice" ? payDueDate(o, ctx.customers.find((c) => c.id === o.customer_id)?.payment_terms) : null }));
  const archHref = (id: string) => `/portal/archive/${id}${qs}`;
  aOrders.push(...archived.map((a) => archiveAsOrder(a, archHref(a.id))));
  payments = [...payments, ...archived.flatMap((a) => archivePayments(a, archHref(a.id)))].sort((a, b) => (b.paid_on || b.created_at).localeCompare(a.paid_on || a.created_at));

  // what's waiting on the customer
  const attention: AAttn[] = [];
  const short = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)) : "");
  orders.forEach((o) => {
    if (o.status === "request" && !o.submitted_at) attention.push({ kind: "draft", order_id: o.id, number: o.number, date: short(o.created_at) });
    if (o.status === "quote_sent") attention.push({ kind: "quote", order_id: o.id, number: o.number, date: short(o.sent_at || o.updated_at) });
    if (pendingProofs[o.id]) attention.push({ kind: "art", order_id: o.id, number: o.number, date: short(o.updated_at), hash: "proofs" });
    // payments live in Payments (and the Pay button up top), not in "Needs your attention"
  });
  // wholesale: the garments they send us for their jobs (goods have their own status)
  // supplier shipments on their account that aren't on one of their orders yet
  const incoming = ctx.customerIds.length ? (await unmatchedGroups(admin, ctx.customerIds).catch(() => [])).filter((g) => !g.us) : [];
  const wholesale = ctx.customers.some((c) => c.price_type === "wholesale") || orders.some((o) => o.price_type === "wholesale") || incoming.length > 0;
  const goodsItems = wholesale ? await loadGoodsItems(admin, orders.filter(needsGoods) as never, "customer", (id) => `/portal/orders/${id}${qs}`) : [];
  const goodsOpen = goodsItems.filter((g) => g.goods.status !== "received");
  const goodsHref = `/portal${qs ? qs + "&" : "?"}area=receive`;
  // projects and program pricing
  const projects = await projectSummaries(admin, ctx.customerIds, true);
  const { data: progs } = ctx.customerIds.length ? await admin.from("programs").select("*").in("customer_id", ctx.customerIds).eq("active", true).limit(1) : { data: [] };
  const program = ((progs || [])[0] || null) as Program | null;
  const { data: pits } = program ? await admin.from("program_items").select("*").eq("program_id", program.id).eq("active", true).is("archived_at", null).order("position") : { data: [] };
  const programItems = (pits || []) as ProgramItem[];
  const programImages: Record<string, string> = {};
  {
    const withImg = programItems.filter((i) => i.image_path);
    const designIds = programItems.filter((i) => !i.image_path && i.design_id).map((i) => i.design_id as string);
    const { data: ds } = designIds.length ? await admin.from("designs").select("id, preview_path").in("id", designIds) : { data: [] };
    const dPath = new Map((ds || []).map((d) => [d.id, d.preview_path]));
    const paths = [...withImg.map((i) => i.image_path), ...programItems.filter((i) => !i.image_path && i.design_id && dPath.get(i.design_id)).map((i) => dPath.get(i.design_id as string) as string)];
    const { data: sg } = paths.length ? await admin.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    const url = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""]));
    programItems.forEach((i) => { const p = i.image_path || (i.design_id ? dPath.get(i.design_id) : ""); if (p && url.get(p)) programImages[i.id] = url.get(p)!; });
  }
  goodsItems.forEach((g) => {
    if (g.goods.status === "waiting") attention.push({ kind: "receive", order_id: g.order.id, number: g.order.number, date: "", label: "Send us your goods", href: goodsHref });
    if (g.goods.status === "issue") attention.push({ kind: "receive", order_id: g.order.id, number: g.order.number, date: "", label: "Issue with your goods", href: goodsHref });
  });
  if (incoming.length) attention.push({ kind: "receive", order_id: "", number: 0, date: "", label: `${incoming.length} incoming shipment${incoming.length === 1 ? "" : "s"} not linked to an order`, href: goodsHref });
  const acct = ctx.customers[0];
  const hubOrders = orders.filter((o) => o.status !== "request" || o.submitted_at).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", href: `/portal/orders/${o.id}${qs}` }));
  const company = acct?.company || acct?.name || "";

  // ---------- the dashboard (Oct 15, Nick): the assistant and message center up top, what needs them, their jobs
  // moving through a timeline, order again, artwork, account ----------
  const link = (p: string) => (qs ? `${p}${p.includes("?") ? "&" : "?"}${qs.slice(1)}` : p);
  const msgHref = link("/portal?area=messages");
  const msgLink = (orderId: string | null) => link(`/portal?area=messages&c=${orderId || "general"}`);
  const isJob = (o: Order) => o.status !== "completed" && !(o.status === "request" && !o.submitted_at);
  const doneRecent = orders.filter((o) => o.status === "completed").slice(0, 1);
  const jobOrders = orders.filter(isJob).slice(0, 6);
  const pastPortal = orders.filter((o) => o.status === "completed" && !doneRecent.includes(o));
  // pictures: each order's first mockup (photos only), else the customer's own mockup
  const picPath = (o: Order) => { const g = orderGroups(o)[0]; return g?.mockupThumbs?.[0] || g?.customerMockups?.[0]?.path || ""; };
  const picOrders = [...jobOrders, ...doneRecent, ...pastPortal.slice(0, 3)];
  const picPaths = [...new Set(picOrders.map(picPath).filter(Boolean))];
  const { data: picSigned } = picPaths.length ? await admin.storage.from("proofs").createSignedUrls(picPaths, 3600) : { data: [] };
  const picOf = (o: Order) => { const p = picPath(o); const i = picPaths.indexOf(p); return i >= 0 ? picSigned?.[i]?.signedUrl || "" : ""; };
  // messages by conversation (order or general), newest first; "new" = from us and not read yet
  const conv = new Map<string, { orderId: string | null; last: (typeof rawMsgs)[number]; unread: number }>();
  rawMsgs.filter((m) => !m.project_id).forEach((m) => {
    const k = m.order_id || "general";
    const c = conv.get(k) || { orderId: m.order_id, last: m, unread: 0 };
    if (m.created_at >= c.last.created_at) c.last = m;
    if (m.author_type === "staff" && !m.read_at) c.unread++;
    conv.set(k, c);
  });
  const shopName = ctx.settings.shop.name;
  const clip = (t: string, n = 90) => { const x = (t || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
  const whenShort = (iso: string) => { const d = new Date(iso); const today = new Date(); return d.toDateString() === today.toDateString() ? "today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }); };
  const threads: DashThread[] = [...conv.entries()].sort((a, b) => b[1].last.created_at.localeCompare(a[1].last.created_at)).slice(0, 3).map(([k, c]) => {
    const o = c.orderId ? orders.find((x) => x.id === c.orderId) : null;
    return { key: k, label: o ? `#${o.number}` : "FBS", title: o ? o.nickname || `Order #${o.number}` : "General", from: c.last.author_type === "staff" ? shopName : "You", text: clip(c.last.body, 70), when: whenShort(c.last.created_at), isNew: c.unread > 0, href: msgLink(c.orderId) };
  });
  const newMsgs = [...conv.values()].reduce((a, c) => a + c.unread, 0);
  const goodsOf = new Map(goodsItems.map((g) => [g.order.id, g.goods.status as string]));
  const jobOf = (o: Order) => {
    const c = conv.get(o.id);
    return jobFor(o, { href: link(`/portal/orders/${o.id}`), pic: picOf(o), pendingProof: firstPending[o.id] ? link(`/portal/orders/${o.id}/review/${firstPending[o.id]}`) : undefined,
      approvedArt: !!approvedArt[o.id], goods: goodsOf.get(o.id) || null, customerGoods: o.price_type === "wholesale", newMsgs: c?.unread || 0,
      lastMsg: c ? { from: c.last.author_type === "staff" ? shopName : "you", text: clip(c.last.body, 60), href: msgLink(o.id) } : undefined });
  };
  const jobs = jobOrders.map(jobOf), pastJobs = doneRecent.map(jobOf);
  const IDX_AFTER_ART = ["blanks", "production", "ready"];
  // what's waiting on them, with a picture and one button
  const due = aOrders.filter((o) => o.type === "invoice" && o.balance > 0.004).reduce((a, o) => a + o.balance, 0);
  const needs: DashNeed[] = attention.map((a, i) => {
    const o = orders.find((x) => x.id === a.order_id);
    const nm = o ? `#${o.number} ${o.nickname || ""}`.trim() : "";
    if (a.kind === "art") return { key: `a${i}`, kind: a.kind, title: "Approve your artwork", text: `${nm} · proof ready. Printing starts once you approve.`, pic: o ? picOf(o) : "", href: firstPending[a.order_id] ? link(`/portal/orders/${a.order_id}/review/${firstPending[a.order_id]}`) : link(`/portal/orders/${a.order_id}`), cta: "Review art" };
    if (a.kind === "quote") return { key: `a${i}`, kind: a.kind, title: "Review your quote", text: `${nm} · approve it to get started.`, pic: o ? picOf(o) : "", href: link(`/portal/orders/${a.order_id}`), cta: "Review quote" };
    if (a.kind === "draft") return { key: `a${i}`, kind: a.kind, title: "Finish your order", text: `${nm} · you started this one but haven't sent it yet.`, pic: o ? picOf(o) : "", href: link(`/portal/request/${a.order_id}`), cta: "Finish it" };
    return { key: `a${i}`, kind: a.kind, title: a.label || "Customer supplied goods", text: nm ? `${nm}` : "Shipments on your account", pic: o ? picOf(o) : "", href: a.href || goodsHref, cta: "Open" };
  });
  if (due > 0.004) needs.push({ key: "pay", kind: "pay", title: "Pay your balance", text: `${money(due)} due on your orders.`, pic: "", href: link("/portal?area=payments"), cta: `Pay ${money(due)}` });
  // order again: their latest finished jobs (new and from before the portal), with a picture when we have one
  // jobs still open in Printavo (synced every few minutes until Printavo is turned off) show on the timeline too,
  // their Printavo status read the way our own orders' statuses are (lib/printavoSend.ts ourStatusFor)
  const since = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);
  const pvOpen = archived.filter((a) => a.kind === "invoice" && (a.order_date || "") >= since).map((a) => ({ a, st: ourStatusFor(a.status_name || "", "invoice") }))
    .filter((x) => x.st !== "completed" && !/complete|picked up|delivered|cancel/i.test(x.a.status_name || "")).slice(0, 40);
  const archTop = archived.filter((a) => a.kind === "invoice" && !pvOpen.some((x) => x.a.id === a.id) && (ourStatusFor(a.status_name || "", "invoice") === "completed" || (a.order_date || "") < since)).slice(0, 3);
  const archPics: Record<string, string> = {};
  const pvKind: Record<string, JobKind> = {};
  if (archTop.length || pvOpen.length) {
    const { data: ad } = await admin.from("archived_orders").select("id, files, data").in("id", [...archTop.map((a) => a.id), ...pvOpen.map((x) => x.a.id)]);
    const want: { id: string; path: string }[] = [];
    ((ad || []) as { id: string; files: Record<string, string> | null; data: PvOrder }[]).forEach((r) => {
      // the imprint mockups first (the shirt with the art), pictures only (not barcodes or file icons)
      const f = (r.data?.groups?.flatMap((g) => [...g.imprints.flatMap((im) => im.mockups), ...g.lines.flatMap((l) => l.mockups)]) || []).filter((x) => /^image\//.test(x.mime || "") && !/barcode|label/i.test(x.name || ""));
      const hit = f.map((x) => (x.thumb && r.files?.[x.thumb]) || (x.full && r.files?.[x.full]) || "").find((p) => p && !["failed", "too-big"].includes(p));
      pvKind[r.id] = kindFromWords([...(r.data?.groups || []).flatMap((g) => [...g.lines.map((l) => l.category), ...g.imprints.map((im) => im.typeOfWork)])]);
      if (hit) want.push({ id: r.id, path: hit });
    });
    const { data: sg } = want.length ? await admin.storage.from("proofs").createSignedUrls(want.map((w) => w.path), 3600) : { data: [] };
    want.forEach((w, i) => { if (sg?.[i]?.signedUrl) archPics[w.id] = sg[i].signedUrl!; });
  }
  pvOpen.forEach(({ a, st }) => {
    const o = { id: a.id, number: +a.visual_id || 0, nickname: a.nickname || "", status: st || "approved", type: "invoice", due_date: a.due_date, created_at: a.order_date || "", submitted_at: a.order_date || "",
      production_date: null, delivery_method: "", groups: [], lines: [], qty: a.qty || 0, price_type: "retail", completed_at: null, updated_at: a.order_date || "" } as unknown as Order;
    jobs.push(jobFor(o, { href: archHref(a.id), pic: archPics[a.id] || "", approvedArt: (IDX_AFTER_ART as string[]).includes(st || ""), goods: null, customerGoods: false, newMsgs: 0,
      kind: kindFromWords([a.status_name || "", a.nickname || ""]) || pvKind[a.id] || "" }));
  });
  const past: DashPast[] = [
    ...pastPortal.slice(0, 3).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", when: short(o.completed_at || o.due_date || o.created_at), qty: o.qty, pic: picOf(o), href: link(`/portal/orders/${o.id}`), date: o.completed_at || o.due_date || o.created_at })),
    ...archTop.map((a) => ({ id: a.id, number: +a.visual_id || 0, nickname: a.nickname || "", when: short(a.due_date || a.order_date), qty: a.qty || 0, pic: archPics[a.id] || "", href: archHref(a.id), archived: true, date: a.due_date || a.order_date || "" })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 3);
  const art = designs.filter((d) => !d.archived_at && designUrls[d.id]).sort((a, b) => Number(!!b.starred) - Number(!!a.starred)).slice(0, 5).map((d) => ({ id: d.id, url: designUrls[d.id], name: d.name }));
  const quotesOpen = orders.filter((o) => o.status === "quote_sent").length;
  const account = [
    { label: "Balance due", value: money(due), tone: due > 0.004 ? "bad" as const : "ok" as const },
    { label: "In progress", value: `${jobOrders.length} order${jobOrders.length === 1 ? "" : "s"}` },
    { label: "Quotes to review", value: quotesOpen ? String(quotesOpen) : "None" },
    { label: "Payment terms", value: `${PAY_TERMS[acct?.payment_terms || "receipt"] || "Due on receipt"}${acct?.tax_exempt ? " · tax exempt" : ""}` },
  ];
  // the assistant's shortcuts, from their own jobs
  const ideas = [jobs[0] ? `Where's my ${jobs[0].nickname} order?` : "Where's my order?", past[0] ? `Reorder ${past[0].nickname || `#${past[0].number}`}` : "Reorder a past job",
    ...(due > 0.004 ? ["Pay my balance"] : []), "Start a new order", ...(wholesale ? ["Where are my goods?"] : ["Upload a logo"])];
  const dash = (
    <PortalDash
      assistant={<PortalAssistant qs={qs} canAct={!ctx.preview} wholesale={wholesale} bare ideas={ideas} personHref={msgLink(null)} />}
      threads={threads} newMsgs={newMsgs} msgHref={msgHref} needs={needs} jobs={jobs} pastJobs={pastJobs} past={past} art={art} artHref={link("/portal?area=artwork")}
      account={account} canAct={!ctx.preview} ordersHref={link("/portal?area=orders")}
      goods={wholesale && goodsOpen.length ? <section className="pdx-card"><div className="pdx-h"><h2>Customer supplied goods</h2><a className="pd-link" href={goodsHref}>See all</a></div><PortalGoods items={goodsOpen.slice(0, 4)} incoming={incoming} canAct={!ctx.preview} qs={qs} compact hub empty="" /></section> : undefined} />
  );

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        {/* the customer's name with Start an order / Mockup Creator, above the tabs (Oct 15, Nick) */}
        <div className="pdx-hello">
          <div><h1 className="pdx-h1">{company || "Your Account"}</h1><div className="pdx-sub">Your quotes, orders, artwork and payments with {ctx.settings.shop.name}</div></div>
          {ctx.customerIds.length > 0 && <div className="pdx-acts"><StartPanel compact preview={!!ctx.preview} mockupHref={`/portal/mockup${qs}`} /></div>}
        </div>
        {!ctx.customerIds.length ? (
          <div className="panel"><div className="panel-b">
            <p style={{ margin: 0 }}>We couldn&apos;t find any orders for <b>{ctx.email}</b>.</p>
            <p className="muted" style={{ marginBottom: 0 }}>If you were expecting a quote, it may be under a different email address. Contact {ctx.settings.shop.name}{ctx.settings.shop.email ? ` at ${ctx.settings.shop.email}` : ""}{ctx.settings.shop.phone ? ` or ${ctx.settings.shop.phone}` : ""}.</p>
          </div></div>
        ) : (
          <AccountAreas mode="portal" dash={dash}
            projectsPanel={<PortalProjects projects={projects} qs={qs} canAct={!ctx.preview} />} projectsCount={projects.filter((p) => p.status === "planning" || p.status === "active").length}
            programPanel={<ProgramOrder program={program} items={programItems} images={programImages} projects={projects.filter((p) => p.status !== "closed").map((p) => ({ id: p.id, name: p.name }))} canAct={!ctx.preview} qs={qs} />} hasProgram={!!program && programItems.length > 0}
            assistant={<PortalAssistant qs={qs} canAct={!ctx.preview} wholesale={wholesale} />}
            goodsPanel={wholesale ? <PortalGoods items={goodsItems} incoming={incoming} canAct={!ctx.preview} qs={qs} empty="No open jobs need goods from you right now." /> : undefined}
            goodsHome={wholesale ? <PortalGoods items={goodsOpen.slice(0, 4)} incoming={incoming} canAct={!ctx.preview} qs={qs} compact hub empty="Nothing waiting on your goods right now. When a job needs garments from you, it shows up here." /> : undefined}
            goodsCount={goodsOpen.length + incoming.length}
            onPaySelect={aiPaySelect}
            statementHref={`/portal/statement${qs}`}
            messagesPanel={<PortalMessages initial={hubMsgs} orders={hubOrders} projects={projects.map((p) => ({ id: p.id, name: p.name, href: `/portal/projects/${p.id}${qs}` }))} shopName={ctx.settings.shop.name} as={ctx.preview?.id} canAct={!ctx.preview} start={startConvo} />}
            orders={aOrders} payments={payments} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
            attention={attention} homeTop={<StartPanel compact preview={!!ctx.preview} mockupHref={`/portal/mockup${qs}`} />} hrefBase="/portal/orders/" hrefQuery={qs} canAct={!ctx.preview}
            onSend={customerGeneralMessage} onStar={starMyDesign} usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign} onStarMockup={starMyMockup}
            terms={PAY_TERMS[acct?.payment_terms || "receipt"]}
            payCfg={{ ...ctx.settings.pay, staxToken: (process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim(), depositPct: ctx.settings.depositPct, receiptEmail: ctx.preview ? "" : acct?.email || ctx.email }} />
        )}
      </main>
    </>
  );
}
