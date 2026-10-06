"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { askForChange, changeMyOrder } from "@/app/s/actions";
import { StoreHeader, brandVars } from "@/components/merch/Storefront";
import type { PublicStore } from "@/lib/merchServer";
import { bySize, fmtDate, fmtDateTime, orderCode, sizeName, storeImg, unitPrice, type Field, type MerchOrder, type Product } from "@/lib/merch";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
type P = Pick<Product, "id" | "name" | "colors" | "sizes" | "base_price" | "giveback" | "upcharges" | "imprint" | "active">;

/**
 * The shopper's own page for their order (from the link in their email; no sign-in): where it is, what's in it, and
 * changes. They can swap a size or color, or fix the student's info, until we order the goods; after that it's a
 * request to FBS.
 */
export default function OrderStatus({ store, order, products, canChange, isNew }: { store: PublicStore; order: MerchOrder; products: P[]; canChange: boolean; isNew: boolean }) {
  const router = useRouter();
  const fields = (store.fields || []) as Field[];
  const code = orderCode(store, order.number);
  const where = store.delivery?.org?.on ? store.delivery.org.label || store.brand?.school || "the school" : "";
  const st = store.status;
  const reached = (s: string) => ["closed", "ordered", "production", "packing", "ready", "delivered", "archived"].indexOf(st) >= ["closed", "ordered", "production", "packing", "ready", "delivered", "archived"].indexOf(s);
  const packed = ["packed", "delivered", "picked_up", "shipped"].includes(order.status) || reached("ready");
  const done = ["delivered", "picked_up", "shipped"].includes(order.status) || reached("delivered");
  const steps = [
    { t: "Order placed", s: fmtDateTime(order.created_at), on: true },
    { t: "Store closes", s: store.closes_at ? fmtDate(store.closes_at) : "", on: reached("closed") },
    { t: "Goods ordered", s: "We order the shirts once the store closes", on: reached("ordered") },
    { t: "Printing", s: "Everything is printed together", on: reached("production") },
    { t: "Packed in its own bag", s: order.answers?.student ? `Labeled for ${order.answers.student}` : "Labeled with your order", on: packed },
    { t: order.delivery === "org" ? `Delivered to ${where}` : order.delivery === "pickup" ? "Ready for pickup at FBS Print" : "Shipped to you", s: order.delivery === "org" ? "Sorted by homeroom; the school hands the bags out" : order.delivery === "ship" ? (order.tracking ? `Tracking ${order.tracking}` : "We'll email the tracking number") : "We'll email you when it's ready", on: done },
  ];
  const nowIdx = steps.findIndex((x) => !x.on);

  const [items, setItems] = useState((order.items || []).map((i) => ({ id: i.id!, color: i.color, size: i.size })));
  const [answers, setAnswers] = useState<Record<string, string>>({ ...order.answers });
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState(""), [busy, setBusy] = useState(false);

  return (
    <div style={brandVars(store.brand)}>
      <StoreHeader store={store} />
      <main className="sf-wrap" style={{ maxWidth: 880 }}>
        {isNew && <div className="sf-ok" style={{ marginTop: 20 }}>Thank you! Your order {code} is in. A receipt is on its way to {order.shopper.email}.</div>}
        {order.status === "cancelled" && <div className="sf-closed">This order was cancelled.</div>}
        <div className="sf-co" style={{ gridTemplateColumns: "1fr" }}>
          <section className="sf-sec">
            <h3>Order {code}</h3>
            <p>{order.answers?.student ? `For ${order.answers.student}. ` : ""}This is a pre-order{store.deliver_by ? `: we expect it ${order.delivery === "org" ? `at ${where}` : "ready"} around ${fmtDate(store.deliver_by)}` : ""}.</p>
            <ol className="sf-steps">
              {steps.map((x, i) => <li key={x.t} className={x.on ? "done" : i === nowIdx ? "now" : "later"}><span className="dot">{x.on ? "✓" : i + 1}</span><div><b>{x.t}</b><span>{x.s}</span></div></li>)}
            </ol>
          </section>

          <section className="sf-sec">
            <h3>What&apos;s in it</h3>
            {fields.length > 0 && !editing && <p>{fields.map((f) => answers[f.key] ? `${f.label}: ${answers[f.key]}` : "").filter(Boolean).join(" · ")}</p>}
            {editing && (
              <div className="sf-fields" style={{ marginBottom: 12 }}>
                {fields.map((f) => (
                  <div key={f.key} className={"sf-f" + (f.kind === "text" ? " full" : "")}>
                    <label>{f.label}</label>
                    {f.kind === "select" && f.options.length
                      ? <select value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                      : <input value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />}
                  </div>
                ))}
              </div>
            )}
            <div className="sf-lines">
              {(order.items || []).map((it, i) => {
                const p = products.find((x) => x.id === it.product_id);
                const cur = items[i];
                const col = p?.colors.find((c) => c.name === cur.color) || p?.colors[0];
                const sizes = (col?.sizes?.length ? col.sizes : p?.sizes || []).slice().sort(bySize);
                const extra = p ? it.unit_price - unitPrice(p as Product, it.size) : 0;
                return (
                  <div key={it.id} className="sf-line">
                    {col && (col.image || col.photo) ? <img src={storeImg(col.image || col.photo)} alt="" /> : <span />}
                    <div>
                      <b data-notranslate>{it.name}</b>
                      {editing && p ? (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {p.colors.length > 1 && <select style={{ width: "auto" }} value={cur.color} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}>{p.colors.map((c) => <option key={c.name}>{c.name}</option>)}</select>}
                          <select style={{ width: "auto" }} value={cur.size} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}>
                            {sizes.map((z) => { const d = unitPrice(p as Product, z) + extra - it.unit_price; return <option key={z} value={z}>{sizeName(z)}{Math.abs(d) > 0.004 ? ` (${d > 0 ? "+" : ""}${money(d)}: ask us)` : ""}</option>; })}
                          </select>
                        </div>
                      ) : <small>{it.color} · {sizeName(it.size)} · qty {it.qty}{Object.values(it.personalization || {}).length ? ` · ${Object.values(it.personalization).join(", ")}` : ""}</small>}
                    </div>
                    <b>{money(it.qty * it.unit_price)}</b>
                  </div>
                );
              })}
            </div>
            <div className="sf-sum">
              <span>Items</span><span>{money(order.subtotal)}</span>
              {order.shipping > 0 && <><span>Shipping</span><span>{money(order.shipping)}</span></>}
              <span>Tax</span><span>{money(order.tax)}</span>
              <span className="tot">Paid</span><span className="tot">{money(order.total)}</span>
            </div>
            <div className="sf-fine">Charged to your card as <b>FBS Print</b> on {fmtDate(order.paid_at || order.created_at, false)}.</div>
            {msg && <div className={msg.ok ? "sf-ok" : "sf-err"} style={{ marginTop: 12 }} role="status">{msg.text}</div>}
            {canChange && order.status !== "cancelled" && (
              <div className="sf-row" style={{ marginTop: 14, flexWrap: "wrap" }}>
                {!editing ? <button type="button" className="sf-btn ghost" onClick={() => { setEditing(true); setMsg(null); }}>Change sizes or student info</button> : <>
                  <button type="button" className="sf-btn" disabled={busy} onClick={async () => {
                    setBusy(true); setMsg(null);
                    const r = await changeMyOrder(order.token, { items, answers });
                    setBusy(false);
                    if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't save that." });
                    setEditing(false); setMsg({ ok: true, text: "Saved. Your order is updated." }); router.refresh();
                  }}>{busy ? "Saving…" : "Save changes"}</button>
                  <button type="button" className="sf-btn ghost" onClick={() => { setEditing(false); setItems((order.items || []).map((i) => ({ id: i.id!, color: i.color, size: i.size }))); setAnswers({ ...order.answers }); }}>Cancel</button>
                </>}
              </div>
            )}
            {!canChange && <div className="sf-fine">The goods for this store have been ordered, so changes go through FBS Print now.</div>}
          </section>

          <section className="sf-sec">
            <h3>Ask for a change</h3>
            <p>Wrong size you can&apos;t change above, a different item, or something else? Tell us and we&apos;ll work it out with {store.brand?.school || "the organizer"}.</p>
            <textarea rows={3} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="For example: I ordered an adult small but need a youth large." />
            <button type="button" className="sf-btn" style={{ marginTop: 10 }} disabled={busy || ask.trim().length < 3} onClick={async () => {
              setBusy(true); const r = await askForChange(order.token, ask); setBusy(false);
              if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't send that." });
              setAsk(""); setMsg({ ok: true, text: "Sent. FBS Print will email you back." });
            }}>Send to FBS Print</button>
          </section>
        </div>
      </main>
      <footer className="sf-foot"><div className="sf-wrap">This store is run and fulfilled by FBS Print, Richardson, Texas. Keep this page&apos;s link: it always shows where your order is.</div></footer>
    </div>
  );
}
