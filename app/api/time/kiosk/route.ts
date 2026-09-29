import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEVICE_COOKIE, clockedIn, jobAction, deviceFor, openJobs, pinFailed, pinOk, recordPunch, shopName, startJob, statusOf, stopJob, timeSettings, validPin, verifyEmployeePin } from "@/lib/timeclockServer";
import type { Punch } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

/**
 * The wall clock (a tablet set up by a manager; no staff login on it). GET: who can punch here.
 * POST { employee_id, pin, kind? }: without `kind` it just checks the PIN and says what they can do next;
 * with `kind` it records the punch (and the photo, if the clock took one).
 */
export async function GET() {
  const admin = createAdminClient();
  const dev = await deviceFor(admin, (await cookies()).get(DEVICE_COOKIE)?.value);
  if (!dev) return NextResponse.json({ paired: false });
  const [s, name, { data: emps }] = await Promise.all([
    timeSettings(admin), shopName(admin),
    admin.from("employees").select("id, first_name, last_name, department, color, has_pin").eq("active", true).order("first_name"),
  ]);
  // who's in right now (last punch today or still open)
  const { data: recent } = await admin.from("time_punches").select("employee_id, kind, at").eq("voided", false).gte("at", new Date(Date.now() - 36 * 3600000).toISOString()).order("at");
  const last = new Map<string, { kind: string; at: string }>();
  for (const p of (recent || []) as { employee_id: string; kind: string; at: string }[]) last.set(p.employee_id, p);
  return NextResponse.json({
    paired: true, device: dev.name, shop: name, photo: s.photo, tasks: s.tasks, stations: s.stations, locked: dev.locked_until && Date.parse(dev.locked_until) > Date.now() ? dev.locked_until : null,
    employees: (emps || []).map((e) => { const l = last.get(e.id); return { ...e, state: !l || l.kind === "out" ? "out" : l.kind === "break_start" ? "break" : "in", since: l && l.kind !== "out" ? l.at : null }; }),
  });
}

export async function POST(req: Request) {
  const admin = createAdminClient();
  const dev = await deviceFor(admin, (await cookies()).get(DEVICE_COOKIE)?.value);
  if (!dev) return NextResponse.json({ error: "This device isn't set up as a time clock." }, { status: 403 });
  if (dev.locked_until && Date.parse(dev.locked_until) > Date.now()) return NextResponse.json({ error: "Too many wrong PINs. Try again in a minute.", locked: dev.locked_until }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const employeeId = String(b.employee_id || ""), pin = String(b.pin || "");
  if (!employeeId || !validPin(pin)) return NextResponse.json({ error: "Enter your 4–6 digit PIN." }, { status: 400 });
  const { data: emp } = await admin.from("employees").select("id, first_name, active").eq("id", employeeId).maybeSingle();
  if (!emp || !emp.active || !(await verifyEmployeePin(admin, employeeId, pin))) {
    const locked = await pinFailed(admin, dev);
    return NextResponse.json({ error: locked ? "Too many wrong PINs. Try again in a minute." : "That PIN doesn't match." }, { status: 401 });
  }
  await pinOk(admin, dev.id);
  const s = await timeSettings(admin);
  // job punches
  if (b.action === "jobs") return NextResponse.json({ jobs: await openJobs(admin), clockedIn: await clockedIn(admin) });
  if (b.action === "job_start" || b.action === "job_stop") {
    const r = await jobAction(admin, employeeId, b, dev.id);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ ok: true, name: emp.first_name, message: r.message, ...(await statusOf(admin, s, employeeId)) });
  }
  const kind = b.kind as Punch["kind"] | undefined;
  if (!kind) return NextResponse.json({ ok: true, name: emp.first_name, ...(await statusOf(admin, s, employeeId)) });
  if (!["in", "out", "break_start", "break_end"].includes(kind)) return NextResponse.json({ error: "Unknown punch." }, { status: 400 });
  const r = await recordPunch(admin, { employeeId, kind, source: "kiosk", deviceId: dev.id, photo: typeof b.photo === "string" ? b.photo : null });
  if ("error" in r && r.error) return NextResponse.json({ error: r.error, ...r.status }, { status: 409 });
  return NextResponse.json({ ok: true, name: emp.first_name, punch: r.punch, ...r.status });
}

