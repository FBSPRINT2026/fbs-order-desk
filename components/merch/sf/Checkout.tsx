"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkout } from "@/app/s/actions";
import type { PublicStore } from "@/lib/merchServer";
import { isYouthSize, orderTotals, r2, shortSize, storeImg, type Field } from "@/lib/merch";
import { day, money, Stepper, type Bag, type BagView } from "./kit";

type StaxJsT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
declare global { interface Window { StaxJs?: new (token: string, opts: Record<string, unknown>) => StaxJsT } }
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";
const MAX_STUDENTS = 6;

/**
 * Checkout: who it's for (one bag per student: brothers and sisters each get their own, sorted to their own classroom),
 * the parent's contact info, how it gets to them, and payment. One charge for everything.
 */
export default function Checkout({ store, bag, preview, staxToken, onEditBag, onDone }: {
  store: PublicStore; bag: Bag; preview: boolean; staxToken: string; onEditBag: () => void; onDone: (token: string) => void;
}) {
  const fields = (store.fields || []) as Field[];
  const nameKey = fields.find((f) => f.key === "student")?.key || fields.find((f) => f.kind === "text")?.key || "";
  const [students, setStudents] = useState<Record<string, string>[]>([{}]);
  // which student each bag line goes to: counts per student (they add up to the line's quantity)
  const [split, setSplit] = useState<Record<string, number[]>>({});
  const [who, setWho] = useState({ name: "", email: "", phone: "" });
  const ways = (["org", "pickup", "ship"] as const).filter((k) => store.delivery?.[k]?.on);
  const [delivery, setDelivery] = useState<"org" | "pickup" | "ship">(ways[0] || "org");
  const [ship, setShip] = useState({ street1: "", street2: "", city: "", state: "TX", zip: "" });
  const [ack, setAck] = useState(false);
  const [pay, setPay] = useState({ first: "", last: "", month: "", year: "", zip: "" });
  const [method, setMethod] = useState<"card" | "test">(staxToken && !(preview && !store.open) ? "card" : preview ? "test" : "card");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ready, setReady] = useState(false);
  const stax = useRef<StaxJsT | null>(null);
  const many = students.length > 1;
  const label = (i: number) => students[i]?.[nameKey]?.trim() || `Student ${i + 1}`;

  // keep the split in step with the bag and the number of students
  const lines = bag.live;
  const counts = (l: BagView) => {
    const s = split[l.key];
    if (s && s.length === students.length && s.reduce((a, b) => a + b, 0) === l.qty) return s;
    return students.map((_, i) => (i === 0 ? l.qty : 0));
  };
  const setCount = (l: BagView, i: number, v: number) => {
    const s = [...counts(l)];
    const others = s.reduce((a, b, j) => a + (j === i ? 0 : b), 0);
    s[i] = Math.max(0, Math.min(l.qty, v));
    // whatever comes off one student goes to the first other student (so it always adds up)
    let diff = l.qty - others - s[i];
    for (let j = 0; j < s.length && diff !== 0; j++) { if (j === i) continue; const nv = Math.max(0, s[j] + diff); diff -= nv - s[j]; s[j] = nv; }
    setSplit({ ...split, [l.key]: s });
  };
  const give = (l: BagView, i: number) => setSplit({ ...split, [l.key]: students.map((_, j) => (j === i ? l.qty : 0)) });

  // each student's bag, priced like the server does it (tax per bag; shipping once)
  const bags = useMemo(() => students.map((_, i) => lines.map((l) => ({ l, qty: counts(l)[i] || 0 })).filter((x) => x.qty > 0)), [students, lines, split]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => {
    const per = bags.map((b, i) => orderTotals(b.map((x) => ({ qty: x.qty, unit_price: x.l.each, giveback: 0 })), { taxRate: store.tax_rate, taxExempt: store.tax_exempt, shipping: delivery === "ship" && i === bags.findIndex((y) => y.length) ? +store.delivery.ship.flat || 0 : 0 }));
    const sum = (k: "subtotal" | "tax" | "shipping" | "total") => r2(per.reduce((a, t) => a + t[k], 0));
    return { per, subtotal: sum("subtotal"), tax: sum("tax"), shipping: sum("shipping"), total: sum("total") };
  }, [bags, delivery, store]);

  useEffect(() => {
    if (!staxToken || method !== "card") return;
    let dead = false;
    const start = () => {
      if (dead || !window.StaxJs || stax.current) return;
      stax.current = new window.StaxJs(staxToken, {
        number: { id: "sf-card-number", placeholder: "1234 1234 1234 1234", style: "height:44px;width:100%;font-size:16px;border:0;outline:0;background:transparent;", type: "text", format: "prettyFormat" },
        cvv: { id: "sf-card-cvv", placeholder: "123", style: "height:44px;width:100%;font-size:16px;border:0;outline:0;background:transparent;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setErr("Couldn't load the secure card form. Refresh the page and try again."));
    };
    if (window.StaxJs) start(); else if (!document.querySelector(`script[src="${STAX_SRC}"]`)) { const el = document.createElement("script"); el.src = STAX_SRC; el.async = true; el.onload = start; document.head.appendChild(el); } else { const t = setInterval(() => { if (window.StaxJs) { clearInterval(t); start(); } }, 200); return () => { dead = true; clearInterval(t); stax.current = null; setReady(false); }; }
    // the card boxes go away when switching to a test order: start fresh when they come back
    return () => { dead = true; stax.current = null; setReady(false); };
  }, [staxToken, method]);

  async function place() {
    setErr("");
    for (const [i, s] of students.entries()) {
      for (const f of fields) if (f.required && !s[f.key]?.trim()) return setErr(`${many ? `${label(i)}: ` : ""}${f.label} is required.`);
      if (many && !bags[i].length) return setErr(`${label(i)}'s bag is empty: choose what goes in it, or remove that student.`);
    }
    if (!who.name.trim()) return setErr("Enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who.email.trim())) return setErr("Enter your email: your receipt and order updates go there.");
    if (delivery === "ship" && (!ship.street1 || !ship.city || !/^\d{5}/.test(ship.zip))) return setErr("Enter the shipping address.");
    if (!ack) return setErr("Check the box to confirm you understand this is a pre-order.");
    setBusy(true);
    try {
      let pm = "";
      if (method === "card") {
        if (!stax.current || !ready) throw new Error("The secure card form is still loading.");
        if (!pay.first.trim() || !pay.last.trim()) throw new Error("Enter the name on the card.");
        if (!/^\d{1,2}$/.test(pay.month) || !/^\d{2,4}$/.test(pay.year)) throw new Error("Enter the card's expiration month and year.");
        pm = (await stax.current.tokenize({ firstname: pay.first.trim(), lastname: pay.last.trim(), method: "card", month: pay.month, year: pay.year.length === 2 ? `20${pay.year}` : pay.year, address_zip: pay.zip, total: totals.total, match_customer: false, validate: false })).id;
      }
      const r = await checkout({
        slug: store.slug, shopper: { ...who }, delivery, ship_to: { name: who.name, ...ship }, paymentMethodId: pm || "test", method,
        students: students.map((s, i) => ({ answers: s, cart: bags[i].map(({ l, qty }) => ({ product_id: l.product_id, color: l.color, size: l.size, qty, personalization: l.personalization })) })),
      });
      if (!r.ok) throw new Error(r.error);
      onDone(r.token);
    } catch (e) {
      setErr(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Check your payment details and try again.");
      setBusy(false);
    }
  }

  const fieldInput = (s: Record<string, string>, i: number, f: Field) => {
    const id = `sf-q${i}-${f.key}`, set = (v: string) => setStudents(students.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)));
    return (
      <div key={f.key} className={"sf-f" + (f.kind === "text" ? " full" : "")}>
        <label htmlFor={id}>{f.label}{f.required && <i aria-hidden> *</i>}</label>
        {f.kind === "select" && f.options.length
          ? <select id={id} value={s[f.key] || ""} onChange={(e) => set(e.target.value)}><option value="">Choose…</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : <input id={id} value={s[f.key] || ""} onChange={(e) => set(e.target.value)} autoComplete="off" autoCapitalize="words" />}
      </div>
    );
  };
  const itemLabel = (l: BagView) => `${l.color} · ${isYouthSize(l.size) ? "Youth" : "Adult"} ${shortSize(l.size)}`;

  return (
    <div className="sf-co">
      <div className="sf-co-h">
        <h1>Checkout</h1>
        <p>{store.closes_at ? <>This is a pre-order: printing starts after the store closes {day(store.closes_at)}.</> : "This is a pre-order."}</p>
      </div>
      <div className="sf-co-grid">
        <div className="sf-co-main">
          {fields.length > 0 && (
            <section className="sf-sec">
              <h2><span className="sf-num">1</span>Who it&apos;s for</h2>
              <p className="sf-sec-p">Every order is packed in its own bag, labeled with this{store.delivery?.org?.on ? ", and sorted to the classroom" : ""}. Ordering for more than one student? Add each one: they each get their own bag.</p>
              {students.map((s, i) => (
                <div key={i} className={"sf-student" + (many ? " many" : "")}>
                  {many && <div className="sf-student-h"><b>{label(i)}</b><button type="button" className="sf-link" onClick={() => { setStudents(students.filter((_, j) => j !== i)); setSplit({}); }}>Remove</button></div>}
                  <div className="sf-fields">{fields.map((f) => fieldInput(s, i, f))}</div>
                </div>
              ))}
              {students.length < MAX_STUDENTS && <button type="button" className="sf-add" onClick={() => { setStudents([...students, {}]); setSplit({}); }}>+ Add another student</button>}

              {many && (
                <div className="sf-split">
                  <h3>What goes in each bag</h3>
                  {lines.map((l) => {
                    const cs = counts(l);
                    return (
                      <div key={l.key} className="sf-split-row">
                        <div className="sf-split-it">{l.image ? <img src={storeImg(l.image)} alt="" /> : <span />}<div><b data-notranslate>{l.name}</b><span>{itemLabel(l)}{l.qty > 1 ? ` · ${l.qty} total` : ""}</span></div></div>
                        <div className="sf-split-who">
                          {l.qty === 1
                            ? students.map((_, i) => <button key={i} type="button" className={"sf-chip" + (cs[i] ? " on" : "")} aria-pressed={!!cs[i]} onClick={() => give(l, i)}>{label(i)}</button>)
                            : students.map((_, i) => <label key={i} className="sf-split-n"><span>{label(i)}</span><Stepper size="sm" value={cs[i] || 0} max={l.qty} onChange={(v) => setCount(l, i, v)} label={`${l.name} for ${label(i)}`} /></label>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="sf-sec">
            <h2><span className="sf-num">{fields.length ? 2 : 1}</span>Your info</h2>
            <p className="sf-sec-p">For your receipt and updates on your order.</p>
            <div className="sf-fields">
              <div className="sf-f full"><label htmlFor="sf-n">Your name <i aria-hidden>*</i></label><input id="sf-n" autoComplete="name" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></div>
              <div className="sf-f"><label htmlFor="sf-e">Email <i aria-hidden>*</i></label><input id="sf-e" type="email" autoComplete="email" inputMode="email" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></div>
              <div className="sf-f"><label htmlFor="sf-p">Phone <small>optional</small></label><input id="sf-p" type="tel" autoComplete="tel" value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} /></div>
            </div>
          </section>

          {ways.length > 0 && (
            <section className="sf-sec">
              <h2><span className="sf-num">{fields.length ? 3 : 2}</span>How you&apos;ll get it</h2>
              <div className="sf-opts" role="radiogroup" aria-label="Delivery">
                {ways.map((w) => (
                  <label key={w} className={"sf-opt" + (delivery === w ? " on" : "")}>
                    <input type="radio" name="sf-del" checked={delivery === w} onChange={() => setDelivery(w)} />
                    <div>{w === "org" ? <><b>Delivered to {store.delivery.org.label || store.brand?.school || "school"} <em>Free</em></b><span>{store.delivery.org.note || "Sorted by classroom and handed out at school."}</span></>
                      : w === "pickup" ? <><b>Pick up at FBS Print <em>Free</em></b><span>{store.delivery.pickup.note || "Richardson, TX. We'll email you when it's ready."}</span></>
                      : <><b>Ship to my home <em>{money(+store.delivery.ship.flat || 0)}</em></b><span>Shipped once everything is printed.</span></>}</div>
                  </label>
                ))}
              </div>
              {delivery === "ship" && (
                <div className="sf-fields" style={{ marginTop: 14 }}>
                  <div className="sf-f full"><label htmlFor="sf-s1">Street</label><input id="sf-s1" autoComplete="address-line1" value={ship.street1} onChange={(e) => setShip({ ...ship, street1: e.target.value })} /></div>
                  <div className="sf-f full"><label htmlFor="sf-s2">Apt / suite <small>optional</small></label><input id="sf-s2" autoComplete="address-line2" value={ship.street2} onChange={(e) => setShip({ ...ship, street2: e.target.value })} /></div>
                  <div className="sf-f"><label htmlFor="sf-sc">City</label><input id="sf-sc" autoComplete="address-level2" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} /></div>
                  <div className="sf-f sf-pair"><div><label htmlFor="sf-ss">State</label><input id="sf-ss" maxLength={2} autoComplete="address-level1" value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value.toUpperCase() })} /></div><div><label htmlFor="sf-sz">ZIP</label><input id="sf-sz" inputMode="numeric" autoComplete="postal-code" value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} /></div></div>
                </div>
              )}
            </section>
          )}

          <section className="sf-sec">
            <h2><span className="sf-num">{(fields.length ? 3 : 2) + (ways.length ? 1 : 0)}</span>Payment</h2>
            {preview && (
              <div className="sf-opts" style={{ marginBottom: 14 }}>
                {staxToken && <label className={"sf-opt" + (method === "card" ? " on" : "")}><input type="radio" checked={method === "card"} onChange={() => setMethod("card")} /><div><b>Card</b><span>A real charge.</span></div></label>}
                <label className={"sf-opt" + (method === "test" ? " on" : "")}><input type="radio" checked={method === "test"} onChange={() => setMethod("test")} /><div><b>Test order <em>Staff only</em></b><span>No charge. It shows up in the store like a real order.</span></div></label>
              </div>
            )}
            {!staxToken && method === "card" && <p className="sf-sec-p">Online payment isn&apos;t set up for this store yet. Please contact FBS Print.</p>}
            {staxToken && method === "card" && (
              <div className="sf-fields">
                <div className="sf-f"><label htmlFor="sf-cf">First name on card</label><input id="sf-cf" autoComplete="cc-given-name" value={pay.first} onChange={(e) => setPay({ ...pay, first: e.target.value })} /></div>
                <div className="sf-f"><label htmlFor="sf-cl">Last name on card</label><input id="sf-cl" autoComplete="cc-family-name" value={pay.last} onChange={(e) => setPay({ ...pay, last: e.target.value })} /></div>
                <div className="sf-f full"><label>Card number</label><div className="sf-stax" id="sf-card-number" /></div>
                <div className="sf-f sf-pair"><div><label htmlFor="sf-mm">Exp. month</label><input id="sf-mm" inputMode="numeric" placeholder="MM" maxLength={2} autoComplete="cc-exp-month" value={pay.month} onChange={(e) => setPay({ ...pay, month: e.target.value.replace(/\D/g, "") })} /></div><div><label htmlFor="sf-yy">Exp. year</label><input id="sf-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} autoComplete="cc-exp-year" value={pay.year} onChange={(e) => setPay({ ...pay, year: e.target.value.replace(/\D/g, "") })} /></div></div>
                <div className="sf-f sf-pair"><div><label>CVV</label><div className="sf-stax" id="sf-card-cvv" /></div><div><label htmlFor="sf-zip">Billing ZIP</label><input id="sf-zip" inputMode="numeric" autoComplete="postal-code" value={pay.zip} onChange={(e) => setPay({ ...pay, zip: e.target.value })} /></div></div>
                {!ready && <p className="sf-fine full">Loading the secure card form…</p>}
              </div>
            )}
            <p className="sf-fine">Your card is charged today and shows as <b>FBS Print</b>: we print and fulfill this store for {store.brand?.school || store.name}.</p>
          </section>
        </div>

        <aside className="sf-co-side">
          <div className="sf-sec sf-summary">
            <div className="sf-summary-h"><h2>Order summary</h2><button type="button" className="sf-link" onClick={onEditBag}>Edit bag</button></div>
            {(many ? bags.map((b, i) => ({ b, i })).filter((x) => x.b.length) : [{ b: lines.map((l) => ({ l, qty: l.qty })), i: 0 }]).map(({ b, i }) => (
              <div key={i} className="sf-sumbag">
                {many && <h3>{label(i)}&apos;s bag</h3>}
                {b.map(({ l, qty }) => (
                  <div key={l.key} className="sf-sumline">
                    <span className="sf-sumline-img">{l.image ? <img src={storeImg(l.image)} alt="" /> : null}{qty > 1 && <i>{qty}</i>}</span>
                    <span className="sf-sumline-t"><b data-notranslate>{l.name}</b><small>{itemLabel(l)}{Object.values(l.personalization || {}).length ? ` · “${Object.values(l.personalization || {}).join(" · ")}”` : ""}</small></span>
                    <span>{money(r2(qty * l.each))}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="sf-totals">
              <span>Items</span><span>{money(totals.subtotal)}</span>
              {totals.shipping > 0 && <><span>Shipping</span><span>{money(totals.shipping)}</span></>}
              <span>Tax</span><span>{money(totals.tax)}</span>
              <span className="tot">Total</span><span className="tot">{money(totals.total)}</span>
            </div>
            <label className="sf-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span><b>I understand this is a pre-order.</b> Printing starts after the store closes{store.closes_at ? ` on ${day(store.closes_at, false)}` : ""}{store.deliver_by ? `, and orders ${store.delivery?.org?.on ? "arrive at school" : "are ready"} around ${day(store.deliver_by, false)}` : ""}.</span></label>
            {err && <p className="sf-err" role="alert">{err}</p>}
            <button type="button" className="sf-btn big" disabled={busy || !lines.length || (method === "card" && !staxToken)} onClick={place}>{busy ? "Placing your order…" : method === "test" ? `Place test order · ${money(totals.total)}` : `Pay ${money(totals.total)}`}</button>
            <p className="sf-fine center">Need to change a size later? You can, from your confirmation email, until we order the shirts.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
