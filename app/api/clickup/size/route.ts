import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { sizeClickUp } from "@/lib/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?n=40: how big a 3-year backup of the ClickUp files would be (lib/clickup.ts sizeClickUp); reads only */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const n = Math.min(60, Math.max(5, Number(new URL(req.url).searchParams.get("n")) || 40));
  const r = await sizeClickUp(admin, n, Date.now() + 50_000);
  return NextResponse.json(r);
}
