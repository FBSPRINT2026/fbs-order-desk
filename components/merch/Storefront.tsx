"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkout, unlockStore } from "@/app/s/actions";
import type { PublicProduct, PublicStore } from "@/lib/merchServer";
import { bySize, fmtDate, isYouthSize, orderTotals, r2, sizeName, storeImg, type Field } from "@/lib/merch";

type CartItem = { product_id: string; color: string; size: string; qty: number; personalization?: Record<string, string>; name: string; price: number; image: string };
type StaxJsT = { showCardForm: () => Promise<unknown>; tokenize: (d: Record<string, unknown>) => Promise<{ id: string }> };
declare global { interface Window { StaxJs?: new (token: string, opts: Record<string, unknown>) => StaxJsT } }
const STAX_SRC = "https://staxjs.staxpayments.com/staxjs-captcha.js";
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** readable text on the school's color (white on dark colors, ink on light ones) */
export function onColor(hex?: string) {
  const m = (hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? "#17202C" : "#fff";
}
export const brandVars = (b: PublicStore["brand"]) => ({ ["--c" as string]: b?.primary || "#1F3A8A", ["--a" as string]: b?.accent || "#F2B705", ["--on-c" as string]: onColor(b?.primary || "#1F3A8A") });

const daysLeft = (iso: string | null) => { if (!iso) return ""; const d = Math.ceil((Date.parse(iso) - Date.now()) / 86400000); return d <= 0 ? "closes today" : d === 1 ? "1 day left" : `${d} days left`; };

/** The school's banner and the pre-order ribbon (shared with the order status page). */
export function StoreHeader({ store }: { store: PublicStore }) {
  const b = store.brand || {};
  const closed = !store.open && !["draft", "review"].includes(store.status);
  return (
    <>
      <header className="sf-hero">
        {b.banner && <img className="sf-hero-img" src={storeImg(b.banner)} alt="" />}
        <div className="sf-wrap">
          {b.logo && <div className="sf-logo"><img src={storeImg(b.logo)} alt={`${b.school || store.name} logo`} /></div>}
          <div style={{ minWidth: 0 }}>
            <h1 className="sf-school" data-notranslate>{b.school || store.name}</h1>
            <div className="sf-store" data-notranslate>{b.school ? store.name : b.tagline || "Online store"}</div>
          </div>
        </div>
      </header>
      <div className="sf-stripe" />
      <div className="sf-ribbon">
        <ol className="sf-wrap" aria-label="How this pre-order works">
          <li className={closed ? "done" : ""}><b>Order by {store.closes_at ? fmtDate(store.closes_at) : "the close date"}</b><span>{store.open ? <span className="sf-left">{daysLeft(store.closes_at)}</span> : closed ? "The store is closed" : store.opens_at ? `Opens ${fmtDate(store.opens_at)}` : "Opening soon"}</span></li>
          <li><b>We print everything after it closes</b><span>Each order is packed in its own labeled bag</span></li>
          <li><b>{store.delivery?.org?.on ? `At ${store.delivery.org.label || b.school || "school"}` : store.delivery?.pickup?.on ? "Ready for pickup" : "Shipped to you"}{store.deliver_by ? ` around ${fmtDate(store.deliver_by, false)}` : ""}</b><span>{store.delivery?.org?.on ? "Sorted by homeroom and handed out at school" : "We'll email you when it's on the way"}</span></li>
        </ol>
      </div>
    </>
  );
}

export default function Storefront({ store, products, preview, staxToken }: { store: PublicStore; products: PublicProduct[]; preview: boolean; staxToken: string }) {
  const router = useRouter();
  const key = `fbs:bag:${store.slug}`;
  const [bag, setBag] = useState<CartItem[]>([]);
  useEffect(() => { try { const v = localStorage.getItem(key); if (v) setBag(JSON.parse(v)); } catch { /* private window */ } }, [key]);
  const saveBag = (b: CartItem[]) => { setBag(b); try { localStorage.setItem(key, JSON.stringify(b)); } catch { /* fine */ } };
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const [view, setView] = useState<"shop" | "checkout">("shop");
  const canBuy = store.open || preview;
  const count = bag.reduce((a, i) => a + i.qty, 0);
  const sub = r2(bag.reduce((a, i) => a + i.qty * i.price, 0));

  if (store.locked) return <Locked store={store} />;
  return (
    <div style={brandVars(store.brand)}>
      <StoreHeader store={store} />
      <main className="sf-wrap">
        {preview && !store.open && <div className="sf-note"><b>Preview.</b> This store isn&apos;t open to shoppers{store.status === "draft" || store.status === "review" ? " yet" : " now"}. Staff can place a test order (no charge).</div>}
        {!store.open && !preview && <div className="sf-closed">{["draft", "review"].includes(store.status) || (store.opens_at && Date.parse(store.opens_at) > Date.now()) ? `This store isn't open yet${store.opens_at ? `: it opens ${fmtDate(store.opens_at)}` : ""}.` : "This store is closed and isn't taking orders. If you ordered, check the email we sent for your order's status."}</div>}
        {view === "shop" ? (
          <>
            {store.welcome && <p className="sf-welcome">{store.welcome}</p>}
            <div className="sf-grid">
              {products.map((p) => {
                const prices = Object.values(p.prices), min = Math.min(...prices), max = Math.max(...prices);
                const c0 = p.colors[0];
                return (
                  <button key={p.id} type="button" className="sf-tile" onClick={() => setOpen(p)}>
                    <div className="sf-ph">{c0 && (c0.image || c0.photo) ? <img src={storeImg(c0.image || c0.photo)} alt={`${p.name} in ${c0.name}`} loading="lazy" /> : null}</div>
                    <div className="sf-tname" data-notranslate>{p.name}</div>
                    <div className="sf-tprice">{prices.length ? (min === max ? money(min) : `${money(min)} – ${money(max)}`) : ""}</div>
                    {p.colors.length > 1 && <div className="sf-dots" aria-label={`${p.colors.length} colors`}>{p.colors.map((c) => <i key={c.name} style={{ background: c.hex }} title={c.name} />)}</div>}
                  </button>
                );
              })}
              {!products.length && <p>No products here yet.</p>}
            </div>
          </>
        ) : (
          <Checkout store={store} bag={bag} setBag={saveBag} preview={preview} staxToken={staxToken} onBack={() => setView("shop")}
            onDone={(token) => { saveBag([]); router.push(`/s/${store.slug}/o/${token}?new=1`); }} />
        )}
      </main>
      <footer className="sf-foot"><div className="sf-wrap">This store is run and fulfilled by FBS Print, Richardson, Texas. Charges appear as <b>FBS Print</b> on your statement. Questions? Reply to your order email.</div></footer>
      {view === "shop" && count > 0 && (
        <div className="sf-bagbar" role="region" aria-label="Your bag">
          <div className="sf-wrap"><b>{count} item{count === 1 ? "" : "s"} · {money(sub)}</b><button type="button" className="sf-btn" onClick={() => { setView("checkout"); scrollTo({ top: 0 }); }} disabled={!canBuy}>Check out</button></div>
        </div>
      )}
      {open && <ProductSheet p={open} canBuy={canBuy} onClose={() => setOpen(null)} onAdd={(it) => { saveBag([...bag, it]); setOpen(null); }} />}
    </div>
  );
}

function Locked({ store }: { store: PublicStore }) {
  const router = useRouter();
  const [pass, setPass] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <div style={brandVars(store.brand)}>
      <StoreHeader store={store} />
      <main className="sf-wrap" style={{ maxWidth: 460, padding: "40px 16px" }}>
        <form className="sf-sec" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await unlockStore(store.slug, pass); setBusy(false); if (!r.ok) setErr(r.error || "That password isn't right."); else router.refresh(); }}>
          <h3>This store has a password</h3>
          <p>Your school or group sent it with the store link.</p>
          <div className="sf-f"><label htmlFor="sf-pass">Password</label><input id="sf-pass" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus /></div>
          {err && <div className="sf-err">{err}</div>}
          <button className="sf-btn big" style={{ marginTop: 14 }} disabled={busy || !pass.trim()}>{busy ? "Checking…" : "Open the store"}</button>
        </form>
      </main>
    </div>
  );
}

function ProductSheet({ p, canBuy, onClose, onAdd }: { p: PublicProduct; canBuy: boolean; onClose: () => void; onAdd: (it: CartItem) => void }) {
  const [color, setColor] = useState(p.colors[0]?.name || "");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [pers, setPers] = useState<Record<string, string>>({});
  const c = p.colors.find((x) => x.name === color) || p.colors[0];
  const sizes = (c?.sizes?.length ? c.sizes : p.sizes).slice().sort(bySize);
  const youth = sizes.filter(isYouthSize), adult = sizes.filter((z) => !isYouthSize(z));
  const extra = (p.personalize || []).reduce((a, f) => a + (pers[f.label]?.trim() ? +f.price || 0 : 0), 0);
  const price = size ? r2((p.prices[size] || 0) + extra) : 0;
  const base = Math.min(...sizes.map((z) => p.prices[z] || 0));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k); const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  useEffect(() => { if (size && !sizes.includes(size)) setSize(""); }, [color]); // eslint-disable-line react-hooks/exhaustive-deps
  const sizeBtn = (z: string) => {
    const diff = r2((p.prices[z] || 0) - base);
    return <button key={z} type="button" className={"sf-sz" + (size === z ? " on" : "")} onClick={() => setSize(z)} aria-pressed={size === z}><b>{z.replace(/^Y(?=X?S|M|L|XL)/, "")}</b>{diff > 0 ? <small>+{money(diff)}</small> : diff < 0 ? <small>{money(diff)}</small> : null}</button>;
  };
  return (
    <div className="sf-sheet-bg" role="dialog" aria-modal="true" aria-label={p.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sf-sheet">
        <div className="sf-sheet-img">
          {c && (c.image || c.photo) ? <img src={storeImg(c.image || c.photo)} alt={`${p.name} in ${c.name}`} /> : null}
          <button type="button" className="sf-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="sf-sheet-b">
          <div>
            <h2 data-notranslate>{p.name}</h2>
            <div className="sf-tprice" style={{ marginTop: 6 }}>{size ? money(price) : `From ${money(base)}`}</div>
          </div>
          {p.description && <div className="sf-desc">{p.description}</div>}
          {p.colors.length > 1 && (
            <div><div className="sf-label">Color <small data-notranslate>{c?.name}</small></div>
              <div className="sf-swatches">{p.colors.map((x) => <button key={x.name} type="button" className={"sf-sw" + (x.name === color ? " on" : "")} onClick={() => setColor(x.name)} aria-pressed={x.name === color}><i style={{ background: x.hex }} /><span data-notranslate>{x.name}</span></button>)}</div>
            </div>
          )}
          {youth.length > 0 && <div><div className="sf-label">Youth sizes</div><div className="sf-sizes">{youth.map(sizeBtn)}</div></div>}
          {adult.length > 0 && <div><div className="sf-label">{youth.length ? "Adult sizes" : "Size"}</div><div className="sf-sizes">{adult.map(sizeBtn)}</div></div>}
          {(p.personalize || []).map((f) => (
            <div key={f.label} className="sf-f"><label>{f.label}{f.price ? ` (+${money(f.price)})` : ""}</label><input maxLength={f.max || 30} value={pers[f.label] || ""} onChange={(e) => setPers({ ...pers, [f.label]: e.target.value })} placeholder="Optional" /></div>
          ))}
          <div className="sf-row">
            <div className="sf-qty"><button type="button" aria-label="One less" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><span aria-live="polite">{qty}</span><button type="button" aria-label="One more" onClick={() => setQty(Math.min(20, qty + 1))}>+</button></div>
            <button type="button" className="sf-btn" style={{ flex: 1 }} disabled={!size || !canBuy}
              onClick={() => onAdd({ product_id: p.id, color: c?.name || "", size, qty, personalization: pers, name: p.name, price, image: c?.image || c?.photo || "" })}>
              {!canBuy ? "Store is closed" : size ? `Add to bag · ${money(price * qty)}` : "Pick a size"}
            </button>
          </div>
          {size && <div className="sf-fine">{sizeName(size)}. Need a different size for each child? Add each one separately.</div>}
        </div>
      </div>
    </div>
  );
}

function Checkout({ store, bag, setBag, preview, staxToken, onBack, onDone }: { store: PublicStore; bag: CartItem[]; setBag: (b: CartItem[]) => void; preview: boolean; staxToken: string; onBack: () => void; onDone: (token: string) => void }) {
  const fields = (store.fields || []) as Field[];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [who, setWho] = useState({ name: "", email: "", phone: "" });
  const ways = (["org", "pickup", "ship"] as const).filter((k) => store.delivery?.[k]?.on);
  const [delivery, setDelivery] = useState<"org" | "pickup" | "ship">(ways[0] || "org");
  const [ship, setShip] = useState({ street1: "", street2: "", city: "", state: "TX", zip: "" });
  const [ack, setAck] = useState(false);
  const [pay, setPay] = useState({ first: "", last: "", month: "", year: "", zip: "" });
  const [method, setMethod] = useState<"card" | "test">(staxToken ? "card" : preview ? "test" : "card");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ready, setReady] = useState(false);
  const stax = useRef<StaxJsT | null>(null);
  const t = useMemo(() => orderTotals(bag.map((b) => ({ qty: b.qty, unit_price: b.price, giveback: 0 })), { taxRate: store.tax_rate, taxExempt: store.tax_exempt, shipping: delivery === "ship" ? +store.delivery.ship.flat || 0 : 0 }), [bag, delivery, store]);

  useEffect(() => {
    if (!staxToken) return;
    let dead = false;
    const start = () => {
      if (dead || !window.StaxJs || stax.current) return;
      stax.current = new window.StaxJs(staxToken, {
        number: { id: "sf-card-number", placeholder: "Card number", style: "height:42px;width:100%;font-size:16px;border:0;outline:0;", type: "text", format: "prettyFormat" },
        cvv: { id: "sf-card-cvv", placeholder: "CVV", style: "height:42px;width:100%;font-size:16px;border:0;outline:0;", type: "text" },
      });
      stax.current.showCardForm().then(() => { if (!dead) setReady(true); }).catch(() => setErr("Couldn't load the secure card form. Refresh the page and try again."));
    };
    if (window.StaxJs) start(); else { const el = document.createElement("script"); el.src = STAX_SRC; el.async = true; el.onload = start; document.head.appendChild(el); }
    return () => { dead = true; };
  }, [staxToken]);

  async function place() {
    setErr("");
    for (const f of fields) if (f.required && !answers[f.key]?.trim()) return setErr(`${f.label} is required.`);
    if (!who.name.trim()) return setErr("Enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who.email.trim())) return setErr("Enter your email: your receipt and updates go there.");
    if (delivery === "ship" && (!ship.street1 || !ship.city || !ship.zip)) return setErr("Enter the shipping address.");
    if (!ack) return setErr("Check the box to confirm you understand this is a pre-order.");
    setBusy(true);
    try {
      let pm = "";
      if (method === "card") {
        if (!stax.current) throw new Error("The secure card form is still loading.");
        if (!pay.first.trim() || !pay.last.trim()) throw new Error("Enter the name on the card.");
        if (!/^\d{1,2}$/.test(pay.month) || !/^\d{2,4}$/.test(pay.year)) throw new Error("Enter the card's expiration month and year.");
        pm = (await stax.current.tokenize({ firstname: pay.first.trim(), lastname: pay.last.trim(), method: "card", month: pay.month, year: pay.year.length === 2 ? `20${pay.year}` : pay.year, address_zip: pay.zip, total: t.total, match_customer: false, validate: false })).id;
      }
      const r = await checkout({ slug: store.slug, cart: bag.map(({ product_id, color, size, qty, personalization }) => ({ product_id, color, size, qty, personalization })), shopper: { ...who }, answers, delivery, ship_to: { name: who.name, ...ship }, paymentMethodId: pm || "test", method });
      if (!r.ok) throw new Error(r.error);
      onDone(r.token);
    } catch (e) {
      setErr(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Check your payment details and try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="sf-back" onClick={onBack}>← Keep shopping</button>
      <div className="sf-co">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {fields.length > 0 && (
            <section className="sf-sec">
              <h3>Who it&apos;s for</h3>
              <p>Every order is packed in its own bag labeled with this, then sorted for hand-out.</p>
              <div className="sf-fields">
                {fields.map((f) => (
                  <div key={f.key} className={"sf-f" + (f.kind === "text" ? " full" : "")}>
                    <label htmlFor={"sf-q-" + f.key}>{f.label}{f.required && <i> *</i>}</label>
                    {f.kind === "select" && f.options.length
                      ? <select id={"sf-q-" + f.key} value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      : <input id={"sf-q-" + f.key} value={answers[f.key] || ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} autoComplete="off" />}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="sf-sec">
            <h3>Your info</h3>
            <p>We&apos;ll email your receipt and let you know when your order is on its way.</p>
            <div className="sf-fields">
              <div className="sf-f full"><label htmlFor="sf-n">Your name <i>*</i></label><input id="sf-n" autoComplete="name" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></div>
              <div className="sf-f"><label htmlFor="sf-e">Email <i>*</i></label><input id="sf-e" type="email" autoComplete="email" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></div>
              <div className="sf-f"><label htmlFor="sf-p">Phone</label><input id="sf-p" type="tel" autoComplete="tel" value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} /></div>
            </div>
          </section>
          {ways.length > 0 && (
            <section className="sf-sec">
              <h3>How you&apos;ll get it</h3>
              <div className="sf-opts" role="radiogroup">
                {ways.map((w) => (
                  <label key={w} className={"sf-opt" + (delivery === w ? " on" : "")}>
                    <input type="radio" name="sf-del" checked={delivery === w} onChange={() => setDelivery(w)} />
                    <div>{w === "org" ? <><b>Delivered to {store.delivery.org.label || store.brand?.school || "school"}: free</b><span>{store.delivery.org.note || "Sorted by homeroom and handed out at school."}</span></>
                      : w === "pickup" ? <><b>Pick up at FBS Print: free</b><span>{store.delivery.pickup.note || "We'll email you when it's ready."}</span></>
                      : <><b>Ship to my home: {money(+store.delivery.ship.flat || 0)}</b><span>Shipped after the store is printed.</span></>}</div>
                  </label>
                ))}
              </div>
              {delivery === "ship" && (
                <div className="sf-fields" style={{ marginTop: 12 }}>
                  <div className="sf-f full"><label>Street</label><input autoComplete="address-line1" value={ship.street1} onChange={(e) => setShip({ ...ship, street1: e.target.value })} /></div>
                  <div className="sf-f full"><label>Apt / suite</label><input autoComplete="address-line2" value={ship.street2} onChange={(e) => setShip({ ...ship, street2: e.target.value })} /></div>
                  <div className="sf-f"><label>City</label><input autoComplete="address-level2" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} /></div>
                  <div className="sf-f" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}><div><label>State</label><input maxLength={2} autoComplete="address-level1" value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value.toUpperCase() })} /></div><div><label>ZIP</label><input inputMode="numeric" autoComplete="postal-code" value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} /></div></div>
                </div>
              )}
            </section>
          )}
          <section className="sf-sec">
            <h3>Payment</h3>
            {preview && <div className="sf-opts" style={{ marginBottom: 12 }}>
              {staxToken && <label className={"sf-opt" + (method === "card" ? " on" : "")}><input type="radio" checked={method === "card"} onChange={() => setMethod("card")} /><div><b>Card</b></div></label>}
              <label className={"sf-opt" + (method === "test" ? " on" : "")}><input type="radio" checked={method === "test"} onChange={() => setMethod("test")} /><div><b>Test order (staff only)</b><span>No charge. Shows up in the store like a real order.</span></div></label>
            </div>}
            {!staxToken && !preview && <p>Online payment isn&apos;t set up for this store yet. Please contact FBS Print.</p>}
            <div hidden={method !== "card" || !staxToken} style={{ display: method === "card" && staxToken ? "grid" : "none", gap: 10 }}>
              <div className="sf-fields">
                <div className="sf-f"><label htmlFor="sf-cf">First name on card</label><input id="sf-cf" autoComplete="cc-given-name" value={pay.first} onChange={(e) => setPay({ ...pay, first: e.target.value })} /></div>
                <div className="sf-f"><label htmlFor="sf-cl">Last name on card</label><input id="sf-cl" autoComplete="cc-family-name" value={pay.last} onChange={(e) => setPay({ ...pay, last: e.target.value })} /></div>
                <div className="sf-f full"><label>Card number</label><div className="sf-stax" id="sf-card-number" /></div>
                <div className="sf-f" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div><label htmlFor="sf-mm">Month</label><input id="sf-mm" inputMode="numeric" placeholder="MM" maxLength={2} value={pay.month} onChange={(e) => setPay({ ...pay, month: e.target.value })} /></div><div><label htmlFor="sf-yy">Year</label><input id="sf-yy" inputMode="numeric" placeholder="YYYY" maxLength={4} value={pay.year} onChange={(e) => setPay({ ...pay, year: e.target.value })} /></div></div>
                <div className="sf-f" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div><label>CVV</label><div className="sf-stax" id="sf-card-cvv" /></div><div><label htmlFor="sf-zip">Billing ZIP</label><input id="sf-zip" inputMode="numeric" autoComplete="postal-code" value={pay.zip} onChange={(e) => setPay({ ...pay, zip: e.target.value })} /></div></div>
              </div>
              {!ready && <div className="sf-fine">Loading the secure card form…</div>}
              <div className="sf-fine">Your card is charged now. It will show as <b>FBS Print</b> on your statement: we print and fulfill this store for {store.brand?.school || store.name}.</div>
            </div>
          </section>
        </div>
        <aside className="sf-sec" style={{ position: "sticky", top: 16 }}>
          <h3>Your order</h3>
          <div className="sf-lines">
            {bag.map((b, i) => (
              <div key={i} className="sf-line">
                {b.image ? <img src={storeImg(b.image)} alt="" /> : <span />}
                <div><b data-notranslate>{b.name}</b><small>{b.color} · {sizeName(b.size)} · qty {b.qty}{Object.values(b.personalization || {}).filter(Boolean).length ? ` · ${Object.values(b.personalization || {}).filter(Boolean).join(", ")}` : ""}</small><button type="button" onClick={() => setBag(bag.filter((_, j) => j !== i))}>Remove</button></div>
                <b>{money(b.qty * b.price)}</b>
              </div>
            ))}
            {!bag.length && <p>Your bag is empty.</p>}
          </div>
          <div className="sf-sum">
            <span>Items</span><span>{money(t.subtotal)}</span>
            {t.shipping > 0 && <><span>Shipping</span><span>{money(t.shipping)}</span></>}
            <span>Tax</span><span>{money(t.tax)}</span>
            <span className="tot">Total</span><span className="tot">{money(t.total)}</span>
          </div>
          <label className="sf-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span><b>I understand this is a pre-order.</b> Nothing ships right away: printing starts after the store closes{store.closes_at ? ` on ${fmtDate(store.closes_at, false)}` : ""}{store.deliver_by ? `, and orders ${store.delivery?.org?.on ? "arrive at school" : "are ready"} around ${fmtDate(store.deliver_by, false)}` : ""}.</span></label>
          {err && <div className="sf-err" role="alert">{err}</div>}
          <button type="button" className="sf-btn big" style={{ marginTop: 14 }} disabled={busy || !bag.length || (method === "card" && !staxToken)} onClick={place}>{busy ? "Placing your order…" : `${method === "test" ? "Place test order" : "Pay"} ${money(t.total)}`}</button>
          <div className="sf-fine">You can change sizes or the student&apos;s info from your confirmation email until we order the goods.</div>
        </aside>
      </div>
    </>
  );
}
