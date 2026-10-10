import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnect, disconnectUser } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: forget a Canva sign-in (revoked at Canva, best effort). Designs already saved stay.
 *   ?for=me   anyone signed in: their own Canva account
 *   (no for)  owner only: the shop's
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const admin = createAdminClient();
  if (new URL(req.url).searchParams.get("for") === "me") { await disconnectUser(admin, v.user.id); return NextResponse.json({ ok: true }); }
  if (v.role !== "owner") return NextResponse.json({ error: "Only the owner disconnects the shop's Canva account." }, { status: 403 });
  await disconnect(admin, v.email);
  return NextResponse.json({ ok: true });
}
