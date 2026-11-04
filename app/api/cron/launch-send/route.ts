import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { launchWaiting, personalWaiting, sendLaunchTo, sendPersonalNote, clickupCustomers } from "@/lib/launchSend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduled launch sends (Nov 4, Nick: "schedule it for 7 a.m. and then a 7:05 follow-up email from our personal
 * email address"). Each step (launch, personal) is a row in launch_schedule that the owner armed with a time. Called on
 * the minute by the database's own clock (pg_cron, migration 281): it does nothing until a step is armed and due, then
 * claims it once (started_at) and sends to everyone still waiting. Needs no key: it can only do what was armed, at or
 * after its time, once.
 */
export async function GET() {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: due } = await admin.from("launch_schedule").select("step").lte("run_at", now).is("started_at", null).is("cancelled_at", null);
  const out: Record<string, unknown> = {};
  for (const { step } of (due || []) as { step: string }[]) {
    const { data: claim } = await admin.from("launch_schedule").update({ started_at: new Date().toISOString() }).eq("step", step).is("started_at", null).is("cancelled_at", null).select("step, armed_by");
    if (!claim?.length) continue;
    const by = `${(claim[0] as { armed_by: string }).armed_by || "owner"} (scheduled)`;
    let result: Record<string, unknown>;
    try {
      if (step === "launch") {
        const ids = await launchWaiting(admin);
        result = await sendLaunchTo(admin, ids, by);
      } else if (step === "personal") {
        const ids = await personalWaiting(admin);
        const cu = new Set((await clickupCustomers(admin)).data);
        let sent = 0; const failed: { id: string; why: string }[] = [];
        for (const id of ids) {
          try { const r = await sendPersonalNote(admin, id, { by, clickup: cu }); if (!("skipped" in r)) sent++; } catch (e) { failed.push({ id, why: e instanceof Error ? e.message : String(e) }); }
        }
        result = { sent, failed };
      } else result = { error: "unknown step" };
    } catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
    await admin.from("launch_schedule").update({ finished_at: new Date().toISOString(), result }).eq("step", step);
    out[step] = result;
  }
  return NextResponse.json({ ok: true, ran: out });
}
