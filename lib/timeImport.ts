/**
 * Reading punches out of an exported report (uAttend timecard / punch detail reports, or any spreadsheet):
 * either one row per day with In / Out columns (as many pairs as the report has), or one row per punch with a
 * date-time and a punch type. Everything is in the shop's time zone.
 */
import { addDays, localToIso } from "@/lib/timeclock";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** "9/29/2026", "2026-09-29", "Sep 29, 2026", an Excel serial → "2026-09-29". */
export function parseDay(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000).toISOString().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const t = new Date(s.replace(/^(mon|tue|wed|thu|fri|sat|sun)\w*,?\s+/i, ""));
  return isNaN(+t) ? null : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
/** "7:02 AM", "07:02", "19:02:10", an Excel day fraction (0.2931) → minutes past midnight. */
export function parseTime(v: string): number | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) return Math.round(+s * 1440);
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i);
  if (!m) return null;
  let h = +m[1]; const min = +m[2], ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
  return h > 23 || min > 59 ? null : h * 60 + min;
}

export type ImportPunch = { key: string; employee: string; employeeId: string; department: string; kind: "in" | "out" | "break_start" | "break_end"; at: string };
export type Mapping = { mode: "pairs" | "rows"; employee: number; employeeId: number; department: number; date: number; ins: number[]; outs: number[]; datetime: number; type: number };

/** Guess which columns are which from the header row. */
export function guessMapping(head: string[]): Mapping {
  const h = head.map((x) => x.toLowerCase().trim());
  const find = (re: RegExp, not?: RegExp) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const ins = h.map((x, i) => (/(^|\b)(time\s*)?in(\s*\d+)?$|clock\s*in|punch\s*in|^in\b/.test(x) ? i : -1)).filter((i) => i >= 0);
  const outs = h.map((x, i) => (/(^|\b)(time\s*)?out(\s*\d+)?$|clock\s*out|punch\s*out|^out\b/.test(x) ? i : -1)).filter((i) => i >= 0);
  const type = find(/punch\s*type|^type$|in\s*\/\s*out|status/);
  const datetime = find(/punch\s*time|date\s*\/?\s*time|timestamp/);
  return {
    mode: ins.length && outs.length ? "pairs" : "rows",
    employee: find(/employee\s*name|^name$|^employee$|full\s*name/), employeeId: find(/(employee|emp|badge|payroll)\s*(id|#|no|number|code)|^id$/),
    department: find(/department|dept/), date: find(/^date$|work\s*date|punch\s*date|day/, /time|type/), ins, outs, datetime, type,
  };
}

/** Rows → punches. First / last name columns are joined when the report splits them. */
export function toPunches(rows: string[][], m: Mapping): { punches: ImportPunch[]; skipped: number } {
  const out: ImportPunch[] = []; let skipped = 0;
  let lastEmp = "", lastId = "", lastDept = "";
  for (const r of rows) {
    const emp = (r[m.employee] || "").trim() || lastEmp, id = (m.employeeId >= 0 ? (r[m.employeeId] || "").trim() : "") || (r[m.employee] ? "" : lastId);
    const dept = m.department >= 0 ? (r[m.department] || "").trim() || lastDept : "";
    if (r[m.employee]?.trim()) { lastEmp = emp; lastId = id; lastDept = dept; }
    if (!emp && !id) { skipped++; continue; }
    const who = { employee: emp, employeeId: id, department: dept };
    const empKey = (id || emp).toLowerCase();
    if (m.mode === "pairs") {
      const day = parseDay(r[m.date] || "");
      if (!day) { skipped++; continue; }
      let prev = -1, dayNow = day, any = false;
      const n = Math.max(m.ins.length, m.outs.length);
      for (let i = 0; i < n; i++) {
        for (const [col, kind] of [[m.ins[i], "in"], [m.outs[i], "out"]] as [number | undefined, "in" | "out"][]) {
          if (col == null) continue;
          const t = parseTime(r[col] || ""); if (t == null) continue;
          if (prev >= 0 && t < prev) dayNow = addDays(dayNow, 1); // past midnight
          prev = t; any = true;
          out.push({ ...who, kind, at: localToIso(dayNow, t), key: `imp:${empKey}:${dayNow}:${kind}:${t}` });
        }
      }
      if (!any) skipped++;
    } else {
      const raw = r[m.datetime] || "";
      const day = parseDay(m.date >= 0 ? r[m.date] || raw : raw), t = parseTime(m.date >= 0 && m.datetime < 0 ? "" : raw);
      const typ = (r[m.type] || "").toLowerCase();
      const kind = /break|lunch/.test(typ) ? (/end|return|in/.test(typ) ? "break_end" : "break_start") : /out/.test(typ) ? "out" : /in/.test(typ) ? "in" : null;
      if (!day || t == null || !kind) { skipped++; continue; }
      out.push({ ...who, kind, at: localToIso(day, t), key: `imp:${empKey}:${day}:${kind}:${t}` });
    }
  }
  return { punches: out, skipped };
}
