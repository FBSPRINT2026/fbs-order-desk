"use client";
import { useState } from "react";
import { LOCATIONS, lineQty, persOf, SIZES, type GLine, type PersEntry, type Size } from "@/lib/pricing";
import type { PersRow } from "@/lib/persList";

/**
 * "Add personalization" on a group with embroidery (Oct 30, Nick: "put a check mark for add personalization… what item
 * should we have personalized? …you select it from the dropdown, you type the name, and then it adds it to the line
 * item… size small, quantity one… if you had a medium, you go medium"). One row: item · size · qty · name · title · Add.
 * Each one goes under its line item (GroupEditor) with its size and quantity, charged per piece on top of the line.
 */
export default function PersonalizationPicker({ lines, price, hidePrices, disabled, onAdd, orderId, onAddMany }: {
  lines: GLine[]; price: number; hidePrices?: boolean; disabled?: boolean;
  onAdd: (lineId: string, size: Size | "", qty: number, text: string, loc: string) => void;
  /** a whole name list at once (an uploaded spreadsheet): each row onto its line */
  orderId?: string; onAddMany?: (adds: { lineId: string; entry: Omit<PersEntry, "id"> }[]) => void;
}) {
  const [listBusy, setListBusy] = useState(""), [listErr, setListErr] = useState("");
  const count = lines.reduce((a, l) => a + persOf(l).length, 0), named = count > 0;
  // the form drops down when the box is ticked or "+ Add another name" is pressed, and closes after Add (Oct 30, Nick:
  // "it drops down… then you add and it just goes away and the add personalization stays checked")
  const [open, setOpen] = useState(false);
  const on = open || named;
  const pickable = lines.filter((l) => !l.extras && !l.shopUse && lineQty(l) > 0);
  const [lineId, setLineId] = useState("");
  const [size, setSize] = useState<Size | "">("");
  const [qty, setQty] = useState("1");
  const [name, setName] = useState("");
  // a name, a title, or both (Nick: "sometimes it's one or the other, sometimes it's both"): kept as "Name / Title"
  const [title, setTitle] = useState("");
  // where it's sewn: Right Chest unless typed or picked (a sleeve, the back…)
  const [loc, setLoc] = useState("Right Chest");
  const text = [name.trim(), title.trim()].filter(Boolean).join(" / ");
  const line = pickable.find((l) => l.id === lineId) || (pickable.length === 1 ? pickable[0] : null);
  const sizes = line ? SIZES.filter((z) => +(line.sizes?.[z] || 0) > 0) : [];
  const sz = (size && sizes.includes(size as Size) ? size : sizes.length === 1 ? sizes[0] : "") as Size | "";
  const n = Math.max(1, Math.floor(+qty || 1));
  const label = (l: GLine) => [l.style, l.color].filter(Boolean).join(" · ") || "Garment";
  const add = () => {
    if (!line || (sizes.length > 0 && !sz) || !text) return;
    onAdd(line.id, sz, n, text, loc.trim() || "Right Chest");
    setName(""); setTitle(""); setQty("1"); setOpen(false);
  };
  // a name list (Oct 30, Nick: "upload a spreadsheet by giving the sizes and the name… if you had a ton to do"): the file
  // goes in Production files; each row goes on the line whose style it names, else the item picked here (or the only one)
  const upload = async (f: File | null | undefined) => {
    if (!f || !orderId || !onAddMany) return;
    setListBusy(`Reading ${f.name}…`); setListErr("");
    const fd = new FormData(); fd.append("file", f); fd.append("orderId", orderId);
    const r = await fetch("/api/personalization/list", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setListBusy("");
    if (!r?.ok || j.error) { setListErr(j.error || "Couldn't read that list."); return; }
    const rows = j.rows as PersRow[], file = j.file as { path: string; name: string };
    const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const fallback = line || (pickable.length === 1 ? pickable[0] : null);
    const adds: { lineId: string; entry: Omit<PersEntry, "id"> }[] = [];
    let missed = 0;
    for (const row of rows) {
      const byStyle = row.style ? pickable.find((l) => key(l.style || "") && key(row.style).includes(key(l.style || ""))) : null;
      const target = byStyle || fallback;
      if (!target) { missed++; continue; }
      adds.push({ lineId: target.id, entry: { text: [row.name, row.title].filter(Boolean).join(" / "), size: row.size, qty: row.qty, loc: loc.trim() || "Right Chest", list: file } });
    }
    if (adds.length) { onAddMany(adds); setOpen(false); }
    if (missed) setListErr(`${missed} name${missed === 1 ? "" : "s"} didn't say which item: pick the item above and upload again for those.`);
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return (
    <div className="sbx-sec pers">
      <div className="pers-h">
        <label className="check"><input type="checkbox" checked={on} disabled={disabled || named} onChange={(e) => setOpen(e.target.checked)} />Add personalization{!hidePrices && <span className="faint"> ${price.toFixed(2)} each</span>}{named && <span className="faint"> · {count} name{count === 1 ? "" : "s"}</span>}</label>
        {named && !open && !disabled && <button type="button" className="linkbtn" onClick={() => setOpen(true)}>+ Add another name</button>}
        {named && open && <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Close</button>}
      </div>
      {open && !disabled && (pickable.length ? (
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
          <div className="field"><label htmlFor="pers-loc">Location</label>
            <input id="pers-loc" type="text" list="pers-locs" value={loc} onChange={(e) => setLoc(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={enter} />
            <datalist id="pers-locs">{[...LOCATIONS, "Left Upper Arm", "Right Upper Arm", "Back Neck", "Front", "Side", "Back", "Cuff"].filter((x, i, a) => a.indexOf(x) === i).map((x) => <option key={x} value={x} />)}</datalist></div>
          <button type="button" className="btn sm" disabled={!line || (sizes.length > 0 && !sz) || !text} onClick={add}>Add</button>
        </div>
      ) : <p className="faint">Add the garments first: each name goes on a piece.</p>)}
      {open && !disabled && pickable.length > 0 && orderId && onAddMany && (
        <div className="pers-list">
          <label className="btn sm">{listBusy ? "Reading…" : "Upload a name list"}<input type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv,.txt" disabled={!!listBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void upload(f); }} /></label>
          <span className="faint">A spreadsheet of names (and titles, sizes, quantities{pickable.length > 1 ? ", the style" : ""}). It goes in Production files too.</span>
        </div>
      )}
      {listBusy && <p className="faint">{listBusy}</p>}
      {listErr && <p className="emb-warn-1">{listErr}</p>}
    </div>
  );
}
