"use client";
import { useEffect, useMemo, useState } from "react";

/**
 * Office files shown right in the page (Nov 1, Nick: "a little native document viewer for Excel files… on that order we
 * just did for the Baton Rouge shorts 43152 [the PO] I had to download an Excel as opposed to just viewing it… for any
 * Microsoft Office tool"). Part of the one quick look (components/MailFolders QuickLook), so every place that opens a
 * file there (an email's attachments, ClickUp jobs, Order resources, Production files) shows these too:
 * - Excel (.xlsx / .xlsm): every sheet as a tab, the cells as the sheet has them (bold, colors, fills, merged cells,
 *   column widths, numbers / money / dates / percents in the sheet's own formats), fitted to the window, never sideways;
 * - Word (.docx): paragraphs, headings, bold / italic, lists and tables;
 * - PowerPoint (.pptx): each slide's text;
 * - .csv / .tsv / .txt as they are.
 * Read in the browser, no library: an Office file is a zip of XML files, unzipped with the browser's own
 * DecompressionStream and read with DOMParser. Old binary .xls / .doc / .ppt aren't readable this way (still a download).
 */

export type OfficeKind = "sheet" | "doc" | "slides" | "csv" | "text";
export function officeKind(name: string, type = ""): OfficeKind | null {
  const n = name.toLowerCase().split("?")[0];
  if (/\.(xlsx|xlsm)$/.test(n) || /spreadsheetml/.test(type)) return "sheet";
  if (/\.docx$/.test(n) || /wordprocessingml/.test(type)) return "doc";
  if (/\.pptx$/.test(n) || /presentationml/.test(type)) return "slides";
  if (/\.(csv|tsv)$/.test(n) || /^text\/(csv|tab-separated)/.test(type)) return "csv";
  if (/\.txt$/.test(n) || /^text\/plain/.test(type)) return "text";
  return null;
}

/* ---------- zip ---------- */
async function unzip(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, () => Promise<string>>();
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count && p + 46 <= buf.byteLength; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    out.set(name, async () => {
      const ln = dv.getUint16(local + 26, true), le = dv.getUint16(local + 28, true);
      const data = u8.slice(local + 30 + ln + le, local + 30 + ln + le + csize);
      if (method === 0) return dec.decode(data);
      const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return dec.decode(await new Response(s).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
/** children / descendants by local name (the files use several namespaces) */
const kids = (el: Element | Document | null | undefined, name: string) => (el ? Array.from((el as Element).children || []).filter((c) => c.localName === name) : []);
const kid = (el: Element | Document | null | undefined, name: string) => kids(el, name)[0] || null;
const all = (el: Element | Document | null | undefined, name: string) => (el ? Array.from(el.getElementsByTagNameNS("*", name)) : []);
const at = (el: Element | null, name: string) => (el ? el.getAttribute(name) ?? Array.from(el.attributes).find((a) => a.localName === name)?.value ?? null : null);
/** a part's relationship id (r:id), not its own id */
const rid = (el: Element | null) => (el ? Array.from(el.attributes).find((a) => a.localName === "id" && a.prefix)?.value || "" : "");
const hex = (v: string | null | undefined) => { const m = /^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(v || ""); return m ? `#${m[1]}` : undefined; };
/** a relationship file: id → target, resolved against the folder it belongs to */
async function rels(z: Map<string, () => Promise<string>>, file: string) {
  const dir = file.replace(/[^/]+$/, ""), r = z.get(`${dir}_rels/${file.split("/").pop()}.rels`);
  const m = new Map<string, string>();
  if (!r) return m;
  for (const e of all(xml(await r()), "Relationship")) {
    const t = at(e, "Target") || "";
    const parts = (t.startsWith("/") ? t.slice(1) : dir + t).split("/"), res: string[] = [];
    for (const s of parts) if (s === "..") res.pop(); else if (s && s !== ".") res.push(s);
    m.set(at(e, "Id") || "", res.join("/"));
  }
  return m;
}

/* ---------- Excel ---------- */
type Cell = { v: string; num?: boolean; b?: boolean; i?: boolean; u?: boolean; color?: string; bg?: string; align?: string; wrap?: boolean; big?: boolean };
type Sheet = { name: string; rows: Map<number, Map<number, Cell>>; maxR: number; maxC: number; widths: Map<number, number>; hiddenC: Set<number>; hiddenR: Set<number>; merges: { r1: number; c1: number; r2: number; c2: number }[]; cut: boolean };

const BUILTIN: Record<number, string> = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: "$#,##0", 6: "$#,##0", 7: "$#,##0.00", 8: "$#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm", 37: "#,##0", 38: "#,##0", 39: "#,##0.00", 40: "#,##0.00", 44: "$#,##0.00", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function general(n: number) {
  if (Number.isInteger(n)) return String(n);
  const s = Math.abs(n) >= 1e11 || Math.abs(n) < 1e-9 ? n.toExponential(5) : String(+n.toPrecision(10));
  return s;
}
function fmtNum(n: number, code: string): string {
  if (!code || /^general$/i.test(code) || code === "@") return general(n);
  const secs = code.split(";");
  let sec = n < 0 && secs[1] ? secs[1] : n === 0 && secs[2] ? secs[2] : secs[0];
  const paren = n < 0 && !!secs[1] && /\(/.test(sec);
  // what the format looks like once quoted text, colors / locales, spacing and fill characters are taken out
  const lits: string[] = [];
  sec = sec.replace(/"([^"]*)"/g, (_, t) => { lits.push(t); return ""; }).replace(/\\(.)/g, "$1");
  const bare = sec.replace(/\[[^\]]*\]/g, "").replace(/_.|\*./g, "");
  const isDate = /[dy]/i.test(bare) || (/[hs]/i.test(bare) && !/[0#]/.test(bare)) || (/m/i.test(bare) && !/[0#?]/.test(bare));
  if (isDate) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    if (isNaN(d.getTime())) return general(n);
    const D = d.getUTCDate(), M = d.getUTCMonth(), Y = d.getUTCFullYear(), h = d.getUTCHours(), mi = d.getUTCMinutes();
    const hasT = /h/i.test(bare), hasD = /[dy]/i.test(bare) || /mmm/i.test(bare);
    const t = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")}${/AM\/PM|A\/P/i.test(bare) ? (h < 12 ? " AM" : " PM") : ""}`;
    const date = /mmmm/i.test(bare) ? `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][M]} ${D}, ${Y}`
      : /mmm/i.test(bare) ? (/y/i.test(bare) ? `${/d/i.test(bare) ? `${D}-` : ""}${MON[M]}-${String(Y).slice(/yyyy/i.test(bare) ? 0 : 2)}` : `${D}-${MON[M]}`)
      : `${M + 1}/${D}/${/yyyy/i.test(bare) || !/y/i.test(bare) ? Y : String(Y).slice(2)}`;
    return hasD && hasT ? `${date} ${t}` : hasT ? t : date;
  }
  const abs = Math.abs(n);
  const pct = /%/.test(bare);
  const v = pct ? abs * 100 : abs;
  const dec = (/\.([0#?]+)/.exec(bare)?.[1] || "").length;
  if (/E\+/i.test(bare)) return (n < 0 ? "-" : "") + v.toExponential(dec);
  if (!/[0#?]/.test(bare)) return general(n);
  const s = v.toLocaleString("en-US", { minimumFractionDigits: /\.[0]/.test(bare) ? (/\.(0+)/.exec(bare)?.[1].length || 0) : 0, maximumFractionDigits: dec, useGrouping: /[0#?],[0#?]/.test(bare) });
  const cur = /\$/.test(bare) || /\$/.test(lits.join("")) ? "$" : /€/.test(sec) ? "€" : /£/.test(sec) ? "£" : "";
  const body = `${cur}${s}${pct ? "%" : ""}`;
  return paren ? `(${body})` : n < 0 && !(secs[1]) ? `-${body}` : body;
}

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const z = await unzip(buf);
  const get = async (n: string) => (z.has(n) ? xml(await z.get(n)!()) : null);
  const shared = all(await get("xl/sharedStrings.xml"), "si").map((si) => all(si, "t").filter((t) => t.parentElement?.localName !== "rPh").map((t) => t.textContent || "").join(""));
  // the theme's colors (fills and fonts often name a theme color, not a hex)
  const theme: string[] = [];
  const th = await get("xl/theme/theme1.xml");
  const scheme = all(th, "clrScheme")[0];
  if (scheme) for (const n of ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
    const e = kid(scheme, n), c = kid(e, "srgbClr") || kid(e, "sysClr");
    theme.push(hex(at(c, "val") === "windowText" ? "000000" : at(c, "val") === "window" ? "FFFFFF" : at(c, "lastClr") || at(c, "val")) || "#000000");
  }
  const color = (e: Element | null): string | undefined => {
    if (!e) return undefined;
    let c = hex(at(e, "rgb"));
    const ti = at(e, "theme");
    if (!c && ti != null) c = theme[+ti];
    if (!c) return undefined;
    const tint = +(at(e, "tint") || 0);
    if (!tint) return c;
    const ch = [1, 3, 5].map((k) => parseInt(c!.slice(k, k + 2), 16)).map((x) => Math.round(tint > 0 ? x + (255 - x) * tint : x * (1 + tint)));
    return `#${ch.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
  };
  const st = await get("xl/styles.xml");
  const fmts = new Map<number, string>(Object.entries(BUILTIN).map(([k, v]) => [+k, v]));
  for (const f of all(st, "numFmt")) fmts.set(+(at(f, "numFmtId") || 0), at(f, "formatCode") || "");
  const fonts = kids(kid(st?.documentElement, "fonts"), "font").map((f) => ({ b: !!kid(f, "b") && at(kid(f, "b"), "val") !== "0", i: !!kid(f, "i") && at(kid(f, "i"), "val") !== "0", u: !!kid(f, "u"), color: color(kid(f, "color")), big: +(at(kid(f, "sz"), "val") || 11) >= 14 }));
  const fills = kids(kid(st?.documentElement, "fills"), "fill").map((f) => { const p = kid(f, "patternFill"); return p && at(p, "patternType") && at(p, "patternType") !== "none" ? color(kid(p, "fgColor")) : undefined; });
  const xfs = kids(kid(st?.documentElement, "cellXfs"), "xf").map((x) => { const a = kid(x, "alignment"); return { fmt: fmts.get(+(at(x, "numFmtId") || 0)) || "General", font: fonts[+(at(x, "fontId") || 0)], fill: fills[+(at(x, "fillId") || 0)], align: at(a, "horizontal") || undefined, wrap: at(a, "wrapText") === "1" || at(a, "wrapText") === "true" }; });

  const wb = await get("xl/workbook.xml"), wr = await rels(z, "xl/workbook.xml");
  const sheets: Sheet[] = [];
  const colOf = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rc = (ref: string) => ({ r: +(ref.replace(/[A-Z]+/i, "")) - 1, c: colOf(ref.toUpperCase()) });
  for (const s of all(wb, "sheet")) {
    if (at(s, "state") === "hidden" || at(s, "state") === "veryHidden") continue;
    const file = wr.get(rid(s)) || "";
    const doc = await get(file);
    if (!doc) continue;
    const sh: Sheet = { name: at(s, "name") || "Sheet", rows: new Map(), maxR: -1, maxC: -1, widths: new Map(), hiddenC: new Set(), hiddenR: new Set(), merges: [], cut: false };
    for (const c of all(doc, "col")) for (let k = +(at(c, "min") || 1) - 1; k <= +(at(c, "max") || 1) - 1 && k < 200; k++) { if (/^(1|true)$/.test(at(c, "hidden") || "")) sh.hiddenC.add(k); if (at(c, "width")) sh.widths.set(k, +at(c, "width")!); }
    let ri = 0;
    for (const row of all(doc, "row")) {
      const r = at(row, "r") ? +at(row, "r")! - 1 : ri;
      ri = r + 1;
      if (r >= 2000) { sh.cut = true; break; }
      if (/^(1|true)$/.test(at(row, "hidden") || "")) sh.hiddenR.add(r);
      let ci = 0;
      for (const c of kids(row, "c")) {
        const ref = at(c, "r"), col = ref ? colOf(ref) : ci;
        ci = col + 1;
        if (col >= 80) continue;
        const t = at(c, "t"), v = kid(c, "v")?.textContent ?? null, xf = xfs[+(at(c, "s") || 0)];
        let text = "", num = false;
        if (t === "s") text = shared[+(v || 0)] ?? "";
        else if (t === "inlineStr") text = all(c, "t").map((x) => x.textContent || "").join("");
        else if (t === "str" || t === "e") text = v ?? "";
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (v != null && v !== "") { const n = +v; num = !isNaN(n); text = num ? fmtNum(n, xf?.fmt || "General") : v; }
        if (!text && !xf?.fill) continue;
        if (!sh.rows.has(r)) sh.rows.set(r, new Map());
        sh.rows.get(r)!.set(col, { v: text, num, b: xf?.font?.b, i: xf?.font?.i, u: xf?.font?.u, color: xf?.font?.color, bg: xf?.fill, align: xf?.align, wrap: xf?.wrap, big: xf?.font?.big });
        // the sheet's size is where its text is (a sheet colored white to row 1,000 isn't 1,000 rows)
        if (text) { sh.maxR = Math.max(sh.maxR, r); sh.maxC = Math.max(sh.maxC, col); }
      }
    }
    for (const m of all(doc, "mergeCell")) { const [a, b] = (at(m, "ref") || "").split(":"); if (!a || !b) continue; const p = rc(a), q = rc(b); if (p.r > sh.maxR || p.c > sh.maxC) continue; sh.merges.push({ r1: p.r, c1: p.c, r2: Math.min(q.r, sh.maxR), c2: Math.min(q.c, sh.maxC) }); }
    sheets.push(sh);
  }
  return sheets;
}

const letters = (c: number) => { let s = ""; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function SheetGrid({ sh }: { sh: Sheet }) {
  const cols = Array.from({ length: sh.maxC + 1 }, (_, c) => c).filter((c) => !sh.hiddenC.has(c));
  const rows = Array.from({ length: sh.maxR + 1 }, (_, r) => r).filter((r) => !sh.hiddenR.has(r));
  if (!cols.length || !rows.length) return <p className="ofv-empty faint">This sheet is empty.</p>;
  // merged cells: the top-left one spans, the rest are skipped
  const span = new Map<string, { rs: number; cs: number }>(), skip = new Set<string>();
  for (const m of sh.merges) {
    const cs = cols.filter((c) => c >= m.c1 && c <= m.c2).length, rs = rows.filter((r) => r >= m.r1 && r <= m.r2).length;
    if (cs * rs <= 1) continue;
    span.set(`${m.r1}:${m.c1}`, { rs, cs });
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) skip.add(`${r}:${c}`);
  }
  // a column is at least as wide as its longest number or date (they stay on one line, Excel would show ####)
  const numW = (c: number) => { let m = 0; sh.rows.forEach((row, r) => { const x = row.get(c); if (x?.num && !skip.has(`${r}:${c}`) && !span.has(`${r}:${c}`)) m = Math.max(m, x.v.length); }); return m ? m * 1.05 + 1 : 0; };
  const w = cols.map((c) => Math.max(2, sh.widths.get(c) ?? 8.43, numW(c))), tot = w.reduce((a, b) => a + b, 0);
  return (
    // fitted to the window (no sideways scroll, Oct 30): each column its share of the sheet's own widths, text wraps
    <table className="ofv-grid" data-nofit data-notranslate style={{ width: `min(100%, ${Math.round(tot * 7.5 + 40)}px)` }}>
      <colgroup><col className="ofv-rn" />{w.map((x, k) => <col key={cols[k]} style={{ width: `${((x / tot) * 100).toFixed(2)}%` }} />)}</colgroup>
      <thead><tr><th />{cols.map((c) => <th key={c}>{letters(c)}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <th>{r + 1}</th>
            {cols.map((c) => {
              if (skip.has(`${r}:${c}`)) return null;
              const x = sh.rows.get(r)?.get(c), sp = span.get(`${r}:${c}`);
              const al = x?.align && /^(left|center|right)$/.test(x.align) ? x.align : x?.align === "centerContinuous" ? "center" : x?.num ? "right" : undefined;
              return <td key={c} rowSpan={sp?.rs} colSpan={sp?.cs} className={x?.num ? "n" : undefined}
                style={x ? { fontWeight: x.b ? 700 : undefined, fontStyle: x.i ? "italic" : undefined, textDecoration: x.u ? "underline" : undefined, color: x.color && x.color.toLowerCase() !== "#000000" ? x.color : undefined, background: x.bg, textAlign: al as "left" | "center" | "right" | undefined, fontSize: x.big ? "1.15em" : undefined } : undefined}>{x?.v}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- Word ---------- */
type Run = { t: string; b?: boolean; i?: boolean; u?: boolean; color?: string };
type Para = { kind: "p"; runs: Run[]; h?: number; list?: boolean; align?: string };
type Tbl = { kind: "tbl"; rows: { cells: { span: number; paras: Para[] }[] }[] };
type Block = Para | Tbl;
function wPara(p: Element): Para {
  const pr = kid(p, "pPr"), style = at(kid(pr, "pStyle"), "val") || "";
  const h = /^title$/i.test(style) ? 1 : +(/heading\s*(\d)/i.exec(style)?.[1] || 0);
  const runs: Run[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "r") {
        const rp = kid(c, "rPr"), on = (n: string) => { const e = kid(rp, n); return !!e && !/^(0|false)$/.test(at(e, "val") || ""); };
        let t = "";
        for (const x of Array.from(c.children)) t += x.localName === "t" ? x.textContent || "" : x.localName === "tab" ? "\t" : x.localName === "br" || x.localName === "cr" ? "\n" : "";
        if (t) runs.push({ t, b: on("b"), i: on("i"), u: !!kid(rp, "u") && at(kid(rp, "u"), "val") !== "none", color: hex(at(kid(rp, "color"), "val")) });
      } else if (["hyperlink", "ins", "smartTag", "sdt", "sdtContent", "fldSimple"].includes(c.localName)) walk(c);
    }
  };
  walk(p);
  return { kind: "p", runs, h: h || undefined, list: !!kid(pr, "numPr") || /^list/i.test(style), align: at(kid(pr, "jc"), "val") || undefined };
}
function wBlocks(body: Element | null): Block[] {
  const out: Block[] = [];
  for (const c of Array.from(body?.children || [])) {
    if (c.localName === "p") out.push(wPara(c));
    else if (c.localName === "tbl") out.push({ kind: "tbl", rows: kids(c, "tr").map((tr) => ({ cells: kids(tr, "tc").map((tc) => ({ span: +(at(kid(kid(tc, "tcPr"), "gridSpan"), "val") || 1), paras: kids(tc, "p").map(wPara) })) })) });
    else if (c.localName === "sdt") out.push(...wBlocks(kid(c, "sdtContent")));
  }
  return out;
}
export async function readDocx(buf: ArrayBuffer): Promise<Block[]> {
  const z = await unzip(buf), d = z.get("word/document.xml");
  if (!d) throw new Error("no document");
  return wBlocks(all(xml(await d()), "body")[0] || null);
}
function ParaView({ p }: { p: Para }) {
  const Tag = (p.h ? `h${Math.min(4, p.h + 1)}` : "p") as "p";
  const runs = p.runs.map((r, k) => <span key={k} style={{ fontWeight: r.b ? 700 : undefined, fontStyle: r.i ? "italic" : undefined, textDecoration: r.u ? "underline" : undefined, color: r.color && r.color !== "#000000" ? r.color : undefined }}>{r.t}</span>);
  if (!p.runs.length) return <p className="ofv-gap" />;
  return <Tag className={p.list ? "ofv-li" : undefined} style={{ textAlign: p.align === "center" ? "center" : p.align === "right" || p.align === "end" ? "right" : undefined }}>{runs}</Tag>;
}
function DocView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="ofv-page ofv-doc" data-notranslate>
      {blocks.map((b, k) => b.kind === "p" ? <ParaView key={k} p={b} /> : (
        <table key={k} className="ofv-dtbl" data-nofit><tbody>{b.rows.map((r, i) => <tr key={i}>{r.cells.map((c, j) => <td key={j} colSpan={c.span > 1 ? c.span : undefined}>{c.paras.map((p, n) => <ParaView key={n} p={p} />)}</td>)}</tr>)}</tbody></table>
      ))}
    </div>
  );
}

/* ---------- PowerPoint ---------- */
export async function readPptx(buf: ArrayBuffer): Promise<string[][]> {
  const z = await unzip(buf), pres = z.get("ppt/presentation.xml");
  const pr = await rels(z, "ppt/presentation.xml");
  let files = pres ? all(xml(await pres()), "sldId").map((s) => pr.get(rid(s)) || "").filter(Boolean) : [];
  if (!files.length) files = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.replace(/\D/g, "") - +b.replace(/\D/g, ""));
  const out: string[][] = [];
  for (const f of files) {
    const s = z.get(f);
    if (!s) continue;
    out.push(all(xml(await s()), "p").filter((p) => p.namespaceURI?.includes("drawingml")).map((p) => all(p, "t").map((t) => t.textContent || "").join("")).filter((t) => t.trim()));
  }
  return out;
}

/* ---------- CSV ---------- */
function parseCsv(text: string, tab: boolean): string[][] {
  const d = tab ? "\t" : text.split("\n", 1)[0].split(";").length > text.split("\n", 1)[0].split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"' && !cell) q = true;
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; if (rows.length >= 2000) break; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function csvSheet(rows: string[][]): Sheet {
  const sh: Sheet = { name: "Sheet", rows: new Map(), maxR: -1, maxC: -1, widths: new Map(), hiddenC: new Set(), hiddenR: new Set(), merges: [], cut: rows.length >= 2000 };
  rows.forEach((r, i) => r.forEach((v, c) => {
    if (!v || c >= 80) return;
    if (!sh.rows.has(i)) sh.rows.set(i, new Map());
    const num = /^-?\$?[\d,]*\.?\d+%?$/.test(v.trim());
    sh.rows.get(i)!.set(c, { v, num, b: i === 0 });
    sh.maxR = Math.max(sh.maxR, i); sh.maxC = Math.max(sh.maxC, c);
    sh.widths.set(c, Math.min(40, Math.max(sh.widths.get(c) || 6, v.length + 2)));
  }));
  return sh;
}

/* ---------- the viewer ---------- */
type Loaded = { kind: "sheet"; sheets: Sheet[] } | { kind: "doc"; blocks: Block[] } | { kind: "slides"; slides: string[][] } | { kind: "text"; text: string };

export default function OfficeView({ url, name, type }: { url: string; name: string; type?: string }) {
  const kind = officeKind(name, type || "");
  const [data, setData] = useState<Loaded | null>(null), [err, setErr] = useState(""), [tab, setTab] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); setErr(""); setTab(0);
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 30_000_000) throw new Error("too big");
        let d: Loaded;
        if (kind === "sheet") d = { kind: "sheet", sheets: await readXlsx(buf) };
        else if (kind === "doc") d = { kind: "doc", blocks: await readDocx(buf) };
        else if (kind === "slides") d = { kind: "slides", slides: await readPptx(buf) };
        else if (kind === "csv") d = { kind: "sheet", sheets: [csvSheet(parseCsv(new TextDecoder().decode(buf).replace(/^﻿/, ""), /\.tsv$/i.test(name) || /tab-separated/.test(type || "")))] };
        else d = { kind: "text", text: new TextDecoder().decode(buf).slice(0, 300_000) };
        if (live) setData(d);
      } catch { if (live) setErr("This file couldn't be shown here. Download it or open it in a tab."); }
    })();
    return () => { live = false; };
  }, [url, name, type, kind]);
  const sheet = useMemo(() => (data?.kind === "sheet" ? data.sheets[Math.min(tab, data.sheets.length - 1)] : null), [data, tab]);
  if (err) return <p className="ofv-empty">{err}</p>;
  if (!data) return <p className="ofv-empty faint">Opening…</p>;
  if (data.kind === "sheet") return (
    <div className="ofv">
      {data.sheets.length > 1 && (
        <div className="toolbar ofv-tabs"><div className="chips">{data.sheets.map((s, k) => <button key={k} type="button" className={"chip" + (k === tab ? " on" : "")} onClick={() => setTab(k)} data-notranslate>{s.name}</button>)}</div></div>
      )}
      <div className="ofv-scroll">{sheet ? <SheetGrid key={tab} sh={sheet} /> : <p className="ofv-empty faint">No sheets in this file.</p>}
        {sheet?.cut && <p className="ofv-note faint">Showing the first 2,000 rows. Download it for the rest.</p>}</div>
    </div>
  );
  if (data.kind === "doc") return <div className="ofv"><div className="ofv-scroll"><DocView blocks={data.blocks} /></div></div>;
  if (data.kind === "slides") return (
    <div className="ofv"><div className="ofv-scroll">
      {data.slides.length ? data.slides.map((s, k) => (
        <div key={k} className="ofv-page ofv-slide" data-notranslate><div className="ofv-slide-n">Slide {k + 1}</div>{s.length ? s.map((t, i) => <p key={i} className={i === 0 ? "ofv-slide-t" : undefined}>{t}</p>) : <p className="faint">No text on this slide.</p>}</div>
      )) : <p className="ofv-empty faint">No slides in this file.</p>}
    </div></div>
  );
  return <div className="ofv"><div className="ofv-scroll"><pre className="ofv-page ofv-text" data-notranslate>{data.text}</pre></div></div>;
}
