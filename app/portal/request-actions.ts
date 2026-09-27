"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, newGroup, orderGroups, requestProblems, uid, type Group, type Order } from "@/lib/pricing";
import { aiState } from "@/lib/ai/claude";
import { orderFromText } from "@/lib/ai/tasks";
import { proposalToGroups } from "@/lib/ai/normalize";

type Result = { ok: boolean; error?: string; id?: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

/** The signed-in customer's account (their first one). Staff previews can't build orders. */
async function me() {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers start orders from their own login.");
  const { data: cs } = await supabase.from("customers").select("*");
  const cust = (cs || [])[0];
  if (!cust) throw new Error("We couldn't find your account.");
  return { supabase, email, cust, admin: createAdminClient() };
}

/** A request this customer owns that they can still edit (not sent in yet). */
async function myDraft(id: string) {
  const ctx = await me();
  const { data: o } = await ctx.supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) throw new Error("We couldn't find that order.");
  if (o.status !== "request" || o.submitted_at) throw new Error("This order has been sent in, so it can't be changed here. Send us a message instead.");
  return { ...ctx, order: o as Order };
}

/** Start a new order request (no prices; the shop prices it). */
export async function startRequest(): Promise<Result> {
  try {
    const { cust, admin } = await me();
    const { data, error } = await admin.from("orders").insert({
      customer_id: cust.id, status: "request", type: "quote", source: "portal",
      price_type: cust.price_type || "retail", tax_exempt: !!cust.tax_exempt, groups: [newGroup()], total: 0,
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) { return fail(e); }
}

/** Save the customer's edits (only what they're allowed to change). */
export async function saveRequest(id: string, patch: { groups?: Group[]; nickname?: string; due_date?: string | null; notes?: string; delivery_method?: string; ship_to?: string; po_number?: string }): Promise<Result> {
  try {
    const { admin, cust } = await myDraft(id);
    const row: Record<string, unknown> = {};
    if (patch.groups) {
      // customers never set prices: drop any overrides and costs that came along
      const groups = patch.groups.map((g) => ({
        ...g,
        lines: g.lines.map((l) => ({ ...l, priceOverride: null, cost: "" as const })),
        // only files from their own account
        customerMockups: (g.customerMockups || []).filter((m) => typeof m.path === "string" && m.path.startsWith(`mockups/${cust.id}/`)).slice(0, 10),
      }));
      row.groups = groups;
      row.qty = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
    }
    if (patch.nickname !== undefined) row.nickname = patch.nickname.slice(0, 120);
    if (patch.due_date !== undefined) row.due_date = patch.due_date || null;
    if (patch.notes !== undefined) row.notes = patch.notes.slice(0, 5000);
    if (patch.delivery_method !== undefined && ["pickup", "ship", "deliver"].includes(patch.delivery_method)) row.delivery_method = patch.delivery_method;
    if (patch.po_number !== undefined) row.po_number = patch.po_number.slice(0, 60);
    if (patch.ship_to !== undefined) row.ship_to = patch.ship_to.slice(0, 1000);
    const { error } = await admin.from("orders").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Send the request to the shop for pricing and review. */
export async function submitRequest(id: string): Promise<Result> {
  try {
    const { admin, order, cust, email } = await myDraft(id);
    const groups = orderGroups(order);
    const pieces = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
    const missing = requestProblems(groups);
    if (missing.length) return { ok: false, error: `Almost there: ${missing.join("; ")}.` };
    const { error } = await admin.from("orders").update({ submitted_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: id, kind: "request_submitted", detail: `${pieces} pcs`, actor: email });
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const settings = mergeSettings(s?.data);
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `New order request #${order.number} from ${cust.company || cust.name}`,
      html: emailLayout(settings.shop.name, `New order request #${order.number}`, `${cust.company || cust.name} sent in ${order.nickname ? `"${order.nickname}", ` : ""}${pieces} pieces for pricing.`, "Review it", `${siteUrl()}/shop/orders/${id}`),
    });
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * "Order this again": a new order request copied from one of the customer's past orders
 * (garments, sizes, print locations and logos). They adjust it and send it in like any request.
 */
export async function reorderRequest(fromId: string): Promise<Result> {
  try {
    const { supabase, admin, email } = await me();
    // row security: they can only read their own sent orders
    const { data: src } = await supabase.from("orders").select("*").eq("id", fromId).maybeSingle();
    if (!src || src.status === "request" || src.status === "quote") return { ok: false, error: "We couldn't find that order." };
    const { data: cust } = await admin.from("customers").select("price_type,tax_exempt").eq("id", src.customer_id).maybeSingle();
    const groups = orderGroups(src as Order).map((g) => ({
      id: uid(), name: g.name, youth: g.youth, finishing: g.finishing || [],
      lines: g.lines.map((l) => ({ ...l, id: uid(), cost: "" as const, priceOverride: null })),
      imprints: g.imprints.map((d) => ({ ...d, id: uid() })),
      customerMockups: (g.customerMockups || []).filter((m) => m.path.startsWith(`mockups/${src.customer_id}/`)),
    }));
    const { data, error } = await admin.from("orders").insert({
      customer_id: src.customer_id, status: "request", type: "quote", source: "portal",
      price_type: cust?.price_type || src.price_type || "retail", tax_exempt: !!cust?.tax_exempt, groups, total: 0,
      nickname: `${src.nickname || `Order #${src.number}`} (reorder)`.slice(0, 120), notes: `Reorder of #${src.number}.`,
      delivery_method: src.delivery_method || "pickup", ship_to: src.ship_to || "",
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: data.id, kind: "reorder", detail: `From #${src.number}`, actor: email });
    revalidatePath("/portal");
    return { ok: true, id: data.id };
  } catch (e) { return fail(e); }
}

/**
 * "Describe your order": the customer writes what they need in plain words and the AI fills in
 * the order form (garments, sizes, print locations) for them to check. Only when the shop has
 * turned on AI and this option. Never sets prices.
 */
export async function describeMyOrder(id: string, text: string): Promise<Result & { added?: number; questions?: string[]; groups?: Group[]; nickname?: string; due_date?: string | null }> {
  try {
    const { admin, order, email } = await myDraft(id);
    const st = await aiState(admin);
    if (!st.ready || !st.settings.assistant.ai.customerAssist) return { ok: false, error: "This isn't available right now. Please fill in the form below." };
    const t = text.trim().slice(0, 4000);
    if (t.length < 10) return { ok: false, error: "Tell us a bit more about what you need." };
    // a light limit so one customer can't run up the bill
    const { count } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("created_by", email).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count || 0) >= 10) return { ok: false, error: "Please fill in the form below. You can try this again in an hour." };
    const r = await orderFromText(st.settings, t, { admin, order_id: id, customer_id: order.customer_id, by: email });
    if (!r.ok) return { ok: false, error: "We couldn't read that. Please fill in the form below." };
    const groups = proposalToGroups(r.data).map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, cost: "" as const, priceOverride: null })) }));
    if (!groups.length) return { ok: false, error: "We couldn't find garments or sizes in that. Try naming the shirts, colors and how many of each size." };
    const cur = orderGroups(order);
    const blank = cur.length <= 1 && !cur.some((g) => g.lines.some((l) => l.style || l.color || Object.values(l.sizes || {}).some((v) => +v)) || g.imprints.some((d) => d.design_id) || (g.customerMockups || []).length);
    const row: Record<string, unknown> = { groups: blank ? groups : [...cur, ...groups] };
    if (!order.nickname && r.data.nickname) row.nickname = r.data.nickname.slice(0, 120);
    if (!order.due_date && r.data.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.data.due_date)) row.due_date = r.data.due_date;
    row.qty = (row.groups as Group[]).reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
    const { error } = await admin.from("orders").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, added: groups.length, questions: (r.data.questions || []).slice(0, 6), groups: row.groups as Group[], nickname: (row.nickname as string) || undefined, due_date: (row.due_date as string) || undefined };
  } catch (e) { return fail(e); }
}

/** Delete a request the customer hasn't sent in yet. */
export async function discardRequest(id: string): Promise<Result> {
  try {
    const { admin } = await myDraft(id);
    const { error } = await admin.from("orders").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Step 1 of a customer logo upload: a one-time link to put the file straight into storage. */
export async function logoUploadUrl(fileName: string): Promise<{ ok: boolean; error?: string; path?: string; token?: string }> {
  try {
    const { admin } = await me();
    const path = `designs/${crypto.randomUUID()}/${fileName.replace(/[^\w.\-]+/g, "_").slice(-120)}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Upload isn't available right now." };
    return { ok: true, path, token: data.token };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Upload failed." }; }
}

/** Step 2: save the uploaded file as one of the customer's logos. */
export async function saveMyLogo(meta: { path: string; fileName: string; fileType: string; name: string; previewable: boolean; previewPath?: string; w?: number; h?: number; layersPath?: string; colors?: number; inks?: string }) {
  try {
    const { admin, cust, email } = await me();
    if (!/^designs\/[\w-]+\/[\w.\-]+$/.test(meta.path)) return { ok: false as const, error: "Bad upload." };
    if (meta.previewPath && !/^designs\/[\w-]+\/[\w.\-]+$/.test(meta.previewPath)) return { ok: false as const, error: "Bad upload." };
    if (meta.layersPath && !/^designs\/[\w-]+\/layers\.json$/.test(meta.layersPath)) return { ok: false as const, error: "Bad upload." };
    const pvPath = meta.previewPath || (meta.previewable ? meta.path : "");
    const { data, error } = await admin.from("designs").insert({
      customer_id: cust.id, name: (meta.name || meta.fileName.replace(/\.[^.]+$/, "")).trim().slice(0, 120),
      file_path: meta.path, file_name: meta.fileName, file_type: meta.fileType || "", preview_path: pvPath,
      width_px: meta.w || null, height_px: meta.h || null, method: "screen",
      colors: Math.max(1, Math.min(15, Math.round(meta.colors || 1))), inks: (meta.inks || "").slice(0, 300),
      notes: meta.layersPath ? "Made in the shirt designer" : "", created_by: email,
      designer: meta.layersPath ? { file: meta.layersPath } : null,
    }).select("*").single();
    if (error) return { ok: false as const, error: error.message };
    const { data: sg } = pvPath ? await admin.storage.from("proofs").createSignedUrl(pvPath, 3600) : { data: null };
    revalidatePath("/portal");
    return { ok: true as const, design: data, url: sg?.signedUrl || "" };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Upload failed." }; }
}

/** Garment catalog for the customer's mockup builder (no costs). */
export async function portalCatalog() {
  try {
    const { admin } = await me();
    const { data } = await admin.from("garments").select("*").order("style");
    return ((data || []) as Record<string, unknown>[]).map((g) => ({ ...g, cost: 0, size_costs: {} }));
  } catch { return []; }
}

/** The customer's logos (not archived) with preview links. */
export async function myLogos() {
  try {
    const { admin, cust } = await me();
    const { data } = await admin.from("designs").select("*").eq("customer_id", cust.id).is("archived_at", null).order("number", { ascending: false });
    const list = (data || []) as { id: string; preview_path: string }[];
    const withPv = list.filter((d) => d.preview_path);
    const urls: Record<string, string> = {};
    if (withPv.length) {
      const { data: sg } = await admin.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600);
      withPv.forEach((d, i) => { if (sg?.[i]?.signedUrl) urls[d.id] = sg[i].signedUrl!; });
    }
    return { ok: true as const, customerId: cust.id as string, designs: data || [], urls };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load your logos." }; }
}

/** One-time upload links for a saved mockup picture and its thumbnail. */
export async function mockupUploadUrls() {
  try {
    const { admin, cust } = await me();
    const base = `mockups/${cust.id}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const [a, b] = await Promise.all([
      admin.storage.from("proofs").createSignedUploadUrl(`${base}.png`),
      admin.storage.from("proofs").createSignedUploadUrl(`${base}-thumb.png`),
    ]);
    if (a.error || !a.data || b.error || !b.data) return { ok: false as const, error: "Saving isn't available right now." };
    return { ok: true as const, path: `${base}.png`, token: a.data.token, thumbPath: `${base}-thumb.png`, thumbToken: b.data.token };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Saving failed." }; }
}

/** Record a mockup the customer made in their portal. */
export async function saveMyMockup(meta: { path: string; title: string; design_ids: string[] }) {
  try {
    const { admin, cust, email } = await me();
    if (!meta.path.startsWith(`mockups/${cust.id}/`)) return { ok: false as const, error: "Bad upload." };
    const { data: own } = await admin.from("designs").select("id").eq("customer_id", cust.id).in("id", meta.design_ids.length ? meta.design_ids : ["00000000-0000-0000-0000-000000000000"]);
    const ids = ((own || []) as { id: string }[]).map((d) => d.id);
    const { error } = await admin.from("mockups").insert({ customer_id: cust.id, title: meta.title.slice(0, 200), file_path: meta.path, design_ids: ids, created_by: email });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/portal");
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Saving failed." }; }
}

/** One-time upload link for a mockup the customer made in their own software. */
export async function ownMockupUploadUrl(fileName: string) {
  try {
    const { admin, cust } = await me();
    const path = `mockups/${cust.id}/own-${Date.now()}-${crypto.randomUUID().slice(0, 6)}-${fileName.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false as const, error: error?.message || "Upload isn't available right now." };
    return { ok: true as const, path, token: data.token };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Upload failed." }; }
}

/** After uploading their own mockup: keep it in their Artwork (pictures only) and return a link to show it. */
export async function saveOwnMockup(meta: { path: string; name: string; isImage: boolean }) {
  try {
    const { admin, cust, email } = await me();
    if (!meta.path.startsWith(`mockups/${cust.id}/`)) return { ok: false as const, error: "Bad upload." };
    if (meta.isImage) await admin.from("mockups").insert({ customer_id: cust.id, title: `${meta.name} (your mockup)`.slice(0, 200), file_path: meta.path, design_ids: [], created_by: email });
    const { data } = await admin.storage.from("proofs").createSignedUrl(meta.path, 3600);
    return { ok: true as const, url: data?.signedUrl || "" };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Upload failed." }; }
}

/** A link to one of the customer's own designer layer files, to reopen a design in the shirt designer. */
export async function myDesignerDoc(designId: string) {
  try {
    const { admin, cust } = await me();
    const { data: d } = await admin.from("designs").select("id,customer_id,designer").eq("id", designId).maybeSingle();
    const file = (d?.designer as { file?: string } | null)?.file;
    if (!d || d.customer_id !== cust.id || !file) return { ok: false as const };
    const { data } = await admin.storage.from("proofs").createSignedUrl(file, 600);
    return data?.signedUrl ? { ok: true as const, url: data.signedUrl } : { ok: false as const };
  } catch { return { ok: false as const }; }
}
