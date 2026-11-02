import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanmarBack } from "@/lib/garmentBacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The catalog's colors with a front photo and no back, filled from SanMar's flat backs in one go (Nov 1, Nick: "look
 * tonight in your catalog and see how many mismatch images… normalize it… they can't even make a proof"). The same
 * finder the Mockup Creator asks one color at a time (lib/garmentBacks.ts); a color SanMar doesn't have is marked
 * checked, so the Mockup Creator offers its other photos instead of looking again. GET: what's missing; POST: fill.
 */
type Ci = { front?: string; back?: string; back_from?: string; back_checked?: string; [k: string]: unknown };
const BAG = /\b(bag|tote|backpack|duffel|pouch|cinch)\b/i;
async function missing() {
  const admin = createAdminClient();
  const { data } = await admin.from("garments").select("id, style, brand, supplier, supplier_style, description, color_images").order("id");
  const out: { g: { id: string; style: string; brand: string; supplier: string; supplier_style: string | null }; name: string }[] = [];
  for (const g of data || []) {
    if (BAG.test(String(g.description || ""))) continue; // a bag's back is its front
    for (const [name, ci] of Object.entries((g.color_images || {}) as Record<string, Ci>)) if (ci?.front && !ci.back && !ci.back_from) out.push({ g: g as never, name });
  }
  return { admin, out };
}
export async function GET() {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { out } = await missing();
  return NextResponse.json({ missing: out.length, list: out.map((x) => `${x.g.brand} ${x.g.style} ${x.name}`) });
}
export async function POST() {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { admin, out } = await missing();
  const filled: string[] = [], model: string[] = [], none: string[] = [];
  const t0 = Date.now();
  for (const { g, name } of out) {
    if (Date.now() - t0 > 270_000) break;
    const b = await sanmarBack(admin, g, name).catch(() => ({} as { flat?: string; front?: string; model?: string }));
    // read again right before writing: other colors of the garment may have changed meanwhile
    const { data: cur } = await admin.from("garments").select("color_images").eq("id", g.id).maybeSingle();
    const imgs = (cur?.color_images || {}) as Record<string, Ci>, ci = imgs[name];
    if (!ci || ci.back) continue;
    const label = `${g.brand} ${g.style} ${name}`;
    // both sides from SanMar's listing, never their back with our supplier's front
    if (b.flat && b.front) { imgs[name] = { ...ci, front: b.front, from: "sanmar", back: b.flat, back_from: "sanmar" }; filled.push(label); }
    else { imgs[name] = { ...ci, back_checked: new Date().toISOString() }; (b.model ? model : none).push(label); }
    await admin.from("garments").update({ color_images: imgs }).eq("id", g.id);
  }
  return NextResponse.json({ checked: out.length, filled, modelOnly: model, none });
}
