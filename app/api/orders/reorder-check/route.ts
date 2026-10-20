import { NextResponse } from "next/server";
import { aiReorderCheck } from "@/app/shop/ai-actions";
import type { LookedUp } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The AI reorder check, as a plain request (Oct 20, Nick: "this is stuck, can't click delete"): run as a server action
 * it held every other button on the order page (Next.js runs a page's server actions one at a time) for the minute the
 * AI takes, so Delete sat on "Looking at the order's art…". POST { order, onlyIfNone, told?, lookedUp? }
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { order?: string; onlyIfNone?: boolean; told?: string; lookedUp?: LookedUp | null };
  if (!b.order) return NextResponse.json({ ok: false, error: "No order." }, { status: 400 });
  return NextResponse.json(await aiReorderCheck(b.order, !!b.onlyIfNone, b.told, b.lookedUp));
}
