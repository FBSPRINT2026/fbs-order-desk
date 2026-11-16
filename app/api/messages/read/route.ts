import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The customer messages nobody has read yet, read by the AI a few at a time (lib/ai/messageRead.ts). A route, not a
 * server action: a page's server actions run one at a time, so a long read would hold up everything else the Job Center
 * asks for (Nov 16: the requests sat on "Loading…" while it read).
 */
export async function POST() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  const { aiState } = await import("@/lib/ai/claude");
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ read: 0, left: 0 });
  const { readPending } = await import("@/lib/ai/messageRead");
  return NextResponse.json(await readPending(admin, st.settings, 3));
}
