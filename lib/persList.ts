import { normSize } from "@/lib/ai/normalize";
import type { Size } from "@/lib/pricing";

/**
 * A personalization name list (Oct 30, Nick: "upload a spreadsheet by giving the sizes and the name… if you had a ton to
 * do"): rows of name, title, size, quantity and sometimes the style, read from a spreadsheet's text (lib/officeText:
 * tab-separated rows, or CSV). The header row says which column is which; without one, a column of sizes is the size and
 * the first text column the name.
 */
export type PersRow = { name: string; title: string; size: Size | ""; qty: number; style: string };
const H = {
  name: /^(full\s*)?name|^employee|^person|^first|^embroider|^personali[sz]/i,
  last: /^last/i,
  title: /^(title|position|job|dept|department|role)/i,
  size: /^size/i,
  qty: /^(qty|quantity|count|#|pcs|pieces)/i,
  style: /^(style|item|garment|product|sku)/i,
};

export function parsePersList(text: string): PersRow[] {
  const rows = text.split(/\r?\n/).map((l) => (l.includes("\t") ? l.split("\t") : splitCsv(l)).map((c) => c.trim())).filter((r) => r.some(Boolean) && !/^\[sheet:/i.test(r[0] || ""));
  if (!rows.length) return [];
  const hi = rows.findIndex((r) => r.some((c) => H.name.test(c) || H.size.test(c)));
  const head = hi >= 0 ? rows[hi] : null;
  const col = (re: RegExp) => (head ? head.findIndex((c) => re.test(c)) : -1);
  let ci = { name: col(H.name), last: col(H.last), title: col(H.title), size: col(H.size), qty: col(H.qty), style: col(H.style) };
  const body = rows.slice(hi >= 0 ? hi + 1 : 0);
  if (!head) {
    // no header: the column that's mostly sizes is the size; the first other text column the name, the next the title
    const w = Math.max(...body.map((r) => r.length));
    const sizeCol = [...Array(w).keys()].find((i) => body.filter((r) => normSize(r[i] || "")).length >= body.length / 2) ?? -1;
    const text = [...Array(w).keys()].filter((i) => i !== sizeCol && body.some((r) => /[a-z]/i.test(r[i] || "")));
    ci = { name: text[0] ?? -1, last: -1, title: text[1] ?? -1, size: sizeCol, qty: -1, style: -1 };
  }
  const out: PersRow[] = [];
  for (const r of body) {
    const name = [r[ci.name] || "", ci.last >= 0 ? r[ci.last] || "" : ""].join(" ").trim(), title = ci.title >= 0 ? r[ci.title] || "" : "";
    if (!name && !title) continue;
    if (/^total/i.test(name)) continue;
    out.push({ name, title, size: (ci.size >= 0 && normSize(r[ci.size] || "")) || "", qty: ci.qty >= 0 ? Math.max(1, Math.floor(+r[ci.qty] || 1)) : 1, style: ci.style >= 0 ? r[ci.style] || "" : "" });
  }
  return out.slice(0, 2000);
}

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
