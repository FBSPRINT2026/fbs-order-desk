"use client";
import { useState } from "react";
import { lineQty, SIZES, type GLine, type Size } from "@/lib/pricing";

/**
 * "Add personalization" on a group with embroidery (Oct 30, Nick: "put a check mark for add personalization… what item
 * should we have personalized? …you select it from the dropdown, you type the name, and then it adds it to the line
 * item"). Each name is one piece: it comes off the picked line (one of the size picked) onto its own line, marked
 * "Personalization: <name>", and that piece is charged the personalization price (lib/pricing.ts persEach).
 */
export default function PersonalizationPicker({ lines, price, hidePrices, disabled, onAdd, onRemove }: {
  lines: GLine[]; price: number; hidePrices?: boolean; disabled?: boolean;
  onAdd: (lineId: string, size: Size, name: string) => void; onRemove: (lineId: string) => void;
}) {
  const named = lines.filter((l) => l.pers);
  const [open, setOpen] = useState(false);
  const on = open || named.length > 0;
  const pickable = lines.filter((l) => !l.pers && !l.extras && !l.shopUse && lineQty(l) > 0);
  const [lineId, setLineId] = useState("");
  const [size, setSize] = useState<Size | "">("");
  const [name, setName] = useState("");
  const line = pickable.find((l) => l.id === lineId) || (pickable.length === 1 ? pickable[0] : null);
  const sizes = line ? SIZES.filter((z) => +(line.sizes?.[z] || 0) > 0) : [];
  const sz = (size && sizes.includes(size as Size) ? size : sizes.length === 1 ? sizes[0] : "") as Size | "";
  const label = (l: GLine) => [l.style, l.color].filter(Boolean).join(" · ") || "Garment";
  const add = () => {
    if (!line || !sz || !name.trim()) return;
    onAdd(line.id, sz, name.trim());
    setName("");
  };
  return (
    <div className="sbx-sec pers">
      <label className="check"><input type="checkbox" checked={on} disabled={disabled || (named.length > 0 && on)} onChange={(e) => setOpen(e.target.checked)} />Add personalization{!hidePrices && <span className="faint"> ${price.toFixed(2)}/name</span>}</label>
      {on && (
        <>
          {named.map((l) => (
            <div key={l.id} className="sbx-r pers-r">
              <span className="sbx-loc">{label(l)} · {SIZES.find((z) => +(l.sizes?.[z] || 0) > 0) || ""}</span>
              <span><b>Personalization:</b> {l.pers}</span>
              {!disabled && <button type="button" className="linkbtn sbx-end" onClick={() => onRemove(l.id)}>Remove</button>}
            </div>
          ))}
          {!disabled && (pickable.length ? (
            <div className="pers-add">
              <div className="field"><label htmlFor="pers-item">Item to personalize</label>
                <select id="pers-item" value={line?.id || ""} onChange={(e) => { setLineId(e.target.value); setSize(""); }}>
                  {pickable.length > 1 && <option value="">Pick the item…</option>}
                  {pickable.map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}
                </select></div>
              <div className="field"><label htmlFor="pers-size">Size</label>
                <select id="pers-size" value={sz} onChange={(e) => setSize(e.target.value as Size)} disabled={!line}>
                  {sizes.length !== 1 && <option value="">Size…</option>}
                  {sizes.map((z) => <option key={z} value={z}>{z} ({line?.sizes?.[z]})</option>)}
                </select></div>
              <div className="field pers-name"><label htmlFor="pers-name">Name</label>
                <input id="pers-name" type="text" value={name} placeholder="Cody White / Ops Manager" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></div>
              <button type="button" className="btn sm" disabled={!line || !sz || !name.trim()} onClick={add}>Add</button>
            </div>
          ) : <p className="faint">Add the garments first: each name goes on one piece.</p>)}
        </>
      )}
    </div>
  );
}
