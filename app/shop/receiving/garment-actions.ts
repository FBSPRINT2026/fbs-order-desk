"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssLookup } from "@/lib/ss";

/**
 * What each garment on a check-in is (Oct 27, Nick: "you don't have the brand anywhere… say like Comfort Colors 1717
 * Blue Spruce"): its brand, what it is ("Garment-dyed heavyweight tee") and the color's swatch, so the count grid can
 * show it in its own color. From our garment list first, then SanMar's catalog copy, then S&S (a few styles at most).
 */
export type GarmentLook = { brand: string; title: string; hex: string };
const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
const cnorm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function garmentLooks(items: { style: string; color: string; brand?: string }[]) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false as const, error: "Staff only." };
    const admin = createAdminClient();
    const styles = [...new Set(items.map((i) => i.style.trim()).filter(Boolean))].slice(0, 30);
    const out: Record<string, GarmentLook> = {};
    if (!styles.length) return { ok: true as const, looks: out };
    const want = new Set(styles.map(norm));
    const hexOf = (ci: unknown, color: string) => {
      const m = (ci || {}) as Record<string, { hex?: string }>;
      const k = Object.keys(m).find((x) => cnorm(x) === cnorm(color));
      const h = (k && m[k]?.hex) || "";
      return /^#?[0-9a-f]{6}$/i.test(h) ? (h.startsWith("#") ? h : "#" + h) : "";
    };
    // 1. our garment list (has the S&S color swatches when it was synced)
    const { data: gs } = await admin.from("garments").select("style, brand, description, color_images").limit(500);
    const ours = new Map<string, { brand: string; description: string; color_images: unknown }>();
    for (const g of (gs || []) as { style: string; brand: string; description: string; color_images: unknown }[]) if (want.has(norm(g.style || ""))) ours.set(norm(g.style), g);
    // 2. SanMar's catalog copy
    const { data: sm } = await admin.from("sanmar_styles").select("style, brand, title").in("style", styles.flatMap((s) => [s, s.toUpperCase()])).limit(60);
    const smap = new Map<string, { brand: string; title: string }>();
    for (const r of (sm || []) as { style: string; brand: string; title: string }[]) smap.set(norm(r.style), r);
    // 3. S&S for what's left (and for a swatch), at most 4 styles so the pop-up stays quick
    const ss = new Map<string, Awaited<ReturnType<typeof ssLookup>>>();
    const left = styles.filter((s) => { const o = ours.get(norm(s)); return !smap.has(norm(s)) && !(o && o.color_images && Object.keys(o.color_images as object).length); }).slice(0, 4);
    await Promise.all(left.map(async (s) => {
      const brand = items.find((i) => i.style.trim() === s)?.brand || "";
      const g = await Promise.race([ssLookup(brand ? `${brand} ${s}` : s).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      if (g && norm(g.style) === norm(s)) ss.set(norm(s), g);
    }));
    for (const it of items) {
      const k = norm(it.style);
      const o = ours.get(k), m = smap.get(k), s2 = ss.get(k);
      out[`${k}|${cnorm(it.color)}`] = {
        brand: it.brand || o?.brand || m?.brand || s2?.brand || "",
        title: o?.description || m?.title || s2?.description || "",
        hex: hexOf(o?.color_images, it.color) || hexOf(s2?.color_images, it.color),
      };
    }
    return { ok: true as const, looks: out };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
