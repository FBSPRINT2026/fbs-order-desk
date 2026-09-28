/**
 * "What do you want to pay?" Turns a plain sentence into a filter over the customer's open orders:
 * "all of August", "everything under $100", "past due", "completed orders", "#1001-1040", "the Brewery jobs".
 * Common phrasings are understood here instantly; anything else goes to Claude (same filter shape).
 */
export type PayFilter = {
  all?: boolean;
  pastDue?: boolean;
  /** job status groups */
  status?: ("completed" | "ready" | "in_progress")[];
  /** order months, "YYYY-MM" */
  months?: string[];
  /** order date range (YYYY-MM-DD, inclusive) */
  from?: string; to?: string;
  /** payment due on or before */
  dueBy?: string;
  /** amount limits, on what's still owed (balance) unless amountOn is "total" */
  maxAmount?: number; minAmount?: number; amountOn?: "balance" | "total";
  /** words that must appear in the job name / PO / garments */
  text?: string[];
  /** words that must NOT appear */
  notText?: string[];
  /** specific order numbers and ranges */
  numbers?: number[]; ranges?: [number, number][];
};
export type PayOrderLite = { id: string; number: number; nickname: string; status: string; total: number; balance: number; created_at: string; due_date: string | null; pay_due?: string | null; search?: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = (w: string) => MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)) && (w.length <= 3 || m.startsWith(w)));
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = (s: string) => +s.replace(/[$,\s]/g, "").replace(/k$/i, "000");

const STOP = new Set("a an the and or of for to my our all every everything each any orders order invoices invoice jobs job pay paying please select pick me i want we us just only that are is with from in on by those these them it this account entire whole everything's due balance balances open outstanding associated related connected belonging belongs under stuff things ones".split(" "));

/** Understands common phrasings. `rest` is what it couldn't place (non-empty means Claude should take a look). */
export function parsePay(input: string, today = new Date()): { filter: PayFilter; rest: string[] } {
  let t = " " + input.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ") + " ";
  const f: PayFilter = {};
  const eat = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { let m: RegExpMatchArray | null; while ((m = t.match(re))) { fn(m); t = t.replace(m[0], " "); } };

  // quoted names: "brewery"
  eat(/"([^"]+)"/, (m) => (f.text = [...(f.text || []), m[1].trim()]));
  // order numbers: #1001-1040, 1001 to 1040, #1001, #1002
  eat(/#?(\d{3,6})\s*(?:-|–|to|through|thru)\s*#?(\d{3,6})/, (m) => (f.ranges = [...(f.ranges || []), [Math.min(+m[1], +m[2]), Math.max(+m[1], +m[2])]]));
  eat(/#(\d{2,6})/, (m) => (f.numbers = [...(f.numbers || []), +m[1]]));
  // amounts
  eat(/between\s+\$?([\d,.]+k?)\s+and\s+\$?([\d,.]+k?)/, (m) => { f.minAmount = money(m[1]); f.maxAmount = money(m[2]); });
  eat(/(?:under|below|less than|lower than|smaller than|<=?|up to|at most|no more than)\s+\$?\s?([\d,.]+k?)(?:\s*dollars)?/, (m) => (f.maxAmount = money(m[1])));
  eat(/(?:over|above|more than|greater than|bigger than|>=?|at least)\s+\$?\s?([\d,.]+k?)(?:\s*dollars)?/, (m) => (f.minAmount = money(m[1])));
  eat(/\$\s?([\d,.]+k?)\s+(?:or less|and under|or under)/, (m) => (f.maxAmount = money(m[1])));
  eat(/\$\s?([\d,.]+k?)\s+(?:or more|and up|and over|or over)/, (m) => (f.minAmount = money(m[1])));
  eat(/\b(?:order|invoice)?\s*totals?\b/, () => (f.amountOn = "total"));
  // due / late
  eat(/\b(past due|overdue|late|behind)\b/, () => (f.pastDue = true));
  eat(/\bdue (?:by|before|on or before)\s+([a-z]+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/, (m) => { const d = dateOf(m[1], today); if (d) f.dueBy = d; });
  eat(/\bdue (?:this|within the) week\b/, () => { const d = new Date(today); d.setDate(d.getDate() + (7 - d.getDay())); f.dueBy = ymd(d); });
  // status
  eat(/\b(completed|complete|finished|done|picked up|delivered|shipped|closed)\b/, () => (f.status = [...new Set([...(f.status || []), "completed" as const])]));
  eat(/\b(ready(?: for pickup)?|ready to ship)\b/, () => (f.status = [...new Set([...(f.status || []), "ready" as const])]));
  eat(/\b(in progress|in production|being made|printing|not done|unfinished)\b/, () => (f.status = [...new Set([...(f.status || []), "in_progress" as const])]));
  // relative months
  eat(/\blast month\b/, () => { const d = new Date(today.getFullYear(), today.getMonth() - 1, 1); f.months = [...(f.months || []), `${d.getFullYear()}-${pad(d.getMonth() + 1)}`]; });
  eat(/\bthis month\b/, () => (f.months = [...(f.months || []), `${today.getFullYear()}-${pad(today.getMonth() + 1)}`]));
  eat(/\b(?:last|past) (\d{1,3}) days\b/, (m) => { const d = new Date(today); d.setDate(d.getDate() - +m[1]); f.from = ymd(d); });
  eat(/\bthis year\b/, () => (f.from = `${today.getFullYear()}-01-01`));
  eat(/\blast year\b/, () => { f.from = `${today.getFullYear() - 1}-01-01`; f.to = `${today.getFullYear() - 1}-12-31`; });
  // before / after dates
  eat(/\b(?:before|prior to|older than)\s+([a-z]+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[a-z]+)/, (m) => { const d = dateOf(m[1], today, "start"); if (d) { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - 1); f.to = ymd(x); } });
  eat(/\b(?:after|since|from)\s+([a-z]+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/, (m) => { const d = dateOf(m[1], today); if (d) f.from = d; });
  // month names (optionally with a year): "august", "aug 2026", "june and july"
  eat(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/, (m) => {
    const mi = MON(m[1]); if (mi < 0) return;
    let y = m[2] ? +m[2] : today.getFullYear();
    if (!m[2] && mi > today.getMonth()) y -= 1; // "December" in September means last December
    f.months = [...(f.months || []), `${y}-${pad(mi + 1)}`];
  });
  // job names: "for the Brewery job", "named X", "called X", "with X in the name", "PO 123"
  eat(/\b(?:po|p\.o\.)\s*#?\s*([\w-]+)/, (m) => (f.text = [...(f.text || []), m[1]]));
  eat(/\b(?:named|called|titled|with the name|labeled)\s+([\w&' -]+?)(?=\s+(?:and|or|that|which|under|over|from|in|before|after)\b|\s*$)/, (m) => (f.text = [...(f.text || []), m[1].trim()]));
  eat(/\bnot?\s+(?:the\s+)?([\w&'-]+)\s+(?:ones|orders|jobs)\b/, (m) => (f.notText = [...(f.notText || []), m[1]]));
  eat(/\b(?:except|excluding|but not)\s+(?:the\s+)?([\w&'-]+)/, (m) => (f.notText = [...(f.notText || []), m[1]]));
  eat(/\bfor (?:the\s+)?([\w&' -]+?)\s+(?:job|jobs|order|orders|shirts|tees|event|team|project)\b/, (m) => (f.text = [...(f.text || []), m[1].trim()]));
  eat(/\b(?:the\s+)?([\w&'-]+)\s+(?:jobs|orders)\b/, (m) => { if (!STOP.has(m[1])) f.text = [...(f.text || []), m[1]]; });
  if (/\b(all|every|everything|entire|whole|whatever)\b/.test(t)) f.all = true;
  const rest = t.split(/[^a-z0-9&-]+/).filter((w) => w && !STOP.has(w) && !/^(the|them|ones|stuff|things|thing|want|would|like|can|you|to|be|have|has|of|s|re|ll|d|t|dollar|dollars|bucks|less|more)$/.test(w));
  return { filter: f, rest };
}

function dateOf(s: string, today: Date, edge: "start" | "day" = "day"): string | null {
  s = s.trim().replace(/,/g, "");
  let m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) { const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear(); return `${y}-${pad(+m[1])}-${pad(+m[2])}`; }
  m = s.match(/^([a-z]+)(?:\s+(\d{1,2}))?(?:\s+(\d{4}))?$/);
  if (m) { const mi = MON(m[1]); if (mi < 0) return null; let y = m[3] ? +m[3] : today.getFullYear(); if (!m[3] && mi > today.getMonth()) y -= 1; return `${y}-${pad(mi + 1)}-${pad(m[2] ? +m[2] : 1)}`; void edge; }
  return null;
}

/** True when the filter says anything at all. */
export const hasFilter = (f: PayFilter) => Object.values(f).some((v) => (Array.isArray(v) ? v.length : v !== undefined && v !== false));

const inWork = ["approved", "art", "blanks", "production"];
/** The orders a filter picks (from the list of open orders it's given). */
export function applyPay(f: PayFilter, list: PayOrderLite[], today = new Date()): PayOrderLite[] {
  const td = ymd(today);
  return list.filter((o) => {
    const amt = f.amountOn === "total" ? o.total : o.balance;
    if (f.maxAmount !== undefined && !(amt <= f.maxAmount + 0.0001)) return false;
    if (f.minAmount !== undefined && !(amt >= f.minAmount - 0.0001)) return false;
    const d = (o.created_at || "").slice(0, 10);
    if (f.months?.length && !f.months.includes(d.slice(0, 7))) return false;
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    const due = o.pay_due || null;
    if (f.pastDue && !(due && due < td)) return false;
    if (f.dueBy && !(due && due <= f.dueBy)) return false;
    if (f.status?.length && !f.status.some((s) => (s === "completed" ? o.status === "completed" : s === "ready" ? o.status === "ready" : inWork.includes(o.status)))) return false;
    const hay = `#${o.number} ${o.number} ${o.nickname} ${o.search || ""}`.toLowerCase();
    if (f.text?.length && !f.text.every((w) => w.toLowerCase().split(/\s+/).every((x) => hay.includes(x)))) return false;
    if (f.notText?.length && f.notText.some((w) => hay.includes(w.toLowerCase()))) return false;
    if ((f.numbers?.length || f.ranges?.length) && !((f.numbers || []).includes(o.number) || (f.ranges || []).some(([a, b]) => o.number >= a && o.number <= b))) return false;
    return true;
  });
}

const monthName = (ym: string) => { const [y, m] = ym.split("-"); return `${MONTHS[+m - 1]?.replace(/^./, (c) => c.toUpperCase())} ${y}`; };
const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
/** Plain-words summary of a filter: "August 2026 · under $100 · past due". */
export function describePay(f: PayFilter): string {
  const p: string[] = [];
  if (f.months?.length) p.push(f.months.map(monthName).join(" + "));
  if (f.from && f.to) p.push(`from ${f.from} to ${f.to}`); else if (f.from) p.push(`since ${f.from}`); else if (f.to) p.push(`through ${f.to}`);
  if (f.status?.length) p.push(f.status.map((s) => (s === "in_progress" ? "in progress" : s)).join(" or "));
  if (f.pastDue) p.push("past due");
  if (f.dueBy) p.push(`due by ${f.dueBy}`);
  const on = f.amountOn === "total" ? "order total" : "balance";
  if (f.minAmount !== undefined && f.maxAmount !== undefined) p.push(`${on} ${fmt(f.minAmount)}–${fmt(f.maxAmount)}`);
  else if (f.maxAmount !== undefined) p.push(`${on} under ${fmt(f.maxAmount)}`);
  else if (f.minAmount !== undefined) p.push(`${on} over ${fmt(f.minAmount)}`);
  if (f.text?.length) p.push(f.text.map((x) => `“${x}”`).join(" + "));
  if (f.notText?.length) p.push(`not ${f.notText.map((x) => `“${x}”`).join(", ")}`);
  if (f.numbers?.length) p.push(f.numbers.map((n) => `#${n}`).join(", "));
  if (f.ranges?.length) p.push(f.ranges.map(([a, b]) => `#${a}–${b}`).join(", "));
  return p.length ? p.join(" · ") : "everything due";
}

/**
 * "Pay an amount": the amount goes to the oldest orders first (by order date, then number);
 * the last one it reaches is paid partly. The server does the same with its own numbers.
 */
export function allocateOldest<T extends { balance: number; created_at: string; number: number }>(list: T[], amount: number): { item: T; amount: number }[] {
  let left = Math.round(amount * 100) / 100;
  const out: { item: T; amount: number }[] = [];
  for (const it of [...list].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.number - b.number)) {
    if (left <= 0.004) break;
    const a = Math.min(Math.round(it.balance * 100) / 100, left);
    if (a > 0.004) { out.push({ item: it, amount: Math.round(a * 100) / 100 }); left = Math.round((left - a) * 100) / 100; }
  }
  return out;
}
