"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** What each style number is, from our garment list then SanMar's catalog ("562M" → "Jerzees - NuBlend Crewneck
 *  Sweatshirt"), for timing jobs whose lines only give the style (lib/production.ts `seedStyleTitles`). */
export async function styleTitles(styles: string[]): Promise<Record<string, string>> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return {};
  const want = [...new Set(styles.map((s) => s.trim()).filter(Boolean))].slice(0, 600);
  if (!want.length) return {};
  const admin = createAdminClient(), out: Record<string, string> = {};
  const keys = [...new Set(want.flatMap((s) => [s, s.toUpperCase()]))];
  for (let i = 0; i < keys.length; i += 200) {
    const part = keys.slice(i, i + 200);
    const [{ data: sm }, { data: gs }] = await Promise.all([
      admin.from("sanmar_styles").select("style, title").in("style", part),
      admin.from("garments").select("style, description").in("style", part),
    ]);
    for (const r of (sm || []) as { style: string; title: string | null }[]) if (r.title) out[r.style] = r.title;
    for (const r of (gs || []) as { style: string; description: string | null }[]) if (r.description) out[r.style] = r.description;
  }
  return out;
}
