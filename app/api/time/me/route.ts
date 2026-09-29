import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clockedIn, jobAction, openJobs, recordPunch, statusOf, timeSettings } from "@/lib/timeclockServer";
import { meters, type Punch } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

/** Phone punching for staff with a login that's linked to an employee, only near the shop. */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const admin = createAdminClient();
  const { data: emp } = await admin.from("employees").select("id, first_name, last_name, active").eq("staff_email", v.email).eq("active", true).maybeSingle();
  return { v, admin, emp };
}

export async function GET() {
  const m = await me();
  if (!m) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!m.emp) return NextResponse.json({ linked: false });
  const s = await timeSettings(m.admin);
  return NextResponse.json({ linked: true, employeeId: m.emp.id, name: m.emp.first_name, phone: s.phone, geo: !!(s.geo.lat && s.geo.lng), tasks: s.tasks, stations: s.stations, ...(await statusOf(m.admin, s, m.emp.id)) });
}

export async function POST(req: Request) {
  const m = await me();
  if (!m) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!m.emp) return NextResponse.json({ error: "Your login isn't linked to an employee yet (Time Clock → Employees)." }, { status: 400 });
  const s = await timeSettings(m.admin);
  if (!s.phone) return NextResponse.json({ error: "Phone punching is turned off. Use the time clock." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  // job punches from a phone or the shop screens (no location check: they're already on the clock)
  if (b.action === "jobs") return NextResponse.json({ jobs: await openJobs(m.admin), clockedIn: await clockedIn(m.admin) });
  if (b.action === "job_start" || b.action === "job_stop") {
    const r = await jobAction(m.admin, m.emp.id, b, null, "phone");
    if (r.error) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ ok: true, message: r.message, ...(await statusOf(m.admin, s, m.emp.id)) });
  }
  const kind = b.kind as Punch["kind"];
  if (!["in", "out", "break_start", "break_end"].includes(kind)) return NextResponse.json({ error: "Unknown punch." }, { status: 400 });
  const lat = typeof b.lat === "number" ? b.lat : null, lng = typeof b.lng === "number" ? b.lng : null, accuracy = typeof b.accuracy === "number" ? b.accuracy : null;
  if (s.geo.lat != null && s.geo.lng != null) {
    if (lat == null || lng == null) return NextResponse.json({ error: "Turn on location so we can see you're at the shop." }, { status: 400 });
    const d = meters({ lat, lng }, { lat: s.geo.lat, lng: s.geo.lng });
    if (d > s.geo.radiusM + Math.min(accuracy || 0, 150)) return NextResponse.json({ error: `You look to be about ${Math.round(d)} m from the shop. Punch in when you're here, or use the time clock.` }, { status: 403 });
  }
  const r = await recordPunch(m.admin, { employeeId: m.emp.id, kind, source: "phone", lat, lng, accuracy });
  if ("error" in r && r.error) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true, ...(await statusOf(m.admin, s, m.emp.id)) });
}
