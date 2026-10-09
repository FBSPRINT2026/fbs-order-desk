import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimLock, releaseLock, runQueue } from "@/lib/qbo/runner";
import { tokenMatches } from "@/lib/qbo/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The QuickBooks runner, called every minute by the database's schedule (pg_cron → qbo_sync_tick, with the token in
 * qbo_settings, like the Printavo sync). Does nothing but keep the sign-in fresh while the sync is off.
 * ?preview=1 builds previews of everything waiting even when the sync is off (sends nothing).
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("qbo_settings").select("token").eq("id", 1).maybeSingle();
  if (!s || !tokenMatches(req.headers.get("x-sync-token"), String(s.token))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  const lockId = await claimLock(admin);
  if (!lockId) return NextResponse.json({ busy: true });
  try {
    const stats = await runQueue(admin, { mode: preview ? "preview" : "auto", deadline: Date.now() + 280000, lockId });
    return NextResponse.json(stats);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("qbo_settings").update({ last_error: msg, last_error_at: new Date().toISOString() }).eq("id", 1);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await releaseLock(admin, lockId);
  }
}
