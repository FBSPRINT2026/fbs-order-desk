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
  const bc = code128Svg(shipKey, 40).svg;
  // give the write-in rows as much height as the label allows
  const shipBlock = o.delivery_method !== "pickup" && !!o.ship_to;
  const inboxIn = (shipBlock ? 0.8 : 1) * (size === "letter" ? (rows.length <= 3 ? 0.75 : rows.length <= 5 ? 0.55 : 0.4) : (rows.length <= 2 ? 0.7 : rows.length <= 3 ? 0.55 : rows.length <= 4 ? 0.45 : 0.34));

  return (
    <div className={`labels-page ${size === "letter" ? "sz-letter" : "sz-4x6"}`}>
      <style>{`
        @page { size: ${size === "letter" ? "8.5in 11in" : "4in 6in"}; margin: 0; }
        .labels-page { background: #e9edf2; min-height: 100%; padding-block: 16px 40px; padding-inline: 16px; color: #111; font-family: Helvetica, Arial, sans-serif; }
        .label { background: #fff; margin: 0 auto 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
        .sz-4x6 .label { width: 4in; height: 6in; padding: 0.18in; font-size: 10px; }
        .sz-letter .label { width: 8.5in; height: 5.5in; padding: 0.35in; font-size: 12px; }
        .lb-top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 4px; gap: 6px; }
        .lb-shop { font-size: .95em; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
        .lb-no { font-size: 2.4em; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
        .lb-rush { background: #111; color: #fff; font-weight: 800; padding: 2px 6px; letter-spacing: .12em; font-size: 1.1em; margin-top: 3px; display: inline-block; }
        .lb-cust { font-size: 1.7em; font-weight: 800; line-height: 1.1; }
        .lb-job { font-size: 1.15em; font-weight: 600; }
        .lb-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 10px; font-size: 1em; }
        .lb-meta b { font-weight: 700; }
        .label > * { flex-shrink: 0; }
        .label > .lb-notes { flex-shrink: 1; }
        .lb-ship { display: flex; border: 2px solid #111; border-radius: 3px; overflow: hidden; }
        .lb-ship .tab { background: #111; color: #fff; font-weight: 800; font-size: .8em; letter-spacing: .12em; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; padding: 4px 3px; white-space: nowrap; }
        .lb-ship .addr { padding: 4px 8px; line-height: 1.25; }
        .lb-ship .co { font-size: 1.35em; font-weight: 800; text-transform: uppercase; }
        .lb-ship .attn { font-size: 1em; }
        .lb-ship .lines { font-size: 1.25em; font-weight: 600; white-space: pre-line; text-transform: uppercase; }
        .lb-ship .ph { font-size: .95em; color: #333; }
        .lb-box { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1.5em; }
        .lb-box span.blank { display: inline-block; min-width: 1.6em; border-bottom: 2px solid #111; text-align: center; }
        table.lb { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .lb th, .lb td { border: 1px solid #111; padding: 2px 2px; text-align: center; font-size: 1em; }
        .lb th { background: #111; color: #fff; font-weight: 700; }
        .lb td.item { text-align: left; font-weight: 600; font-size: .92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb tr.ord td { color: #555; font-size: .9em; background: #f2f2f2; }
        .lb tr.ord td.item { color: #111; background: #f2f2f2; }
                .lb tr.inbox td:not(.item):not(.k) { border-width: 1.5px; font-size: 1.3em; }
        .lb td.k { font-size: .7em; letter-spacing: .02em; text-transform: uppercase; color: #555; line-height: 1.1; }
        .lb-bcrow { display: flex; align-items: center; gap: 8px; }
        .lb-bc { flex: none; display: flex; flex-direction: column; align-items: center; }
        .sz-4x6 .lb-bc .bars { width: 2.3in; height: 0.45in; }
        .sz-letter .lb-bc .bars { width: 3in; height: 0.6in; }
        .lb-bc .bars svg { width: 100%; height: 100%; display: block; }
        .lb-bc .hr { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: .2em; font-size: 1.05em; }
        .lb-bcnote { font-size: .8em; color: #555; line-height: 1.25; }
        .lb-notes { flex: 1; min-height: 0.25in; border: 1px dashed #999; padding: 3px 5px; color: #777; font-size: .9em; }
        .lb-foot { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; font-size: .95em; border-top: 1px solid #111; padding-top: 4px; }
        .lb-foot div { border-bottom: 1px solid #111; padding-bottom: 10px; }
        .lb-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 1.05em; }
        @media print {
          .labels-page { background: #fff; padding: 0; }
          .no-print { display: none !important; }
          .label { box-shadow: none; margin: 0; }
          .label.brk { page-break-after: always; break-after: page; }
        }
      `}</style>
      <LabelControls boxes={boxes} size={size} tight={size === "4x6" && rows.length > 6} />
      {Array.from({ length: boxes }, (_, bi) => (
        <div className={"label" + (size === "4x6" || bi % 2 === 1 ? " brk" : "")} key={bi}>
          <div className="lb-top">
            <div>
              <div className="lb-shop">{settings.shop.name}</div>
              <div className="lb-no">#{o.number}</div>
              {o.rush && <div className="lb-rush">RUSH</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="lb-box">BOX <span className="blank">{boxes > 1 ? bi + 1 : ""}</span> OF <span className="blank">{boxes > 1 ? boxes : ""}</span></div>
              <div style={{ fontWeight: 700, fontSize: "1.1em", marginTop: 2 }}>{DELIVERY[o.delivery_method] || "PICKUP"}</div>
            </div>
          </div>
          <div>
            {!shipBlock && <div className="lb-cust">{cust.company || cust.name || "No customer"}</div>}
            {!shipBlock && cust.company && cust.name && <div>{cust.name}{cust.phone ? ` · ${cust.phone}` : ""}</div>}
            <div className="lb-job">{o.nickname || "Untitled job"}</div>
          </div>
          <div className="lb-meta">
            {o.po_number && <div><b>PO:</b> {o.po_number}</div>}
            <div><b>In hands:</b> {o.due_date ? fmtDateLong(o.due_date) : "—"}</div>
            {o.ship_method && <div><b>Via:</b> {o.ship_method}</div>}
            {o.tracking && <div><b>Tracking:</b> {o.tracking}</div>}
          </div>
          <div className="lb-bcrow">
            <div className="lb-bc"><div className="bars" dangerouslySetInnerHTML={{ __html: bc }} /><div className="hr">{shipKey}</div></div>
            <div className="lb-bcnote">Scan into UPS WorldShip or FedEx Ship Manager to pull up this order.</div>
          </div>
          {o.delivery_method !== "pickup" && o.ship_to && (
            <div className="lb-ship">
              <div className="tab">{o.delivery_method === "ship" ? "SHIP TO" : "DELIVER TO"}</div>
              <div className="addr">
                <div className="co">{cust.company || cust.name}</div>
                {cust.company && cust.name && <div className="attn">ATTN: {cust.name}</div>}
                <div className="lines">{o.ship_to.trim()}</div>
                {cust.phone && <div className="ph">{cust.phone}</div>}
              </div>
            </div>
          )}

          <table className="lb">
            <colgroup><col style={{ width: size === "letter" ? "28%" : "25%" }} /><col style={{ width: "2.6em" }} />{used.map((z) => <col key={z} />)}<col style={{ width: "2.6em" }} /></colgroup>
            <thead><tr><th style={{ textAlign: "left" }}>Item</th><th /> {used.map((z) => <th key={z}>{z}</th>)}<th>Tot</th></tr></thead>
            <tbody>
              {rows.map((l) => {
                const tot = used.reduce((a, z) => a + (+(l.sizes?.[z] || 0)), 0);
                const name = [l.style, l.color].filter(Boolean).join(" · ") || l.garment || "Garment";
                return [
                  <tr key={l.id + "o"} className="ord"><td className="item" rowSpan={1} title={name}>{name}</td><td className="k">Ord</td>{used.map((z) => <td key={z}>{l.sizes?.[z] || ""}</td>)}<td><b>{tot}</b></td></tr>,
                  <tr key={l.id + "b"} className="inbox" style={{ height: `${inboxIn}in` }}><td className="item" style={{ fontWeight: 400, fontSize: ".85em", color: "#555" }}>{l.garment}</td><td className="k">In<br />box</td>{used.map((z) => <td key={z}>{l.sizes?.[z] ? "" : "–"}</td>)}<td /></tr>,
                ];
              })}
              {!rows.length && <tr><td colSpan={used.length + 3}>No sizes entered on this order yet.</td></tr>}
            </tbody>
          </table>
          <div className="lb-total"><span>Order total: {totalPcs} pcs</span><span>This box: ______ pcs</span></div>
          <div className="lb-notes">Notes</div>
          <div className="lb-foot"><div>Packed by</div><div>Date</div><div>Checked</div></div>
        </div>
      ))}
    </div>
  );
}
