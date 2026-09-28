"use client";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel, money } from "@/lib/format";
import { mergeSettings, type Customer } from "@/lib/pricing";
import { goodsNeedInfo, needsGoods, supplierLabel, TRACK, trackingUrl, type GoodsItem } from "@/lib/goods";
import { shopGoods } from "@/app/shop/goods-actions";
import CustomerGoodsBoard from "@/components/CustomerGoodsBoard";
import { ResolveList } from "@/components/IncomingShipments";
import type { PendingShipment, PrintavoGoods } from "@/lib/manifest";
import { blanksPlan, blanksReceived, orderBlanksSS, recordBlanks, type BlankLine } from "@/app/shop/receiving-actions";

type O = { id: string; number: number; nickname: string; status: string; due_date: string | null; production_date: string | null; qty: number; customer_id: string | null; price_type: string | null };
type BO = { id: string; order_id: string; supplier: string; supplier_order: string; status: string; expected_date: string | null; total: number | null; placed_via: string; created_at: string; received_at: string | null; note: string };
type BS = { id: string; order_id: string; blank_order_id: string | null; carrier: string; tracking: string; boxes: number | null; pcs: number | null; note: string; eta: string | null; track_status: string; track_detail: string; est_delivery: string | null; delivered_at: string | null };
type View = "today" | "customer" | "resolve";
type Arrive = "past" | "today" | "tomorrow" | "later" | "nodate";
const ARRIVE_GROUPS: { k: Arrive; label: string }[] = [
  { k: "past", label: "Should be here: not marked received" }, { k: "today", label: "Arriving today" }, { k: "tomorrow", label: "Tomorrow" }, { k: "later", label: "Later" }, { k: "nodate", label: "On the way, no date yet" },
];
type Pkg = { key: string; kind: "blanks" | "goods"; orderId: string; number: number; who: string; label: string; tracking: string; carrier: string; status: string; detail: string; at: string | null; delivered: boolean; need: string | null; href: string };

/** Today's date here (not UTC: after 7 pm the UTC date is already tomorrow). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const bizBefore = (d: string, n: number) => { const x = new Date(d.slice(0, 10) + "T12:00"); while (n > 0) { x.setDate(x.getDate() - 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x.toISOString().slice(0, 10); };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const SS_METHODS: [string, string][] = [["1", "Ground (S&S picks)"], ["40", "UPS Ground"], ["14", "FedEx Ground"], ["16", "UPS 3 Day Select"], ["3", "UPS 2nd Day Air"], ["2", "UPS Next Day Air"], ["6", "Will call (we pick up)"]];

/**
 * Goods & receiving: everything coming to us, in one daily view.
 *   FBS orders (retail): blanks we still need to order (order them from S&S right here), blanks on the way, received.
 *   Customer supplied goods (wholesale): what customers are sending us, by stage.
 * Up top, today's update: arriving today and tomorrow, delayed or problem packages, anything arriving after it's
 * needed, delivered but not counted in, and what still needs ordering.
 */
export default function GoodsReceiving() {
  const sb = createClient();
  const [data, setData] = useState<{ orders: O[]; cust: Record<string, Customer>; blanks: BO[]; bships: BS[]; goods: GoodsItem[]; lead: number } | null>(null);
  const [tab, setTab] = useState<"arriving" | "need" | "ordered" | "received">("arriving");
  const [order, setOrder] = useState<O | null>(null);
  const [note, setNote] = useState("");
  const [view, setViewState] = useState<View>("today");
  const [pending, setPending] = useState<PendingShipment[] | null>(null);
  const [pvGoods, setPvGoods] = useState<PrintavoGoods[]>([]);
  const [upBusy, setUpBusy] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("view"); if (v === "customer" || v === "resolve") setViewState(v); }, []);
  const setView = (v: View) => { setViewState(v); try { const u = new URL(window.location.href); if (v === "today") u.searchParams.delete("view"); else u.searchParams.set("view", v); window.history.replaceState(null, "", u.toString()); } catch { /* ignore */ } window.scrollTo({ top: 0 }); };
  const loadPending = useCallback(async () => { const r = await fetch("/api/goods/manifest", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setPending(j.groups || []); setPvGoods(j.printavo || []); if (j.error) setNote(`Couldn't load everything: ${j.error}`); }, []);
  useEffect(() => { loadPending(); }, [loadPending]);
  async function upload(f: File) {
    setUpBusy(true); setNote("");
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/goods/manifest", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    setUpBusy(false);
    if (!r.ok || j.error) return setNote(j.error || "Couldn't read that file.");
    const waiting = (j.suggested || 0) + (j.unmatched || 0);
    setNote(`${j.supplier === "sanmar" ? "SanMar" : "S&S"} manifest: ${j.shipments} shipment${j.shipments === 1 ? "" : "s"} (${j.new} new line${j.new === 1 ? "" : "s"}${j.lines !== j.new ? `, ${j.lines - j.new} already imported` : ""}). Linked: ${j.matched} to customer orders, ${j.blanks} to our blanks.${waiting ? ` ${waiting} waiting in the resolution center${j.suggested ? ` (${j.suggested} with our guess to OK)` : ""}.` : ""}`);
    load(); loadPending(); setRefreshKey((k) => k + 1);
    if (waiting) setView("resolve");
  }
  const load = useCallback(async () => {
    const [{ data: os }, { data: bo }, { data: st }] = await Promise.all([
      sb.from("orders").select("id, number, nickname, status, type, due_date, production_date, qty, customer_id, price_type, submitted_at").not("status", "in", "(completed,quote,quote_sent,request)").order("due_date", { ascending: true, nullsFirst: false }).limit(800),
      sb.from("blank_orders").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(500),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const orders = (os || []) as (O & { type: string; submitted_at: string | null })[];
    const blanks = (bo || []) as BO[];
    const ids = [...new Set([...blanks.map((b) => b.order_id)])];
    const [{ data: bs }, { data: cs }] = await Promise.all([
      ids.length ? sb.from("blank_shipments").select("*").in("order_id", ids) : Promise.resolve({ data: [] }),
      sb.from("customers").select("*").in("id", [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]),
    ]);
    const wholesale = orders.filter((o) => needsGoods({ ...o, type: o.type }));
    const g = wholesale.length ? await shopGoods(wholesale.map((o) => o.id)) : { items: [] };
    setData({ orders, cust: Object.fromEntries(((cs || []) as Customer[]).map((c) => [c.id, c])), blanks, bships: (bs || []) as BS[], goods: g.items || [], lead: mergeSettings(st?.data).ship.goodsLeadDays });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const v = useMemo(() => {
    if (!data) return null;
    const byId = new Map(data.orders.map((o) => [o.id, o]));
    const who = (o?: O) => (o ? custLabel(data.cust[o.customer_id || ""]) || "—" : "—");
    const needBy = (o?: O) => (o ? o.production_date || (o.due_date ? bizBefore(o.due_date, data.lead) : null) : null);
    const hasBlanks = new Set(data.blanks.map((b) => b.order_id));
    // retail jobs that are approved but nobody ordered blanks for yet
    const need = data.orders.filter((o) => o.price_type !== "wholesale" && ["approved", "art"].includes(o.status) && !hasBlanks.has(o.id));
    const ordered = data.blanks.filter((b) => b.status === "ordered" && byId.has(b.order_id));
    const received = data.blanks.filter((b) => b.status === "received" && b.received_at && Date.now() - Date.parse(b.received_at) < 10 * 86400000);
    // every package on the way (our blanks + customers' goods)
    const pkgs: Pkg[] = [
      ...data.bships.filter((s) => byId.has(s.order_id)).map((s): Pkg => { const o = byId.get(s.order_id)!; return { key: "b" + s.id, kind: "blanks", orderId: o.id, number: o.number, who: who(o), label: s.note || "Blanks", tracking: s.tracking, carrier: s.carrier, status: s.track_status, detail: s.track_detail, at: s.est_delivery || s.eta, delivered: s.track_status === "delivered", need: needBy(o), href: `/shop/orders/${o.id}` }; }),
      ...data.goods.flatMap((it) => it.shipments.filter((s) => s.tracking || s.eta).map((s): Pkg => { const o = byId.get(it.order.id); return { key: "g" + s.id, kind: "goods", orderId: it.order.id, number: it.order.number, who: who(o), label: `${supplierLabel(it.goods.supplier) || "Customer's goods"}${s.boxes ? ` · ${s.boxes} box${s.boxes === 1 ? "" : "es"}` : ""}`, tracking: s.tracking, carrier: s.carrier, status: s.track_status || "", detail: s.track_detail || "", at: s.est_delivery || s.eta, delivered: s.track_status === "delivered", need: needBy(o), href: `/shop/orders/${it.order.id}` }; })),
    ];
    const open = pkgs.filter((p) => !p.delivered);
    const t = today(), tm = addDays(t, 1);
    const blanksOrderDelivered = ordered.filter((b) => { const s = data.bships.filter((x) => x.blank_order_id === b.id || (x.order_id === b.order_id && !x.blank_order_id)); return s.length > 0 && s.every((x) => x.track_status === "delivered"); });
    return {
      byId, who, needBy, need, ordered, received, pkgs,
      update: {
        today: open.filter((p) => p.at && p.at.slice(0, 10) === t),
        tomorrow: open.filter((p) => p.at && p.at.slice(0, 10) === tm),
        problems: open.filter((p) => ["failure", "return_to_sender", "error", "available_for_pickup"].includes(p.status)),
        late: open.filter((p) => p.at && p.need && p.at.slice(0, 10) > p.need),
        count: [...data.goods.filter((it) => ["arrived", "partial"].includes(it.goods.status)).map((it) => ({ n: it.order.number, id: it.order.id, what: "Customer goods", who: who(byId.get(it.order.id)) })),
          ...blanksOrderDelivered.map((b) => ({ n: byId.get(b.order_id)!.number, id: b.order_id, what: "Our blanks", who: who(byId.get(b.order_id)) }))],
        info: data.goods.filter((it) => goodsNeedInfo(it.goods, it.shipments)),
      },
      goodsStages: {
        info: data.goods.filter((it) => goodsNeedInfo(it.goods, it.shipments)).length,
        coming: data.goods.filter((it) => ["waiting", "on_way"].includes(it.goods.status) && !goodsNeedInfo(it.goods, it.shipments)).length,
        counting: data.goods.filter((it) => ["arrived", "partial"].includes(it.goods.status)).length,
        issue: data.goods.filter((it) => it.goods.status === "issue").length,
      },
    };
  }, [data]);

  if (!data || !v) return <div className="empty">Loading…</div>;
  const u0 = v.update;
  const unlinked = (pending || []).filter((g) => !g.us);
  // goods tied to Printavo orders (until go-live): into today's lists too
  const pvCust = pvGoods.filter((g) => g.kind === "goods"), pvBlanks = pvGoods.filter((g) => g.kind === "blanks");
  const pvPkgs: Pkg[] = pvGoods.filter((g) => !g.delivered).flatMap((g) => g.tracking.map((t): Pkg => ({ key: `pv${g.kind}${g.archivedId}${g.supplier_order}${t.tracking}`, kind: g.kind, orderId: g.archivedId, number: g.number, who: g.customer, label: `Printavo order · ${g.supplier === "sanmar" ? "SanMar" : "S&S"} ${g.supplier_order} · ${g.pcs} pcs`, tracking: t.tracking, carrier: t.carrier, status: t.status, detail: t.detail, at: t.eta, delivered: t.delivered, need: g.due_date ? bizBefore(g.due_date, data.lead) : null, href: `/shop/archive/${g.archivedId}` })));
  const pvHere = pvGoods.filter((g) => g.delivered);
  // FBS blanks on the way (ours in this system + Printavo jobs), by the day they arrive
  const whenOf = (d: string | null | undefined): Arrive => { if (!d) return "nodate"; const x = d.slice(0, 10), t = today(); return x < t ? "past" : x === t ? "today" : x === addDays(t, 1) ? "tomorrow" : "later"; };
  const arriving: { key: string; at: string | null; when: Arrive; node: React.ReactNode }[] = [
    ...pvBlanks.filter((g) => !g.delivered).map((g) => ({ key: "pv" + g.archivedId + g.supplier_order, at: g.eta, when: whenOf(g.eta), node: <PvCard key={"pv" + g.archivedId + g.supplier_order} g={g} lead={data.lead} onReceived={loadPending} /> })),
    ...v.ordered.filter((b) => data.bships.some((s) => (s.blank_order_id === b.id || (s.order_id === b.order_id && !s.blank_order_id)) && s.track_status !== "delivered")).map((b) => {
      const ships = data.bships.filter((s) => s.blank_order_id === b.id || (s.order_id === b.order_id && !s.blank_order_id));
      const eta = (ships.filter((s) => s.track_status !== "delivered").map((s) => s.est_delivery || s.eta).filter(Boolean).sort().pop() as string | undefined) || b.expected_date;
      return { key: b.id, at: eta || null, when: whenOf(eta), node: <BlankCard key={b.id} b={b} o={v.byId.get(b.order_id)!} who={v.who(v.byId.get(b.order_id))} need={v.needBy(v.byId.get(b.order_id))} ships={ships} onChange={load} /> };
    }),
  ].sort((a, b) => (a.at || "9999").localeCompare(b.at || "9999"));
  const arrivingToday = arriving.filter((a) => a.when === "today" || a.when === "past").length;
  const tm = addDays(today(), 1);
  const u = {
    ...u0,
    today: [...u0.today, ...pvPkgs.filter((p) => p.at && p.at.slice(0, 10) === today())],
    tomorrow: [...u0.tomorrow, ...pvPkgs.filter((p) => p.at && p.at.slice(0, 10) === tm)],
    problems: [...u0.problems, ...pvPkgs.filter((p) => ["failure", "return_to_sender", "error", "available_for_pickup"].includes(p.status))],
    late: [...u0.late, ...pvPkgs.filter((p) => p.at && p.need && p.at.slice(0, 10) > p.need)],
    count: [...u0.count, ...pvHere.map((g) => ({ n: g.number, id: g.archivedId, what: g.kind === "blanks" ? "Our blanks (Printavo order)" : "Customer goods (Printavo order)", who: g.customer }))],
  };
  const unlinkedHere = unlinked.filter((g) => g.tracking.length > 0 && g.tracking.every((t) => t.delivered));
  const pkgLine = (p: Pkg) => (
    <li key={p.key}>
      <Link href={p.href}>#{p.number}</Link> <b>{p.who}</b> <span className="faint">· {p.kind === "blanks" ? "our blanks" : "customer goods"} · {p.label}</span>
      {p.tracking && <> · <a href={trackingUrl(p.carrier, p.tracking)} target="_blank" rel="noreferrer">{p.carrier} {p.tracking}</a></>}
      {p.status && <span className="rv-st"> {TRACK[p.status] || p.status}</span>}{p.at ? <span className="faint"> · arrives {day(p.at)}</span> : null}{p.need ? <span className="faint"> · needed by {day(p.need)}</span> : null}
    </li>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Receiving</div><h1>Goods &amp; receiving</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="btn primary" style={{ cursor: "pointer" }}>{upBusy ? "Reading…" : "Import supplier manifest"}<input type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} /></label>
        </div>
      </div>
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      <div className="aa-sub rv-views" role="tablist">
        <button type="button" className={view === "today" ? "on" : ""} onClick={() => setView("today")}>Today &amp; overview</button>
        <button type="button" className={view === "customer" ? "on" : ""} onClick={() => setView("customer")}>Customer supplied goods<span className="aa-n">{data.goods.filter((it) => it.goods.status !== "received").length + unlinked.length}</span></button>
        <button type="button" className={view === "resolve" ? "on" : ""} onClick={() => setView("resolve")}>Resolution center<span className={"aa-n" + (pending?.length ? " hot" : "")}>{pending ? pending.length : "…"}</span></button>
      </div>

      {view === "customer" && <CustomerGoodsBoard pending={pending || []} onPending={() => { loadPending(); load(); }} refreshKey={refreshKey} />}
      {view === "resolve" && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Supplier shipments that aren&apos;t on an order yet. An exact PO match links on its own. Everything else waits here with our best guess (one PO can be several orders: we read the styles, colors and sizes). OK it or change it. Customers see their incoming shipments on their portal and can link them too.</p>
          {!pending ? <div className="empty">Loading…</div> : <ResolveList list={pending} onDone={() => { loadPending(); load(); setRefreshKey((k) => k + 1); }} />}
        </>
      )}
      {view === "today" && <>

      {/* today's update */}
      <section className="rv-day">
        <div className="rv-day-h"><b>Today&apos;s update</b><span className="faint">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>
        <div className="rv-kpis">
          <div className={u.late.length ? "bad" : ""}><span>Arriving too late</span><b>{u.late.length}</b></div>
          <div className={u.problems.length ? "bad" : ""}><span>Delayed / problem</span><b>{u.problems.length}</b></div>
          <div><span>Arriving today</span><b>{u.today.length}</b></div>
          <div><span>Arriving tomorrow</span><b>{u.tomorrow.length}</b></div>
          <div className={u.count.length ? "warn" : ""}><span>Delivered, count in</span><b>{u.count.length}</b></div>
          <div className={v.need.length ? "warn" : ""}><span>Blanks to order</span><b>{v.need.length}</b></div>
          <div className={u.info.length ? "warn" : ""}><span>Goods: no info yet</span><b>{u.info.length}</b></div>
          <button type="button" className={(pending?.length ? "warn" : "") + (unlinkedHere.length ? " bad" : "")} onClick={() => setView("resolve")}><span>Not linked to an order</span><b>{pending ? pending.length : "…"}</b></button>
        </div>
        <div className="rv-lists">
          {u.late.length > 0 && <div><h4 className="bad">Arriving after they&apos;re needed</h4><ul>{u.late.map(pkgLine)}</ul></div>}
          {u.problems.length > 0 && <div><h4 className="bad">Delayed or a delivery problem</h4><ul>{u.problems.map(pkgLine)}</ul></div>}
          {u.today.length > 0 && <div><h4>Arriving today</h4><ul>{u.today.map(pkgLine)}</ul></div>}
          {u.tomorrow.length > 0 && <div><h4>Arriving tomorrow</h4><ul>{u.tomorrow.map(pkgLine)}</ul></div>}
          {u.count.length > 0 && <div><h4>Delivered: count these in</h4><ul>{u.count.map((c) => <li key={c.what + c.id}><Link href={c.what === "Our blanks" ? `/shop/orders/${c.id}` : c.what.includes("Printavo") ? `/shop/archive/${c.id}` : "/shop/receiving?view=customer"} onClick={(e) => { if (c.what === "Customer goods") { e.preventDefault(); setView("customer"); } }}>#{c.n}</Link> <b>{c.who}</b> <span className="faint">· {c.what}</span></li>)}</ul></div>}
          {unlinkedHere.length > 0 && <div><h4 className="bad">Arrived, but not linked to an order</h4><ul>{unlinkedHere.map((g) => <li key={g.key}><button type="button" className="linkbtn" onClick={() => setView("resolve")}>{g.customer?.name || g.customer_name}</button> <span className="faint">· PO {g.customer_po || "none"} · {g.pcs} pcs · {g.styles}</span></li>)}</ul></div>}
          {!u.late.length && !u.problems.length && !u.today.length && !u.tomorrow.length && !u.count.length && !unlinkedHere.length && <div className="faint" style={{ fontSize: 13.5 }}>Nothing urgent coming in today.</div>}
        </div>
      </section>

      <div className="rv-panes">
        {/* FBS orders (retail) */}
        <section className="rv-pane">
          <div className="rv-pane-h"><b>FBS orders</b><span className="faint">retail · blanks we buy</span></div>
          <div className="aa-sub" role="tablist" style={{ padding: "8px 12px 0" }}>
            <button type="button" className={tab === "arriving" ? "on" : ""} onClick={() => setTab("arriving")}>Arriving<span className={"aa-n" + (arrivingToday ? " hot" : "")}>{arriving.length}</span></button>
            <button type="button" className={tab === "need" ? "on" : ""} onClick={() => setTab("need")}>Need to order<span className="aa-n">{v.need.length}</span></button>
            <button type="button" className={tab === "ordered" ? "on" : ""} onClick={() => setTab("ordered")}>Ordered<span className="aa-n">{v.ordered.length + pvBlanks.filter((g) => !g.delivered).length}</span></button>
            <button type="button" className={tab === "received" ? "on" : ""} onClick={() => setTab("received")}>Received<span className="aa-n">{v.received.length + pvBlanks.filter((g) => g.delivered).length}</span></button>
          </div>
          <div className="rv-pane-b">
            {tab === "arriving" && (arriving.length ? ARRIVE_GROUPS.map((grp) => {
              const list = arriving.filter((a) => a.when === grp.k);
              return list.length ? (
                <div key={grp.k} className="rv-grp">
                  <div className={"rv-grp-h" + (grp.k === "today" ? " today" : grp.k === "past" ? " past" : "")}>{grp.label}<span>{list.length}</span></div>
                  {list.map((a) => a.node)}
                </div>
              ) : null;
            }) : <div className="gb-empty">No blanks on the way right now.</div>)}
            {tab === "need" && (v.need.length ? v.need.map((o) => (
              <div key={o.id} className="rv-card">
                <div className="rv-card-t"><Link href={`/shop/orders/${o.id}`} className="num">#{o.number}</Link><b>{v.who(o)}</b><span className="spacer" /><span className="rv-due">in hands {day(o.due_date)}</span></div>
                <div className="faint" style={{ fontSize: 12.5 }}>{o.nickname || "Order"} · {o.qty} pcs{v.needBy(o) ? ` · blanks needed by ${day(v.needBy(o))}` : ""}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}><button type="button" className="btn primary sm" onClick={() => setOrder(o)}>Order blanks</button></div>
              </div>
            )) : <div className="gb-empty">Every approved job has its blanks ordered.</div>)}
            {tab === "ordered" && pvBlanks.filter((g) => !g.delivered).map((g) => <PvCard key={g.archivedId + g.supplier_order} g={g} lead={data.lead} onReceived={loadPending} />)}
            {tab === "received" && pvBlanks.filter((g) => g.delivered).map((g) => <PvCard key={g.archivedId + g.supplier_order} g={g} lead={data.lead} onReceived={loadPending} />)}
            {tab === "ordered" && (v.ordered.length || pvBlanks.some((g) => !g.delivered) ? v.ordered.map((b) => <BlankCard key={b.id} b={b} o={v.byId.get(b.order_id)!} who={v.who(v.byId.get(b.order_id))} need={v.needBy(v.byId.get(b.order_id))} ships={data.bships.filter((s) => s.blank_order_id === b.id || (s.order_id === b.order_id && !s.blank_order_id))} onChange={load} />)
              : <div className="gb-empty">No blanks on order right now.</div>)}
            {tab === "received" && (v.received.length || pvBlanks.some((g) => g.delivered) ? v.received.map((b) => <BlankCard key={b.id} b={b} o={v.byId.get(b.order_id) || ({ id: b.order_id, number: 0 } as O)} who={v.who(v.byId.get(b.order_id))} need={null} ships={[]} onChange={load} />)
              : <div className="gb-empty">Nothing received in the last 10 days.</div>)}
          </div>
        </section>

        {/* customer supplied goods (wholesale) */}
        <section className="rv-pane">
          <div className="rv-pane-h"><b>Customer supplied goods</b><span className="faint">wholesale · customers send us</span><span className="spacer" /><button type="button" onClick={() => setView("customer")} className="linkbtn" style={{ fontSize: 12.5 }}>Open the board →</button></div>
          <div className="rv-stages">
            <button type="button" onClick={() => setView("customer")}><span>Waiting on info</span><b>{v.goodsStages.info}</b></button>
            <button type="button" onClick={() => setView("customer")}><span>On the way</span><b>{v.goodsStages.coming}</b></button>
            <button type="button" className={v.goodsStages.counting ? "warn" : ""} onClick={() => setView("customer")}><span>Delivered, count in</span><b>{v.goodsStages.counting}</b></button>
            <button type="button" className={v.goodsStages.issue ? "bad" : ""} onClick={() => setView("customer")}><span>Issues</span><b>{v.goodsStages.issue}</b></button>
            <button type="button" className={unlinked.length ? "warn" : ""} onClick={() => setView("resolve")}><span>Not linked yet</span><b>{unlinked.length}</b></button>
          </div>
          <div className="rv-pane-b">
            {pvCust.map((g) => {
              const late = !g.delivered && g.eta && g.due_date && g.eta.slice(0, 10) > bizBefore(g.due_date, data.lead);
              return (
                <Link key={g.archivedId + g.supplier_order} href={`/shop/archive/${g.archivedId}`} className={"rv-card link" + (late ? " late" : "")}>
                  <div className="rv-card-t"><span className="num">#{g.number}</span><b>{g.customer}</b><span className="rv-st">Printavo</span><span className="spacer" /><span className="rv-due">in hands {day(g.due_date)}</span></div>
                  <div className="faint" style={{ fontSize: 12.5 }}>{g.supplier === "sanmar" ? "SanMar" : "S&S"} order {g.supplier_order} · {g.boxes} box{g.boxes === 1 ? "" : "es"} · {g.pcs} pcs · {g.delivered ? "delivered, count in" : g.tracking.map((t) => TRACK[t.status] || t.status).filter(Boolean)[0] || "shipped"}{!g.delivered && g.eta ? ` · arrives ${day(g.eta)}` : ""}{late ? <b className="bad"> · after it&apos;s needed</b> : null}</div>
                </Link>
              );
            })}
            {data.goods.length ? data.goods.filter((it) => it.goods.status !== "received").map((it) => {
              const o = v.byId.get(it.order.id);
              const next = it.shipments.filter((s) => s.track_status !== "delivered").map((s) => s.est_delivery || s.eta).filter(Boolean).sort().pop() as string | undefined;
              const late = next && v.needBy(o) && next.slice(0, 10) > v.needBy(o)!;
              return (
                <Link key={it.order.id} href={`/shop/orders/${it.order.id}`} className={"rv-card link" + (late ? " late" : "")}>
                  <div className="rv-card-t"><span className="num">#{it.order.number}</span><b>{v.who(o)}</b><span className="spacer" /><span className="rv-due">in hands {day(it.order.due_date)}</span></div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {goodsNeedInfo(it.goods, it.shipments) ? "Waiting on info from the customer" : `${supplierLabel(it.goods.supplier) || "Supplier?"} · ${it.shipments.length} shipment${it.shipments.length === 1 ? "" : "s"}${next ? ` · arrives ${day(next)}` : ""}`}
                    {late ? <b className="bad"> · after it&apos;s needed ({day(v.needBy(o))})</b> : null}
                  </div>
                </Link>
              );
            }) : !pvCust.length ? <div className="gb-empty">No customer supplied goods on open jobs.</div> : null}
          </div>
        </section>
      </div>

      </>}
      {order && <OrderBlanks o={order} who={v.who(order)} onClose={() => setOrder(null)} onDone={(m) => { setOrder(null); setNote(m); setTab("ordered"); load(); }} />}
    </>
  );
}

/** Blanks or goods tied to a Printavo job (until go-live). Local trucks never report "delivered": mark them received. */
function PvCard({ g, lead, onReceived }: { g: PrintavoGoods; lead: number; onReceived?: () => void }) {
  const [busy, setBusy] = useState(false);
  const late = !g.delivered && g.eta && g.due_date && g.eta.slice(0, 10) > bizBefore(g.due_date, lead);
  const local = g.tracking.some((t) => !t.tracking);
  async function received(yes: boolean) {
    setBusy(true);
    await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ received: { lineIds: g.lineIds, yes } }) }).catch(() => null);
    setBusy(false); onReceived?.();
  }
  return (
    <div className={"rv-card" + (late ? " late" : "")}>
      <div className="rv-card-t"><Link href={`/shop/archive/${g.archivedId}`} className="num">#{g.number}</Link><b>{g.customer}</b><span className="rv-st">Printavo</span><span className="spacer" /><span className="rv-due">in hands {day(g.due_date)}</span></div>
      <div className="faint" style={{ fontSize: 12.5 }}>{g.nickname ? `${g.nickname} · ` : ""}{g.supplier === "sanmar" ? "SanMar" : "S&S"} order {g.supplier_order} · {g.boxes} box{g.boxes === 1 ? "" : "es"} · {g.pcs} pcs</div>
      <ul className="rv-ships">{g.tracking.map((t) => (
        <li key={t.tracking || "local"}>{t.tracking ? <a href={trackingUrl(t.carrier, t.tracking)} target="_blank" rel="noreferrer">{t.carrier} {t.tracking}</a> : <span>{t.carrier} local truck · {t.detail}</span>}
          {t.status ? <span className="rv-st"> {TRACK[t.status] || t.status}</span> : null}{!t.delivered && t.eta ? <span className="faint"> · arrives {day(t.eta)}</span> : null}{t.tracking && t.detail ? <span className="faint"> · {t.detail}</span> : null}</li>
      ))}</ul>
      {late ? <div className="bad" style={{ fontSize: 12.5 }}>Arrives after it&apos;s needed ({day(bizBefore(g.due_date!, lead))})</div> : null}
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        {g.delivered
          ? <><span className="rv-ok">Received</span><button type="button" className="btn sm ghost" disabled={busy} onClick={() => received(false)}>Undo</button></>
          : <button type="button" className="btn sm" disabled={busy} onClick={() => received(true)}>{busy ? "Saving…" : "Received & counted"}</button>}
        {local && !g.delivered && <small className="faint">Local truck: no tracking, so mark it when it&apos;s here.</small>}
      </div>
    </div>
  );
}

function BlankCard({ b, o, who, need, ships, onChange }: { b: BO; o: O; who: string; need: string | null; ships: BS[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const eta = ships.filter((s) => s.track_status !== "delivered").map((s) => s.est_delivery || s.eta).filter(Boolean).sort().pop() as string | undefined || b.expected_date;
  const late = eta && need && eta.slice(0, 10) > need;
  return (
    <div className={"rv-card" + (late ? " late" : "")}>
      <div className="rv-card-t"><Link href={`/shop/orders/${o.id}`} className="num">#{o.number}</Link><b>{who}</b><span className="spacer" />{b.status === "received" ? <span className="rv-ok">Received {day(b.received_at)}</span> : <span className="rv-due">{eta ? `arrives ${day(eta)}` : "no date yet"}</span>}</div>
      <div className="faint" style={{ fontSize: 12.5 }}>{supplierLabel(b.supplier) || b.supplier}{b.supplier_order ? ` order ${b.supplier_order}` : ""}{b.total ? ` · ${money(b.total)}` : ""} · {b.placed_via === "api" ? "ordered here" : b.placed_via === "manifest" ? "from the supplier's manifest" : "ordered outside"}{need ? ` · needed by ${day(need)}` : ""}{late ? " · LATE" : ""}</div>
      {ships.length > 0 && <ul className="rv-ships">{ships.map((s) => <li key={s.id}>{s.tracking ? <a href={trackingUrl(s.carrier, s.tracking)} target="_blank" rel="noreferrer">{s.carrier} {s.tracking}</a> : <span>{s.note}</span>}{s.track_status && <span className="rv-st"> {TRACK[s.track_status] || s.track_status}</span>}{s.track_detail && <span className="faint"> · {s.track_detail}</span>}</li>)}</ul>}
      {b.note && <div className="faint" style={{ fontSize: 12.5 }}>{b.note}</div>}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {b.status === "ordered"
          ? <button type="button" className="btn sm" disabled={busy} onClick={async () => { setBusy(true); await blanksReceived(b.id, true); setBusy(false); onChange(); }}>Received & counted</button>
          : <button type="button" className="btn sm ghost" disabled={busy} onClick={async () => { setBusy(true); await blanksReceived(b.id, false); setBusy(false); onChange(); }}>Undo received</button>}
      </div>
    </div>
  );
}

/** Order an approved job's blanks: from S&S right here (dry run first), or record that they were ordered elsewhere. */
function OrderBlanks({ o, who, onClose, onDone }: { o: O; who: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [plan, setPlan] = useState<{ lines: BlankLine[]; ss: boolean } | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("1");
  const [dry, setDry] = useState<{ orderNumber: string; warehouse: string; total: number; expected: string | null }[] | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [other, setOther] = useState(false);
  const [m, setM] = useState({ supplier: "S&S Activewear", supplier_order: "", expected_date: "", note: "" });
  useEffect(() => { blanksPlan(o.id).then((r) => { if (!r.ok) return setErr(r.error || "Couldn't read the order."); setPlan({ lines: r.lines || [], ss: !!r.ss }); setQty(Object.fromEntries((r.lines || []).map((l) => [l.key, l.qty]))); }); }, [o.id]);
  const lines = plan?.lines || [];
  const orderable = lines.filter((l) => l.found && (qty[l.key] || 0) > 0);
  const total = orderable.reduce((a, l) => a + l.price * (qty[l.key] || 0), 0);
  const payload = () => ({ lines: orderable.map((l) => ({ sku: l.sku, qty: qty[l.key] || 0, label: `${l.brand} ${l.style} ${l.color} ${l.size}`.trim() })), shippingMethod: method });
  async function test() { setBusy("test"); setErr(""); setDry(null); const r = await orderBlanksSS(o.id, { ...payload(), test: true }); setBusy(""); if (!r.ok) return setErr(r.error || "S&S said no."); setDry(r.results || []); }
  async function place() { setBusy("place"); setErr(""); const r = await orderBlanksSS(o.id, { ...payload(), test: false }); setBusy(""); if (!r.ok) return setErr(r.error || "S&S said no."); onDone(`Ordered from S&S for #${o.number}: order ${r.results?.map((x) => x.orderNumber).join(", ")}.`); }
  async function record() { setBusy("rec"); setErr(""); const r = await recordBlanks(o.id, { ...m, expected_date: m.expected_date || null }); setBusy(""); if (!r.ok) return setErr(r.error || "Couldn't save."); onDone(`Recorded the blanks order for #${o.number}.`); }
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label={`Order blanks for #${o.number}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet">
        <div className="pp-sheet-h"><div><b>Order blanks · #{o.number}</b> <span className="faint" style={{ fontSize: 14 }}>· {who} · in hands {day(o.due_date)}</span></div><button type="button" className="btn icon ghost" aria-label="Close" disabled={!!busy} onClick={onClose}>✕</button></div>
        <div style={{ padding: "14px 22px" }} className="stack">
          {!plan ? <div className="faint">{err || "Checking S&S for stock and price…"}</div> : (
            <>
              <div style={{ overflowX: "auto" }}><table className="rv-tbl">
                <thead><tr><th>Garment</th><th>Color</th><th>Size</th><th className="r">Qty</th><th>S&amp;S</th><th className="r">Price</th><th className="r">In stock</th></tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.key} className={!l.found ? "miss" : l.stock < (qty[l.key] || 0) ? "low" : ""}>
                    <td>{[l.brand, l.style].filter(Boolean).join(" ") || "—"}</td><td>{l.color}</td><td>{l.size}</td>
                    <td className="r"><input type="number" min={0} value={qty[l.key] ?? 0} onChange={(e) => { setQty({ ...qty, [l.key]: Math.max(0, Math.round(+e.target.value || 0)) }); setDry(null); }} style={{ width: 70, textAlign: "right" }} aria-label={`${l.style} ${l.color} ${l.size} quantity`} /></td>
                    <td>{l.found ? <span className="faint">{l.sku}</span> : <span className="bad">{l.note || "Not found"}</span>}</td>
                    <td className="r">{l.found ? money(l.price) : ""}</td>
                    <td className="r">{l.found ? <>{l.stock.toLocaleString()}{l.note && <div className="bad" style={{ fontSize: 11.5 }}>{l.note}</div>}</> : ""}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <b>{orderable.reduce((a, l) => a + (qty[l.key] || 0), 0)} pcs · about {money(total)}</b>
                <label className="row" style={{ gap: 6, fontSize: 13 }}>Ship by<select value={method} onChange={(e) => { setMethod(e.target.value); setDry(null); }} style={{ width: "auto" }}>{SS_METHODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                {lines.some((l) => !l.found) && <span className="bad" style={{ fontSize: 12.5 }}>Lines S&amp;S doesn&apos;t carry aren&apos;t included; order those elsewhere.</span>}
              </div>
              {!plan.ss && <div className="banner">S&amp;S isn&apos;t connected, so ordering here is off. Record an order placed elsewhere instead.</div>}
              {dry && (
                <div className="okmsg">S&amp;S accepted the dry run (nothing was bought): {dry.map((d) => `${d.warehouse || "warehouse"} · ${money(d.total)}${d.expected ? ` · arrives ${day(d.expected)}` : ""}`).join("; ")}. Place the real order below.</div>
              )}
              {err && <div className="pv-err">{err}</div>}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" disabled={!plan.ss || !orderable.length || !!busy} onClick={test}>{busy === "test" ? "Checking…" : "1. Check with S&S (dry run)"}</button>
                <button type="button" className="btn primary" disabled={!plan.ss || !dry || !orderable.length || !!busy} onClick={place} title={dry ? "" : "Run the dry run first"}>{busy === "place" ? "Ordering…" : `2. Place the order with S&S${total ? ` · ~${money(total)}` : ""}`}</button>
                <span className="spacer" />
                <button type="button" className="btn ghost" onClick={() => setOther((x) => !x)}>{other ? "Hide" : "Ordered it elsewhere?"}</button>
              </div>
              {other && (
                <div className="rv-other">
                  <label>Supplier<input type="text" value={m.supplier} onChange={(e) => setM({ ...m, supplier: e.target.value })} /></label>
                  <label>Their order #<input type="text" value={m.supplier_order} onChange={(e) => setM({ ...m, supplier_order: e.target.value })} /></label>
                  <label>Expected<input type="date" value={m.expected_date} onChange={(e) => setM({ ...m, expected_date: e.target.value })} /></label>
                  <label className="wide">Note<input type="text" value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="e.g. 2XLs from SanMar, rest from S&S" /></label>
                  <button type="button" className="btn primary sm" disabled={!!busy} onClick={record}>{busy === "rec" ? "Saving…" : "Save"}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
