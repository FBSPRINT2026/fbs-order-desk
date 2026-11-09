"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";

/**
 * The schedule's run times (Nov 9, Nick): staff set how long a print location takes, and every finished run is kept to
 * learn each press operator's pace from (run_lessons, lib/runLearn.ts).
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
type Who = { machine: string; crewId: string | null; operator: string | null };

/** set (or clear, minutes null) how long a print location of an order takes; kept as a lesson about the operator too */
export async function setRunTime(x: Who & { orderId: string; loc: string; minutes: number | null; estMin: number; qty: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("run_times").eq("id", x.orderId).maybeSingle();
    if (!o) return { ok: false, error: "Couldn't find the order." };
    const rt = { ...((o.run_times as Record<string, unknown>) || {}) };
    const loc = x.loc.trim().toLowerCase().slice(0, 80);
    const { data: sf } = await admin.from("staff").select("name").eq("email", (v.email || "").toLowerCase()).maybeSingle();
    const by = String(sf?.name || v.email || "staff").split(" ")[0];
    if (x.minutes == null) delete rt[loc];
    else rt[loc] = { min: Math.round(Math.max(1, Math.min(60 * 60, x.minutes))), by, at: new Date().toISOString() };
    const { error } = await admin.from("orders").update({ run_times: Object.keys(rt).length ? rt : null }).eq("id", x.orderId);
    if (error) return { ok: false, error: error.message };
    if (x.minutes != null && x.estMin > 0)
      await admin.from("run_lessons").insert({ order_id: x.orderId, machine: x.machine, crew_id: x.crewId, operator: x.operator, location: loc, kind: "said", est_min: x.estMin, real_min: x.minutes, qty: x.qty || null, created_by: v.email || "" });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

const CT = "America/Chicago";
const minOfDay = (d: Date) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: CT, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d); return (+(p.find((q) => q.type === "hour")?.value || 0) % 24) * 60 + +(p.find((q) => q.type === "minute")?.value || 0); };
/** minutes of a stretch that fall in the work day (5 am – 8 pm), less lunch when it's inside */
function workMinutes(a: Date, b: Date, lunchAt: number, lunchMin: number): number {
  let t = 0;
  for (let x = a.getTime(); x < b.getTime(); x += 60000) { const m = minOfDay(new Date(x)); if (m >= 300 && m < 1200 && !(m >= lunchAt && m < lunchAt + lunchMin)) t++; }
  return t;
}

/** a booking marked Finished: how long it really took on the press, kept against the standard time */
export async function learnRun(x: Who & { slotId: string; estMin: number; qty: number; lunchAt: number; lunchMin: number }): Promise<{ ok: boolean; minutes?: number }> {
  try {
    const v = await staff();
    if (!(x.estMin > 0)) return { ok: false };
    const admin = createAdminClient();
    const { data: sl } = await admin.from("production_slots").select("id, order_id, day, started_at, finished_at, locations").eq("id", x.slotId).maybeSingle();
    if (!sl?.order_id) return { ok: false };
    const { data: lg } = await admin.from("production_slot_log").select("action, at").eq("slot_id", x.slotId).order("at");
    // running stretches: Start / Resume → Pause / Finished
    let real = 0, from: Date | null = null;
    for (const r of (lg || []) as { action: string; at: string }[]) {
      if (r.action === "start" || r.action === "resume" || r.action === "reopen") from = from || new Date(r.at);
      else if ((r.action === "pause" || r.action === "done") && from) { real += workMinutes(from, new Date(r.at), x.lunchAt, x.lunchMin); from = null; }
      else if (r.action === "not_started") { real = 0; from = null; }
    }
    // nobody pressed Start: the operator's own job clock on this order (the time clock's jobs)
    if (real < 5 && x.operator) {
      const day0 = new Date(`${sl.day}T00:00:00-06:00`), day1 = new Date(day0.getTime() + 36 * 3600000);
      const { data: jt } = await admin.from("job_time").select("started_at, ended_at").eq("employee_id", x.operator).eq("order_id", sl.order_id).eq("voided", false).not("ended_at", "is", null).gte("started_at", new Date(day0.getTime() - 7 * 86400000).toISOString()).lte("started_at", day1.toISOString());
      real = ((jt || []) as { started_at: string; ended_at: string }[]).reduce((t, j) => t + workMinutes(new Date(j.started_at), new Date(j.ended_at), x.lunchAt, x.lunchMin), 0);
    }
    // nothing believable to learn from (a run marked done hours later, or pressed by mistake)
    if (real < 5 || real / x.estMin > 4 || real / x.estMin < 0.2) return { ok: true };
    await admin.from("run_lessons").insert({ order_id: sl.order_id, slot_id: x.slotId, machine: x.machine, crew_id: x.crewId, operator: x.operator, location: ((sl.locations as string[] | null) || []).join(", ").slice(0, 200), kind: "ran", est_min: Math.round(x.estMin), real_min: real, qty: x.qty || null, created_by: v.email || "" });
    return { ok: true, minutes: real };
  } catch { return { ok: false }; }
}
