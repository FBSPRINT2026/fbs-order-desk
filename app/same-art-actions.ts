"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The logos a customer already has, for the same-art check when a new one is uploaded (lib/sameArt.ts; Oct 24, Nick:
 * "I don't want to have customers having a lot of the same art… That art number is going to become important").
 * Customers see their own; staff pass the customer.
 */
async function scope(customerId?: string) {
  const { supabase, user, isStaff } = await getViewer();
  if (!user) return null;
  if (isStaff) return customerId && /^[0-9a-f-]{36}$/i.test(customerId) ? customerId : null;
  const { data: cs } = await supabase.from("customers").select("id").limit(1);
  return ((cs || [])[0]?.id as string) || null;
}

export type ArtCandidate = { id: string; number: number | null; name: string; art_hash: string | null; url: string; design: Record<string, unknown> };

export async function sameArtCandidates(customerId?: string): Promise<ArtCandidate[]> {
  try {
    const cid = await scope(customerId); if (!cid) return [];
    const admin = createAdminClient();
    const { data } = await admin.from("designs").select("*").eq("customer_id", cid).is("archived_at", null).eq("draft", false).order("number", { ascending: false }).limit(80);
    const rows = (data || []) as Record<string, unknown>[];
    const need = rows.filter((r) => r.preview_path).map((r) => String(r.preview_path));
    const { data: sg } = need.length ? await admin.storage.from("proofs").createSignedUrls(need, 3600) : { data: [] };
    const urlOf = new Map((sg || []).map((x, i) => [need[i], x.signedUrl || ""]));
    return rows.map((r) => ({ id: String(r.id), number: (r.number as number) ?? null, name: String(r.name || ""), art_hash: (r.art_hash as string) || null, url: r.preview_path ? String(urlOf.get(String(r.preview_path)) || "") : "", design: r }));
  } catch { return []; }
}

/** fingerprints worked out in the browser for logos that didn't have one yet (kept so it's done once) */
export async function saveArtHashes(list: { id: string; hash: string }[], customerId?: string): Promise<void> {
  try {
    const cid = await scope(customerId); if (!cid) return;
    const admin = createAdminClient();
    for (const x of list.slice(0, 80)) if (/^[0-9a-f]{16}$/.test(x.hash)) await admin.from("designs").update({ art_hash: x.hash }).eq("id", x.id).eq("customer_id", cid);
  } catch { /* best effort */ }
}
