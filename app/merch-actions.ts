"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  autoClose, blanksNeeded, defaultUpcharges, emailShoppers, loadOrders, makeProductionJob, merchAccess, stepMessage, storeFor, suggestBasePrice, uniqueSlug, withEvent,
  type MerchAccess,
} from "@/lib/merchServer";
import { DEFAULT_FIELDS, r2, type Field, type MerchOrder, type Product, type Store, type StoreStatus } from "@/lib/merch";
import type { Garment } from "@/lib/pricing";

type R<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ list + create */

export type StoreRow = Store & { customer: string; orders: number; pcs: number; sales: number; giveback: number };

export async function listStores(): Promise<R<{ stores: StoreRow[]; staff: boolean; customers: { id: string; name: string }[] }>> {
  try {
    const a = await merchAccess();
    let q = a.admin.from("merch_stores").select("*").neq("status", "archived").order("created_at", { ascending: false }).limit(500);
    if (!a.staff) q = q.in("customer_id", a.customerIds);
    const { data } = await q;
    const stores = await autoClose(a.admin, (data || []) as Store[]);
    const ids = stores.map((s) => s.id);
    const { data: os } = ids.length ? await a.admin.from("merch_orders").select("id, store_id, total, giveback, status").in("store_id", ids) : { data: [] };
    const live = ((os || []) as { id: string; store_id: string; total: number; giveback: number; status: string }[]).filter((o) => !["cancelled", "refunded", "pending"].includes(o.status));
    const { data: its } = live.length ? await a.admin.from("merch_order_items").select("order_id, qty").in("order_id", live.map((o) => o.id)) : { data: [] };
    const pcsBy = new Map<string, number>();
    for (const it of (its || []) as { order_id: string; qty: number }[]) pcsBy.set(it.order_id, (pcsBy.get(it.order_id) || 0) + it.qty);
    const custIds = [...new Set(stores.map((s) => s.customer_id).filter(Boolean))] as string[];
    const { data: cs } = custIds.length ? await a.admin.from("customers").select("id, company, name").in("id", custIds) : { data: [] };
    const cname = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name]));
    const rows: StoreRow[] = stores.map((s) => {
      const mine = live.filter((o) => o.store_id === s.id);
      return { ...s, customer: cname.get(s.customer_id || "") || "", orders: mine.length, pcs: mine.reduce((x, o) => x + (pcsBy.get(o.id) || 0), 0), sales: r2(mine.reduce((x, o) => x + +o.total, 0)), giveback: r2(mine.reduce((x, o) => x + +o.giveback, 0)) };
    });
    let customers: { id: string; name: string }[] = [];
    if (a.staff) {
      const { data: all } = await a.admin.from("customers").select("id, company, name").order("company").limit(5000);
      customers = ((all || []) as { id: string; company: string; name: string }[]).map((c) => ({ id: c.id, name: c.company || c.name })).filter((c) => c.name);
    } else {
      const { data: mine } = await a.admin.from("customers").select("id, company, name").in("id", a.customerIds);
      customers = ((mine || []) as { id: string; company: string; name: string }[]).map((c) => ({ id: c.id, name: c.company || c.name }));
    }
    return { ok: true, data: { stores: rows, staff: a.staff, customers } };
  } catch (e) { return fail(e); }
}

/** a new store (or a copy of an old one: its look, questions and products, with new dates) */
export async function createStore(input: { customer_id: string | null; name: string; copyFrom?: string }): Promise<R<{ id: string }>> {
  try {
    const a = await merchAccess();
    const name = String(input.name || "").trim().slice(0, 100);
    if (!name) return { ok: false, error: "Give the store a name." };
    if (!a.staff && !a.customerIds.includes(input.customer_id || "")) return { ok: false, error: "Pick your organization." };
    let base: Partial<Store> = {};
    let copyProducts: Product[] = [];
    if (input.copyFrom) {
      const src = await storeFor(a, input.copyFrom);
      base = { brand: src.brand, welcome: src.welcome, delivery: src.delivery, fields: src.fields, giveback: src.giveback, tax_rate: src.tax_rate, tax_exempt: src.tax_exempt, contact: src.contact, settings: src.settings };
      const { data: ps } = await a.admin.from("merch_products").select("*").eq("store_id", src.id).eq("active", true).order("position");
      copyProducts = (ps || []) as Product[];
    }
    // a customer's own store: their info as the contact, and the school name on the banner
    if (input.customer_id && !base.contact) {
      const { data: c } = await a.admin.from("customers").select("company, name, email, phone, tax_exempt").eq("id", input.customer_id).maybeSingle();
      if (c) { base.contact = { name: c.name || "", email: c.email || "", phone: c.phone || "" }; base.brand = { school: c.company || "" }; base.tax_exempt = false; }
    }
    const slug = await uniqueSlug(a.admin, name);
    const { data, error } = await a.admin.from("merch_stores").insert({
      ...base, customer_id: input.customer_id || null, name, slug, status: "draft", owner: a.staff ? "staff" : "customer", created_by: a.email,
      fields: base.fields || DEFAULT_FIELDS, timeline: [{ status: "draft", at: now(), by: a.email, note: input.copyFrom ? "copied from an earlier store" : "created" }],
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    if (copyProducts.length) await a.admin.from("merch_products").insert(copyProducts.map(({ id: _i, store_id: _s, ...p }) => ({ ...p, store_id: data.id })));
    return { ok: true, data: { id: data.id } };
  } catch (e) { return fail(e); }
}

/* ------------------------------------------------------------------ one store */

export type StoreBundle = { store: Store; products: Product[]; orders: MerchOrder[]; staff: boolean; customer: { id: string; name: string } | null; upcharges: Record<string, number>; selfLaunch: boolean; job: { id: string; number: number; status: string } | null };

export async function getStore(id: string): Promise<R<StoreBundle>> {
  try {
    const a = await merchAccess();
    const [st] = await autoClose(a.admin, [await storeFor(a, id)]);
    const [{ data: ps }, orders, { data: c }, { data: s }, { data: job }] = await Promise.all([
      a.admin.from("merch_products").select("*").eq("store_id", id).order("position"),
      loadOrders(a.admin, id),
      st.customer_id ? a.admin.from("customers").select("id, company, name").eq("id", st.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      a.admin.from("settings").select("data").eq("id", 1).maybeSingle(),
      st.order_id ? a.admin.from("orders").select("id, number, status").eq("id", st.order_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // customers see FBS's price (their floor) but never blank costs
    const products = ((ps || []) as Product[]).map((p) => (a.staff ? p : { ...p, cost: {} }));
    return { ok: true, data: { store: st, products, orders, staff: a.staff, customer: c ? { id: c.id, name: c.company || c.name } : null, upcharges: a.settings.upcharges as Record<string, number>, selfLaunch: !!(s?.data as { merch?: { selfLaunch?: boolean } } | null)?.merch?.selfLaunch, job: (job as StoreBundle["job"]) || null } };
  } catch (e) { return fail(e); }
}

/** the parts of a store a customer may set themselves (FBS sets tax, the delivery date and the status) */
const CUSTOMER_FIELDS = ["name", "brand", "welcome", "fields", "opens_at", "closes_at", "contact", "giveback", "password", "delivery"] as const;
const STAFF_FIELDS = [...CUSTOMER_FIELDS, "deliver_by", "tax_rate", "tax_exempt", "notes", "slug", "customer_id", "settings"] as const;

export async function saveStore(id: string, patch: Partial<Store>): Promise<R<Store>> {
  try {
    const a = await merchAccess();
    const st = await storeFor(a, id);
    const allowed = a.staff ? STAFF_FIELDS : CUSTOMER_FIELDS;
    const up: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) up[k] = (patch as Record<string, unknown>)[k];
    if (typeof up.name === "string") { up.name = up.name.trim().slice(0, 100); if (!up.name) return { ok: false, error: "The store needs a name." }; }
    if (typeof up.slug === "string") up.slug = await uniqueSlug(a.admin, up.slug, id);
    if (up.fields) up.fields = (up.fields as Field[]).filter((f) => f.label.trim()).map((f, i) => ({ key: f.key || `q${i}`, label: f.label.trim().slice(0, 60), kind: f.kind === "select" ? "select" : "text", options: (f.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 200), required: !!f.required, sort: Number.isFinite(+f.sort) ? +f.sort : -1 }));
    if (!a.staff && st.status !== "draft" && st.status !== "review") {
      // once it's open, a customer can only change the look and the close date
      for (const k of ["fields", "delivery", "opens_at"]) delete up[k];
    }
    const { data, error } = await a.admin.from("merch_stores").update({ ...up, updated_at: now() }).eq("id", id).select("*").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as Store };
  } catch (e) { return fail(e); }
}

/**
 * Move a store along: open it, close it, goods ordered, in production, packing, ready, delivered.
 * Customers can send a draft for FBS to check (or open it themselves when Settings allow it).
 * With "email shoppers" on, each step tells every shopper where their order is.
 */
export async function setStoreStatus(id: string, status: StoreStatus, opts: { notify?: boolean; note?: string } = {}): Promise<R<{ store: Store; emailed: number }>> {
  try {
    const a = await merchAccess();
    const st = await storeFor(a, id);
    if (!a.staff) {
      const { data: s } = await a.admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const self = !!(s?.data as { merch?: { selfLaunch?: boolean } } | null)?.merch?.selfLaunch;
      const ok = (st.status === "draft" && (status === "review" || (self && status === "open"))) || (st.status === "review" && status === "draft") || (st.status === "open" && status === "closed");
      if (!ok) return { ok: false, error: "FBS Print takes it from here." };
    }
    if (status === "open") {
      const { count } = await a.admin.from("merch_products").select("id", { count: "exact", head: true }).eq("store_id", id).eq("active", true);
      if (!count) return { ok: false, error: "Add at least one product before opening the store." };
      if (!st.closes_at) return { ok: false, error: "Set when the store closes first (shoppers need to know it's a pre-order)." };
    }
    const patch: Record<string, unknown> = { status, timeline: withEvent(st, status, a.email, opts.note || ""), updated_at: now() };
    if (status === "ordered" && !st.goods_ordered_at) patch.goods_ordered_at = now();
    if (status === "open" && st.closes_at && Date.parse(st.closes_at) <= Date.now()) return { ok: false, error: "The close date has passed: move it later first." };
    const { data, error } = await a.admin.from("merch_stores").update(patch).eq("id", id).select("*").single();
    if (error) return { ok: false, error: error.message };
    let emailed = 0;
    const msg = stepMessage(data as Store, status);
    if (msg && opts.notify !== false && (st.settings?.notify ?? true)) emailed = await emailShoppers(data as Store, await loadOrders(a.admin, id), msg.heading, msg.text);
    return { ok: true, data: { store: data as Store, emailed } };
  } catch (e) { return fail(e); }
}

/* ------------------------------------------------------------------ products */

/**
 * Save a product. FBS's price: staff set it (a suggestion comes from our pricing); for a customer-built store it's always
 * worked out here from the blank and the print, and the customer only adds their give-back on top.
 */
export async function saveProduct(storeId: string, p: Partial<Product> & { id?: string }): Promise<R<Product>> {
  try {
    const a = await merchAccess();
    const st = await storeFor(a, storeId);
    const name = String(p.name || "").trim().slice(0, 100);
    if (!name) return { ok: false, error: "Name the product." };
    const row: Record<string, unknown> = {
      name, description: String(p.description || "").slice(0, 2000), design_id: p.design_id || null, imprint: p.imprint || {},
      supplier: p.supplier || "", style: String(p.style || "").slice(0, 40), brand: String(p.brand || "").slice(0, 60), garment_id: p.garment_id || null,
      colors: (p.colors || []).slice(0, 30), sizes: (p.sizes || []).slice(0, 20), giveback: Math.max(0, r2(+(p.giveback || 0))),
      upcharges: p.upcharges || {}, personalize: (p.personalize || []).slice(0, 3), active: p.active ?? true, updated_at: now(),
    };
    if (a.staff) {
      row.base_price = Math.max(0, r2(+(p.base_price || 0)));
      if (p.cost) row.cost = p.cost;
    } else {
      // the floor comes from our pricing, never from the browser
      const g = p.garment_id ? ((await a.admin.from("garments").select("*").eq("id", p.garment_id).maybeSingle()).data as Garment | null) : null;
      if (!g) return { ok: false, error: "Pick the shirt from the catalog." };
      const size = (row.sizes as string[]).find((z) => z === "M") || (row.sizes as string[])[0] || "M";
      const cost = +(g.size_costs?.[size] || g.cost || 0);
      row.cost = g.size_costs || {};
      row.base_price = suggestBasePrice(a.settings, { cost, color: (row.colors as Product["colors"])[0]?.name || "White", method: (p.imprint?.method as string) || "screen", colors: p.imprint?.colors || 1, expected: st.settings?.expected || 48 });
      row.upcharges = defaultUpcharges(a.settings, row.sizes as string[]);
    }
    if (p.id) {
      const { data: cur } = await a.admin.from("merch_products").select("store_id").eq("id", p.id).maybeSingle();
      if (!cur || cur.store_id !== storeId) return { ok: false, error: "That product isn't in this store." };
      const { data, error } = await a.admin.from("merch_products").update(row).eq("id", p.id).select("*").single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (a.staff ? data : { ...data, cost: {} }) as Product };
    }
    const { count } = await a.admin.from("merch_products").select("id", { count: "exact", head: true }).eq("store_id", storeId);
    const { data, error } = await a.admin.from("merch_products").insert({ ...row, store_id: storeId, position: count || 0 }).select("*").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (a.staff ? data : { ...data, cost: {} }) as Product };
  } catch (e) { return fail(e); }
}

/** FBS's suggested price for a blank + print (the store builder shows it while picking) */
export async function suggestPrice(storeId: string, o: { garment_id: string; size?: string; color: string; method?: string; colors?: number; locations?: number }): Promise<R<{ base: number; upcharges: Record<string, number>; cost: Record<string, number> }>> {
  try {
    const a = await merchAccess();
    const st = await storeFor(a, storeId);
    const { data: g } = await a.admin.from("garments").select("*").eq("id", o.garment_id).maybeSingle();
    if (!g) return { ok: false, error: "That shirt isn't in the catalog." };
    const gg = g as Garment;
    const cost = +(gg.size_costs?.[o.size || "M"] || gg.cost || 0);
    const base = suggestBasePrice(a.settings, { cost, color: o.color, method: o.method, colors: o.colors, locations: o.locations, expected: st.settings?.expected || 48 });
    return { ok: true, data: { base, upcharges: defaultUpcharges(a.settings, gg.sizes || []), cost: a.staff ? gg.size_costs || {} : {} } };
  } catch (e) { return fail(e); }
}

/** products are never deleted: hidden from the store (and shown again) */
export async function setProductActive(storeId: string, productId: string, active: boolean): Promise<R> {
  try {
    const a = await merchAccess(); await storeFor(a, storeId);
    const { error } = await a.admin.from("merch_products").update({ active, updated_at: now() }).eq("id", productId).eq("store_id", storeId);
    return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function reorderProducts(storeId: string, ids: string[]): Promise<R> {
  try {
    const a = await merchAccess(); await storeFor(a, storeId);
    await Promise.all(ids.map((id, i) => a.admin.from("merch_products").update({ position: i }).eq("id", id).eq("store_id", storeId)));
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** a picture for the store (banner, logo, mockup): saved under stores/<id>/ and served by /api/store-img */
export async function uploadStoreImage(form: FormData): Promise<R<{ path: string }>> {
  try {
    const a = await merchAccess();
    const storeId = String(form.get("store") || "");
    await storeFor(a, storeId);
    const f = form.get("file");
    if (!(f instanceof File)) return { ok: false, error: "Choose a picture." };
    if (f.size > 12 * 1024 * 1024) return { ok: false, error: "That picture is too big (12 MB max)." };
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(f.type)) return { ok: false, error: "Use a PNG, JPG, WEBP or SVG picture." };
    const ext = f.type === "image/svg+xml" ? "svg" : f.type.split("/")[1].replace("jpeg", "jpg");
    const path = `stores/${storeId}/${String(form.get("kind") || "img").replace(/\W/g, "")}-${crypto.randomUUID().slice(0, 12)}.${ext}`;
    const { error } = await a.admin.storage.from("proofs").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type });
    return error ? { ok: false, error: error.message } : { ok: true, data: { path } };
  } catch (e) { return fail(e); }
}

/** the customer's designs (for picking art), with preview links */
export async function storeDesigns(storeId: string): Promise<R<{ id: string; number: number; name: string; url: string; width_px: number | null; height_px: number | null; colors: number; inks: string }[]>> {
  try {
    const a = await merchAccess();
    const st = await storeFor(a, storeId);
    let q = a.admin.from("designs").select("id, number, name, preview_path, width_px, height_px, colors, inks, starred, customer_id, archived_at").is("archived_at", null).order("starred", { ascending: false }).order("created_at", { ascending: false }).limit(200);
    q = st.customer_id ? q.eq("customer_id", st.customer_id) : q;
    const { data } = await q;
    const ds = (data || []) as { id: string; number: number; name: string; preview_path: string; width_px: number | null; height_px: number | null; colors: number; inks: string }[];
    const withPv = ds.filter((d) => d.preview_path);
    const { data: urls } = withPv.length ? await a.admin.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600 * 6) : { data: [] };
    const url = new Map(withPv.map((d, i) => [d.id, (urls || [])[i]?.signedUrl || ""]));
    return { ok: true, data: ds.map((d) => ({ id: d.id, number: d.number, name: d.name, url: url.get(d.id) || "", width_px: d.width_px, height_px: d.height_px, colors: d.colors, inks: d.inks })) };
  } catch (e) { return fail(e); }
}

/* ------------------------------------------------------------------ orders, packing, close-out (staff) */

async function staffOnly(): Promise<MerchAccess> {
  const a = await merchAccess();
  if (!a.staff) throw new Error("Staff only.");
  return a;
}

/** pack one item: '' (to pack), 'packed', or 'backorder' */
export async function setItemPack(itemId: string, pack: "" | "packed" | "backorder"): Promise<R> {
  try {
    const a = await staffOnly();
    const { error } = await a.admin.from("merch_order_items").update({ pack }).eq("id", itemId);
    return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** an order's status (packed, delivered, picked up, shipped, cancelled); packing everything marks every item packed */
export async function setOrderStatus(orderId: string, status: MerchOrder["status"], extra: { tracking?: string; note?: string } = {}): Promise<R<MerchOrder>> {
  try {
    const a = await staffOnly();
    const { data: o } = await a.admin.from("merch_orders").select("*").eq("id", orderId).single();
    const patch: Record<string, unknown> = { status, updated_at: now(), changes: [...((o?.changes as MerchOrder["changes"]) || []), { at: now(), by: a.email, what: `status → ${status}${extra.note ? ` (${extra.note})` : ""}` }] };
    if (status === "packed") { patch.packed_at = now(); patch.packed_by = a.email; await a.admin.from("merch_order_items").update({ pack: "packed" }).eq("order_id", orderId).eq("pack", ""); }
    if (status === "paid") { patch.packed_at = null; patch.packed_by = ""; }
    if (extra.tracking !== undefined) patch.tracking = String(extra.tracking).trim().slice(0, 60);
    const { data, error } = await a.admin.from("merch_orders").update(patch).eq("id", orderId).select("*").single();
    return error ? { ok: false, error: error.message } : { ok: true, data: data as MerchOrder };
  } catch (e) { return fail(e); }
}

/** staff fix a shopper's answers or note on an order */
export async function editOrder(orderId: string, patch: { answers?: Record<string, string>; note?: string }): Promise<R<MerchOrder>> {
  try {
    const a = await staffOnly();
    const { data: o } = await a.admin.from("merch_orders").select("*").eq("id", orderId).single();
    const up: Record<string, unknown> = { updated_at: now() };
    if (patch.answers) { up.answers = patch.answers; up.changes = [...((o?.changes as MerchOrder["changes"]) || []), { at: now(), by: a.email, what: "answers edited by staff" }]; }
    if (patch.note !== undefined) up.note = String(patch.note).slice(0, 2000);
    const { data, error } = await a.admin.from("merch_orders").update(up).eq("id", orderId).select("*").single();
    return error ? { ok: false, error: error.message } : { ok: true, data: data as MerchOrder };
  } catch (e) { return fail(e); }
}

/** make the production job for a closed store (one job in Orders with every blank, color and size) */
export async function makeJob(storeId: string): Promise<R<{ orderId: string }>> {
  try {
    const a = await staffOnly();
    const st = await storeFor(a, storeId);
    if (st.status === "open" || st.status === "draft" || st.status === "review") return { ok: false, error: "Close the store first." };
    return { ok: true, data: { orderId: await makeProductionJob(a, st) } };
  } catch (e) { return fail(e); }
}

/** the blank totals (for the order sheet / CSV) */
export async function storeBlanks(storeId: string): Promise<R<ReturnType<typeof blanksNeeded>>> {
  try {
    const a = await staffOnly();
    await storeFor(a, storeId);
    const [{ data: ps }, orders] = await Promise.all([a.admin.from("merch_products").select("*").eq("store_id", storeId), loadOrders(a.admin, storeId)]);
    return { ok: true, data: blanksNeeded((ps || []) as Product[], orders) };
  } catch (e) { return fail(e); }
}

/** turn on (or off) a customer's merch-store builder in their portal */
export async function setMerchClient(customerId: string, on: boolean): Promise<R> {
  try {
    const a = await staffOnly();
    const { error } = await createAdminClient().from("customers").update({ merch_client: on }).eq("id", customerId);
    void a;
    return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}
