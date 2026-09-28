"use client";
import { useCallback, useEffect, useState } from "react";
import GoodsBoard from "@/components/GoodsBoard";
import { setGoods, shopGoods, staffAddTracking, staffGoodsInfo } from "@/app/shop/goods-actions";
import { staffMessage } from "@/app/shop/actions";
import type { GoodsItem } from "@/lib/goods";

/** The shop's goods panel for some orders: status, issues, tracking and the goods conversation. */
export default function ShopGoods({ orderIds, customerId, hub, compact, onCount }: { orderIds: string[]; customerId: string | null; hub?: boolean; compact?: boolean; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<GoodsItem[] | null>(null);
  const key = orderIds.join(",");
  const load = useCallback(async () => { const r = await shopGoods(key ? key.split(",") : []); setItems(r.items || []); onCount?.((r.items || []).filter((x) => x.goods.status !== "received").length); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (!items) return <div className="gb-empty">Loading goods…</div>;
  return (
    <GoodsBoard mode="shop" items={items} compact={compact}
      act={{
        changed: load,
        addTracking: (id, t) => staffAddTracking(id, t),
        message: (id, body) => staffMessage(id, body, [], "goods"),
        setStatus: (id, s, i, n) => setGoods(id, s, i, n),
        saveInfo: (id, v) => staffGoodsInfo(id, v),
        chatHref: (id) => (customerId ? `/shop/customers/${customerId}?area=messages&c=${id}:goods` : `/shop/orders/${id}`),
        openChat: hub ? (id) => window.dispatchEvent(new CustomEvent("mh:open", { detail: `${id}:goods` })) : undefined,
      }} />
  );
}
