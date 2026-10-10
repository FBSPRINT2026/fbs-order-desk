import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canvaEnv, loadTokens } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff: is Canva set up and connected (never a token), and the env vars still missing.
 * ?session=<id>: one "Design in Canva" trip (status, error, and the saved design once it's back).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  const sid = new URL(req.url).searchParams.get("session");
  if (sid) {
    if (!/^[0-9a-f-]{36}$/i.test(sid)) return NextResponse.json({ error: "No such session." }, { status: 404 });
    const { data: s } = await admin.from("canva_sessions").select("id, status, error, side, location, im_id, customer_id, order_id, group_id, design_id, design_ref, from_design, updated_at").eq("id", sid).maybeSingle();
    if (!s) return NextResponse.json({ error: "No such session." }, { status: 404 });
    const { data: d } = s.design_ref ? await admin.from("designs").select("*").eq("id", s.design_ref).maybeSingle() : { data: null };
    return NextResponse.json({ session: s, design: d || null });
  }
  const env = canvaEnv();
  const t = await loadTokens(admin);
  return NextResponse.json({
    configured: env.configured, missing: env.missing, connected: env.configured && !!t,
    name: t?.display_name || "", connectedBy: t?.connected_by || "", connectedAt: t?.connected_at || "",
    redirectUri: env.redirectUri, returnUrl: env.returnUrl, isOwner: v.role === "owner",
  });
}
