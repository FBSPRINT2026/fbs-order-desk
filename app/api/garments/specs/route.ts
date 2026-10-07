import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { ssConfigured, ssSpecs } from "@/lib/ss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A catalog garment's size chart (flat body width / length per size) from S&S, saved on the garment as `specs`.
 * The Mockup Creator asks once for a style that doesn't have one yet; styles looked up from now on get it with the
 * lookup. Staff only. An empty chart is saved too, so a style S&S has no chart for isn't asked about again.
 */
export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const admin = createAdminClient();
  const { data: g } = await admin.from("garments").select("id, description, ss_style_id, specs").eq("id", id).maybeSingle();
  if (!g) return NextResponse.json({ error: "Garment not found." }, { status: 404 });
  if (g.specs) return NextResponse.json({ specs: g.specs });
  if (!g.ss_style_id || !ssConfigured()) return NextResponse.json({ specs: null });
  const specs = await ssSpecs(g.ss_style_id as number, /youth|toddler|kids|infant/i.test(String(g.description || ""))).catch(() => null);
  if (!specs) return NextResponse.json({ specs: null });
  await admin.from("garments").update({ specs }).eq("id", g.id);
  return NextResponse.json({ specs });
}
