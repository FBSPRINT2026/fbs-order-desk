import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { sepCoachNightly } from "@/lib/ai/sepCoachNightly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The nightly separations coach (Vercel Cron, vercel.json; lib/ai/sepCoachNightly.ts): learns from the day's films
// record and puts one card on the owner's My Day. Needs CRON_SECRET, as the other crons.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ ok: false, error: st.reason });
  return NextResponse.json(await sepCoachNightly(admin, st.settings));
}
