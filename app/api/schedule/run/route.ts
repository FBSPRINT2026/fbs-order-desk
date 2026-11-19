import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { moveOnIfPrinted } from "@/lib/partsPrinted";
import { runDayFrom } from "@/lib/weeklyRun";

export const dynamic = "force-dynamic";

/**
 * A weekly run worked as one job (Nick, Nov 19 2026: "they'll just click and say AMS weekly run start… when you click done…
 * tell me all the POs that you completed and printed… check them off the list"; a PO left unchecked is confirmed not
 * printed and moves to next week's run). The run = the weekly-run bookings (source weekly_run) on one press and day.
 * Used by the crew phone's menu and the schedule (components/WeeklyRun.tsx).
 * POST { ids: the run's slot ids, day: its run day, action: "start" | "pause" | "resume" | "done", printed?: slot ids, notPrinted?: slot ids }
 */
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (who.viewAs) return NextResponse.json({ error: "Looking only (View as): nothing saves." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(Boolean).slice(0, 200), day = String(b.day || ""), action = String(b.action || "");
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "Which run?" }, { status: 400 });
  const admin = createAdminClient(), now = new Date().toISOString();
  const { data: sl } = await admin.from("production_slots").select("id, order_id, machine, day, status, started_at").in("id", ids);
  const run = (sl || []) as { id: string; order_id: string; machine: string; day: string; status: string; started_at: string | null }[];
  if (!run.length) return NextResponse.json({ error: "That run isn't on the schedule." }, { status: 404 });
  const log = (rows: typeof run, act: string, note: string, progress?: number) =>
    rows.length ? admin.from("production_slot_log").insert(rows.map((x) => ({ slot_id: x.id, order_id: x.order_id, machine: x.machine, action: act, ...(progress != null ? { progress } : {}), note, by: who.name }))) : Promise.resolve();

  if (action === "start" || action === "resume") {
    const go = run.filter((x) => x.status === "scheduled" || x.status === "paused");
    for (const x of go) await admin.from("production_slots").update({ status: "running", started_at: x.started_at || now, updated_at: now }).eq("id", x.id);
    await log(go, action, action === "start" ? "Weekly run started" : "Weekly run resumed");
    if (action === "start") await admin.from("orders").update({ status: "production" }).in("id", [...new Set(go.map((x) => x.order_id))]).eq("status", "approved");
    return NextResponse.json({ ok: true, n: go.length });
  }
  if (action === "pause") {
    const go = run.filter((x) => x.status === "running");
    for (const x of go) await admin.from("production_slots").update({ status: "paused", updated_at: now }).eq("id", x.id);
    await log(go, "pause", "Weekly run paused");
    return NextResponse.json({ ok: true, n: go.length });
  }
  if (action === "done") {
    const ids = new Set(run.map((x) => x.id));
    const printed = run.filter((x) => (b.printed || []).includes(x.id) && x.status !== "done");
    const not = run.filter((x) => (b.notPrinted || []).includes(x.id) && x.status !== "done");
    if ([...(b.printed || []), ...(b.notPrinted || [])].some((id: string) => !ids.has(id))) return NextResponse.json({ error: "A PO isn't on this run." }, { status: 400 });
    for (const x of printed) await admin.from("production_slots").update({ status: "done", started_at: x.started_at || now, finished_at: now, progress: 1, progress_at: now, updated_at: now }).eq("id", x.id);
    await log(printed, "done", "Printed on the weekly run", 1);
    // not printed: confirmed, and on next week's run (the same day of the week), not started
    const next = runDayFrom(addDay(day, 1), new Date(day + "T12:00:00Z").getUTCDay());
    for (const x of not) await admin.from("production_slots").update({ status: "scheduled", started_at: null, finished_at: null, progress: 0, day: next, start_min: null, locked: "press", rolled_from: day, updated_at: now }).eq("id", x.id);
    await log(not, "not_started", `Not printed on the weekly run; moved to ${next}`);
    // and they belong to next week's run (its production date), so the run there picks them up
    if (not.length) await admin.from("orders").update({ production_date: next }).in("id", [...new Set(not.map((x) => x.order_id))]).lte("production_date", day);
    const moved: string[] = [];
    for (const oid of [...new Set(printed.map((x) => x.order_id))]) if (await moveOnIfPrinted(admin, oid, who.name).catch(() => null)) moved.push(oid);
    return NextResponse.json({ ok: true, printed: printed.length, movedTo: not.length ? next : null, notPrinted: not.length, onward: moved.length });
  }
  return NextResponse.json({ error: "Start, pause, resume or done?" }, { status: 400 });
}
