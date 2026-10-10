import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnect } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only (POST): revoke the sign-in at Canva and forget it. Designs already saved stay. */
export async function POST() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return NextResponse.json({ error: "Only the owner disconnects Canva." }, { status: 403 });
  await disconnect(createAdminClient(), v.email);
  return NextResponse.json({ ok: true });
}
