import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * A tiny .xlsx reader (first worksheet → rows of cell text), enough for supplier manifests. No dependency:
 * an .xlsx file is a zip of XML files; we unzip the two we need and read the cells.
 */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // end of central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That isn't an Excel (.xlsx) file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    if (/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
const colIndex = (ref: string) => { const m = ref.match(/^[A-Z]+/)?.[0] || "A"; let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Rows of the first worksheet, every cell as text (numbers as written; dates as Excel serial numbers). */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") || "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unxml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, "")).join("")));
  const sheetName = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  if (!sheetName) throw new Error("No worksheet in that file.");
  const xml = files.get(sheetName)!.toString("utf8");
  const rows: string[][] = [];
  for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const cells: string[] = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/ r="([A-Z]+\d+)"/)?.[1] || "";
      const t = c.match(/ t="(\w+)"/)?.[1] || "";
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      const val = t === "s" ? shared[+(v || 0)] ?? "" : t === "inlineStr" ? unxml(inline || "") : unxml(v ?? "");
      cells[ref ? colIndex(ref) : cells.length] = val;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

/** An Excel date serial (e.g. 46290) as YYYY-MM-DD; text dates are passed through when they parse. */
export function excelDate(v: string): string | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000); return d.toISOString().slice(0, 10); }
  const t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
