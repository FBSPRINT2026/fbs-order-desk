import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { readClickUpFileTexts } from "@/lib/clickup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reads the words in past ClickUp jobs' PDFs (lib/clickup.ts readClickUpFileTexts): ?team=<workspace id>&name=<regex>
 * &since=<date>&limit=<n>. Staff, or the schedule's sync token. Read-only in ClickUp.
 */
async function run(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const u = new URL(req.url);
  const r = await readClickUpFileTexts(admin, { team: u.searchParams.get("team") || undefined, name: u.searchParams.get("name") || undefined,
    since: u.searchParams.get("since") || undefined, limit: +(u.searchParams.get("limit") || 0) || undefined, deadline: Date.now() + 240_000 });
  return NextResponse.json(r);
}
export const GET = run;
export const POST = run;
