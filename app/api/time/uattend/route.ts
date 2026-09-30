import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uaPunches, uaUsers, uattendReady, type UaUser } from "@/lib/uattend";
import { addDays, localDay } from "@/lib/timeclock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * uAttend → our time clock (read-only from uAttend; nothing is ever written back to it).
 *   GET  (the database's schedule, every 2 minutes in shop hours, with the sync token): yesterday and today's punches.
 *   POST (an owner/admin on Time Clock → Import): { from, to } brings history over, a month at a time; {} = the same
 *        quick sync now.
 * Employees are matched by uAttend user ID, then by name (the ID is saved on the match); nobody is ever added from
 * uAttend (people not on our list are reported and their punches skipped). A punch changed in uAttend is updated here unless someone edited it here.
 * Status (last run, last success, last error, counts) is kept in uattend_sync for the pages to show.
 */
type Admin = ReturnType<typeof createAdminClient>;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/**
 * uAttend users → our employees. Only people already on our list are linked (Nicholas, Sept 30: never add anyone
 * from uAttend). By uAttend ID, then by full name, then by last name + first name starting the same (Kelsey / Kelsy).
 * Anyone left over is reported back (and their punches skipped) so they can be linked by hand.
 */
async function matchUsers(admin: Admin, users: UaUser[]) {
  const { data } = await admin.from("employees").select("id, first_name, last_name, uattend_id");
  const emps = (data || []) as { id: string; first_name: string; last_name: string; uattend_id: string | null }[];
  const byUa = new Map(emps.filter((e) => e.uattend_id).map((e) => [e.uattend_id!, e.id]));
  const free = emps.filter((e) => !e.uattend_id);
  let linked = 0;
  const unmatched: string[] = [];
  const take = async (u: UaUser, e: { id: string }) => { await admin.from("employees").update({ uattend_id: u.id }).eq("id", e.id); byUa.set(u.id, e.id); free.splice(free.indexOf(e as never), 1); linked++; };
  for (const u of users) {
    if (byUa.has(u.id)) continue;
    const full = norm(`${u.first} ${u.last}`), fn = norm(u.first), ln = norm(u.last);
    let hit = free.find((e) => norm(`${e.first_name} ${e.last_name}`) === full);
    if (!hit && ln) { const c = free.filter((e) => norm(e.last_name) === ln && fn && norm(e.first_name).slice(0, 3) === fn.slice(0, 3)); if (c.length === 1) hit = c[0]; }
    if (!hit && !ln && fn) { const c = free.filter((e) => norm(e.first_name) === fn); if (c.length === 1) hit = c[0]; }
    if (hit) await take(u, hit);
    else if (u.active) unmatched.push(`${u.first} ${u.last}`.trim() + ` (uAttend #${u.id})`);
  }
  return { byUa, linked, added: 0, unmatched };
}

async function run(admin: Admin, from: string, to: string, withUsers: boolean) {
  const summary = { from, to, punches: 0, added: 0, updated: 0, linked: 0, newEmployees: 0, unknown: 0, unmatched: [] as string[] };
  let map: Map<string, string> | null = null;
  let usersDone = false;
  if (withUsers) { const r = await matchUsers(admin, await uaUsers()); map = r.byUa; summary.linked = r.linked; summary.unmatched = r.unmatched; usersDone = true; }
  // a month at a time (uAttend allows up to three per request)
  for (let a = from; a <= to; a = addDays(a, 31)) {
    const b = addDays(a, 30) < to ? addDays(a, 30) : to;
    const ps = await uaPunches(a, b);
    summary.punches += ps.length;
    if (!ps.length) continue;
    if (!map || (!usersDone && ps.some((p) => !map!.has(p.user)))) { const r = await matchUsers(admin, await uaUsers()); map = r.byUa; summary.linked += r.linked; summary.unmatched = r.unmatched; usersDone = true; }
    const keys = ps.map((p) => p.key), have = new Map<string, { id: string; at: string; edited_at: string | null }>();
    for (let i = 0; i < keys.length; i += 300) {
      const { data } = await admin.from("time_punches").select("id, at, edited_at, uattend_id").in("uattend_id", keys.slice(i, i + 300));
      for (const r of (data || []) as { id: string; at: string; edited_at: string | null; uattend_id: string }[]) have.set(r.uattend_id, r);
    }
    const ins: Record<string, unknown>[] = [];
    for (const p of ps) {
      const emp = map.get(p.user); if (!emp) { summary.unknown++; continue; }
      const h = have.get(p.key);
      if (!h) ins.push({ employee_id: emp, kind: p.kind, at: p.at, source: "uattend", uattend_id: p.key, note: "uAttend" });
      else if (!h.edited_at && Date.parse(h.at) !== Date.parse(p.at)) { await admin.from("time_punches").update({ at: p.at }).eq("id", h.id); summary.updated++; }
    }
    for (let i = 0; i < ins.length; i += 500) {
      const { data, error } = await admin.from("time_punches").upsert(ins.slice(i, i + 500), { onConflict: "uattend_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      summary.added += (data || []).length;
    }
  }
  return summary;
}

async function record(admin: Admin, ok: boolean, info: unknown, error = "") {
  const now = new Date().toISOString();
  await admin.from("uattend_sync").update(ok ? { last_run_at: now, last_ok_at: now, last_error: null, last_error_at: null, last_summary: info } : { last_run_at: now, last_error: error.slice(0, 500), last_error_at: now }).eq("id", 1);
}

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!ps || req.headers.get("x-sync-token") !== (ps as { token: string }).token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  if (!uattendReady()) { await record(admin, false, null, "The uAttend API key isn't set up yet (Vercel → UATTEND_API_KEY)."); return NextResponse.json({ error: "no key" }); }
  const today = localDay(new Date());
  const { data: st } = await admin.from("uattend_sync").select("users_at").eq("id", 1).single();
  // the employee list once every 6 hours (and whenever a punch comes from someone we don't know)
  const usersDue = !st?.users_at || Date.now() - Date.parse(st.users_at as string) > 6 * 3600000;
  try {
    const s = await run(admin, addDays(today, -1), today, usersDue);
    await record(admin, true, s);
    if (usersDue) await admin.from("uattend_sync").update({ users_at: new Date().toISOString() }).eq("id", 1);
    return NextResponse.json(s);
  } catch (e) { const m = e instanceof Error ? e.message : String(e); await record(admin, false, null, m); return NextResponse.json({ error: m }, { status: 502 }); }
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { data: me } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  if (!["owner", "admin"].includes((me?.role as string) || "")) return NextResponse.json({ error: "Only an owner or admin can sync uAttend." }, { status: 403 });
  if (!uattendReady()) return NextResponse.json({ error: "The uAttend API key isn't set up yet. Add it in Vercel as UATTEND_API_KEY (Production), then redeploy." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const today = localDay(new Date());
  const ok = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = ok(b.from) ? (b.from as string) : addDays(today, -1), to = ok(b.to) ? (b.to as string) : today;
  if (from > to) return NextResponse.json({ error: "From is after to." }, { status: 400 });
  // about 4 months per click keeps each request well inside the time limit; bigger ranges run in steps from the page
  if (Date.parse(to) - Date.parse(from) > 125 * 86400000) return NextResponse.json({ error: "Pick four months or less at a time." }, { status: 400 });
  const admin = createAdminClient();
  try {
    const s = await run(admin, from, to, true);
    await record(admin, true, s);
    await admin.from("uattend_sync").update({ users_at: new Date().toISOString() }).eq("id", 1);
    return NextResponse.json(s);
  } catch (e) { const m = e instanceof Error ? e.message : String(e); await record(admin, false, null, m); return NextResponse.json({ error: m }, { status: 502 }); }
}
