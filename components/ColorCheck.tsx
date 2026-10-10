"use client";
import { useState } from "react";
import { matchColor } from "@/lib/colorMatch";
import type { Group } from "@/lib/pricing";

/**
 * Before an order is made (Create order from an email, Reorder from an old Printavo job), every garment color is
 * checked against the style's real colors (Nick, Oct 10: "customer said forest, do you mean Heather Forest? burnt
 * orange, do you mean Heather Redwood?"). Exact names go through; anything else is asked here, with the style's colors
 * to pick from, so the mockup shows the real shirt instead of a blank drawn one.
 */
export type ColorRow = { gi: number; li: number; style: string; brand: string; asked: string; options: string[]; pick: string; exact: boolean };

export async function checkColors(groups: Group[]): Promise<{ rows: ColorRow[]; ask: ColorRow[] }> {
  const styles = groups.flatMap((g) => g.lines.map((l) => ({ style: l.style, brand: l.brand }))).filter((x) => x.style);
  if (!styles.length) return { rows: [], ask: [] };
  const r = await fetch("/api/garments/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ styles }) }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => ({})) as { garments?: Record<string, { brand: string; style: string; colors: string[] }> } : {};
  const rows: ColorRow[] = [];
  groups.forEach((g, gi) => g.lines.forEach((l, li) => {
    const gm = j.garments?.[String(l.style || "").trim().toUpperCase()];
    if (!gm || !gm.colors.length) return;
    const m = l.color ? matchColor(l.color, gm.colors) : null;
    const exact = !!l.color && gm.colors.includes(l.color);
    rows.push({ gi, li, style: gm.style, brand: gm.brand, asked: l.color || "", options: gm.colors, pick: exact ? l.color : m?.color || "", exact });
  }));
  return { rows, ask: rows.filter((x) => !x.exact) };
}

/** the picked colors (and the brand, when the old job didn't say it) onto the order's lines */
export function applyColors(groups: Group[], rows: ColorRow[]): Group[] {
  const out = groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l })) }));
  for (const r of rows) {
    const l = out[r.gi]?.lines[r.li]; if (!l) continue;
    if (r.pick) l.color = r.pick;
    if (!l.brand && r.brand) l.brand = r.brand;
  }
  return out;
}

export default function ColorCheck({ rows, onDone, onCancel }: { rows: ColorRow[]; onDone: (rows: ColorRow[]) => void; onCancel: () => void }) {
  const [picks, setPicks] = useState(rows.map((r) => r.pick));
  const ask = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.exact);
  return (
    <div className="cc-back" role="dialog" aria-modal="true" aria-label="Check the shirt colors">
      <div className="cc">
        <h3>Check the shirt colors</h3>
        <p className="faint">These colors don&apos;t match the style&apos;s color names exactly. Pick the real color so the mockup shows the right shirt.</p>
        <div className="cc-rows">
          {ask.map(({ r, i }) => (
            <label key={i} className="cc-row">
              <span className="cc-asked">They said <b>{r.asked || "(no color)"}</b>{r.pick ? <> · the {r.brand} {r.style} comes in <b>{r.pick}</b></> : <> · pick the {r.brand} {r.style} color</>}</span>
              <select value={picks[i]} onChange={(e) => setPicks((p) => p.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Color for ${r.asked}`}>
                <option value="">Choose a color…</option>
                {r.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="cc-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" disabled={ask.some(({ i }) => !picks[i])} onClick={() => onDone(rows.map((r, i) => ({ ...r, pick: picks[i] || r.pick })))}>Use these colors</button>
        </div>
      </div>
    </div>
  );
}
