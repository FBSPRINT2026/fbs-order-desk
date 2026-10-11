import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recraftConfigured, vectorDesigns, type VectorStyle } from "@/lib/ai/vectorArt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** pictures a day per person (about $0.08 each): customers, staff */
const DAILY = { customer: 24, staff: 160 };

/**
 * POST { prompt, style: "one" | "full" }: AI Design in the Design Lab. Anyone signed in (customers in their portal,
 * staff). Four designs for the idea, as cleaned vector art (lib/ai/vectorArt). Each call is logged (ai_art_log) and
 * counted against a daily limit per person.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!recraftConfigured()) return NextResponse.json({ error: "AI Design isn't connected yet. The shop is setting it up.", setup: true }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { prompt?: string; style?: string };
  const prompt = String(b.prompt || "").trim().slice(0, 600);
  const style: VectorStyle = b.style === "full" ? "full" : "one";
  if (prompt.length < 3) return NextResponse.json({ error: "Describe the design you want first." }, { status: 400 });
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: used } = await admin.from("ai_art_log").select("images").eq("user_id", v.user.id).gte("created_at", since);
  const n = 4, made = (used || []).reduce((a, r) => a + (r.images || 0), 0), cap = v.isStaff ? DAILY.staff : DAILY.customer;
  if (made + n > cap) return NextResponse.json({ error: `That's the limit for today (${cap} AI designs). Try again tomorrow, or ask us and we'll design it for you.` }, { status: 429 });
  const r = await vectorDesigns(prompt, style, n);
  await admin.from("ai_art_log").insert({ user_id: v.user.id, is_staff: v.isStaff, prompt, style, images: n, ok: r.art.length > 0, error: r.error || null });
  if (!r.art.length) return NextResponse.json({ error: `The AI couldn't make that one: ${r.error || "try describing it another way."}` }, { status: 502 });
  return NextResponse.json({ art: r.art, left: Math.max(0, cap - made - n) });
}
