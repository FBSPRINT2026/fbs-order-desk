/**
 * A size grid read off a PDF by where each number sits (Nick, Nov 13 2026: Tiger Blue's #50030 and #40382 came in with
 * sizes slid into the wrong columns). The PDF's words reach the AI as one line of text, so an empty size box simply
 * vanishes and "9 4 5 8" under YS YM YL YXL reads as YXS YS YM YL. Here every number is put under the size header it
 * stands beneath (its x position), on any form with a header row of sizes: an order form, a size breakdown, a roster
 * with a size grid. Browser-safe and pure: lib/pdfTextServer.ts feeds it pdf.js's text items.
 */
export type GridItem = { str: string; x: number; y: number; w: number; page: number };
export type GridRow = { heading: string; label: string; sizes: Record<string, number>; qty: number | null };

const SIZE = /^(Y?X{0,2}S|Y?M|Y?X{0,3}L|YXXL|[2-6]X(L)?|XXS|XXXL|[2-6]XL|OS|OSFA|ONE SIZE|[2-6]T|NB|[0-9]{1,2}M)$/i;
const QTY = /^(QTY|QUANTITY|TOTAL QTY|PCS|PIECES|TOTAL)$/i;
const canon = (s: string) => { const u = s.toUpperCase().replace(/\s+/g, " ").trim(); return u === "XXL" ? "2XL" : u === "XXXL" ? "3XL" : u === "YXXL" ? "Y2XL" : u; };

/** Lines of text items (same page, about the same height), top to bottom, each left to right. */
export function lines(items: GridItem[]) {
  const out: GridItem[][] = [];
  for (const it of [...items].filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    const l = out[out.length - 1];
    if (l && l[0].page === it.page && Math.abs(l[0].y - it.y) <= 2.5) l.push(it); else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

export function sizeGrid(items: GridItem[]): GridRow[] {
  const ls = lines(items), rows: GridRow[] = [];
  let cols: { size: string; c: number }[] | null = null, qtyC: number | null = null, gap = 0, heading = "", lastText = "", page = 0;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], words = l.map((x) => x.str.trim());
    // a table that carries on to the next page keeps its heading (a "GROUP: …" doesn't repeat there)
    if (l[0].page !== page) { page = l[0].page; lastText = ""; }
    const sz = l.filter((x) => SIZE.test(x.str.trim()));
    // a header row: four or more sizes side by side
    if (sz.length >= 4 && sz.length >= words.length * 0.4) {
      cols = sz.map((x) => ({ size: canon(x.str), c: x.x + x.w / 2 }));
      const q = l.find((x) => QTY.test(x.str.trim()) && x.x > sz[sz.length - 1].x);
      qtyC = q ? q.x + q.w / 2 : null;
      const cs = cols.map((c) => c.c).sort((a, b) => a - b);
      gap = Math.min(...cs.slice(1).map((c, k) => c - cs[k]).filter((d) => d > 0.5));
      heading = lastText || heading;
      lastText = "";
      continue;
    }
    const nums = l.filter((x) => /^\d{1,4}$/.test(x.str.trim()));
    if (!cols || !nums.length) { if (!nums.length && words.join(" ").length > 2) lastText = words.join(" ").slice(0, 80); continue; }
    const first = Math.min(...cols.map((c) => c.c)), last = Math.max(...cols.map((c) => c.c));
    const sizes: Record<string, number> = {};
    let qty: number | null = null, any = false;
    for (const n of nums) {
      const c = n.x + n.w / 2;
      if (qtyC != null && Math.abs(c - qtyC) < gap * 0.6) { qty = +n.str; continue; }
      if (c < first - gap * 0.6 || c > last + gap * 0.6) continue;
      const near = cols.reduce((b, k) => (Math.abs(k.c - c) < Math.abs(b.c - c) ? k : b));
      if (Math.abs(near.c - c) > gap * 0.6) continue;
      sizes[near.size] = (sizes[near.size] || 0) + +n.str; any = true;
    }
    if (!any) continue;
    const label = l.filter((x) => x.x + x.w / 2 < first - gap * 0.6).map((x) => x.str.trim()).join(" ").replace(/\s+/g, " ").slice(0, 120);
    rows.push({ heading, label, sizes, qty });
  }
  return rows;
}

/** The grid as lines for the order reader: "[GROUP: RAGE] Screen Printing 3001 Black: YM 1, S 1, M 4, XL 2, 2XL 2 = 10 (Qty 10)" */
export function sizeGridText(rows: GridRow[]): string {
  return rows.map((r) => {
    const sum = Object.values(r.sizes).reduce((a, b) => a + b, 0);
    return `${r.heading ? `[${r.heading}] ` : ""}${r.label || "(row)"}: ${Object.entries(r.sizes).map(([s, q]) => `${s} ${q}`).join(", ")} = ${sum}${r.qty != null ? ` (Qty column ${r.qty}${r.qty === sum ? "" : " — doesn't match"})` : ""}`;
  }).join("\n");
}

/**
 * A PO table whose sizes are rows (Nick, Nov 16 2026, Nine18's All My Sons POs): a garment's row, then one row per size
 * under it ("10 | MEDIUM", "2 | 2X-LARGE"), a quantity on the garment's own row for a one-size item ("12 | STC15 …
 * BEANIE"), and "PERSONALIZATION" rows with the names under them. The PDF's words come out of order (every quantity
 * first, then the descriptions), so the reading put the jacket's "L 2" on the beanies and lost the last size row. Here
 * each row is put back together by its height on the page and read in order. Browser-safe and pure, like sizeGrid.
 */
export type RowGarment = { label: string; sizes: Record<string, number>; one: number | null; pers: number; names: string[] };
const SIZE_WORD: [RegExp, string][] = [
  [/^(YOUTH|YTH|Y)[\s-]*(X-?SMALL|XS)$/i, "YXS"], [/^(YOUTH|YTH|Y)[\s-]*(SMALL|S)$/i, "YS"], [/^(YOUTH|YTH|Y)[\s-]*(MEDIUM|MED|M)$/i, "YM"],
  [/^(YOUTH|YTH|Y)[\s-]*(LARGE|LG|L)$/i, "YL"], [/^(YOUTH|YTH|Y)[\s-]*(X-?LARGE|XL)$/i, "YXL"],
  [/^(X-?SMALL|XS)$/i, "XS"], [/^(SMALL|SM|S)$/i, "S"], [/^(MEDIUM|MED|MD|M)$/i, "M"], [/^(LARGE|LG|L)$/i, "L"],
  [/^(X-?LARGE|XLARGE|XL|1X)$/i, "XL"], [/^(2X-?LARGE|XX-?LARGE|2XL|XXL|2X)$/i, "2XL"], [/^(3X-?LARGE|XXX-?LARGE|3XL|XXXL|3X)$/i, "3XL"],
  [/^(4X-?LARGE|4XL|4X)$/i, "4XL"], [/^(5X-?LARGE|5XL|5X)$/i, "5XL"], [/^(6X-?LARGE|6XL|6X)$/i, "6XL"],
  [/^(OSFA|OS|ONE SIZE|ONE SIZE FITS ALL|ADJUSTABLE)$/i, "OS"],
];
const sizeWord = (s: string) => { const t = s.trim().replace(/\s+/g, " "); for (const [re, z] of SIZE_WORD) if (re.test(t)) return z; return ""; };
const HEAD = /^(QTY|QUANTITY|DESCRIPTION|ITEM|UNIT PRICE|PRICE|TOTAL|AMOUNT)$/i;

export function sizeRows(items: GridItem[]): RowGarment[] {
  const ls = lines(items);
  const out: RowGarment[] = [];
  let started = false, cur: RowGarment | null = null, inPers = false, sizeRowsSeen = 0;
  for (const l of ls) {
    const words = l.map((x) => x.str.trim()).filter((w) => w && !/^[-–$]+$/.test(w));
    if (!words.length) continue;
    // the table starts under its header row (a quantity and a description column)
    if (!started) { if (words.some((w) => /^(QTY|QUANTITY)$/i.test(w)) && words.some((w) => /^(DESCRIPTION|ITEM)$/i.test(w))) started = true; continue; }
    if (words.every((w) => HEAD.test(w))) continue;
    if (/^(SUB\s*TOTAL|TOTAL|GRAND TOTAL)\b/i.test(words[0])) break;
    const nums = words.filter((w) => /^\d{1,4}$/.test(w)).map(Number);
    const text = words.filter((w) => !/^\d{1,4}$/.test(w) && !/^\$?[\d,]+\.\d{2}$/.test(w)).join(" ").replace(/\s+/g, " ").trim();
    const q = nums.length ? nums[0] : null;
    const z = sizeWord(text);
    if (z && cur) { if (q != null) { cur.sizes[z] = (cur.sizes[z] || 0) + q; sizeRowsSeen++; } inPers = false; continue; }
    if (/^PERSONALI[SZ]ATION\b/i.test(text) && cur) { cur.pers += q || 1; inPers = true; continue; }
    if (inPers && cur && q == null && text && text.length <= 40) { cur.names.push(text); continue; }
    inPers = false;
    // a garment's row: words with a style-like code or several words; its own quantity is a one-size count
    if (text.length >= 4 && /[A-Za-z]{2,}/.test(text)) {
      cur = { label: text.slice(0, 120), sizes: {}, one: q, pers: 0, names: [] };
      out.push(cur);
    }
  }
  // only the row layout: at least two size rows in all, or it isn't this kind of table
  return sizeRowsSeen >= 2 ? out.filter((g) => Object.keys(g.sizes).length || g.one != null) : [];
}

/** The rows as lines for the order reader: "JST56 DRIVER JACKET FOREST: L 2 = 2 · PERSONALIZATION 2: Jermaine Watts / Driver" */
export function sizeRowsText(rows: RowGarment[]): string {
  return rows.map((r) => {
    const sz = Object.entries(r.sizes), sum = sz.reduce((a, [, n]) => a + n, 0);
    const pcs = sz.length ? `${sz.map(([s, n]) => `${s} ${n}`).join(", ")} = ${sum}${r.one != null && r.one !== sum ? ` (its own row says ${r.one})` : ""}` : `one size ${r.one}`;
    return `${r.label}: ${pcs}${r.pers ? ` · PERSONALIZATION ${r.pers}${r.names.length ? `: ${r.names.join(" / ")}` : ""}` : ""}`;
  }).join("\n");
}

/** A PDF's words in reading order, a line at a time (Nov 16 2026: pdf.js gives some POs every quantity first, then every
 * description, so "5 SMALL" came apart and the paperwork check read the wrong sizes) */
export function readingText(items: GridItem[]): string {
  return lines(items).map((l) => l.map((x) => x.str.normalize("NFKC").trim()).filter(Boolean).join(" ")).filter(Boolean).join("\n");
}
