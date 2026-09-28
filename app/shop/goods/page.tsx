"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import GoodsBoard from "@/components/GoodsBoard";
import { createClient } from "@/lib/supabase/client";
import { setGoods, shopGoods, staffAddTracking, staffGoodsInfo } from "@/app/shop/goods-actions";
import { staffMessage } from "@/app/shop/actions";
import { goodsNeedInfo, needsGoods, type GoodsItem } from "@/lib/goods";

type Stage = "info" | "coming" | "counting" | "issue" | "received" | "match";
type MGroup = { key: string; supplier: string; customer_name: string; customer_account: string; customer_po: string; supplier_order: string; ship_date: string | null; boxes: number; pcs: number; methods: string; styles: string; lineIds: string[]; customer: { id: string; name: string } | null; us: boolean };
const STAGES: { k: Stage; label: string; help: string }[] = [
  { k: "info", label: "Waiting on info", help: "No supplier and no tracking yet. The customer is reminded automatically as the in-hands date gets close." },
  { k: "coming", label: "On the way", help: "We know where they're coming from or have tracking. Tracking updates itself; delays and late arrivals alert the customer and you." },
  { k: "counting", label: "Delivered, counting in", help: "At our door (or partly). Count them in against the order." },
  { k: "issue", label: "Issues", help: "Short, over, mispick or damaged. The customer was told in their goods conversation." },
  { k: "received", label: "Received", help: "Counted in and ready to print." },
  { k: "match", label: "Manifest: to match", help: "Shipments on a supplier manifest we couldn't tie to an order automatically. Enter the order # once and it's handled (tracking, customer message, alerts)." },
];
const stageOf = (it: GoodsItem): Stage =>
  it.goods.status === "issue" ? "issue" : it.goods.status === "received" ? "received" : ["arrived", "partial"].includes(it.goods.status) ? "counting" : goodsNeedInfo(it.goods, it.shipments) ? "info" : "coming";

/** Every wholesale job's customer supplied goods, by stage (shop-wide). */
export default function CustomerGoods() {
  const [items, setItems] = useState<GoodsItem[] | null>(null);
  const [tab, setTab] = useState<Stage>("counting");
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [orderCust, setOrderCust] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<MGroup[]>([]);
  const [upBusy, setUpBusy] = useState(false), [upNote, setUpNote] = useState("");
  const loadGroups = useCallback(async () => { const r = await fetch("/api/goods/manifest", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setGroups(j.groups || []); }, []);
  async function upload(f: File) {
    setUpBusy(true); setUpNote("");
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/goods/manifest", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    setUpBusy(false);
    if (!r.ok || j.error) return setUpNote(j.error || "Couldn't read that file.");
    setUpNote(`${j.supplier === "sanmar" ? "SanMar" : "S&S"} manifest: ${j.shipments} shipment${j.shipments === 1 ? "" : "s"} (${j.new} new line${j.new === 1 ? "" : "s"}${j.lines !== j.new ? `, ${j.lines - j.new} already imported` : ""}). ${j.matched} matched to customer goods, ${j.blanks} to our own blanks${j.unmatched ? `, ${j.unmatched} to match by hand` : ""}.`);
    load(); loadGroups();
    if (j.unmatched) setTab("match");
  }
  useEffect(() => { loadGroups(); }, [loadGroups]);
  const load = useCallback(async () => {
    const sb = createClient();
    const { data: os } = await sb.from("orders").select("id, customer_id, price_type, type, status, submitted_at").eq("price_type", "wholesale").neq("status", "completed").limit(500);
    const list = ((os || []) as { id: string; customer_id: string | null; price_type: string; type: string; status: string; submitted_at: string | null }[]).filter(needsGoods);
    setOrderCust(Object.fromEntries(list.map((o) => [o.id, o.customer_id || ""])));
    const cids = [...new Set(list.map((o) => o.customer_id).filter(Boolean))] as string[];
    if (cids.length) { const { data: cs } = await sb.from("customers").select("id, company, name").in("id", cids); setCustomers(Object.fromEntries(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name]))); }
    const r = await shopGoods(list.map((o) => o.id));
    setItems(r.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byStage = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m: Record<Stage, GoodsItem[]> = { info: [], coming: [], counting: [], issue: [], received: [], match: [] };
    for (const it of items || []) {
      const who = customers[orderCust[it.order.id]] || "";
      if (t && ![String(it.order.number), it.order.nickname, who, ...it.shipments.map((s) => s.tracking)].some((x) => x.toLowerCase().includes(t))) continue;
      m[stageOf(it)].push({ ...it, order: { ...it.order, nickname: [who, it.order.nickname].filter(Boolean).join(" · ") } });
    }
    for (const k of Object.keys(m) as Stage[]) m[k].sort((a, b) => (a.order.due_date || "9999").localeCompare(b.order.due_date || "9999"));
    return m;
  }, [items, q, customers, orderCust]);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Wholesale</div><h1>Customer supplied goods</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="aa-search"><input type="search" placeholder="Search order, customer or tracking #" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="btn primary" style={{ cursor: "pointer" }}>{upBusy ? "Reading…" : "Import supplier manifest"}<input type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} /></label>
        </div>
      </div>
      {upNote && <div className="banner" style={{ marginBottom: 10 }}>{upNote}</div>}
      <div className="aa-sub" role="tablist" style={{ marginBottom: 8 }}>
        {STAGES.map((s) => <button key={s.k} type="button" className={tab === s.k ? "on" : ""} onClick={() => setTab(s.k)}>{s.label}<span className="aa-n">{s.k === "match" ? groups.length : items ? byStage[s.k].length : "…"}</span></button>)}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>{STAGES.find((s) => s.k === tab)?.help}</p>
      {tab === "match" ? <MatchList groups={groups} onDone={() => { load(); loadGroups(); }} /> : !items ? <div className="empty">Loading…</div> : (
        <GoodsBoard mode="shop" items={byStage[tab]} empty={q ? `Nothing matches “${q}”.` : "Nothing here right now."}
          act={{
            changed: load,
            addTracking: (id, t) => staffAddTracking(id, t),
            message: (id, body) => staffMessage(id, body, [], "goods"),
            setStatus: (id, s, i, n) => setGoods(id, s, i, n),
            saveInfo: (id, v) => staffGoodsInfo(id, v),
            chatHref: (id) => (orderCust[id] ? `/shop/customers/${orderCust[id]}?area=messages&c=${id}:goods` : `/shop/orders/${id}`),
          }} />
      )}
    </>
  );
}

/** Manifest shipments we couldn't match: type the order # (and whether it's their goods or our blanks). */
function MatchList({ groups, onDone }: { groups: MGroup[]; onDone: () => void }) {
  if (!groups.length) return <div className="gb-empty">Nothing to match. Every shipment on the manifests found its order.</div>;
  return <div className="mm">{groups.map((g) => <MatchRow key={g.key} g={g} onDone={onDone} />)}</div>;
}
function MatchRow({ g, onDone }: { g: MGroup; onDone: () => void }) {
  const [num, setNum] = useState(""), [kind, setKind] = useState<"goods" | "blanks">(g.us ? "blanks" : "goods");
  const [who, setWho] = useState(""), [custs, setCusts] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const sup = g.supplier === "sanmar" ? "SanMar" : "S&S";
  const unknown = !g.us && !g.customer;
  useEffect(() => {
    if (!unknown) return;
    createClient().from("customers").select("id, company, name").order("company").limit(3000)
      .then(({ data }) => setCusts(((data || []) as { id: string; company: string; name: string }[]).map((c) => ({ id: c.id, label: c.company || c.name })).filter((c) => c.label)));
  }, [unknown]);
  async function go(body: unknown) {
    setBusy(true); setErr("");
    const r = await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) return setErr(j.error || "Couldn't save.");
    onDone();
  }
  async function match() {
    const { data } = await createClient().from("orders").select("id").eq("number", +num.replace(/\D/g, "")).maybeSingle();
    if (!data) return setErr(`No order #${num}.`);
    go({ assign: { lineIds: g.lineIds, orderId: data.id, kind } });
  }
  const picked = custs.find((c) => c.label.toLowerCase() === who.trim().toLowerCase());
  return (
    <article className="mm-row">
      <div className="mm-t">
        <b>{g.us ? "FBS (our blanks)" : g.customer_name}{g.customer_account ? <span className="faint" style={{ fontWeight: 400 }}> · {sup} account {g.customer_account}</span> : null}</b>
        {g.customer && <span>Our customer: <b>{g.customer.name}</b></span>}
        <span>PO <b>{g.customer_po || "—"}</b> · {sup} order {g.supplier_order}</span>
        <span className="faint">{g.ship_date ? `Shipped ${new Date(g.ship_date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })} · ` : ""}{g.boxes} box{g.boxes === 1 ? "" : "es"} · {g.pcs} pcs · {g.styles}{g.methods ? ` · ${g.methods}` : ""}</span>
      </div>
      {unknown ? (
        <div className="mm-a mm-who">
          <span className="mm-q">Who is <b>{g.customer_name}</b> in our system?</span>
          <input type="text" list={`mm-c-${g.key}`} placeholder="Type the customer…" value={who} onChange={(e) => setWho(e.target.value)} aria-label={`Which customer is ${g.customer_name}`} />
          <datalist id={`mm-c-${g.key}`}>{custs.map((c) => <option key={c.id} value={c.label} />)}</datalist>
          <button type="button" className="btn primary sm" disabled={busy || !picked} onClick={() => go({ alias: { supplier: g.supplier, name: g.customer_name, account: g.customer_account, customerId: picked!.id } })}>{busy ? "Saving…" : "Remember"}</button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => go({ ignore: g.lineIds })}>Ignore</button>
          <small className="faint">From now on every {sup} shipment from {g.customer_account ? `account ${g.customer_account}` : `“${g.customer_name}”`} goes to that customer.</small>
        </div>
      ) : (
        <div className="mm-a">
          <input type="text" inputMode="numeric" placeholder="Order #" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && num) match(); }} aria-label="Order number" />
          <select value={kind} onChange={(e) => setKind(e.target.value as "goods" | "blanks")} aria-label="What these are"><option value="goods">Customer&apos;s goods</option><option value="blanks">Our blanks</option></select>
          <button type="button" className="btn primary sm" disabled={busy || !num} onClick={match}>{busy ? "Saving…" : "Match"}</button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => go({ ignore: g.lineIds })}>Ignore</button>
        </div>
      )}
      {err && <div className="bad" style={{ fontSize: 12.5 }}>{err}</div>}
    </article>
  );
}
