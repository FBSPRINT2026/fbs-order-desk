import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, orderGroups, SIZES, type Customer, type Order } from "@/lib/pricing";
import { fmtDateLong } from "@/lib/format";
import LabelControls from "./LabelControls";
import { code128Svg } from "@/lib/barcode";

export const dynamic = "force-dynamic";

const DELIVERY: Record<string, string> = { pickup: "PICKUP", ship: "SHIP", deliver: "DELIVER" };

// Box labels for packing: every garment and size ordered, with blank "in this box" cells to fill in by hand.
export default async function LabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ boxes?: string; size?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/${id}/labels`);
  if (!isStaff) notFound();
  const admin = createAdminClient();
  const { data: od } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  const [{ data: cu }, { data: s }] = await Promise.all([
    admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const settings = mergeSettings(s?.data);
  const cust = (cu || {}) as Partial<Customer>;
  const c = calcOrder(o, settings);
  const boxes = Math.min(50, Math.max(1, parseInt(sp.boxes || "1", 10) || 1));
  const size = sp.size === "letter" ? "letter" : "4x6";

  // every garment row in the order, with only the sizes actually used
  const rows = orderGroups(o).flatMap((g) => g.lines.filter((l) => SIZES.some((z) => l.sizes?.[z])));
  const used = SIZES.filter((z) => rows.some((l) => l.sizes?.[z]));
  const totalPcs = c.qty;
  // Shipping barcode: the order number, used as the lookup key for WorldShip Keyed Import / FedEx Ship Manager.
  const shipKey = String(o.number);
  const bc = code128Svg(shipKey, 30).svg;
  const shipBlock = o.delivery_method !== "pickup" && !!o.ship_to;
  const rowMin = size === "letter" ? 0.3 : 0.22; // minimum row height; rows grow to fill the label
  const sizeTotals: Partial<Record<string, number>> = {};
  rows.forEach((l) => used.forEach((z) => { sizeTotals[z] = (sizeTotals[z] || 0) + (+(l.sizes?.[z] || 0)); }));

  return (
    <div className={`labels-page ${size === "letter" ? "sz-letter" : "sz-4x6"}`}>
      <style>{`
        @page { size: ${size === "letter" ? "8.5in 11in" : "4in 6in"}; margin: 0; }
        .labels-page { background: #e9edf2; min-height: 100%; padding-block: 16px 40px; padding-inline: 16px; color: #111; font-family: Helvetica, Arial, sans-serif; }
        .label { background: #fff; margin: 0 auto 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
        .sz-4x6 .label { width: 4in; height: 6in; padding: 0.18in; font-size: 10px; }
        .sz-letter .label { width: 8.5in; height: 5.5in; padding: 0.35in; font-size: 12px; }
        .lb-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 3px; gap: 6px; }
        .lb-idrow { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .lb-dm { font-weight: 700; font-size: .95em; }
        .lb-info { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .lb-infotext { min-width: 0; flex: 1; }
        .lb-shop { font-size: .8em; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #555; }
        .lb-no { font-size: 1.9em; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
        .lb-rush { background: #111; color: #fff; font-weight: 800; padding: 1px 5px; letter-spacing: .1em; font-size: .95em; }
        .lb-cust { font-size: 1.35em; font-weight: 800; line-height: 1.1; }
        .lb-job { font-size: 1.1em; font-weight: 700; line-height: 1.2; }
        .lb-meta { font-size: .9em; color: #333; }
        .lb-meta b { font-weight: 700; }
        .label > * { flex-shrink: 0; }
        .lb-ship { display: flex; border: 1.5px solid #111; border-radius: 3px; overflow: hidden; }
        .lb-ship .tab { background: #111; color: #fff; font-weight: 800; font-size: .8em; letter-spacing: .12em; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; padding: 2px 1px; white-space: nowrap; font-size: .65em; }
        .lb-ship .addr { padding: 2px 6px; line-height: 1.15; }
        .lb-ship .co { font-size: 1.1em; font-weight: 800; text-transform: uppercase; }
        .lb-ship .attn { font-size: .9em; color: #333; }
        .lb-ship .lines { font-size: 1.05em; font-weight: 600; white-space: pre-line; text-transform: uppercase; }
        .lb-box { display: flex; align-items: center; gap: 5px; font-weight: 800; font-size: 1.2em; }
        .lb-box span.blank { display: inline-block; min-width: 1.6em; border-bottom: 2px solid #111; text-align: center; }
        table.lb { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .lb th, .lb td { border: 1px solid #111; padding: 2px 2px; text-align: center; font-size: 1em; }
        .lb th { background: #111; color: #fff; font-weight: 700; }
        .lb-grid { flex: 1 1 auto !important; display: grid; border: 1.5px solid #111; min-height: 0; }
        .lb-grid > div { border-right: 1px solid #111; border-bottom: 1px solid #111; min-width: 0; }
        .lb-grid .h { background: #111; color: #fff; font-weight: 700; padding: 2px 0; text-align: center; border-color: #444; }
        .lb-grid .h.l { text-align: left; padding-left: 4px; }
        .lb-grid .it { font-size: .88em; padding: 2px 4px; display: flex; align-items: center; overflow: hidden; line-height: 1.1; overflow-wrap: anywhere; }
        .lb-grid .it .clr { font-weight: 500; }
        .lb-grid .c { position: relative; }
        .lb-grid .c .o { position: absolute; top: 1px; left: 2px; font-size: .72em; color: #666; line-height: 1; }
        .lb-grid .c.na { background: repeating-linear-gradient(135deg, #fff 0 3px, #d6d6d6 3px 4px); }
        .lb-key { display: flex; justify-content: space-between; gap: 8px; font-size: .78em; color: #444; }
        .lb-sect { font-size: .75em; font-weight: 800; letter-spacing: .08em; color: #333; margin-top: 2px; }
        .lb-items { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; }
        .sz-letter .lb-items { grid-template-columns: 1fr 1fr 1fr; }
        .lb-item { display: flex; align-items: center; gap: 5px; font-size: .95em; min-width: 0; }
        .lb-item .cb { flex: none; width: 1.15em; height: 1.15em; border: 1.5px solid #111; border-radius: 2px; }
        .lb-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-item .ds { color: #555; font-size: .9em; }
        .lb-item .q { flex: none; font-weight: 700; color: #555; font-size: .9em; }
        .lb td.item { text-align: left; font-weight: 600; font-size: .92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb tr.ord td { color: #555; font-size: .9em; background: #f2f2f2; }
        .lb tr.ord td.item { color: #111; background: #f2f2f2; }
                .lb tr.inbox td:not(.k) { border-width: 1.5px; }
        .lb td.k { font-size: .72em; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: #555; line-height: 1.1; }
        .lb-bc { flex: none; display: flex; flex-direction: column; align-items: center; }
        .sz-4x6 .lb-bc .bars { width: 1.5in; height: 0.32in; }
        .sz-letter .lb-bc .bars { width: 1.9in; height: 0.42in; }
        .lb-bc .bars svg { width: 100%; height: 100%; display: block; }
        .lb-bc .hr { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: .15em; font-size: .85em; line-height: 1; }
        .lb-foot { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; font-size: .95em; border-top: 1px solid #111; padding-top: 4px; }
        .lb-foot div { border-bottom: 1px solid #111; padding-bottom: 10px; }
        .lb-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 1.05em; }
        @media print {
          .labels-page { background: #fff; padding: 0; }
          .no-print { display: none !important; }
          .label { box-shadow: none; margin: 0; }
          .label.brk { page-break-after: always; break-after: page; }
        }
      `}</style>
      <LabelControls boxes={boxes} size={size} tight={size === "4x6" && rows.length > 10} />
      {Array.from({ length: boxes }, (_, bi) => (
        <div className={"label" + (size === "4x6" || bi % 2 === 1 ? " brk" : "")} key={bi}>
          <div className="lb-top">
            <div className="lb-idrow">
              <span className="lb-no">#{o.number}</span>
              {o.rush && <span className="lb-rush">RUSH</span>}
              <span className="lb-shop">{settings.shop.name}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="lb-box">BOX <span className="blank">{boxes > 1 ? bi + 1 : ""}</span> OF <span className="blank">{boxes > 1 ? boxes : ""}</span></div>
              <div className="lb-dm">{DELIVERY[o.delivery_method] || "PICKUP"}</div>
            </div>
          </div>
          <div className="lb-info">
            <div className="lb-infotext">
              {!shipBlock && <div className="lb-cust">{cust.company || cust.name || "No customer"}</div>}
              {!shipBlock && cust.company && cust.name && <div>{cust.name}{cust.phone ? ` · ${cust.phone}` : ""}</div>}
              <div className="lb-job">{o.nickname || "Untitled job"}</div>
              <div className="lb-meta">
                {[o.po_number ? `PO ${o.po_number}` : "", o.due_date ? `In hands ${fmtDateLong(o.due_date)}` : "", o.ship_method || "", o.tracking ? `Trk ${o.tracking}` : ""].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="lb-bc"><div className="bars" dangerouslySetInnerHTML={{ __html: bc }} /><div className="hr">{shipKey}</div></div>
          </div>
          {o.delivery_method !== "pickup" && o.ship_to && (
            <div className="lb-ship">
              <div className="tab">{o.delivery_method === "ship" ? "SHIP TO" : "DELIVER TO"}</div>
              <div className="addr">
                <div className="co">{cust.company || cust.name}</div>
                <div className="lines">{o.ship_to.trim()}</div>
                {(cust.company && cust.name) || cust.phone ? <div className="attn">{[cust.company && cust.name ? `ATTN: ${cust.name}` : "", cust.phone || ""].filter(Boolean).join(" · ")}</div> : null}
              </div>
            </div>
          )}

          <div className="lb-grid" style={{ gridTemplateColumns: `minmax(0, 1.9fr) repeat(${Math.max(used.length, 1)}, minmax(0, 1fr)) minmax(0, 1.1fr)`, gridTemplateRows: `auto repeat(${Math.max(rows.length, 1)}, minmax(${rowMin}in, 1fr))` }}>
            <div className="h l">Item</div>{used.map((z) => <div key={z} className="h">{z}</div>)}<div className="h">Total</div>
            {rows.map((l) => {
              const tot = used.reduce((a, z) => a + (+(l.sizes?.[z] || 0)), 0);
              return [
                <div key={l.id + "n"} className="it"><span><b>{l.style || l.garment || "Garment"}</b>{l.color ? <><br /><span className="clr">{l.color}</span></> : null}</span></div>,
                ...used.map((z) => (l.sizes?.[z]
                  ? <div key={l.id + z} className="c"><span className="o">{l.sizes[z]}</span></div>
                  : <div key={l.id + z} className="c na" />)),
                <div key={l.id + "t"} className="c"><span className="o"><b>{tot}</b></span></div>,
              ];
            })}
            {!rows.length && <div className="it" style={{ gridColumn: "1 / -1" }}>No garments entered on this order yet.</div>}
          </div>
          <div className="lb-key"><span>Small number = ordered. Write the count in this box in the space.</span><span>Order total: <b>{totalPcs}</b> pcs</span></div>
          <div className="lb-foot"><div>Packed by</div><div>Date</div><div>Checked</div></div>
        </div>
      ))}
    </div>
  );
}
