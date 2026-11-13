import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";

/**
 * The schedule's assistant (Nick, Nov 13 2026: "right underneath start over and make the schedule… if I wanted to say
 * add all Dear Heart jobs to the schedule for Monday it would do it"). Staff say what they want; the AI picks jobs from
 * Ready To Schedule, a press and a day for each, from the lists the page sends (nothing made up). The page shows the
 * plan and books it only when staff press Book (components/MachineSchedule.tsx bookPlan).
 */
type J = { k: string; number: string; customer: string; name: string; due: string | null; prod: string | null; type: string; what: string; minutes: number; hold: string | null; counted: boolean; fits: string[] };
type P = { id: string; name: string; crew: string; type: string; load: Record<string, number>; shift: Record<string, number> };
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => null) as { say?: string; today?: string; days?: { day: string; name: string }[]; presses?: P[]; jobs?: J[] } | null;
  const say = String(b?.say || "").trim().slice(0, 600);
  if (!say) return NextResponse.json({ error: "Say what you want done." }, { status: 400 });
  const jobs = (b?.jobs || []).slice(0, 200), presses = (b?.presses || []).slice(0, 20), days = (b?.days || []).slice(0, 15);
  if (!jobs.length) return NextResponse.json({ note: "Nothing is waiting in Ready To Schedule.", rows: [] });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: "AI isn't set up yet." }, { status: 400 });
  const r = await askClaude<{ note: string; rows: { k: string; machine: string; day: string }[] }>({
    task: "schedule_assist", model: st.settings.assistant.ai.model, maxTokens: 3000, admin, ctx: { by: v.email }, timeoutMs: 45_000,
    tool: {
      name: "plan", description: "The jobs to book, each on a press and a day, from the lists given.",
      input_schema: { type: "object", properties: {
        note: { type: "string", description: "One or two plain sentences for the person: what you'll book, and anything you couldn't (a job on hold, no press that fits, the day too full). No jargon." },
        rows: { type: "array", items: { type: "object", properties: { k: { type: "string", description: "The job's k, exactly as listed." }, machine: { type: "string", description: "A press id from the list, one in the job's fits." }, day: { type: "string", description: "A day (YYYY-MM-DD) from the list." } }, required: ["k", "machine", "day"] } },
      }, required: ["note", "rows"] },
    },
    system: "You help a print shop book jobs from its Ready To Schedule list onto presses. Do exactly what the person asks and nothing more: pick only the jobs they mean (by customer, job name, number, kind of work, due date, counted goods…), and put each on the press and day they said. A press can be named by its crew leader (\"Kelsey\") or its name. When they don't name a press, choose one in the job's fits that has room that day (load is minutes already booked; shift is the day's minutes) and keep jobs of the same customer and art together on one press. When they don't name a day, use the earliest day with room, not before the job's prod date. Never book a job that is on hold unless they say so; say so in the note. Use only k, machine ids and days from the lists. If nothing matches, return no rows and say why.",
    prompt: `Today is ${b?.today}. They said: "${say}"\n\nDays: ${days.map((d) => `${d.day} (${d.name})`).join("; ")}\n\nPresses:\n${presses.map((p) => `${p.id}: ${p.name}${p.crew ? `, crew leader ${p.crew}` : ""}, ${p.type}; load ${Object.entries(p.load).map(([d, m]) => `${d} ${m}/${p.shift[d] || 0}`).join(", ")}`).join("\n")}\n\nReady To Schedule:\n${jobs.map((j) => `k=${j.k} #${j.number} ${j.customer}${j.name ? ` · ${j.name}` : ""} · ${j.what} (${j.type}, ${j.minutes} min) · due ${j.due || "none"}${j.prod ? ` · prod ${j.prod}` : ""}${j.hold ? ` · ON HOLD (${j.hold})` : ""}${j.counted ? " · goods counted" : ""} · fits ${j.fits.join(",") || "none"}`).join("\n")}`,
  });
  if (!r.ok) return NextResponse.json({ error: r.error || "The assistant couldn't answer." }, { status: 500 });
  // only what the page offered: real jobs, presses that fit, listed days
  const byK = new Map(jobs.map((j) => [j.k, j])), dayOk = new Set(days.map((d) => d.day)), seen = new Set<string>();
  const rows = (r.data.rows || []).filter((x) => { const j = byK.get(x.k); if (!j || seen.has(x.k) || !j.fits.includes(x.machine) || !dayOk.has(x.day)) return false; seen.add(x.k); return true; });
  return NextResponse.json({ note: r.data.note || "", rows });
}
