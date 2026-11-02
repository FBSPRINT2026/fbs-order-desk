import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { orderFix } from "@/lib/ai/orderFix";

export const dynamic = "force-dynamic";
export const maxDuration = 160;

/**
 * The AI order helper with something dropped in (components/tools/OrderReview.tsx; Nov 1, Nick: "one AI tool for an
 * order… dragging attachments… whether you're doing a reorder, creating a new order, you just want help on it"):
 * POST { message, earlier, images: [{ media_type, data }] } → the same reading and changes as the chat
 * (lib/ai/orderFix.ts), with the dropped pictures in front. A route, not a server action: pictures run past an
 * action's 2 MB.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({})) as { message?: string; earlier?: string; images?: { media_type: "image/jpeg" | "image/png"; data: string; label?: string }[] };
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const r = await orderFix(admin, st.settings, id, v.email || "staff", String(b.message || "Dropped: a file"), "change", String(b.earlier || ""), { images: (b.images || []).slice(0, 10).map((x) => ({ media_type: x.media_type, data: x.data, label: x.label ? String(x.label).slice(0, 120) : undefined })) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  revalidatePath(`/shop/orders/${id}`);
  return NextResponse.json({ ok: true, r: r.r });
}
