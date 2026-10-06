"use client";
import { useEffect, useMemo, useState } from "react";
import type { PublicProduct } from "@/lib/merchServer";
import { bySize, isYouthSize, r2, shortSize, SIZE_GUIDE, storeImg } from "@/lib/merch";
import { money, price, Stepper, type Bag, type BagLine } from "./kit";

/**
 * One item: pick a color, then how many of each size, all at once ("2 Adult M and 1 Youth S"). Youth and adult sizes sit
 * side by side (tabs on a phone), each with a quick size guide. Personalized items get a box per piece.
 */
export default function ProductView({ p, bag, canBuy, closedNote, onAdded, onBack }: {
  p: PublicProduct; bag: Bag; canBuy: boolean; closedNote: string; onAdded: (n: number) => void; onBack: () => void;
}) {
  const [color, setColor] = useState(p.colors[0]?.name || "");
  const c = p.colors.find((x) => x.name === color) || p.colors[0];
  const sizes = useMemo(() => (c?.sizes?.length ? c.sizes : p.sizes).slice().sort(bySize), [c, p.sizes]);
  const youth = sizes.filter(isYouthSize), adult = sizes.filter((z) => !isYouthSize(z));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"youth" | "adult">(youth.length ? "youth" : "adult");
  const [pers, setPers] = useState<Record<string, Record<string, string>>>({});
  const [side, setSide] = useState<"front" | "back">("front");
  const [err, setErr] = useState("");
  useEffect(() => { setSide("front"); }, [color]);

  const base = Math.min(...sizes.map((z) => p.prices[z] || Infinity));
  const top = Math.max(...sizes.map((z) => p.prices[z] || 0));
  const fields = p.personalize || [];
  const pieces = sizes.flatMap((z) => Array.from({ length: qty[z] || 0 }, (_, i) => ({ z, i, k: `${z}#${i}` })));
  const extraFor = (k: string) => fields.reduce((a, f) => a + (pers[k]?.[f.label]?.trim() ? +f.price || 0 : 0), 0);
  const n = pieces.length;
  const total = r2(pieces.reduce((a, x) => a + (p.prices[x.z] || 0) + extraFor(x.k), 0));
  const inBag = (z: string) => bag.live.filter((l) => l.product_id === p.id && l.color === c?.name && l.size === z).reduce((a, l) => a + l.qty, 0);
  const img = side === "back" && c?.back ? c.back : c?.image || c?.photo || "";

  function add() {
    setErr("");
    if (!n) return setErr("Enter how many of each size you'd like.");
    const lines: Omit<BagLine, "key">[] = fields.length
      ? pieces.map((x) => {
        const v = Object.fromEntries(Object.entries(pers[x.k] || {}).map(([k, s]) => [k, s.trim()]).filter(([, s]) => s));
        return { product_id: p.id, color: c?.name || "", size: x.z, qty: 1, ...(Object.keys(v).length ? { personalization: v } : {}) };
      })
      : sizes.filter((z) => qty[z] > 0).map((z) => ({ product_id: p.id, color: c?.name || "", size: z, qty: qty[z] }));
    bag.add(lines);
    setQty({}); setPers({});
    onAdded(n);
  }

  const row = (z: string) => {
    const d = r2((p.prices[z] || 0) - base);
    const had = inBag(z);
    return (
      <div key={z} className={"sf-szrow" + (qty[z] ? " on" : "")}>
        <div className="sf-szname">
          <b>{shortSize(z)}{d > 0 && <em className="sf-up">+{price(d)}</em>}</b>
          <span>{SIZE_GUIDE[z] || (isYouthSize(z) ? "Youth" : "")}</span>
          {had > 0 && <span className="sf-had">{had} in your bag</span>}
        </div>
        <Stepper value={qty[z] || 0} onChange={(v) => { setErr(""); setQty({ ...qty, [z]: v }); }} label={`${isYouthSize(z) ? "Youth" : youth.length ? "Adult" : "Size"} ${shortSize(z)}`} />
      </div>
    );
  };
  const count = (zs: string[]) => zs.reduce((a, z) => a + (qty[z] || 0), 0);

  return (
    <div className="sf-pv">
      <nav className="sf-crumb"><button type="button" onClick={onBack}>← All items</button></nav>
      <div className="sf-pv-grid">
        <div className="sf-gallery">
          <div className="sf-gallery-main">{img ? <img key={img} src={storeImg(img)} alt={`${p.name} in ${c?.name}${side === "back" ? ", back" : ""}`} /> : null}</div>
          {c?.back && (
            <div className="sf-sides" role="group" aria-label="Front or back">
              {(["front", "back"] as const).map((s) => <button key={s} type="button" aria-pressed={side === s} className={side === s ? "on" : ""} onClick={() => setSide(s)}><img src={storeImg(s === "back" ? c.back! : c.image || c.photo)} alt="" /><span>{s === "front" ? "Front" : "Back"}</span></button>)}
            </div>
          )}
        </div>

        <div className="sf-pv-info">
          <h1 className="sf-pv-name" data-notranslate>{p.name}</h1>
          <p className="sf-pv-price">{price(base)}{top > base && <span> · larger sizes a little more</span>}{youth.length > 0 && adult.length > 0 && <span> · youth &amp; adult</span>}</p>
          {p.description && <p className="sf-pv-desc">{p.description}</p>}

          {p.colors.length > 0 && (
            <div className="sf-block">
              <div className="sf-block-h"><h2>Color</h2><span data-notranslate>{c?.name}</span></div>
              <div className="sf-colors" role="radiogroup" aria-label="Color">
                {p.colors.map((x) => (
                  <button key={x.name} type="button" role="radio" aria-checked={x.name === color} className={"sf-color" + (x.name === color ? " on" : "")} onClick={() => setColor(x.name)} title={x.name}>
                    {x.image || x.photo ? <img src={storeImg(x.image || x.photo)} alt="" /> : <i style={{ background: x.hex }} />}
                    <span data-notranslate>{x.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sf-block">
            <div className="sf-block-h"><h2>Sizes &amp; how many</h2>{n > 0 && <button type="button" className="sf-link" onClick={() => { setQty({}); setPers({}); }}>Clear</button>}</div>
            {youth.length > 0 && adult.length > 0 && (
              <div className="sf-tabs" role="tablist" aria-label="Youth or adult sizes">
                <button type="button" role="tab" aria-selected={tab === "youth"} className={tab === "youth" ? "on" : ""} onClick={() => setTab("youth")}>Youth{count(youth) > 0 && <i>{count(youth)}</i>}</button>
                <button type="button" role="tab" aria-selected={tab === "adult"} className={tab === "adult" ? "on" : ""} onClick={() => setTab("adult")}>Adult{count(adult) > 0 && <i>{count(adult)}</i>}</button>
              </div>
            )}
            <div className="sf-sizecols">
              {youth.length > 0 && <div className={"sf-szgroup" + (tab === "youth" ? " show" : "")}><h3>Youth</h3>{youth.map(row)}</div>}
              {adult.length > 0 && <div className={"sf-szgroup" + (tab === "adult" || !youth.length ? " show" : "")}><h3>{youth.length ? "Adult" : "Sizes"}</h3>{adult.map(row)}</div>}
            </div>
            <p className="sf-fine">{youth.length ? "Youth sizes by typical age; adult sizes are unisex. " : "Unisex sizes. "}Sizes vary a little by brand.</p>
          </div>

          {fields.length > 0 && n > 0 && (
            <div className="sf-block">
              <div className="sf-block-h"><h2>Personalize</h2><span>Optional{fields.some((f) => f.price) ? `: ${fields.map((f) => (f.price ? `+${money(f.price)}` : "")).filter(Boolean).join(", ")} each` : ""}</span></div>
              <div className="sf-pers">
                {pieces.map((x) => (
                  <div key={x.k} className="sf-pers-row">
                    <span>{isYouthSize(x.z) ? "Youth" : "Adult"} {shortSize(x.z)}{(qty[x.z] || 0) > 1 ? ` #${x.i + 1}` : ""}</span>
                    {fields.map((f) => <input key={f.label} maxLength={f.max || 30} placeholder={f.label} aria-label={`${f.label}, ${x.z} #${x.i + 1}`} value={pers[x.k]?.[f.label] || ""} onChange={(e) => setPers({ ...pers, [x.k]: { ...(pers[x.k] || {}), [f.label]: e.target.value } })} />)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sf-buy">
            {err && <p className="sf-err" role="alert">{err}</p>}
            {!canBuy && <p className="sf-buy-note">{closedNote}</p>}
            <button type="button" className="sf-btn big" disabled={!canBuy} onClick={add}>
              {!canBuy ? "Not taking orders" : n ? `Add ${n} to bag · ${money(total)}` : "Add to bag"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
