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
import SearchInput from "@/components/SearchInput";
import { useSticky } from "@/lib/useSticky";

type O = { id: string; number: number; nickname: string; status: string; due_date: string | null; production_date: string | null; qty: number; customer_id: string | null; price_type: string | null };
type BO = { id: string; order_id: string; supplier: string; supplier_order: string; status: string; expected_date: string | null; total: number | null; placed_via: string; created_at: string; received_at: string | null; note: string };
type BS = { id: string; order_id: string; blank_order_id: string | null; carrier: string; tracking: string; boxes: number | null; pcs: number | null; note: string; eta: string | null; track_status: string; track_detail: string; est_delivery: string | null; delivered_at: string | null };
type View = "today" | "fbs" | "customer" | "resolve" | "ignored";
type Arrive = "past" | "today" | "tomorrow" | "later" | "nodate";
const ARRIVE_GROUPS: { k: Arrive; label: string }[] = [
  { k: "past", label: "Should be here: not marked received" }, { k: "today", label: "Arriving today" }, { k: "tomorrow", label: "Tomorrow" }, { k: "later", label: "Later" }, { k: "nodate", label: "On the way, no date yet" },
];
type Focus = "arrived" | "today" | "way" | "past" | "problems";
type GroupBy = "carrier" | "supplier";
type Row = { key: string; /** a job's shipments shown separately (Uncombine): the job key, to combine them again */ splitOf?: string; side: "fbs" | "customer"; number: number; href: string; who: string; what: string; sub: string; po: string; so: string; boxes: number; pcs: number;
  trks: { carrier: string; tracking: string; delivered: boolean; status: string; detail?: string; freight?: boolean; /** the vendor, on a row that combines several */ src?: string;
    /** a mixed box: every job with goods in this box */ mixed?: { number: number; pcs: number; items: string }[] }[]; lineIds?: string[];
  /** a combined row: the shipments it's made of (one job, several vendors / supplier orders) */
  parts?: string[];
  /** a combined row's job keys (Uncombine) */
  jobKeys?: string[];
  /** a mixed shipment: the jobs sharing its boxes */
  jobs?: { number: number; href: string }[];
  link?: LinkInfo; at: string | null; deliveredAt: string | null; need: string | null; unlinked: boolean; state: "arrived" | "problem" | "way"; late: boolean; via: Via; supplier: string; shipped: string | null; noScan: boolean };
type LinkInfo = { lineIds: string[]; customerId: string | null; customerName: string; us: boolean; supplier: string; name: string; account: string; suggest: string | null; styles: string;
  /** an unknown account whose goods fit one customer's job: who we think it is, and why */
  sugCust?: { id: string; name: string } | null; sugHow?: string;
  /** the job number we (or the AI) guessed */
  sugNo?: number | null };
type Via = "ss" | "ups" | "fedex" | "freight" | "other";
const VIAS: { k: string; label: string }[] = [{ k: "ss", label: "S&S truck" }, { k: "ups", label: "UPS" }, { k: "fedex", label: "FedEx" }, { k: "freight", label: "Freight (LTL pallets)" }, { k: "other", label: "DHL / other" }];
const SUPPLIERS_G: { k: string; label: string }[] = [{ k: "ss", label: "S&S Activewear" }, { k: "sanmar", label: "SanMar" }, { k: "other", label: "Other vendors" }];
/**
 * Forgiving search: ignores spaces and punctuation ("Nine18" = "Nine 18"), and allows a typo or two
 * ("Peticoles" finds Peticolas). Every word typed has to be found.
 */
const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
function nearIn(text: string, word: string) {
  if (text.includes(word)) return true;
  const n = word.length, max = n >= 8 ? 2 : n >= 4 ? 1 : 0;
  if (!max) return false;
  for (let i = 0; i + n - max <= text.length; i++) for (let len = n - max; len <= n + max; len++) {
    if (i + len > text.length) break;
    const a = text.slice(i, i + len), b = word;
    // edit distance, stopped early past `max`
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let x = 1; x <= a.length; x++) {
      const cur = [x]; let best = x;
      for (let y = 1; y <= b.length; y++) { cur[y] = Math.min(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1)); best = Math.min(best, cur[y]); }
      if (best > max) { prev = []; break; }
      prev = cur;
    }
    if (prev.length && prev[b.length] <= max) return true;
  }
  return false;
}
const fuzzyHas = (text: string, query: string) => {
  const t = squash(text);
  const whole = squash(query);
  if (whole && nearIn(t, whole)) return true;
  const words = query.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
  return words.length > 1 && words.every((w) => nearIn(t, w));
};
/** The full FBS orders / customer goods boards are hidden for now: those tabs just filter today's update. */
const SHOW_BOARDS = false as boolean;
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
// UPS Ground always (Nick, Oct 9): "Ground (S&S picks)" can land on UPS Ground Advantage, which is slower
const WH: Record<string, string> = { TX: "Fort Worth", KS: "Kansas", IL: "Illinois", GA: "Georgia", OH: "Ohio", KY: "Kentucky", PA: "Pennsylvania", NV: "Nevada", NJ: "New Jersey", FL: "Florida", CA: "California", MA: "Massachusetts", DS: "Mill direct" };
const SS_METHODS: [string, string][] = [["40", "UPS Ground"], ["14", "FedEx Ground"], ["16", "UPS 3 Day Select"], ["3", "UPS 2nd Day Air"], ["2", "UPS Next Day Air"], ["6", "Will call (we pick up)"]];

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
  const [tab, setTab] = useSticky<"arriving" | "need" | "ordered" | "received">("receiving.tab", "arriving");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [groupBy, setGroupBy] = useSticky<GroupBy>("receiving.groupBy", "carrier");
  const [truck, setTruck] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ManifestHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits(null); return; }
    setFocus(null);
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
  const [items, setItems] = useState<Row | null>(null);
  // Unlink: click once to ask, again to do it
  const [unlinkAsk, setUnlinkAsk] = useState<string | null>(null);
  async function unlink(r: Row) {
    if (unlinkAsk !== r.key) { setUnlinkAsk(r.key); setTimeout(() => setUnlinkAsk((k) => (k === r.key ? null : k)), 5000); return; }
    setUnlinkAsk(null);
    const res = await fetch("/api/goods/manifest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unlink: r.lineIds }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || j.error) { setNote(`Couldn't unlink it: ${j.error || "no answer"}`); return; }
    setNote(`Unlinked ${r.who}${r.po ? ` PO ${r.po}` : ""} from #${r.number}. It's back under not linked, and it won't be put on #${r.number} again: link it to the right job (the AI learns from that).`);
    load(); loadPending(); setRefreshKey((k) => k + 1);
  }
  const [aiBusy, setAiBusy] = useState(false);
  async function askAi(force = false) {
    setAiBusy(true); setNote("Relinking: checking tracking, linking exact matches, and getting AI recommendations for the rest… (up to a few minutes)");
    const r = await fetch("/api/goods/ai-match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setAiBusy(false);
    if (!r?.ok || j.error || j.off) { setNote(j.off ? `AI is off: ${j.off}` : `The AI couldn't finish: ${j.error || "no answer"}`); return; }
    const ruleLinks = (j.rules?.linked || 0), linked = ruleLinks + (j.linked || 0);
    setNote(`Relink done: ${linked} shipment${linked === 1 ? "" : "s"} linked (exact matches), ${j.suggested || 0} new AI recommendation${j.suggested === 1 ? "" : "s"} to OK, ${j.none || 0} with nothing close${j.skipped ? `; ${j.skipped} unchanged since the AI last looked` : ""}.${j.errors?.length ? ` Problems: ${j.errors[0]}` : ""}`);
    loadPending();
  }
  const [order, setOrder] = useState<O | null>(null);
  const [note, setNote] = useState("");
  const [view, setViewState] = useState<View>("today");
  const [pending, setPending] = useState<PendingShipment[] | null>(null);
  const [pvGoods, setPvGoods] = useState<PrintavoGoods[]>([]);
  const [upBusy, setUpBusy] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  // shipments ignored by hand: out of every list, under the Ignored tab
  const [ignored, setIgnored] = useState<Record<string, { at: string; by: string; label: string }>>({});
  // jobs whose shipments should show separately (Uncombine)
  const [separate, setSeparate] = useState<Record<string, { at: string; by: string; label: string }>>({});
  useEffect(() => { fetch("/api/goods/ignore", { cache: "no-store" }).then((r) => r.json()).then((j) => { setIgnored(j.ignored || {}); setSeparate(j.separate || {}); }).catch(() => {}); }, []);
  async function setSeparated(jobKey: string, yes: boolean, label: string) {
    const before = separate;
    setSeparate((m) => { const n = { ...m }; if (yes) n[jobKey] = { at: new Date().toISOString(), by: "", label }; else delete n[jobKey]; return n; });
    const res = await fetch("/api/goods/ignore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: jobKey, separate: yes, label }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || j.error) { setSeparate(before); setNote(`Couldn't ${yes ? "uncombine" : "combine"} it: ${j.error || "no answer"}`); return; }
    setSeparate(j.separate || {});
    if (yes) setNote(`Uncombined ${label}: each supplier order has its own row again. If one is on the wrong job, Unlink that one.`);
  }
  async function ignore(r: { key: string; who: string; number: number; so: string; parts?: string[] }, yes: boolean) {
    const before = ignored, keys = r.parts?.length ? r.parts : [r.key];
    const label = `${r.who}${r.number ? ` #${r.number}` : ""}${r.so ? ` · ${r.so}` : ""}`;
    setIgnored((m) => { const n = { ...m }; for (const k of keys) { if (yes) n[k] = { at: new Date().toISOString(), by: "", label }; else delete n[k]; } return n; });
    let last: Record<string, { at: string; by: string; label: string }> | null = null;
    for (const k of keys) {
      const res = await fetch("/api/goods/ignore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k, ignore: yes, label }) }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok || j.error) { setIgnored(before); setNote(`Couldn't ${yes ? "ignore" : "restore"} it: ${j.error || "no answer"}`); return; }
      last = j.ignored || {};
    }
    if (last) setIgnored(last);
  }
  // Check-In: this week's jobs ready to count, and open check-in problems (badges on the Check-In button)
  const [ck, setCk] = useState<{ ready: number; issue: number } | null>(null);
  useEffect(() => { fetch("/api/goods/checkin", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.jobs) setCk({ ready: (j.jobs as { state: string; day: string }[]).filter((x) => x.state === "ready" && x.day <= j.today).length, issue: (j.problems || []).length }); }).catch(() => {}); }, [refreshKey]);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("view"); if (v === "fbs" || v === "customer" || v === "resolve" || v === "ignored") setViewState(v); }, []);
  const setView = (v: View) => { setViewState(v); try { const u = new URL(window.location.href); if (v === "today") u.searchParams.delete("view"); else u.searchParams.set("view", v); window.history.replaceState(null, "", u.toString()); } catch { /* ignore */ } window.scrollTo({ top: 0 }); };
  const loadPending = useCallback(async () => { const r = await fetch("/api/goods/manifest", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setPending(j.groups || []); setPvGoods(j.printavo || []); if (j.error) setNote(`Couldn't load everything: ${j.error}`); }, []);
  useEffect(() => { loadPending(); }, [loadPending]);
  /** One or more manifests at once (S&S and SanMar mixed is fine): read one after another, then one summary. */
  async function upload(files: File[]) {
    if (!files.length) return;
    setUpBusy(true); setNote("");
    const lines: string[] = [];
    let waiting = 0;
    for (const [i, f] of files.entries()) {
      setNote(files.length > 1 ? `Reading ${i + 1} of ${files.length}: ${f.name}…` : "");
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/goods/manifest", { method: "POST", body: fd }).catch(() => null);
      const j = r ? await r.json().catch(() => ({ error: `HTTP ${r.status}` })) : { error: "Couldn't reach the server." };
      if (!r || !r.ok || j.error) { lines.push(`${f.name}: ${j.error || "couldn't read it"}`); continue; }
      const w = (j.suggested || 0) + (j.unmatched || 0); waiting += w;
      lines.push(`${j.supplier === "sanmar" ? "SanMar" : "S&S"} (${f.name}): ${j.shipments} shipment${j.shipments === 1 ? "" : "s"}, ${j.new} new line${j.new === 1 ? "" : "s"}${j.lines !== j.new ? ` (${j.lines - j.new} already imported)` : ""}; linked ${j.matched} to customer orders, ${j.blanks} to our blanks${w ? `, ${w} to link` : ""}.`);
    }
    setUpBusy(false);
    setNote(`${files.length > 1 ? `${files.length} manifests imported. ` : ""}${lines.join("  ·  ")}${waiting ? `  Anything not linked shows a Link order button below.` : ""}`);
    load(); loadPending(); setRefreshKey((k) => k + 1);
  }
  const load = useCallback(async () => {
    const [{ data: os }, { data: bo }, { data: st }] = await Promise.all([
      sb.from("orders").select("id, number, nickname, status, type, due_date, production_date, qty, customer_id, price_type, submitted_at").not("status", "in", "(completed,ready,quote,quote_sent,request)").order("due_date", { ascending: true, nullsFirst: false }).limit(800),
      sb.from("blank_orders").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(500),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const orders = (os || []) as (O & { type: string; submitted_at: string | null })[];
    const blanks = (bo || []) as BO[];
    // goods bought ahead of an order (Order goods) have no order yet
    const ids = [...new Set([...blanks.map((b) => b.order_id).filter(Boolean)])];
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
    // a mixed box first, so it shows even when the list is folded
    const trks = [...x.trks].sort((a, b) => Number(!!b.mixed) - Number(!!a.mixed));
    return { ...x, trks, via, supplier, noScan, state, late: state !== "arrived" && !!x.at && !!x.need && localDay(x.at) > x.need };
  };
  const rows: Row[] = [
    // our blanks ordered here
    ...data.bships.filter((sh) => v.byId.has(sh.order_id)).map((sh) => { const o = v.byId.get(sh.order_id)!; return rowOf({ key: "b" + sh.id, side: "fbs", number: o.number, href: `/shop/orders/${o.id}`, who: v.who(o), what: "Our blanks", sub: /sanmar/i.test(sh.note + sh.carrier) ? "SanMar" : /s&s|s & s/i.test(sh.note + sh.carrier) ? "S&S" : sh.carrier || "—", boxes: sh.boxes || 0, pcs: sh.pcs || 0, trks: [{ carrier: sh.carrier, tracking: sh.tracking, delivered: sh.track_status === "delivered", status: sh.track_status }], statuses: [sh.track_status], at: sh.est_delivery || sh.eta, deliveredAt: sh.delivered_at, need: v.needBy(o), unlinked: false, supplierRaw: sh.carrier + " " + (sh.note || ""), shipped: null, po: "", so: (sh.note.match(/order\s+([A-Z0-9-]+)/i) || [])[1] || "" }); }),
    // customers' goods on orders here
    ...data.goods.flatMap((it) => it.shipments.filter((sh) => sh.tracking || sh.eta).map((sh) => { const o = v.byId.get(it.order.id); return rowOf({ key: "g" + sh.id, side: "customer", number: it.order.number, href: `/shop/orders/${it.order.id}`, who: v.who(o), what: "Customer goods", sub: it.goods.supplier === "ss" ? "S&S" : it.goods.supplier === "sanmar" ? "SanMar" : supplierLabel(it.goods.supplier) || "Customer", boxes: sh.boxes || 0, pcs: 0, trks: [{ carrier: sh.carrier, tracking: sh.tracking, delivered: sh.track_status === "delivered", status: sh.track_status || "" }], statuses: [sh.track_status || ""], at: sh.est_delivery || sh.eta, deliveredAt: sh.delivered_at || null, need: v.needBy(o), unlinked: false, supplierRaw: it.goods.supplier || "", shipped: sh.created_at ? sh.created_at.slice(0, 10) : null, po: "", so: it.goods.supplier_po || "" }); })),
    // tied to Printavo jobs (until go-live)
    ...pvGoods.map((g) => rowOf({ key: "pv" + g.kind + g.archivedId + g.supplier_order, side: g.kind === "blanks" ? "fbs" : "customer", number: g.number, href: `/shop/archive/${g.archivedId}`, who: g.customer, what: g.kind === "blanks" ? "Our blanks" : "Customer goods", sub: g.supplier === "sanmar" ? "SanMar" : "S&S", so: g.supplier_order, po: g.po, boxes: g.boxes, pcs: g.pcs, trks: g.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight, mixed: k.mixed })), lineIds: g.lineIds, statuses: g.tracking.map((k) => k.status), at: g.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: g.tracking.map((k) => k.delivered_at).filter(Boolean).sort().pop() || null, need: g.due_date ? bizBefore(g.due_date, data.lead) : null, unlinked: false, supplierRaw: g.supplier, shipped: g.ship_date })),
    // on a manifest, not on any order yet: still coming in (or already here)
    ...(pending || []).map((g) => rowOf({ key: "u" + g.key, side: g.us ? "fbs" : "customer", number: 0, href: "", who: g.us ? "FBS" : g.customer?.name || g.customer_name, what: g.us ? "Our blanks" : "Customer goods", sub: g.supplier === "sanmar" ? "SanMar" : "S&S", so: g.supplier_order, po: g.customer_po, boxes: g.boxes, pcs: g.pcs, trks: g.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight, mixed: k.mixed })), lineIds: g.lineIds, statuses: g.tracking.map((k) => k.status), at: g.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: g.tracking.map((k) => k.delivered_at || null).filter(Boolean).sort().pop() || null, need: null, unlinked: true, supplierRaw: g.supplier, shipped: g.ship_date,
      link: { lineIds: g.lineIds, customerId: g.customer?.id || null, customerName: g.customer?.name || "", us: g.us, supplier: g.supplier, name: g.customer_name, account: g.customer_account, suggest: g.lines.find((l) => l.suggest)?.suggest || null, styles: g.styles, sugCust: g.suggestCustomer || null, sugHow: g.how,
        sugNo: (() => { const id = g.lines.find((l) => l.suggest)?.suggest; return id ? g.orders.find((o) => o.id === id)?.number || null : null; })() } })),
  ];
  // ignored by hand: out of every list (the Ignored tab shows them)
  // one job's goods from several vendors / supplier orders (Gear Go Live PO 10212: part SanMar, part S&S) are one row;
  // each tracking number says which vendor it came from
  // one row per job, and per box: shipments for the same job (several vendors / supplier orders) are one row, and so are
  // jobs that share a box (a "mixed" shipment: Nine18's PO 42998 box holds goods for #34476 and its embroidery job #34477)
  const combine = (list: Row[]): Row[] => {
    const out: Row[] = [], linked = list.filter((r) => !r.unlinked && !!r.href);
    for (const r of list) if (r.unlinked || !r.href) out.push(r);
    const up = linked.map((_, i) => i);
    const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
    const join = (a: number, b: number) => { up[find(a)] = find(b); };
    const jobOf = (r: Row) => `${r.href}|${r.side}`;
    const firstBy = new Map<string, number>();
    linked.forEach((r, i) => {
      for (const k of [jobOf(r), ...r.trks.map((t) => t.tracking).filter(Boolean).map((t) => "t:" + t)]) { const j = firstBy.get(k); if (j === undefined) firstBy.set(k, i); else join(i, j); }
    });
    const groups = new Map<number, Row[]>();
    linked.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) || []), r]); });
    for (const rs of groups.values()) {
      if (rs.length === 1) { out.push(rs[0]); continue; }
      const jobKeys = [...new Set(rs.map(jobOf))];
      // uncombined by hand: each supplier order its own row
      if (jobKeys.some((k) => separate[k])) { out.push(...rs.map((x) => ({ ...x, splitOf: jobKeys.join("§") }))); continue; }
      const f = rs[0], subs = [...new Set(rs.map((x) => x.sub))];
      const jobs = [...new Map(rs.map((x) => [x.href, { number: x.number, href: x.href }])).values()].sort((a, b) => a.number - b.number);
      const state: Row["state"] = rs.every((x) => x.state === "arrived") ? "arrived" : rs.some((x) => x.state === "problem") ? "problem" : "way";
      const latest = (xs: (string | null)[]) => (xs.filter(Boolean) as string[]).sort().pop() || null;
      // the same box counted once (a box shared by two jobs shows up under each)
      const perOrder = new Map<string, number>();
      for (const x of rs) { const k = `${x.sub}|${x.so}`; perOrder.set(k, Math.max(perOrder.get(k) || 0, x.boxes || 0)); }
      const trks = [...new Map(rs.flatMap((x) => x.trks.map((k) => ({ ...k, src: subs.length > 1 ? x.sub : undefined }))).map((k) => [k.tracking || Math.random().toString(), k])).values()].sort((a, b) => Number(!!b.mixed) - Number(!!a.mixed));
      out.push({ ...f, splitOf: undefined, number: jobs[0].number, href: jobs[0].href, jobs: jobs.length > 1 ? jobs : undefined, key: rs.map((x) => x.key).join("+"), parts: rs.map((x) => x.key), jobKeys, sub: subs.join(" + "), po: [...new Set(rs.map((x) => x.po).filter(Boolean))].join(" / "), so: [...new Set(rs.map((x) => x.so).filter(Boolean))].join(" · "),
        boxes: [...perOrder.values()].reduce((a, n) => a + n, 0), pcs: rs.reduce((a, x) => a + (x.pcs || 0), 0),
        trks, lineIds: rs.flatMap((x) => x.lineIds || []),
        state, late: rs.some((x) => x.late), noScan: rs.some((x) => x.noScan), at: latest(rs.map((x) => x.at)), deliveredAt: state === "arrived" ? latest(rs.map((x) => x.deliveredAt)) : null,
        need: (rs.map((x) => x.need).filter(Boolean) as string[]).sort()[0] || null,
        shipped: (rs.map((x) => x.shipped).filter(Boolean) as string[]).sort()[0] || null });
    }
    return out;
  };
  const ignoredRows = combine(rows.filter((r) => ignored[r.key]));
  const liveRows = combine(rows.filter((r) => !ignored[r.key]));
  // search results (every manifest, any age) as rows in the same grid
  const hitRows: Row[] = (hits || []).map((h) => rowOf({ key: "h" + h.key, side: h.kind === "blanks" || h.who === "FBS" ? "fbs" : "customer", number: h.order?.number || 0, href: h.order?.href || "", who: h.who, what: h.kind === "blanks" ? "Our blanks" : "Customer goods", sub: h.supplier === "sanmar" ? "SanMar" : "S&S", so: h.supplier_order, po: h.po, boxes: h.boxes, pcs: h.pcs,
    trks: h.tracking.map((k) => ({ carrier: k.carrier, tracking: k.tracking, delivered: k.delivered, status: k.status, detail: k.detail, freight: k.freight })), statuses: h.tracking.map((k) => k.status),
    at: h.tracking.filter((k) => !k.delivered).map((k) => k.eta).filter(Boolean).sort().pop() || null, deliveredAt: h.tracking.map((k) => k.delivered_at || null).filter(Boolean).sort().pop() || null, need: null, unlinked: !h.order, supplierRaw: h.supplier, shipped: h.ship_date,
    link: h.order ? undefined : { lineIds: h.lineIds, customerId: h.customer_id, customerName: h.customer_id ? h.who : "", us: h.who === "FBS", supplier: h.supplier, name: h.customer_name, account: h.customer_account, suggest: null, styles: h.styles } }));
  // searching filters the whole update (Cowboy Cool → only Cowboy Cool), and adds matches from older manifests
  const term = q.trim().toLowerCase();
  const hay = (r: Row) => [r.who, r.po, r.so, r.sub, r.number ? `#${r.number} ${r.number}` : "", ...r.trks.map((k) => `${k.tracking} ${k.carrier}`)].join(" ");
  const searched: Row[] = term.length >= 2
    ? [...liveRows.filter((r) => fuzzyHas(hay(r), term)), ...hitRows.filter((h) => !rows.some((r) => r.so && r.so === h.so && r.sub === h.sub && r.who === h.who) && !rows.some((r) => r.key === h.key))]
    : liveRows;
  // the FBS orders / Customer supplied goods tabs just narrow the update to our blanks or the customers' goods
  const view_rows: Row[] = view === "fbs" ? searched.filter((r) => r.side === "fbs") : view === "customer" ? searched.filter((r) => r.side === "customer") : searched;
  const byAt = (a: Row, b: Row) => (a.at || "9999").localeCompare(b.at || "9999");
  const L = {
    arrived: view_rows.filter((r) => r.state === "arrived" && localDay(r.deliveredAt) === t0).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || "")),
    // due today, plus S&S truck / freight still not signed for (they never report delivery on their own)
    today: view_rows.filter((r) => r.state !== "arrived" && (localDay(r.at) === t0 || (!!r.at && localDay(r.at) < t0 && r.trks.some((k) => !k.tracking || k.freight)))),
    // here before today and the job hasn't printed yet (printed jobs drop off; anything else can be ignored)
    past: view_rows.filter((r) => r.state === "arrived" && !!r.deliveredAt && localDay(r.deliveredAt) < t0).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || "")),
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
  // a box holding goods for more than one job: say so, and which other job(s) it's for
  const mixBadge = (r: Row, jobs: { number: number; pcs: number; items: string }[]) => {
    const mine = new Set(r.jobs ? r.jobs.map((j) => j.number) : [r.number]);
    const others = jobs.filter((j) => !mine.has(j.number));
    const title = `Mixed box: one box, goods for ${jobs.length} jobs. Split it when you count it.\n` + jobs.map((j) => `${j.number ? `#${j.number}` : "Not linked yet"}: ${j.items}`).join("\n");
    return <span className="rv-mixbox" title={title}>📦 MIXED BOX{others.length ? <> · also {others.map((j) => (j.number ? `#${j.number}` : "unlinked")).join(", ")}</> : null}</span>;
  };
  const rowLine = (r: Row) => (
    <tr key={r.key} className={(r.state === "problem" || r.late ? "prob " : "") + "rv-click"} title="Click to see what's in it: styles, colors and sizes"
      onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,label")) return; setItems(r); }}>
      <td className="co"><b>{r.who}</b>{r.what === "Our blanks" && <span className="rv-tag">our blanks</span>}</td>
      <td>{r.sub || "—"}</td>
      <td className="po" title={r.po}>{r.po || "—"}</td>
      <td className="r">{r.boxes || "—"}</td>
      <td className="r">{r.pcs || "—"}</td>
      <td>{statusPill(r)}{r.trks.some((k) => k.freight) && r.lineIds?.length ? (r.state === "arrived"
        ? null
        : <div style={{ marginTop: 4 }}><button type="button" className="btn sm primary" onClick={() => setFreight(r)}>Freight received</button></div>) : null}</td>
      <td className={r.late ? "bad" : ""}>{r.state === "arrived" ? "" : r.at ? new Date(r.at.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) : "—"}{r.need && r.state !== "arrived" ? <div className="faint" style={{ fontSize: 11.5 }}>need by {day(r.need)}</div> : null}</td>
      <td className="trk"><div>{(open[r.key] ? r.trks : r.parts ? r.trks.filter((k, i) => r.trks.findIndex((x) => x.src === k.src) === i) : r.trks.slice(0, 1)).map((k, i) => k.tracking
        ? k.freight ? <span key={k.tracking}><b style={{ fontFamily: "inherit" }}>{k.carrier}</b><br /><a href={trackingUrl(/r&l/i.test(k.carrier) ? "r&l" : "", k.tracking)} target="_blank" rel="noreferrer">PRO {k.tracking}</a></span>
        : <span key={k.tracking} className="rv-trk1">{k.src && <span className="rv-src">{k.src}</span>}<a href={trackingUrl(k.carrier, k.tracking)} target="_blank" rel="noreferrer" className={unscanned(r, k) ? "noscan" : k.delivered ? "done" : ""} title={unscanned(r, k) ? "Label created, never scanned by the carrier" : ""}>{k.tracking}</a>{k.mixed && mixBadge(r, k.mixed)}</span>
        : <span key={"l" + i} className="faint">{k.carrier === "S&S Activewear" ? "S&S truck" : k.carrier} · no tracking</span>)}
        {r.trks.length > (r.parts ? new Set(r.trks.map((k) => k.src)).size : 1) && <button type="button" className="rv-more" onClick={() => setOpen({ ...open, [r.key]: !open[r.key] })} title={r.trks.map((k) => k.tracking).join("\n")}>{open[r.key] ? "show less" : `+${r.trks.length - (r.parts ? new Set(r.trks.map((k) => k.src)).size : 1)} more`}</button>}</div></td>
      <td className="so">{r.so || "—"}</td>
      <td className="act">{r.unlinked
        ? <><button type="button" className="btn sm" onClick={() => (r.link ? setLinking(r) : setView("resolve"))}>Link order</button>
          {r.link?.sugNo
            ? <button type="button" className="rv-sugc" onClick={() => setLinking(r)} title={r.link.sugHow || ""}>{(r.link.sugHow || "").startsWith("🤖") ? "🤖 " : ""}#{r.link.sugNo}?</button>
            : r.link?.sugCust && !r.link.customerId && !r.link.us && <button type="button" className="rv-sugc" onClick={() => setLinking(r)} title={r.link.sugHow || ""}>{r.link.sugCust.name}?</button>}</>
        : r.jobs ? <span className="rv-mixed" title="A mixed shipment: the same boxes hold goods for each of these jobs. Click the row to see which items go where."><span className="rv-tag rv-mix">mixed</span>{r.jobs.map((j, i) => <span key={j.href}>{i ? " + " : ""}<Link href={j.href} className="rv-linked">#{j.number}</Link></span>)}</span>
        : <Link href={r.href} className="rv-linked" title="Linked to this order">#{r.number}</Link>}
        {r.parts && r.jobKeys && <button type="button" className="rv-ign" onClick={async () => { for (const k of r.jobKeys!) await setSeparated(k, true, `${r.who} #${r.number}`); }} title="These shipments are one row because they're for the same job or share boxes. Show each on its own row; Unlink is there for the one that's wrong.">Uncombine</button>}
        {r.splitOf && <button type="button" className="rv-ign" onClick={async () => { for (const k of r.splitOf!.split("§")) await setSeparated(k, false, `${r.who} #${r.number}`); }} title="Show this job's supplier orders as one row again">Combine</button>}
        {!r.unlinked && !!r.lineIds?.length && !r.parts && <button type="button" className={"rv-ign rv-unl" + (unlinkAsk === r.key ? " ask" : "")} onClick={() => unlink(r)} title="Linked to the wrong job? Unlink it: the goods go back to not linked, and that job is remembered as wrong">{unlinkAsk === r.key ? "Sure? Unlink" : "Unlink"}</button>}
        {!r.key.startsWith("h") && ((r.parts || [r.key]).every((k) => ignored[k])
          ? <button type="button" className="rv-ign on" onClick={() => ignore(r, false)} title="Put it back in the lists">Restore</button>
          : <button type="button" className="rv-ign" onClick={() => ignore(r, true)} title="Ignore this shipment: it leaves every list (find it under Ignored)">Ignore</button>)}</td>
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
    today: { title: "Arriving Today", n: L.today.length, rows: L.today, empty: "Nothing else due today." },
    arrived: { title: "Arrived Today", n: L.arrived.length, rows: L.arrived, empty: "Nothing has arrived yet today." },
    past: { title: "Already Arrived · Not Printed Yet", n: L.past.length, rows: L.past, empty: "Nothing here waiting to print." },
    way: { title: "In Transit", n: L.way.length, rows: L.way, empty: "Nothing on the way." },
    problems: { title: "Delayed / Problems", tone: "bad", n: L.problems.length, rows: L.problems, empty: "No problems." },
  };
  // first look: arriving today, and underneath it what already arrived
  const shown: Focus[] = focus ? [focus] : ["today", "arrived"];
  // SEARCH is different from the filters: it looks at everything (every state, ignored ones and older manifests too)
  // and shows the matches in one list, sorted into where each shipment is. The boxes and tabs then narrow that down.
  const isSearch = term.length >= 2;
  type Bucket = "today" | "arrived" | "problems" | "way" | "past" | "older" | "ignored";
  const BUCKETS: { k: Bucket; title: string }[] = [
    { k: "today", title: "Arriving Today" }, { k: "arrived", title: "Arrived Today" }, { k: "problems", title: "Delayed / Problems" }, { k: "way", title: "In Transit" },
    { k: "past", title: "Already Arrived" }, { k: "older", title: "Older Shipments (linked, printed or done)" }, { k: "ignored", title: "Ignored" },
  ];
  const bucketOf = (r: Row): Bucket => {
    if (ignored[r.key] || r.parts?.every((k) => ignored[k])) return "ignored";
    if (r.key.startsWith("h")) return r.state === "arrived" || !r.trks.length ? "older" : r.state === "problem" ? "problems" : "way";
    if (r.state === "arrived") return localDay(r.deliveredAt) === t0 ? "arrived" : "past";
    if (r.state === "problem" || r.late) return "problems";
    if (localDay(r.at) === t0 || (!!r.at && localDay(r.at) < t0 && r.trks.some((k) => !k.tracking || k.freight))) return "today";
    return "way";
  };
  const searchRows: Row[] = isSearch ? [...view_rows, ...ignoredRows.filter((r) => fuzzyHas(hay(r), term) && (view === "fbs" ? r.side === "fbs" : view === "customer" ? r.side === "customer" : true))] : [];
  const focusBucket: Record<Focus, Bucket[]> = { today: ["today", "arrived"], arrived: ["arrived"], past: ["past", "older"], way: ["way"], problems: ["problems"] };
  const searchShown = searchRows.filter((r) => !focus || focusBucket[focus].includes(bucketOf(r)));

  // FBS pane boxes
  const fbsToday = arriving.filter((a) => a.when === "today" || a.when === "past").length;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Receiving</div><h1>Goods &amp; Receiving</h1></div>

        <div className="rv-head-r"><div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <Link className="btn primary rv-ck" href="/shop/receiving/checkin" title="Count jobs' goods in, size by size">✓ Check-In{ck && (ck.ready + ck.issue) > 0 && <span className="rv-ck-n">{ck.ready ? <i className="rd" title="Jobs on today's schedule (or earlier) with everything here">{ck.ready} ready today</i> : null}{ck.issue ? <i className="pb">{ck.issue} problem{ck.issue === 1 ? "" : "s"}</i> : null}</span>}</Link>
          <button type="button" className="btn" disabled={aiBusy} onClick={(e) => askAi(e.shiftKey)} title="Runs the hourly pass now: refreshes tracking, links exact matches, and has the AI recommend a job for the rest. (Runs on its own every hour, Mon–Fri 6 a.m.–6 p.m.) Shift-click: the AI looks at every shipment again.">{aiBusy ? "Relinking…" : "↻ Attempt to Relink Orders"}</button>
          <button type="button" className="btn" onClick={() => setTruck(true)}>Receive S&amp;S Truck</button>
          <label className="btn" style={{ cursor: "pointer" }}>{upBusy ? "Reading…" : "Import Supplier Manifests"}<input type="file" hidden accept=".xlsx,.csv" multiple onChange={(e) => { const fs = Array.from(e.target.files || []) as File[]; e.target.value = ""; upload(fs); }} /></label>
        </div>
</div>
      </div>
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      <div className="rv-tabrow">
      <div className="aa-sub rv-views" role="tablist">
        <button type="button" className={view === "today" ? "on" : ""} onClick={() => setView("today")}>Today &amp; Overview</button>
        <button type="button" className={view === "fbs" ? "on" : ""} onClick={() => setView("fbs")}>FBS Orders<span className="aa-n">{searched.filter((r) => r.side === "fbs" && r.state !== "arrived").length}</span></button>
        <button type="button" className={view === "customer" ? "on" : ""} onClick={() => setView("customer")}>Customer Supplied Goods<span className="aa-n">{searched.filter((r) => r.side === "customer" && r.state !== "arrived").length}</span></button>
        <button type="button" className={"rv-ign-tab" + (view === "ignored" ? " on" : "")} onClick={() => setView(view === "ignored" ? "today" : "ignored")} title="Shipments ignored by hand">Show Ignored<span className="aa-n">{ignoredRows.length}</span></button>
        {/* Resolution center: hidden from the tabs for now (Link order pop-ups handle linking); still at ?view=resolve */}
      </div>
        <label className="rv-search rv-search-tabs"><span aria-hidden>⌕</span><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every manifest: PO, customer, S&S / SanMar order, tracking, style" aria-label="Search the supplier manifests" /></label>
      </div>

      {SHOW_BOARDS && view === "customer" && <>
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
      {view === "ignored" && (
        <section className="rv-day">
          <div className="rv-day-h"><b>Ignored</b><span className="faint">shipments taken out of the lists by hand. Restore puts one back.</span></div>
          {grouped(ignoredRows, "Nothing ignored.")}
        </section>
      )}
      {(view === "today" || view === "fbs" || view === "customer") && <>

      {/* today's update: arriving today, then what already arrived; the boxes open the other lists */}
      <section className="rv-day">
        <div className="rv-day-h">
          <b>Today&apos;s Update</b>{term.length >= 2 && <span className="rv-filter">Showing “{q.trim()}”{searching ? " …" : ""} <button type="button" className="linkbtn" onClick={() => setQ("")}>Clear</button></span>}<span className="faint">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · tracking and matching run hourly, Mon–Fri 6 a.m.–6 p.m.</span>
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
                ? <div className="rv-kpi2"><div><span>Arriving today</span><b>{isSearch ? searchRows.filter((r) => bucketOf(r) === "today").length : L.today.length}</b></div><div><span>Arrived today</span><b className="okc">{isSearch ? searchRows.filter((r) => bucketOf(r) === "arrived").length : L.arrived.length}</b></div></div>
                : <><span>{k.label}</span><b>{isSearch ? searchRows.filter((r) => focusBucket[k.k].includes(bucketOf(r))).length : k.n}</b></>}
            </button>
          ))}
        </div>
        {isSearch ? (
          <div className="rv-stack">
            <div className="rv-results">{searchShown.length ? <><b>{searchShown.length}</b> shipment{searchShown.length === 1 ? "" : "s"} match “{q.trim()}”</> : <>Nothing matches “{q.trim()}”{searching ? " (still looking in older manifests…)" : ""}</>}
              {focus && <> · only {LISTS[focus].title.toLowerCase()} <button type="button" className="linkbtn" onClick={() => setFocus(null)}>show all</button></>}</div>
            {BUCKETS.map((b) => { const rs = searchShown.filter((r) => bucketOf(r) === b.k); return rs.length ? (
              <div key={b.k} className={"rv-list" + (b.k === "ignored" ? " rv-ign-list" : "")}>
                <h4 className={"rv-sec rv-sec-" + (b.k === "older" ? "past" : b.k === "ignored" ? "way" : b.k)}><span>{b.title}</span><em>{rs.length}</em></h4>
                {grouped(rs, "")}
              </div>
            ) : null; })}
          </div>
        ) : <div className="rv-stack">
          {shown.map((k) => (
            <div key={k} className="rv-list">
              <h4 className={"rv-sec rv-sec-" + k}><span>{LISTS[k].title}</span><em>{LISTS[k].n}</em></h4>
              {grouped(LISTS[k].rows, LISTS[k].empty)}
            </div>
          ))}
        </div>}
      </section>
      </>}

      {SHOW_BOARDS && view === "fbs" && <>
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
      {items && <ItemsModal r={items} onClose={() => setItems(null)} onLink={items.unlinked && items.link ? () => { const r = items; setItems(null); setLinking(r); } : undefined} />}
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
  const [method, setMethod] = useState("40"), [whMode, setWhMode] = useState<"fewest" | "fastest">("fewest");
  const [dry, setDry] = useState<{ orderNumber: string; warehouse: string; total: number; expected: string | null }[] | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [other, setOther] = useState(false);
  const [m, setM] = useState({ supplier: "S&S Activewear", supplier_order: "", expected_date: "", note: "" });
  useEffect(() => { blanksPlan(o.id).then((r) => { if (!r.ok) return setErr(r.error || "Couldn't read the order."); setPlan({ lines: r.lines || [], ss: !!r.ss }); setQty(Object.fromEntries((r.lines || []).map((l) => [l.key, l.qty]))); }); }, [o.id]);
  const lines = plan?.lines || [];
  const orderable = lines.filter((l) => l.found && (qty[l.key] || 0) > 0);
  const total = orderable.reduce((a, l) => a + l.price * (qty[l.key] || 0), 0);
  const payload = () => ({ lines: orderable.map((l) => ({ sku: l.sku, qty: qty[l.key] || 0, price: l.price, label: `${l.brand} ${l.style} ${l.color} ${l.size}`.trim() })), shippingMethod: method, warehouses: whMode });
  async function test() { setBusy("test"); setErr(""); setDry(null); const r = await orderBlanksSS(o.id, { ...payload(), test: true }); setBusy(""); if (!r.ok) return setErr(r.error || "S&S said no."); setDry(r.results || []); }
  const [sure, setSure] = useState(false);
  async function place() { if (!sure) { setSure(true); return; } setSure(false); setBusy("place"); setErr(""); const r = await orderBlanksSS(o.id, { ...payload(), test: false }); setBusy(""); if (!r.ok) return setErr(r.error || "S&S said no."); onDone(`Ordered from S&S for #${o.number}: order ${r.results?.map((x) => x.orderNumber).join(", ")}.`); }
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
                <label className="row" style={{ gap: 6, fontSize: 13 }}>Warehouses<select value={whMode} onChange={(e) => { setWhMode(e.target.value as "fewest" | "fastest"); setDry(null); }} style={{ width: "auto" }}><option value="fewest">Fewest shipments</option><option value="fastest">Fastest (closest first)</option></select></label>
                <label className="row" style={{ gap: 6, fontSize: 13 }}>Ship by<select value={method} onChange={(e) => { setMethod(e.target.value); setDry(null); }} style={{ width: "auto" }}>{SS_METHODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                {lines.some((l) => !l.found) && <span className="bad" style={{ fontSize: 12.5 }}>Lines S&amp;S doesn&apos;t carry aren&apos;t included; order those elsewhere.</span>}
              </div>
              {!plan.ss && <div className="banner">S&amp;S isn&apos;t connected, so ordering here is off. Record an order placed elsewhere instead.</div>}
              {dry && (<>
                <div className="okmsg">Checked (nothing sent to S&amp;S): {dry.map((d) => `${WH[d.warehouse] || d.warehouse || "warehouse"} · ~${money(d.total)}`).join("; ")} · UPS Ground. Place the real order below.</div>
                {dry.some((d) => d.warehouse !== "TX") && <div className="banner">Heads up: part of this ships from outside Fort Worth ({dry.filter((d) => d.warehouse !== "TX").map((d) => WH[d.warehouse] || d.warehouse).join(", ")}), so it&apos;ll take longer.</div>}
              </>)}
              {err && <div className="pv-err">{err}</div>}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" disabled={!plan.ss || !orderable.length || !!busy} onClick={test} title="Where it ships from and what it costs (nothing is ordered)">{busy === "test" ? "Checking…" : "Where does it ship from?"}</button>
                <button type="button" className={"btn " + (sure ? "danger" : "primary")} disabled={!plan.ss || !orderable.length || !!busy} onClick={place} title="Click, then confirm">{busy === "place" ? "Ordering…" : sure ? `Yes, buy from S&S${total ? ` · ~${money(total)}` : ""}` : `Place the order with S&S${total ? ` · ~${money(total)}` : ""}`}</button>
                {sure && <button type="button" className="btn ghost" onClick={() => setSure(false)}>Cancel</button>}
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
  const [cust, setCust] = useState<{ id: string; name: string } | null>(li.customerId ? { id: li.customerId, name: li.customerName || r.who } : li.us && li.sugCust ? li.sugCust : null);
  // why this order: saved with the link, the AI learns from it
  const [why, setWhy] = useState("");
  const [custs, setCusts] = useState<{ id: string; label: string }[]>([]);
  const [who, setWho] = useState("");
  const [orders, setOrders] = useState<{ id: string; number: number; nickname: string; po: string; due_date: string | null; status: string; printavo: boolean; items: string; pcs: number; match: boolean }[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [ask, setAsk] = useState<string | null>(null); // linked; now: make this a rule?
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
      if (li.us) await post({ assign: { lineIds: li.lineIds, orderId: pick, kind: "blanks" }, note: why.trim() });
      else await post({ link: li.lineIds.map((id) => ({ lineId: id, orderId: pick })), note: why.trim() });
      const o = orders?.find((x) => x.id === pick);
      const msg = `Linked ${r.who === "FBS" ? "our blanks" : cust?.name || r.who} (${r.sub} ${r.so}) to ${o?.printavo ? "Printavo " : ""}#${o?.number}.`;
      // the manifest calls them something else (BEETLEJUICE GLOBAL LLC → Purple Stitch): ask to make it a rule
      if (newAccount && li.name) { setAsk(msg); setBusy(false); return; }
      onDone(msg);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Link order" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet lk-sheet">
        <div className="pp-sheet-h"><div><b>Link order</b> <span className="faint" style={{ fontSize: 14 }}>· {r.sub} {r.so}{r.po ? ` · PO ${r.po}` : ""} · {r.boxes} box{r.boxes === 1 ? "" : "es"} · {r.pcs} pcs</span></div><button type="button" className="btn icon ghost" aria-label="Close" disabled={busy} onClick={onClose}>✕</button></div>
        {ask ? (
          <div className="lk-body">
            <div className="okmsg">{ask}</div>
            <div className="lk-rule">
              <b>Create a rule for this customer?</b>
              <p>Every time <b>“{li.name}”</b>{li.account ? <> (account {li.account})</> : null} is on a{li.supplier === "sanmar" ? " SanMar" : li.supplier === "ss" ? "n S&S" : ""} manifest, it&apos;s <b>{cust?.name}</b>. Their shipments will show under {cust?.name} and match {cust?.name}&apos;s orders on their own.</p>
            </div>
            {err && <div className="pv-err">{err}</div>}
            <div className="row" style={{ gap: 8 }}><span className="spacer" />
              <button type="button" className="btn ghost" disabled={busy} onClick={() => onDone(ask)}>No, just this once</button>
              <button type="button" className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true); setErr("");
                const x = await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alias: { supplier: li.supplier, name: li.name, account: li.account, customerId: cust!.id } }) });
                const j = await x.json().catch(() => ({}));
                if (!x.ok || j.error) { setBusy(false); return setErr(j.error || "Couldn't save the rule."); }
                onDone(`${ask} Rule saved: “${li.name}” is ${cust?.name} from now on${j.matched ? ` (${j.matched} more shipment${j.matched === 1 ? "" : "s"} linked)` : ""}.`);
              }}>{busy ? "Saving…" : "Yes, create the rule"}</button>
            </div>
          </div>
        ) : (
        <div className="lk-body">
          {li.styles && <div className="faint" style={{ fontSize: 13 }}>What shipped: {li.styles}</div>}
          <div className="lk-cust">
            {li.sugHow && li.sugNo ? <div className="lk-ai"><b>{li.sugHow.startsWith("🤖") ? "AI guess" : "Our guess"}: #{li.sugNo}</b><p>{li.sugHow.replace(/^🤖 AI( thinks #\d+)?:\s*/, "")}</p></div> : null}
            {!cust && li.sugCust && !li.customerId && !li.us && (
              <div className="lk-guess">
                <b>I think “{li.name}” is {li.sugCust.name}.</b>
                <p>{li.sugHow}</p>
                <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary sm" onClick={() => setCust(li.sugCust!)}>Yes, it&apos;s {li.sugCust.name}</button><span className="faint" style={{ fontSize: 12.5 }}>or find the customer below</span></div>
              </div>
            )}
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
            !orders ? <div className="faint">Loading {cust.name}&apos;s open orders…</div> : !orders.length ? <div className="gb-empty">{cust.name} has no open orders or recent jobs.</div> : (
              <div className="lk-list" role="radiogroup" aria-label="Open orders">
                <div className="faint" style={{ fontSize: 12.5, marginBottom: 2 }}>Select the order these goods are for (completed jobs are at the bottom):</div>
                {orders.map((o) => (
                  <label key={o.id} className={"lk-o" + (pick === o.id ? " on" : "")}>
                    <input type="radio" name="lk" checked={pick === o.id} onChange={() => setPick(o.id)} />
                    <span className="lk-n">#{o.number}</span>
                    <span className="lk-m"><b>{o.nickname || o.po || "Order"}</b>{o.po && o.po !== o.nickname ? <span className="faint"> · PO {o.po}</span> : null}<br /><span className="faint">{o.items || "—"}{o.pcs ? ` · ${o.pcs} pcs` : ""}</span></span>
                    <span className="lk-r">{o.match && <span className="rv-tag lk-match">PO match</span>}{li.suggest === o.id && !o.match && <span className="rv-tag lk-match">{(li.sugHow || "").startsWith("🤖") ? "AI guess" : "our guess"}</span>}{/completed/i.test(o.status) && <span className="rv-tag lk-done">Completed</span>}{o.printavo && <span className="rv-tag">Printavo</span>}<span className="faint">{o.due_date ? `due ${new Date(o.due_date + "T12:00").toLocaleDateString([], { month: "numeric", day: "numeric" })}` : ""}</span></span>
                  </label>
                ))}
              </div>
            )
          )}
          {cust && orders && orders.length > 0 && (
            <label className="lk-why"><span className="faint">Why this order? <i>(optional: the AI learns from it)</i></span>
              <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="e.g. LEHS = Little Elm High School; same Sport Grey 5000 sizes" /></label>
          )}
          {false && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" style={{ width: "auto" }} />Remember: {li.name}{li.account ? ` (account ${li.account})` : ""} is {cust!.name}</label>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8 }}><span className="spacer" /><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !pick} onClick={link}>{busy ? "Linking…" : "Link order"}</button></div>
        </div>
      )}
      </div>
    </div>
  );
}

type ItemLine = { id: string; supplier: string; customer_name: string; customer_po: string; supplier_order: string; tracking: string; box: string; mill: string; style: string; color: string; size: string; qty_ordered: number; qty_shipped: number; kind: string; match_how: string; suggest_how: string; linked_by: string | null; job?: { number: number; nickname: string } | null };
const SIZE_SEQ = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "OS"];
const SIZE_FIX: Record<string, string> = { SM: "S", SMALL: "S", MD: "M", MED: "M", MEDIUM: "M", LG: "L", LARGE: "L", XXL: "2XL", XXXL: "3XL", "2X": "2XL", "3X": "3XL", OSFA: "OS", OTHER: "OS", ADJ: "OS" };
const sz = (z: string) => { const k = z.toUpperCase().replace(/\s+/g, ""); return SIZE_FIX[k] || k; };
const sizeRank = (z: string) => { const i = SIZE_SEQ.indexOf(z); return i < 0 ? 100 : i; };

/** What's actually in a shipment: every style and color with its sizes, straight from the supplier's manifest. */
function ItemsModal({ r, onClose, onLink }: { r: Row; onClose: () => void; onLink?: () => void }) {
  const [lines, setLines] = useState<ItemLine[] | null>(null), [err, setErr] = useState("");
  const [mixed, setMixed] = useState<{ tracking: string; box: string; supplier: string; jobs: { number: number; pcs: number; items: string }[] }[]>([]);
  useEffect(() => {
    const body = r.lineIds?.length ? { lineIds: r.lineIds } : { tracking: r.trks.map((k) => k.tracking).filter(Boolean) };
    fetch("/api/goods/manifest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: body }) })
      .then((x) => x.json()).then((j) => { if (j.error) setErr(j.error); setLines(j.lines || []); setMixed(j.mixed || []); }).catch(() => setErr("Couldn't load the items."));
  }, [r]);
  const ls = lines || [];
  const sizes = [...new Set(ls.map((l) => sz(l.size)))].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  type It = { mill: string; style: string; color: string; got: Record<string, number>; ord: Record<string, number> };
  const itemsOf = (xs: ItemLine[]) => {
    const byItem = new Map<string, It>();
    for (const l of xs) {
      const k = `${l.mill}|${l.style}|${l.color}`;
      const x = byItem.get(k) || { mill: l.mill, style: l.style, color: l.color, got: {}, ord: {} };
      const z = sz(l.size);
      x.got[z] = (x.got[z] || 0) + (l.qty_shipped || 0); x.ord[z] = (x.ord[z] || 0) + (l.qty_ordered || 0);
      byItem.set(k, x);
    }
    return [...byItem.values()].sort((a, b) => `${a.style} ${a.color}`.localeCompare(`${b.style} ${b.color}`));
  };
  // a mixed shipment: one table per job, so it's clear which items in the box go where
  const jobKey = (l: ItemLine) => (l.job ? String(l.job.number) : "");
  const jobNos = [...new Set(ls.map(jobKey))];
  const sections = jobNos.map((k) => ({ k, job: ls.find((l) => jobKey(l) === k)?.job || null, lines: ls.filter((l) => jobKey(l) === k) }))
    .sort((a, b) => (a.job?.number || 1e9) - (b.job?.number || 1e9));
  const isMixed = sections.length > 1;
  const items = itemsOf(ls);
  const tot = (m: Record<string, number>) => Object.values(m).reduce((a, n) => a + n, 0);
  const short = items.some((it) => sizes.some((z) => (it.ord[z] || 0) > (it.got[z] || 0)));
  const how = ls.find((l) => l.match_how)?.match_how || ls.find((l) => l.suggest_how)?.suggest_how || "";
  const pos = [...new Set(ls.map((l) => l.customer_po).filter(Boolean))].join(" / ") || r.po;
  const grid = (its: It[]) => (
    <div className="it-wrap"><table className="it-grid">
      <thead><tr><th>Style</th><th>Color</th>{sizes.map((z) => <th key={z} className="r">{z}</th>)}<th className="r">Total</th></tr></thead>
      <tbody>{its.map((it) => (
        <tr key={`${it.mill}|${it.style}|${it.color}`}>
          <td><b>{it.style}</b>{it.mill ? <div className="faint" style={{ fontSize: 11.5 }}>{it.mill}</div> : null}</td>
          <td>{it.color}</td>
          {sizes.map((z) => { const g = it.got[z] || 0, o = it.ord[z] || 0; return <td key={z} className={"r" + (o > g ? " it-short" : "")} title={o > g ? `ordered ${o}, shipped ${g}` : ""}>{g || (o ? 0 : "")}{o > g ? <sup>/{o}</sup> : null}</td>; })}
          <td className="r"><b>{tot(it.got)}</b></td>
        </tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={2}>Total</td>{sizes.map((z) => <td key={z} className="r">{its.reduce((a, it) => a + (it.got[z] || 0), 0) || ""}</td>)}<td className="r"><b>{its.reduce((a, it) => a + tot(it.got), 0)}</b></td></tr></tfoot>
    </table></div>
  );
  const boxesOf = (xs: ItemLine[]) => [...new Set(xs.map((l) => `${l.supplier === "sanmar" ? "SanMar" : "S&S"} ${l.tracking || "truck"}`))];
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="What's in this shipment" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pp-sheet it-sheet">
        <div className="pp-sheet-h"><div><b>{r.who}</b>{r.jobs ? <> · {r.jobs.map((j, i) => <span key={j.href}>{i ? " + " : ""}<Link href={j.href}>#{j.number}</Link></span>)}</> : r.number ? <> · <Link href={r.href}>#{r.number}</Link></> : null} <span className="faint" style={{ fontSize: 14 }}>· {r.sub} {r.so}{pos ? ` · PO ${pos}` : ""} · {r.boxes} box{r.boxes === 1 ? "" : "es"}</span></div><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="lk-body">
          {mixed.length > 0 && (
            <div className="it-mix">
              <b>📦 Mixed box{mixed.length === 1 ? "" : "es"}: {mixed.length === 1 ? "this box holds" : "these boxes hold"} goods for more than one job. Split {mixed.length === 1 ? "it" : "them"} when you count.</b>
              {mixed.map((m) => (
                <div key={m.tracking} className="it-mix-box">
                  <span className="mono">{m.supplier === "sanmar" ? "SanMar" : m.supplier === "ss" ? "S&S" : m.supplier} {m.tracking}{m.box && m.box !== m.tracking ? ` · box ${m.box}` : ""}</span>
                  {m.jobs.map((j) => <span key={j.number} className="it-mix-job"><b>{j.number ? `#${j.number}` : "Not linked yet"}</b> {j.items}</span>)}
                </div>
              ))}
            </div>
          )}
          {isMixed && !mixed.length && <div className="lk-ai"><b>{sections.filter((x) => x.job).length} jobs in this shipment.</b><p>Each table below is what goes to that job.</p></div>}
          {!lines ? <div className="faint">Loading the manifest…</div> : !items.length ? <div className="gb-empty">{err || "This shipment isn't on a supplier manifest, so there's no style / size breakdown for it."}</div> : isMixed ? (
            sections.map((sec) => (
              <div key={sec.k} className="it-sec">
                <div className="it-sec-h">{sec.job ? <><b>For #{sec.job.number}</b> <span className="faint">{sec.job.nickname}</span></> : <b>Not linked yet</b>}<span className="faint it-boxes">{boxesOf(sec.lines).join(" · ")}</span></div>
                {grid(itemsOf(sec.lines))}
              </div>
            ))
          ) : grid(items)}
          {short && <div className="faint" style={{ fontSize: 12.5 }}><span className="it-short">Red</span> sizes shipped short: shipped / <sup>ordered</sup>.</div>}
          {how && <div className="faint" style={{ fontSize: 12.5 }}>{ls.some((l) => l.match_how) ? "Linked: " : "Guess: "}{how}</div>}
          <div className="row" style={{ gap: 8 }}><span className="spacer" />{onLink && <button type="button" className="btn primary" onClick={onLink}>Link order</button>}<button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>
  );
}
