import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { runningJob, startJob, stopJob } from "@/lib/timeclockServer";
import type { JobTime } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

/**
 * The press timer on the job's phone menu, for whoever is signed in on that phone with their employee # and PIN.
 * Setup and run times per print location ("Setup · Full Front", "Run · Full Front"), pauses with a reason (lunch,
 * break…), finish with pieces, and "whole job done". Stored as job time (the same entries the employee app makes),
 * so labor hours, pieces per hour and the calendar's Running status all follow.
 *
 * GET ?kind&id → { me, running (any job), paused (this job), log (this job, today, everyone) }
 * POST { job, action: setup | run | pause | resume | finish | done, location?, press?, reason?, pieces? }
 */
const COLS = "id, employee_id, order_id, archived_order_id, job_label, task, station, started_at, ended_at, pieces, note, source, team_id, auto_stopped, voided";
type J = { kind: "o" | "a"; id: string };
const col = (j: J) => (j.kind === "o" ? "order_id" : "archived_order_id");
const localDay = (d: string | Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function state(admin: ReturnType<typeof createAdminClient>, employeeId: string, job: J) {
  const [running, { data: log }, { data: emps }] = await Promise.all([
    runningJob(admin, employeeId),
    admin.from("job_time").select(COLS).eq(col(job), job.id).eq("voided", false).gte("started_at", new Date(Date.now() - 20 * 3600000).toISOString()).order("started_at"),
    admin.from("employees").select("id, first_name, last_name"),
  ]);
  const name = new Map(((emps || []) as { id: string; first_name: string; last_name: string }[]).map((e) => [e.id, `${e.first_name || ""} ${(e.last_name || "").slice(0, 1)}`.trim()]));
  const today = localDay(new Date());
  const rows = ((log || []) as JobTime[]).filter((r) => localDay(r.started_at) === today).map((r) => ({ ...r, who: name.get(r.employee_id) || "" }));
  // paused: my last entry on this job stopped with "Paused: …" and nothing running since
  const mine = rows.filter((r) => r.employee_id === employeeId);
  const last = mine[mine.length - 1];
  const paused = !running && last?.ended_at && /^Paused/.test(last.note || "") ? last : null;
  return { running, paused, log: rows };
}

export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sp = new URL(req.url).searchParams, job = { kind: sp.get("kind"), id: sp.get("id") } as J;
  if ((job.kind !== "o" && job.kind !== "a") || !job.id) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  if (!who.employeeId) return NextResponse.json({ me: null });
  return NextResponse.json({ me: { name: who.name }, ...(await state(createAdminClient(), who.employeeId, job)) });
}

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who?.employeeId) return NextResponse.json({ error: "Sign in with your employee number to log time." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { job?: J; action?: string; location?: string; press?: string; reason?: string; pieces?: number | null };
  const job = b.job;
  if (!job || (job.kind !== "o" && job.kind !== "a") || !job.id) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const admin = createAdminClient(), me = who.employeeId;
  const loc = String(b.location || "").trim().slice(0, 40) || "Whole job", press = String(b.press || "").slice(0, 40);
  const start = async (task: string, station: string) => { const r = await startJob(admin, { employeeId: me, job, task, station, source: "phone" }); return "error" in r && r.error ? r.error : ""; };
  let err = "";
  const run = await runningJob(admin, me);
  const here = run && (job.kind === "o" ? run.order_id : run.archived_order_id) === job.id ? run : null;

  if (b.action === "setup") err = await start(`Setup · ${loc}`, press);
  else if (b.action === "run") err = await start(`Run · ${loc}`, press);
  else if (b.action === "pause") {
    if (!here) err = "Nothing is running on this job.";
    else await stopJob(admin, me, { note: `Paused: ${String(b.reason || "Paused").slice(0, 60)}` });
  } else if (b.action === "resume") {
    const st = await state(admin, me, job);
    if (!st.paused) err = "Nothing is paused on this job.";
    else err = await start(st.paused.task, st.paused.station);
  } else if (b.action === "finish" || b.action === "done") {
    if (here) await stopJob(admin, me, { pieces: b.pieces != null && isFinite(+b.pieces) ? +b.pieces : null, note: b.action === "done" ? "Job done" : "" });
    else if (b.action === "finish") err = "Nothing is running on this job.";
    if (!err && b.action === "done" && job.kind === "o") {
      // the whole job is printed: today's (and earlier) unfinished bookings on the calendar are done
      const now = new Date().toISOString();
      const { data: sl } = await admin.from("production_slots").select("id, order_id, machine, status, started_at").eq("order_id", job.id).neq("status", "done");
      for (const s of (sl || []) as { id: string; order_id: string; machine: string; status: string; started_at: string | null }[]) {
        await admin.from("production_slots").update({ status: "done", finished_at: now, started_at: s.started_at || now, progress: 1, progress_at: now, updated_at: now }).eq("id", s.id);
        await admin.from("production_slot_log").insert({ slot_id: s.id, order_id: s.order_id, machine: s.machine, action: "done", progress: 1, note: "Finished on the phone", by: who.name });
      }
    }
  } else err = "Pick what you're doing.";
  if (err) return NextResponse.json({ error: err }, { status: 409 });
  return NextResponse.json({ me: { name: who.name }, ...(await state(admin, me, job)) });
}
