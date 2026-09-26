import Link from "next/link";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { ST, type Design, type Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import AccountAreas, { type AMessage, type AMockup, type AOrder, type APayment } from "@/components/AccountAreas";
import { customerGeneralMessage, starMyDesign } from "@/app/portal/actions";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as);
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const q = (p: string) => `${p}${qs}`;
  const admin = createAdminClient();

  let orders: Order[] = [];
  const paid: Record<string, number> = {};
  const pendingProofs: Record<string, number> = {};
  let payments: APayment[] = [], designs: Design[] = [], mockups: AMockup[] = [], messages: AMessage[] = [];
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
    const withPv = designs.filter((x) => x.preview_path);
    if (withPv.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(withPv.map((x) => x.preview_path), 3600);
      withPv.forEach((x, i) => { if (sg?.[i]?.signedUrl) designUrls[x.id] = sg[i].signedUrl!; });
    }
    const ml = (m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string }[];
    if (ml.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]), 3600);
      mockups = ml.map((x, i) => ({ id: x.id, title: x.title, order_id: x.order_id, number: num(x.order_id), created_at: x.created_at, url: sg?.[i * 2]?.signedUrl || "", thumb: sg?.[i * 2 + 1]?.signedUrl || sg?.[i * 2]?.signedUrl || "" }));
    }
    messages = ((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) }));
  }
  const bal = (o: Order) => Math.round(((+o.total || 0) - (paid[o.id] || 0)) * 100) / 100;
  const aOrders: AOrder[] = orders.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", status: o.status, type: o.type, total: +o.total || 0, paid: paid[o.id] || 0, balance: bal(o), due_date: o.due_date, created_at: o.created_at, qty: o.qty, price_type: o.price_type }));

  type Act = { title: string; detail: string; cta: string; color: string; href: string };
  const actions: Act[] = [];
  orders.forEach((o) => {
    const href = q(`/portal/orders/${o.id}`);
    if (o.status === "quote_sent") actions.push({ title: `Approve quote #${o.number}`, detail: `${o.nickname || "Your order"} · ${money(o.total)}`, cta: "Review quote", color: ST.quote_sent.c, href });
    if (pendingProofs[o.id]) actions.push({ title: `Review artwork for #${o.number}`, detail: `${pendingProofs[o.id]} proof${pendingProofs[o.id] > 1 ? "s" : ""} waiting for your OK`, cta: "Review artwork", color: ST.art.c, href: href + "#proofs" });
    if (o.type === "invoice" && bal(o) > 0.004 && o.status !== "completed")
      actions.push({ title: `Balance due on #${o.number}`, detail: `${money(bal(o))} remaining${o.due_date ? ` · due ${fmtDateLong(o.due_date)}` : ""}`, cta: process.env.STRIPE_SECRET_KEY ? "Pay now" : "View balance", color: ST.ready.c, href: href + "#pay" });
  });
  const name = ctx.customers[0]?.name?.split(" ")[0];
  const active = orders.filter((o) => o.type === "invoice" && o.status !== "completed").slice(0, 6);

  const overview = (
    <>
      <section className="stack">
        <h2 style={{ margin: 0 }}>Needs your attention</h2>
        {actions.length ? (
          <div className="action-list">
            {actions.map((a, i) => (
              <Link key={i} href={a.href} className="action" style={{ ["--sc" as string]: a.color }}>
                <div><div className="t">{a.title}</div><div className="d">{a.detail}</div></div>
                <span className="btn primary go">{a.cta}</span>
              </Link>
            ))}
          </div>
        ) : <div className="muted">You&apos;re all caught up. Nothing needs your attention right now.</div>}
      </section>
      {active.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: "8px 0 0" }}>Orders in progress</h2>
          <div className="ocards">
            {active.map((o) => (
              <Link key={o.id} href={q(`/portal/orders/${o.id}`)} className="ocard">
                <div className="row"><span className="n">#{o.number}</span><span className="spacer" /><span className="aa-pill" style={{ ["--sc" as string]: ST[o.status]?.c }}>{ST[o.status]?.portal}</span></div>
                <div className="t">{o.nickname || "Order"}</div>
                <div className="f"><span>{o.qty} pcs{o.due_date ? ` · ${fmtDateLong(o.due_date)}` : ""}</span><b className="num">{money(o.total)}</b></div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );

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
            overview={overview} hrefBase="/portal/orders/" hrefQuery={qs} canAct={!ctx.preview}
            onSend={customerGeneralMessage} onStar={starMyDesign} />
        )}
      </main>
    </>
  );
}
