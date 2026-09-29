"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Shortcut = { label: string; href: string };

/** Save the signed-in admin's own shortcuts (left menu, "My shortcuts"). */
export async function saveShortcuts(list: Shortcut[]): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can do that." };
  const clean = (list || []).slice(0, 25).map((x) => ({ label: String(x.label || "").trim().slice(0, 60), href: String(x.href || "").trim().slice(0, 500) }))
    .filter((x) => x.label && x.href && (x.href.startsWith("/") || /^https?:\/\//i.test(x.href)));
  const { error } = await createAdminClient().from("staff").update({ shortcuts: clean }).eq("email", v.email);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type WidgetItem = { id: string; w: number; tall?: boolean; text?: string };
/** Save the signed-in admin's dashboard layout (widgets, order, sizes, sticky note). */
export async function saveDashboard(layout: WidgetItem[]): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can do that." };
  const clean = (layout || []).slice(0, 40).map((x) => ({ id: String(x.id).slice(0, 40), w: Math.min(4, Math.max(1, Math.round(+x.w || 2))), ...(x.tall ? { tall: true } : {}), ...(x.text ? { text: String(x.text).slice(0, 4000) } : {}) }));
  const { error } = await createAdminClient().from("staff").update({ dashboard: clean }).eq("email", v.email);
  return error ? { ok: false, error: error.message } : { ok: true };
}
