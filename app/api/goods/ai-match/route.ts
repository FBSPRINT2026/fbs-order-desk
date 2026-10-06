import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { goodsCheck } from "@/lib/goodsTrack";
import { resolvePending } from "@/lib/manifest";
import { aiMatchPending } from "@/lib/goodsAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Attempt to relink orders": the whole goods pass in one go.
 *   1. tracking: refresh every package and send the alerts that are due,
 *   2. the rules: link what matches for certain (the PO points at the job, or an exact match on a current job),
 *   3. the AI: a recommendation for everything still waiting (close but not exact), for someone to OK.
 * GET : the database schedule (hourly, Mon–Fri 6 a.m.–6 p.m. Central), with the sync key.
 * POST: staff, the "Attempt to Relink Orders" button on Goods & Receiving ({ force } has the AI look at every shipment again).
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  return go(admin, {});
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { force?: boolean };
  return go(createAdminClient(), { force: !!b.force, max: 40 });
}

async function go(admin: ReturnType<typeof createAdminClient>, opts: { force?: boolean; max?: number }) {
  const { data: got } = await admin.rpc("printavo_sync_claim", { p_job: "goods-ai", p_seconds: 295 });
  if (!got) return NextResponse.json({ busy: true, error: "The relink is already running. Give it a few minutes." });
  const end = Date.now() + 285000;
  try {
    const tracking = await goodsCheck(admin, Date.now() + 40000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const rules = await resolvePending(admin, Date.now() + 70000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const ai = await aiMatchPending(admin, end, { max: opts.max ?? 25, force: opts.force });
    return NextResponse.json({ ...ai, rules, tracking });
  }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  finally { await admin.rpc("printavo_sync_release", { p_job: "goods-ai" }); }
}
