import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { styles: [{ style, brand? }] } (staff) → the catalog garment for each style with its real color names, so an
 * order's colors can be checked before it's made ("Forest Green" → the 6210's "Heather Forest Green").
 */
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { styles } = await req.json().catch(() => ({ styles: [] })) as { styles?: { style?: string; brand?: string }[] };
  const want = [...new Set((styles || []).map((x) => String(x.style || "").trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!want.length) return NextResponse.json({ garments: {} });
  const admin = createAdminClient();
  // the style as written, and without a brand prefix ("NL6210" → "6210", "G500" stays)
  const plain = want.flatMap((s) => [s, s.replace(/^(NL|BC|G|PC|DT|DM|ST|LAT|AA)(?=\d)/, "")]);
  const { data } = await admin.from("garments").select("id, brand, style, description, color_images").in("style", [...new Set(plain)]).limit(80);
  const out: Record<string, { id: string; brand: string; style: string; description: string; colors: string[] }> = {};
  for (const s of want) {
    const brand = (styles || []).find((x) => String(x.style || "").trim().toUpperCase() === s)?.brand?.toLowerCase() || "";
    const hits = (data || []).filter((g) => [s, s.replace(/^(NL|BC|G|PC|DT|DM|ST|LAT|AA)(?=\d)/, "")].includes(String(g.style).toUpperCase()));
    const g = hits.find((h) => brand && String(h.brand || "").toLowerCase().includes(brand)) || hits.find((h) => Object.keys(h.color_images || {}).length) || hits[0];
    if (g) out[s] = { id: g.id, brand: g.brand || "", style: g.style, description: g.description || "", colors: Object.keys(g.color_images || {}).sort() };
  }
  return NextResponse.json({ garments: out });
}
