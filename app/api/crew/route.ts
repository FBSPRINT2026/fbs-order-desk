import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { recordPunch, timeSettings } from "@/lib/timeclockServer";
import { periodOf } from "@/lib/timeclock";
import type { Punch } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The crew phone's main menu (/crew): punch in and out (on the shop's Wi-Fi only, as every crew PIN sign-in is), and ask
 * for a fix to their own time card, which waits for a manager on the Time Clock (Nick, Nov 13 2026: "oh shoot I forgot
 * to clock out for lunch. I took a 30 minute lunch today… send to Jose").
 */
/** Find (the crew menu's search; Nov 13): a job by its number, PO, name or customer, portal orders and Printavo's */
export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim().replace(/[%,()*]/g, " ").slice(0, 60);
  if (q.length < 2) return NextResponse.json({ jobs: [] });
  const admin = createAdminClient(), like = `%${q}%`, num = /^#?\d{3,7}$/.test(q) ? +q.replace("#", "") : null;
  const { data: cs } = await admin.from("customers").select("id").or(`company.ilike.${like},name.ilike.${like}`).limit(30);
  const cids = ((cs || []) as { id: string }[]).map((c) => c.id);
  const ors = [`po_number.ilike.${like}`, `nickname.ilike.${like}`, ...(num ? [`number.eq.${num}`] : []), ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
  const pors = [`po_number.ilike.${like}`, `nickname.ilike.${like}`, ...(num ? [`visual_id.eq.${num}`] : []), ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
  const [{ data: os }, { data: pv }] = await Promise.all([
    admin.from("orders").select("number, nickname, po_number, qty, status, due_date, customers(company, name)").is("discarded_at", null).not("status", "in", "(quote,quote_sent,request)").or(ors).order("number", { ascending: false }).limit(15),
    admin.from("archived_orders").select("visual_id, nickname, po_number, qty, status_name, due_date, customers(company, name)").is("removed_at", null).or(pors).order("visual_id", { ascending: false }).limit(10),
  ]);
  type R = { number?: number; visual_id?: string; nickname: string; po_number: string | null; qty: number | null; status?: string; status_name?: string; due_date: string | null; customers: { company: string; name: string } | null };
  const map = (r: R) => ({ number: String(r.number ?? r.visual_id), name: r.nickname || "", po: r.po_number || "", customer: r.customers?.company || r.customers?.name || "", qty: r.qty || 0, status: r.status || r.status_name || "", due: r.due_date });
  return NextResponse.json({ jobs: [...((os || []) as unknown as R[]).map(map), ...((pv || []) as unknown as R[]).map(map)].slice(0, 20) });
}

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who?.employeeId) return NextResponse.json({ error: "Sign in with your employee # and PIN first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  if (b.action === "punch") {
    const kind = String(b.kind) as Punch["kind"];
    if (!["in", "out", "break_start", "break_end"].includes(kind)) return NextResponse.json({ error: "Pick in or out." }, { status: 400 });
    const r = await recordPunch(admin, { employeeId: who.employeeId, kind, source: "phone" });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, punch: r.punch });
  }
  if (b.action === "fix") {
    const kind = ["lunch", "missed_in", "missed_out", "other"].includes(b.kind) ? b.kind : "other";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || "")) ? String(b.day) : "";
    if (!day) return NextResponse.json({ error: "Pick the day." }, { status: 400 });
    const at = b.at && !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : null;
    if (kind !== "other" && !at) return NextResponse.json({ error: "Pick the time." }, { status: 400 });
    const minutes = kind === "lunch" ? Math.max(1, Math.min(240, Math.round(+b.minutes || 30))) : null;
    const note = String(b.note || "").slice(0, 500);
    if (kind === "other" && !note.trim()) return NextResponse.json({ error: "Say what needs fixing." }, { status: 400 });
    const { error } = await admin.from("time_fix_requests").insert({ employee_id: who.employeeId, day, kind, at, minutes, note });
    if (error) return NextResponse.json({ error: /time_fix_requests/.test(error.message) ? "Time card fixes aren't set up in the database yet. Tell the office." : error.message }, { status: 500 });
    // a fix asked on a day of a pay period: that period's check says so until the fix is decided (payday, Nov 13)
    const per = periodOf(await timeSettings(admin), day);
    await admin.from("time_card_checks").upsert({ employee_id: who.employeeId, period_start: per.start, period_end: per.end, status: "fix_asked", decided_at: new Date().toISOString() }, { onConflict: "employee_id,period_start" });
    return NextResponse.json({ ok: true });
  }
  // payday: "My hours are right" for a pay period (Nick, Nov 13 2026: uAttend's printed time card sheets, on the phone)
  if (b.action === "hours_ok") {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start || "")) ? String(b.start) : "";
    if (!start) return NextResponse.json({ error: "Which pay period?" }, { status: 400 });
    const per = periodOf(await timeSettings(admin), start);
    if (per.start !== start) return NextResponse.json({ error: "That isn't a pay period." }, { status: 400 });
    const { error } = await admin.from("time_card_checks").upsert({ employee_id: who.employeeId, period_start: per.start, period_end: per.end, status: "approved", hours: Math.round((+b.hours || 0) * 100) / 100, decided_at: new Date().toISOString() }, { onConflict: "employee_id,period_start" });
    if (error) return NextResponse.json({ error: /time_card_checks/.test(error.message) ? "Approving hours isn't set up in the database yet. Tell the office." : error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
