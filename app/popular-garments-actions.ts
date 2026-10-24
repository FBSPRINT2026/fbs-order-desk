"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_POPULAR, type PopularPick } from "@/lib/popularGarments";

export type PopularCard = PopularPick & { garment: string; image: string; colors: number };

/** The popular garments with their picture and how many colors they come in (no costs). Anyone signed in. */
export async function popularGarments(): Promise<{ ok: boolean; list: PopularCard[]; error?: string }> {
  try {
    const v = await getViewer();
    if (!v.user) return { ok: false, list: [], error: "Please sign in again." };
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const saved = ((st?.data || {}) as { popularGarments?: PopularPick[] }).popularGarments;
    const picks = Array.isArray(saved) && saved.length ? saved : DEFAULT_POPULAR;
    const { data: gs } = await admin.from("garments").select("style, brand, description, image, colors").in("style", [...new Set(picks.map((p) => p.style))]);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const list = picks.map((p) => {
      const same = (gs || []).filter((g) => String(g.style).toLowerCase() === p.style.toLowerCase());
      const g = same.find((x) => norm(String(x.brand || "")) === norm(p.brand)) || same[0];
      return { ...p, brand: p.brand || String(g?.brand || ""), garment: String(g?.description || ""), image: String(g?.image || ""), colors: Array.isArray(g?.colors) ? g!.colors.length : 0 };
    });
    return { ok: true, list };
  } catch (e) { return { ok: false, list: [], error: e instanceof Error ? e.message : "Couldn't load the garments." }; }
}

/** Settings → Garments → Popular garments: save the list (staff). */
export async function savePopularGarments(list: PopularPick[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can change this." };
    const clean = (list || []).slice(0, 60).map((p) => ({
      style: String(p.style || "").trim().slice(0, 40), brand: String(p.brand || "").trim().slice(0, 60), kind: p.kind, tag: String(p.tag || "").slice(0, 40),
      why: String(p.why || "").slice(0, 140), tier: ([1, 2, 3].includes(+p.tier) ? +p.tier : 2) as 1 | 2 | 3, uses: (p.uses || []).filter((u) => ["event", "merch", "staff", "kids"].includes(u)),
    })).filter((p) => p.style);
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const { error } = await admin.from("settings").update({ data: { ...((st?.data || {}) as object), popularGarments: clean }, updated_at: new Date().toISOString() }).eq("id", 1);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}
