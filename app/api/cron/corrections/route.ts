import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { reviewCorrections } from "@/lib/ai/correctionReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The overnight look at the day's order corrections (Vercel Cron, see vercel.json; lib/ai/correctionReview.ts): what
// went wrong, the rules it would add, on the owner's My Day in the morning. Needs CRON_SECRET (as the daily Assistant).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ ok: false, error: st.reason });
  const r = await reviewCorrections(admin, st.settings);
  return NextResponse.json(r);
}
