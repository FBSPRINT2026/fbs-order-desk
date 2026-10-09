import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnect } from "@/lib/qbo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only (POST): revoke the sign-in at Intuit and forget it. Links, the queue and the log stay. */
export async function POST() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return NextResponse.json({ error: "Only the owner disconnects QuickBooks." }, { status: 403 });
  const admin = createAdminClient();
  await admin.from("qbo_settings").update({ enabled: false, updated_at: new Date().toISOString(), updated_by: v.email }).eq("id", 1);
  await disconnect(admin, v.email);
  return NextResponse.json({ ok: true });
}
