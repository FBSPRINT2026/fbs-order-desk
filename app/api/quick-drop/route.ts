import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runQuickDrop, type QuickDropRow } from "@/lib/quickDrop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs the waiting Portal Quick Drop requests (lib/quickDrop.ts), oldest first, one at a time. Called every minute by the
 * database's schedule while a request waits (pg_cron → quick_drop_tick, with the sync token, like the other server jobs).
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const tok = req.headers.get("x-sync-token");
  const { data: s } = tok ? await admin.from("printavo_sync").select("token").eq("id", 1).single() : { data: null };
  if (!(s?.token && tok === String(s.token))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const done: { id: number; status: string }[] = [];
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const { data: row } = await admin.from("quick_drops").select("id, folder, customer_id, order_id, plan, requested_by").eq("status", "pending").order("id").limit(1).maybeSingle();
    if (!row) break;
    // claimed: only one run takes a request
    const { data: claimed } = await admin.from("quick_drops").update({ status: "running", started_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    try {
      const result = await runQuickDrop(admin, row as QuickDropRow);
      await admin.from("quick_drops").update({ status: "done", result, error: null, done_at: new Date().toISOString() }).eq("id", row.id);
      done.push({ id: row.id, status: "done" });
    } catch (e) {
      await admin.from("quick_drops").update({ status: "error", error: e instanceof Error ? e.message : String(e), done_at: new Date().toISOString() }).eq("id", row.id);
      done.push({ id: row.id, status: "error" });
    }
  }
  return NextResponse.json({ done });
}
