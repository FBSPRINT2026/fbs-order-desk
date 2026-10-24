import { discardRequest } from "@/app/portal/request-actions";
import { getPortalCtx } from "@/lib/portal";
import { oneOfEach } from "@/lib/mockupList";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, PAY_TERMS, payDueDate, type Design, type Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import PortalDash, { type DashNeed, type DashPast, type DashThread } from "@/components/PortalDash";
import { customerHold, customerStatus } from "@/lib/orderStages";
import { jobFor, kindFromWords, type JobKind, type JobShip } from "@/lib/portalJobs";
import { carrierOf, trackingLink, type Box } from "@/lib/shipping";
import { ourStatusFor } from "@/lib/printavoSend";
import StartPanel from "@/components/StartPanel";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type AOrder, type APayment } from "@/components/AccountAreas";
import { archiveMyMockup, customerGeneralMessage, starMyDesign, starMyMockup } from "@/app/portal/actions";
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
import { cardHasPrices, type Program, type ProgramItem } from "@/lib/programs";
import { aiPaySelect } from "@/app/portal/pay-select";
import { needsGoods } from "@/lib/goods";
import { loadGoodsItems } from "@/lib/goodsServer";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvOrder, type PvTransaction } from "@/lib/archive";
import { fmtPhone } from "@/lib/phone";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string; c?: string }> }) {
  const { as, c: startConvo } = await searchParams;
  const ctx = await getPortalCtx(as);
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const admin = createAdminClient();

  let orders: Order[] = [];
  let drafts: { id: string; name: string; updated: string; pcs: number }[] = [];
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
    const { data } = await ctx.db.from("orders").select("*").in("customer_id", ctx.customerIds).neq("status", "quote").is("discarded_at", null).order("number", { ascending: false });
    // drafts aren't orders yet (Oct 24, Nick): only in "Your drafts", never in the lists
    const all = (data || []) as (Order & { draft?: boolean })[];
    drafts = all.filter((o) => o.draft).map((o) => ({ id: o.id, name: o.nickname || "", updated: String((o as { updated_at?: string }).updated_at || o.created_at || ""), pcs: o.qty || 0 }));
    orders = all.filter((o) => !o.draft);
    const ids = orders.map((o) => o.id);
    const num = (id: string | null) => orders.find((o) => o.id === id)?.number ?? null;
    const [p, pr, d, m, msg] = await Promise.all([
      ids.length ? ctx.db.from("payments").select("*").in("order_id", ids).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
      ids.length ? ctx.db.from("proofs").select("id, order_id, status").in("order_id", ids).is("archived_at", null) : Promise.resolve({ data: [] }),
      ctx.db.from("designs").select("*").in("customer_id", ctx.customerIds).eq("draft", false).order("number", { ascending: false }),
      ctx.db.from("mockups").select("*").in("customer_id", ctx.customerIds).is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }),
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
    const ml = oneOfEach((m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string; starred?: boolean; number?: number | null; snapshot?: { lines?: unknown[] } | null; shelved_at?: string | null }[]);
    if (ml.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]), 3600);
      mockups = ml.map((x, i) => ({ id: x.id, title: x.title, starred: !!x.starred, order_id: x.order_id, number: num(x.order_id), mno: x.number ?? null, setup: !!x.snapshot?.lines?.length, shelved: !!x.shelved_at, created_at: x.created_at, url: sg?.[i * 2]?.signedUrl || "", thumb: sg?.[i * 2 + 1]?.signedUrl || sg?.[i * 2]?.signedUrl || "" }));
    }
    messages = ((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) }));
    hubMsgs = await withFiles((msg.data || []) as never[], async (paths) => {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
      return (sg || []).map((x) => x.signedUrl || null);
    });
  }
  const bal = (o: Order) => Math.round(((+o.total || 0) - (paid[o.id] || 0)) * 100) / 100;
  const aOrders: AOrder[] = orders.map((o) => ({ id: o.id, sent: o.status === "request" && !!o.submitted_at, archivedQ: !!(o as { customer_archived_at?: string | null }).customer_archived_at, cancelAsked: !!(o as { cancel_requested_at?: string | null }).cancel_requested_at && o.status !== "canceled", number: o.number, nickname: o.nickname || "", status: o.status, type: o.type, total: +o.total || 0, paid: paid[o.id] || 0, balance: bal(o), due_date: o.due_date, created_at: o.created_at, qty: o.qty, price_type: o.price_type, search: orderSearchText(o),
    pay_due: o.type === "invoice" ? payDueDate(o, ctx.customers.find((c) => c.id === o.customer_id)?.payment_terms) : null }));
  const archHref = (id: string) => `/portal/archive/${id}${qs}`;
  const owedArch = archived.filter((a) => a.kind === "invoice" && +a.balance > 0.004).map((a) => a.id);
  const payUrls: Record<string, string> = {};
  for (let i = 0; i < owedArch.length; i += 200) {
    const { data: pu } = await admin.from("archived_orders").select("id, pay:data->urls->>publicUrl").in("id", owedArch.slice(i, i + 200));
    ((pu || []) as { id: string; pay: string | null }[]).forEach((r) => { if (r.pay && /^https:\/\//.test(r.pay)) payUrls[r.id] = r.pay; });
  }
  aOrders.push(...archived.map((a) => ({ ...archiveAsOrder(a, archHref(a.id)), payUrl: payUrls[a.id] })));
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
  // staff previewing see the program even while it's off, marked so (Oct 17: to check it before the customer does)
  const progQ = ctx.customerIds.length ? admin.from("programs").select("*").in("customer_id", ctx.customerIds) : null;
  const { data: progs } = progQ ? await (ctx.preview ? progQ.order("active", { ascending: false }) : progQ.eq("active", true)).limit(1) : { data: [] };
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
  // sent to us and not confirmed yet: in "Orders sent to FBS" above the jobs, not in the jobs (Oct 24, Nick)
  const isJob = (o: Order) => o.status !== "completed" && o.status !== "request";
  const doneRecent = orders.filter((o) => o.status === "completed").slice(0, 1);
  const jobOrders = orders.filter(isJob).slice(0, 20);
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
  // shipments with tracking (Shipping Center), for "Track package" on the job (Oct 15, Nick)
  const shipOf = new Map<string, JobShip>();
  if (ctx.customerIds.length) {
    const { data: sh } = await admin.from("shipments").select("order_id, archived_order_id, status, carrier, service, boxes, shipped_at, updated_at")
      .in("customer_id", ctx.customerIds).in("status", ["labeled", "shipped"]).order("updated_at", { ascending: false }).limit(100);
    ((sh || []) as { order_id: string | null; archived_order_id: string | null; carrier: string; service: string; boxes: Box[] | null; shipped_at: string | null; updated_at: string }[]).forEach((r) => {
      const k = r.order_id || r.archived_order_id; const t = (r.boxes || []).find((b) => b.tracking)?.tracking;
      if (!k || !t || shipOf.has(k)) return;
      shipOf.set(k, { carrier: r.carrier || carrierOf(t), service: r.service || "", tracking: t, url: trackingLink(t), boxes: (r.boxes || []).length, when: whenShort(r.shipped_at || r.updated_at) });
    });
  }
  const shopAddr = (ctx.settings.shop.address || "").replace(/\s*\n\s*/g, ", ").trim();
  const pickupHref = shopAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddr)}` : "";
  const jobOf = (o: Order) => {
    const c = conv.get(o.id);
    return jobFor(o, { href: link(`/portal/orders/${o.id}`), pic: picOf(o), pendingProof: firstPending[o.id] ? link(`/portal/orders/${o.id}/review/${firstPending[o.id]}`) : undefined,
      approvedArt: !!approvedArt[o.id], goods: goodsOf.get(o.id) || null, customerGoods: o.price_type === "wholesale", newMsgs: c?.unread || 0,
      lastMsg: c ? { from: c.last.author_type === "staff" ? shopName : "you", text: clip(c.last.body, 60), href: msgLink(o.id) } : undefined,
      goodsHref, ship: shipOf.get(o.id) || null, balance: o.type === "invoice" ? bal(o) : 0, payHref: link("/portal?area=payments"), pickup: shopAddr, pickupHref });
  };
  const starOf = (o: Order) => !!(o as Order & { customer_starred_at?: string | null }).customer_starred_at;
  // on hold, and why (Oct 24, Nick: "a stamp… that says order on hold… see the reason why")
  const holdOf = (o: Order) => {
    const h = customerHold(o.flags as never);
    if (!h) return null;
    const href = h.fix === "pay" ? link("/portal?area=payments") : h.fix === "art" ? msgLink(o.id) : h.fix === "goods" ? link(`/portal/orders/${o.id}#goods`) : msgLink(o.id);
    return { title: h.title, reason: h.reason, href, fixLabel: h.fix === "pay" ? "Pay now" : h.fix === "art" ? "Send new art" : h.fix === "goods" ? "See the goods" : "Reply" };
  };
  const jobs = jobOrders.map((o) => ({ ...jobOf(o), starred: starOf(o), hold: holdOf(o) })), pastJobs = doneRecent.map(jobOf);
  const held = jobs.filter((j) => j.hold).map((j) => ({ id: j.id, href: j.href, number: j.number, name: j.nickname, hold: j.hold!, msgHref: msgLink(j.id) }));
  // the orders they're tracking (★), each with where it is and whether it's on time (Oct 24, Nick: "tracking this order,
  // here's the current status. This is the date… on time or waiting on you")
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const tracked = orders.filter((o) => starOf(o) && o.status !== "completed" && o.status !== "void")
    .sort((a, b) => String((b as Order & { customer_starred_at?: string }).customer_starred_at).localeCompare(String((a as Order & { customer_starred_at?: string }).customer_starred_at)))
    .slice(0, 4).map((o) => {
      const j = jobs.find((x) => x.id === o.id) || jobOf(o);
      const cs = customerStatus(o, { proofSent: !!firstPending[o.id], shipped: !!shipOf.get(o.id) });
      const late = !!o.due_date && o.due_date < todayIso && !["ready", "completed"].includes(o.status);
      const health = j.hold ? { text: "On hold", tone: "bad" as const }
        : cs.key === "delayed" ? { text: "Delayed", tone: "bad" as const }
        : j.stage === "need" || ["waiting", "proof", "quote_sent"].includes(cs.key) ? { text: "Waiting on you", tone: "act" as const }
        : cs.key === "goods" && o.price_type === "wholesale" ? { text: "Waiting on your goods", tone: "act" as const }
        : o.status === "request" ? { text: "Waiting on FBS", tone: "wait" as const }
        : late ? { text: "Running late", tone: "bad" as const }
        : ["ready", "shipped", "delivered"].includes(cs.key) ? { text: cs.label, tone: "ok" as const }
        : o.due_date ? { text: "On time", tone: "ok" as const } : { text: "In progress", tone: "wait" as const };
      return { id: o.id, href: j.href, number: o.number, name: o.nickname || "", status: cs.label, due: j.inHands || "", health, action: j.action ? { label: j.action.label, href: j.action.href, external: !!j.action.external } : null };
    });
  // Orders sent to FBS (Oct 24, Nick: "as soon as you click that button, you want to keep track of it on the main
  // dashboard… order sent to FBS, waiting on FBS… approved"): everything still with us, and what we did with the ones
  // sent in the last two weeks
  const twoWeeks = new Date(Date.now() - 14 * 864e5).toISOString();
  type SentRow = Order & { staff_seen_at?: string | null; cancel_requested_at?: string | null; simple_order?: unknown };
  const sentDash = (orders as SentRow[]).filter((o) => o.submitted_at && (o.status === "request" || (o.submitted_at >= twoWeeks && o.status !== "completed")))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))).slice(0, 6).map((o) => {
      const pcs = o.qty || 0, simpleO = o.simple_order != null;
      const st = o.status === "void" ? { step: -1, label: "Canceled", tone: "off" as const, note: "This order was canceled." }
        : o.cancel_requested_at ? { step: 1, label: "Cancel requested", tone: "wait" as const, note: "We got your request to cancel and we'll confirm." }
        : o.status === "request" ? (o.staff_seen_at ? { step: 1, label: "FBS is reviewing", tone: "wait" as const, note: "We opened it and we're checking the details." } : { step: 0, label: "Waiting on FBS", tone: "wait" as const, note: "We have it. We'll open it soon." })
        : o.status === "quote_sent" ? { step: 2, label: "Quote ready", tone: "act" as const, note: "Your quote is ready: review and approve it." }
        : o.status === "quote" ? { step: 1, label: "Pricing it", tone: "wait" as const, note: "We're putting your quote together." }
        : firstPending[o.id] ? { step: 2, label: "Proof ready", tone: "act" as const, note: "Your proof is ready: please approve it." }
        : { step: 2, label: "Confirmed", tone: "ok" as const, note: "Confirmed. It's in your jobs below." };
      return { id: o.id, href: firstPending[o.id] && st.label === "Proof ready" ? link(`/portal/orders/${o.id}/review/${firstPending[o.id]}`) : link(`/portal/orders/${o.id}`), number: o.number, name: o.nickname || (simpleO ? "Simple order" : ""), when: short(o.submitted_at), pcs, simple: simpleO, ...st };
    });
  const IDX_AFTER_ART = ["blanks", "production", "ready"];
  // what's waiting on them, with a picture and one button
  // the same balance the Payments tab shows: portal orders and invoices from before the portal
  const due = aOrders.filter((o) => o.type === "invoice" && o.balance > 0.004).reduce((a, o) => a + o.balance, 0);
  const needs: DashNeed[] = attention.map((a, i) => {
    const o = orders.find((x) => x.id === a.order_id);
    const nm = o ? `#${o.number} ${o.nickname || ""}`.trim() : "";
    if (a.kind === "art") return { key: `a${i}`, kind: a.kind, title: "Approve your artwork", text: `${nm} · proof ready. Printing starts once you approve.`, pic: o ? picOf(o) : "", href: firstPending[a.order_id] ? link(`/portal/orders/${a.order_id}/review/${firstPending[a.order_id]}`) : link(`/portal/orders/${a.order_id}`), cta: "Review art" };
    if (a.kind === "quote") return { key: `a${i}`, kind: a.kind, title: "Review your quote", text: `${nm} · approve it to get started.`, pic: o ? picOf(o) : "", href: link(`/portal/orders/${a.order_id}`), cta: "Review quote" };
    if (a.kind === "draft") return { key: `a${i}`, kind: a.kind, title: "Finish your order", text: `${nm} · you started this one but haven't sent it yet.`, pic: o ? picOf(o) : "", href: link(`/portal/request/${a.order_id}`), cta: "Finish it" };
    return { key: `a${i}`, kind: a.kind, title: a.label || "Customer supplied goods", text: nm ? `${nm}` : "Shipments on your account", pic: o ? picOf(o) : "", href: a.href || goodsHref, cta: "Open" };
  });
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
      kind: kindFromWords([a.status_name || "", a.nickname || ""]) || pvKind[a.id] || "",
      ship: shipOf.get(a.id) || null, balance: +a.balance || 0, payHref: payUrls[a.id] || link("/portal?area=payments"), payExternal: !!payUrls[a.id], pickup: shopAddr, pickupHref }));
  });
  const past: DashPast[] = [
    ...pastPortal.slice(0, 3).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", when: short(o.completed_at || o.due_date || o.created_at), qty: o.qty, pic: picOf(o), href: link(`/portal/orders/${o.id}`), date: o.completed_at || o.due_date || o.created_at })),
    ...archTop.map((a) => ({ id: a.id, number: +a.visual_id || 0, nickname: a.nickname || "", when: short(a.due_date || a.order_date), qty: a.qty || 0, pic: archPics[a.id] || "", href: archHref(a.id), archived: true, date: a.due_date || a.order_date || "" })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 3);
  // their mockups under the artwork (Oct 24, Nick: "on the dashboard… you've got artwork, but also put a line for mockups")
  const mocks = mockups.filter((m, i, all) => m.thumb && !m.shelved && (!m.mno || all.findIndex((x) => x.mno === m.mno) === i)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred)).slice(0, 5).map((m) => ({ id: m.id, url: m.thumb, name: `${m.mno ? `M-${m.mno} · ` : ""}${m.title.split(" — ")[0]}` }));
  const art = designs.filter((d) => !d.archived_at && designUrls[d.id]).sort((a, b) => Number(!!b.starred) - Number(!!a.starred)).slice(0, 5).map((d) => ({ id: d.id, url: designUrls[d.id], name: d.name }));
  // payments get their own box on the dashboard (Oct 15, Nick: not a "Needs you" item)
  const todayIso = new Date().toISOString().slice(0, 10);
  const owedList = aOrders.filter((o) => o.type === "invoice" && o.balance > 0.004);
  const lastPay = payments.find((p) => +p.amount > 0);
  const pay = {
    due, portalDue: owedList.filter((o) => !o.archived).reduce((a, o) => a + o.balance, 0), pvDue: owedList.filter((o) => o.archived).reduce((a, o) => a + o.balance, 0),
    pvCount: owedList.filter((o) => o.archived).length, portalCount: owedList.filter((o) => !o.archived).length,
    pastDue: owedList.filter((o) => { const d = o.archived ? o.due_date || o.created_at?.slice(0, 10) : o.pay_due; return !!d && d < todayIso; }).reduce((a, o) => a + o.balance, 0),
    last: lastPay ? `${short(lastPay.paid_on || lastPay.created_at)} · ${money(+lastPay.amount)}` : "",
    // a little statement: what's owed by how late it is (the same buckets as the printable statement)
    aging: (() => {
      const age = (o: (typeof owedList)[number]) => { const d = o.archived ? o.due_date || o.created_at?.slice(0, 10) : o.pay_due; return d ? Math.floor((Date.parse(todayIso) - Date.parse(d)) / 86400000) : null; };
      const b = [
        { k: "Current", f: (n: number | null) => n === null || n < 0 },
        { k: "1–30 days", f: (n: number | null) => n !== null && n >= 0 && n <= 30 },
        { k: "31–60", f: (n: number | null) => n !== null && n > 30 && n <= 60 },
        { k: "61–90", f: (n: number | null) => n !== null && n > 60 && n <= 90 },
        { k: "Over 90", f: (n: number | null) => n !== null && n > 90 },
      ];
      return b.map((x) => ({ k: x.k, amt: owedList.filter((o) => x.f(age(o))).reduce((a, o) => a + o.balance, 0), late: x.k !== "Current" }));
    })(),
    terms: `${PAY_TERMS[acct?.payment_terms || "receipt"] || "Due on receipt"}${acct?.tax_exempt ? " · tax exempt" : ""}`,
    href: link("/portal?area=payments"), statementHref: link("/portal/statement"),
  };
  // the assistant's shortcuts, from their own jobs
  const ideas = [jobs[0] ? `Where's my ${jobs[0].nickname} order?` : "Where's my order?", past[0] ? `Reorder ${past[0].nickname || `#${past[0].number}`}` : "Reorder a past job",
    ...(due > 0.004 ? ["Pay my balance"] : []), "Start a new order", ...(wholesale ? ["Where are my goods?"] : ["Upload a logo"])];
  const dash = (
    <PortalDash held={held} tracked={tracked} sent={sentDash} draft={drafts[0] ? { href: link(`/portal/request/${drafts[0].id}`), name: drafts[0].name, when: short(drafts[0].updated) } : null}
      assistant={<PortalAssistant qs={qs} canAct={!ctx.preview} wholesale={wholesale} bare ideas={ideas} personHref={msgLink(null)} />}
      threads={threads} newMsgs={newMsgs} msgHref={msgHref} needs={needs} jobs={jobs} pastJobs={pastJobs} past={past} art={art} mocks={mocks} mockupHref={link("/portal/mockup")} artHref={link("/portal?area=artwork")}
      pay={pay} canAct={!ctx.preview} ordersHref={link("/portal?area=orders")}
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
            <p className="muted" style={{ marginBottom: 0 }}>If you were expecting a quote, it may be under a different email address. Contact {ctx.settings.shop.name}{ctx.settings.shop.email ? ` at ${ctx.settings.shop.email}` : ""}{ctx.settings.shop.phone ? ` or ${fmtPhone(ctx.settings.shop.phone)}` : ""}.</p>
          </div></div>
        ) : (
          <AccountAreas mode="portal" dash={dash} brandColors={acct?.brand_colors || []}
            projectsPanel={<PortalProjects projects={projects} qs={qs} canAct={!ctx.preview} />} projectsCount={projects.filter((p) => p.status === "planning" || p.status === "active").length}
            programPanel={<ProgramOrder program={program} items={programItems} images={programImages} projects={projects.filter((p) => p.status !== "closed").map((p) => ({ id: p.id, name: p.name }))} canAct={!ctx.preview} qs={qs} />} hasProgram={!!program && (programItems.length > 0 || cardHasPrices(program.rate_card))}
            assistant={<PortalAssistant qs={qs} canAct={!ctx.preview} wholesale={wholesale} />}
            goodsPanel={wholesale ? <PortalGoods items={goodsItems} incoming={incoming} canAct={!ctx.preview} qs={qs} empty="No open jobs need goods from you right now." /> : undefined}
            goodsHome={wholesale ? <PortalGoods items={goodsOpen.slice(0, 4)} incoming={incoming} canAct={!ctx.preview} qs={qs} compact hub empty="Nothing waiting on your goods right now. When a job needs garments from you, it shows up here." /> : undefined}
            goodsCount={goodsOpen.length + incoming.length}
            onPaySelect={aiPaySelect}
            statementHref={`/portal/statement${qs}`}
            messagesPanel={<PortalMessages initial={hubMsgs} orders={hubOrders} projects={projects.map((p) => ({ id: p.id, name: p.name, href: `/portal/projects/${p.id}${qs}` }))} shopName={ctx.settings.shop.name} as={ctx.preview?.id} canAct={!ctx.preview} start={startConvo} />}
            orders={aOrders} payments={payments} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
            attention={attention} homeTop={<StartPanel compact preview={!!ctx.preview} mockupHref={`/portal/mockup${qs}`} />} hrefBase="/portal/orders/" hrefQuery={qs} canAct={!ctx.preview}
            onSend={customerGeneralMessage} onStar={starMyDesign} usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign} onStarMockup={starMyMockup} onArchiveMockup={archiveMyMockup} drafts={drafts} onDiscardDraft={discardRequest} settingsHref={`/portal/settings${qs}`}
            terms={PAY_TERMS[acct?.payment_terms || "receipt"]}
            payCfg={{ ...ctx.settings.pay, staxToken: (process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim(), depositPct: ctx.settings.depositPct, receiptEmail: ctx.preview ? "" : acct?.email || ctx.email }} />
        )}
      </main>
    </>
  );
}
