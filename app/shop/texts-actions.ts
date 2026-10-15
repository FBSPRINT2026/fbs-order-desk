"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { organizerFor } from "@/lib/mail/mirror";
import { newToken, sha } from "@/lib/texts";

/** Settings > Texts: the Macs that send customer texts (owners only, like the texts themselves) */
async function owner() {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !organizerFor(v.email, v.role)) throw new Error("Only the owners can set up texts.");
  return { v, admin: createAdminClient(), email: v.email.toLowerCase() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export type TextMac = { id: string; owner: string; name: string; last_seen_at: string | null; last_error: string | null; created_at: string; texts: number; customers: number; last_text: string | null };

export async function listTextMacs() {
  try {
    const { admin } = await owner();
    const { data } = await admin.from("text_devices").select("id, owner, name, last_seen_at, last_error, created_at").is("revoked_at", null).order("created_at");
    const out: TextMac[] = [];
    for (const d of (data || []) as Omit<TextMac, "texts" | "customers" | "last_text">[]) {
      const { count } = await admin.from("text_messages").select("id", { count: "exact", head: true }).eq("device_id", d.id);
      const { data: last } = await admin.from("text_messages").select("sent_at").eq("device_id", d.id).order("sent_at", { ascending: false }).limit(1).maybeSingle();
      const { data: cs } = await admin.from("text_messages").select("customer_id").eq("device_id", d.id).limit(5000);
      out.push({ ...d, texts: count || 0, customers: new Set(((cs || []) as { customer_id: string | null }[]).map((x) => x.customer_id).filter(Boolean)).size, last_text: (last?.sent_at as string) || null });
    }
    return { ok: true as const, macs: out };
  } catch (e) { return fail(e); }
}

/** a new Mac: its setup code, shown once (only its fingerprint is kept) */
export async function addTextMac(name: string) {
  try {
    const { admin, email } = await owner();
    const token = newToken();
    const { error } = await admin.from("text_devices").insert({ owner: email, name: (name || "Mac").trim().slice(0, 60), token_hash: sha(token) });
    if (error) throw new Error(error.message);
    return { ok: true as const, token };
  } catch (e) { return fail(e); }
}

/** stop a Mac sending (its texts stay) */
export async function removeTextMac(id: string) {
  try {
    const { admin } = await owner();
    await admin.from("text_devices").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
