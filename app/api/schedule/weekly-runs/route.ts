import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { keepWeeklyRuns } from "@/lib/weeklyRun";

/** customers' weekly runs put on the schedule (lib/weeklyRun.ts): run when the schedule opens, and by the hourly goods pass */
export async function POST() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  try { return NextResponse.json(await keepWeeklyRuns(createAdminClient())); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
