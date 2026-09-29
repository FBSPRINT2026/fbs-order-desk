import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssConfigured, ssLookup } from "@/lib/ss";
import { sanmarConfigured, sanmarLookup } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

// Find a style on S&S Activewear (or SanMar when S&S doesn't carry it, or ?supplier=sanmar) and save it to the garment catalog.
// Customers can use it too (building an order in their portal), but never see our costs.
export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = sp.get("style")?.trim() || "";
  const id = parseInt(sp.get("styleid") || "", 10) || undefined;
  const want = sp.get("supplier");
  if (!q && !id) return NextResponse.json({ error: "Enter a style" }, { status: 400 });
  if (!ssConfigured() && !sanmarConfigured()) return NextResponse.json({ error: "No supplier is connected yet (S&S or SanMar keys missing)." }, { status: 503 });
  try {
    const admin = createAdminClient();
    const save = async (row: Record<string, unknown>, match: () => Promise<{ id: string } | null>) => {
      const existing = await match();
      const res = existing ? await admin.from("garments").update(row).eq("id", existing.id).select("*").single() : await admin.from("garments").insert(row).select("*").single();
      if (res.error) throw new Error(res.error.message);
      return res.data as Record<string, unknown>;
    };
    // S&S first (unless SanMar was asked for)
    if (want !== "sanmar" && ssConfigured()) {
      const g = await ssLookup(q, id).catch((e) => { if (!sanmarConfigured() || id) throw e; return null; });
      if (g) {
        const data = await save({ ...g, supplier: "ss", synced_at: new Date().toISOString() }, async () => {
          const { data: byId } = await admin.from("garments").select("id").eq("ss_style_id", g.ss_style_id).maybeSingle();
          if (byId) return byId as { id: string };
          const { data: byName } = await admin.from("garments").select("id").ilike("style", g.style).ilike("brand", g.brand).maybeSingle();
          return (byName as { id: string } | null) || null;
        });
        return NextResponse.json({ garment: isStaff ? data : publicGarment(data) });
      }
    }
    // SanMar (Port Authority, Sport-Tek, District, Nike, OGIO, CornerStone… and anything S&S doesn't have)
    if (q && sanmarConfigured()) {
      const g = await sanmarLookup(q);
      if (g) {
        const data = await save({ ...g, ss_style_id: null, synced_at: new Date().toISOString() }, async () => {
          const { data: m } = await admin.from("garments").select("id").eq("supplier", "sanmar").ilike("supplier_style", g.supplier_style).maybeSingle();
          return (m as { id: string } | null) || null;
        });
        return NextResponse.json({ garment: isStaff ? data : publicGarment(data) });
      }
    }
    return NextResponse.json({ error: `No style matching "${q}" at ${[ssConfigured() && "S&S", sanmarConfigured() && "SanMar"].filter(Boolean).join(" or ")}.` }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** What a customer may see of a catalog garment: no costs. */
function publicGarment(g: Record<string, unknown>) {
  const { cost: _c, size_costs: _s, ...rest } = g;
  return { ...rest, cost: 0, size_costs: {} };
}
