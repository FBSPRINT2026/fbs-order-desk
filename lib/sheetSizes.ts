import { normSize } from "@/lib/ai/normalize";
import type { Size } from "@/lib/pricing";

/**
 * Size breakdowns read straight off a customer's spreadsheet, by code, so the quantities are exactly the sheet's
 * (Oct 20, Nick: Little Groupies' Bottles sheet says 500, the order came in at 480 and priced at the next break: the
 * AI read Black 3-6m as 70 instead of 90, and moved Pink's sizes down one where the sheet skips 6-12m). The AI still
 * decides which garment is which; this only puts the sheet's numbers on them.
 *
 * Two layouts: one row per size (Size, Color, Qty columns) and one column per size (S M L XL … with a Color column).
 * Input is the tab-separated text lib/officeText.ts makes ("[Sheet: name]" then rows).
 */
export type SheetLine = { product: string; color: string; sizes: Partial<Record<Size, number>>; total: number };

const num = (s: string) => { const v = Number(String(s || "").replace(/[,$\s]/g, "")); return Number.isFinite(v) ? v : NaN; };
/** "Heather Mauve - Sanmar" → "Heather Mauve" (a supplier or note after a dash), "Navy (blank)" → "Navy" */
export const cleanColor = (c: string) => String(c || "").split(/\s[-–—]\s/)[0].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
const words = (c: string) => cleanColor(c).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
/** the same color: equal, or every word of one is in the other ("Heather Blue" / "Heather Columbia Blue") */
export function sameColorLoose(a: string, b: string) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  if (x.join("") === y.join("")) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((w) => l.includes(w));
}

export function sheetBreakdown(text: string): SheetLine[] {
  const out = new Map<string, SheetLine>();
  const add = (product: string, color: string, size: Size, q: number) => {
    const c = cleanColor(color);
    if (!c || !(q > 0)) return;
    const k = `${product.toLowerCase()}|${c.toLowerCase()}`;
    const e = out.get(k) || { product, color: c, sizes: {}, total: 0 };
    e.sizes[size] = (e.sizes[size] || 0) + Math.round(q);
    e.total += Math.round(q);
    out.set(k, e);
  };
  for (const block of text.split(/\n(?=\[Sheet: )/)) {
    const rows = block.split("\n").filter((r) => !/^\[Sheet: /.test(r)).map((r) => r.split("\t").map((c) => c.trim()));
    for (let h = 0; h < rows.length; h++) {
      const head = rows[h].map((c) => c.toLowerCase());
      const colorAt = head.findIndex((c) => /colou?r/.test(c) && !/design|ink|print|thread|#\s*of|number/.test(c));
      if (colorAt < 0) continue;
      const prodAt = head.map((c, i) => (/product|style|item|garment|description|blank/.test(c) && !/price|cost|total|qty|colou?r/.test(c) ? i : -1)).filter((i) => i >= 0);
      const prod = (r: string[]) => prodAt.map((i) => r[i] || "").filter(Boolean).join(" ");
      const sizeCols = head.map((c, i) => ({ i, z: normSize(rows[h][i] || "") })).filter((x) => x.z && x.i !== colorAt) as { i: number; z: Size }[];
      const sizeAt = head.findIndex((c) => /^size\b|\bsize$/.test(c));
      const qtyAt = head.findIndex((c) => /qty|quantity|pieces|pcs|count|needed|units/.test(c) && !/price|cost|total \$|sales|inventory/.test(c));
      let found = 0;
      if (sizeCols.length >= 3) {
        // one column per size
        for (const r of rows.slice(h + 1)) {
          if (!r[colorAt]) continue;
          for (const { i, z } of sizeCols) { const q = num(r[i]); if (q > 0) { add(prod(r), r[colorAt], z, q); found++; } }
        }
      } else if (sizeAt >= 0 && qtyAt >= 0) {
        // one row per size
        for (const r of rows.slice(h + 1)) {
          const z = normSize(r[sizeAt] || ""), q = num(r[qtyAt]);
          if (z && r[colorAt] && q > 0) { add(prod(r), r[colorAt], z, q); found++; }
        }
      } else continue;
      if (found) break; // the first header row with data under it is the table
    }
  }
  return [...out.values()];
}

/** the style number in a product text (100B, 3001CVC, PC54, 18500, G500…), lowercased, letters and digits only */
const sk = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Put the sheet's quantities on the AI's garments: each garment takes the sheet line with its color (and its style,
 * when the sheet names several products). Sheet lines no garment matched come back so the caller can add them.
 */
export function applySheetSizes<G extends { style?: string | null; color?: string | null; sizes?: Record<string, unknown> | null }>(garments: G[], sheet: SheetLine[]): { changed: number; unmatched: SheetLine[]; extra: Set<G> } {
  const used = new Set<SheetLine>(), got = new Set<G>(), extra = new Set<G>();
  let changed = 0;
  for (const g of garments) {
    const cands = sheet.filter((s) => !used.has(s) && sameColorLoose(String(g.color || ""), s.color));
    const st = sk(String(g.style || ""));
    const pick = cands.length > 1 && st ? cands.find((s) => sk(s.product).includes(st)) || null : cands.length === 1 ? cands[0] : null;
    if (!pick) continue;
    used.add(pick);
    const before = JSON.stringify(Object.entries(g.sizes || {}).map(([k, v]) => [normSize(k), +(v as number) || 0]).filter(([, v]) => v).sort());
    const after = JSON.stringify(Object.entries(pick.sizes).sort());
    if (before !== after) changed++;
    g.sizes = { ...pick.sizes };
    got.add(g);
  }
  // the same color read as several garments (a row per size): the sheet line is on the first; the rest would count twice
  for (const g of garments) if (!got.has(g) && [...used].some((s) => sameColorLoose(String(g.color || ""), s.color) && garments.some((h) => got.has(h) && sameColorLoose(String(h.color || ""), s.color) && sk(String(h.style || "")) === sk(String(g.style || ""))))) extra.add(g);
  return { changed, unmatched: sheet.filter((s) => !used.has(s)), extra };
}
