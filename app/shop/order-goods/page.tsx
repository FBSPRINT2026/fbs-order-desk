"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { money } from "@/lib/format";
import { sizeRank } from "@/lib/sizeOrder";
import SearchInput from "@/components/SearchInput";
import { askRepForQuote, findOrdersAndCustomers, goodsPayInfo, goodsSearch, goodsStart, goodsStyle, linkGoods, placeGoods, recentGoods, type StyleColor } from "./actions";

/**
 * Order goods (Shop Tools): buy blanks from S&S right now, with or without an order. Open it from an email
 * (/shop/order-goods?email=…) and the garments the AI read from the email are filled in; from an order (?order=…) its
 * garments. Or search any style, pick a color and fill in sizes. Check with S&S (a dry run: nothing is bought), then
 * place the order: it ships to the shop and is kept here, linked to its order now or once it's made.
 */
type Line = { key: string; brand: string; style: string; color: string; size: string; qty: number; sku: string; price: number; stock: number; note: string;
  /** from an email: what the customer asked for, the style's colors to pick from, whether the match is sure */ asked?: string; options?: string[]; sure?: boolean; styleID?: number };
type Hit = { styleID: number; brand: string; style: string; title: string; image: string };
type Recent = { id: string; order_id: string | null; number: number | null; label: string; supplier_order: string; status: string; total: number | null; expected_date: string | null; lines: { qty: number; label: string }[]; created_by: string; created_at: string };
// UPS Ground always (Nick, Oct 9): "Ground (S&S picks)" can land on UPS Ground Advantage, which is slower
const SS_METHODS: [string, string][] = [["40", "UPS Ground"], ["14", "FedEx Ground"], ["16", "UPS 3 Day Select"], ["3", "UPS 2nd Day Air"], ["2", "UPS Next Day Air"], ["6", "Will call (we pick up)"]];
/** the style's page on ssactivewear.com (every color with swatches): /p/next_level/6210; Bella + Canvas is "bella" there */
const ssUrl = (brand: string, style: string) => {
  const b = /bella/i.test(brand) ? "bella" : brand.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return b && style ? `https://www.ssactivewear.com/p/${b}/${encodeURIComponent(style.toLowerCase())}` : "";
};
const day = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export default function OrderGoodsPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><OrderGoods /></Suspense>;
}

function OrderGoods() {
  const sp = useSearchParams();
  const emailId = sp.get("email") || "", orderParam = sp.get("order") || "";
  // who it's for
  const [email, setEmail] = useState<{ id: string; subject: string; from: string } | null>(null);
  const [order, setOrder] = useState<{ id: string; number: number; nickname: string } | null>(null);
  const [cust, setCust] = useState<{ id: string; name: string } | null>(null);
  const [label, setLabel] = useState(""), [find, setFind] = useState(""), [found, setFound] = useState<{ orders: { id: string; number: number; nickname: string | null }[]; customers: { id: string; name: string }[] } | null>(null);
  // what to buy
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState(""), [hits, setHits] = useState<Hit[]>([]), [pick, setPick] = useState<{ brand: string; style: string; colors: StyleColor[] } | null>(null);
  const [color, setColor] = useState(""), [qty, setQty] = useState<Record<string, number>>({});
  // ordering
  const [method, setMethod] = useState("40"), [quote, setQuote] = useState("");
  const [dry, setDry] = useState<{ orderNumber: string; warehouse: string; total: number; expected: string | null }[] | null>(null);
  // where each line ships from (the check): sku → warehouses and quantities
  const [from, setFrom] = useState<Record<string, { warehouse: string; qty: number }[]>>({});
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [msg, setMsg] = useState(""), [sure, setSure] = useState(false);
  const [recent, setRecent] = useState<Recent[] | null>(null), [recentErr, setRecentErr] = useState("");
  const [linkFor, setLinkFor] = useState<string | null>(null), [linkQ, setLinkQ] = useState(""), [linkHits, setLinkHits] = useState<{ id: string; number: number; nickname: string | null }[]>([]);

  const [pay, setPay] = useState<{ card?: string; error?: string } | null>(null);
  useEffect(() => { goodsPayInfo().then((r) => setPay(r.ok ? { card: r.card } : { error: r.error })).catch(() => null); }, []);
  const loadRecent = () => recentGoods().then((r) => { if (r.ok) { setRecent(r.list as Recent[]); setRecentErr(""); } else setRecentErr(r.error || ""); });
  useEffect(() => { void loadRecent(); }, []);
  // opened from an email or an order: fill in who it's for and the garments
  useEffect(() => {
    if (!emailId && !orderParam) return;
    setBusy("start");
    goodsStart({ email: emailId || undefined, order: orderParam || undefined }).then((r) => {
      setBusy("");
      if (!r.ok) return setErr(r.error || "Couldn't read that.");
      if ("email" in r && r.email) setEmail(r.email);
      if ("order" in r && r.order) setOrder(r.order);
      if ("customer" in r && r.customer) setCust(r.customer);
      if ("label" in r && r.label) setLabel(r.label);
      setLines((r.rows || []).map((x) => ({ key: x.key, brand: x.brand, style: x.style, color: x.color, size: x.size, qty: x.qty, sku: x.sku, price: x.price, stock: x.stock, note: x.found ? x.note : x.note || "Not found at S&S", asked: x.asked, options: x.options, sure: x.sure, styleID: x.styleID })));
      if ("read" in r && r.read === false) setMsg("The AI hasn't read this email into an order yet, so nothing is filled in. Add the garments below (or open Create order on the email first).");
    });
  }, [emailId, orderParam]);

  // style search (waits for typing to stop)
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { goodsSearch(q).then((r) => { if (r.ok) setHits(r.hits as Hit[]); else setErr(r.error || ""); }); }, 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (find.trim().length < 2) { setFound(null); return; }
    const t = setTimeout(() => { findOrdersAndCustomers(find).then((r) => { if (r.ok) setFound({ orders: r.orders, customers: r.customers }); }); }, 300);
    return () => clearTimeout(t);
  }, [find]);
  useEffect(() => {
    if (linkQ.trim().length < 2) { setLinkHits([]); return; }
    const t = setTimeout(() => { findOrdersAndCustomers(linkQ).then((r) => { if (r.ok) setLinkHits(r.orders); }); }, 300);
    return () => clearTimeout(t);
  }, [linkQ]);

  async function openStyle(h: Hit) {
    setBusy("style"); setErr(""); setHits([]); setQ("");
    const r = await goodsStyle(h.styleID);
    setBusy("");
    if (!r.ok) return setErr(r.error || "Couldn't load that style.");
    setPick({ brand: r.brand, style: r.style, colors: r.colors }); setColor(r.colors[0]?.name || ""); setQty({});
  }
  const pc = pick?.colors.find((c) => c.name === color);
  function addPicked() {
    if (!pick || !pc) return;
    const add = pc.sizes.filter((z) => (qty[z.size] || 0) > 0).map((z) => ({ key: `${pick.brand}|${pick.style}|${pc.name}|${z.size}`.toLowerCase(), brand: pick.brand, style: pick.style, color: pc.name, size: z.size, qty: qty[z.size], sku: z.sku, price: z.price, stock: z.qty, note: z.qty < qty[z.size] ? `Only ${z.qty} in stock` : "" }));
    if (!add.length) return;
    setLines((ls) => { const out = [...ls]; for (const a of add) { const i = out.findIndex((x) => x.key === a.key); if (i >= 0) out[i] = { ...out[i], qty: out[i].qty + a.qty }; else out.push(a); } return out; });
    setQty({}); setDry(null); setSure(false);
  }
  // garment by garment, each in size order (XS … 4XL), never alphabetical
  const sorted = useMemo(() => lines.map((l, i) => ({ l, i })).sort((a, b) => `${a.l.brand}|${a.l.style}|${a.l.color}`.localeCompare(`${b.l.brand}|${b.l.style}|${b.l.color}`) || sizeRank(a.l.size) - sizeRank(b.l.size)), [lines]);
  const orderable = sorted.map((x) => x.l).filter((l) => l.sku && l.qty > 0);
  const pcs = orderable.reduce((a, l) => a + l.qty, 0), total = orderable.reduce((a, l) => a + l.price * l.qty, 0);
  const po = (label || (order ? `#${order.number}` : cust ? `${cust.name} (ahead of order)` : "Stock")).trim();
  const payload = (test: boolean) => ({ lines: orderable.map((l) => ({ sku: l.sku, qty: l.qty, price: l.price, label: `${l.brand} ${l.style} ${l.color} ${l.size}`.trim() })), shippingMethod: method, test, label: po, quote, orderId: order?.id || null, customerId: cust?.id || null, activityId: email?.id || null });
  async function check() {
    setBusy("test"); setErr(""); setDry(null); setSure(false); setFrom({});
    const r = await placeGoods(payload(true)); setBusy("");
    if (!r.ok) return setErr(r.error || "S&S said no.");
    const f: Record<string, { warehouse: string; qty: number }[]> = {};
    for (const x of ("from" in r && r.from) || []) f[x.sku] = [...(f[x.sku] || []), { warehouse: x.warehouse, qty: x.qty }];
    setFrom(f); setDry(r.results || []);
  }
  const whName = (w: string) => ({ TX: "Fort Worth", KS: "Kansas", IL: "Illinois", GA: "Georgia", OH: "Ohio", KY: "Kentucky", PA: "Pennsylvania", NV: "Nevada", NJ: "New Jersey", FL: "Florida", CA: "California", MA: "Massachusetts", DS: "Mill direct" } as Record<string, string>)[w] || w;
  const away = Object.values(from).flat().filter((x) => x.warehouse !== "TX");
  async function place() {
    if (!sure) { setSure(true); return; }
    setBusy("place"); setErr("");
    const r = await placeGoods(payload(false));
    setBusy(""); setSure(false);
    if (!r.ok) return setErr(r.error || "S&S said no.");
    setMsg(r.warn || `Ordered from S&S: ${r.results?.map((x) => `${x.orderNumber}${x.warehouse ? ` (${x.warehouse})` : ""}`).join(", ")} · ${pcs} pcs${r.results?.some((x) => x.expected) ? ` · arrives ${day(r.results.map((x) => x.expected).filter(Boolean).sort().pop() || null)}` : ""}. A confirmation email from S&S is on its way.`);
    setLines([]); setDry(null); void loadRecent();
  }
  const lowStock = orderable.some((l) => l.stock < l.qty);
  // a custom quote from our S&S rep (Tiffany Clark): one click emails her the list from your own mailbox
  const [quoteSent, setQuoteSent] = useState("");
  async function askQuote() {
    const byColor = new Map<string, Line[]>();
    for (const l of orderable) { const k = `${[l.brand, l.style].filter(Boolean).join(" ")} - ${l.color}`; byColor.set(k, [...(byColor.get(k) || []), l]); }
    const list = [...byColor].map(([k, ls]) => `${k}: ${ls.map((l) => `${l.size} ${l.qty}`).join(", ")} (${ls.reduce((a, l) => a + l.qty, 0)} pcs)`).join("\n");
    const body = `Hi Tiffany,\n\nHello! We need to get a custom quote on the following:\n\n${list}\n\nTotal: ${pcs} pcs${po ? `\nPO: ${po}` : ""}\nShipping to our shop.\n\nThanks,`;
    setBusy("quote"); setErr("");
    const r = await askRepForQuote({ subject: `Custom quote request: ${pcs} pcs${po ? ` (${po})` : ""}`, body });
    setBusy("");
    if (!r.ok) return setErr(r.error || "Couldn't send the email.");
    setQuoteSent(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  }
  // from an email: the customer's color matched to the style's real colors; picking another updates every size of it
  const asks = lines.some((l) => l.asked);
  const styleCache = useMemo(() => new Map<number, StyleColor[]>(), []);
  async function pickColor(l: Line, color: string) {
    if (!l.styleID) return;
    let cs = styleCache.get(l.styleID);
    if (!cs) { const r = await goodsStyle(l.styleID); if (!r.ok) return setErr(r.error || "Couldn't load that style's colors."); cs = r.colors; styleCache.set(l.styleID, cs); }
    const c = cs.find((x) => x.name === color);
    setLines((ls) => ls.map((x) => {
      if (x.styleID !== l.styleID || (x.asked || "") !== (l.asked || "") || x.color !== l.color) return x;
      const z = c?.sizes.find((y) => y.size === x.size);
      return { ...x, color, sure: true, key: `${x.brand}|${x.style}|${color}|${x.size}`.toLowerCase(), sku: z?.sku || "", price: z?.price || 0, stock: z?.qty || 0, note: !z ? "Size not carried in this color" : z.qty < x.qty ? `Only ${z.qty} in stock` : "" };
    }));
    setDry(null); setSure(false);
  }
  const sizesShown = useMemo(() => pc?.sizes || [], [pc]);

  return (
    <div className="og">
      <div className="page-head">
        <div><div className="eyebrow">Shop Tools</div><h1>Order goods</h1><div className="faint" style={{ fontSize: 13.5 }}>Buy blanks from S&amp;S now, before there&apos;s an order or for one. They ship to the shop.</div></div>
        <Link className="btn" href="/shop/receiving">Goods &amp; Receiving</Link>
      </div>
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 10 }}>{msg}</div>}

      <section className="panel og-for">
        <div className="panel-h"><h2>For</h2></div>
        <div className="panel-b stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {email && <span className="og-chip">✉ {email.subject || "(no subject)"} <span className="faint">· {email.from}</span> <button type="button" aria-label="Not for this email" onClick={() => setEmail(null)}>✕</button></span>}
            {order && <span className="og-chip">Order <Link href={`/shop/orders/${order.id}`} target="_blank">#{order.number}</Link> {order.nickname} <button type="button" aria-label="Not for this order" onClick={() => setOrder(null)}>✕</button></span>}
            {cust && <span className="og-chip">{cust.name} <button type="button" aria-label="Not for this customer" onClick={() => setCust(null)}>✕</button></span>}
            {!email && !order && !cust && <span className="faint">Stock, or pick the order or customer it&apos;s for:</span>}
            {!order && <span className="og-find"><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Order # or customer…" aria-label="Find the order or customer" />
              {found && (found.orders.length > 0 || found.customers.length > 0) && <span className="og-hits">
                {found.orders.map((o) => <button key={o.id} type="button" onClick={() => { setOrder({ id: o.id, number: o.number, nickname: o.nickname || "" }); setFind(""); setLabel(`#${o.number}${cust ? ` ${cust.name}` : ""}`); }}>#{o.number} {o.nickname || ""}</button>)}
                {found.customers.map((c) => <button key={c.id} type="button" onClick={() => { setCust(c); setFind(""); if (!label) setLabel(`${c.name} (ahead of order)`); }}>{c.name}</button>)}
              </span>}</span>}
          </div>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>PO on the S&amp;S order<input type="text" value={label} maxLength={50} onChange={(e) => setLabel(e.target.value)} placeholder={po} style={{ maxWidth: 320 }} /></label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Garments</h2>{busy === "start" && <span className="faint">Reading it…</span>}</div>
        <div className="panel-b stack" style={{ gap: 10 }}>
          <div className="og-add">
            <span className="og-find" style={{ flex: 1 }}>
              <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onDictated={(t) => setQ(t)} placeholder="Add a style: Gildan 5000, 3001, Comfort Colors 1717…" aria-label="Search S&S styles" />
              {hits.length > 0 && <span className="og-hits wide">{hits.map((h) => <button key={h.styleID} type="button" onClick={() => openStyle(h)}>{h.image && <img src={h.image} alt="" />}<span><b>{h.brand} {h.style}</b> {h.title}</span></button>)}</span>}
            </span>
          </div>
          {busy === "style" && <div className="faint">Loading colors, sizes and stock…</div>}
          {pick && (
            <div className="og-pick">
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <a className="og-ss" href={ssUrl(pick.brand, pick.style)} target="_blank" rel="noreferrer" title="Open this style on ssactivewear.com (all its colors)"><b>{pick.brand} {pick.style}</b> ↗</a>
                <select value={color} onChange={(e) => { setColor(e.target.value); setQty({}); }} aria-label="Color">{pick.colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
                <button type="button" className="btn ghost sm" onClick={() => setPick(null)}>Close</button>
              </div>
              <div className="og-sizes">
                {sizesShown.map((z) => (
                  <label key={z.size} className={z.qty <= 0 ? "out" : ""}>
                    <b>{z.size}</b>
                    <input type="number" min={0} inputMode="numeric" value={qty[z.size] || ""} onChange={(e) => setQty({ ...qty, [z.size]: Math.max(0, Math.round(+e.target.value || 0)) })} aria-label={`${z.size} quantity`} />
                    <span>{money(z.price)}</span>
                    <span className={z.qty < (qty[z.size] || 0) ? "bad" : "faint"}>{z.qty.toLocaleString()} in stock</span>
                  </label>
                ))}
              </div>
              <div><button type="button" className="btn primary sm" disabled={!sizesShown.some((z) => (qty[z.size] || 0) > 0)} onClick={addPicked}>Add to the list</button></div>
            </div>
          )}

          {lines.length > 0 ? (
            <div style={{ overflowX: "auto" }}><table className="rv-tbl">
              <thead><tr><th>Garment</th>{asks && <th>Requested</th>}<th>{asks ? "Found color" : "Color"}</th><th>Size</th><th className="r">Qty</th><th className="r">Price</th><th className="r">In stock</th>{dry && <th>Ships from</th>}<th /></tr></thead>
              <tbody>{sorted.map(({ l, i }) => (
                <tr key={l.key} className={!l.sku ? "miss" : l.stock < l.qty ? "low" : ""}>
                  <td>{l.style && ssUrl(l.brand, l.style) ? <a className="og-ss" href={ssUrl(l.brand, l.style)} target="_blank" rel="noreferrer" title="Open this style on ssactivewear.com (all its colors)">{[l.brand, l.style].filter(Boolean).join(" ")} ↗</a> : [l.brand, l.style].filter(Boolean).join(" ") || "—"}</td>
                  {asks && <td>{l.asked || ""}</td>}
                  <td>{l.asked && l.options?.length ? (
                    <span className={"og-color" + (l.sure ? "" : " check")} title={l.sure ? "" : "A best guess: check it"}>
                      <select value={l.options.includes(l.color) ? l.color : ""} onChange={(e) => void pickColor(l, e.target.value)} aria-label={`Color for ${l.style} ${l.size}`}>
                        {!l.options.includes(l.color) && <option value="">Pick the color…</option>}
                        {l.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>{!l.sure && <span className="og-check">check</span>}
                    </span>
                  ) : l.color}</td><td>{l.size}</td>
                  <td className="r"><input type="number" min={0} value={l.qty} onChange={(e) => { const v = Math.max(0, Math.round(+e.target.value || 0)); setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: v, note: x.sku && x.stock < v ? `Only ${x.stock} in stock` : x.sku ? "" : x.note } : x))); setDry(null); setSure(false); }} style={{ width: 70, textAlign: "right" }} aria-label={`${l.style} ${l.color} ${l.size} quantity`} /></td>
                  <td className="r">{l.sku ? money(l.price) : ""}</td>
                  <td className="r">{l.sku ? l.stock.toLocaleString() : <span className="bad">{l.note || "Not at S&S"}</span>}{l.sku && l.note && <div className="bad" style={{ fontSize: 11.5 }}>{l.note}</div>}</td>
                  {dry && <td>{(from[l.sku] || []).map((w) => <span key={w.warehouse} className={"og-wh" + (w.warehouse === "TX" ? "" : " away")}>{whName(w.warehouse)}{(from[l.sku] || []).length > 1 ? ` (${w.qty})` : ""}</span>)}</td>}
                  <td><button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => { setLines((ls) => ls.filter((_, k) => k !== i)); setDry(null); setSure(false); }}>✕</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="faint">Nothing on the list yet.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-b stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <b>{pcs} pcs · about {money(total)}</b>
            <label className="row" style={{ gap: 6, fontSize: 13 }} title="The quote number Tiffany sends back: the order is priced against it">S&amp;S quote #<input type="text" value={quote} onChange={(e) => { setQuote(e.target.value.trim()); setDry(null); setSure(false); }} placeholder="optional" style={{ width: 110 }} /></label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>Ship by<select value={method} onChange={(e) => { setMethod(e.target.value); setDry(null); setSure(false); }} style={{ width: "auto" }}>{SS_METHODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            {lowStock && <span className="bad" style={{ fontSize: 12.5 }}>Some sizes are short at S&amp;S; the dry run shows what they can send.</span>}
            {lines.some((l) => !l.sku) && <span className="bad" style={{ fontSize: 12.5 }}>Red lines aren&apos;t carried by S&amp;S and won&apos;t be ordered.</span>}
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {pay?.card ? <>Paid with our S&amp;S card: <b>{pay.card}</b> · ships from the closest warehouse that has it (split only when it&apos;s short).</> : pay?.error ? <span className="bad">{pay.error}</span> : "Checking the card on file at S&S…"}
          </div>
          {dry && away.length > 0 && <div className="banner">Heads up: {away.reduce((a, x) => a + x.qty, 0)} pcs ship from outside Fort Worth ({[...new Set(away.map((x) => whName(x.warehouse)))].join(", ")}), so they&apos;ll take longer. See &quot;Ships from&quot; above.</div>}
          {dry && <div className="okmsg">Checked (nothing sent to S&amp;S): {dry.map((d) => `${whName(d.warehouse) || "warehouse"} · ~${money(d.total)}`).join("; ")} · UPS Ground. Place the order when it looks right.</div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={!orderable.length || !!busy} onClick={check}>{busy === "test" ? "Checking…" : "1. Check stock & card (dry run)"}</button>
            <button type="button" className={"btn " + (sure ? "danger" : "primary")} disabled={!dry || !orderable.length || !!busy} onClick={place} title={dry ? "" : "Run the dry run first"}>
              {busy === "place" ? "Ordering…" : sure ? `Yes, buy ${pcs} pcs from S&S · ~${money(total)}` : `2. Place the order with S&S${total ? ` · ~${money(total)}` : ""}`}</button>
            {sure && <button type="button" className="btn ghost" onClick={() => setSure(false)}>Cancel</button>}
            <span className="spacer" />
            <button type="button" className="btn" disabled={!orderable.length || !!busy} onClick={askQuote} title="Emails Tiffany Clark (our S&S rep) this list for a custom quote, from your email">{busy === "quote" ? "Sending…" : "✉ Email for custom quote"}</button>
          </div>
          {quoteSent && <div className="okmsg">Sent to Tiffany Clark (tiffany.clark@ssactivewear.com) at {quoteSent}. When she sends the quote number, put it in &quot;S&amp;S quote #&quot; and run the dry run: the order is priced against her quote.</div>}
          {sure && <div className="faint" style={{ fontSize: 12.5 }}>This buys the goods from S&amp;S on our account (PO &quot;{po}&quot;), shipped to the shop. Click again to confirm.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Ordered here lately</h2></div>
        <div className="panel-b">
          {recentErr ? <div className="banner">{recentErr}</div> : !recent ? <div className="faint">Loading…</div> : !recent.length ? <div className="faint">Nothing ordered through S&amp;S here yet.</div> : (
            <div style={{ overflowX: "auto" }}><table className="rv-tbl">
              <thead><tr><th>Ordered</th><th>PO</th><th>S&amp;S order</th><th className="r">Pcs</th><th className="r">Total</th><th>Arrives</th><th>Order</th></tr></thead>
              <tbody>{recent.map((b) => (
                <tr key={b.id}>
                  <td>{day(b.created_at)}<div className="faint" style={{ fontSize: 11.5 }}>{b.created_by.split("@")[0]}</div></td>
                  <td>{b.label || "—"}</td><td>{b.supplier_order}</td>
                  <td className="r">{(b.lines || []).reduce((a, l) => a + (+l.qty || 0), 0)}</td>
                  <td className="r">{b.total != null ? money(b.total) : ""}</td>
                  <td>{b.status === "received" ? "Received" : day(b.expected_date) || "—"}</td>
                  <td>{b.order_id ? <Link href={`/shop/orders/${b.order_id}`}>#{b.number || "order"}</Link> : linkFor === b.id ? (
                    <span className="og-find"><input type="search" autoFocus value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Order #…" aria-label="Link to order" style={{ width: 120 }} />
                      {linkHits.length > 0 && <span className="og-hits">{linkHits.map((o) => <button key={o.id} type="button" onClick={async () => { const r = await linkGoods(b.id, o.id); if (!r.ok) setErr(r.error || ""); setLinkFor(null); setLinkQ(""); void loadRecent(); }}>#{o.number} {o.nickname || ""}</button>)}</span>}</span>
                  ) : <button type="button" className="btn ghost sm" onClick={() => { setLinkFor(b.id); setLinkQ(""); }}>Link to order</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </div>
  );
}
