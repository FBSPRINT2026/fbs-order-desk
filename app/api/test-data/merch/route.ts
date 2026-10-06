import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeSampleStore, polishSampleStores } from "@/lib/merchSample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Make the sample merch store on the test school (Oak Hollow Elementary PTA): owner / admin, or the sync key.
 * Everything it makes is on a test account; the orders are test orders (no charge).
 */
async function allowed(req: Request) {
  const admin = createAdminClient();
  const key = req.headers.get("x-sync-token");
  if (key) { const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single(); return !!s && s.token === key; }
  const v = await getViewer();
  if (!v.user || !v.isStaff) return false;
  const { data: me } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  return ["owner", "admin"].includes((me?.role as string) || "");
}

async function go(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: "Owner or admin only." }, { status: 403 });
  // ?do=polish builds / refreshes the open "Owls Spirit Shop" and the Fall store's pictures; no ?do makes another closed store + job
  const what = new URL(req.url).searchParams.get("do");
  try { return NextResponse.json({ ok: true, ...(what === "polish" ? await polishSampleStores(createAdminClient()) : await makeSampleStore(createAdminClient())) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
export const GET = go;
export const POST = go;
