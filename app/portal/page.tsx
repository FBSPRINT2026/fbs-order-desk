import Link from "next/link";
import { getPortalCtx } from "@/lib/portal";
import { ST, type Order } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import { Pill } from "@/components/bits";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as);
  const q = (p: string) => (ctx.preview ? `${p}?as=${ctx.preview.id}` : p);

  let orders: Order[] = [];
  let paid: Record<string, number> = {};
  let pendingProofs: Record<string, number> = {};
  if (ctx.customerIds.length) {
    const { data } = await ctx.db.from("orders").select("*").in("customer_id", ctx.customerIds).neq("status", "quote").order("number", { ascending: false });
    orders = (data || []) as Order[];
    const ids = orders.map((o) => o.id);
    if (ids.length) {
      const [p, pr] = await Promise.all([
        ctx.db.from("payments").select("order_id,amount").in("order_id", ids),
        ctx.db.from("proofs").select("order_id").in("order_id", ids).eq("status", "pending"),
      ]);
      (p.data || []).forEach((x) => { paid[x.order_id] = (paid[x.order_id] || 0) + (+x.amount || 0); });
      (pr.data || []).forEach((x) => { pendingProofs[x.order_id] = (pendingProofs[x.order_id] || 0) + 1; });
    }
  }
  const bal = (o: Order) => Math.round(((+o.total || 0) - (paid[o.id] || 0)) * 100) / 100;

  type Act = { o: Order; title: string; detail: string; cta: string; color: string; href: string };
  const actions: Act[] = [];
  orders.forEach((o) => {
    const href = q(`/portal/orders/${o.id}`);
    if (o.status === "quote_sent") actions.push({ o, title: `Approve quote #${o.number}`, detail: `${o.nickname || "Your order"} · ${money(o.total)}`, cta: "Review quote", color: ST.quote_sent.c, href });
    if (pendingProofs[o.id]) actions.push({ o, title: `Review artwork for #${o.number}`, detail: `${pendingProofs[o.id]} proof${pendingProofs[o.id] > 1 ? "s" : ""} waiting for your OK`, cta: "Review artwork", color: ST.art.c, href: href + "#proofs" });
    if (o.type === "invoice" && bal(o) > 0.004 && o.status !== "completed")
      actions.push({ o, title: `Balance due on #${o.number}`, detail: `${money(bal(o))} remaining${o.due_date ? ` · due ${fmtDateLong(o.due_date)}` : ""}`, cta: "Pay now", color: ST.ready.c, href: href + "#pay" });
  });
  const name = ctx.customers[0]?.name?.split(" ")[0];

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <div>
          <div className="eyebrow">{ctx.settings.shop.name} customer portal</div>
          <h1>{name ? `Hi ${name}` : "Your orders"}</h1>
        </div>

        {!ctx.customerIds.length ? (
          <div className="panel"><div className="panel-b">
            <p style={{ margin: 0 }}>We couldn&apos;t find any orders for <b>{ctx.email}</b>.</p>
            <p className="muted" style={{ marginBottom: 0 }}>If you were expecting a quote, it may be under a different email address. Contact {ctx.settings.shop.name}{ctx.settings.shop.email ? ` at ${ctx.settings.shop.email}` : ""}{ctx.settings.shop.phone ? ` or ${ctx.settings.shop.phone}` : ""}.</p>
          </div></div>
        ) : (
          <>
            <section className="stack">
              <h2>Needs your attention</h2>
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

            <section className="stack">
              <h2>All orders</h2>
              {orders.length ? (
                <div className="ocards">
                  {orders.map((o) => (
                    <Link key={o.id} href={q(`/portal/orders/${o.id}`)} className="ocard">
                      <div className="row"><span className="n">#{o.number}</span><span className="spacer" /><Pill status={o.status} portal /></div>
                      <div className="t">{o.nickname || "Order"}</div>
                      <div className="f"><span>{o.qty} pcs{o.due_date ? ` · ${fmtDateLong(o.due_date)}` : ""}</span><b className="num">{money(o.total)}</b></div>
                    </Link>
                  ))}
                </div>
              ) : <div className="muted">No orders yet.</div>}
            </section>
          </>
        )}
      </main>
    </>
  );
}
