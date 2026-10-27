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

export async function checkColors(groups: Group[], /** a customer's usual colors per style (their preferred goods): the first pick when what they wrote isn't exact ("the gray" → their Heather Gray), still asked (Oct 26) */ usual: Record<string, string[]> = {}): Promise<{ rows: ColorRow[]; ask: ColorRow[] }> {
  const styles = groups.flatMap((g) => g.lines.map((l) => ({ style: l.style, brand: l.brand }))).filter((x) => x.style);
  if (!styles.length) return { rows: [], ask: [] };
  const r = await fetch("/api/garments/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ styles }) }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => ({})) as { garments?: Record<string, { brand: string; style: string; colors: string[] }> } : {};
  const rows: ColorRow[] = [];
  groups.forEach((g, gi) => g.lines.forEach((l, li) => {
    const gm = j.garments?.[String(l.style || "").trim().toUpperCase()];
    if (!gm || !gm.colors.length) return;
    const m = l.color ? matchColor(l.color, gm.colors) : null;
    // the same name, written differently, is the same color (Oct 26: Michael wrote "red", "ice blue", "Athletic Heather
    // (gray)": the style's Red, Ice Blue, Athletic Heather): no question, just its real name
    const plain = (x: string) => x.replace(/\(.*?\)/g, " ").replace(/^\s*the\s+/i, "").replace(/gr[ae]y/gi, "gray").replace(/\s+/g, " ").trim().toLowerCase();
    const same = l.color ? gm.colors.find((c) => plain(c) === plain(l.color)) : undefined;
    const exact = !!same;
    const words = (x: string) => x.toLowerCase().replace(/^the\s+/, "").replace(/gr[ae]y/g, "gray").split(/[^a-z0-9]+/).filter(Boolean);
    const theirs = (usual[String(gm.style).toUpperCase()] || []).filter((c) => gm.colors.includes(c)).find((c) => l.color && words(l.color).every((w) => words(c).includes(w)));
    rows.push({ gi, li, style: gm.style, brand: gm.brand, asked: l.color || "", options: gm.colors, pick: exact ? same! : theirs || m?.color || "", exact });
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

export default function ColorCheck({ rows, onDone, onCancel, inline }: { rows: ColorRow[]; onDone: (rows: ColorRow[]) => void; onCancel: () => void;
  /** inside Create order: the tool's own look, in its panel (Oct 23, Nick: "no matter which path you go down, it should all look the same") */ inline?: boolean }) {
  const [picks, setPicks] = useState(rows.map((r) => r.pick));
  const ask = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.exact);
  if (inline) return (
    <div className="ap" role="group" aria-label="Check the shirt colors">
      <p className="ap-q">{ask.length === 1 ? "This shirt color isn't one of the style's colors. Which is it?" : "These shirt colors aren't the style's colors. Which are they?"}</p>
      <p className="ap-why">Pick the real color so the mockup shows the right shirt.</p>
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
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn primary" disabled={ask.some(({ i }) => !picks[i])} onClick={() => onDone(rows.map((r, i) => ({ ...r, pick: picks[i] || r.pick })))}>Use these colors</button></div>
    </div>
  );
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
