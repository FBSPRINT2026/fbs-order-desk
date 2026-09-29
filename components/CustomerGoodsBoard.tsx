"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import GoodsBoard from "@/components/GoodsBoard";
import { createClient } from "@/lib/supabase/client";
import { setGoods, shopGoods, staffAddTracking, staffGoodsInfo } from "@/app/shop/goods-actions";
import { staffMessage } from "@/app/shop/actions";
import { goodsNeedInfo, needsGoods, type GoodsItem } from "@/lib/goods";
import { ResolveList } from "@/components/IncomingShipments";
import type { PendingShipment } from "@/lib/manifest";
import SearchInput from "@/components/SearchInput";
import { useSticky } from "@/lib/useSticky";

type Stage = "info" | "coming" | "counting" | "issue" | "received" | "match";
const STAGES: { k: Stage; label: string; help: string }[] = [
  { k: "info", label: "Waiting on info", help: "No supplier and no tracking yet. The customer is reminded automatically as the in-hands date gets close." },
  { k: "coming", label: "On the way", help: "We know where they're coming from or have tracking. Tracking updates itself; delays and late arrivals alert the customer and you." },
  { k: "counting", label: "Delivered, counting in", help: "At our door (or partly). Count them in against the order." },
  { k: "issue", label: "Issues", help: "Short, over, mispick or damaged. The customer was told in their goods conversation." },
  { k: "received", label: "Received", help: "Counted in and ready to print." },
  { k: "match", label: "Incoming, not linked", help: "On a supplier manifest for a customer, but not on one of their orders yet. They see these on their portal too and can link them. Exact PO matches link on their own." },
];
const stageOf = (it: GoodsItem): Stage =>
  it.goods.status === "issue" ? "issue" : it.goods.status === "received" ? "received" : ["arrived", "partial"].includes(it.goods.status) ? "counting" : goodsNeedInfo(it.goods, it.shipments) ? "info" : "coming";

/** Every wholesale job's customer supplied goods, by stage (shop-wide). Lives in Goods & receiving. */
export default function CustomerGoodsBoard({ pending, onPending, refreshKey }: { pending: PendingShipment[]; onPending: () => void; refreshKey: number }) {
  const [items, setItems] = useState<GoodsItem[] | null>(null);
  const [tab, setTab] = useSticky<Stage>("goods.stage", "counting");
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [orderCust, setOrderCust] = useState<Record<string, string>>({});
  const groups = pending.filter((g) => !g.us && g.customer);
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
  useEffect(() => { load(); }, [load, refreshKey]);

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
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <label className="aa-search"><SearchInput placeholder="Search order, customer or tracking #" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="aa-sub" role="tablist" style={{ marginBottom: 8 }}>
        {STAGES.map((s) => <button key={s.k} type="button" className={tab === s.k ? "on" : ""} onClick={() => setTab(s.k)}>{s.label}<span className="aa-n">{s.k === "match" ? groups.length : items ? byStage[s.k].length : "…"}</span></button>)}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>{STAGES.find((s) => s.k === tab)?.help}</p>
      {tab === "match" ? <ResolveList list={groups} onDone={() => { load(); onPending(); }} empty="Every customer shipment on the manifests is on its order." /> : !items ? <div className="empty">Loading…</div> : (
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

