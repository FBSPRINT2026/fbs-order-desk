"use client";
import { oldLiveSince } from "@/lib/printavoOld";
import type { ThirdParty } from "@/lib/thirdParty";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { mergeSettings, type Customer, type Settings, type ShipAddress } from "@/lib/pricing";
import { addressFromText, addressReady, carrierOf, emptyAddress, estimateBoxes, oneLine, trackingLink, BILL_LABEL, type BillTo, type Shipment } from "@/lib/shipping";
import { addTracking } from "@/app/shop/tracking-actions";
import type { PvAddress } from "@/lib/archive";
import ShipWindow, { type ShipTarget } from "@/components/ShipWindow";
import SearchInput from "@/components/SearchInput";
import QuickShipQuote from "@/components/QuickShipQuote";
import TransitMap from "@/components/TransitMap";
import { money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import LabelPrinterPanel from "@/components/job/LabelPrinterPanel";
import { useUrlSearch } from "@/lib/useUrlSearch";

type NewRow = { third_party?: ThirdParty | null; id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; ship_to: string; ship_method: string; po_number: string };
type PvRow = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string; po_number: string; status_name: string; ship: PvAddress; delivery: string | null; contact: { fullName?: string; email?: string; phone?: string } | null };
type Item = ShipTarget & { printavo: boolean; shipment: Shipment | null };

const fromPv = (a: PvAddress, c: PvRow["contact"], company: string): ShipAddress => ({
  ...emptyAddress(), company: a?.companyName || company, name: a?.customerName || c?.fullName || "",
  street1: a?.address1 || "", street2: a?.address2 || "", city: a?.city || "", state: a?.state || "", zip: a?.zipCode || "",
  country: !a?.country || /^(us|usa|united states)$/i.test(a.country) ? "US" : a.country, phone: c?.phone || "", email: c?.email || "",
});
const billOf = (c?: Customer, tp?: ThirdParty | null): { bill: BillTo; account: string; zip: string } => {
  // the order's own "Bill third party" wins over the customer's usual (Oct 30)
  if (tp && (tp.account || "").trim() && tp.carrier) return { bill: tp.carrier === "UPS" ? "ups" : "fedex", account: tp.account.trim(), zip: tp.zip || c?.ship_bill_zip || "" };
  const b = (c?.ship_bill || "fbs") as BillTo;
  return { bill: b, account: b === "ups" ? c?.ship_ups_account || "" : b === "fedex" ? c?.ship_fedex_account || "" : "", zip: c?.ship_bill_zip || "" };
};
/** What still has to be filled in before an order can ship. */
const missingOf = (x: Item) => [
  !addressReady(x.to) && "Ship-to address",
  x.bill !== "fbs" && !x.account && `${x.bill === "ups" ? "UPS" : "FedEx"} account #`,
  x.bill !== "fbs" && !x.zip && "Billing ZIP",
  !x.pieces && "Piece count",
].filter(Boolean) as string[];
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");

/**
 * Shipping center: every order that's ready to ship (new orders marked Ready with delivery "Ship", and Printavo
 * orders in "Shipping - Ready to Ship"), a scan box for box labels, and the ship window.
 */
export default function ShippingCenter({ embedded = false, shipReq = null, filter = "" }: { embedded?: boolean; shipReq?: { n: string; at: number } | null; /** Outbound's Search / filter */ filter?: string } = {}) {
  const sb = createClient();
  const [items, setItems] = useState<Item[] | null>(null);
  const [shipped, setShipped] = useState<(Shipment & { label: string; customer: string })[]>([]);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [tab, setTab] = useSticky<"overview" | "ready" | "shipped" | "transit">("shipping.tab", "overview");
  const [open, setOpen] = useState<{ item: Item; box: number | null } | null>(null);
  const [q, setQ] = useState(""), [scan, setScan] = useState(""), [note, setNote] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  // Ready to ship sorted by job # or by customer (Nick, Nov 19 2026), and the line with + Tracking open
  const [sortBy, setSortBy] = useSticky<"job" | "cust">("shipping.sort", "cust");
  const [trkOpen, setTrkOpen] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [n, p, st, pt] = await Promise.all([
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, ship_to, ship_method, po_number, third_party, flags").is("discarded_at", null).eq("status", "ready").eq("delivery_method", "ship").order("due_date", { ascending: true, nullsFirst: false }),
      sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, po_number, status_name, ship:data->shippingAddress, delivery:data->deliveryMethod, contact:data->contact").is("removed_at", null).ilike("status_name", "%ready to ship%").gte("due_date", oldLiveSince()).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      // shipping part of it now, the rest still printing (components/ShipCheck.tsx; Nick, Nov 19 2026)
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, ship_to, ship_method, po_number, third_party, flags").is("discarded_at", null).in("status", ["approved", "production", "fulfillment"]).not("flags", "is", null),
    ]);
    const s = mergeSettings(st.data?.data); setSettings(s);
    type Fl = { key: string; note?: string }[] | null;
    const partOf = (o: { flags?: unknown }) => ((Array.isArray(o.flags) ? o.flags : []) as NonNullable<Fl>).find((f) => f.key === "partial");
    const parts = ((pt.data || []) as (NewRow & { flags?: unknown })[]).filter((o) => { const f = partOf(o); return !!f && !(f.note || "").startsWith("shipped:"); });
    const news = [...((n.data || []) as NewRow[]), ...parts], pvs = (p.data || []) as unknown as PvRow[];
    const custIds = [...new Set([...news.map((o) => o.customer_id), ...pvs.map((o) => o.customer_id)].filter(Boolean))] as string[];
    const [{ data: cs }, { data: ships }] = await Promise.all([
      custIds.length ? sb.from("customers").select("*").in("id", custIds) : Promise.resolve({ data: [] }),
      sb.from("shipments").select("*").neq("status", "void").or([news.length ? `order_id.in.(${news.map((o) => o.id).join(",")})` : "", pvs.length ? `archived_order_id.in.(${pvs.map((o) => o.id).join(",")})` : ""].filter(Boolean).join(",") || "id.is.null"),
    ]);
    const cust = Object.fromEntries(((cs || []) as Customer[]).map((c) => [c.id, c]));
    // a part already shipped isn't this shipment (the rest goes as its own)
    const partShipped = new Set(news.map((o) => (partOf(o as { flags?: unknown })?.note || "").replace(/^shipped:/, "")).filter((x) => x && !x.startsWith("Shipping")));
    const shipOf = (key: "order_id" | "archived_order_id", id: string) => ((ships || []) as Shipment[]).filter((x) => x[key] === id && !partShipped.has(x.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
    const list: Item[] = [
      ...news.map((o): Item => {
        const c = cust[o.customer_id || ""];
        return { kind: "order", printavo: false, id: o.id, number: String(o.number), job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: addressFromText(o.ship_to || c?.ship_address || c?.address || "", c?.name || "", c?.company || ""), service: o.ship_method || "", ...billOf(c, o.third_party), shipOn: c?.ship_on || "", shipment: shipOf("order_id", o.id) };
      }),
      ...pvs.map((o): Item => {
        const c = cust[o.customer_id];
        return { kind: "archived", printavo: true, id: o.id, number: o.visual_id, job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: fromPv(o.ship, o.contact, c?.company || ""), service: /ups|fedex|usps/i.test(o.delivery || "") ? o.delivery || "" : "", ...billOf(c), shipOn: c?.ship_on || "", shipment: shipOf("archived_order_id", o.id) };
      }),
    ].filter((x) => x.shipment?.status !== "shipped");
    setItems(list);

    const { data: done } = await sb.from("shipments").select("*").eq("status", "shipped").order("shipped_at", { ascending: false }).limit(50);
    const d = (done || []) as Shipment[];
    const oIds = d.map((x) => x.order_id).filter(Boolean) as string[], aIds = d.map((x) => x.archived_order_id).filter(Boolean) as string[];
    const [{ data: on }, { data: an }, { data: dc }] = await Promise.all([
      oIds.length ? sb.from("orders").select("id, number").in("id", oIds) : Promise.resolve({ data: [] }),
      aIds.length ? sb.from("archived_orders").select("id, visual_id").is("removed_at", null).in("id", aIds) : Promise.resolve({ data: [] }),
      d.length ? sb.from("customers").select("id, company, name").in("id", d.map((x) => x.customer_id).filter(Boolean) as string[]) : Promise.resolve({ data: [] }),
    ]);
    const lab = new Map<string, string>([...((on || []) as { id: string; number: number }[]).map((x) => [x.id, String(x.number)] as [string, string]), ...((an || []) as { id: string; visual_id: string }[]).map((x) => [x.id, x.visual_id] as [string, string])]);
    const cn = new Map(((dc || []) as { id: string; company: string; name: string }[]).map((x) => [x.id, x.company || x.name]));
    setShipped(d.map((x) => ({ ...x, label: lab.get(x.order_id || x.archived_order_id || "") || "?", customer: cn.get(x.customer_id || "") || "—" })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  // Outbound's Start shipping hands a job # here once the list is in (Nov 13, Nick)
  useEffect(() => { if (shipReq && items) onScan(shipReq.n); }, [shipReq?.at, !!items]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A scanned box label: "34317-2" (order and box) or just the order number. */
  function onScan(v: string) {
    // a box label's barcode ("34317-2"), or its QR code read by a 2D scanner (".../j/34317-2")
    const m = v.trim().match(/\/j\/#?(\d+)(?:-(\d+))?/) || v.trim().match(/^#?(\d+)(?:-(\d+))?$/);
    setScan("");
    if (!m) return setNote(`“${v}” isn't an order number.`);
    const it = (items || []).find((x) => x.number === m[1]);
    if (!it) return setNote(`#${m[1]} isn't in Ready to ship. Check its status (it has to be ready, with delivery by shipping).`);
    setNote(""); setOpen({ item: it, box: m[2] ? +m[2] : null });
  }

  const list = useMemo(() => {
    // Outbound's Search / filter, else this page's own search: every word has to be somewhere on the job
    const ws = (embedded ? filter : q).trim().toLowerCase().replace(/^#/, "").split(/\s+/).filter(Boolean);
    return (items || []).filter((x) => !ws.length || ws.every((w) => [x.number, x.customer, x.job, x.to.city, x.to.company, x.to.name].some((s) => String(s || "").toLowerCase().includes(w))));
  }, [items, q, filter, embedded]);
  const ready = list.filter((x) => !missingOf(x).length), missing = list.filter((x) => missingOf(x).length);

  return (
    <>
      <div className={embedded ? "ob-sc-head" : "page-head"}>
        {embedded ? <h2>Shipping Center</h2> : <div><div className="eyebrow">Shipping</div><h1>Shipping Center</h1></div>}
        <div className="row" style={{ gap: 8 }}>
          {!embedded && <input ref={scanRef} className="sc-scan" type="text" autoFocus placeholder="Scan a box label or type an order #" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }} aria-label="Scan a box label" />}
          <button type="button" className="btn" onClick={() => setShowSettings((x) => !x)}>Settings</button>
        </div>
      </div>
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      {showSettings && <ShipSettingsPanel s={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); }} />}
      {showSettings && <LabelPrinterPanel />}
      {!addressReady(settings.ship.from) && !showSettings && <div className="banner" style={{ marginBottom: 10 }}>Rates and transit times are figured from ZIP {settings.ship.from.zip || "(not set)"}. Add our street address in <button type="button" className="linkbtn" style={{ fontSize: "inherit" }} onClick={() => setShowSettings(true)}>Settings</button> before labels can be printed.</div>}

      <div className="sc-tabrow">
        <div className="aa-sub sc-tabs" role="tablist">
          <button type="button" className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button type="button" className={tab === "ready" ? "on" : ""} onClick={() => setTab("ready")}>Ready To Ship<span className="aa-n">{items?.length ?? "…"}</span></button>
          <button type="button" className={tab === "shipped" ? "on" : ""} onClick={() => setTab("shipped")}>Shipped<span className="aa-n">{shipped.length}</span></button>
          <button type="button" className={tab === "transit" ? "on" : ""} onClick={() => setTab("transit")}>Transit Map</button>
        </div>
        {tab === "ready" && !embedded && <label className="aa-search"><SearchInput placeholder="Search orders" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      </div>

      {tab === "overview" ? (
        <Overview items={items} shipped={shipped} perBox={settings.ship.perBox} onOpen={(x) => setOpen({ item: x, box: null })} go={setTab} />
      ) : tab === "transit" ? (
        <div className="sc-transit sc-stack">
          <section className="db-card db-blue"><div className="db-card-h"><h2>Transit Time Map</h2><span className="faint db-h-note">business days from our shop</span></div><TransitMap /></section>
          <section className="db-card db-orange"><div className="db-card-h"><h2>Rate &amp; Transit Calculator</h2></div><QuickShipQuote /></section>
        </div>
      ) : tab === "ready" ? (
        items === null ? <div className="empty">Loading…</div> : (
          // two lists, stacked, the page growing to fit them (no box that scrolls): Ready to ship, then the ones that need
          // something filled in first (Nick, Nov 19 2026)
          <div className="scr-w">
            {([[ready, false], [missing, true]] as const).map(([xs, miss]) => {
              const sorted = [...xs].sort((a, b) => (sortBy === "cust" ? a.customer.localeCompare(b.customer) : 0) || a.number.localeCompare(b.number, undefined, { numeric: true }));
              const rows: React.ReactNode[] = [];
              let cur = "";
              for (const x of sorted) {
                if (sortBy === "cust" && x.customer !== cur) { cur = x.customer; const n = sorted.filter((y) => y.customer === cur).length; rows.push(<div key={"g" + cur} className="scr-g">{cur}<span>{n} job{n === 1 ? "" : "s"}</span></div>); }
                const k = x.kind + x.id;
                rows.push(<ShipLine key={k} x={x} perBox={settings.ship.perBox} missing={miss ? missingOf(x) : undefined} showCust={sortBy === "job"} onOpen={() => setOpen({ item: x, box: null })}
                  trk={trkOpen === k} onTrk={() => setTrkOpen(trkOpen === k ? "" : k)} onTracked={(m) => { setTrkOpen(""); setNote(m); void load(); }} />);
              }
              return (
                <section key={miss ? "m" : "r"} className={"scr" + (miss ? " warn" : "")}>
                  <div className="scr-h"><b>{miss ? "Ready to ship · needs info" : "Ready to ship"}</b><span className="aa-n">{xs.length}</span>
                    <span className="spacer" />
                    {!miss && <span className="scr-sort"><span className="faint">Sort by</span><span className="scr-seg" role="group" aria-label="Sort by">{([["job", "Job #"], ["cust", "Customer"]] as const).map(([v, l]) => <button key={v} type="button" className={sortBy === v ? "on" : ""} onClick={() => setSortBy(v)}>{l}</button>)}</span></span>}
                  </div>
                  {rows}
                  {!xs.length && <div className="aa-empty">{(embedded ? filter : q) ? "No matches." : miss ? "Nothing's missing." : "Nothing ready right now."}</div>}
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="aa-card aa-tblcard">
          <table className="aa-tbl">
            <thead><tr><th>#</th><th>Customer</th><th>Shipped</th><th>Service</th><th className="r">Boxes</th><th>Paid by</th><th>Tracking</th></tr></thead>
            <tbody>
              {shipped.map((s) => (
                <tr key={s.id} style={{ cursor: "default" }}>
                  <td className="num">{s.label}</td>
                  <td>{s.customer}<div className="aa-s">{oneLine(s.ship_to)}</div></td>
                  <td>{s.shipped_at ? new Date(s.shipped_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</td>
                  <td>{[s.carrier, s.service].filter(Boolean).join(" ") || "—"}</td>
                  <td className="r num">{s.boxes.length}</td>
                  <td className="aa-s">{BILL_LABEL[s.bill_to]}</td>
                  <td className="aa-s">{s.boxes.filter((b) => b.tracking).map((b) => <div key={b.n}><a href={trackingLink(b.tracking!)} target="_blank" rel="noreferrer">{b.tracking}</a></div>)}</td>
                </tr>
              ))}
              {!shipped.length && <tr><td colSpan={7}><div className="aa-empty">Nothing shipped from here yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && <ShipWindow t={open.item} existing={open.item.shipment} settings={settings.ship} focusBox={open.box}
        onClose={() => { setOpen(null); setTimeout(() => scanRef.current?.focus(), 50); }}
        onDone={(m) => { setOpen(null); setNote(m); load(); setTimeout(() => scanRef.current?.focus(), 50); }} />}
    </>
  );
}

/** The shipping dashboard: what to ship next, what went out, and the rate / transit tools. */
function Overview({ items, shipped, perBox, onOpen, go }: { items: Item[] | null; shipped: (Shipment & { label: string; customer: string })[]; perBox: number; onOpen: (x: Item) => void; go: (t: "overview" | "ready" | "shipped" | "transit") => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const all = items || [];
  const missing = all.filter((x) => missingOf(x).length);
  const late = all.filter((x) => x.due && x.due.slice(0, 10) < today);
  const next = [...all].sort((a, b) => (a.due || "9").localeCompare(b.due || "9")).slice(0, 8);
  const weekAgo = Date.now() - 7 * 86400000, monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const week = shipped.filter((x) => x.shipped_at && Date.parse(x.shipped_at) >= weekAgo);
  const month = shipped.filter((x) => x.shipped_at && Date.parse(x.shipped_at) >= monthStart);
  const billed = month.reduce((a, x) => a + (+(x.price || 0)), 0), cost = month.reduce((a, x) => a + (+(x.cost || 0)), 0);
  const kpi = (label: string, value: React.ReactNode, sub: string, tone = "", onClick?: () => void) => (
    <button type="button" className={"sc-kpi " + tone} onClick={onClick} disabled={!onClick}><span>{label}</span><b>{value}</b><small>{sub}</small></button>
  );
  return (
    <div className="sc-ov">
      <div className="sc-kpis">
        {kpi("Ready To Ship", items ? all.length - missing.length : "…", "everything filled in", "blue", () => go("ready"))}
        {kpi("Missing Info", items ? missing.length : "…", "address, account or pieces", missing.length ? "warn" : "", () => go("ready"))}
        {kpi("Late", items ? late.length : "…", "past the in-hands date", late.length ? "bad" : "", () => go("ready"))}
        {kpi("Shipped This Week", week.length, `${week.reduce((a, x) => a + (x.boxes?.length || 0), 0)} boxes`, "teal", () => go("shipped"))}
        {kpi("Shipping This Month", money(billed), cost ? `our cost ${money(cost)}` : "billed to customers", "orange")}
      </div>
      <div className="dash-row dash-2-1">
        <div className="dash-col">
          <section className="db-card db-blue">
            <div className="db-card-h"><h2>Ship Next</h2><span className="faint db-h-note">soonest in-hands date first</span><span className="spacer" /><button type="button" className="linkbtn" onClick={() => go("ready")}>All ready to ship →</button></div>
            {items === null ? <div className="db-empty">Loading…</div> : !next.length ? <div className="db-empty">Nothing waiting to ship. When an order is marked Ready with delivery by shipping, it shows up here.</div> : (
              <ul className="db-list">{next.map((x) => { const m = missingOf(x); const lt = x.due && x.due.slice(0, 10) < today; const bx = x.shipment?.boxes?.length || estimateBoxes(x.pieces, perBox); return (
                <li key={x.kind + x.id} className="db-row sc-next">
                  <span className="db-num">#{x.number}</span>
                  <span className="db-main"><b>{x.customer}</b><span className="faint">{[addressReady(x.to) ? `${x.to.city}, ${x.to.state}` : "", `${x.pieces || "?"} pcs · ${bx} box${bx === 1 ? "" : "es"}`].filter(Boolean).join(" · ")}</span>{m.length ? <span className="sc-miss-s">Missing: {m.join(", ")}</span> : null}</span>
                  <span className="db-side"><span className={"sc-due" + (lt ? " late" : "")}>{lt ? "Late · " : ""}{day(x.due)}</span><button type="button" className={"btn sm" + (m.length ? "" : " primary")} onClick={() => onOpen(x)}>{m.length ? "Fill In" : "Ship"}</button></span>
                </li>
              ); })}</ul>
            )}
          </section>
          <section className="db-card db-teal">
            <div className="db-card-h"><h2>Recently Shipped</h2><span className="spacer" /><button type="button" className="linkbtn" onClick={() => go("shipped")}>All shipments →</button></div>
            {!shipped.length ? <div className="db-empty">Nothing shipped from here yet.</div> : (
              <ul className="db-list">{shipped.slice(0, 6).map((x) => (
                <li key={x.id} className="db-row">
                  <span className="db-num">#{x.label}</span>
                  <span className="db-main"><b>{x.customer}</b><span className="faint">{[x.carrier, x.service].filter(Boolean).join(" ") || "—"} · {x.boxes.length} box{x.boxes.length === 1 ? "" : "es"} · {x.ship_to?.city ? `${x.ship_to.city}, ${x.ship_to.state}` : ""}</span></span>
                  <span className="db-side"><span className="faint">{x.shipped_at ? new Date(x.shipped_at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>{x.boxes.find((b) => b.tracking) && <a className="btn sm" href={trackingLink(x.boxes.find((b) => b.tracking)!.tracking!)} target="_blank" rel="noreferrer">Track</a>}</span>
                </li>
              ))}</ul>
            )}
          </section>
        </div>
        <div className="dash-col">
          <section className="db-card db-salmon"><div className="db-card-h"><h2>Transit Map</h2><span className="spacer" /><button type="button" className="linkbtn" onClick={() => go("transit")}>Full map →</button></div><TransitMap compact /></section>
          <section className="db-card db-orange"><div className="db-card-h"><h2>Rate &amp; Transit Calculator</h2></div><QuickShipQuote compact /></section>
        </div>
      </div>
    </div>
  );
}

/** One job on Ready to ship: click it to ship; + Tracking beside Ship for one shipped some other way (Nick, Nov 19 2026) */
function ShipLine({ x, perBox, missing, showCust, onOpen, trk, onTrk, onTracked }: { x: Item; perBox: number; missing?: string[]; showCust: boolean; onOpen: () => void; trk: boolean; onTrk: () => void; onTracked: (msg: string) => void }) {
  const late = !!x.due && x.due.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const boxes = x.shipment?.boxes?.length || estimateBoxes(x.pieces, perBox);
  return (
    <div className={"scr-l" + (trk ? " open" : "")}>
      <div className="scr-r">
        <button type="button" className="scr-main" onClick={onOpen} title={missing?.length ? "Fill in what's missing and ship it" : "Ship it"}>
          <b className="scr-n">#{x.number}</b>
          <span className="scr-j">{showCust && <b>{x.customer}</b>}{showCust && x.job ? " · " : ""}{x.job || (!showCust ? x.customer : "")}{x.printavo && <em className="sc-tag">Printavo</em>}{x.shipment && <em className="sc-tag draft">Started</em>}</span>
          <span className="scr-m">{missing?.length ? <em className="scr-need">Needs {missing.join(", ").toLowerCase()}</em> : <>{x.pieces || "?"} pcs · {boxes} box{boxes === 1 ? "" : "es"}{addressReady(x.to) ? ` · ${x.to.city}, ${x.to.state}` : ""}</>}</span>
          <span className={"scr-d" + (late ? " late" : "")}>{late ? "Late · " : ""}{day(x.due)}</span>
        </button>
        <span className="scr-a">
          <button type="button" className={"btn sm" + (trk ? " on" : "")} onClick={onTrk} aria-expanded={trk} title="Shipped some other way (FedEx's site, their account): paste the tracking">+ Tracking</button>
          <button type="button" className={"btn sm" + (missing?.length ? "" : " primary")} onClick={onOpen}>{missing?.length ? "Fill in" : "Ship"}</button>
        </span>
      </div>
      {trk && <TrackForm x={x} onDone={onTracked} onCancel={onTrk} />}
    </div>
  );
}

/** + Tracking: a box per tracking number, a new one drops in as soon as the last is filled; Done saves them all */
function TrackForm({ x, onDone, onCancel }: { x: Item; onDone: (msg: string) => void; onCancel: () => void }) {
  const [vals, setVals] = useState<string[]>([""]), [carrier, setCarrier] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState<number | null>(0);
  useEffect(() => { if (focusAt != null) { refs.current[focusAt]?.focus(); setFocusAt(null); } }, [focusAt]);
  const filled = vals.map((v) => v.trim()).filter(Boolean);
  const guess = (carrierOf(filled[0] || "") || "FedEx") as string, car = carrier || guess;
  // typing or pasting into the last box adds an empty one under it; a paste of several numbers fills a box each
  const put = (i: number, v: string) => {
    const parts = v.split(/[\s,;]+/).filter(Boolean);
    const next = [...vals];
    if (parts.length > 1) next.splice(i, 1, ...parts); else next[i] = v;
    while (next.length > 1 && !next[next.length - 1].trim() && !next[next.length - 2].trim()) next.pop();
    if (next[next.length - 1].trim()) next.push("");
    setVals(next); setErr("");
    if (parts.length > 1) setFocusAt(next.length - 1);
  };
  async function done() {
    if (!filled.length) { setErr("Paste a tracking number first."); return; }
    setBusy(true); setErr("");
    const r = await addTracking({ kind: x.kind === "archived" ? "archived" : "order", id: x.id, numbers: filled, carrier: car });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone(`#${x.number} shipped · ${r.n} ${r.carrier || "tracking"} number${r.n === 1 ? "" : "s"} saved${r.did === "completed" ? " · order completed" : r.did === "part" ? " · the rest ships when it's printed" : ""}`);
  }
  return (
    <div className="trk" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      {vals.map((v, i) => (
        <div key={i} className="trk-f">
          <span>Box {i + 1}</span>
          <input ref={(el) => { refs.current[i] = el; }} type="text" value={v} placeholder="Paste tracking #" aria-label={`Box ${i + 1} tracking number`} spellCheck={false} autoComplete="off" autoFocus={i === 0}
            onChange={(e) => put(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (e.ctrlKey || e.metaKey || (!v.trim() && filled.length)) void done(); else setFocusAt(Math.min(i + 1, vals.length - 1)); } }} />
          <i>{v.trim() ? carrierOf(v.trim()) || "" : ""}</i>
        </div>
      ))}
      <div className="trk-b">
        <span className="faint">{filled.length} tracking number{filled.length === 1 ? "" : "s"}</span>
        <select value={car} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier">{["FedEx", "UPS", "USPS", "Other"].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <span className="spacer" />
        <button type="button" className="btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn sm primary" onClick={() => void done()} disabled={busy}>{busy ? "Saving…" : "Done"}</button>
      </div>
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}

/** Pieces per box, our ship-from address, box sizes on hand, and the markup on our own account. */
function ShipSettingsPanel({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [v, setV] = useState(s.ship);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const f = (k: keyof ShipAddress, label: string, cls = "") => <label className={cls}>{label}<input type="text" value={v.from[k]} onChange={(e) => setV({ ...v, from: { ...v.from, [k]: e.target.value } })} /></label>;
  const n = (k: "perBox" | "markupPct" | "perBoxFee" | "minCharge" | "thirdPartyFee" | "goodsLeadDays", label: string, unit: string) => (
    <label>{label}<div className="sw-in"><input type="number" min={0} step="0.01" value={v[k]} onChange={(e) => setV({ ...v, [k]: +e.target.value || 0 })} /><span>{unit}</span></div></label>
  );
  async function save() {
    setBusy(true); setErr("");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const next = { ...(data?.data || {}), ship: v };
    const { error } = await sb.from("settings").upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) setErr(error.message); else onSaved(mergeSettings(next));
  }
  return (
    <section className="panel sc-set">
      <div className="panel-h"><h2>Shipping settings</h2></div>
      <div className="panel-b stack" style={{ gap: 14 }}>
        <div className="sc-grid">
          <div>
            <div className="sw-h">Ship from (our address)</div>
            <div className="sw-addr">{f("company", "Company", "wide")}{f("name", "Attention", "wide")}{f("street1", "Street", "wide")}{f("street2", "Suite / unit", "wide")}{f("city", "City")}<div className="sw-st">{f("state", "State")}{f("zip", "ZIP")}</div>{f("phone", "Phone")}{f("email", "Email")}</div>
          </div>
          <div>
            <div className="sw-h">Boxes</div>
            <div className="sc-nums">{n("perBox", "Pieces per box (for the estimate)", "pcs")}</div>
            <div className="sw-h" style={{ marginTop: 10 }}>Box sizes we keep</div>
            {v.boxes.map((b, i) => (
              <div key={i} className="sc-box">
                <input type="text" value={b.name} onChange={(e) => setV({ ...v, boxes: v.boxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Box name" />
                {(["length", "width", "height"] as const).map((k) => <input key={k} type="number" min={0} value={b[k]} onChange={(e) => setV({ ...v, boxes: v.boxes.map((x, j) => (j === i ? { ...x, [k]: +e.target.value || 0 } : x)) })} aria-label={k} />)}
                <button type="button" className="btn icon ghost sm" aria-label="Remove size" onClick={() => setV({ ...v, boxes: v.boxes.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => setV({ ...v, boxes: [...v.boxes, { name: "New", length: 0, width: 0, height: 0 }] })}>+ Box size</button>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 8 }}>New boxes start at
              <select value={v.defaultBox} onChange={(e) => setV({ ...v, defaultBox: e.target.value })}>{v.boxes.map((b) => <option key={b.name} value={b.name}>{b.name} {b.length}×{b.width}×{b.height}</option>)}</select>
            </label>
            <div className="sw-h" style={{ marginTop: 14 }}>What customers pay</div>
            <div className="sc-nums">
              {n("markupPct", "Markup on our account", "%")}
              {n("perBoxFee", "Plus per box", "$")}
              {n("minCharge", "Minimum charge", "$")}
              {n("thirdPartyFee", "Per box on their own account", "$")}
            </div>
            <div className="sw-h" style={{ marginTop: 14 }}>Customer supplied goods</div>
            <div className="sc-nums">{n("goodsLeadDays", "Goods must arrive this many business days before the in-hands date", "days")}</div>
          </div>
        </div>
        {err && <div className="pv-err">{err}</div>}
        <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save settings"}</button></div>
      </div>
    </section>
  );
}
