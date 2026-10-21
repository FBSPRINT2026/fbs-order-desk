import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { orderHelper } from "@/lib/ai/orderHelper";
import type { HelperMsg, HelperOrder } from "@/lib/orderHelperShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The order helper (lib/ai/orderHelper.ts), staff only.
 * POST { message, images: [{ media_type, data }], thread, order } → { reply, actions } for the order page to make.
 * The order is sent as it stands on screen (unsaved edits included); nothing is written here.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Only shop staff can do that." }, { status: 403 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { message?: string; images?: { media_type?: string; data?: string }[]; thread?: HelperMsg[]; order?: HelperOrder };
  if (!b.order) return NextResponse.json({ error: "No order sent." }, { status: 400 });
  const message = String(b.message || "").trim().slice(0, 4000);
  const images = (b.images || []).filter((x) => /^image\/(jpeg|png|webp)$/.test(String(x.media_type)) && typeof x.data === "string" && x.data.length < 6_000_000).slice(0, 4)
    .map((x) => ({ media_type: x.media_type as "image/jpeg" | "image/png" | "image/webp", data: String(x.data) }));
  if (!message && !images.length) return NextResponse.json({ error: "Tell me what to do, or paste a snip." }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 503 });
  const { data: pairs } = await admin.from("garment_youth").select("adult, youth").limit(500);
  const r = await orderHelper(admin, st.settings, { orderId: id, by: v.email, message, order: b.order, thread: (b.thread || []).slice(-20), images, pairs: (pairs || []) as { adult: string; youth: string }[] });
  return r.ok ? NextResponse.json({ reply: r.reply, actions: r.actions }) : NextResponse.json({ error: r.error }, { status: 502 });
}
