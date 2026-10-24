"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, newGLine, newGroup, orderGroups, requestProblems, uid, type Group, type Order } from "@/lib/pricing";
import { aiState } from "@/lib/ai/claude";
import { orderFromText } from "@/lib/ai/tasks";
import { proposalToGroups } from "@/lib/ai/normalize";
import { groupsFromPrintavo, readFiles } from "@/lib/ai/emailOrder";

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
    // a draft until it's sent (Oct 24, Nick: "only assign a number… once it's either saved, sent")
    const { data, error } = await admin.from("orders").insert({
      customer_id: cust.id, status: "request", type: "quote", source: "portal", draft: true,
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
        lines: g.lines.map((l) => ({ ...l, priceOverride: null, cost: "" as const, sizeUpSet: undefined })),
        // only files from their own account
        customerMockups: (g.customerMockups || []).filter((m) => typeof m.path === "string" && m.path.startsWith(`mockups/${cust.id}/`)).slice(0, 10),
        // their tag art (Tag Print, no tag on file): only files they uploaded to this order
        tagArt: g.tagArt && typeof g.tagArt.path === "string" && g.tagArt.path.startsWith(`requests/${cust.id}/${id}/`) ? { path: g.tagArt.path, name: String(g.tagArt.name || "Tag").slice(0, 120) } : undefined,
      }));
      row.groups = groups;
      // a wholesale account sees its prices while building, so the order keeps its total (Oct 24: #40149 showed $0.00)
      if ((cust.price_type || "retail") === "wholesale") {
        const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
        const { data: cur } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
        if (cur) row.total = calcOrder({ ...(cur as Order), groups, price_type: "wholesale" }, mergeSettings(st?.data), []).total;
      }
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
    const { admin, order: o0, cust, email, supabase } = await myDraft(id);
    const groups = orderGroups(o0);
    const pieces = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
    const missing = requestProblems(groups);
    if (missing.length) return { ok: false, error: `Almost there: ${missing.join("; ")}.` };
    // sent: the draft becomes an order with its number (Oct 24, Nick)
    const { data: num, error: ce } = await supabase.rpc("order_commit", { p_id: id });
    if (ce) return { ok: false, error: ce.message };
    const order = { ...o0, number: Number(num) || o0.number };
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
 * "Reorder": a new order request copied from one of the customer's past orders
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
      mockupThumbs: g.mockupThumbs, mockupSkipped: true,
      // the prints as they were printed, fixed like a mockup's (Oct 24, Nick: "pulling up the old screen, not the new method")
      reprintOf: `#${src.number}`,
    }));
    const { data, error } = await admin.from("orders").insert({
      customer_id: src.customer_id, status: "request", type: "quote", source: "portal", draft: true,
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
    // set aside, never deleted (a draft never had a number; an older unsent request keeps its number, hidden)
    const { admin } = await myDraft(id);
    const { error } = await admin.from("orders").update({ discarded_at: new Date().toISOString() }).eq("id", id);
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
export async function saveMyLogo(meta: { artHash?: string; path: string; fileName: string; fileType: string; name: string; previewable: boolean; previewPath?: string; w?: number; h?: number; layersPath?: string; colors?: number; inks?: string }) {
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
      ...(meta.artHash && /^[0-9a-f]{16}$/.test(meta.artHash) ? { art_hash: meta.artHash } : {}),
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
    return ((data || []) as Record<string, unknown>[]).map((g) => ({ ...g, cost: 0, size_costs: {}, color_size_costs: {} }));
  } catch { return []; }
}

/** The customer's logos (not archived) with preview links. */
export async function myLogos() {
  try {
    const { admin, cust } = await me();
    const { data } = await admin.from("designs").select("*").eq("customer_id", cust.id).is("archived_at", null).eq("draft", false).order("number", { ascending: false });
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

/**
 * Record a mockup the customer made in their portal. It keeps its setup (garments, prints, inks, where each print sits) so
 * it can be opened to edit and ordered (Oct 24, Nick); every shirt color saved together shares the set id and so one
 * mockup number (M-1001, migration 202).
 */
export async function saveMyMockup(meta: { path: string; title: string; design_ids: string[]; snapshot?: Record<string, unknown> }) {
  try {
    const { admin, cust, email } = await me();
    if (!meta.path.startsWith(`mockups/${cust.id}/`)) return { ok: false as const, error: "Bad upload." };
    const { data: own } = await admin.from("designs").select("id").eq("customer_id", cust.id).in("id", meta.design_ids.length ? meta.design_ids : ["00000000-0000-0000-0000-000000000000"]);
    const ids = ((own || []) as { id: string }[]).map((d) => d.id);
    const snap = meta.snapshot && typeof meta.snapshot.set === "string" && JSON.stringify(meta.snapshot).length < 400000 ? meta.snapshot : null;
    const { data, error } = await admin.from("mockups").insert({ customer_id: cust.id, title: meta.title.slice(0, 200), file_path: meta.path, design_ids: ids, created_by: email, snapshot: snap }).select("id, number").single();
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/portal");
    return { ok: true as const, id: data.id as string, number: data.number as number | null };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Saving failed." }; }
}

/** A mockup set saved again: its earlier pictures step aside (the number stays), so only the current version shows. */
export async function retireMyMockups(set: string, keep: string[]) {
  try {
    const { admin, cust } = await me();
    if (!set) return { ok: true as const };
    const { data: old } = await admin.from("mockups").select("id").eq("customer_id", cust.id).is("order_id", null).is("archived_at", null).eq("snapshot->>set", set);
    const gone = ((old || []) as { id: string }[]).map((x) => x.id).filter((id) => !keep.includes(id));
    if (gone.length) await admin.from("mockups").update({ archived_at: new Date().toISOString() }).in("id", gone);
    revalidatePath("/portal");
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Saving failed." }; }
}

type MockRow = { file_path: string; title: string; snapshot: Record<string, unknown> | null; design_ids?: string[] | null };
/**
 * A mockup saved before mockups kept their setup: the garments from the pictures' names ("Name — Next Level 6210 Black")
 * matched to the catalog, and its logo on the front.
 */
async function fromPictures(admin: ReturnType<typeof createAdminClient>, name: string, rows: MockRow[]): Promise<Group> {
  const { data: cat } = await admin.from("garments").select("style, brand, description");
  const gs = ((cat || []) as { style: string; brand: string; description: string }[]).map((x) => ({ ...x, key: `${x.brand} ${x.style}`.toLowerCase() })).sort((a, b) => b.key.length - a.key.length);
  const lines = rows.map((r) => {
    const tail = (r.title.split(" — ")[1] || "").trim(), lc = tail.toLowerCase();
    const hit = gs.find((x) => lc.startsWith(x.key + " ") || lc === x.key);
    return hit ? { ...newGLine(), style: hit.style, brand: hit.brand, garment: hit.description, color: tail.slice(hit.key.length).trim() } : null;
  }).filter(Boolean) as ReturnType<typeof newGLine>[];
  const design = rows.flatMap((r) => r.design_ids || [])[0];
  const g = newGroup();
  return { ...g, name, lines: lines.length ? lines : g.lines, imprints: [{ ...g.imprints[0], ...(design ? { design_id: design } : {}) }] };
}

/**
 * "Order this" on one of their mockups (Oct 24, Nick: "if they place an order, it starts an order with that already filled
 * in"): a new order request with the mockup's garments and colors, its prints (logo, place, size, inks) and the mockup
 * pictures. They add sizes and send it in like any order; the shop prices it.
 */
export async function orderFromMockup(mockupId: string): Promise<Result> {
  try {
    const { supabase, admin, cust, email } = await me();
    const m = await groupFromMockup(supabase, admin, mockupId);
    if (!m) return { ok: false, error: "We couldn't find that mockup." };
    const { data, error } = await admin.from("orders").insert({
      customer_id: m.customerId, status: "request", type: "quote", source: "portal", draft: true,
      price_type: cust.price_type || "retail", tax_exempt: !!cust.tax_exempt, groups: [m.g], total: 0,
      nickname: m.name.slice(0, 120), notes: `From mockup ${m.tag}.`,
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: data.id, kind: "from_mockup", detail: `From ${m.tag}`, actor: email });
    revalidatePath("/portal");
    return { ok: true, id: data.id };
  } catch (e) { return fail(e); }
}

/** An order group built from one of the customer's mockups (row security: their own mockups only). */
async function groupFromMockup(supabase: Awaited<ReturnType<typeof me>>["supabase"], admin: ReturnType<typeof createAdminClient>, mockupId: string) {
  const { data: mk } = await supabase.from("mockups").select("id, customer_id, number, title, snapshot").eq("id", mockupId).maybeSingle();
  if (!mk) return null;
  const { data: rows } = mk.number
    ? await supabase.from("mockups").select("file_path, title, snapshot, created_at, design_ids").eq("customer_id", mk.customer_id).eq("number", mk.number).is("archived_at", null).order("created_at")
    : await supabase.from("mockups").select("file_path, title, snapshot, created_at, design_ids").eq("id", mk.id);
  const all = (rows || []) as MockRow[];
  type Snap = { name?: string; lines?: { style: string; brand: string; color: string; garment: string }[]; imprints?: Group["imprints"]; offsets?: Record<string, { dx: number; dy: number }>; mockupSize?: string | null };
  const snap = (all.find((r) => (r.snapshot as Snap | null)?.lines?.length)?.snapshot || mk.snapshot) as Snap | null;
  const name = snap?.name || String(mk.title || "").split(" — ")[0] || "Mockup";
  const tag = mk.number ? `M-${mk.number}` : "your mockup";
  const g: Group = snap?.lines?.length
    ? { id: uid(), name, lines: snap.lines.map((l) => ({ ...newGLine(), style: l.style || "", brand: l.brand || "", garment: l.garment || "", color: l.color || "" })),
        imprints: (snap.imprints || []).map((d) => ({ ...d })), mockupOffsets: snap.offsets || undefined, mockupSize: snap.mockupSize || undefined }
    : await fromPictures(admin, name, all);
  const own = all.filter((r) => r.file_path.startsWith(`mockups/${mk.customer_id}/`));
  g.customerMockups = own.map((r) => ({ path: r.file_path, name: r.title })).slice(0, 10);
  // shown like our order screen: the shirts with the prints, read only (Oct 24, Nick)
  if (snap?.lines?.length) {
    g.fromMockup = { id: mk.id, number: mk.number ?? null };
    g.mockupThumbs = own.map((r) => r.file_path.replace(/\.png$/, "-thumb.png"));
    g.mockupAt = new Date().toISOString();
  }
  return { g, name, tag, customerId: mk.customer_id as string };
}

/**
 * The mockup made from an order they're building (Oct 24, Nick: "if they are making something from scratch, it just should
 * start out by saying create mockup or upload your own existing mockup… in the imprint screen"): its shirts and prints go
 * into that group, keeping the sizes already typed for the same style and color.
 */
export async function attachMockupToRequest(orderId: string, groupId: string, mockupId: string): Promise<Result> {
  try {
    const { supabase, admin, order } = await myDraft(orderId);
    const m = await groupFromMockup(supabase, admin, mockupId);
    if (!m || m.customerId !== order.customer_id) return { ok: false, error: "We couldn't find that mockup." };
    const groups = orderGroups(order);
    const i = groups.findIndex((x) => x.id === groupId);
    const old = i >= 0 ? groups[i] : null;
    const key = (l: { style: string; color: string }) => `${l.style}|${l.color}`.toLowerCase();
    const g: Group = { ...m.g, id: old?.id || m.g.id, name: old?.name || m.g.name,
      lines: m.g.lines.map((l) => ({ ...l, sizes: old?.lines.find((x) => key(x) === key(l))?.sizes || l.sizes })) };
    if (i >= 0) groups[i] = g; else groups.push(g);
    const { error } = await admin.from("orders").update({ groups }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/portal/request/${orderId}`);
    return { ok: true, id: orderId };
  } catch (e) { return fail(e); }
}

/** The group of an order they're building, to start a mockup from what they've filled in (garments and prints). */
export async function requestGroupSetup(orderId: string, groupId: string) {
  try {
    const { order } = await myDraft(orderId);
    const g = orderGroups(order).find((x) => x.id === groupId);
    if (!g) return { ok: false as const, error: "We couldn't find that group." };
    return { ok: true as const, name: g.name || order.nickname || "", lines: g.lines.filter((l) => l.style || l.color).map((l) => ({ id: l.id, style: l.style, brand: l.brand || "", color: l.color, garment: l.garment || "" })), imprints: g.imprints };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load the order." }; }
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

// ---------- Have a PO, or just want to send us the details? (Oct 24, Nick) ----------
// "they upload the PO and it fills out the form and they can confirm all the details… And there's just upload a simple
// order… when's it due, where's it going, about how many units, upload art, upload PO. If you have it, tell us about
// the goods." Their files go with the order (Production notes & files); the PO is read with the same rules the shop
// uses for a PO that comes by email (lib/ai/poRules.ts).

export type RqFile = { path: string; name: string; type: string; size: number; kind?: "po" | "art" | "other" };
const cleanFiles = (files: RqFile[], custId: string, orderId: string) => (files || [])
  .filter((f) => typeof f.path === "string" && f.path.startsWith(`requests/${custId}/${orderId}/`))
  .slice(0, 20).map((f) => ({ path: f.path, name: String(f.name || "file").slice(0, 160), type: String(f.type || "").slice(0, 120), size: Math.max(0, +f.size || 0), kind: f.kind === "po" || f.kind === "art" ? f.kind : "other" as const }));

/** a one-time link to upload one file for this order */
export async function requestFileUrl(orderId: string, fileName: string): Promise<{ ok: boolean; error?: string; path?: string; token?: string }> {
  try {
    const { admin, cust } = await myDraft(orderId);
    const path = `requests/${cust.id}/${orderId}/${crypto.randomUUID().slice(0, 8)}-${fileName.replace(/[^\w.\-]+/g, "_").slice(-120) || "file"}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Upload isn't available right now." };
    return { ok: true, path, token: data.token };
  } catch (e) { return fail(e); }
}

/** keep their files with the order (once each) */
async function keepFiles(admin: ReturnType<typeof createAdminClient>, orderId: string, files: ReturnType<typeof cleanFiles>) {
  if (!files.length) return;
  const { data: have } = await admin.from("art_files").select("file_path").eq("order_id", orderId);
  const got = new Set((have || []).map((x) => x.file_path as string));
  const rows = files.filter((f) => !got.has(f.path)).map((f) => ({ order_id: orderId, name: f.name, file_path: f.path, file_type: f.type,
    category: f.kind === "po" ? "order_sheet" : f.kind === "art" ? "art" : null, note: f.kind === "po" ? "The customer's PO (uploaded in the portal)" : "Uploaded by the customer in the portal" }));
  if (rows.length) await admin.from("art_files").insert(rows);
}

export type PoRead = { groups: Group[]; nickname?: string; due_date?: string | null; po_number?: string; delivery?: string | null; ship_to?: string; questions: string[];
  /** what we read, for "Does this look right?" */ lines: { group: string; garment: string; color: string; qty: number; sizes: string }[]; pieces: number };

/** Upload a PO: read it and fill in the form; they check it before sending */
export async function readMyPo(orderId: string, files: RqFile[]): Promise<Result & { read?: PoRead }> {
  try {
    const { admin, order, email, cust } = await myDraft(orderId);
    const fs = cleanFiles(files, cust.id, orderId).map((f) => ({ ...f, kind: "po" as const }));
    if (!fs.length) return { ok: false, error: "Upload your PO first." };
    await keepFiles(admin, orderId, fs);
    const st = await aiState(admin);
    if (!st.ready || !st.settings.assistant.ai.customerAssist) return { ok: false, error: "We can't read it automatically right now. Send it to us as is and we'll fill it in." };
    const { count } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("created_by", email).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count || 0) >= 10) return { ok: false, error: "Send it to us as is and we'll fill it in. (You can try reading another PO in an hour.)" };
    const read = await readFiles(admin, fs.map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size })) as never);
    if (!read.images.length && !read.documents.length && !read.listing.some((l) => l.includes("contents:"))) return { ok: false, error: "We couldn't open that file. Send it to us as is and we'll fill it in." };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const r = await orderFromText(st.settings, `${cust.company || cust.name} uploaded their purchase order on our website to fill in this order. Read the files.`, { admin, order_id: orderId, customer_id: order.customer_id, by: email, today, files: read });
    if (!r.ok) return { ok: false, error: "We couldn't read that PO. Send it to us as is and we'll fill it in." };
    const groups = proposalToGroups(r.data).map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, cost: "" as const, priceOverride: null })) }));
    if (!groups.length) return { ok: false, error: "We couldn't find garments and sizes on that PO. Send it to us as is and we'll fill it in." };
    const cur = orderGroups(order);
    const blank = cur.length <= 1 && !cur.some((g) => g.lines.some((l) => l.style || l.color || Object.values(l.sizes || {}).some((v) => +v)) || g.imprints.some((d) => d.design_id) || (g.customerMockups || []).length || g.fromMockup);
    const all = blank ? groups : [...cur, ...groups];
    const d = r.data as typeof r.data & { po_number?: string; delivery?: string | null; ship_to?: string };
    const row: Record<string, unknown> = {};
    if (!order.nickname && d.nickname) row.nickname = d.nickname.slice(0, 120);
    if (!order.due_date && d.due_date && /^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) row.due_date = d.due_date;
    if (!order.po_number && d.po_number) row.po_number = String(d.po_number).slice(0, 60);
    if (d.delivery && ["pickup", "ship", "deliver"].includes(d.delivery) && !(order.ship_to || "").trim()) { row.delivery_method = d.delivery; if (d.ship_to) row.ship_to = String(d.ship_to).slice(0, 500); }
    const qtyOf = (g: Group) => g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0);
    // nothing is saved until they say it looks right (the builder saves it then)
    const lines = groups.flatMap((g) => g.lines.map((l) => ({ group: g.name || "", garment: [l.brand, l.style].filter(Boolean).join(" ") || l.garment || "Garment", color: l.color || "",
      qty: Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), sizes: Object.entries(l.sizes || {}).filter(([, v]) => +v).map(([k, v]) => `${k} ${v}`).join(", ") })));
    void admin;
    return { ok: true, read: { groups: all, nickname: row.nickname as string | undefined, due_date: (row.due_date as string) || null, po_number: (row.po_number as string) || undefined,
      delivery: (row.delivery_method as string) || null, ship_to: (row.ship_to as string) || undefined, questions: (r.data.questions || []).slice(0, 6), lines, pieces: groups.reduce((a, g) => a + qtyOf(g), 0) } };
  } catch (e) { return fail(e); }
}

export type SimpleOrder = { name?: string; about: string; due?: string | null; po?: string; method?: string; qty?: number | null; delivery?: string; ship_to?: string; garments?: string; files: RqFile[] };

/** "Send us a simple order": their answers and files, sent in; we build the order from them */
export async function sendSimpleOrder(orderId: string, s: SimpleOrder): Promise<Result> {
  try {
    const { admin, order: o0, cust, email, supabase } = await myDraft(orderId);
    const about = String(s.about || "").trim().slice(0, 4000);
    const files = cleanFiles(s.files, cust.id, orderId);
    if (about.length < 5 && !files.length && !String(s.name || "").trim()) return { ok: false, error: "Tell us what you need, or upload a file." };
    const method = ["screen", "embroidery", "transfer", "mixed"].includes(String(s.method)) ? String(s.method) : "";
    const delivery = ["pickup", "ship", "deliver"].includes(String(s.delivery)) ? String(s.delivery) : "pickup";
    const shipTo = String(s.ship_to || "").trim().slice(0, 500);
    if (delivery !== "pickup" && !shipTo) return { ok: false, error: `Add the address to ${delivery === "ship" ? "ship" : "deliver"} to.` };
    const due = s.due && /^\d{4}-\d{2}-\d{2}$/.test(s.due) ? s.due : null;
    const qty = Math.max(0, Math.min(1_000_000, Math.round(+(s.qty || 0)))) || null;
    const garments = String(s.garments || "").trim().slice(0, 1000);
    await keepFiles(admin, orderId, files);
    const { error: ue } = await admin.from("orders").update({
      nickname: (String(s.name || "").trim() || o0.nickname || "").slice(0, 120) || null, due_date: due, delivery_method: delivery, ship_to: shipTo, ...(qty ? { qty } : {}),
      ...(String(s.po || "").trim() ? { po_number: String(s.po).trim().slice(0, 60) } : {}),
      simple_order: { about, qty, garments, method, files: files.map((f) => ({ path: f.path, name: f.name, kind: f.kind })), at: new Date().toISOString(), by: email },
    }).eq("id", orderId);
    if (ue) return { ok: false, error: ue.message };
    const { data: num, error: ce } = await supabase.rpc("order_commit", { p_id: orderId });
    if (ce) return { ok: false, error: ce.message };
    const number = Number(num) || o0.number;
    const { error } = await admin.from("orders").update({ submitted_at: new Date().toISOString() }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "request_submitted", detail: `Simple order${qty ? `, about ${qty} pcs` : ""}${files.length ? `, ${files.length} file${files.length === 1 ? "" : "s"}` : ""}`, actor: email });
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const settings = mergeSettings(st?.data);
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `Simple order #${number} from ${cust.company || cust.name}`,
      html: emailLayout(settings.shop.name, `Simple order #${number}`, `${cust.company || cust.name} sent the details instead of filling in the form${qty ? ` (about ${qty} pieces)` : ""}. Build it with Create order on the order page.`, "Open it", `${siteUrl()}/shop/orders/${orderId}`),
    });
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------- Place a reorder (Oct 24, Nick: "place reorder… search and click… update the quantities… pull it into the form") ----------
export type Reorderable = { ref: string; number: string; name: string; when: string; qty: number; from: "portal" | "printavo"; /** a picture of it (the mockup) */ pic?: string; /** where to look at it */ href?: string };

/** their past orders to reorder: ours and their Printavo history, newest first, searched by number or name */
export async function myReorderables(q = ""): Promise<Reorderable[]> {
  try {
    const { supabase, admin, cust } = await me();
    const term = q.trim().replace(/[%,()]/g, " ").slice(0, 60);
    const num = term.replace(/^#/, "");
    let oq = supabase.from("orders").select("id, number, nickname, created_at, qty, status, draft, groups").eq("customer_id", cust.id).not("status", "in", "(request,quote,void)").is("discarded_at", null).order("number", { ascending: false }).limit(25);
    if (term) oq = /^\d+$/.test(num) ? oq.eq("number", +num) : oq.ilike("nickname", `%${term}%`);
    let aq = admin.from("archived_orders").select("id, visual_id, nickname, qty, order_date, files, data").eq("customer_id", cust.id).order("order_date", { ascending: false }).limit(25);
    if (term) aq = /^\d+$/.test(num) ? aq.eq("visual_id", num) : aq.ilike("nickname", `%${term}%`);
    const [{ data: os }, { data: as }] = await Promise.all([oq, aq]);
    // a picture of each (Oct 24, Nick: "for Peticolas you might have like 10 Velvet Hammers… the little thumbnail there so they can view it")
    const picOf = new Map<string, string>();
    for (const o of (os || []) as { id: string; groups: Group[] | null }[]) { const g = (o.groups || [])[0]; const p = g?.mockupThumbs?.[0] || g?.customerMockups?.[0]?.path || ""; if (p) picOf.set(`o:${o.id}`, p); }
    type PvFile = { thumb?: string; full?: string; mime?: string; name?: string };
    for (const r of (as || []) as { id: string; files: Record<string, string> | null; data: { groups?: { imprints?: { mockups?: PvFile[] }[]; lines?: { mockups?: PvFile[] }[] }[] } | null }[]) {
      const f = (r.data?.groups || []).flatMap((g) => [...(g.imprints || []).flatMap((im) => im.mockups || []), ...(g.lines || []).flatMap((l) => l.mockups || [])]).filter((x) => /^image\//.test(x.mime || "") && !/barcode|label/i.test(x.name || ""));
      const hit = f.map((x) => (x.thumb && r.files?.[x.thumb]) || (x.full && r.files?.[x.full]) || "").find((p) => p && !["failed", "too-big"].includes(p));
      if (hit) picOf.set(`a:${r.id}`, hit);
    }
    const paths = [...new Set(picOf.values())];
    const { data: sg } = paths.length ? await admin.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    const url = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""]));
    const a: Reorderable[] = ((os || []) as { id: string; number: number; nickname: string | null; created_at: string; qty: number | null; draft?: boolean }[]).filter((o) => !o.draft)
      .map((o) => ({ ref: `o:${o.id}`, number: String(o.number), name: o.nickname || "", when: String(o.created_at || "").slice(0, 10), qty: o.qty || 0, from: "portal" as const, pic: url.get(picOf.get(`o:${o.id}`) || "") || "", href: `/portal/orders/${o.id}` }));
    const b: Reorderable[] = ((as || []) as { id: string; visual_id: string | number | null; nickname: string | null; qty: number | null; order_date: string | null }[])
      .map((o) => ({ ref: `a:${o.id}`, number: String(o.visual_id || ""), name: o.nickname || "", when: String(o.order_date || "").slice(0, 10), qty: o.qty || 0, from: "printavo" as const, pic: url.get(picOf.get(`a:${o.id}`) || "") || "", href: `/portal/archive/${o.id}` }));
    return [...a, ...b].sort((x, y) => y.when.localeCompare(x.when)).slice(0, 30);
  } catch { return []; }
}

/** pull a past order into this draft: the same garments, sizes and prints, for them to change the quantities */
export async function reorderInto(id: string, ref: string): Promise<Result & { groups?: Group[]; nickname?: string; label?: string }> {
  try {
    const { admin, order, cust, email, supabase } = await myDraft(id);
    let groups: Group[] = [], label = "", nick = "";
    if (ref.startsWith("o:")) {
      const { data: src } = await supabase.from("orders").select("*").eq("id", ref.slice(2)).maybeSingle();
      if (!src || src.customer_id !== cust.id) return { ok: false, error: "We couldn't find that order." };
      groups = orderGroups(src as Order).map((g) => ({
        id: uid(), name: g.name, youth: g.youth, finishing: g.finishing || [],
        lines: g.lines.map((l) => ({ ...l, id: uid(), cost: "" as const, priceOverride: null })),
        imprints: g.imprints.map((d) => ({ ...d, id: uid() })),
        customerMockups: (g.customerMockups || []).filter((m) => m.path.startsWith(`mockups/${cust.id}/`)),
        // the prints are what was printed before: shown, not waiting on a new mockup
        mockupSkipped: true, mockupThumbs: g.mockupThumbs, reprintOf: `#${src.number}`,
      })) as Group[];
      label = `#${src.number}`; nick = src.nickname || "";
    } else if (ref.startsWith("a:")) {
      const { data: r } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data, customer_id").eq("id", ref.slice(2)).eq("customer_id", cust.id).maybeSingle();
      if (!r) return { ok: false, error: "We couldn't find that order." };
      const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      groups = groupsFromPrintavo(r as never, (st?.data as { production?: unknown } | null)?.production).map((g) => ({
        ...g, id: uid(), lines: g.lines.map((l) => ({ ...l, id: uid(), cost: "" as const, priceOverride: null })), imprints: g.imprints.map((d) => ({ ...d, id: uid() })),
        customerMockups: [], mockupSkipped: true, reprintOf: `#${r.visual_id}`,
      })) as Group[];
      label = `#${r.visual_id}`; nick = String(r.nickname || "");
    } else return { ok: false, error: "Pick an order to reorder." };
    if (!groups.length) return { ok: false, error: "That order has no garments to copy. Send it to us as a simple order instead." };
    const cur = orderGroups(order);
    const blank = cur.length <= 1 && !cur.some((g) => g.lines.some((l) => l.style || l.color || Object.values(l.sizes || {}).some((v) => +v)) || g.imprints.some((d) => d.design_id) || (g.customerMockups || []).length || g.fromMockup);
    const all = blank ? groups : [...cur, ...groups];
    const row: Record<string, unknown> = { groups: all, notes: [order.notes || "", `Reorder of ${label}${nick ? ` (${nick})` : ""}.`].filter(Boolean).join("\n").slice(0, 2000) };
    if (!order.nickname) row.nickname = `${nick || `Order ${label}`} (reorder)`.slice(0, 120);
    row.qty = all.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
    const { error } = await admin.from("orders").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: id, kind: "reorder", detail: `From ${label}`, actor: email });
    return { ok: true, groups: all, nickname: (row.nickname as string) || undefined, label };
  } catch (e) { return fail(e); }
}
