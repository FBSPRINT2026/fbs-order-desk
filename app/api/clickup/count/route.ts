import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { countClickUp } from "@/lib/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?years=3: how big a backup of the customers' ClickUp jobs would be (lib/clickup.ts countClickUp); reads only */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const years = Math.min(6, Math.max(1, Number(new URL(req.url).searchParams.get("years")) || 3));
  return NextResponse.json(await countClickUp(admin, years, Date.now() + 52_000));
}
