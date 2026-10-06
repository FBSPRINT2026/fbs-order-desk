import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiMatchPending } from "@/lib/goodsAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The AI goods matcher (lib/goodsAi.ts).
 *   GET  : the database schedule (every 20 minutes, after the rules pass), with the sync key.
 *   POST : staff, "Ask AI now" on Goods & Receiving ({ force } asks again about everything; { only: lineIds } one shipment).
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
  const b = await req.json().catch(() => ({})) as { force?: boolean; only?: string[] };
  return go(createAdminClient(), { force: !!b.force, only: Array.isArray(b.only) ? b.only.slice(0, 500) : undefined, max: 40 });
}

async function go(admin: ReturnType<typeof createAdminClient>, opts: { force?: boolean; only?: string[]; max?: number }) {
  const { data: got } = await admin.rpc("printavo_sync_claim", { p_job: "goods-ai", p_seconds: 290 });
  if (!got) return NextResponse.json({ busy: true, error: "The AI is already going through the list. Try again in a few minutes." });
  try { return NextResponse.json(await aiMatchPending(admin, Date.now() + 280000, { max: opts.max ?? 15, force: opts.force, only: opts.only })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  finally { await admin.rpc("printavo_sync_release", { p_job: "goods-ai" }); }
}
