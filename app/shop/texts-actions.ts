"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { organizerFor } from "@/lib/mail/mirror";
import { handleKey, newToken, sha } from "@/lib/texts";

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

export type TextRow = { id: string; from_me: boolean; body: string; sent_at: string; handle: string; chat: string; chat_name: string; service: string; files: { name: string; type: string; url: string }[];
  /** who it's with (the contact's name, or the number) and the conversation's name (a person, or a group text) */ who: string; convo: string };
/** a customer's texts, newest last (owners only); pictures as links good for an hour */
export async function getCustomerTexts(customerId: string, limit = 300) {
  try {
    const { admin } = await owner();
    const { data } = await admin.from("text_messages").select("id, from_me, body, sent_at, handle, chat, chat_name, service, files").eq("customer_id", customerId).order("sent_at", { ascending: false }).limit(Math.min(1000, limit));
    const rows = ((data || []) as (Omit<TextRow, "files" | "who" | "convo"> & { files: { name: string; type: string; path: string }[] })[]).reverse();
    // their people's names, by number and email (Oct 15, Nick: "Peticolas has texts with Michael and with Kayla")
    const [{ data: c }, { data: cts }] = await Promise.all([
      admin.from("customers").select("name, phone, email, contact2_name, contact2_phone, contact2_email").eq("id", customerId).maybeSingle(),
      admin.from("customer_contacts").select("name, phone, email").eq("customer_id", customerId),
    ]);
    const names = new Map<string, string>();
    const put = (n: string | null | undefined, ...hs: (string | null | undefined)[]) => { if (n?.trim()) for (const h of hs) { const k = handleKey(h); if (k && !names.has(k)) names.set(k, n.trim()); } };
    for (const x of (cts || []) as { name: string; phone: string; email: string }[]) put(x.name, x.phone, x.email);
    if (c) { put(c.name, c.phone, c.email); put(c.contact2_name, c.contact2_phone, c.contact2_email); }
    const nice = (h: string) => names.get(handleKey(h)) || (/^\+1\d{10}$/.test(h) ? `(${h.slice(2, 5)}) ${h.slice(5, 8)}-${h.slice(8)}` : h);
    const paths = rows.flatMap((r) => (r.files || []).map((f) => f.path));
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data: s } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
      for (const x of s || []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
    }
    return { ok: true as const, texts: rows.map((r) => {
      const group = !!r.chat && !/^(\+?\d+|[^@\s]+@[^@\s]+)$/.test(r.chat);
      return { ...r, who: nice(r.handle), convo: group ? r.chat_name || "Group text" : nice(r.chat || r.handle), files: (r.files || []).map((f) => ({ name: f.name, type: f.type, url: signed.get(f.path) || "" })) };
    }) as TextRow[] };
  } catch (e) { return fail(e); }
}

/** how many texts a customer has (0 for anyone but the owners): the customer page shows a Texts tab when there are some */
export async function customerTextCount(customerId: string) {
  try {
    const { admin } = await owner();
    const { count } = await admin.from("text_messages").select("id", { count: "exact", head: true }).eq("customer_id", customerId);
    return count || 0;
  } catch { return 0; }
}
