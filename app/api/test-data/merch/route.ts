import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeSampleStore } from "@/lib/merchSample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  try { return NextResponse.json({ ok: true, ...(await makeSampleStore(createAdminClient())) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
export const GET = go;
export const POST = go;
