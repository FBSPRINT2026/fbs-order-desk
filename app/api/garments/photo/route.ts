import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanmarConfigured, sanmarSkus } from "@/lib/sanmar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { garmentId, color } (staff) → a photo of a color our supplier has none of, from the other supplier (Oct 22, Nick:
 * "if S&S doesn't have an image of 64400 Neon Blue, I know SanMar does. Why didn't you pull it from there?"). SanMar is
 * asked for the same style (as written, and with Gildan's G in front); the color's flat front and back shots are saved
 * on the garment (color_images, marked from SanMar) so every mockup of it has them from now on.
 */
const sq = (s: string) => (s || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { garmentId, color } = await req.json().catch(() => ({})) as { garmentId?: string; color?: string };
  if (!garmentId || !color?.trim()) return NextResponse.json({ error: "Which garment and color?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: g } = await admin.from("garments").select("id, style, brand, supplier, supplier_style, color_images").eq("id", garmentId).maybeSingle();
  if (!g) return NextResponse.json({ error: "That garment isn't in the catalog." }, { status: 404 });
  const imgs = (g.color_images || {}) as Record<string, { front?: string; back?: string; side?: string; hex?: string; from?: string }>;
  const have = Object.entries(imgs).find(([k, x]) => sq(k) === sq(color) && x?.front);
  if (have) return NextResponse.json({ name: have[0], ...have[1] });
  if (g.supplier === "sanmar" || !sanmarConfigured()) return NextResponse.json({ none: true });
  const st = String(g.supplier_style || g.style || "").trim().toUpperCase();
  const tries = [...new Set([st, /^\d/.test(st) && /gildan/i.test(String(g.brand || "")) ? `G${st}` : "", st.replace(/^G(?=\d)/, "")].filter(Boolean))];
  for (const t of tries) {
    const skus = await sanmarSkus(t).catch(() => []);
    const hit = skus.find((s) => (sq(s.color) === sq(color) || sq(s.catalogColor) === sq(color)) && (s.front || s.image));
    if (!hit) continue;
    const name = Object.keys(imgs).find((k) => sq(k) === sq(color)) || color.trim();
    const entry = { front: hit.front || hit.image, back: hit.back || "", side: "", hex: imgs[name]?.hex || "", from: "sanmar" };
    await admin.from("garments").update({ color_images: { ...imgs, [name]: entry } }).eq("id", g.id);
    return NextResponse.json({ name, ...entry });
  }
  return NextResponse.json({ none: true });
}
