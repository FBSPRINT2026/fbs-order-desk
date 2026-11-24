"use client";
import { useState } from "react";
import { isAid, r1 } from "@/lib/draftpunk/calc";
import { FERMENTABLES, HOPS, MISCS, YEASTS } from "@/lib/draftpunk/library";
import { subText, type Kind, type ShelfItem, type Sub } from "@/lib/draftpunk/brewPlan";
import type { Recipe } from "@/lib/draftpunk/types";

const LIB: Record<Kind, readonly { name: string }[]> = { fermentable: FERMENTABLES, hop: HOPS, yeast: YEASTS, misc: MISCS };

/**
 * A swap for one brew (Nick, Nov 24 2026: "I go on Thursday… we had to make this substitution"): pick the ingredient,
 * type what's going in instead (the shelf's and the library's names are offered, so its numbers come with it) or leave it
 * out. The recipe never changes; the brew is named "v2 sub A". Used on a planned brew and on brew day.
 */
export default function SwapPicker({ r, subs, shelf, onChange }: { r: Recipe; subs: Sub[]; shelf: ShelfItem[]; onChange: (subs: Sub[]) => void }) {
  const [swap, setSwap] = useState("");
  const lines: { kind: Kind; lid: string; name: string; amt: string }[] = [
    ...r.ferms.map((f) => ({ kind: "fermentable" as Kind, lid: f.lid, name: f.name, amt: `${r1(f.lb, 2)} lb${isAid(f) ? " (aid)" : ""}` })),
    ...r.hops.map((h) => ({ kind: "hop" as Kind, lid: h.lid, name: h.name, amt: `${r1(h.oz, 2)} oz` })),
    ...r.yeasts.map((y) => ({ kind: "yeast" as Kind, lid: y.lid, name: y.name, amt: "" })),
    ...r.miscs.map((m) => ({ kind: "misc" as Kind, lid: m.lid, name: m.name, amt: `${r1(m.amount, 2)} ${m.unit}` })),
  ];
  const line = lines.find((l) => l.lid === swap);
  const names = (k: Kind) => [...new Set([...shelf.filter((i) => i.kind === k).map((i) => i.name), ...LIB[k].map((x) => x.name)])];
  const put = (s: Sub) => { onChange([...subs.filter((x) => x.lid !== s.lid), s]); setSwap(""); };
  return (
    <div className="dp-swap">
      {subs.map((s) => <div key={s.lid} className="dp-bi-sub"><span>{subText(s)}</span><button type="button" className="dp-btn" onClick={() => onChange(subs.filter((x) => x.lid !== s.lid))}>Undo</button></div>)}
      <div className="dp-row" style={{ gap: 8 }}>
        <select value={swap} onChange={(e) => setSwap(e.target.value)} aria-label="Ingredient to swap">
          <option value="">Swap an ingredient…</option>
          {lines.filter((l) => !subs.some((s) => s.lid === l.lid)).map((l) => <option key={l.lid} value={l.lid}>{l.name}{l.amt ? ` · ${l.amt}` : ""}</option>)}
        </select>
        {line && <>
          <input key={line.lid} list="dp-swap-names" autoFocus placeholder={`Instead of ${line.name}`}
            onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v) put({ kind: line.kind, lid: line.lid, from: line.name, to: v }); }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) put({ kind: line.kind, lid: line.lid, from: line.name, to: v }); }} />
          <datalist id="dp-swap-names">{names(line.kind).map((n) => <option key={n} value={n} />)}</datalist>
          <button type="button" className="dp-btn" onClick={() => put({ kind: line.kind, lid: line.lid, from: line.name, to: "", out: true })}>Leave it out</button>
        </>}
      </div>
    </div>
  );
}
