"use client";
import { useState } from "react";
import { lineQty, persOf, SIZES, type GLine, type Size } from "@/lib/pricing";

/**
 * "Add personalization" on a group with embroidery (Oct 30, Nick: "put a check mark for add personalization… what item
 * should we have personalized? …you select it from the dropdown, you type the name, and then it adds it to the line
 * item… size small, quantity one… if you had a medium, you go medium"). One row: item · size · qty · name · title · Add.
 * Each one goes under its line item (GroupEditor) with its size and quantity, charged per piece on top of the line.
 */
export default function PersonalizationPicker({ lines, price, hidePrices, disabled, onAdd }: {
  lines: GLine[]; price: number; hidePrices?: boolean; disabled?: boolean;
  onAdd: (lineId: string, size: Size | "", qty: number, text: string) => void;
}) {
  const named = lines.some((l) => persOf(l).length);
  const [open, setOpen] = useState(false);
  const on = open || named;
  const pickable = lines.filter((l) => !l.extras && !l.shopUse && lineQty(l) > 0);
  const [lineId, setLineId] = useState("");
  const [size, setSize] = useState<Size | "">("");
  const [qty, setQty] = useState("1");
  const [name, setName] = useState("");
  // a name, a title, or both (Nick: "sometimes it's one or the other, sometimes it's both"): kept as "Name / Title"
  const [title, setTitle] = useState("");
  const text = [name.trim(), title.trim()].filter(Boolean).join(" / ");
  const line = pickable.find((l) => l.id === lineId) || (pickable.length === 1 ? pickable[0] : null);
  const sizes = line ? SIZES.filter((z) => +(line.sizes?.[z] || 0) > 0) : [];
  const sz = (size && sizes.includes(size as Size) ? size : sizes.length === 1 ? sizes[0] : "") as Size | "";
  const n = Math.max(1, Math.floor(+qty || 1));
  const label = (l: GLine) => [l.style, l.color].filter(Boolean).join(" · ") || "Garment";
  const add = () => {
    if (!line || (sizes.length > 0 && !sz) || !text) return;
    onAdd(line.id, sz, n, text);
    setName(""); setTitle(""); setQty("1");
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return (
    <div className="sbx-sec pers">
      <label className="check"><input type="checkbox" checked={on} disabled={disabled || named} onChange={(e) => setOpen(e.target.checked)} />Add personalization{!hidePrices && <span className="faint"> ${price.toFixed(2)} each</span>}{named && <span className="faint"> · listed under each item</span>}</label>
      {on && !disabled && (pickable.length ? (
        <div className="pers-add">
          <div className="field"><label htmlFor="pers-item">Item</label>
            <select id="pers-item" value={line?.id || ""} onChange={(e) => { setLineId(e.target.value); setSize(""); }}>
              {pickable.length > 1 && <option value="">Pick the item…</option>}
              {pickable.map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pers-size">Size</label>
            <select id="pers-size" value={sz} onChange={(e) => setSize(e.target.value as Size)} disabled={!line}>
              {sizes.length !== 1 && <option value="">Size…</option>}
              {sizes.map((z) => <option key={z} value={z}>{z}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pers-qty">Qty</label>
            <input id="pers-qty" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={enter} /></div>
          <div className="field"><label htmlFor="pers-name">Name</label>
            <input id="pers-name" type="text" value={name} placeholder="John Doe" onChange={(e) => setName(e.target.value)} onKeyDown={enter} /></div>
          <div className="field"><label htmlFor="pers-title">Title</label>
            <input id="pers-title" type="text" value={title} placeholder="Position" onChange={(e) => setTitle(e.target.value)} onKeyDown={enter} /></div>
          <button type="button" className="btn sm" disabled={!line || (sizes.length > 0 && !sz) || !text} onClick={add}>Add</button>
        </div>
      ) : <p className="faint">Add the garments first: each name goes on a piece.</p>)}
    </div>
  );
}
