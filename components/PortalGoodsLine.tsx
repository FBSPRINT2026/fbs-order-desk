"use client";
import { useState } from "react";
import PortalGoods from "@/components/PortalGoods";
import { GOODS, goodsNeedInfo, shipGroups, supplierLabel, trackedGoods, type GoodsItem } from "@/lib/goods";

/**
 * The customer's goods on their order page, small (Nick, Nov 16 2026: "their goods tab is huge… the whole right panel
 * just goes on forever… a better little way to show that small"): one line an order: where the goods are (a dot and the
 * words), who they're coming from, and a thin four-step bar. Add tracking and Details open the full card under it
 * (components/PortalGoods.tsx), so nothing it could do is lost.
 */
const STEP: Record<string, number> = { waiting: 0, on_way: 1, arrived: 2, partial: 2, issue: 2, received: 3 };

export default function PortalGoodsLine({ items, canAct, qs }: { items: GoodsItem[]; canAct: boolean; qs: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel pgl" id="goods">
      <div className="panel-h pgl-h"><h2>Your goods</h2>{canAct && <button type="button" className="linkbtn" onClick={() => setOpen((v) => !v)}>{open ? "Done" : "+ Add tracking"}</button>}</div>
      <div className="panel-b pgl-b">
        {items.map((it) => {
          const status = trackedGoods(it.goods.status, it.shipments), g = GOODS[status], at = STEP[status] ?? 0;
          const need = goodsNeedInfo(it.goods, it.shipments);
          const from = [...new Set(shipGroups(it.shipments).map((x) => x.supplier).filter(Boolean))].join(", ") || supplierLabel(it.goods.supplier) || "";
          return (
            <div key={it.order.id} className="pgl-r">
              <div className="pgl-1"><span className="pgl-dot" style={{ background: g.c }} /><b>{need ? "Tell us where they're coming from" : status === "arrived" ? "Here · we're counting" : g.portal}</b>{from && <span className="faint">· {from}</span>}</div>
              <div className="pgl-bar" aria-label={`Step ${at + 1} of 4`}>{[0, 1, 2, 3].map((i) => <span key={i} className={i < at ? "done" : i === at ? "now" : ""} style={i === at ? { background: g.c } : undefined} />)}</div>
            </div>
          );
        })}
        {!open && <button type="button" className="linkbtn pgl-more" onClick={() => setOpen(true)}>Details</button>}
        {open && <div className="pgl-full"><PortalGoods items={items} canAct={canAct} qs={qs} empty="" /></div>}
      </div>
    </section>
  );
}
