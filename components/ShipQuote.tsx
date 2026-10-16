"use client";
import { useState } from "react";
import { money } from "@/lib/format";
import { estimateBoxes, type Rate } from "@/lib/shipping";
import type { ShipSettings } from "@/lib/pricing";
import { niceService } from "@/components/ShipWindow";

/**
 * Shipping on the quote/invoice (Oct 16, Nick: "how do we save shipping to an invoice… figure the charge for FedEx or
 * UPS using EasyPost"). Estimates the boxes (Shipping settings: pieces per box, the default box) and their weight from
 * the garments, prices them from our ZIP to the ship-to ZIP through EasyPost (the same rates as the Shipping Center,
 * with our markup and per-box fee), and puts the picked rate on the order as a "Shipping" fee.
 */
const lbEach = (desc: string) => {
  const d = desc.toLowerCase();
  if (/hood|sweat|fleece|crew ?neck sweat|quarter|1\/4|jacket|pullover/.test(d)) return 1.3;
  if (/long sleeve|l\/s|polo|raglan/.test(d)) return 0.6;
  if (/hat|cap|beanie|visor|koozie/.test(d)) return 0.25;
  if (/tote|bag/.test(d)) return 0.5;
  return 0.45; // a tee
};

export default function ShipQuote({ pieces, garments, shipTo, settings, current, onAdd }: {
  pieces: number; garments: { desc: string; qty: number; /** the supplier's weight for this line (lb), when known */ lbs?: number }[]; shipTo: string; settings: ShipSettings;
  /** the order's shipping fee now, if any */ current?: { label: string; amount: number } | null;
  onAdd: (label: string, amount: number, method: string) => void;
}) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const zip = (shipTo.match(/\b(\d{5})(?:-\d{4})?\b(?![\s\S]*\b\d{5}\b)/) || [])[1] || "";
  const nBoxes = estimateBoxes(pieces, settings.perBox);
  const box = settings.boxes.find((b) => b.name === settings.defaultBox) || settings.boxes[0] || { name: "Box", length: 16, width: 13, height: 21 };
  // weight: pieces × weight per piece (estimated from the garment, editable), + 1 lb a box (Oct 16, Nick)
  // the supplier's weights (S&S, by size) when the catalog has them, else an estimate from the kind of garment
  const known = garments.every((g) => !g.qty || g.lbs != null);
  const est = pieces ? garments.reduce((a, g) => a + (g.lbs ?? g.qty * lbEach(g.desc)), 0) / pieces : 0.45;
  const [each, setEach] = useState<string>("");
  const per = +each > 0 ? +each : Math.round(est * 1000) / 1000;
  const perBox = Math.max(1, Math.ceil((pieces * per) / nBoxes + 1)); // carriers bill whole pounds
  const boxes = Array.from({ length: nBoxes }, (_, i) => ({ n: i + 1, length: box.length, width: box.width, height: box.height, weight: perBox }));

  async function get() {
    setBusy(true); setErr(""); setRates(null);
    try {
      const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick: true, to: { zip }, boxes, bill: "fbs" }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      const list = ((j.rates || []) as Rate[]).filter((x) => /ups|fedex|usps/i.test(x.carrier)).sort((a, b) => a.price - b.price);
      setRates(list);
      if (!list.length) setErr("No rates came back for that ZIP.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const name = (r: Rate) => `${r.carrier} ${niceService(r.service)}`;
  const days = (r: Rate) => (r.days ? `${r.days} day${r.days === 1 ? "" : "s"}` : r.deliveryDate ? new Date(r.deliveryDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
  // the usual picks first: cheapest ground of each carrier, then the rest
  const ground = (rates || []).filter((r) => /ground|home|advantage/i.test(r.service));
  const shown = rates ? [...ground.slice(0, 3), ...rates.filter((r) => !ground.slice(0, 3).includes(r))].slice(0, 8) : [];

  return (
    <div className="sq">
      <div className="sq-h">
        <b>Shipping charge</b>
        <span className="faint">{zip ? <>{pieces} pcs × <input type="number" step="0.05" min="0.05" className="sq-w" aria-label="Pounds per piece" placeholder={String(per)} value={each} onChange={(e) => { setEach(e.target.value); setRates(null); }} /> lb{!each && known ? <span className="faint"> (S&amp;S)</span> : null} + 1 lb box = <b>{perBox} lb</b>{nBoxes > 1 ? " a box" : ""} · {nBoxes} {box.name} box{nBoxes === 1 ? "" : "es"} ({box.length}×{box.width}×{box.height}) to {zip}</> : "Add a ship-to address with a ZIP to price it."}</span>
        <button type="button" className="btn sm" disabled={!zip || !pieces || busy} onClick={get}>{busy ? "Getting rates…" : rates ? "Refresh rates" : "Get UPS / FedEx rates"}</button>
      </div>
      {current && <div className="sq-cur">On the invoice: <b>{current.label}</b> · {money(current.amount)}</div>}
      {err && <div className="pv-err">{err}</div>}
      {shown.length > 0 && (
        <div className="sq-list">
          {shown.map((r, i) => (
            <div key={i} className="sq-rate">
              <span className={"sq-car " + r.carrier.toLowerCase()}>{r.carrier}</span>
              <span className="sq-svc">{niceService(r.service)}<small>{days(r)}</small></span>
              <span className="sq-p"><b>{money(r.price)}</b><small>we pay {money(r.cost)}</small></span>
              <button type="button" className="btn sm primary" onClick={() => onAdd(`Shipping · ${name(r)} (${nBoxes} box${nBoxes === 1 ? "" : "es"})`, r.price, name(r))}>Add to invoice</button>
            </div>
          ))}
        </div>
      )}
      {rates && <div className="faint sq-note">Estimated from the order ({settings.perBox} pieces a box). Our price is what we pay + {settings.markupPct}% + {money(settings.perBoxFee)} a box. When it ships, the Shipping Center has the real boxes and weights.</div>}
    </div>
  );
}
