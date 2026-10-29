"use client";
import { useCallback, useEffect, useState } from "react";
import { TRACK, trackingUrl } from "@/lib/goods";
import { money } from "@/lib/format";
import ShopGoods from "@/components/ShopGoods";
import { addGoodsInfo, goodsPanel, readGoodsPaste, setBuyReceived, type GoodsAdd, type GoodsPanel, type PanelTrack } from "@/app/shop/goods-panel-actions";

/**
 * The order's Goods panel, under Totals (Oct 29, Nick): "N/A" and "No current information" until something is known;
 * then "FBS ordered" (our purchases: Order goods' S&S and SanMar orders, or any vendor added here) and/or "Customer
 * supplied" (their goods), with the PO, arrival and tracking. Add: who ordered, the vendor, the order number, arrival,
 * tracking; or paste a confirmation, a shipping email, a ClickUp note and the Goods reader fills it in.
 */
const day = (d?: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00" : d).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }) : "");
const blank = (who: "fbs" | "cust"): GoodsAdd => ({ who, vendor: "", po: "", eta: "", carrier: "", tracking: "" });

function Track({ t }: { t: PanelTrack }) {
  const st = t.delivered ? `Delivered ${day(t.delivered)}` : t.status && TRACK[t.status] ? TRACK[t.status] + (t.eta && t.status !== "delivered" ? ` · ${day(t.eta)}` : "") : "";
  return (
    <div className="ogp-r"><span className="faint">{t.carrier || "Tracking"}</span>
      <span className="ogp-t"><a href={trackingUrl(t.carrier, t.tracking)} target="_blank" rel="noreferrer" data-notranslate title={t.detail || t.tracking}>{t.tracking.length > 14 ? `${t.tracking.slice(0, 6)}…${t.tracking.slice(-4)}` : t.tracking}</a>{st && <small>{st}</small>}</span></div>
  );
}

export default function OrderGoodsPanel({ orderId, wholesale, customerId }: { orderId: string; wholesale: boolean; customerId: string | null }) {
  const [p, setP] = useState<GoodsPanel | null>(null), [err, setErr] = useState("");
  const [add, setAdd] = useState<GoodsAdd | null>(null), [paste, setPaste] = useState(""), [busy, setBusy] = useState("");
  const load = useCallback(() => { void goodsPanel(orderId).then((r) => (r.ok ? (setP(r.panel), setErr("")) : setErr(r.error))); }, [orderId]);
  useEffect(() => {
    load();
    // Order goods placed an order, or the order was changed elsewhere
    const on = () => load();
    window.addEventListener("fbs:order-changed", on);
    return () => window.removeEventListener("fbs:order-changed", on);
  }, [load]);

  const fbs = p?.fbs || [];
  // the customer's goods: wholesale orders, or any order where they've told us something (the old panel's card, as is)
  const showCust = wholesale || !!p?.cust;
  const head = fbs.length && showCust ? "Customer + FBS" : fbs.length ? "FBS ordered" : showCust ? "Customer supplied" : "N/A";
  const open = (who?: "fbs" | "cust", buyId?: string) => { setAdd({ ...blank(who || (wholesale ? "cust" : "fbs")), ...(buyId ? { buyId } : {}) }); setPaste(""); setErr(""); };
  async function read() {
    setBusy("read"); setErr("");
    const r = await readGoodsPaste(orderId, paste);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    // what the reader found fills the form; anything it didn't find keeps what was typed
    setAdd((a) => ({ ...(a || blank(r.add.who)), ...Object.fromEntries(Object.entries(r.add).filter(([, v]) => v)) } as GoodsAdd));
  }
  async function received(buyId: string, yes: boolean) {
    setBusy("recv"); setErr("");
    const r = await setBuyReceived(orderId, buyId, yes);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    load();
  }
  async function save() {
    if (!add) return;
    setBusy("save"); setErr("");
    const r = await addGoodsInfo(orderId, add);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setAdd(null); setPaste(""); load();
  }
  // our purchase's steps, the same four-step look as the customer's goods
  const stepOf = (b: GoodsPanel["fbs"][number]) => (b.status === "received" ? 3 : b.tracking.length && b.tracking.every((t) => t.delivered || t.status === "delivered") ? 2 : b.tracking.length ? 1 : 0);
  const FBS_STEPS = ["Ordered", "Shipped", "Delivered", "Received"];

  return (
    <section className="panel ogp" aria-label="Goods">
      <div className="panel-h"><h2>Goods</h2><span className="faint">{head === "N/A" ? head : <b className="osp-now">{head}</b>}</span></div>
      <div className="panel-b">
        {!p && !err && <div className="faint">Loading…</div>}
        {p && !fbs.length && !showCust && !add && <div className="ogp-foot"><span className="faint">No current information</span><button type="button" className="btn sm" onClick={() => open()}>Add</button></div>}
        {showCust && <div className="ogp-sec">
          {fbs.length > 0 && <div className="ogp-lbl">Customer supplied</div>}
          <ShopGoods orderIds={[orderId]} customerId={customerId} compact onCount={() => load()} />
        </div>}
        {fbs.map((b) => {
          const at = stepOf(b), c = at === 3 ? "var(--ok)" : "var(--accent)";
          return (
            <div className="ogp-sec" key={b.id}>
              {showCust && <div className="ogp-lbl">FBS ordered</div>}
              <article className="gc" style={{ ["--gc" as string]: c }}>
                <header className="gc-h"><span className="gc-st">{FBS_STEPS[at]}</span></header>
                <ol className="gc-steps" aria-label="Goods progress">{FBS_STEPS.map((l, i) => <li key={l} className={i < at ? "done" : i === at ? "now" : ""}><span />{l}</li>)}</ol>
                <div className="gc-from" data-notranslate>Ordered from <b>{b.vendor}</b>{b.po ? ` · PO ${b.po}` : ""}</div>
                <div className="ogp-r"><span className="faint">{[b.pcs ? `${b.pcs} pcs` : "", `ordered ${day(b.at)}`, b.expected && at < 2 ? `arrives ${day(b.expected)}` : ""].filter(Boolean).join(" · ")}</span>{b.total ? <span className="faint">{money(b.total)}</span> : null}</div>
                {b.tracking.map((t) => <Track key={t.tracking} t={t} />)}
                {!b.tracking.length && at < 3 && <div className="ogp-r"><span className="faint">Tracking</span><span className="faint">{/sanmar|s&s/i.test(b.vendor) ? "comes with the supplier's manifest" : "not yet"}</span></div>}
                <div className="gc-acts">
                  <button type="button" className="btn sm" disabled={!!busy} onClick={() => void received(b.id, at !== 3)}>{at === 3 ? "Not received" : "Mark received"}</button>
                  <button type="button" className="btn sm" onClick={() => open("fbs", b.id)}>+ Add tracking</button>
                  <button type="button" className="btn sm" onClick={() => open("fbs")}>+ Add another order</button>
                </div>
              </article>
            </div>
          );
        })}
        {(fbs.length > 0 || showCust) && !add && <div className="ogp-foot"><span className="faint">{fbs.length ? "" : "We ordered some too? "}</span><button type="button" className="btn sm" onClick={() => open(fbs.length ? undefined : "fbs")}>Add</button></div>}
        {add && <div className="ogp-add">
          <div className="chips" role="radiogroup" aria-label="Who ordered the goods">
            <button type="button" className={"chip" + (add.who === "fbs" ? " on" : "")} role="radio" aria-checked={add.who === "fbs"} onClick={() => setAdd({ ...add, who: "fbs" })}>FBS ordered</button>
            <button type="button" className={"chip" + (add.who === "cust" ? " on" : "")} role="radio" aria-checked={add.who === "cust"} onClick={() => setAdd({ ...add, who: "cust" })}>Customer supplied</button>
          </div>
          <div className="field"><label htmlFor="ogp-v">{add.who === "fbs" ? "Ordered from" : "Coming from"}</label><input id="ogp-v" type="text" value={add.vendor} placeholder="SanMar, S&S, One Stop, Alpha…" onChange={(e) => setAdd({ ...add, vendor: e.target.value })} /></div>
          <div className="ogp-2">
            <div className="field"><label htmlFor="ogp-po">Order / PO #</label><input id="ogp-po" type="text" value={add.po} onChange={(e) => setAdd({ ...add, po: e.target.value })} /></div>
            <div className="field"><label htmlFor="ogp-eta">Arrives</label><input id="ogp-eta" type="date" value={add.eta} onChange={(e) => setAdd({ ...add, eta: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="ogp-t">Tracking</label><input id="ogp-t" type="text" value={add.tracking} placeholder="1Z…" onChange={(e) => setAdd({ ...add, tracking: e.target.value })} /></div>
          <div className="field"><label htmlFor="ogp-paste">Or paste it and AI fills it in</label>
            <textarea id="ogp-paste" rows={2} value={paste} placeholder="A confirmation, a shipping email, a ClickUp note…" onChange={(e) => setPaste(e.target.value)} />
            {paste.trim() && <button type="button" className="linkbtn" disabled={!!busy} onClick={() => void read()}>{busy === "read" ? "Reading…" : "Fill in from this"}</button>}
          </div>
          <div className="ogp-acts"><button type="button" className="btn sm" onClick={() => { setAdd(null); setErr(""); }}>Cancel</button><button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button></div>
        </div>}
        {err && <div className="pv-err">{err}</div>}
      </div>
    </section>
  );
}
