import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { periodHours } from "@/lib/crewHome";
import { timeSettings } from "@/lib/timeclockServer";
import { addDays, localDay, periodOf } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * My time cards on the crew phone (Nick, Nov 13 2026: "they should be able to see their time cards from the past"): the
 * pay period now running and the six before it, newest first, each with its days, hours, what they said about it and
 * whether the office approved it. Only their own: the employee signed in on this phone.
 */
export async function GET() {
  const who = await jobActor();
  if (!who?.employeeId) return NextResponse.json({ error: "Sign in with your employee # first." }, { status: 401 });
  const admin = createAdminClient(), s = await timeSettings(admin), today = localDay(new Date());
  const starts: string[] = [];
  for (let st = periodOf(s, today).start, i = 0; i < 7; i++, st = periodOf(s, addDays(st, -1)).start) starts.push(st);
  const cards = (await Promise.all(starts.map((st) => periodHours(admin, s, who.employeeId!, st, today).catch(() => null))))
    .filter((c): c is NonNullable<typeof c> => !!c && (c.open || c.days.length > 0));
  return NextResponse.json({ cards });
}
