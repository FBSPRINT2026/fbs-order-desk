/**
 * Names & numbers (Oct 31, Nick: "a simple name and number builder… upload a spreadsheet… take the very first name… put
 * it on the back… select the fonts… sometimes it's name only, sometimes it's number only… if the order gets approved…
 * make a gang sheet… put all the names together… or the names and numbers together… already spaced out and ready").
 *
 * One place that knows how a roster prints, for every page that shows or makes it: the Mockup Creator's builder (the
 * first shirt's name and number on the mockup, for approval) and the gang sheet (every shirt's, as transfers).
 * Browser only (it lays text out with the page's fonts).
 */
import { cssFamily, loadFont } from "@/lib/webfonts";
import { fontOf, UNITS_PER_IN, type RosterRow } from "@/lib/designerArt";

export type RosterShow = "both" | "name" | "number";
/** how a print's names and numbers look (Imprint.roster), and the list */
export type RosterSpec = {
  rows: RosterRow[]; show: RosterShow; font: string; color: string;
  /** the letters' height and the numbers' height (inches), and the space between them */ nameIn: number; numIn: number; gapIn: number;
  /** an outline around the letters (a second color), "" for none */ outline?: string;
  location: string;
};
export const ROSTER_DEFAULT: Omit<RosterSpec, "rows" | "location"> = { show: "both", font: "Graduate", color: "#FFFFFF", nameIn: 2, numIn: 8, gapIn: 0.5, outline: "" };

/* ---------- reading a list ---------- */
const SIZE_RE = /^(y?(xxs|xs|s|m|l|xl)|\d?x{0,3}l|[2-6]xl|os|one size|youth (xs|s|m|l|xl)|adult (xs|s|m|l|xl))$/i;
/**
 * A pasted or uploaded list into rows: a header row names the columns ("Name", "Number" / "#" / "No", "Size") when there
 * is one; else each column is told by what's in it (all digits: the number; S, M, XL…: the size; the rest: the name).
 */
export function parseRoster(table: string[][]): RosterRow[] {
  const rows = table.map((r) => r.map((c) => (c || "").trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0].map((c) => c.toLowerCase());
  const hName = head.findIndex((c) => /\b(name|last|player|text)\b/.test(c));
  const hNum = head.findIndex((c) => /^(#|no\.?|num(ber)?|jersey( ?#)?|number)$/.test(c) || /\bnumber\b/.test(c));
  const hSize = head.findIndex((c) => /\bsize\b/.test(c));
  let body = rows, iName = hName, iNum = hNum, iSize = hSize;
  if (hName >= 0 || hNum >= 0) body = rows.slice(1);
  else {
    const cols = Math.max(...rows.map((r) => r.length));
    const share = (i: number, re: RegExp) => rows.filter((r) => re.test(r[i] || "")).length / rows.length;
    const kinds = Array.from({ length: cols }, (_, i) => ({ i, num: share(i, /^\d{1,3}$/), size: share(i, SIZE_RE) }));
    iNum = kinds.filter((k) => k.num > 0.6).sort((a, b) => b.num - a.num)[0]?.i ?? -1;
    iSize = kinds.filter((k) => k.i !== iNum && k.size > 0.6).sort((a, b) => b.size - a.size)[0]?.i ?? -1;
    iName = kinds.find((k) => k.i !== iNum && k.i !== iSize)?.i ?? -1;
  }
  return body.map((r) => ({ name: iName >= 0 ? r[iName] || "" : "", number: iNum >= 0 ? (r[iNum] || "").replace(/^#/, "") : "", size: iSize >= 0 ? (r[iSize] || "").toUpperCase() : "" }))
    .filter((r) => r.name || r.number);
}
const HEAD_WORD = /^(name|names|last|first|player|number|numbers|no\.?|#|jersey|size|sizes)$/i;
/**
 * One typed line with no commas or tabs ("SMITH 23 L", "VAN DYKE #7", "23", "JOHN SMITH") as [name, number, size]: a
 * size word at the end is the size, a 1–3 digit number (with or without #) is the number, the other words the name. A
 * line of only column names ("Name Number Size") stays as words, so it's read as the header.
 */
function spacedLine(ln: string): string[] {
  const w = ln.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return [];
  if (w.every((x) => HEAD_WORD.test(x))) return w;
  let size = "", num = "";
  if (w.length > 1 && SIZE_RE.test(w[w.length - 1])) size = w.pop()!;
  const ni = w.findIndex((x) => /^#?\d{1,3}$/.test(x));
  if (ni >= 0) num = w.splice(ni, 1)[0];
  if (!size && w.length > 1 && SIZE_RE.test(w[w.length - 1])) size = w.pop()!;
  return [w.join(" "), num, size];
}
/** text lines ("SMITH, 23, L" / "SMITH 23 L" / tab-separated / a CSV) into a table */
export const textTable = (t: string): string[][] => t.split(/\r?\n/).map((ln) => (ln.includes("\t") ? ln.split("\t") : ln.includes(",") ? ln.split(/\s*,\s*/) : spacedLine(ln)).map((c) => c.replace(/^"|"$/g, "")));

/** a spreadsheet file (.csv, .tsv, .txt, .xlsx) into a table: an .xlsx is read here (a zip of XML; its first sheet) */
export async function fileTable(f: File): Promise<string[][]> {
  if (!/\.xlsx$|\.xlsm$/i.test(f.name)) return textTable(await f.text());
  const buf = new Uint8Array(await f.arrayBuffer());
  const files = await unzip(buf);
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = files["xl/worksheets/sheet1.xml"] || Object.entries(files).find(([k]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))?.[1] || "";
  const out: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1], t = /\bt="([^"]+)"/.exec(c[1])?.[1], inner = c[2] || "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const val = t === "s" && v != null ? shared[+v] ?? "" : t === "inlineStr" ? unxml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")) : v != null ? unxml(v) : "";
      let i = cells.length;
      if (ref) { i = 0; for (const ch of ref) i = i * 26 + (ch.charCodeAt(0) - 64); i -= 1; }
      while (cells.length < i) cells.push("");
      cells[i] = val.trim();
    }
    out.push(cells);
  }
  return out;
}
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
/** the text files in a zip (deflate through the browser's own DecompressionStream) */
async function unzip(buf: Uint8Array): Promise<Record<string, string>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That file isn't a spreadsheet we can read. Save it as .xlsx or .csv.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
    const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    if (method === 0) { out[name] = new TextDecoder().decode(data); continue; }
    const ds = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    out[name] = await new Response(ds).text();
  }
  return out;
}

/* ---------- drawing ---------- */
function b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @font-face rules with the font files built in, so a saved SVG looks the same anywhere (the Design Lab's too) */
const fontCss = new Map<string, Promise<string>>();
export async function embeddedFonts(list: { font: string; weight: number }[]) {
  const out: string[] = [], done = new Set<string>();
  for (const { font, weight } of list) {
    const key = `${font}:${weight}`;
    if (done.has(key) || !font) continue;
    done.add(key);
    if (!fontCss.has(key)) fontCss.set(key, oneFont(font, weight));
    const css = await fontCss.get(key)!;
    if (css) out.push(css);
  }
  return out.join("\n");
}
async function oneFont(font: string, weight: number): Promise<string> {
  {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${cssFamily(font, weight)}&display=swap`)).text();
      const block = (css.match(/\/\*\s*latin\s*\*\/\s*(@font-face\s*\{[^}]*\})/) || css.match(/(@font-face\s*\{[^}]*\})\s*$/) || [])[1];
      const url = block?.match(/url\((https:[^)]+)\)/)?.[1];
      if (!block || !url) return "";
      return block.replace(url, `data:font/woff2;base64,${b64(await (await fetch(url)).arrayBuffer())}`);
    } catch { return ""; /* that font falls back */ }
  }
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** a capital letter's height as a share of the font size, when the browser can't measure the letters themselves */
const CAP = 0.72;
/**
 * How a line of text really sits in its font: the ink's height above and below the baseline and its reach left and right
 * of the line's center, per pixel of font size. Measured from the letters themselves, so every font (a tall slab, a short
 * script) is the height asked for and nothing is cut off at the top or sides.
 */
function inkOf(ctx: CanvasRenderingContext2D, font: string, weight: number, text: string) {
  ctx.font = `${weight} 200px '${font}'`;
  const m = ctx.measureText(text), k = 1 / 200;
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  if (!(asc > 0)) return { asc: CAP, desc: 0.04, half: (m.width * k) / 2 + 0.02 };
  const adv = m.width / 2;
  return { asc: asc * k, desc: Math.max(0, desc) * k, half: Math.max(adv, m.actualBoundingBoxLeft + adv, m.actualBoundingBoxRight - adv) * k };
}

/**
 * One shirt's names & numbers as SVG, in the Design Lab's units (50 to the inch): the name over the number, centered,
 * each line's capitals the height set. `part` picks the name, the number or both (the gang sheet makes them apart).
 * Returns the SVG and its size; `embed` builds the font into it (for files that leave the page).
 */
export async function rosterSvg(spec: Pick<RosterSpec, "show" | "font" | "color" | "nameIn" | "numIn" | "gapIn" | "outline">, row: RosterRow, part: RosterShow = spec.show, embed = false): Promise<{ svg: string; w: number; h: number }> {
  const f = fontOf(spec.font), weight = f.weight;
  await loadFont(spec.font, weight);
  try { await document.fonts.load(`${weight} 200px '${spec.font}'`); } catch { /* measured with what's there */ }
  const ctx = document.createElement("canvas").getContext("2d")!;
  const lines: { text: string; inches: number }[] = [];
  const name = (row.name || "").trim(), num = (row.number || "").trim();
  if ((part === "both" || part === "name") && name) lines.push({ text: name.toUpperCase(), inches: spec.nameIn });
  if ((part === "both" || part === "number") && num) lines.push({ text: num, inches: spec.numIn });
  if (!lines.length) lines.push({ text: part === "number" ? "00" : "NAME", inches: part === "number" ? spec.numIn : spec.nameIn });
  const ow = spec.outline ? Math.max(2, 0.06 * UNITS_PER_IN) : 0;
  let y = ow, half = 0;
  const parts: string[] = [];
  const gap = spec.gapIn * UNITS_PER_IN;
  for (const [i, ln] of lines.entries()) {
    // the letters (capitals and digits) the height asked for, measured in this font
    const ink = inkOf(ctx, spec.font, weight, ln.text);
    const size = (ln.inches * UNITS_PER_IN) / ink.asc;
    half = Math.max(half, ink.half * size + ow);
    const base = y + ink.asc * size;
    parts.push(`<text x="0" y="${base.toFixed(1)}" text-anchor="middle" font-family="'${esc(spec.font)}'" font-weight="${weight}" font-size="${size.toFixed(1)}" fill="${spec.color}"${spec.outline ? ` stroke="${spec.outline}" stroke-width="${(ow * 2).toFixed(1)}" paint-order="stroke" stroke-linejoin="round"` : ""}>${esc(ln.text)}</text>`);
    y = base + ink.desc * size + (i < lines.length - 1 ? gap + ow * 2 : 0);
  }
  const h = y + ow, w = half * 2;
  const fonts = embed ? await embeddedFonts([{ font: spec.font, weight }]) : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(-w / 2).toFixed(1)} 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${(w / UNITS_PER_IN).toFixed(2)}in" height="${(h / UNITS_PER_IN).toFixed(2)}in">${fonts ? `<defs><style>${fonts}</style></defs>` : ""}${parts.join("")}</svg>`;
  return { svg, w, h };
}

/** an SVG drawn to a PNG at `dpi` (300 for transfers), its longest side at most `max` pixels */
export async function svgPng(svg: string, wIn: number, hIn: number, dpi = 300, max = 6000): Promise<HTMLCanvasElement> {
  const k = Math.min(dpi, max / Math.max(wIn, hIn, 0.01));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    await new Promise((r) => setTimeout(r, 60));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(wIn * k)); c.height = Math.max(1, Math.round(hIn * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/** the roster's pieces for a gang sheet: `apart` = every name and every number its own transfer (the same text adds up,
 *  cheaper on film; put together by hand); else each shirt's name and number together, spaced and ready */
export async function rosterPieces(spec: RosterSpec, apart: boolean): Promise<{ label: string; png: string; wIn: number; hIn: number; qty: number; px: [number, number] }[]> {
  const want = new Map<string, { row: RosterRow; part: RosterShow; qty: number; label: string }>();
  const add = (row: RosterRow, part: RosterShow, label: string) => { const k = `${part}|${part === "number" ? row.number : part === "name" ? row.name.toUpperCase() : `${row.name.toUpperCase()}|${row.number}`}`; const x = want.get(k); if (x) x.qty += 1; else want.set(k, { row, part, qty: 1, label }); };
  for (const r of spec.rows) {
    if (apart || spec.show !== "both") {
      if (spec.show !== "number" && r.name.trim()) add(r, "name", `Name ${r.name.toUpperCase()}`);
      if (spec.show !== "name" && r.number.trim()) add(r, "number", `Number ${r.number}`);
    } else if (r.name.trim() || r.number.trim()) add(r, "both", [r.name.toUpperCase(), r.number].filter(Boolean).join(" "));
  }
  const out: { label: string; png: string; wIn: number; hIn: number; qty: number; px: [number, number] }[] = [];
  for (const x of want.values()) {
    const { svg, w, h } = await rosterSvg(spec, x.row, x.part, true);
    const c = await svgPng(svg, w / UNITS_PER_IN, h / UNITS_PER_IN);
    out.push({ px: [c.width, c.height], label: x.label, png: c.toDataURL("image/png"), wIn: Math.round((w / UNITS_PER_IN) * 100) / 100, hIn: Math.round((h / UNITS_PER_IN) * 100) / 100, qty: x.qty });
  }
  return out;
}
