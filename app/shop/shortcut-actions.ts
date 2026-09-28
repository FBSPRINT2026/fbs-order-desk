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
