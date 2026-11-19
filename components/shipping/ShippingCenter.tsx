"use client";
import { oldLiveSince } from "@/lib/printavoOld";
import type { ThirdParty } from "@/lib/thirdParty";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { mergeSettings, type Customer, type Group, type Settings, type ShipAddress } from "@/lib/pricing";
import { addressFromText, addressReady, carrierOf, emptyAddress, estimateBoxes, oneLine, trackingLink, BILL_LABEL, type BillTo, type Shipment } from "@/lib/shipping";
import { addTracking } from "@/app/shop/tracking-actions";
import { shipPart } from "@/app/shop/parts-actions";
import { kindsOf, mixParts, MIX_ABBR, MIX_WORD, type MixPart, type MixSlot } from "@/lib/mixParts";
import type { MachineType } from "@/lib/production";
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
type Item = ShipTarget & { printavo: boolean; shipment: Shipment | null; /** the rest of an order shipped in parts */ rest?: boolean; /** what's in it: SP / EMB / HP */ kinds?: MachineType[] };

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
export default function ShippingCenter({ embedded = false, shipReq = null, filter = "", settingsAt = 0 }: { embedded?: boolean; shipReq?: { n: string; at: number } | null; /** Outbound's Search / filter */ filter?: string;
  /** Outbound's gear in its header (Nick, Nov 19 2026): each press opens or closes the shipping settings */ settingsAt?: number } = {}) {
  const sb = createClient();
  const [items, setItems] = useState<Item[] | null>(null);
  const [shipped, setShipped] = useState<(Shipment & { label: string; customer: string })[]>([]);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  // Ready to ship / Shipped / Transit map; no Overview (Nick, Nov 19 2026)
  const [tab, setTab] = useSticky<"ready" | "shipped" | "transit">("shipping.tab2", "ready");
  // mixed jobs with a part printed and a part not: they can ship part now (Nick, Nov 19 2026)
  const [partly, setPartly] = useState<{ item: Item; parts: MixPart[]; went: Shipment | null }[]>([]);
  const [open, setOpen] = useState<{ item: Item; box: number | null } | null>(null);
  const [q, setQ] = useState(""), [scan, setScan] = useState(""), [note, setNote] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => { if (settingsAt) setShowSettings((x) => !x); }, [settingsAt]);
  // Ready to ship sorted by job # or by customer (Nick, Nov 19 2026), and the line with + Tracking open
  const [sortBy, setSortBy] = useSticky<"job" | "cust">("shipping.sort", "cust");
  const [trkOpen, setTrkOpen] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [n, p, st, pt] = await Promise.all([
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, ship_to, ship_method, po_number, third_party, flags, groups").is("discarded_at", null).eq("status", "ready").eq("delivery_method", "ship").order("due_date", { ascending: true, nullsFirst: false }),
      sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, po_number, status_name, ship:data->shippingAddress, delivery:data->deliveryMethod, contact:data->contact").is("removed_at", null).ilike("status_name", "%ready to ship%").gte("due_date", oldLiveSince()).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      // still in production with a part printed: Partly printed · can ship part (Nick, Nov 19 2026)
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, ship_to, ship_method, po_number, third_party, flags, groups").is("discarded_at", null).in("status", ["production", "fulfillment"]).eq("delivery_method", "ship").limit(400),
    ]);
    const s = mergeSettings(st.data?.data); setSettings(s);
    type Fl = { key: string; note?: string }[] | null;
    const partOf = (o: { flags?: unknown }) => ((Array.isArray(o.flags) ? o.flags : []) as NonNullable<Fl>).find((f) => f.key === "partial");
    // the mixed ones with at least one part printed and one not
    const prod = (pt.data || []) as (NewRow & { flags?: unknown; groups?: Group[] })[];
    const mixed = prod.filter((o) => kindsOf(o.groups).length > 1);
    const { data: msl } = mixed.length ? await sb.from("production_slots").select("order_id, kind, status, day, machine, finished_at").in("order_id", mixed.map((o) => o.id)) : { data: [] };
    const partRows = mixed.map((o) => ({ o, parts: mixParts(o.groups, ((msl || []) as MixSlot[]).filter((x) => x.order_id === o.id)) })).filter((x) => x.parts.some((q) => q.state === "ok") && x.parts.some((q) => q.state !== "ok"));
    const news = [...((n.data || []) as NewRow[]), ...partRows.map((x) => x.o)], pvs = (p.data || []) as unknown as PvRow[];
    const custIds = [...new Set([...news.map((o) => o.customer_id), ...pvs.map((o) => o.customer_id)].filter(Boolean))] as string[];
    const [{ data: cs }, { data: ships }] = await Promise.all([
      custIds.length ? sb.from("customers").select("*").in("id", custIds) : Promise.resolve({ data: [] }),
      sb.from("shipments").select("*").neq("status", "void").or([news.length ? `order_id.in.(${news.map((o) => o.id).join(",")})` : "", pvs.length ? `archived_order_id.in.(${pvs.map((o) => o.id).join(",")})` : ""].filter(Boolean).join(",") || "id.is.null"),
    ]);
    const cust = Object.fromEntries(((cs || []) as Customer[]).map((c) => [c.id, c]));
    // a part already shipped isn't this shipment (the rest goes as its own)
    const partShipped = new Set(news.map((o) => (partOf(o as { flags?: unknown })?.note || "").replace(/^shipped:/, "")).filter((x) => x && !x.startsWith("Shipping")));
    const shipOf = (key: "order_id" | "archived_order_id", id: string) => ((ships || []) as Shipment[]).filter((x) => x[key] === id && !partShipped.has(x.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
    const restOf = (o: { flags?: unknown }) => (partOf(o)?.note || "").startsWith("shipped:");
    const list: Item[] = [
      ...news.map((o): Item => {
        const c = cust[o.customer_id || ""];
        return { kind: "order", printavo: false, id: o.id, number: String(o.number), job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: addressFromText(o.ship_to || c?.ship_address || c?.address || "", c?.name || "", c?.company || ""), service: o.ship_method || "", ...billOf(c, o.third_party), shipOn: c?.ship_on || "", shipment: shipOf("order_id", o.id), rest: restOf(o as { flags?: unknown }), kinds: kindsOf((o as { groups?: Group[] }).groups) };
      }),
      ...pvs.map((o): Item => {
        const c = cust[o.customer_id];
        return { kind: "archived", printavo: true, id: o.id, number: o.visual_id, job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: fromPv(o.ship, o.contact, c?.company || ""), service: /ups|fedex|usps/i.test(o.delivery || "") ? o.delivery || "" : "", ...billOf(c), shipOn: c?.ship_on || "", shipment: shipOf("archived_order_id", o.id) };
      }),
    ].filter((x) => x.shipment?.status !== "shipped");
    const partIds = new Set(partRows.map((x) => x.o.id));
    setItems(list.filter((x) => !partIds.has(x.id)));
    setPartly(partRows.map(({ o, parts }) => {
      const item = list.find((x) => x.id === o.id) || null;
      const went = ((ships || []) as Shipment[]).filter((x) => x.order_id === o.id && x.status === "shipped").sort((a, b) => (b.shipped_at || "").localeCompare(a.shipped_at || ""))[0] || null;
      return item ? { item, parts, went } : null;
    }).filter(Boolean) as { item: Item; parts: MixPart[]; went: Shipment | null }[]);

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

  // Outbound's Search / filter, else this page's own search: every word has to be somewhere on the job
  const words = (embedded ? filter : q).trim().toLowerCase().replace(/^#/, "").split(/\s+/).filter(Boolean);
  const matches = (x: Item) => !words.length || words.every((w) => [x.number, x.customer, x.job, x.to.city, x.to.company, x.to.name].some((v) => String(v || "").toLowerCase().includes(w)));
  /** Ship part: the order is flagged partly shipped (it stays In Production), then the ship window opens */
  async function shipPartOf(x: Item) {
    const r = await shipPart(x.id);
    if (!r.ok) { setNote(r.error); return; }
    setOpen({ item: x, box: null });
  }

  const list = useMemo(() => {
    // Outbound's Search / filter, else this page's own search: every word has to be somewhere on the job
    return (items || []).filter(matches);
  }, [items, q, filter, embedded]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = list.filter((x) => !missingOf(x).length), missing = list.filter((x) => missingOf(x).length);

  return (
    <>
      {/* inside Outbound the page's own top says it's shipping; Settings sits at the end of the tabs */}
      {!embedded && <div className="page-head">
        <div><div className="eyebrow">Shipping</div><h1>Shipping Center</h1></div>
        <div className="row" style={{ gap: 8 }}>
          {!embedded && <input ref={scanRef} className="sc-scan" type="text" autoFocus placeholder="Scan a box label or type an order #" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }} aria-label="Scan a box label" />}
          <button type="button" className="btn" onClick={() => setShowSettings((x) => !x)}>Settings</button>
        </div>
      </div>}
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      {showSettings && <ShipSettingsPanel s={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); }} />}
      {showSettings && <LabelPrinterPanel />}
      {!addressReady(settings.ship.from) && !showSettings && <div className="banner" style={{ marginBottom: 10 }}>Rates and transit times are figured from ZIP {settings.ship.from.zip || "(not set)"}. Add our street address in <button type="button" className="linkbtn" style={{ fontSize: "inherit" }} onClick={() => setShowSettings(true)}>Settings</button> before labels can be printed.</div>}

      <div className="sc-tabrow">
        <div className="aa-sub sc-tabs" role="tablist">
          <button type="button" className={tab === "ready" ? "on" : ""} onClick={() => setTab("ready")}>Ready To Ship<span className="aa-n">{items?.length ?? "…"}</span></button>
          <button type="button" className={tab === "shipped" ? "on" : ""} onClick={() => setTab("shipped")}>Shipped<span className="aa-n">{shipped.length}</span></button>
          <button type="button" className={tab === "transit" ? "on" : ""} onClick={() => setTab("transit")}>Transit Map</button>
        </div>
        {tab === "ready" && !embedded && <label className="aa-search"><SearchInput placeholder="Search orders" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      </div>

      {tab === "transit" ? (
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
            {partly.length > 0 && (
              <section className="scr part">
                <div className="scr-h"><b>Partly printed · can ship part</b><span className="aa-n">{partly.length}</span><span className="faint">a part is printed, the rest isn&apos;t yet</span></div>
                {partly.filter(({ item: x }) => matches(x)).map(({ item: x, parts, went }) => {
                  const k = "p" + x.id;
                  return <ShipLine key={k} x={x} perBox={settings.ship.perBox} showCust onOpen={() => void shipPartOf(x)} parts={parts} went={went}
                    trk={trkOpen === k} onTrk={() => setTrkOpen(trkOpen === k ? "" : k)} onTracked={(m) => { setTrkOpen(""); setNote(m); void load(); }} />;
                })}
              </section>
            )}
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

/** One job on Ready to ship: click it to ship; + Tracking beside Ship for one shipped some other way (Nick, Nov 19 2026) */
function ShipLine({ x, perBox, missing, showCust, onOpen, trk, onTrk, onTracked, parts, went }: { x: Item; perBox: number; missing?: string[]; showCust: boolean; onOpen: () => void; trk: boolean; onTrk: () => void; onTracked: (msg: string) => void;
  /** a mixed job partly printed: its parts, and the part that already went */ parts?: MixPart[]; went?: Shipment | null }) {
  const late = !!x.due && x.due.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const boxes = x.shipment?.boxes?.length || estimateBoxes(x.pieces, perBox);
  return (
    <div className={"scr-l" + (trk ? " open" : "")}>
      <div className="scr-r">
        <button type="button" className="scr-main" onClick={onOpen} title={missing?.length ? "Fill in what's missing and ship it" : "Ship it"}>
          <b className="scr-n">#{x.number}</b>
          <span className="scr-j">{showCust && <b>{x.customer}</b>}{showCust && x.job ? " · " : ""}{x.job || (!showCust ? x.customer : "")}{(x.kinds || []).map((k) => <em key={k} className={"scr-k " + k} title={MIX_WORD[k]}>{MIX_ABBR[k]}</em>)}{x.printavo && <em className="sc-tag">Printavo</em>}{x.shipment && <em className="sc-tag draft">Started</em>}</span>
          <span className="scr-m">{parts ? <span className="scr-parts">{parts.map((q) => <em key={q.kind} className={q.state === "ok" ? (went ? "went" : "ok") : ""} title={q.note}>{MIX_ABBR[q.kind]} {q.state === "ok" ? (went ? `shipped ${went.shipped_at ? new Date(went.shipped_at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}` : "printed") : q.state === "run" ? "printing" : q.state === "wt" ? "on the schedule" : "not booked"}</em>)}</span>
            : missing?.length ? <em className="scr-need">Needs {missing.join(", ").toLowerCase()}</em> : <>{x.rest && <em className="scr-rest">The rest · part shipped</em>}{x.pieces || "?"} pcs · {boxes} box{boxes === 1 ? "" : "es"}{addressReady(x.to) ? ` · ${x.to.city}, ${x.to.state}` : ""}</>}</span>
          <span className={"scr-d" + (late ? " late" : "")}>{late ? "Late · " : ""}{day(x.due)}</span>
        </button>
        <span className="scr-a">
          {!(parts && went) && <button type="button" className={"btn sm" + (trk ? " on" : "")} onClick={onTrk} aria-expanded={trk} title="Shipped some other way (FedEx's site, their account): paste the tracking">+ Tracking</button>}
          {parts && went ? <span className="faint scr-wait">Waiting on the rest</span>
            : <button type="button" className={"btn sm" + (missing?.length || parts ? "" : " primary")} onClick={onOpen}>{missing?.length ? "Fill in" : parts ? "Ship part" : "Ship"}</button>}
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
  // Ground first, by the first number's carrier; everything else further down (Nick, Nov 19 2026)
  const guessC = carrierOf(filled[0] || "");
  const guess = guessC === "UPS" ? "UPS|Ground" : guessC === "USPS" ? "USPS|Ground Advantage" : "FedEx|Ground";
  const svc = carrier || guess, [car, service] = svc.split("|");
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
    const r = await addTracking({ kind: x.kind === "archived" ? "archived" : "order", id: x.id, numbers: filled, carrier: car === "Other" ? "" : car, service });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone(`#${x.number} shipped · ${r.n} ${r.carrier ? `${r.carrier} ${service}` : "tracking"} number${r.n === 1 ? "" : "s"} saved${r.did === "completed" ? " · order completed" : r.did === "part" ? " · the rest ships when it's printed" : ""}`);
  }
  return (
    <div className="trk" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      {/* the ship-to, a line at a time with a copy button each, to type into FedEx's site (Nick, Nov 19 2026) */}
      <div className="trk-ad" data-notranslate>
        <div className="trk-ad-h">Ship to</div>
        {(() => {
          // a suite written on the street line is its own line to copy (Nick, Nov 19 2026: "if there's a secondary line like a
          // suite, it has to be its own line"); city, state and ZIP are one line whose copy is the ZIP (FedEx fills the rest)
          const m = !x.to.street2 && (x.to.street1 || "").match(/^(.*[a-z].*?)[,\s]+((?:(?:suite|ste|unit|apt|bldg|building|floor|fl|room|rm)\b\.?|#)\s*(?:[\w-]*\d[\w-]*|[a-z]))$/i);
          const street = m ? m[1].trim() : x.to.street1, suite = m ? m[2].trim() : x.to.street2;
          const csz = [[x.to.city, x.to.state].filter(Boolean).join(", "), x.to.zip].filter(Boolean).join(" ");
          return ([["Company", x.to.company, ""], ["Attention", x.to.name, ""], ["Street", street, ""], ["Suite", suite, ""], ["City, state, ZIP", csz, x.to.zip], ["Phone", x.to.phone, ""]] as const)
            .filter(([, v]) => (v || "").trim()).map(([k, v, c]) => <CopyLine key={k} k={k} v={String(v).trim()} copy={c || undefined} />);
        })()}
        {!addressReady(x.to) && <div className="pv-err">The address isn&apos;t complete: open Ship to fill it in.</div>}
      </div>
      <div className="trk-fs">
        {vals.map((v, i) => (
          <div key={i} className="trk-f">
            <span>Box {i + 1}</span>
            <input ref={(el) => { refs.current[i] = el; }} type="text" value={v} placeholder="Paste tracking #" aria-label={`Box ${i + 1} tracking number`} spellCheck={false} autoComplete="off" autoFocus={i === 0}
              onChange={(e) => put(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (e.ctrlKey || e.metaKey || (!v.trim() && filled.length)) void done(); else setFocusAt(Math.min(i + 1, vals.length - 1)); } }} />
            <i>{v.trim() ? carrierOf(v.trim()) || "" : ""}</i>
          </div>
        ))}
      </div>
      <div className="trk-side">
        <select value={svc} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier and service">
          {TRK_SVCS.map((o, i) => (o ? <option key={o} value={o}>{o === "Other|" ? "Other" : o.replace("|", " ")}</option> : <option key={"d" + i} disabled>──────────</option>))}
        </select>
        <div className="trk-b">
          <span className="faint">{filled.length} number{filled.length === 1 ? "" : "s"}</span>
          <button type="button" className="btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn sm primary" onClick={() => void done()} disabled={busy}>{busy ? "Saving…" : "Done"}</button>
        </div>
        {err && <div className="pv-err">{err}</div>}
      </div>
    </div>
  );
}
/** one line of the address with a small copy button; a check for a moment once it's copied */
function CopyLine({ k, v, copy: what }: { k: string; v: string; /** what the copy puts on the clipboard, when not the line itself */ copy?: string }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(what || v); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* the text can still be selected */ } };
  return (
    <div className="trk-ad-l">{k === "Attention" ? <span className="faint">Attn: </span> : null}{v}
      <button type="button" className={"trk-cp" + (ok ? " ok" : "")} onClick={() => void copy()} aria-label={`Copy ${what ? "the ZIP" : k.toLowerCase()}`} title={ok ? "Copied" : `Copy ${what ? "the ZIP" : k.toLowerCase()}`}>
        {ok ? <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12l5 5 9-10" /></svg> : <svg viewBox="0 0 24 24" aria-hidden><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>}
      </button>
    </div>
  );
}

/** + Tracking's services: Ground first, then everything else (a "" is the divider) */
const TRK_SVCS = ["FedEx|Ground", "UPS|Ground", "", "FedEx|Home Delivery", "FedEx|Express Saver", "FedEx|2Day", "FedEx|Standard Overnight", "FedEx|Priority Overnight", "UPS|3 Day Select", "UPS|2nd Day Air", "UPS|Next Day Air", "USPS|Ground Advantage", "USPS|Priority Mail", "Other|"];

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
