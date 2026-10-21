"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import { uid, type Finishing } from "@/lib/pricing";

/**
 * Finishing on an order or a group (Oct 20, Nick: "suffocation bags are 5 cents … it's not something we'd show for
 * everyone … I should be able to make my own finishing, type in something … add new, a label, price per piece, and
 * would you like to save this to your sometimes used"):
 *   - the usual list as checkboxes
 *   - "+ More": the sometimes-used ones (list items marked `more`), and a custom one for this order (label, $/pc), with
 *     "Save to my sometimes-used list"
 *   - sometimes-used and custom ones that are on show as checkboxes too (custom ones can be taken off with ×)
 */
export default function FinishingPicker({ list, custom, isOn, onToggle, onAddCustom, onRemoveCustom, onSave, hidePrices }: {
  list: Finishing[];
  /** the custom ones on this order / group */
  custom: Finishing[];
  isOn: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
  /** add a custom one (and tick it) */
  onAddCustom: (f: Finishing) => void;
  onRemoveCustom: (id: string) => void;
  /** save it to the sometimes-used list too; true when saved */
  onSave?: (f: { name: string; price: number }) => Promise<boolean>;
  hidePrices?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""), [price, setPrice] = useState(""), [keep, setKeep] = useState(false);
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);
  const usual = list.filter((f) => !f.more), more = list.filter((f) => f.more);
  const shown = [...usual, ...more.filter((f) => isOn(f.id))];
  const add = async () => {
    const n = name.trim(), p = Math.round((+price || 0) * 100) / 100;
    if (!n) return;
    onAddCustom({ id: "cf_" + uid(), name: n, price: p });
    setNote("");
    if (keep && onSave) setNote((await onSave({ name: n, price: p })) ? `Saved "${n}" to your sometimes-used list.` : "Added to this order, but it didn't save to your list.");
    setName(""); setPrice(""); setKeep(false);
    if (!keep) setOpen(false);
  };
  const pp = (v: number) => (hidePrices ? null : <span className="faint"> ({money(v)}/pc)</span>);
  return (
    <div className="fin-pick">
      {shown.map((f) => (
        <label key={f.id} className="check" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={isOn(f.id)} onChange={(e) => onToggle(f.id, e.target.checked)} />
          {f.name}{pp(f.price)}
        </label>
      ))}
      {custom.map((f) => (
        <span key={f.id} className="check fin-custom" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={isOn(f.id)} onChange={(e) => onToggle(f.id, e.target.checked)} aria-label={f.name} />
          {f.name}{pp(f.price)}
          <button type="button" className="fin-x" aria-label={`Take ${f.name} off this order`} title="Take it off this order" onClick={() => onRemoveCustom(f.id)}>×</button>
        </span>
      ))}
      <div className="fin-more" ref={box}>
        <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen((x) => !x)}>+ More</button>
        {open && (
          <div className="fin-pop" role="dialog" aria-label="More finishing">
            {more.length > 0 && <>
              <div className="fin-h">Sometimes used</div>
              <div className="fin-list">
                {more.map((f) => (
                  <label key={f.id} className="check" style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={isOn(f.id)} onChange={(e) => onToggle(f.id, e.target.checked)} />
                    {f.name}{pp(f.price)}
                  </label>
                ))}
              </div>
            </>}
            <div className="fin-h">Custom for this order</div>
            <div className="fin-new">
              <input type="text" placeholder="Label, e.g. Suffocation bags" aria-label="Finishing label" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
              <span className="fin-price">$<input type="number" step="0.01" min="0" placeholder="0.05" aria-label="Price per piece" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} /><small>/pc</small></span>
            </div>
            {onSave && <label className="check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Save to my sometimes-used list</label>}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn sm primary" disabled={!name.trim()} onClick={() => void add()}>Add</button>
            </div>
            {note && <div className="faint" style={{ fontSize: 12 }}>{note}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
