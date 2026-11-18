import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssConfigured, ssLookup } from "@/lib/ss";
import { sanmarConfigured, sanmarLookup } from "@/lib/sanmar";
import { sanmarStyles } from "@/lib/sanmarStyle";
import { osConfigured, osGarment } from "@/lib/onestop";
import { sameBrand } from "@/lib/garmentMatch";
import { withChosenPhotos } from "@/lib/garmentPhotos";

export const dynamic = "force-dynamic";

/** a supplier photo of a person wearing it, not the garment laid flat (SanMar "_model", S&S "_om") */
const ONMODEL = /(model|_om)[_.-]|onmodel/i;
const ckey = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
type Photos = Record<string, { front: string; back: string; side: string; hex: string }>;
/**
 * One Stop's photos are often a person wearing the shirt (Nick, Nov 17 2026, #50127's Next Level 1810: "why did you bring
 * in the mock-up of the shirt on a person? The regular shirt blank is available"). A style One Stop sells that SanMar or
 * S&S also carry takes their flat photos, color by color (One Stop's prices and sizes stay); a color neither has keeps
 * One Stop's. Fixes every One Stop style, not one shirt.
 */
async function flatPhotos<G extends { style: string; brand: string; supplier_style: string; color_images: Photos; image: string }>(g: G, q: string): Promise<G> {
  const found: Photos[] = [];
  if (sanmarConfigured()) for (const t of [...new Set([g.supplier_style, q, g.style].filter(Boolean).map((x) => x.toUpperCase()))]) {
    const m = await sanmarLookup(t).catch(() => null);
    if (m && sameBrand(m.brand, g.brand)) { found.push(m.color_images as Photos); break; }
  }
  if (ssConfigured()) { const m = await ssLookup(`${g.brand} ${g.style}`).catch(() => null); if (m && sameBrand(m.brand, g.brand)) found.push(m.color_images); }
  if (!found.length) return g;
  const flat = new Map<string, Photos[string]>();
  for (const f of found) for (const [c, v] of Object.entries(f || {})) if (v?.front && !ONMODEL.test(v.front) && !flat.has(ckey(c))) flat.set(ckey(c), v);
  if (!flat.size) return g;
  const color_images: Photos = {};
  for (const [c, v] of Object.entries(g.color_images)) { const f = flat.get(ckey(c)); color_images[c] = f ? { front: f.front, back: f.back && !ONMODEL.test(f.back) ? f.back : v.back, side: f.side || v.side, hex: f.hex || v.hex } : v; }
  const first = Object.values(color_images)[0];
  return { ...g, color_images, image: first?.front || g.image };
}
export const maxDuration = 60;

// Find a style on S&S Activewear (or SanMar when S&S doesn't carry it, or ?supplier=sanmar) and save it to the garment catalog.
// Customers can use it too (building an order in their portal), but never see our costs.
export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = sp.get("style")?.trim() || "";
  const id = parseInt(sp.get("styleid") || "", 10) || undefined;
  const want = sp.get("supplier");
  // the brand, when the line names one (Nov 2, #40368: "3400" alone found Colortone's; the confirmation said Rabbit Skins):
  // S&S is searched for that brand's style, and a supplier's garment of another brand doesn't count (lib/garmentMatch.ts)
  const brand = (sp.get("brand") || "").trim();
  const okBrand = (b: string) => !brand || sameBrand(b, brand);
  if (!q && !id) return NextResponse.json({ error: "Enter a style" }, { status: 400 });
  if (!ssConfigured() && !sanmarConfigured() && !osConfigured()) return NextResponse.json({ error: "No supplier is connected yet (S&S or SanMar keys missing)." }, { status: 503 });
  try {
    const admin = createAdminClient();
    const save = async (row: Record<string, unknown>, match: () => Promise<{ id: string } | null>) => {
      const existing = await match();
      const res = existing ? await admin.from("garments").update(await withChosenPhotos(admin, existing.id, row)).eq("id", existing.id).select("*").single() : await admin.from("garments").insert(row).select("*").single();
      if (res.error) throw new Error(res.error.message);
      return res.data as Record<string, unknown>;
    };
    // One Stop, when asked for (a One Stop search result: Oct 29, Nick), or below when S&S and SanMar don't have it
    const oneStop = async () => {
      const g0 = await osGarment(admin, q, brand);
      if (!g0 || !okBrand(g0.brand)) return null;
      const g = await flatPhotos(g0, q);
      const data = await save({ ...g, ss_style_id: null, synced_at: new Date().toISOString() }, async () => {
        const { data: m } = await admin.from("garments").select("id").eq("supplier", "onestop").ilike("supplier_style", g.supplier_style).maybeSingle();
        return (m as { id: string } | null) || null;
      });
      return NextResponse.json({ garment: isStaff ? data : publicGarment(data) });
    };
    if (want === "onestop" && q && osConfigured()) { const r = await oneStop(); if (r) return r; }
    // S&S first (unless SanMar or One Stop was asked for)
    if (want !== "sanmar" && want !== "onestop" && ssConfigured()) {
      // SanMar's number for another brand's style (BC3001CVC, NL6210, G64400): S&S knows it as 3001CVC, 6210, 64400
      const g0 = await ssLookup(brand && !id ? `${brand} ${q}` : q, id).catch((e) => { if (!sanmarConfigured() || id) throw e; return null; })
        || (!id && /^(BC|NL|G|C|DT|AA)\d/i.test(q) ? await ssLookup(`${brand ? `${brand} ` : ""}${q.replace(/^(BC|NL|G|C|DT|AA)(?=\d)/i, "")}`).catch(() => null) : null);
      const g = g0 && (id || okBrand(g0.brand)) ? g0 : null;
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
    if (q && want !== "onestop" && sanmarConfigured()) {
      // S&S's number for it at SanMar (3001CVC is BC3001CVC there: lib/sanmarStyle.ts)
      let g = await sanmarLookup(q);
      if (g && !okBrand(g.brand)) g = null;
      if (!g) for (const t of (await sanmarStyles(admin, q)).filter((t) => t !== q.toUpperCase())) { g = await sanmarLookup(t).catch(() => null); if (g && !okBrand(g.brand)) g = null; if (g) break; }
      if (g) {
        const data = await save({ ...g, ss_style_id: null, synced_at: new Date().toISOString() }, async () => {
          const { data: m } = await admin.from("garments").select("id").eq("supplier", "sanmar").ilike("supplier_style", g.supplier_style).maybeSingle();
          return (m as { id: string } | null) || null;
        });
        return NextResponse.json({ garment: isStaff ? data : publicGarment(data) });
      }
    }
    // One Stop last: a style neither carries (their own brands: Fruit of the Loom, LAT, Izod…)
    if (q && want !== "onestop" && osConfigured()) { const r = await oneStop().catch(() => null); if (r) return r; }
    return NextResponse.json({ error: `No style matching "${brand ? `${brand} ` : ""}${q}" at ${[ssConfigured() && "S&S", sanmarConfigured() && "SanMar", osConfigured() && "One Stop"].filter(Boolean).join(", ")}.` }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** What a customer may see of a catalog garment: no costs. */
function publicGarment(g: Record<string, unknown>) {
  const { cost: _c, size_costs: _s, color_size_costs: _cs, ...rest } = g;
  return { ...rest, cost: 0, size_costs: {}, color_size_costs: {} };
}
