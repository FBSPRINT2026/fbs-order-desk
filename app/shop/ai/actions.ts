"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import type { WBCard, WBFile, WBMsg } from "@/lib/ai/workbenchShared";
import { newImprint, type Imprint } from "@/lib/pricing";

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
      for (const f of m.files || []) { paths.add(f.path); if (f.preview) paths.add(f.preview.path); }
      for (const c of m.cards || []) if (c.kind === "mockups") for (const it of c.items) { it.prints.forEach((p) => paths.add(p.artPath)); if (it.saved) paths.add(it.saved); }
    }
    const { data: s } = paths.size ? await admin.storage.from("proofs").createSignedUrls([...paths], 6 * 3600) : { data: [] };
    const url = new Map<string, string>(((s || []) as { path: string | null; signedUrl: string }[]).map((x) => [x.path || "", x.signedUrl]));
    for (const m of msgs) {
      for (const f of m.files || []) { f.url = url.get(f.path) || ""; if (f.preview) f.preview.url = url.get(f.preview.path) || ""; }
      for (const c of m.cards || []) if (c.kind === "mockups") for (const it of c.items) { it.prints.forEach((p) => { p.art = url.get(p.artPath) || p.art; }); if (it.saved) it.savedUrl = url.get(it.saved) || ""; }
    }
    return { ok: true as const, id: data.id as string, title: String(data.title || ""), messages: msgs };
  } catch (e) { return fail(e); }
}

/** the Workbench chat this person has on an email (Inbox Assistant, Oct 22): its messages with fresh links, or none yet.
 *  `can` is false when the Workbench isn't on for them (the Assistant then sticks to quick answers). */
export async function emailWorkChat(emailKey: string) {
  try {
    const { admin, email } = await me();
    const { data } = await admin.from("ai_chats").select("id").eq("owner", email).eq("email_key", emailKey).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return { ok: true as const, can: true, id: "", messages: [] as WBMsg[] };
    const r = await getChat(data.id as string);
    return r.ok ? { ok: true as const, can: true, id: r.id, messages: r.messages } : { ok: true as const, can: true, id: "", messages: [] as WBMsg[] };
  } catch { return { ok: true as const, can: false, id: "", messages: [] as WBMsg[] }; }
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

/**
 * A Workbench mockup card, set up in the Mockup Creator (Oct 22, Nick: "use our mockup builder like we would do on a
 * reorder or a new order… and auto build some mockups"): the customer, the garment in each color, and each print with
 * its design, place, size and ink. Art dropped in the chat is saved to the customer's artwork first (an art file
 * already saved under the same name is used again), like Upload Logo does. Staff check it and click Save Mockup.
 */
export async function mockupSpec(chatId: string, cardId: string) {
  try {
    const { admin, email } = await me();
    const got = await loadCard(admin, email, chatId, cardId);
    if (!got || got.card.kind !== "mockups" || !got.card.spec) return { ok: false as const, error: "That mockup card can't be opened in the Mockup Creator (made before Oct 22): ask the Workbench to make it again." };
    const sp = got.card.spec;
    if (!sp.customer_id) return { ok: false as const, error: "Tell the Workbench which customer these are for, then open them again." };
    const files = got.msgs.flatMap((m) => m.files || []) as WBFile[];
    const imprints: Imprint[] = [];
    for (const p of sp.prints) {
      let designId = p.design_id || "";
      if (!designId && p.file) {
        const f = files.find((x) => x.id === p.file);
        if (!f) continue;
        const { data: had } = await admin.from("designs").select("id").eq("customer_id", sp.customer_id).eq("file_name", f.name).is("archived_at", null).order("number", { ascending: false }).limit(1).maybeSingle();
        if (had) designId = had.id as string;
        else {
          const to = `designs/${crypto.randomUUID()}/${safe(f.name)}`;
          if ((await admin.storage.from("proofs").copy(f.path, to)).error) continue;
          let pv: string | null = /^image\/(png|jpe?g|gif|webp)$/i.test(f.type) ? to : null;
          if (!pv && f.preview?.path) { const pto = `${to.replace(/\.[^./]+$/, "")}-preview.png`; if (!(await admin.storage.from("proofs").copy(f.preview.path, pto)).error) pv = pto; }
          const { data: d } = await admin.from("designs").insert({ customer_id: sp.customer_id, name: f.name.replace(/\.[^.]+$/, "").slice(0, 120), file_path: to, file_name: f.name, file_type: f.type || "", preview_path: pv, method: "screen", colors: p.ink ? 1 : null, inks: p.ink || "", notes: "From the AI Workbench", created_by: email }).select("id").single();
          if (d) designId = d.id as string;
        }
      }
      if (!designId) continue;
      imprints.push({ ...newImprint(p.location), design_id: designId, ...(p.ink ? { colors: 1, inks: p.ink } : {}), ...(p.widthIn ? { size: `${p.widthIn}" wide` } : {}) } as Imprint);
    }
    if (!imprints.length) return { ok: false as const, error: "None of the art on that card could be set up." };
    const { data: gs } = await admin.from("garments").select("id, style, brand").ilike("style", sp.style).limit(5);
    const g = (gs || []).find((x) => !sp.brand || String(x.brand || "").toLowerCase().includes(sp.brand.toLowerCase().split(" ")[0])) || (gs || [])[0];
    const lines = sp.colors.map((c) => ({ id: crypto.randomUUID().slice(0, 8), style: sp.style, brand: sp.brand, color: c, garment: (g?.id as string) || "" }));
    return { ok: true as const, customerId: sp.customer_id, lines, imprints };
  } catch (e) { return fail(e); }
}
