import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAY_TERMS, payDueDate, type Design, type Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import StartPanel from "@/components/StartPanel";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type AOrder, type APayment } from "@/components/AccountAreas";
import { customerGeneralMessage, starMyDesign, starMyMockup } from "@/app/portal/actions";
import { archiveDesign, deleteDesign } from "@/app/artwork-actions";
import { orderSearchText } from "@/lib/search";
import { withFiles, type HubMsg } from "@/lib/messages";
import PortalMessages from "@/components/PortalMessages";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvTransaction } from "@/lib/archive";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string; c?: string }> }) {
  const { as, c: startConvo } = await searchParams;
  const ctx = await getPortalCtx(as);
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const admin = createAdminClient();

  let orders: Order[] = [];
  const paid: Record<string, number> = {};
  const pendingProofs: Record<string, number> = {};
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
      ids.length ? ctx.db.from("proofs").select("order_id").in("order_id", ids).eq("status", "pending") : Promise.resolve({ data: [] }),
      ctx.db.from("designs").select("*").in("customer_id", ctx.customerIds).order("number", { ascending: false }),
      ctx.db.from("mockups").select("*").in("customer_id", ctx.customerIds).order("created_at", { ascending: false }),
      ctx.db.from("messages").select("*").or(`customer_id.in.(${ctx.customerIds.join(",")})${ids.length ? `,order_id.in.(${ids.join(",")})` : ""}`).order("created_at"),
    ]);
    const pays = (p.data || []) as { id: string; order_id: string; amount: number; method: string; paid_on: string | null; created_at: string }[];
    pays.forEach((x) => { paid[x.order_id] = (paid[x.order_id] || 0) + (+x.amount || 0); });
    payments = pays.map((x) => ({ ...x, amount: +x.amount || 0, number: num(x.order_id) || 0 }));
    ((pr.data || []) as { order_id: string }[]).forEach((x) => { pendingProofs[x.order_id] = (pendingProofs[x.order_id] || 0) + 1; });
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
    if (o.type === "invoice" && bal(o) > 0.004 && o.status !== "quote") attention.push({ kind: "pay", order_id: o.id, number: o.number, date: money(bal(o)), hash: "pay" });
    if (o.price_type === "wholesale" && o.type === "invoice" && ["approved", "art", "blanks"].includes(o.status)) attention.push({ kind: "receive", order_id: o.id, number: o.number, date: short(o.approved_at || o.updated_at) });
  });
  const acct = ctx.customers[0];
  const firstName = (acct?.name || "").trim().split(/\s+/)[0];
  const hubOrders = orders.filter((o) => o.status !== "request" || o.submitted_at).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", href: `/portal/orders/${o.id}${qs}` }));
  const company = acct?.company || acct?.name || "";

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <div>
          <div className="eyebrow">{ctx.settings.shop.name} customer portal</div>
          <h1>{company || "Your account"}</h1>
        </div>
        {!ctx.customerIds.length ? (
          <div className="panel"><div className="panel-b">
            <p style={{ margin: 0 }}>We couldn&apos;t find any orders for <b>{ctx.email}</b>.</p>
            <p className="muted" style={{ marginBottom: 0 }}>If you were expecting a quote, it may be under a different email address. Contact {ctx.settings.shop.name}{ctx.settings.shop.email ? ` at ${ctx.settings.shop.email}` : ""}{ctx.settings.shop.phone ? ` or ${ctx.settings.shop.phone}` : ""}.</p>
          </div></div>
        ) : (
          <AccountAreas mode="portal" greeting={firstName ? `Hi, ${firstName}` : undefined}
            messagesPanel={<PortalMessages initial={hubMsgs} orders={hubOrders} shopName={ctx.settings.shop.name} as={ctx.preview?.id} canAct={!ctx.preview} start={startConvo} />}
            orders={aOrders} payments={payments} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
            attention={attention} homeTop={<StartPanel compact preview={!!ctx.preview} mockupHref={`/portal/mockup${qs}`} />} hrefBase="/portal/orders/" hrefQuery={qs} canAct={!ctx.preview}
            onSend={customerGeneralMessage} onStar={starMyDesign} usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign} onStarMockup={starMyMockup}
            terms={PAY_TERMS[acct?.payment_terms || "receipt"]}
            payCfg={{ ...ctx.settings.pay, staxToken: process.env.STAX_WEB_PAYMENTS_TOKEN || "", depositPct: ctx.settings.depositPct }} />
        )}
      </main>
    </>
  );
}
