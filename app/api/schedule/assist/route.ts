import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";

/**
 * The schedule's assistant (Nick, Nov 13 2026: "add all Dear Heart jobs to the schedule for Monday… add all jobs that are
 * counted… clear Monday's schedule for Miguel, he's out and then it sets a downtime… a little schedule system he talks
 * to"). Staff say what they want; the AI answers with steps on the lists the page sends: book a waiting job (j…) on a
 * press and day, take a booked job (s…) back to Ready To Schedule, add downtime. The page shows the steps and does them
 * only on Do it (components/MachineSchedule.tsx doPlan). Anything not on the lists is dropped here.
 */
type J = { id: string; number: string; customer: string; name: string; due: string | null; prod: string | null; type: string; what: string; minutes: number; hold: string | null; counted: boolean; fits: string[] };
type S = { id: string; number: string; customer: string; name: string; machine: string; day: string; locked: string | null };
type P = { id: string; name: string; crew: string; type: string; load: Record<string, number>; shift: Record<string, string> };
type Out = { note: string; book?: { job: string; machine: string; day: string }[]; unbook?: { slot: string }[]; downtime?: { machine: string; day: string; from?: string; to?: string; note?: string }[] };

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => null) as { say?: string; today?: string; now?: string; days?: { day: string; name: string }[]; presses?: P[]; jobs?: J[]; booked?: S[] } | null;
  const say = String(b?.say || "").trim().slice(0, 600);
  if (!say) return NextResponse.json({ error: "Say what you want done." }, { status: 400 });
  const jobs = (b?.jobs || []).slice(0, 200), booked = (b?.booked || []).slice(0, 300), presses = (b?.presses || []).slice(0, 20), days = (b?.days || []).slice(0, 15);
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: "AI isn't set up yet." }, { status: 400 });
  const r = await askClaude<Out>({
    task: "schedule_assist", model: st.settings.assistant.ai.model, maxTokens: 4000, admin, ctx: { by: v.email }, timeoutMs: 50_000,
    tool: {
      name: "plan", description: "The steps to do on the schedule, using only the ids listed.",
      input_schema: { type: "object", properties: {
        note: { type: "string", description: "One or two plain sentences for the person: what these steps will do once they press Do it (not 'booked', since nothing is done yet), and anything you left out and why (on hold, no press fits, too full, locked)." },
        book: { type: "array", description: "Waiting jobs to put on a press.", items: { type: "object", properties: { job: { type: "string", description: "A job id from Ready To Schedule (j…)." }, machine: { type: "string", description: "A press id, one in the job's fits." }, day: { type: "string", description: "A listed day, YYYY-MM-DD." } }, required: ["job", "machine", "day"] } },
        unbook: { type: "array", description: "Booked jobs to take back to Ready To Schedule (to clear a press or a day).", items: { type: "object", properties: { slot: { type: "string", description: "A booked id (s…)." } }, required: ["slot"] } },
        downtime: { type: "array", description: "Time a press won't run (someone out, a repair). Leave from/to out for the whole day.", items: { type: "object", properties: { machine: { type: "string" }, day: { type: "string" }, from: { type: "string", description: "HH:MM, 24-hour" }, to: { type: "string", description: "HH:MM, 24-hour" }, note: { type: "string", description: "Why, short: 'Miguel out'" } }, required: ["machine", "day"] } },
      }, required: ["note"] },
    },
    system: "You run a print shop's press schedule for the person talking to you. Do exactly what they ask, nothing more. A press can be named by its crew leader (\"Kelsey\", \"Miguel\") or its name; a day by its weekday (the next one coming), \"tomorrow\", or a date. To book: pick only the waiting jobs they mean (customer, job name, number, kind of work, due date, goods counted…) and put each on the press and day they said; if they didn't say a press, choose one in the job's fits with room that day (load = minutes booked; shift = the day's hours) and keep a customer's jobs and same-art jobs together on one press; if they didn't say a day, use the earliest day with room, never before a job's prod date. Never book a job on hold unless they say so. Someone out or a press down: add downtime for that press and day (whole day unless they give times) and take that day's booked jobs on it back to Ready To Schedule, unless they say to move them somewhere instead (then take them off and book them where they say). Never take off a locked booking unless they say so. Use only the ids, press ids and days listed in the steps; in the note never write ids (j…, s…, p1): name jobs by their # number or customer, presses by crew leader, days like \"Monday\". If nothing matches, return no steps and say why in the note.",
    prompt: `Today is ${b?.today}, now ${b?.now}. They said: "${say}"\n\nDays: ${days.map((d) => `${d.day} (${d.name})`).join("; ")}\n\nPresses:\n${presses.map((p) => `${p.id}: ${p.name}${p.crew ? `, crew leader ${p.crew}` : ""}, ${p.type}; days ${Object.entries(p.shift).map(([d, sh]) => `${d} ${sh}, ${p.load[d] ?? 0} min booked`).join("; ")}`).join("\n")}\n\nWaiting in Ready To Schedule:\n${jobs.map((j) => `${j.id}: #${j.number} ${j.customer}${j.name ? ` · ${j.name}` : ""} · ${j.what} (${j.type}, ${j.minutes} min) · due ${j.due || "none"}${j.prod ? ` · prod ${j.prod}` : ""}${j.hold ? ` · ON HOLD (${j.hold})` : ""}${j.counted ? " · goods counted" : " · goods not counted"} · fits ${j.fits.join(",") || "none"}`).join("\n") || "(none)"}\n\nBooked, not started:\n${booked.map((x) => `${x.id}: #${x.number} ${x.customer}${x.name ? ` · ${x.name}` : ""} on ${x.machine} ${x.day}${x.locked ? ` · locked (${x.locked})` : ""}`).join("\n") || "(none)"}`,
  });
  if (!r.ok) return NextResponse.json({ error: r.error || "The assistant couldn't answer." }, { status: 500 });
  const jb = new Map(jobs.map((j) => [j.id, j])), sb = new Map(booked.map((x) => [x.id, x])), dayOk = new Set(days.map((d) => d.day)), pOk = new Set(presses.map((p) => p.id));
  const hm = (t?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? Math.min(1440, +m[1] * 60 + +m[2]) : null; };
  const seen = new Set<string>();
  const book = (r.data.book || []).filter((x) => { const j = jb.get(x.job); if (!j || seen.has(x.job) || !j.fits.includes(x.machine) || !dayOk.has(x.day)) return false; seen.add(x.job); return true; });
  const us = new Set<string>();
  const unbook = (r.data.unbook || []).filter((x) => sb.has(x.slot) && !us.has(x.slot) && us.add(x.slot));
  const downtime = (r.data.downtime || []).filter((d) => pOk.has(d.machine) && dayOk.has(d.day)).map((d) => { const f = hm(d.from), t = hm(d.to); return { machine: d.machine, day: d.day, from: f != null && t != null && t > f ? f : null, to: f != null && t != null && t > f ? t : null, note: String(d.note || "").slice(0, 80) }; });
  return NextResponse.json({ note: r.data.note || "", book, unbook, downtime });
}
