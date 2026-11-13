import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { recordPunch } from "@/lib/timeclockServer";
import type { Punch } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The crew phone's main menu (/crew): punch in and out (on the shop's Wi-Fi only, as every crew PIN sign-in is), and ask
 * for a fix to their own time card, which waits for a manager on the Time Clock (Nick, Nov 13 2026: "oh shoot I forgot
 * to clock out for lunch. I took a 30 minute lunch today… send to Jose").
 */
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
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
