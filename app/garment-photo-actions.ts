"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Garment photos someone uploads for a mockup when the garment isn't in the S&S / SanMar catalog (Oct 24, Nick: "LA
 * Apparel isn't offered at either of those two suppliers… here's the front image, here's the back image"). Kept in
 * storage under garments/<customer id or "shop">/; customers only ever touch their own.
 */
async function who(customerId?: string) {
  const { supabase, user, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) return { prefix: `garments/${customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? customerId : "shop"}/`, staff: true };
  const { data: cs } = await supabase.from("customers").select("id").limit(1);
  const c = (cs || [])[0];
  if (!c) throw new Error("We couldn't find your account.");
  return { prefix: `garments/${c.id}/`, staff: false };
}

export async function garmentPhotoUploadUrl(fileName: string, customerId?: string): Promise<{ ok: boolean; error?: string; path?: string; token?: string }> {
  try {
    const w = await who(customerId);
    const path = `${w.prefix}${crypto.randomUUID().slice(0, 8)}-${fileName.replace(/[^\w.\-]+/g, "_").slice(-80) || "photo.png"}`;
    const { data, error } = await createAdminClient().storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Upload isn't available right now." };
    return { ok: true, path, token: data.token };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Upload failed." }; }
}

/** links to show uploaded garment photos (a week; asked for again whenever the Mockup Creator opens) */
export async function garmentPhotoUrls(paths: string[], customerId?: string): Promise<Record<string, string>> {
  try {
    const w = await who(customerId);
    const ok = [...new Set(paths)].filter((p) => typeof p === "string" && p.startsWith("garments/") && (w.staff || p.startsWith(w.prefix))).slice(0, 60);
    if (!ok.length) return {};
    const { data } = await createAdminClient().storage.from("proofs").createSignedUrls(ok, 7 * 86400);
    const out: Record<string, string> = {};
    (data || []).forEach((x, i) => { if (x.signedUrl) out[ok[i]] = x.signedUrl; });
    return out;
  } catch { return {}; }
}
