"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { carrierOf, SUPPLIERS } from "@/lib/goods";
import { portalAttachUrl } from "@/app/portal/message-actions";
import { readShipmentPaper } from "@/app/portal/goods-actions";

export type GoodsInfoValue = { supplier: string; supplier_po: string; ship_date: string | null; /** tracking numbers they pasted or we read (saved as shipments) */ tracking?: string[] };

/** every tracking number in pasted words (UPS, FedEx, USPS, DHL by their shape) */
export function trackingIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text || "").toUpperCase().matchAll(/\b(1Z[0-9A-Z]{16}|[A-Z]{2}\d{9}US|\d[\d ]{9,33}\d)\b/g)) {
    const t = m[1].replace(/\s+/g, "");
    if (carrierOf(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Where a wholesale order's goods are coming from: SanMar, S&S Activewear, another supplier, or not known yet,
 * plus the supplier order # and when it ships. All optional.
 */
export default function GoodsInfoFields({ v, onChange, disabled, withTracking }: { v: GoodsInfoValue; onChange: (v: GoodsInfoValue) => void; disabled?: boolean;
  /** the customer's simple order form: tracking numbers, and a dropped order confirmation or shipping email read into the
   *  fields (Nov 5, Nick: "supplier's name, supplier's order number, and then put tracking… or you can drag and drop
   *  order confirmation in there too… from Peter Millar") */ withTracking?: boolean }) {
  const known = v.supplier === "" || v.supplier in SUPPLIERS;
  const other = !known || v.supplier === "__other";
  const [paste, setPaste] = useState(""), [reading, setReading] = useState(""), [note, setNote] = useState(""), [over, setOver] = useState(false);
  const tracks = v.tracking || [];
  const addTracks = (list: string[]) => onChange({ ...v, tracking: [...new Set([...tracks, ...list])].slice(0, 40) });
  async function readIt(input: { file?: File; text?: string }) {
    setNote(""); setReading(input.file ? `Reading ${input.file.name}…` : "Reading it…");
    try {
      let up: { path?: string; name?: string; type?: string } = {};
      if (input.file) {
        const t = await portalAttachUrl(input.file.name);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Couldn't take that file.");
        const u = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, input.file, { contentType: input.file.type || undefined });
        if (u.error) throw new Error(u.error.message);
        up = { path: t.path, name: input.file.name, type: input.file.type };
      }
      const r = await readShipmentPaper({ ...up, text: input.text, orders: [] });
      if (!r.ok || !r.read) throw new Error(r.error || "Couldn't read it.");
      const x = r.read;
      const vendor = x.vendor.trim();
      const sup = vendor ? (Object.entries(SUPPLIERS).find(([, label]) => label.toLowerCase() === vendor.toLowerCase())?.[0] || vendor) : v.supplier;
      onChange({ ...v, supplier: sup, supplier_po: x.orderNo || v.supplier_po, ship_date: x.eta && /^\d{4}-\d{2}-\d{2}$/.test(x.eta) ? x.eta : v.ship_date, tracking: [...new Set([...tracks, ...x.tracking])].slice(0, 40) });
      setNote(`Filled in from ${input.file ? input.file.name : "what you pasted"}: check it.`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn't read it. Fill in what you can."); }
    setReading("");
  }
  return (
    <div className="gi">
      <div className="gi-l">Where are your goods coming from?</div>
      <div className="gi-chips" role="radiogroup" aria-label="Where are your goods coming from?">
        {Object.entries(SUPPLIERS).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={v.supplier === k} className={"chip" + (v.supplier === k ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: k })}>{label}</button>
        ))}
        <button type="button" role="radio" aria-checked={other} className={"chip" + (other ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: other ? v.supplier : "__other" })}>Somewhere else</button>
        <button type="button" role="radio" aria-checked={v.supplier === ""} className={"chip" + (v.supplier === "" ? " on" : "")} disabled={disabled} onClick={() => onChange({ ...v, supplier: "" })}>Not sure yet</button>
      </div>
      <div className="gi-grid">
        {other && <label><span className="gi-lab">Supplier name</span><input type="text" autoFocus value={v.supplier === "__other" ? "" : v.supplier} disabled={disabled} onChange={(e) => onChange({ ...v, supplier: e.target.value || "__other" })} placeholder="e.g. alphabroder, your own stock" /></label>}
        <label><span className="gi-lab">Supplier order # <small>(optional)</small></span><input type="text" value={v.supplier_po} disabled={disabled} onChange={(e) => onChange({ ...v, supplier_po: e.target.value })} /></label>
        <label><span className="gi-lab">Ships on <small>(if you know)</small></span><input type="date" value={v.ship_date || ""} disabled={disabled} onChange={(e) => onChange({ ...v, ship_date: e.target.value || null })} /></label>
      </div>
      {withTracking && <>
        <label className={"gi-drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void readIt({ file: f }); }}>
          <input type="file" hidden accept="application/pdf,image/*,.eml,.txt" disabled={disabled || !!reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readIt({ file: f }); }} />
          <b>{reading || "Drop your order confirmation or shipping email here"}</b>
          <span>PDF, screenshot or a saved email. We fill in the supplier, order # and tracking for you.</span>
        </label>
        {note && <div className="gi-note">{note}</div>}
        <label className="gi-trk"><span className="gi-lab">Tracking <small>(paste one or more, or the shipping email)</small></span>
          <textarea rows={2} value={paste} disabled={disabled} placeholder="Paste tracking numbers or the shipping email…" onChange={(e) => setPaste(e.target.value)}
            onBlur={() => { const t = paste.trim(); if (!t) return; const found = trackingIn(t); if (found.length) { addTracks(found); setPaste(""); } else if (t.length > 40) void readIt({ text: t }).then(() => setPaste("")); }} />
        </label>
        {tracks.length > 0 && <div className="gi-trks">{tracks.map((t) => (
          <span key={t} className="gi-t"><b>{carrierOf(t) || "Tracking"}</b> {t}<button type="button" className="btn icon ghost sm" aria-label={`Remove ${t}`} disabled={disabled} onClick={() => onChange({ ...v, tracking: tracks.filter((x) => x !== t) })}>×</button></span>
        ))}</div>}
      </>}
    </div>
  );
}
/** "__other" means "somewhere else, name not typed yet": save it as not known. */
export const cleanGoodsInfo = (v: GoodsInfoValue): GoodsInfoValue => ({ ...v, supplier: v.supplier === "__other" ? "" : v.supplier.trim() });
