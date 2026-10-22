import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { syncClickUp } from "@/lib/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ClickUp Jobs: read the customers' ClickUp boards (lib/clickup.ts). Every 3 minutes from clickup_tick (migration
 * 185, with the sync token), and from the page's "Check ClickUp now" (staff).
 */
async function run(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const r = await syncClickUp(admin, Date.now() + 50_000);
  return NextResponse.json(r);
}
export const GET = run;
export const POST = run;
