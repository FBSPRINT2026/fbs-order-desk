"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import type { WBCard, WBMsg } from "@/lib/ai/workbenchShared";

/** AI Workbench (Oct 13): each person's chats, file uploads, and the cards' buttons (create the quote, keep mockups) */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.workbench) throw new Error("The AI Workbench isn't on for you (Settings → User Access).");
  return { v, perms, admin: createAdminClient(), email: v.email.toLowerCase() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const safe = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-90) || "file";

export type ChatRow = { id: string; title: string; updated_at: string };

export async function listChats() {
  try {
    const { admin, email } = await me();
    const { data } = await admin.from("ai_chats").select("id, title, updated_at").eq("owner", email).order("updated_at", { ascending: false }).limit(40);
    return { ok: true as const, chats: (data || []) as ChatRow[] };
  } catch (e) { return fail(e); }
}

/** a chat with fresh links to its files and pictures (links run out after a few hours) */
export async function getChat(id: string) {
  try {
    const { admin, email } = await me();
    const { data } = await admin.from("ai_chats").select("id, title, messages").eq("id", id).eq("owner", email).maybeSingle();
    if (!data) return { ok: false as const, error: "That chat isn't there anymore." };
    const msgs = (data.messages || []) as WBMsg[];
    const paths = new Set<string>();
    for (const m of msgs) {
      for (const f of m.files || []) paths.add(f.path);
      for (const c of m.cards || []) if (c.kind === "mockups") for (const it of c.items) { it.prints.forEach((p) => paths.add(p.artPath)); if (it.saved) paths.add(it.saved); }
    }
    const { data: s } = paths.size ? await admin.storage.from("proofs").createSignedUrls([...paths], 6 * 3600) : { data: [] };
    const url = new Map<string, string>(((s || []) as { path: string | null; signedUrl: string }[]).map((x) => [x.path || "", x.signedUrl]));
    for (const m of msgs) {
      for (const f of m.files || []) f.url = url.get(f.path) || "";
      for (const c of m.cards || []) if (c.kind === "mockups") for (const it of c.items) { it.prints.forEach((p) => { p.art = url.get(p.artPath) || p.art; }); if (it.saved) it.savedUrl = url.get(it.saved) || ""; }
    }
    return { ok: true as const, id: data.id as string, title: String(data.title || ""), messages: msgs };
  } catch (e) { return fail(e); }
}

/** where the page uploads a file the person dropped in */
export async function uploadTarget(name: string, size: number) {
  try {
    const { admin } = await me();
    if (size > 50 * 1024 * 1024) return { ok: false as const, error: `${name} is over 50 MB.` };
    const path = `ai/uploads/${crypto.randomUUID()}/${safe(name)}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false as const, error: error?.message || "Couldn't start the upload." };
    return { ok: true as const, path, token: data.token };
  } catch (e) { return fail(e); }
}

async function loadCard(admin: ReturnType<typeof createAdminClient>, email: string, chatId: string, cardId: string) {
  const { data } = await admin.from("ai_chats").select("id, messages").eq("id", chatId).eq("owner", email).maybeSingle();
  if (!data) return null;
  const msgs = (data.messages || []) as WBMsg[];
  for (const m of msgs) for (const c of m.cards || []) if (c.id === cardId) return { msgs, card: c };
  return null;
}
const saveMsgs = (admin: ReturnType<typeof createAdminClient>, chatId: string, msgs: WBMsg[]) => admin.from("ai_chats").update({ messages: msgs, updated_at: new Date().toISOString() }).eq("id", chatId);

export async function searchCustomers(q: string) {
  try {
    const { admin } = await me();
    const t = q.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
    if (t.length < 2) return { ok: true as const, list: [] as { id: string; label: string }[] };
    const { data } = await admin.from("customers").select("id, company, name").or(`company.ilike.%${t}%,name.ilike.%${t}%,email.ilike.%${t}%`).order("company").limit(8);
    return { ok: true as const, list: (data || []).map((x) => ({ id: x.id as string, label: `${x.company || x.name}${x.company && x.name ? ` (${x.name})` : ""}` })) };
  } catch (e) { return fail(e); }
}

/** the order card's button: make the quote (prices are worked out in the order, like any quote) */
export async function createQuote(chatId: string, cardId: string, customerId: string) {
  try {
    const { admin, email, perms } = await me();
    if (!perms.quotes) return { ok: false as const, error: "Creating quotes isn't on for you (Settings → User Access)." };
    const got = await loadCard(admin, email, chatId, cardId);
    if (!got || got.card.kind !== "order") return { ok: false as const, error: "That card isn't there anymore." };
    const card = got.card as Extract<WBCard, { kind: "order" }>;
    if (card.created) return { ok: true as const, id: card.created.id, number: card.created.number };
    if (!customerId) return { ok: false as const, error: "Pick the customer first." };
    const r = await createOrderFromDraft(admin, email, { customerId, draft: card.draft, status: "quote", via: "the AI Workbench" });
    if (!r.ok) return r;
    const { data: cu } = await admin.from("customers").select("company, name").eq("id", customerId).maybeSingle();
    card.customer = { id: customerId, label: String(cu?.company || cu?.name || "Customer") };
    card.created = { id: r.id, number: r.number };
    await saveMsgs(admin, chatId, got.msgs);
    return { ok: true as const, id: r.id, number: r.number };
  } catch (e) { return fail(e); }
}

/** where the page saves the mockup pictures it drew */
export async function mockupTargets(chatId: string, cardId: string, n: number) {
  try {
    const { admin, email } = await me();
    if (!(await loadCard(admin, email, chatId, cardId))) return { ok: false as const, error: "That card isn't there anymore." };
    const out: { path: string; token: string }[] = [];
    for (let i = 0; i < Math.min(n, 40); i++) {
      const path = `ai/mockups/${chatId}/${cardId}-${i}-${Date.now().toString(36)}.png`;
      const { data } = await admin.storage.from("proofs").createSignedUploadUrl(path);
      if (data) out.push({ path, token: data.token });
    }
    return { ok: true as const, targets: out };
  } catch (e) { return fail(e); }
}

export async function saveMockups(chatId: string, cardId: string, saved: { i: number; path: string }[]) {
  try {
    const { admin, email } = await me();
    const got = await loadCard(admin, email, chatId, cardId);
    if (!got || got.card.kind !== "mockups") return { ok: false as const, error: "That card isn't there anymore." };
    for (const s of saved) { const it = got.card.items[s.i]; if (it && s.path.startsWith(`ai/mockups/${chatId}/`)) it.saved = s.path; }
    await saveMsgs(admin, chatId, got.msgs);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
