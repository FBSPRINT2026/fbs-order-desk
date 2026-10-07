import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * Plain text out of the office files customers attach (size breakdowns, order sheets, rosters), so the AI can read
 * them: .xlsx / .xlsm as tab-separated rows per sheet, .docx as paragraphs, .csv / .tsv / .txt as they are.
 * No library: an .xlsx or .docx is a zip of XML files, read with the zip's central directory and zlib.
 * Old binary .xls / .doc aren't readable here (the result says so).
 */

type Entry = { name: string; method: number; size: number; offset: number };

function zipEntries(buf: Buffer): Entry[] {
  // end of central directory: signature 0x06054b50 within the last 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10), start = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  let p = start;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nameLen), method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf: Buffer, e: Entry): string {
  const p = e.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("bad zip entry");
  const nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
  const data = buf.subarray(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + e.size);
  return (e.method === 8 ? inflateRawSync(data) : data).toString("utf8");
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

/** column letters → 0-based index ("A" → 0, "AB" → 27) */
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export function xlsxText(buf: Buffer, maxChars = 20000): string {
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (n: string) => { const e = byName.get(n); return e ? zipRead(buf, e) : ""; };
  // shared strings: each <si> may hold several <t> runs
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  // sheet names in workbook order, matched to their files through the workbook's relationships
  const wb = read("xl/workbook.xml"), rels = read("xl/_rels/workbook.xml.rels");
  const attr = (tag: string, a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(tag)?.[1] || "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target").replace(/^\/?(xl\/)?/, "xl/")]));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: unxml(attr(m[0], "name")), file: target.get(attr(m[0], "r:id")) || "" }));
  const out: string[] = [];
  for (const sh of sheets.length ? sheets : entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).map((e) => ({ name: e.name, file: e.name }))) {
    const xml = read(sh.file);
    if (!xml) continue;
    const rows: string[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] || "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1], t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? (/<f>([\s\S]*?)<\/f>/.exec(inner)?.[1] != null ? "=" + /<f>([\s\S]*?)<\/f>/.exec(inner)![1] : undefined);
        let val = "";
        if (t === "s" && v != null) val = shared[+v] ?? "";
        else if (t === "inlineStr") val = unxml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else if (v != null) val = unxml(v);
        const i = ref ? colIndex(ref) : cells.length;
        while (cells.length < i) cells.push("");
        cells[i] = val.replace(/\s+/g, " ").trim();
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(cells.join("\t"));
    }
    if (rows.length) out.push(`[Sheet: ${sh.name}]\n${rows.join("\n")}`);
  }
  return out.join("\n\n").slice(0, maxChars);
}

export function docxText(buf: Buffer, maxChars = 20000): string {
  const e = zipEntries(buf).find((x) => x.name === "word/document.xml");
  if (!e) return "";
  const xml = zipRead(buf, e);
  return xml.split(/<\/w:p>/).map((p) => unxml([...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] == null ? "\t" : m[1])).join(""))).filter((x) => x.trim()).join("\n").slice(0, maxChars);
}

/** text for the AI from an attached office / text file, or "" when it can't be read */
export function officeText(name: string, type: string, buf: Buffer): string {
  try {
    if (/\.(xlsx|xlsm)$/i.test(name) || /spreadsheetml/.test(type)) return xlsxText(buf);
    if (/\.docx$/i.test(name) || /wordprocessingml/.test(type)) return docxText(buf);
    if (/\.(csv|tsv|txt)$/i.test(name) || /^text\//.test(type)) return buf.toString("utf8").slice(0, 20000);
  } catch { /* unreadable */ }
  return "";
}
