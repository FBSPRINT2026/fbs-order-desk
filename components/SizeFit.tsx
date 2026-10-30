"use client";
import { useState } from "react";
import type { Group, GLine } from "@/lib/pricing";
import { KIND_WORD, pcsOf, sizesText, type SizeKind } from "@/lib/sizeFit";
import { sizeRank } from "@/lib/sizeOrder";

/**
 * Sizes a style doesn't come in (Oct 30, Nick: "you brought in PC099Y as all of it… there's no PC099Y adult sizes…
 * this is an error"). Before an order is made (Create order, the email's Create order panel, Reorder from Printavo) and
 * on the order page, every garment line's sizes are checked against the style's real sizes. The ones it doesn't come in
 * go on its sister style in the same color: youth ↔ adult, toddler, infant (lib/garmentSister.ts finds it). A remembered
 * pair or one clear catalog match goes straight on and says so; anything else is asked here, and the answer is kept for
 * everyone next time. A youth-only style in plain S/M/L may mean its youth sizes: always asked.
 */
export type FitGuess = { style: string; brand: string; title: string; sizes: string[]; colorOk: boolean | null; covers: boolean; sure?: boolean; from: string };
export type FitPick = { style: string; brand: string; title: string; how: "sure" | "staff" } | "leave" | null;
export type FitMove = { kind: SizeKind; sizes: Record<string, number>; guesses: FitGuess[]; pick: FitPick };
export type FitRow = { gi: number; li: number; style: string; brand: string; color: string; run: string[]; moves: FitMove[]; youth: Record<string, number> | null; asYouth: boolean | null };

const runText = (run: string[]) => { const s = [...run].sort((a, b) => sizeRank(a) - sizeRank(b)); return s.length > 2 ? `${s[0]}–${s[s.length - 1]}` : s.join(", "); };
const kindsOf = (run: string[]) => { const y = run.some((z) => /^Y/.test(z)), a = run.some((z) => /^(XS|S|M|L|XL|\dXL)$/.test(z)); return y && !a ? "youth sizes only" : a && !y ? "adult sizes only" : `sizes ${runText(run)}`; };
const short = (t: string) => t.replace(/\.\s*\S+$/, "").replace(/^Port & Co(mpany)?\s+/i, "");

export async function checkSizeFit(groups: Group[]): Promise<{ rows: FitRow[]; ask: FitRow[] }> {
  const lines = groups.flatMap((g, gi) => g.lines.map((l, li) => ({ key: `${gi}:${li}`, style: l.style, brand: l.brand, color: l.color, sizes: l.sizes as Record<string, number> }))).filter((x) => String(x.style || "").trim() && Object.keys(x.sizes || {}).length);
  if (!lines.length) return { rows: [], ask: [] };
  const r = await fetch("/api/garments/sister", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) }).catch(() => null);
  const j = r?.ok ? ((await r.json().catch(() => ({}))) as { lines?: { key: string; style: string; brand: string; run: string[]; moves: { kind: SizeKind; sizes: Record<string, number>; guesses: FitGuess[] }[]; youth: Record<string, number> | null }[] }) : {};
  const rows: FitRow[] = (j.lines || []).map((x) => {
    const [gi, li] = x.key.split(":").map(Number);
    const l = groups[gi]?.lines[li];
    return {
      gi, li, style: x.style, brand: x.brand, color: l?.color || "", run: x.run, youth: x.youth, asYouth: x.youth ? null : false,
      moves: x.moves.map((m) => { const s = m.guesses.find((g) => g.sure); return { ...m, pick: s && !x.youth ? { style: s.style, brand: s.brand, title: s.title, how: "sure" as const } : null }; }),
    };
  }).filter((x) => groups[x.gi]?.lines[x.li]);
  return { rows, ask: rows.filter((x) => x.youth || x.moves.some((m) => !m.pick)) };
}

/** the picks onto the order's lines: the sizes moved onto the sister style's line (made in the same color, or the one
 *  already there), what was done in plain words, and staff's picks remembered */
export function applySizeFit(groups: Group[], rows: FitRow[]): { groups: Group[]; did: string[] } {
  const out = groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, sizes: { ...l.sizes } })) }));
  const did: string[] = [];
  const drop = new Set<GLine>();
  for (const r of rows) {
    const g = out[r.gi]; const l = g?.lines[r.li]; if (!l) continue;
    if (r.youth && r.asYouth) {
      const was = sizesText(l.sizes as Record<string, number>);
      l.sizes = { ...r.youth } as GLine["sizes"];
      did.push(`${r.style}: ${was} are its youth sizes (${sizesText(r.youth)})`);
      continue;
    }
    for (const m of r.moves) {
      const p = m.pick; if (!p || p === "leave") continue;
      for (const z of Object.keys(m.sizes)) delete (l.sizes as Record<string, number>)[z];
      const same = (x: GLine) => x.style.trim().toUpperCase() === p.style.toUpperCase() && x.color.trim().toLowerCase() === l.color.trim().toLowerCase();
      const there = g.lines.find((x) => x !== l && same(x));
      if (there) for (const [z, q] of Object.entries(m.sizes)) (there.sizes as Record<string, number>)[z] = (+((there.sizes as Record<string, number>)[z] || 0)) + q;
      else {
        const { sizeRun: _r, sizeUp: _u, sizeUpSet: _s, ...keep } = l as GLine & { sizeUpSet?: unknown };
        void _r; void _u; void _s;
        g.lines.splice(g.lines.indexOf(l) + 1, 0, { ...keep, id: crypto.randomUUID(), style: p.style, brand: p.brand || l.brand, garment: p.title ? short(p.title) : "", cost: "", sizes: { ...m.sizes } as GLine["sizes"] });
      }
      did.push(`${r.style} comes in ${kindsOf(r.run)}: ${sizesText(m.sizes)} (${pcsOf(m.sizes)} pcs) moved to ${p.style}${p.title ? ` ${short(p.title)}` : ""}${p.how === "sure" ? "" : " (remembered for next time)"}`);
      // kept for everyone: staff's pick, or the catalog's one clear match
      void fetch("/api/garments/sister", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: r.style, styleBrand: r.brand, kind: m.kind, sister: p.style, sisterBrand: p.brand, source: p.how === "staff" ? "staff" : "catalog" }) }).catch(() => null);
    }
    if (!Object.values(l.sizes || {}).some((q) => +(q || 0) > 0)) drop.add(l);
  }
  for (const g of out) g.lines = g.lines.filter((l) => !drop.has(l));
  return { groups: out, did };
}

/** The question, when it isn't sure: inline in Create order, or as a pop-up on the other ways in */
export default function SizeFitAsk({ rows, onDone, onCancel, inline }: { rows: FitRow[]; onDone: (rows: FitRow[]) => void; onCancel: () => void; inline?: boolean }) {
  const [rs, setRs] = useState<FitRow[]>(() => rows.map((r) => ({ ...r, moves: r.moves.map((m) => ({ ...m })) })));
  const [typed, setTyped] = useState<Record<string, string>>({});
  // only the lines it wasn't sure about; the sure ones go on as they are
  const [show] = useState(() => new Set(rows.map((r, i) => (r.youth || r.moves.some((m) => !m.pick) ? i : -1)).filter((i) => i >= 0)));
  const ask = rs.map((r, i) => ({ r, i })).filter(({ i }) => show.has(i));
  const setPick = (i: number, k: number, p: FitPick) => setRs((x) => x.map((r, ri) => (ri === i ? { ...r, moves: r.moves.map((m, mk) => (mk === k ? { ...m, pick: p } : m)) } : r)));
  const setYouth = (i: number, v: boolean) => setRs((x) => x.map((r, ri) => (ri === i ? { ...r, asYouth: v } : r)));
  const ready = rs.every((r) => (r.youth && r.asYouth) || r.moves.every((m) => !!m.pick));
  const body = (
    <div className="cc-rows">
      {ask.map(({ r, i }) => (
        <div key={i} className="sf-row">
          <p className="sf-what"><b>{r.brand ? `${r.brand} ` : ""}{r.style}</b> comes in {kindsOf(r.run)} ({runText(r.run)}){r.color ? ` · ${r.color}` : ""}</p>
          {r.youth && (
            <div className="chips sf-opts" role="radiogroup" aria-label={`What ${r.style}'s sizes are`}>
              <button type="button" className={"chip" + (r.asYouth ? " on" : "")} aria-pressed={!!r.asYouth} onClick={() => setYouth(i, true)}>Its youth sizes: {sizesText(r.youth)}</button>
              <button type="button" className={"chip" + (r.asYouth === false ? " on" : "")} aria-pressed={r.asYouth === false} onClick={() => setYouth(i, false)}>Adult sizes on another style</button>
            </div>
          )}
          {(!r.youth || r.asYouth === false) && r.moves.map((m, k) => {
            const key = `${i}:${k}`, cur = m.pick && m.pick !== "leave" ? m.pick.style : m.pick === "leave" ? "leave" : "";
            return (
              <div key={k} className="sf-move">
                <span className="sf-sizes">{sizesText(m.sizes)} <span className="faint">({pcsOf(m.sizes)} pcs, {KIND_WORD[m.kind]})</span> go on:</span>
                <div className="chips sf-opts" role="radiogroup" aria-label={`Style for the ${KIND_WORD[m.kind]} sizes`}>
                  {m.guesses.filter((g) => g.covers).map((g) => (
                    <button key={g.style} type="button" className={"chip" + (cur === g.style ? " on" : "")} aria-pressed={cur === g.style} title={g.title}
                      onClick={() => setPick(i, k, { style: g.style, brand: g.brand, title: g.title, how: "staff" })}>
                      <b>{g.style}</b> <small>{short(g.title)}{g.colorOk === false ? ` · no ${r.color}` : ""}</small>
                    </button>
                  ))}
                  <button type="button" className={"chip" + (cur === "leave" ? " on" : "")} aria-pressed={cur === "leave"} title={`Keep them on ${r.style} as written`} onClick={() => setPick(i, k, "leave")}>Leave on {r.style}</button>
                </div>
                <div className="sf-type">
                  <input type="text" value={typed[key] || ""} placeholder="Another style #" aria-label={`Style number for the ${KIND_WORD[m.kind]} sizes`}
                    onChange={(e) => { const v = e.target.value; setTyped((t) => ({ ...t, [key]: v })); setPick(i, k, v.trim() ? { style: v.trim().toUpperCase(), brand: r.brand, title: "", how: "staff" } : null); }} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
  const done = () => onDone(rs);
  if (inline) return (
    <div className="ap" role="group" aria-label="Sizes the style doesn't come in">
      <p className="ap-q">{ask.length === 1 ? `${ask[0].r.style} doesn't come in all these sizes. Where do they go?` : "Some styles don't come in all their sizes. Where do they go?"}</p>
      <p className="ap-why">Picked once, it&apos;s remembered for everyone.</p>
      {body}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn primary" disabled={!ready} onClick={done}>Use these styles</button></div>
    </div>
  );
  return (
    <div className="cc-back" role="dialog" aria-modal="true" aria-label="Sizes the style doesn't come in">
      <div className="cc">
        <h3>Sizes the style doesn&apos;t come in</h3>
        <p className="faint">Picked once, it&apos;s remembered for everyone.</p>
        {body}
        <div className="cc-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ready} onClick={done}>Use these styles</button>
        </div>
      </div>
    </div>
  );
}
