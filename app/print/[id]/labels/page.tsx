import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADULT_SIZES, calcOrder, mergeSettings, ONE_SIZE, orderGroups, sizeLabel, SIZES, YOUTH_SIZES, type Customer, type GLine, type Order } from "@/lib/pricing";
import { fmtDateLong } from "@/lib/format";
import LabelControls from "./LabelControls";
import { code128Svg } from "@/lib/barcode";

export const dynamic = "force-dynamic";


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
  // Youth and adult garments get their own stacked sections so columns stay wide enough to write in.
  const bandOf = (name: string, list: readonly string[]) => {
    const bandRows = rows.filter((l) => list.some((z) => l.sizes?.[z as keyof GLine["sizes"]]));
    return { name, rows: bandRows, sizes: list.filter((z) => bandRows.some((l) => l.sizes?.[z as keyof GLine["sizes"]])) };
  };
  const bands = [bandOf("YOUTH", YOUTH_SIZES), bandOf("ADULT", ADULT_SIZES), bandOf("ONE SIZE", [ONE_SIZE])].filter((b) => b.rows.length);
  const totalPcs = c.qty;
  // Shipping barcode: the order number, used as the lookup key for WorldShip Keyed Import / FedEx Ship Manager.
  const shipKey = String(o.number);
  const bcOut = code128Svg(shipKey, 30, { quietRight: 0 }); // the label margin is the quiet zone on the right, so the bars line up with the edge
  const bc = bcOut.svg;
  // 4 printer dots per bar module at 203 dpi (Zebra) so bars print crisp; wider on letter printers
  const bcWidthIn = (bcOut.width * (size === "letter" ? 5 : 4)) / 203;
  const shipBlock = o.delivery_method !== "pickup" && !!o.ship_to;
  const rowMin = size === "letter" ? 0.3 : 0.22; // minimum row height; rows grow to fill the label
  const sizeTotals: Partial<Record<string, number>> = {};
  rows.forEach((l) => used.forEach((z) => { sizeTotals[z] = (sizeTotals[z] || 0) + (+(l.sizes?.[z] || 0)); }));

  return (
    <div className={`labels-page ${size === "letter" ? "sz-letter" : "sz-4x6"}`}>
      <style>{`
        @page { size: ${size === "letter" ? "8.5in 11in" : "4in 6in"}; margin: 0; }
        .labels-page { background: #e9edf2; min-height: 100%; padding-block: 16px 40px; padding-inline: 16px; color: #000; font-family: Helvetica, Arial, sans-serif; }
        .label { background: #fff; margin: 0 auto 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
        .sz-4x6 .label { width: 4in; height: 6in; padding: 0.16in; font-size: 11px; }
        .sz-letter .label { width: 8.5in; height: 5.5in; padding: 0.35in; font-size: 12px; }
        .lb-top { display: grid; grid-template-columns: auto 1fr auto; align-items: center; border-bottom: 2px solid #000; padding-bottom: 3px; gap: 6px; }
        .lb-mid { text-align: center; }
        .lb-rushtag { margin-left: 5px; border: 1.5px solid #000; padding: 0 3px; font-weight: 800; }
        .lb-top .lb-rush { font-size: 1.3em; padding: 2px 8px; }
        .lb-shiprow { display: flex; gap: 6px; align-items: stretch; }
        .lb-shiprow .lb-ship { flex: 1 1 auto; min-width: 0; }
        .lb-side { flex: 0 0 31%; border: 1.5px solid #000; border-radius: 3px; padding: 3px 5px; display: flex; flex-direction: column; justify-content: center; gap: 3px; line-height: 1.1; }
        .lb-side > div { display: flex; flex-direction: column; }
        .lb-side .k { font-size: .72em; font-weight: 800; letter-spacing: .08em; }
        .lb-side b { font-size: .98em; overflow-wrap: anywhere; }
        .lb-side b.trk { font-size: .85em; }
        .lb-idrow { display: flex; flex-direction: column; line-height: 1; gap: 1px; }
        .lb-dm { font-weight: 700; font-size: .95em; }
        .lb-info { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .lb-infotext { min-width: 0; flex: 1; }
        .lb-shop { font-size: .95em; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
        .lb-no { font-size: 1.8em; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
        .lb-rush { background: #000; color: #fff; font-weight: 800; padding: 1px 5px; letter-spacing: .1em; font-size: .95em; }
        .lb-cust { font-size: 1.35em; font-weight: 800; line-height: 1.1; }
        .lb-job { font-size: 1.1em; font-weight: 700; line-height: 1.2; }
        .lb-meta { font-size: 1em; font-weight: 600; }
        .lb-meta b { font-weight: 700; }
        .label > * { flex-shrink: 0; }
        .lb-ship { display: flex; border: 1.5px solid #000; border-radius: 3px; overflow: hidden; }
        .lb-ship .tab { background: #000; color: #fff; font-weight: 800; font-size: .8em; letter-spacing: .12em; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; padding: 2px 1px; white-space: nowrap; font-size: .8em; }
        .lb-ship .addr { padding: 3px 6px; line-height: 1.2; font-size: .9em; font-weight: 700; text-transform: uppercase; }
        .lb-ship .co, .lb-ship .attn, .lb-ship .lines { font-size: 1em; font-weight: 700; }
        .lb-ship .lines { white-space: pre-line; }
        .lb-box { display: inline-flex; align-items: flex-end; gap: 5px; font-weight: 800; font-size: 1.6em; line-height: 1; white-space: nowrap; }
        .lb-box span.blank { display: inline-block; min-width: 1.9em; height: 1em; border-bottom: 2px solid #000; text-align: center; }
        table.lb { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .lb th, .lb td { border: 1px solid #000; padding: 2px 2px; text-align: center; font-size: 1em; }
        .lb th { background: #000; color: #fff; font-weight: 700; }
        .lb-band { flex-shrink: 1 !important; flex-basis: auto !important; display: flex; flex-direction: row; min-height: 0; }
        .lb-band .lb-grid { flex: 1 1 auto !important; min-width: 0; }
        .lb-band.tabbed .lb-grid { border-left-width: 0; border-radius: 0; }
        .lb-bandtab { flex: none; background: #000; color: #fff; font-weight: 800; font-size: .8em; letter-spacing: .12em; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; padding: 2px 1px; white-space: nowrap; border-radius: 0 3px 3px 0; }
        .lb-grid { flex: 1 1 auto !important; display: grid; border: 2px solid #000; min-height: 0; }
        .lb-grid > div { border-right: 1.5px solid #000; border-bottom: 1.5px solid #000; min-width: 0; }
        .lb-grid .h { background: #000; color: #fff; font-weight: 800; padding: 2px 0; text-align: center; border-color: #fff; border-right-width: 1px; }
        .lb-grid .h.l { text-align: left; padding-left: 4px; }
        .lb-grid .it { font-size: .88em; padding: 1px 3px; display: flex; flex-direction: column; justify-content: center; overflow: hidden; line-height: 1.1; }
        .lb-grid .it > * { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
        .lb-grid .it .clr { font-weight: 600; }
        .lb-grid .c { position: relative; }
        .lb-grid .c .o { position: absolute; top: 1px; left: 2px; font-size: .85em; font-weight: 700; line-height: 1; }
        .lb-grid .c.na { display: flex; align-items: center; justify-content: center; }
        .lb-grid .c.na::after { content: ""; width: 55%; height: 2px; background: #000; }
        .lb-key { display: flex; justify-content: space-between; gap: 8px; font-size: .9em; font-weight: 600; }
        .lb-sect { font-size: .75em; font-weight: 800; letter-spacing: .08em;  margin-top: 2px; }
        .lb-items { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; }
        .sz-letter .lb-items { grid-template-columns: 1fr 1fr 1fr; }
        .lb-item { display: flex; align-items: center; gap: 5px; font-size: .95em; min-width: 0; }
        .lb-item .cb { flex: none; width: 1.15em; height: 1.15em; border: 1.5px solid #000; border-radius: 2px; }
        .lb-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-item .ds {  font-size: .9em; }
        .lb-item .q { flex: none; font-weight: 700;  font-size: .9em; }
        .lb td.item { text-align: left; font-weight: 600; font-size: .92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb tr.ord td {  font-size: .9em;  }
        .lb tr.ord td.item { color: #000;  }
                .lb tr.inbox td:not(.k) { border-width: 1.5px; }
        .lb td.k { font-size: .72em; font-weight: 700; letter-spacing: .02em; text-transform: uppercase;  line-height: 1.1; }
        .lb-bc { flex: none; margin-left: auto; display: flex; justify-content: flex-end; }
        .sz-4x6 .lb-bc .bars { height: 0.3in; }
        .sz-letter .lb-bc .bars { height: 0.45in; }
        .lb-bc .bars svg { width: 100%; height: 100%; display: block; }
        .lb-bc .hr { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: .15em; font-size: 1em; line-height: 1.1; }
        .lb-foot { margin-top: auto; display: grid; grid-template-columns: 1.4fr 1fr; font-size: .95em; border: 1.5px solid #000; border-radius: 3px; }
        .lb-foot > div { padding: 2px 6px; min-height: 0.26in; font-weight: 700; font-size: .9em; }
        .lb-foot > div + div { border-left: 1.5px solid #000; }
        .lb-foot .ty { display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 800; font-size: 1.15em; letter-spacing: .04em; }
        .lb-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 1.05em; }
        @media print {
          .labels-page { background: #fff; padding: 0; }
          .no-print { display: none !important; }
          .label { box-shadow: none; margin: 0; }
          .label.brk { page-break-after: always; break-after: page; }
        }
      `}</style>
      <LabelControls boxes={boxes} size={size} tight={size === "4x6" && (rows.length > 10 || (bands.length > 1 && rows.length > 8))} />
      {Array.from({ length: boxes }, (_, bi) => (
        <div className={"label" + (size === "4x6" || bi % 2 === 1 ? " brk" : "")} key={bi}>
          <div className="lb-top">
            <div className="lb-idrow">
              <span className="lb-no">#{o.number}</span>
              <span className="lb-shop">{settings.shop.name}{o.rush ? <span className="lb-rushtag">RUSH</span> : null}</span>
            </div>
            <div className="lb-mid"><span className="lb-rush">{o.delivery_method === "ship" ? "SHIP" : o.delivery_method === "deliver" ? "DELIVERY" : "PICKUP"}</span></div>
            <div style={{ textAlign: "right" }}>
              <div className="lb-box">BOX <span className="blank" /> OF <span className="blank" /></div>
            </div>
          </div>
          <div className="lb-info">
            <div className="lb-infotext"><div className="lb-job">{o.nickname || "Untitled job"}</div>{o.po_number && <div className="lb-meta">PO {o.po_number}</div>}</div>
            <div className="lb-bc"><div className="bars" style={{ width: `${bcWidthIn}in` }} dangerouslySetInnerHTML={{ __html: bc }} /></div>
          </div>
          <div className="lb-shiprow">
            {shipBlock ? (
              <div className="lb-ship">
                <div className="tab">{o.delivery_method === "ship" ? "SHIP TO" : "DELIVER TO"}</div>
                <div className="addr">
                  <div className="co">{cust.company || cust.name}</div>
                  {cust.company && cust.name ? <div className="attn">ATTN: {cust.name}</div> : null}
                  <div className="lines">{o.ship_to.trim()}</div>
                </div>
              </div>
            ) : (
              <div className="lb-ship">
                <div className="tab">CUSTOMER</div>
                <div className="addr">
                  <div className="co">{cust.company || cust.name || "No customer"}</div>
                  {cust.company && cust.name && <div className="attn">{cust.name}</div>}
                  {cust.phone && <div className="attn">{cust.phone}</div>}
                </div>
              </div>
            )}
            <div className="lb-side">
              <div><span className="k">IN HANDS</span><b>{o.due_date ? fmtDateLong(o.due_date) : "—"}</b></div>
              {o.delivery_method === "ship" && <div><span className="k">SHIP VIA</span><b>{o.ship_method?.trim() || "—"}</b></div>}
              {o.tracking && <div><span className="k">TRACKING</span><b className="trk">{o.tracking}</b></div>}
            </div>
          </div>

          {bands.map((band) => { const os = band.name === "ONE SIZE"; return (
            <div key={band.name} className={"lb-band" + (bands.length > 1 ? " tabbed" : "")} style={{ flexGrow: band.rows.length }}>
              {bands.length > 1 && <div className="lb-bandtab">{band.name}</div>}
              <div className="lb-grid" style={{ gridTemplateColumns: os ? "minmax(0, 1.6fr) minmax(0, 2.4fr)" : `minmax(0, 1.6fr) repeat(${Math.max(band.sizes.length, 1)}, minmax(0, 1fr)) minmax(0, 1.1fr)`, gridTemplateRows: `auto repeat(${Math.max(band.rows.length, 1)}, minmax(${rowMin}in, 1fr))` }}>
                <div className="h l">Item</div>{band.sizes.map((z) => <div key={z} className="h">{sizeLabel(z)}</div>)}{!os && <div className="h">Total</div>}
                {band.rows.map((l) => {
                  const tot = band.sizes.reduce((a, z) => a + (+(l.sizes?.[z as keyof GLine["sizes"]] || 0)), 0);
                  return [
                    <div key={l.id + "n"} className="it"><b>{l.style || l.garment || "Garment"}</b>{l.color ? <span className="clr">{l.color}</span> : null}</div>,
                    ...band.sizes.map((z) => {
                      const q = l.sizes?.[z as keyof GLine["sizes"]];
                      return q ? <div key={l.id + z} className="c"><span className="o">{q}</span></div> : <div key={l.id + z} className="c na" />;
                    }),
                    ...(os ? [] : [<div key={l.id + "t"} className="c"><span className="o">{tot}</span></div>]),
                  ];
                })}
              </div>
            </div>
          ); })}
          {!rows.length && <div className="lb-key">No garments entered on this order yet.</div>}
          <div className="lb-key"><span>Small # = qty ordered</span><span>Order total: {totalPcs} pcs</span></div>
          <div className="lb-foot"><div>Packed by</div><div className="ty">THANK YOU!</div></div>
        </div>
      ))}
    </div>
  );
}
