import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Design, Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import StartPanel from "@/components/StartPanel";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type AOrder, type APayment } from "@/components/AccountAreas";
import { customerGeneralMessage, starMyDesign, starMyMockup } from "@/app/portal/actions";
import { archiveDesign, deleteDesign } from "@/app/artwork-actions";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as);
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const admin = createAdminClient();

  let orders: Order[] = [];
  const paid: Record<string, number> = {};
  const pendingProofs: Record<string, number> = {};
  let payments: APayment[] = [], designs: Design[] = [], mockups: AMockup[] = [], messages: AMessage[] = [];
  const usedIds: string[] = [];
  const designUrls: Record<string, string> = {};
  if (ctx.customerIds.length) {
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
  }
  const bal = (o: Order) => Math.round(((+o.total || 0) - (paid[o.id] || 0)) * 100) / 100;
  const aOrders: AOrder[] = orders.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", status: o.status, type: o.type, total: +o.total || 0, paid: paid[o.id] || 0, balance: bal(o), due_date: o.due_date, created_at: o.created_at, qty: o.qty, price_type: o.price_type }));

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
  const name = ctx.customers[0]?.name?.split(" ")[0];

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <div>
          <div className="eyebrow">{ctx.settings.shop.name} customer portal</div>
          <h1>{name ? `Hi ${name}` : "Your account"}</h1>
        </div>
        {!ctx.customerIds.length ? (
          <div className="panel"><div className="panel-b">
            <p style={{ margin: 0 }}>We couldn&apos;t find any orders for <b>{ctx.email}</b>.</p>
            <p className="muted" style={{ marginBottom: 0 }}>If you were expecting a quote, it may be under a different email address. Contact {ctx.settings.shop.name}{ctx.settings.shop.email ? ` at ${ctx.settings.shop.email}` : ""}{ctx.settings.shop.phone ? ` or ${ctx.settings.shop.phone}` : ""}.</p>
          </div></div>
        ) : (
          <AccountAreas mode="portal" orders={aOrders} payments={payments} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
            attention={attention} homeTop={<StartPanel preview={!!ctx.preview} mockupHref={`/portal/mockup${qs}`} />} hrefBase="/portal/orders/" hrefQuery={qs} canAct={!ctx.preview}
            onSend={customerGeneralMessage} onStar={starMyDesign} usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign} onStarMockup={starMyMockup} />
        )}
      </main>
    </>
  );
}
