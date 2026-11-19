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
  const [running, { data: log }, { data: emps }, { data: ran }] = await Promise.all([
    runningJob(admin, employeeId),
    admin.from("job_time").select(COLS).eq(col(job), job.id).eq("voided", false).gte("started_at", new Date(Date.now() - 20 * 3600000).toISOString()).order("started_at"),
    admin.from("employees").select("id, first_name, last_name"),
    // every side printed on this job, any day (the front today, the back tomorrow: one job; Nick, Nov 16 2026)
    admin.from("job_time").select("task").eq(col(job), job.id).eq("voided", false).like("task", "Run · %").not("ended_at", "is", null).limit(300),
  ]);
  const name = new Map(((emps || []) as { id: string; first_name: string; last_name: string }[]).map((e) => [e.id, `${e.first_name || ""} ${(e.last_name || "").slice(0, 1)}`.trim()]));
  const today = localDay(new Date());
  const rows = ((log || []) as JobTime[]).filter((r) => localDay(r.started_at) === today).map((r) => ({ ...r, who: name.get(r.employee_id) || "" }));
  // paused: my last entry on this job stopped with "Paused: …" and nothing running since
  // my last entry on this job, any of the last 3 days: stopped with "Paused: …" (End of shift today, carried on tomorrow)
  // and nothing running since, it's still paused
  const { data: myLast } = await admin.from("job_time").select(COLS).eq(col(job), job.id).eq("employee_id", employeeId).eq("voided", false).gte("started_at", new Date(Date.now() - 3 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(1);
  const last = ((myLast || []) as JobTime[])[0];
  const paused = !running && last?.ended_at && /^Paused/.test(last.note || "") ? last : null;
  const done = [...new Set(((ran || []) as { task: string }[]).map((r) => r.task.replace(/^Run · /, "")))];
  return { running, paused, log: rows, done };
}

export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sp = new URL(req.url).searchParams, job = { kind: sp.get("kind"), id: sp.get("id") } as J;
  if ((job.kind !== "o" && job.kind !== "a") || !job.id) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  if (!who.employeeId) return NextResponse.json({ me: null });
  const admin = createAdminClient();
  // clocked in today? the timer asks first when not (Nick, Nov 16 2026)
  const { statusOf, timeSettings } = await import("@/lib/timeclockServer");
  const [st, ck] = await Promise.all([state(admin, who.employeeId, job), timeSettings(admin).then((s) => statusOf(admin, s, who.employeeId!)).catch(() => null)]);
  return NextResponse.json({ me: { name: who.name }, clock: ck ? ck.state : null, ...st });
}

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who?.employeeId) return NextResponse.json({ error: "Sign in with your employee number to log time." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { job?: J; action?: string; location?: string; press?: string; reason?: string; pieces?: number | null; done?: number; why?: string;
    /** a side done (Nick, Nov 16 2026): rejects by garment and size and why, an ink changed, a press setup worth keeping,
     * and on the last side, why it took longer than planned and by how much */
    wrap?: { rejects?: { style: string; color: string; size: string; n: number }[]; rejectWhy?: string; ink?: string; layout?: string[]; slow?: { why: string; minutes: number; note?: string } } };
  const job = b.job;
  if (!job || (job.kind !== "o" && job.kind !== "a") || !job.id) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const admin = createAdminClient(), me = who.employeeId;
  const loc = String(b.location || "").trim().slice(0, 40) || "Whole job", press = String(b.press || "").slice(0, 40);
  const start = async (task: string, station: string) => { const r = await startJob(admin, { employeeId: me, job, task, station, source: "phone" }); return "error" in r && r.error ? r.error : ""; };
  let err = "";
  const run = await runningJob(admin, me);
  const here = run && (job.kind === "o" ? run.order_id : run.archived_order_id) === job.id ? run : null;

  // Start / Pause / Resume on the phone move the job on the schedule too, live clock on or off (Nick, Nov 13: "being able to
  // start and stop a job for the press operators so that it keeps the schedule going"): the same booking fields the
  // schedule's right-click writes (Mark started, Pause, Resume), on this job's booking for the press picked
  const { data: stRow0 } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const machs0 = (((stRow0?.data as { production?: { machines?: { id: string; name: string; type: string }[] } } | null)?.production?.machines) || []);
  const pressM = machs0.find((m) => m.name === press || m.id === press);
  async function slotMove(to: "start" | "pause" | "resume", done?: number, why?: string) {
    if (job!.kind !== "o") return;
    const { data: sl } = await admin.from("production_slots").select("id, order_id, machine, day, status, started_at, progress, minutes").eq("order_id", job!.id).neq("status", "done").order("day");
    const list = (sl || []) as { id: string; order_id: string; machine: string; day: string; status: string; started_at: string | null; progress: number | null }[];
    const typeOf = (x: string) => machs0.find((m) => m.id === x)?.type || "";
    const pick = list.find((x) => pressM && x.machine === pressM.id && (to === "start" ? x.status !== "done" : x.status !== "scheduled"))
      || list.find((x) => (!pressM || typeOf(x.machine) === pressM.type) && (to === "start" ? true : x.status !== "scheduled"));
    if (!pick) return;
    const now = new Date().toISOString(), p = done != null && isFinite(done) ? Math.max(+(pick.progress || 0), Math.min(0.95, Math.max(0, done))) : +(pick.progress || 0);
    const patch = to === "pause" ? { status: "paused", progress: p, progress_at: now } : { status: "running", started_at: pick.started_at || now, progress: p, progress_at: now };
    if (to === "pause" ? pick.status !== "running" : pick.status === "running") return;
    // started on another press than it was booked on: it runs there
    const move = to === "start" && pressM && pick.machine !== pressM.id && typeOf(pick.machine) === pressM.type ? { machine: pressM.id } : {};
    await admin.from("production_slots").update({ ...patch, ...move, ends_at: null, updated_at: now }).eq("id", pick.id);
    await admin.from("production_slot_log").insert({ slot_id: pick.id, order_id: pick.order_id, machine: (move as { machine?: string }).machine || pick.machine, action: to, progress: p, note: why ? `On the phone · ${why}` : "On the phone", by: who!.name });
  }

  async function sideDone(side: string) {
    const { data: sl } = await admin.from("production_slots").select("id, sides_done, locations").eq("order_id", job!.id).neq("status", "done").order("day").limit(5);
    const pick = ((sl || []) as { id: string; sides_done: string[] | null; locations: string[] | null }[]).find((x) => !x.locations?.length || x.locations.some((l) => l.toLowerCase() === side.toLowerCase())) || (sl || [])[0] as { id: string; sides_done: string[] | null } | undefined;
    if (!pick) return;
    const done = [...new Set([...(pick.sides_done || []), side])];
    await admin.from("production_slots").update({ sides_done: done, updated_at: new Date().toISOString() }).eq("id", pick.id);
  }

  if (b.action === "setup") { err = await start(`Setup · ${loc}`, press); if (!err) await slotMove("start"); }
  else if (b.action === "run") { err = await start(`Run · ${loc}`, press); if (!err) await slotMove("start"); }
  // some sides now, the rest another day (Nick, Nov 16 2026: "we'll just run the front… come back next day and run the
  // back… it doesn't mean we're splitting it up"): one job, its booking paused with the printed sides counted as done, so
  // the schedule keeps only what's left; starting the next side later picks the same booking back up
  else if (b.action === "later") {
    if (here) await stopJob(admin, me, { note: "Rest later" });
    const done = Number((b as { done?: number }).done);
    await slotMove("pause", isFinite(done) ? done : undefined, String((b as { why?: string }).why || "").slice(0, 80) || "rest of the job later");
  }
  else if (b.action === "pause") {
    if (!here) err = "Nothing is running on this job.";
    else { await stopJob(admin, me, { note: `Paused: ${String(b.reason || "Paused").slice(0, 60)}` }); await slotMove("pause"); }
  } else if (b.action === "why") {
    // the reason for a pause, changed after the fact
    const st = await state(admin, me, job);
    if (!st.paused) err = "Nothing is paused on this job.";
    else await admin.from("job_time").update({ note: `Paused: ${String(b.reason || "Paused").slice(0, 60)}` }).eq("id", st.paused.id);
  } else if (b.action === "resume") {
    const st = await state(admin, me, job);
    if (!st.paused) err = "Nothing is paused on this job.";
    else { err = await start(st.paused.task, st.paused.station); if (!err) await slotMove("resume"); }
  } else if (b.action === "finish" || b.action === "done") {
    const w = b.wrap || {};
    const rej = (Array.isArray(w.rejects) ? w.rejects : []).map((r) => ({ style: String(r.style || "").slice(0, 60), color: String(r.color || "").slice(0, 60), size: String(r.size || "").slice(0, 12), n: Math.max(0, Math.round(+r.n || 0)) })).filter((r) => r.n > 0).slice(0, 200);
    const rejN = rej.reduce((a, r) => a + r.n, 0), rejWhy = String(w.rejectWhy || "Misprint").slice(0, 40);
    const slow = w.slow && w.slow.why ? { why: String(w.slow.why).slice(0, 60), minutes: Math.max(0, Math.min(600, Math.round(+w.slow.minutes || 0))), note: String(w.slow.note || "").slice(0, 300) } : null;
    const parts = [b.action === "done" ? "Job done" : "",
      rejN ? `${rejN} reject${rejN > 1 ? "s" : ""} (${rejWhy}): ${rej.map((r) => `${[r.style, r.color].filter(Boolean).join(" ")} ${r.size} ×${r.n}`).join(", ")}` : "",
      w.ink ? `Ink changed: ${String(w.ink).slice(0, 200)}` : "",
      slow ? `Took longer: ${slow.why}${slow.minutes ? `, +${slow.minutes} min` : ""}${slow.note ? ` (${slow.note})` : ""}` : ""].filter(Boolean);
    if (here) await stopJob(admin, me, { pieces: b.pieces != null && isFinite(+b.pieces) ? +b.pieces : null, note: parts.join(" · ").slice(0, 900) });
    const side = here && /^Run · /.test(here.task) ? here.task.replace(/^Run · /, "") : loc;
    if (job.kind === "o" && (rejN || slow || w.ink)) {
      const { data: sl } = await admin.from("production_slots").select("id, kind, machine").eq("order_id", job.id).order("day", { ascending: false }).limit(1).maybeSingle();
      // the press operator's rejects print again: an Issue on the run (Reject), by size; the catcher's count takes them off
      if (rejN) {
        const sizes: Record<string, number> = {};
        for (const r of rej) sizes[r.size] = (sizes[r.size] || 0) + r.n;
        await admin.from("production_issues").insert({ order_id: job.id, kind: (sl?.kind as string) || "screen", locations: side && side !== "Whole job" ? [side.replace(/^.* · /, "")] : null, why: "reject", sizes, pcs: rejN, from_slot: sl?.id || null, by: who.name });
      }
      // why it ran long, for the schedule's log and how jobs like it get figured
      if (sl) await admin.from("production_slot_log").insert({ slot_id: sl.id, order_id: job.id, machine: sl.machine, action: "progress", note: parts.filter((x) => x !== "Job done").join(" · ").slice(0, 900), by: who.name });
    }
    // a tricky setup worth keeping: this press's layout (flashes, cool downs) is remembered until it's changed again
    const lay = (Array.isArray(w.layout) ? w.layout : []).map(String).filter((x) => ["print", "flash", "cool", "down", "roller", "flashdown"].includes(x)).slice(0, 20);
    if (lay.length && pressM) {
      const now = new Date().toISOString();
      const up = await admin.from("production_equipment").upsert({ machine: pressM.id, stations: lay, updated_by: who.name, updated_at: now }, { onConflict: "machine" });
      if (!up.error) await admin.from("production_equipment_log").insert({ machine: pressM.id, note: `Press setup saved on the phone (#${here?.job_label || ""} ${side})`.trim(), by: who.name, stations: lay });
    }
    // a side printed (the run of one spot finished): the schedule's card says so, "Front done" (Nick, Nov 16 2026)
    if (b.action === "finish" && here && /^Run · /.test(here.task) && job.kind === "o") await sideDone(here.task.replace(/^Run · /, ""));
    else if (b.action === "finish") err = "Nothing is running on this job.";
    if (!err && b.action === "done" && job.kind === "o") {
      // the whole job is printed: today's (and earlier) unfinished bookings on the calendar are done
      const now = new Date().toISOString();
      const { data: sl0 } = await admin.from("production_slots").select("id, order_id, machine, status, started_at, progress_at, issue_id, locations, day").eq("order_id", job.id).neq("status", "done");
      // only this kind of machine's bookings (Nov 12, Nick, #40313): the screen printer finishing a mixed job's tees
      // never finishes its embroidery or heat press part
      const { data: stRow } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const machs = (((stRow?.data as { production?: { machines?: { id: string; name: string; type: string }[] } } | null)?.production?.machines) || []);
      const typeOf = (x: string) => machs.find((m) => m.id === x || m.name === x)?.type || "";
      const mine = typeOf(press || here?.station || "");
      // printed is printed (Nick, Nov 19 2026, #50006 done twice): when the whole job is booked more than once on this kind
      // of machine, the bookings that never started are the same job booked twice; they go instead of being marked done
      type SlRow = { id: string; order_id: string; machine: string; status: string; started_at: string | null; progress_at?: string | null; issue_id?: string | null; locations?: string[] | null; day: string };
      const all0 = ((sl0 || []) as SlRow[]).filter((x) => !mine || typeOf(x.machine) === mine);
      const whole = all0.filter((x) => !x.issue_id && !(x.locations || []).length).sort((x, y) => x.day.localeCompare(y.day));
      const keep = whole.filter((x) => x.started_at || x.status !== "scheduled");
      const extra = whole.filter((x) => !x.started_at && x.status === "scheduled" && x !== (keep.length ? null : whole[0]));
      if (extra.length) await admin.from("production_slots").delete().in("id", extra.map((x) => x.id));
      const sl = ((sl0 || []) as SlRow[]).filter((x) => !extra.includes(x));
      for (const s of ((sl || []) as { id: string; order_id: string; machine: string; status: string; started_at: string | null; progress_at?: string | null }[]).filter((x) => !mine || typeOf(x.machine) === mine)) {
        // a paused run finishes at its pause: nothing ran after it (the schedule's logAction does the same)
        const fin = s.status === "paused" && s.progress_at && s.progress_at < now ? s.progress_at : now;
        await admin.from("production_slots").update({ status: "done", finished_at: fin, started_at: s.started_at || now, progress: 1, progress_at: fin, updated_at: now }).eq("id", s.id);
        // an Issue's pieces printed (missing goods, rejects, a reprint): the issue is closed
        if ((s as { issue_id?: string | null }).issue_id) await admin.from("production_issues").update({ status: "done", done_at: now }).eq("id", (s as { issue_id?: string | null }).issue_id!);
        await admin.from("production_slot_log").insert({ slot_id: s.id, order_id: s.order_id, machine: s.machine, action: "done", progress: 1, note: "Finished on the phone", by: who.name });
      }
      // its last job on the schedule: the order goes on to Fulfillment (as the schedule's Complete does), unless pieces are
      // still to print (an open Issue) or another part (embroidery, heat press) isn't done
      const [{ data: rest }, { data: oi }, { data: o }] = await Promise.all([
        admin.from("production_slots").select("id").eq("order_id", job.id).neq("status", "done").limit(1),
        admin.from("production_issues").select("id").eq("order_id", job.id).eq("status", "open").limit(1),
        admin.from("orders").select("status").eq("id", job.id).maybeSingle(),
      ]);
      const cur = (o?.status as string) || "";
      if (!(rest || []).length && !(oi || []).length && ["approved", "art", "blanks", "production"].includes(cur)) {
        // straight on to Ready (pickup / ship / deliver), as the schedule's Complete does to start with (Nick, Nov 16 2026:
        // "as soon as Miguel marks it done… it moves to the next step"); the catcher's count comes after and reports
        // anything short as a problem
        const up = await admin.from("orders").update({ status: "ready", type: "invoice" }).eq("id", job.id);
        if (!up.error) await admin.from("order_events").insert({ order_id: job.id, kind: "status", detail: "ready", actor: who.name });
      }
    }
  } else err = "Pick what you're doing.";
  if (err) return NextResponse.json({ error: err }, { status: 409 });
  return NextResponse.json({ me: { name: who.name }, ...(await state(admin, me, job)) });
}
