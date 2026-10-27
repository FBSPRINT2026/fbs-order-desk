"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { goodsWaiting } from "@/app/shop/order-goods/actions";
import { goodsPcs, goodsSizes, type GoodsGarment } from "@/lib/goodsGarments";

/**
 * Create order: goods were already bought for this (Oct 26, Nick: "when I create order later… hey I noticed we placed an
 * order on Thursday for these goods. Are we completing this order and adding in the art… pull in the sizes and what it
 * is"). Yes = the order's garments, colors and sizes are what was bought, nothing asked again; the goods order is linked
 * to the new order and its to-do closed. Saved by Order goods (components/tools/OrderGoodsTool.tsx).
 */
export type GoodsBought = { id: string; activity_id: string | null; supplier_order: string; created_at: string; created_by: string; garments: GoodsGarment[] };

/** "today", "yesterday", "Thursday" (this week), else "Oct 12" */
export function dayWord(iso: string) {
  const tz = "America/Chicago", d = new Date(iso);
  const ymd = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const days = Math.round((Date.parse(ymd(new Date())) - Date.parse(ymd(d))) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "on " + d.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
  return "on " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
}

export default function GoodsBoughtAsk({ list, activityId, onDone, onCancel }: { list: GoodsBought[]; activityId?: string | null; onDone: (id: string | null) => void; onCancel: () => void }) {
  const one = list.length === 1 ? list[0] : null;
  const where = (b: GoodsBought) => (b.activity_id && b.activity_id === activityId ? "from this email" : "for this customer");
  const pcs = (b: GoodsBought) => b.garments.reduce((a, g) => a + goodsPcs(g), 0);
  const what = (b: GoodsBought) => (
    <ul className="gb-list">{b.garments.map((g, i) => (
      <li key={i}><b data-notranslate>{[g.brand, g.style].filter(Boolean).join(" ")} {g.color}</b><span className="gb-n">{goodsPcs(g).toLocaleString("en-US")} pcs</span><small>{goodsSizes(g)}</small></li>
    ))}</ul>
  );
  return (
    <div className="ap gb" role="group" aria-label="Goods already ordered">
      <p className="ap-q">{one ? `We ordered goods ${where(one)} ${dayWord(one.created_at)}.` : `There are ${list.length} goods orders for this customer that aren't on an order yet.`}</p>
      <p className="ap-why">Are we completing {one ? "that order" : "one of them"} now and adding the art? The garments, colors and sizes come from what was bought: nothing to pick again.</p>
      {one ? <>
        <div className="gb-card"><div className="gb-h"><span>S&amp;S #{one.supplier_order}</span><span className="faint gb-n">{pcs(one).toLocaleString("en-US")} pcs</span></div>{what(one)}</div>
        <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>No, read the email</button>
          <button type="button" className="btn primary" onClick={() => onDone(one.id)}>Yes, use these goods</button></div>
      </> : <>
        <div className="ga-opts">{list.map((b, i) => (
          <button key={b.id} type="button" className={"ga-opt gb-opt" + (i === 0 ? " first" : "")} onClick={() => onDone(b.id)}>
            <b>Ordered {dayWord(b.created_at)} · S&amp;S #{b.supplier_order}</b><span>{where(b)} · {pcs(b).toLocaleString("en-US")} pcs</span>{what(b)}
          </button>
        ))}</div>
        <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>None of these: read the email</button></div>
      </>}
    </div>
  );
}

/**
 * The email's tag: goods were ordered from it and there's no order yet (Oct 26, Nick: "you have to tag to that email
 * when you ordered goods… to remind me that I ordered goods"). Gone once Create order uses them.
 */
export function GoodsBoughtTag({ activityId }: { activityId: string }) {
  const [list, setList] = useState<GoodsBought[]>([]);
  useEffect(() => {
    let live = true;
    setList([]);
    void goodsWaiting({ activityId }).then((r) => { if (live && r.ok) setList((r.list as GoodsBought[]).filter((b) => b.activity_id === activityId)); }).catch(() => null);
    return () => { live = false; };
  }, [activityId]);
  if (!list.length) return null;
  const b = list[0];
  return <Link className="eh-tag bought" href="/shop/order-goods" title={`S&S #${b.supplier_order}: ${b.garments.map((g) => `${g.style} ${g.color} (${goodsPcs(g)})`).join(", ")}. Create order on this email uses these goods.`}>Goods ordered {dayWord(b.created_at).replace(/^on /, "")}{list.length > 1 ? ` (+${list.length - 1})` : ""} · no order yet</Link>;
}
