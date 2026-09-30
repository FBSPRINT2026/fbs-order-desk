/**
 * uAttend (WorkWell Technologies) API: read-only. We only ever read from uAttend; nothing is sent back.
 *   POST https://api.workwelltech.com/user           {}                          → { Users: [...] }
 *   POST https://api.workwelltech.com/reports/punch  { StartDate, EndDate, ... } → { PunchReportLineItems: [...] }
 * Auth: the account's key in the `x-api-key` header (Vercel env UATTEND_API_KEY, added by Nicholas).
 * Each punch-report line is one in/out pair: we store it as an "in" punch and, once it has one, an "out" punch
 * (keys `ua:<Id>:in` / `ua:<Id>:out` in time_punches.uattend_id, so running again never doubles anything).
 * Field names follow uAttend's help-center documentation; the parsing is forgiving about case and wrappers.
 */
import { localToIso } from "@/lib/timeclock";
import { parseDay, parseTime } from "@/lib/timeImport";

const BASE = "https://api.workwelltech.com";
export const uattendReady = () => !!process.env.UATTEND_API_KEY;

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const key = (process.env.UATTEND_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("The uAttend API key isn't set up yet (Vercel → UATTEND_API_KEY).");
  let last = "";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + path, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const txt = await r.text();
    if (r.status === 429 || r.status >= 500) { last = `uAttend ${path}: ${r.status} ${txt.slice(0, 160)}`; await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`uAttend ${path}: ${r.status} ${txt.slice(0, 200)}`);
    try { return JSON.parse(txt); } catch { throw new Error(`uAttend ${path}: not JSON (${txt.slice(0, 120)})`); }
  }
  throw new Error(last || `uAttend ${path} didn't answer`);
}

/** case-insensitive field read ("UserId", "userId", "user_id") */
function f(o: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(o);
  for (const n of names) { const want = n.toLowerCase().replace(/_/g, ""); const k = keys.find((x) => x.toLowerCase().replace(/_/g, "") === want); if (k && o[k] != null && o[k] !== "") return o[k]; }
  return undefined;
}
/** the first array of objects in a response (Users, PunchReportLineItems, or wrapped one level down) */
function list(o: Record<string, unknown>, ...names: string[]): Record<string, unknown>[] {
  for (const n of names) { const v = f(o, n); if (Array.isArray(v)) return v as Record<string, unknown>[]; }
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Record<string, unknown>[];
    if (v && typeof v === "object" && !Array.isArray(v)) { const inner = list(v as Record<string, unknown>, ...names); if (inner.length) return inner; }
  }
  return [];
}

export type UaUser = { id: string; first: string; last: string; active: boolean; email: string };
export async function uaUsers(): Promise<UaUser[]> {
  const j = await call("/user", {});
  return list(j, "Users").map((u) => ({ id: String(f(u, "UserId", "Id") ?? ""), first: String(f(u, "FirstName", "first_name") ?? "").trim(), last: String(f(u, "LastName", "last_name") ?? "").trim(), active: f(u, "IsActive", "active") !== false && f(u, "IsActive") !== 0, email: String(f(u, "Email") ?? "") })).filter((u) => u.id);
}

export type UaPunch = { key: string; user: string; first: string; last: string; kind: "in" | "out"; at: string };
/** wall time in the shop's zone → an instant; InTime may be "07:02 AM", "07:02:00" or a full date-time */
function when(day: unknown, time: unknown): string | null {
  const t = String(time ?? "").trim(); if (!t) return null;
  const d = parseDay(String(day ?? "")) || parseDay(t.slice(0, 10));
  const m = parseTime(t.includes("T") ? t.split("T")[1] : t);
  return d && m != null ? localToIso(d, m) : null;
}
/** punches from `from` through `to` (yyyy-mm-dd, at most ~3 months apart), every user, paged */
export async function uaPunches(from: string, to: string): Promise<UaPunch[]> {
  const out: UaPunch[] = [];
  let firstPrev: unknown = null;
  for (let page = 0; page < 200; page++) {
    const j = await call("/reports/punch", { StartDate: from, EndDate: to, UsePaging: true, PageSize: 500, PageNumber: page });
    const items = list(j, "PunchReportLineItems");
    // a page that starts like the last one: paging isn't doing anything, we already have it all
    const first = items[0] ? f(items[0], "Id", "PunchId") : null;
    if (page > 0 && first != null && first === firstPrev) break;
    firstPrev = first;
    for (const x of items) {
      const code = Number(f(x, "PaycodeId") ?? 1);
      if (code && code !== 1) continue; // vacation / sick / holiday entries aren't punches
      const id = f(x, "Id", "PunchId"); if (id == null) continue;
      const user = String(f(x, "UserId") ?? ""), first = String(f(x, "FirstName") ?? ""), last = String(f(x, "LastName") ?? "");
      const day = f(x, "PunchDate");
      const inAt = when(f(x, "InDate") ?? day, f(x, "InTime")), outAt = when(f(x, "OutDate") ?? f(x, "InDate") ?? day, f(x, "OutTime"));
      if (inAt) out.push({ key: `ua:${id}:in`, user, first, last, kind: "in", at: inAt });
      if (outAt) out.push({ key: `ua:${id}:out`, user, first, last, kind: "out", at: outAt });
    }
    if (items.length < 500) break;
  }
  return out;
}
