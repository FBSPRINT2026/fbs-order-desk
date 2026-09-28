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
import type { ManifestHit, PendingShipment, PrintavoGoods } from "@/lib/manifest";
import { blanksPlan, blanksReceived, orderBlanksSS, recordBlanks, type BlankLine } from "@/app/shop/receiving-actions";

type O = { id: string; number: number; nickname: string; status: string; due_date: string | null; production_date: string | null; qty: number; customer_id: string | null; price_type: string | null };
type BO = { id: string; order_id: string; supplier: string; supplier_order: string; status: string; expected_date: string | null; total: number | null; placed_via: string; created_at: string; received_at: string | null; note: string };
type BS = { id: string; order_id: string; blank_order_id: string | null; carrier: string; tracking: string; boxes: number | null; pcs: number | null; note: string; eta: string | null; track_status: string; track_detail: string; est_delivery: string | null; delivered_at: string | null };
type View = "today" | "fbs" | "customer" | "resolve";
type Arrive = "past" | "today" | "tomorrow" | "later" | "nodate";
const ARRIVE_GROUPS: { k: Arrive; label: string }[] = [
  { k: "past", label: "Should be here: not marked received" }, { k: "today", label: "Arriving today" }, { k: "tomorrow", label: "Tomorrow" }, { k: "later", label: "Later" }, { k: "nodate", label: "On the way, no date yet" },
];
type Focus = "arrived" | "today" | "way" | "past" | "problems";
type GroupBy = "carrier" | "supplier";
type Row = { key: string; side: "fbs" | "customer"; number: number; href: string; who: string; what: string; sub: string; po: string; so: string; boxes: number; pcs: number;
  trks: { carrier: string; tracking: string; delivered: boolean; status: string; detail?: string; freight?: boolean }[]; lineIds?: string[];
  link?: LinkInfo; at: string | null; deliveredAt: string | null; need: string | null; unlinked: boolean; state: "arrived" | "problem" | "way"; late: boolean; via: Via; supplier: string; shipped: string | null; noScan: boolean };
type LinkInfo = { lineIds: string[]; customerId: string | null; customerName: string; us: boolean; supplier: string; name: string; account: string; suggest: string | null; styles: string };
type Via = "ss" | "ups" | "fedex" | "freight" | "other";
const VIAS: { k: string; label: string }[] = [{ k: "ss", label: "S&S truck" }, { k: "ups", label: "UPS" }, { k: "fedex", label: "FedEx" }, { k: "freight", label: "Freight (LTL pallets)" }, { k: "other", label: "DHL / other" }];
const SUPPLIERS_G: { k: string; label: string }[] = [{ k: "ss", label: "S&S Activewear" }, { k: "sanmar", label: "SanMar" }, { k: "other", label: "Other vendors" }];
const nextBiz = (d: string) => { const x = new Date(d.slice(0, 10) + "T12:00"); do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0 || x.getDay() === 6); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
type Pkg = { key: string; kind: "blanks" | "goods"; orderId: string; number: number; who: string; label: string; tracking: string; carrier: string; status: string; detail: string; at: string | null; delivered: boolean; need: string | null; href: string };

/** Today's date here (not UTC: after 7 pm the UTC date is already tomorrow). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const bizBefore = (d: string, n: number) => { const x = new Date(d.slice(0, 10) + "T12:00"); while (n > 0) { x.setDate(x.getDate() - 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x.toISOString().slice(0, 10); };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
/** Plain words for a package: arrived, a real problem, or just "On the way" (carrier scan details stay in the tooltip). */
const PROBLEMS = ["failure", "return_to_sender", "error", "available_for_pickup", "cancelled"];
const stLabel = (st: string | undefined) => (st === "delivered" ? "Arrived" : st && PROBLEMS.includes(st) ? TRACK[st] || st : "On the way");
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
  const [focus, setFocus] = useState<Focus | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("carrier");
  const [truck, setTruck] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ManifestHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits(null); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      const r = await fetch(`/api/goods/manifest?q=${encodeURIComponent(t)}`, { cache: "no-store" }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      setHits(j.hits || []); setSearching(false);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  const [freight, setFreight] = useState<Row | null>(null);
  const [linking, setLinking] = useState<Row | null>(null);
  const [order, setOrder] = useState<O | null>(null);
  const [note, setNote] = useState("");
  const [view, setViewState] = useState<View>("today");
  const [pending, setPending] = useState<PendingShipment[] | null>(null);
  const [pvGoods, setPvGoods] = useState<PrintavoGoods[]>([]);
  const [upBusy, setUpBusy] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("view"); if (v === "fbs" || v === "customer" || v === "resolve") setViewState(v); }, []);
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
  const unlinked = (pending || []).filter((g) => !g.us);
  // goods tied to Printavo orders (until go-live): into today's lists too
  const pvCust = pvGoods.filter((g) => g.kind === "goods"), pvBlanks = pvGoods.filter((g) => g.kind === "blanks");
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
  // ---------- today's update: every shipment coming to us, linked or not, one row per shipment ----------
  const t0 = today();
  const PROBLEM = ["failure", "return_to_sender", "error", "available_for_pickup", "cancelled"];
  const localDay = (iso: string | null | undefined) => { if (!iso) return ""; if (iso.length === 10) return iso; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const rowOf = (x: Omit<Row, "state" | "late" | "via" | "supplier" | "noScan"> & { statuses: string[]; supplierRaw: string }): Row => {
    // a label was made but the carrier never scanned it by the next business day after it shipped
    const noScan = x.trks.some((k) => k.tracking && !k.freight && !k.delivered && ["", "unknown", "pre_transit"].includes(k.status || "")) && !!x.shipped && t0 >= nextBiz(x.shipped);
    const state: Row["state"] = x.trks.length && x.trks.every((k) => k.delivered) ? "arrived" : x.statuses.some((st) => PROBLEM.includes(st)) || noScan ? "problem" : "way";
    const supplier = /^ss$|s&s|s & s/i.test(x.supplierRaw) ? "ss" : /sanmar/i.test(x.supplierRaw) ? "sanmar" : "other";
    const k0 = x.trks[0];
    const via: Via = !k0 ? "other" : k0.freight ? "freight" : !k0.tracking ? (/s&s|s & s|ss activewear/i.test(k0.carrier) ? "ss" : "other") : /^ups$/i.test(k0.carrier) || /^1Z/i.test(k0.tracking) ? "ups" : /fedex/i.test(k0.carrier) ? "fedex" : "other";
    return { ...x, via, supplier, noScan, state, late: state !== "arrived" && !!x.at && !!x.need && localDay(x.at) > x.need };
  };
  const rows: Row[] = [
    // our blanks ordered here
    ...data.bships.filter((sh) => v.byId.has(sh.order_id)).map((sh) => { const o = v.byId.get(sh.order_id)!; return rowOf({ key: "b" + sh.id, side: "fbs", number: o.number, href: `/shop/orders/${o.id}`, who: v.who(o), what: "Our blanks", sub: /sanmar/i.test(sh.note + sh.carrier) ? "SanMar" : /s&s|s & s/i.test(sh.note + sh.carrier) ? "S&S" : sh.carrier || "—", boxes: sh.boxes || 0, pcs: sh.pcs || 0, trks: [{ carrier: sh.carrier, tracking: sh.tracking, delivered: sh.track_status === "delivered", status: sh.track_status }], statuses: [sh.track_status], at: sh.est_delivery || sh.eta, deliveredAt: sh.delivered_at, need: v.needBy(o), unlinked: false, supplierRaw: sh.carrier + " " + (sh.note || ""), shipped: null, po: "", so: (sh.note.match(/order\s+([A-Z0-9-]+)/i) || [])[1] || "" }); }),
    // customers' goods on orders here
    ...data.goods.flatMap((it) => it.shipments.filter((sh) => sh.tracking || sh.eta).map((sh) => { const o = v.byId.get(it.order.id); return rowOf({ key: "g" + sh.id, side: "customer", number: it.order.number, href: `/shop/orders/${it.order.id}`, who: v.who(o), what: "Customer goods", sub: it.goods.supplier === "ss" ? "S&S" : it.goods.supplier === "sanmar" ? "SanMar" : supplierLabel(it.goods.supplier) || "Customer", boxes: sh.boxes || 0, pcs: 0, trks: [{ carrier: sh.carrier, tracking: sh.tracking, delivered: sh.track_status === "delivered", status: sh.track_status || "" }], statuses: [sh.track_status || ""], at: sh.est_delivery || sh.eta, deliveredAt: sh.delivered_at || null, need: v.needBy(o), unlinked: false, supplierRaw: it.goods.supplier || "", shipped: sh.created_at ? sh.created_at.slice(0, 10) : null, po: "", so: it.goods.supplier_po || "" }); })),
    // tied to Printavo jobs (until go-live)
    ...pvGoods.map((g) => rowOf({ key: "pv" + g.kind + g.archivedId + g.supplier_order, side: g.kind === "blanks" ? "fbs" : "customer", number: g.number, href: `/shop/archive/${g.archivedId}`, who: g.customer, what: g.kind === "blanks" ? "Our blanks" : "Customer goods", sub: g.supplier === "sanmar" ? "SanMar" : "S&S", so: g.supplier_order, po: g.po, boxes: g.boxes, pcs: g.pcs, trks: g.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight })), lineIds: g.lineIds, statuses: g.tracking.map((k) => k.status), at: g.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: g.tracking.map((k) => k.delivered_at).filter(Boolean).sort().pop() || null, need: g.due_date ? bizBefore(g.due_date, data.lead) : null, unlinked: false, supplierRaw: g.supplier, shipped: g.ship_date })),
    // on a manifest, not on any order yet: still coming in (or already here)
    ...(pending || []).map((g) => rowOf({ key: "u" + g.key, side: g.us ? "fbs" : "customer", number: 0, href: "", who: g.us ? "FBS" : g.customer?.name || g.customer_name, what: g.us ? "Our blanks" : "Customer goods", sub: g.supplier === "sanmar" ? "SanMar" : "S&S", so: g.supplier_order, po: g.customer_po, boxes: g.boxes, pcs: g.pcs, trks: g.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight })), lineIds: g.lineIds, statuses: g.tracking.map((k) => k.status), at: g.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: g.tracking.map((k) => k.delivered_at || null).filter(Boolean).sort().pop() || null, need: null, unlinked: true, supplierRaw: g.supplier, shipped: g.ship_date,
      link: { lineIds: g.lineIds, customerId: g.customer?.id || null, customerName: g.customer?.name || "", us: g.us, supplier: g.supplier, name: g.customer_name, account: g.customer_account, suggest: g.lines.find((l) => l.suggest)?.suggest || null, styles: g.styles } })),
  ];
  // search results (every manifest, any age) as rows in the same grid
  const hitRows: Row[] = (hits || []).map((h) => rowOf({ key: "h" + h.key, side: h.kind === "blanks" || h.who === "FBS" ? "fbs" : "customer", number: h.order?.number || 0, href: h.order?.href || "", who: h.who, what: h.kind === "blanks" ? "Our blanks" : "Customer goods", sub: h.supplier === "sanmar" ? "SanMar" : "S&S", so: h.supplier_order, po: h.po, boxes: h.boxes, pcs: h.pcs,
    trks: h.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight })), statuses: h.tracking.map((k) => k.status),
    at: h.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: h.tracking.map((k) => k.delivered_at || null).filter(Boolean).sort().pop() || null, need: null, unlinked: !h.order, supplierRaw: h.supplier, shipped: h.ship_date,
    link: h.order ? undefined : { lineIds: h.lineIds, customerId: h.customer_id, customerName: h.customer_id ? h.who : "", us: h.who === "FBS", supplier: h.supplier, name: h.customer_name, account: h.customer_account, suggest: null, styles: h.styles } }));
  // searching filters the whole update (Cowboy Cool → only Cowboy Cool), and adds matches from older manifests
  const term = q.trim().toLowerCase();
  const hay = (r: Row) => [r.who, r.po, r.so, r.sub, r.number ? `#${r.number} ${r.number}` : "", ...r.trks.map((k) => `${k.tracking} ${k.carrier}`)].join(" ").toLowerCase();
  const view_rows: Row[] = term.length >= 2
    ? [...rows.filter((r) => hay(r).includes(term)), ...hitRows.filter((h) => !rows.some((r) => r.so && r.so === h.so && r.sub === h.sub && r.who === h.who) && !rows.some((r) => r.key === h.key))]
    : rows;
  const byAt = (a: Row, b: Row) => (a.at || "9999").localeCompare(b.at || "9999");
  const L = {
    arrived: view_rows.filter((r) => r.state === "arrived" && localDay(r.deliveredAt) === t0).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || "")),
    // due today, plus S&S truck / freight still not signed for (they never report delivery on their own)
    today: view_rows.filter((r) => r.state !== "arrived" && (localDay(r.at) === t0 || (!!r.at && localDay(r.at) < t0 && r.trks.some((k) => !k.tracking || k.freight)))),
    // the last week before today
    past: view_rows.filter((r) => r.state === "arrived" && !!r.deliveredAt && localDay(r.deliveredAt) < t0 && localDay(r.deliveredAt) >= addDays(t0, -7)).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || "")),
    way: view_rows.filter((r) => r.state !== "arrived").sort(byAt),
    // delivery problems, labels never scanned by the next business day, and anything arriving after it's needed
    problems: view_rows.filter((r) => r.state === "problem" || r.late).sort(byAt),
  };
  // one "today" box: arriving today / arrived today (the home view)
  const KPIS: { k: Focus; label: string; n: React.ReactNode; tone?: string }[] = [
    { k: "today", label: "Arriving / arrived today", n: <>{L.today.length}<span className="rv-slash"> / </span><span className="rv-ok-n">{L.arrived.length}</span></>, tone: "info" },
    { k: "way", label: "In transit", n: L.way.length },
    { k: "past", label: "Already arrived", n: L.past.length },
    { k: "problems", label: "Delayed / problems", n: L.problems.length, tone: L.problems.length ? "bad" : "" },
  ];
  const statusPill = (r: Row) => r.state === "arrived"
    ? <span className="rv-dot ok">Arrived{r.deliveredAt && localDay(r.deliveredAt) !== t0 ? ` ${new Date(r.deliveredAt.length > 10 ? r.deliveredAt : r.deliveredAt + "T12:00").toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })}` : ""}{r.deliveredAt && r.deliveredAt.length > 10 ? ` ${new Date(r.deliveredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
    : r.state === "problem" ? <span className="rv-dot bad">{r.noScan ? "Not scanned since label created" : TRACK[r.trks.map((k) => k.status).find((st) => PROBLEM.includes(st)) || ""] || "Problem"}</span>
    : r.late ? <span className="rv-dot bad">Arrives after it&apos;s needed</span>
    : <span className="rv-dot way">On the way</span>;
  // a label made but never scanned by the next business day after it shipped
  const unscanned = (r: Row, k: Row["trks"][number]) => !!k.tracking && !k.delivered && ["", "unknown", "pre_transit"].includes(k.status || "") && !!r.shipped && t0 >= nextBiz(r.shipped);
  const rowLine = (r: Row) => (
    <tr key={r.key} className={r.state === "problem" || r.late ? "prob" : ""}>
      <td className="co"><b>{r.who}</b>{r.what === "Our blanks" && <span className="rv-tag">our blanks</span>}</td>
      <td>{r.sub || "—"}</td>
      <td className="po" title={r.po}>{r.po || "—"}</td>
      <td className="r">{r.boxes || "—"}</td>
      <td className="r">{r.pcs || "—"}</td>
      <td>{statusPill(r)}{r.trks.some((k) => k.freight) && r.lineIds?.length ? (r.state === "arrived"
        ? null
        : <div style={{ marginTop: 4 }}><button type="button" className="btn sm primary" onClick={() => setFreight(r)}>Freight received</button></div>) : null}</td>
      <td className={r.late ? "bad" : ""}>{r.state === "arrived" ? "" : r.at ? new Date(r.at.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) : "—"}{r.need && r.state !== "arrived" ? <div className="faint" style={{ fontSize: 11.5 }}>need by {day(r.need)}</div> : null}</td>
      <td className="trk"><div>{(open[r.key] ? r.trks : r.trks.slice(0, 1)).map((k, i) => k.tracking
        ? k.freight ? <span key={k.tracking}><b style={{ fontFamily: "inherit" }}>{k.carrier}</b><br /><a href={trackingUrl(/r&l/i.test(k.carrier) ? "r&l" : "", k.tracking)} target="_blank" rel="noreferrer">PRO {k.tracking}</a></span>
        : <a key={k.tracking} href={trackingUrl(k.carrier, k.tracking)} target="_blank" rel="noreferrer" className={unscanned(r, k) ? "noscan" : k.delivered ? "done" : ""} title={unscanned(r, k) ? "Label created, never scanned by the carrier" : ""}>{k.tracking}</a>
        : <span key={"l" + i} className="faint">{k.carrier === "S&S Activewear" ? "S&S truck" : k.carrier} · no tracking</span>)}
        {r.trks.length > 1 && <button type="button" className="rv-more" onClick={() => setOpen({ ...open, [r.key]: !open[r.key] })} title={r.trks.map((k) => k.tracking).join("\n")}>{open[r.key] ? "show less" : `+${r.trks.length - 1} more`}</button>}</div></td>
      <td className="so">{r.so || "—"}</td>
      <td className="act">{r.unlinked
        ? <button type="button" className="btn sm" onClick={() => (r.link ? setLinking(r) : setView("resolve"))}>Link order</button>
        : <Link href={r.href} className="rv-linked" title="Linked to this order">#{r.number}</Link>}</td>
    </tr>
  );
  // every list: one block per carrier (S&S truck, UPS, FedEx, other) or per supplier (S&S, SanMar, other vendors)
  const grouped = (list: Row[], empty: string) => {
    if (!list.length) return <div className="faint rv-empty">{empty}</div>;
    const groups = groupBy === "carrier" ? VIAS : SUPPLIERS_G;
    const key = (r: Row) => (groupBy === "carrier" ? r.via : r.supplier);
    return (
      <div className="rv-vias">{groups.map((gr) => { const rs = list.filter((r) => key(r) === gr.k).sort((a, b) => a.who.localeCompare(b.who, undefined, { sensitivity: "base" })); return rs.length ? (
        <div key={gr.k} className="rv-via"><div className="rv-via-h">{gr.label}<span>{rs.length} shipment{rs.length === 1 ? "" : "s"} · {rs.reduce((a, r) => a + (r.boxes || 0), 0)} box{rs.reduce((a, r) => a + (r.boxes || 0), 0) === 1 ? "" : "es"}</span></div>
          <div className="rv-grid-wrap"><table className="rv-grid">
            <colgroup><col className="c-co" /><col className="c-from" /><col className="c-po" /><col className="c-n" /><col className="c-n" /><col className="c-st" /><col className="c-at" /><col className="c-trk" /><col className="c-so" /><col className="c-ord" /></colgroup>
            <thead><tr><th>Company</th><th>From</th><th>PO</th><th className="r">Boxes</th><th className="r">Pcs</th><th>Status</th><th>Arrives</th><th>Tracking</th><th>Supplier order</th><th>Our order</th></tr></thead>
            <tbody>{rs.map(rowLine)}</tbody>
          </table></div></div>
      ) : null; })}</div>
    );
  };
  const LISTS: Record<Focus, { title: string; tone?: string; n: number; empty: string; rows: Row[] }> = {
    today: { title: "Arriving today", n: L.today.length, rows: L.today, empty: "Nothing else due today." },
    arrived: { title: "Arrived today", n: L.arrived.length, rows: L.arrived, empty: "Nothing has arrived yet today." },
    past: { title: "Already arrived · the last 7 days", n: L.past.length, rows: L.past, empty: "Nothing arrived in the last week." },
    way: { title: "In transit", n: L.way.length, rows: L.way, empty: "Nothing on the way." },
    problems: { title: "Delayed / problems", tone: "bad", n: L.problems.length, rows: L.problems, empty: "No problems." },
  };
  // first look: arriving today, and underneath it what already arrived
  const shown: Focus[] = focus ? [focus] : ["today", "arrived"];

  // FBS pane boxes
  const fbsToday = arriving.filter((a) => a.when === "today" || a.when === "past").length;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Receiving</div><h1>Goods &amp; receiving</h1></div>

        <div className="rv-head-r"><div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn primary" onClick={() => setTruck(true)}>Receive S&amp;S truck</button>
          <label className="btn" style={{ cursor: "pointer" }}>{upBusy ? "Reading…" : "Import supplier manifest"}<input type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} /></label>
        </div>
</div>
      </div>
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      <div className="rv-tabrow">
      <div className="aa-sub rv-views" role="tablist">
        <button type="button" className={view === "today" ? "on" : ""} onClick={() => setView("today")}>Today &amp; overview</button>
        <button type="button" className={view === "fbs" ? "on" : ""} onClick={() => setView("fbs")}>FBS orders<span className={"aa-n" + (v.need.length ? " hot" : "")}>{v.need.length + arriving.length}</span></button>
        <button type="button" className={view === "customer" ? "on" : ""} onClick={() => setView("customer")}>Customer supplied goods<span className="aa-n">{data.goods.filter((it) => it.goods.status !== "received").length + unlinked.length}</span></button>
        {/* Resolution center: hidden from the tabs for now (Link order pop-ups handle linking); still at ?view=resolve */}
      </div>
        <label className="rv-search rv-search-tabs"><span aria-hidden>⌕</span><input type="search" value={q} onChange={(e) => { setQ(e.target.value); if (view !== "today") setView("today"); }} placeholder="Search every manifest: PO, customer, S&S / SanMar order, tracking, style" aria-label="Search the supplier manifests" /></label>
      </div>

      {view === "customer" && <>
        {pvCust.length > 0 && (
          <section className="rv-pane" style={{ marginBottom: 14, minHeight: 0 }}>
            <div className="rv-pane-h"><b>On Printavo jobs</b><span className="faint">customer goods tied to jobs still worked in Printavo (until go-live)</span></div>
            <div className="rv-pane-b">{pvCust.map((g) => <PvCard key={g.archivedId + g.supplier_order} g={g} lead={data.lead} onReceived={loadPending} />)}</div>
          </section>
        )}
        <CustomerGoodsBoard pending={pending || []} onPending={() => { loadPending(); load(); }} refreshKey={refreshKey} />
      </>}
      {view === "resolve" && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Supplier shipments that aren&apos;t on an order yet. An exact PO match links on its own. Everything else waits here with our best guess (one PO can be several orders: we read the styles, colors and sizes). OK it or change it. Customers see their incoming shipments on their portal and can link them too.</p>
          {!pending ? <div className="empty">Loading…</div> : <ResolveList list={pending} onDone={() => { loadPending(); load(); setRefreshKey((k) => k + 1); }} />}
        </>
      )}
      {view === "today" && <>

      {/* today's update: arriving today, then what already arrived; the boxes open the other lists */}
      <section className="rv-day">
        <div className="rv-day-h">
          <b>Today&apos;s update</b>{term.length >= 2 && <span className="rv-filter">Showing “{q.trim()}”{searching ? " …" : ""} <button type="button" className="linkbtn" onClick={() => setQ("")}>Clear</button></span>}<span className="faint">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · tracking checks every 20 minutes</span>
          <span className="spacer" />
          <div className="rv-seg" role="group" aria-label="Group by">
            <button type="button" className={groupBy === "carrier" ? "on" : ""} onClick={() => setGroupBy("carrier")}>By carrier</button>
            <button type="button" className={groupBy === "supplier" ? "on" : ""} onClick={() => setGroupBy("supplier")}>By supplier</button>
          </div>
        </div>
        <div className="rv-kpis">
          {KPIS.map((k) => (
            <button key={k.k} type="button" className={["rv-kpi-" + k.k, k.tone || "", (focus || "today") === k.k ? "on" : ""].join(" ").trim()} onClick={() => setFocus(k.k === "today" || focus === k.k ? null : k.k)} aria-pressed={(focus || "today") === k.k}>
              {k.k === "today"
                ? <div className="rv-kpi2"><div><span>Arriving today</span><b>{L.today.length}</b></div><div><span>Arrived today</span><b className="okc">{L.arrived.length}</b></div></div>
                : <><span>{k.label}</span><b>{k.n}</b></>}
            </button>
          ))}
        </div>
        <div className="rv-stack">
          {shown.map((k) => (
            <div key={k} className="rv-list">
              <h4 className={"rv-sec rv-sec-" + k}><span>{LISTS[k].title}</span><em>{LISTS[k].n}</em></h4>
              {grouped(LISTS[k].rows, LISTS[k].empty)}
            </div>
          ))}
        </div>
      </section>
      </>}

      {view === "fbs" && <>
      <div className="rv-one">
        {/* FBS orders (retail) */}
        <section className="rv-pane">
          <div className="rv-pane-h"><b>FBS orders</b><span className="faint">retail · blanks we buy</span></div>
          <div className="rv-stages">
            <button type="button" className={v.need.length ? "warn" : ""} onClick={() => setTab("need")}><span>Need to order</span><b>{v.need.length}</b></button>
            <button type="button" className={fbsToday ? "info" : ""} onClick={() => setTab("arriving")}><span>Arriving today</span><b>{fbsToday}</b></button>
            <button type="button" onClick={() => setTab("arriving")}><span>On the way</span><b>{arriving.length}</b></button>
            <button type="button" onClick={() => setTab("received")}><span>Received</span><b>{v.received.length + pvBlanks.filter((g) => g.delivered).length}</b></button>
          </div>
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

      </div>
      </>}
      {linking && <LinkModal r={linking} onClose={() => setLinking(null)} onDone={(m) => { setLinking(null); setNote(m); load(); loadPending(); setRefreshKey((k) => k + 1); if (q.trim().length >= 2) setQ(q + " "); }} />}
      {freight && <FreightModal r={freight} onClose={() => setFreight(null)} onDone={(m) => { setFreight(null); setNote(m); loadPending(); }} />}
      {truck && <TruckModal onClose={() => setTruck(false)} onDone={(m) => { setTruck(false); setNote(m); load(); loadPending(); setRefreshKey((k) => k + 1); }} />}
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
          <span className={"rv-st" + (t.delivered ? " ok" : "")} title={TRACK[t.status] || ""}> {stLabel(t.delivered ? "delivered" : t.status)}</span>{!t.delivered && t.eta ? <span className="faint"> · arrives {day(t.eta)}</span> : null}{t.tracking && t.detail ? <span className="faint"> · {t.detail}</span> : null}</li>
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
      {ships.length > 0 && <ul className="rv-ships">{ships.map((s) => <li key={s.id}>{s.tracking ? <a href={trackingUrl(s.carrier, s.tracking)} target="_blank" rel="noreferrer">{s.carrier} {s.tracking}</a> : <span>{s.note}</span>}<span className={"rv-st" + (s.track_status === "delivered" ? " ok" : "")} title={TRACK[s.track_status] || ""}> {stLabel(s.track_status)}</span>{s.track_detail && <span className="faint"> · {s.track_detail}</span>}</li>)}</ul>}
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

/**
 * The S&S local truck (Fort Worth) is here. It has no tracking, so receiving signs for it: tick what came off the truck,
 * when it came, and who signed. Everything ticked shows delivered (linked to an order or not).
 */
function TruckModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  type Stop = { key: string; supplier_order: string; who: string; po: string; order: { number: number; href: string } | null; unlinked: boolean; ours: boolean; boxes: number; pcs: number; ship_date: string | null; lineIds: string[] };
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const now = new Date();
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  const [date, setDate] = useState(today());
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/goods/manifest?truck=1", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) return setErr(j.error);
      const list = (j.stops || []) as Stop[];
      setStops(list);
      // what should be on today's truck: shipped before today (it comes the next business day)
      setOn(Object.fromEntries(list.map((x) => [x.key, !x.ship_date || x.ship_date < today()])));
    }).catch(() => setErr("Couldn't load the truck list."));
  }, []);
  const picked = (stops || []).filter((x) => on[x.key]);
  async function save() {
    if (!picked.length) return setErr("Tick what came off the truck.");
    if (!by.trim()) return setErr("Who signed for it?");
    setBusy(true); setErr("");
    const at = new Date(`${date}T${time || "12:00"}`).toISOString();
    const r = await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ truck: { lineIds: picked.flatMap((x) => x.lineIds), at, signedBy: by.trim() } }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) return setErr(j.error || "Couldn't save.");
    onDone(`S&S truck received at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, signed by ${by.trim()}: ${picked.length} shipment${picked.length === 1 ? "" : "s"}, ${picked.reduce((a, x) => a + x.boxes, 0)} boxes, ${picked.reduce((a, x) => a + x.pcs, 0)} pcs.`);
  }
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Receive the S&S truck" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet">
        <div className="pp-sheet-h"><div><b>Receive S&amp;S truck</b> <span className="faint" style={{ fontSize: 14 }}>· Fort Worth local delivery</span></div><button type="button" className="btn icon ghost" aria-label="Close" disabled={busy} onClick={onClose}>✕</button></div>
        <div style={{ padding: "14px 22px" }} className="stack">
          {!stops ? <div className="faint">{err || "Loading what's on the truck…"}</div> : !stops.length ? <div className="gb-empty">Nothing is waiting on the S&amp;S truck. Import today&apos;s S&amp;S manifest first.</div> : (
            <>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <b>What came off the truck?</b><span className="faint">{picked.length} of {stops.length} ticked</span><span className="spacer" />
                <button type="button" className="linkbtn" onClick={() => setOn(Object.fromEntries(stops.map((x) => [x.key, true])))}>Tick all</button>
                <button type="button" className="linkbtn" onClick={() => setOn({})}>Clear</button>
              </div>
              <div style={{ overflowX: "auto", maxHeight: "45vh" }}><table className="rv-tbl">
                <thead><tr><th></th><th>For</th><th>Order</th><th>S&amp;S order</th><th>PO</th><th className="r">Boxes</th><th className="r">Pcs</th><th>Shipped</th></tr></thead>
                <tbody>{stops.map((x) => (
                  <tr key={x.key} onClick={() => setOn({ ...on, [x.key]: !on[x.key] })} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={!!on[x.key]} onChange={() => setOn({ ...on, [x.key]: !on[x.key] })} onClick={(e) => e.stopPropagation()} aria-label={`${x.who} ${x.supplier_order}`} /></td>
                    <td><b>{x.who}</b></td>
                    <td>{x.order ? `#${x.order.number}` : <span className="rv-pill unl">Unlinked order</span>}</td>
                    <td>{x.supplier_order}</td><td>{x.po || "—"}</td><td className="r">{x.boxes}</td><td className="r">{x.pcs}</td><td>{day(x.ship_date)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="rv-other" style={{ gridTemplateColumns: "auto auto 1fr auto" }}>
                <label>Delivered on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label>What time?<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
                <label>Signed by<input type="text" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name of who signed" autoFocus /></label>
                <button type="button" className="btn primary" disabled={busy || !picked.length || !by.trim()} onClick={save}>{busy ? "Saving…" : `Received ${picked.reduce((a, x) => a + x.boxes, 0)} boxes`}</button>
              </div>
              {err && <div className="pv-err">{err}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** An LTL freight pallet is here (no parcel tracking): when it came and who received it. */
function FreightModal({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: (msg: string) => void }) {
  const now = new Date();
  const [date, setDate] = useState(today());
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const f = r.trks.find((k) => k.freight);
  async function save() {
    if (!by.trim()) return setErr("Who received it?");
    setBusy(true); setErr("");
    const at = new Date(`${date}T${time || "12:00"}`).toISOString();
    const res = await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ freight: { lineIds: r.lineIds, at, signedBy: by.trim() } }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || j.error) return setErr(j.error || "Couldn't save.");
    onDone(`Freight received: ${r.who}${f ? ` (${f.carrier} PRO ${f.tracking})` : ""} at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, received by ${by.trim()}.`);
  }
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Freight received" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet" style={{ maxWidth: 560 }}>
        <div className="pp-sheet-h"><div><b>Freight received</b> <span className="faint" style={{ fontSize: 14 }}>· {r.who}</span></div><button type="button" className="btn icon ghost" aria-label="Close" disabled={busy} onClick={onClose}>✕</button></div>
        <div style={{ padding: "14px 22px" }} className="stack">
          <div className="faint" style={{ fontSize: 13.5 }}>{f ? `${f.carrier} · PRO ${f.tracking} · ` : ""}{r.sub} {r.so} · {r.boxes} carton{r.boxes === 1 ? "" : "s"} · {r.pcs} pcs{r.po ? ` · PO ${r.po}` : ""}</div>
          <div className="rv-other" style={{ gridTemplateColumns: "auto auto 1fr" }}>
            <label>Delivered on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>What time?<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <label>Received by<input type="text" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name of who signed" autoFocus /></label>
          </div>
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8 }}><span className="spacer" /><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !by.trim()} onClick={save}>{busy ? "Saving…" : "Freight received"}</button></div>
        </div>
      </div>
    </div>
  );
}

/**
 * Link a shipment to its order in a small pop-up: the customer's open orders (and open Printavo jobs) with the PO match
 * on top; pick one and it's linked. Wrong or unknown customer (our blanks, an account name we don't know): type the
 * customer and pick from their orders.
 */
function LinkModal({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: (msg: string) => void }) {
  const li = r.link!;
  const [cust, setCust] = useState<{ id: string; name: string } | null>(li.customerId ? { id: li.customerId, name: li.customerName || r.who } : null);
  const [custs, setCusts] = useState<{ id: string; label: string }[]>([]);
  const [who, setWho] = useState("");
  const [orders, setOrders] = useState<{ id: string; number: number; nickname: string; po: string; due_date: string | null; status: string; printavo: boolean; items: string; pcs: number; match: boolean }[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    createClient().from("customers").select("id, company, name").order("company").limit(4000)
      .then(({ data }) => setCusts(((data || []) as { id: string; company: string; name: string }[]).map((c) => ({ id: c.id, label: c.company || c.name })).filter((c) => c.label)));
  }, []);
  useEffect(() => {
    if (!cust) { setOrders(null); return; }
    setOrders(null); setPick("");
    fetch(`/api/goods/manifest?orders=${cust.id}&po=${encodeURIComponent(r.po || "")}`, { cache: "no-store" }).then((x) => x.json()).then((j) => {
      const list = j.orders || [];
      setOrders(list);
      const pre = (li.suggest && list.find((o: { id: string }) => o.id === li.suggest)) || list.find((o: { match: boolean }) => o.match);
      if (pre) setPick(pre.id);
    }).catch(() => setErr("Couldn't load their orders."));
  }, [cust, r.po, li.suggest]);
  const typed = who.trim().toLowerCase();
  const matches = typed.length >= 2 ? custs.filter((c) => c.label.toLowerCase().includes(typed)).slice(0, 8) : [];
  const newAccount = !li.us && !!cust && cust.id !== li.customerId;
  async function link() {
    if (!pick) return;
    setBusy(true); setErr("");
    const post = (body: unknown) => fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (x) => { const j = await x.json().catch(() => ({})); if (!x.ok || j.error) throw new Error(j.error || "Couldn't link."); return j; });
    try {
      if (li.us) await post({ assign: { lineIds: li.lineIds, orderId: pick, kind: "blanks" } });
      else await post({ link: li.lineIds.map((id) => ({ lineId: id, orderId: pick })) });
      // an account name we didn't know (GUNPOWDER & WHISKEY → Cowboy Cool): remember it for next time
      if (newAccount && remember && li.name) await post({ alias: { supplier: li.supplier, name: li.name, account: li.account, customerId: cust!.id } }).catch(() => null);
      const o = orders?.find((x) => x.id === pick);
      onDone(`Linked ${r.who === "FBS" ? "our blanks" : r.who} (${r.sub} ${r.so}) to ${o?.printavo ? "Printavo " : ""}#${o?.number}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Link order" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet lk-sheet">
        <div className="pp-sheet-h"><div><b>Link order</b> <span className="faint" style={{ fontSize: 14 }}>· {r.sub} {r.so}{r.po ? ` · PO ${r.po}` : ""} · {r.boxes} box{r.boxes === 1 ? "" : "es"} · {r.pcs} pcs</span></div><button type="button" className="btn icon ghost" aria-label="Close" disabled={busy} onClick={onClose}>✕</button></div>
        <div className="lk-body">
          {li.styles && <div className="faint" style={{ fontSize: 13 }}>What shipped: {li.styles}</div>}
          <div className="lk-cust">
            {cust ? (
              <><span className="faint">Customer</span><b>{cust.name}</b><button type="button" className="linkbtn" onClick={() => { setCust(null); setWho(""); }}>Change</button></>
            ) : (
              <div className="lk-find">
                <label className="faint" htmlFor="lk-who">{li.us ? "Which customer are these blanks for?" : `Who is “${li.name}” in our system?`}</label>
                <input id="lk-who" type="text" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Start typing the customer…" autoFocus />
                {matches.length > 0 && <ul className="lk-sug">{matches.map((c) => <li key={c.id}><button type="button" onClick={() => { setCust({ id: c.id, name: c.label }); setWho(""); }}>{c.label}</button></li>)}</ul>}
              </div>
            )}
          </div>
          {cust && (
            !orders ? <div className="faint">Loading {cust.name}&apos;s open orders…</div> : !orders.length ? <div className="gb-empty">{cust.name} has no open orders or open Printavo jobs.</div> : (
              <div className="lk-list" role="radiogroup" aria-label="Open orders">
                <div className="faint" style={{ fontSize: 12.5, marginBottom: 2 }}>Select the order these goods are for:</div>
                {orders.map((o) => (
                  <label key={o.id} className={"lk-o" + (pick === o.id ? " on" : "")}>
                    <input type="radio" name="lk" checked={pick === o.id} onChange={() => setPick(o.id)} />
                    <span className="lk-n">#{o.number}</span>
                    <span className="lk-m"><b>{o.nickname || o.po || "Order"}</b>{o.po && o.po !== o.nickname ? <span className="faint"> · PO {o.po}</span> : null}<br /><span className="faint">{o.items || "—"}{o.pcs ? ` · ${o.pcs} pcs` : ""}</span></span>
                    <span className="lk-r">{o.match && <span className="rv-tag lk-match">PO match</span>}{li.suggest === o.id && !o.match && <span className="rv-tag lk-match">our guess</span>}{o.printavo && <span className="rv-tag">Printavo</span>}<span className="faint">{o.due_date ? `due ${new Date(o.due_date + "T12:00").toLocaleDateString([], { month: "numeric", day: "numeric" })}` : ""}</span></span>
                  </label>
                ))}
              </div>
            )
          )}
          {newAccount && li.name && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: "auto" }} />Remember: {li.name}{li.account ? ` (account ${li.account})` : ""} is {cust!.name}</label>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8 }}><span className="spacer" /><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !pick} onClick={link}>{busy ? "Linking…" : "Link order"}</button></div>
        </div>
      </div>
    </div>
  );
}
