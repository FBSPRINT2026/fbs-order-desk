import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { goodsCheck } from "@/lib/goodsTrack";
import { resolvePending } from "@/lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Customer supplied goods: refresh tracking and send the alerts that are due. Called every 20 minutes by the
 * database schedule; also runs the manifest resolution pass (migration 036), with the same private key the Printavo sync uses.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { data: got } = await admin.rpc("printavo_sync_claim", { p_job: "goods-track", p_seconds: 58 });
  if (!got) return NextResponse.json({ busy: true });
  try {
    const end = Date.now() + 50000;
    const goods = await goodsCheck(admin, end - 15000);
    // manifest shipments not on an order yet: link the sure ones, suggest the rest, keep their tracking fresh
    const links = await resolvePending(admin, end).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ...goods, links });
  }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  finally { await admin.rpc("printavo_sync_release", { p_job: "goods-track" }); }
}
