import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { syncClickUp } from "@/lib/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  // new jobs read ahead, like order emails (Oct 27, Nick: "the pre-read… Can you do the same thing with ClickUp orders?"),
  // after answering; one run at a time (the schedule calls every 3 minutes)
  after(async () => {
    try {
      const { data: lk } = await admin.from("app_keys").select("value").eq("name", "clickup_prepare").maybeSingle();
      const at = Date.parse(String((lk?.value as { at?: string } | null)?.at || ""));
      if (at && Date.now() - at < 5 * 60_000) return;
      await admin.from("app_keys").upsert({ name: "clickup_prepare", value: { at: new Date().toISOString() } }, { onConflict: "name" });
      const { prepareClickUpOrders } = await import("@/lib/ai/prepareOrders");
      console.info(`clickup orders prepared ${JSON.stringify(await prepareClickUpOrders(admin, Date.now() + 230_000))}`);
      await admin.from("app_keys").upsert({ name: "clickup_prepare", value: { at: null, last: new Date().toISOString() } }, { onConflict: "name" });
    } catch (e) { console.warn("clickup prepare", e); }
  });
  return NextResponse.json(r);
}
export const GET = run;
export const POST = run;
