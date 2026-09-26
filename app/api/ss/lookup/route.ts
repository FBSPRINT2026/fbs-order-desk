import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssConfigured, ssLookup } from "@/lib/ss";

export const dynamic = "force-dynamic";

// Staff only: find a style on S&S Activewear and save it to the garment catalog.
export async function GET(req: Request) {
  const { isStaff } = await getViewer();
  if (!isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!ssConfigured()) return NextResponse.json({ error: "S&S isn't connected yet (SS_ACCOUNT_NUMBER / SS_API_KEY missing)." }, { status: 503 });
  const q = new URL(req.url).searchParams.get("style")?.trim() || "";
  if (!q) return NextResponse.json({ error: "Enter a style" }, { status: 400 });
  try {
    const g = await ssLookup(q);
    if (!g) return NextResponse.json({ error: `S&S has no style matching "${q}".` }, { status: 404 });
    const admin = createAdminClient();
    const { data: existing } = await admin.from("garments").select("id").ilike("style", g.style).maybeSingle();
    const row = { ...g, synced_at: new Date().toISOString() };
    const res = existing
      ? await admin.from("garments").update(row).eq("id", existing.id).select("*").single()
      : await admin.from("garments").insert(row).select("*").single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ garment: res.data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
