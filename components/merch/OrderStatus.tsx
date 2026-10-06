"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { askForChange, changeMyOrder } from "@/app/s/actions";
import type { PublicStore } from "@/lib/merchServer";
import { bySize, fmtDateTime, isYouthSize, orderCode, shortSize, sizeName, storeImg, unitPrice, type Field, type MerchOrder, type Product } from "@/lib/merch";
import { brandVars, day, money } from "./sf/kit";
import { Footer, TopBar } from "./sf/Chrome";

type P = Pick<Product, "id" | "name" | "colors" | "sizes" | "base_price" | "giveback" | "upcharges" | "imprint" | "active">;
type Sib = { code: string; token: string; student: string };

/**
 * The shopper's own page for an order (the link in their email; no sign-in): where it is, what's in it, and changes.
 * They can swap a size or color, or fix the student's info, until we order the goods; after that it's a request to FBS.
 */
export default function OrderStatus({ store, order, products, canChange, isNew, siblings = [] }: { store: PublicStore; order: MerchOrder; products: P[]; canChange: boolean; isNew: boolean; siblings?: Sib[] }) {
  const router = useRouter();
  const fields = (store.fields || []) as Field[];
  const code = orderCode(store, order.number);
  const where = store.delivery?.org?.on ? store.delivery.org.label || store.brand?.school || "the school" : "";
  const flow = ["closed", "ordered", "production", "packing", "ready", "delivered", "archived"];
  const reached = (s: string) => flow.indexOf(store.status) >= flow.indexOf(s);
  const packed = ["packed", "delivered", "picked_up", "shipped"].includes(order.status) || reached("ready");
  const done = ["delivered", "picked_up", "shipped"].includes(order.status) || reached("delivered");
  const cancelled = order.status === "cancelled" || order.status === "refunded";
  const steps = [
    { t: "Ordered", s: day(order.created_at, false), on: true },
    { t: "Store closes", s: store.closes_at ? day(store.closes_at, false) : "", on: reached("closed") },
    { t: "Shirts ordered", s: "From our suppliers", on: reached("ordered") },
    { t: "Printing", s: "Everything together", on: reached("production") },
    { t: "Packed", s: order.answers?.student ? `In a bag for ${order.answers.student.split(" ")[0]}` : "In its own bag", on: packed },
    { t: order.delivery === "org" ? "At school" : order.delivery === "pickup" ? "Ready for pickup" : "Shipped", s: order.delivery === "org" ? where : order.delivery === "ship" ? (order.tracking ? `Tracking ${order.tracking}` : "To your door") : "At FBS Print", on: done },
  ];
  const now = steps.findIndex((x) => !x.on);

  const [items, setItems] = useState((order.items || []).map((i) => ({ id: i.id!, color: i.color, size: i.size })));
  const [answers, setAnswers] = useState<Record<string, string>>({ ...order.answers });
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState(""), [busy, setBusy] = useState(false), [asked, setAsked] = useState(false);
  const first = (order.shopper?.name || "").split(" ")[0];

  return (
    <div className="sf-page" style={brandVars(store.brand)}>
      <TopBar store={store} count={0} onHome={() => router.push(`/s/${store.slug}`)} />
      <main className="sf-wrap sf-main sf-order">
        {isNew && (
          <div className="sf-thanks" role="status">
            <span className="sf-thanks-mark" aria-hidden>✓</span>
            <div>
              <h1>Thank you{first ? `, ${first}` : ""}! Your order is in.</h1>
              <p>Your receipt is on its way to <b>{order.shopper.email}</b>.{siblings.length ? ` Each student's things are in their own bag: ${[order.answers?.student, ...siblings.map((s) => s.student)].filter(Boolean).join(", ")}.` : ""}</p>
            </div>
          </div>
        )}

        <section className="sf-ohead">
          <div>
            <p className="sf-kicker2">Order {code}</p>
            <h2 data-notranslate>{order.answers?.student ? `${order.answers.student}` : order.shopper.name}</h2>
            {fields.filter((f) => f.key !== "student" && order.answers?.[f.key]).length > 0 && <p className="sf-ohead-sub">{fields.filter((f) => f.key !== "student" && order.answers?.[f.key]).map((f) => order.answers[f.key]).join(" · ")}</p>}
          </div>
          {!cancelled && store.deliver_by && !done && <div className="sf-eta"><span>Expected {order.delivery === "org" ? "at school" : order.delivery === "ship" ? "to ship" : "ready"}</span><b>{day(store.deliver_by)}</b></div>}
        </section>

        {cancelled ? <div className="sf-alert">This order was {order.status === "refunded" ? "refunded" : "cancelled"}.</div> : (
          <ol className="sf-track" aria-label="Where your order is">
            {steps.map((x, i) => <li key={x.t} className={x.on ? "done" : i === now ? "now" : ""}><i aria-hidden>{x.on ? "✓" : ""}</i><b>{x.t}</b><span>{x.s}</span></li>)}
          </ol>
        )}

        {siblings.length > 0 && (
          <div className="sf-sibs">
            <span>Also from this checkout:</span>
            {siblings.map((s) => <a key={s.token} href={`/s/${store.slug}/o/${s.token}`}>{s.student ? `${s.student}'s bag` : s.code} <small>{s.code}</small></a>)}
          </div>
        )}

        <div className="sf-order-grid">
          <section className="sf-sec">
            <div className="sf-summary-h"><h2>In this bag</h2>{canChange && !cancelled && !editing && <button type="button" className="sf-link" onClick={() => { setEditing(true); setMsg(null); }}>Change sizes or info</button>}</div>
            {editing && fields.length > 0 && (
              <div className="sf-fields sf-edit-fields">
                {fields.map((f) => (
                  <div key={f.key} className={"sf-f" + (f.kind === "text" ? " full" : "")}>
                    <label htmlFor={`sf-ea-${f.key}`}>{f.label}</label>
                    {f.kind === "select" && f.options.length
                      ? <select id={`sf-ea-${f.key}`} value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                      : <input id={`sf-ea-${f.key}`} value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />}
                  </div>
                ))}
              </div>
            )}
            <div className="sf-olines">
              {(order.items || []).map((it, i) => {
                const p = products.find((x) => x.id === it.product_id);
                const cur = items[i];
                const col = p?.colors.find((c) => c.name === cur.color) || p?.colors[0];
                const sizes = (col?.sizes?.length ? col.sizes : p?.sizes || []).slice().sort(bySize);
                const extra = p ? it.unit_price - unitPrice(p as Product, it.size) : 0;
                return (
                  <div key={it.id} className="sf-oline">
                    <span className="sf-sumline-img">{col && (col.image || col.photo) ? <img src={storeImg(col.image || col.photo)} alt="" /> : null}{it.qty > 1 && <i>{it.qty}</i>}</span>
                    <div className="sf-oline-t">
                      <b data-notranslate>{it.name}</b>
                      {editing && p ? (
                        <div className="sf-oline-edit">
                          {p.colors.length > 1 && <select aria-label="Color" value={cur.color} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}>{p.colors.map((c) => <option key={c.name}>{c.name}</option>)}</select>}
                          <select aria-label="Size" value={cur.size} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}>
                            {sizes.map((z) => { const d = unitPrice(p as Product, z) + extra - it.unit_price; return <option key={z} value={z} disabled={Math.abs(d) > 0.004}>{sizeName(z)}{Math.abs(d) > 0.004 ? ` (${d > 0 ? "+" : ""}${money(d)}: ask us below)` : ""}</option>; })}
                          </select>
                        </div>
                      ) : <span>{it.color} · {isYouthSize(it.size) ? "Youth" : "Adult"} {shortSize(it.size)}{Object.values(it.personalization || {}).length ? ` · “${Object.values(it.personalization).join(" · ")}”` : ""}</span>}
                    </div>
                    <span>{money(it.qty * it.unit_price)}</span>
                  </div>
                );
              })}
            </div>
            {editing && (
              <div className="sf-row">
                <button type="button" className="sf-btn" disabled={busy} onClick={async () => {
                  setBusy(true); setMsg(null);
                  const r = await changeMyOrder(order.token, { items, answers });
                  setBusy(false);
                  if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't save that." });
                  setEditing(false); setMsg({ ok: true, text: "Saved. Your order is updated." }); router.refresh();
                }}>{busy ? "Saving…" : "Save changes"}</button>
                <button type="button" className="sf-btn ghost" onClick={() => { setEditing(false); setItems((order.items || []).map((i) => ({ id: i.id!, color: i.color, size: i.size }))); setAnswers({ ...order.answers }); }}>Cancel</button>
              </div>
            )}
            {msg && <p className={msg.ok ? "sf-okmsg" : "sf-err"} role="status">{msg.text}</p>}
            <div className="sf-totals">
              <span>Items</span><span>{money(order.subtotal)}</span>
              {order.shipping > 0 && <><span>Shipping</span><span>{money(order.shipping)}</span></>}
              <span>Tax</span><span>{money(order.tax)}</span>
              <span className="tot">{order.pay_method === "Test (no charge)" ? "Test order" : "Paid"}</span><span className="tot">{money(order.total)}</span>
            </div>
            <p className="sf-fine">{order.pay_method === "Test (no charge)" ? "Test order: no card was charged." : <>Charged as <b>FBS Print</b> on {day(order.paid_at || order.created_at, false)}.</>} {order.delivery === "org" ? `Delivered to ${where}.` : order.delivery === "pickup" ? "Pick up at FBS Print, Richardson TX." : order.ship_to?.street1 ? `Ships to ${order.ship_to.street1}, ${order.ship_to.city}.` : ""}</p>
            {!canChange && !cancelled && <p className="sf-fine">The shirts for this store have been ordered, so changes go through FBS Print now (below).</p>}
          </section>

          <aside className="sf-sec sf-ask">
            <h2>Need something else?</h2>
            <p className="sf-sec-p">A size that costs a different amount, a different item, or a question? Tell us and we&apos;ll sort it out{store.brand?.school ? ` with ${store.brand.school}` : ""}.</p>
            {asked ? <p className="sf-okmsg" role="status">Sent. FBS Print will email you back.</p> : <>
              <textarea rows={4} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="For example: I ordered an adult small but need a youth large." aria-label="Your message to FBS Print" />
              <button type="button" className="sf-btn" disabled={busy || ask.trim().length < 3} onClick={async () => {
                setBusy(true); const r = await askForChange(order.token, ask); setBusy(false);
                if (!r.ok) return setMsg({ ok: false, text: r.error || "Couldn't send that." });
                setAsk(""); setAsked(true);
              }}>Send to FBS Print</button>
            </>}
            <p className="sf-fine">Ordered {fmtDateTime(order.created_at)}. Keep this page&apos;s link: it always shows where your order is.</p>
          </aside>
        </div>
      </main>
      <Footer store={store} />
    </div>
  );
}
