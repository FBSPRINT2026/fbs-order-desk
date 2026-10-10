import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canvaEnv, loadTokens, userCanva } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anyone signed in: is Canva set up here, and is MY Canva account connected (never a token).
 * Staff also get the shop's connection; the owner, how many customers have connected.
 * ?session=<id>: one Design-with-Canva trip (status, error, the saved design and short links to its files once it's
 * back); staff see any trip, others only their own.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const admin = createAdminClient();
  const sid = new URL(req.url).searchParams.get("session");
  if (sid) {
    if (!/^[0-9a-f-]{36}$/i.test(sid)) return NextResponse.json({ error: "No such session." }, { status: 404 });
    const { data: s } = await admin.from("canva_sessions").select("id, status, error, side, location, im_id, customer_id, order_id, group_id, design_id, design_ref, from_design, user_id, updated_at").eq("id", sid).maybeSingle();
    if (!s || (!v.isStaff && s.user_id !== v.user.id)) return NextResponse.json({ error: "No such session." }, { status: 404 });
    const { data: d } = s.design_ref ? await admin.from("designs").select("*").eq("id", s.design_ref).maybeSingle() : { data: null };
    let fileUrl = "", previewUrl = "";
    if (d?.file_path) fileUrl = (await admin.storage.from("proofs").createSignedUrl(d.file_path as string, 900)).data?.signedUrl || "";
    if (d?.preview_path) previewUrl = (await admin.storage.from("proofs").createSignedUrl(d.preview_path as string, 3600)).data?.signedUrl || "";
    const { user_id: _u, ...session } = s; void _u;
    return NextResponse.json({ session, design: d || null, fileUrl, previewUrl });
  }
  const env = canvaEnv();
  const mine = await userCanva(admin, v.user.id);
  const base = { configured: env.configured, me: { connected: env.configured && mine.connected, name: mine.name }, isStaff: v.isStaff, isOwner: v.role === "owner" };
  if (!v.isStaff) return NextResponse.json(base);
  const t = await loadTokens(admin);
  let customersConnected = 0;
  if (v.role === "owner") {
    const { count } = await admin.from("canva_accounts").select("user_id", { count: "exact", head: true }).not("customer_id", "is", null).not("tokens->>refresh_token", "is", null);
    customersConnected = count || 0;
  }
  return NextResponse.json({
    ...base, missing: env.missing, connected: env.configured && !!t,
    name: t?.display_name || "", connectedBy: t?.connected_by || "", connectedAt: t?.connected_at || "",
    redirectUri: env.redirectUri, returnUrl: env.returnUrl, customersConnected,
  });
}
