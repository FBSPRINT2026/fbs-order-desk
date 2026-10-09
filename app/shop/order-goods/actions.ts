"use server";
import { getViewer } from "@/lib/supabase/server";
import { sizeRank } from "@/lib/sizeOrder";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, orderGroups, type Group, type Order } from "@/lib/pricing";
import { SS_REP, ssConfigured, ssOurCard, ssPlaceOrder, ssSearch, ssSkus } from "@/lib/ss";
import { matchToSS, shopEmails, type GoodsRow } from "@/lib/ssMatch";
import { accountForUser, cfgOf } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";

/**
 * Order goods (Shop Tools): buy blanks from S&S straight through their API, with or without an order — from an email
 * nobody has made an order for yet, for a customer, or to stock up. A dry run first (S&S creates the order and cancels
 * it, so stock, price and warehouses are checked without buying), then staff click to place the real order.
 * The goods order is recorded (blank_orders) and linked to its order now or later.
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

export type StyleColor = { name: string; sizes: { size: string; sku: string; price: number; qty: number }[] };

export async function goodsSearch(q: string) {
  try {
    await staff();
    if (!ssConfigured()) return { ok: false as const, error: "S&S isn't connected (SS_ACCOUNT_NUMBER / SS_API_KEY in Vercel)." };
    if (q.trim().length < 2) return { ok: true as const, hits: [] };
    return { ok: true as const, hits: (await ssSearch(q.trim())).slice(0, 12) };
  } catch (e) { return fail(e); }
}

/** A style's colors, each with its sizes, price and stock. */
export async function goodsStyle(styleID: number) {
  try {
    await staff();
    const info = await ssSkus(styleID);
    if (!info) return { ok: false as const, error: "Style not found at S&S." };
    const by = new Map<string, StyleColor>();
    for (const k of info.skus) {
      const c = by.get(k.colorName) || { name: k.colorName, sizes: [] };
      c.sizes.push({ size: k.size, sku: k.sku, price: k.price, qty: k.qty });
      by.set(k.colorName, c);
    }
    const colors = [...by.values()].map((c) => ({ ...c, sizes: c.sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size)) })).sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true as const, brand: info.brand, style: info.style, colors };
  } catch (e) { return fail(e); }
}

/** Where the goods are for: an email (its customer and the garments the AI read from it), an order, or a customer. */
export async function goodsStart(p: { email?: string; order?: string }) {
  try {
    await staff();
    const admin = createAdminClient();
    const rowsOf = (groups: Group[]) => {
      const rows: GoodsRow[] = [];
      for (const g of groups) for (const l of g.lines || []) for (const [z, q] of Object.entries(l.sizes || {})) {
        const qty = +(q || 0); if (!qty) continue;
        const key = `${l.brand}|${l.style}|${l.color}|${z}`.toLowerCase();
        const have = rows.find((r) => r.key === key);
        if (have) have.qty += qty;
        else rows.push({ key, brand: l.brand || "", style: l.style || "", color: l.color || "", size: z, qty, sku: "", price: 0, stock: 0, found: false, note: "" });
      }
      // garment by garment, each in size order (XS … 4XL), never alphabetical
      return rows.sort((a, b) => `${a.brand}|${a.style}|${a.color}`.localeCompare(`${b.brand}|${b.style}|${b.color}`) || sizeRank(a.size) - sizeRank(b.size));
    };
    if (p.order) {
      const { data: o } = await admin.from("orders").select("id, number, nickname, groups, lines, customer_id, customers(id, company, name)").eq("id", p.order).maybeSingle();
      if (!o) return { ok: false as const, error: "Order not found." };
      const c = (o as unknown as { customers: { id: string; company: string; name: string } | null }).customers;
      const rows = rowsOf(orderGroups(o as unknown as Order));
      if (ssConfigured()) await matchToSS(admin, rows);
      return { ok: true as const, order: { id: o.id as string, number: o.number as number, nickname: (o.nickname as string) || "" }, customer: c ? { id: c.id, name: c.company || c.name } : null, rows, label: `#${o.number} ${c?.company || c?.name || ""}`.trim() };
    }
    if (p.email) {
      const { data: a } = await admin.from("activities").select("id, subject, from_email, customer_id, order_id, meta").eq("id", p.email).maybeSingle();
      if (!a) return { ok: false as const, error: "Email not found." };
      const { data: c } = a.customer_id ? await admin.from("customers").select("id, company, name").eq("id", a.customer_id).maybeSingle() : { data: null };
      // the garments the AI read from the email (Create order's draft), if it has read it
      const { data: sg } = await admin.from("ai_suggestions").select("payload").eq("activity_id", a.id).eq("kind", "draft_order").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const pl = sg?.payload as { draft?: { groups?: Group[] }; groups?: Group[] } | null;
      const rows = rowsOf(pl?.draft?.groups || pl?.groups || []);
      if (rows.length && ssConfigured()) await matchToSS(admin, rows, { fixColors: true });
      return { ok: true as const, email: { id: a.id as string, subject: (a.subject as string) || "", from: (a.from_email as string) || "" }, customer: c ? { id: c.id as string, name: (c.company as string) || (c.name as string) } : null, rows, label: `${c?.company || c?.name || a.from_email} (ahead of order)`, read: !!pl };
    }
    return { ok: true as const, rows: [] as GoodsRow[] };
  } catch (e) { return fail(e); }
}

export async function findOrdersAndCustomers(q: string) {
  try {
    const v = await staff();
    const t = q.trim().replace(/[,()%]/g, "");
    if (t.length < 2) return { ok: true as const, orders: [], customers: [] };
    const num = /^#?\d{3,6}$/.test(t) ? +t.replace("#", "") : null;
    const [{ data: os }, { data: cs }] = await Promise.all([
      num ? v.supabase.from("orders").select("id, number, nickname, customer_id").eq("number", num).limit(3) : v.supabase.from("orders").select("id, number, nickname, customer_id").ilike("nickname", `%${t}%`).order("number", { ascending: false }).limit(6),
      v.supabase.from("customers").select("id, company, name").or(`company.ilike.%${t}%,name.ilike.%${t}%`).limit(6),
    ]);
    return { ok: true as const, orders: (os || []) as { id: string; number: number; nickname: string | null }[], customers: ((cs || []) as { id: string; company: string | null; name: string | null }[]).map((c) => ({ id: c.id, name: c.company || c.name || "" })) };
  } catch (e) { return fail(e); }
}

/**
 * Buy from S&S, shipped to the shop. `test` = dry run (S&S creates and cancels it: nothing is bought). Only a staff
 * click places a real order.
 */
export async function placeGoods(p: { lines: { sku: string; qty: number; label: string }[]; shippingMethod: string; test: boolean; label: string; orderId?: string | null; customerId?: string | null; activityId?: string | null; quote?: string }) {
  try {
    const v = await staff();
    if (!ssConfigured()) return { ok: false as const, error: "S&S isn't connected (SS_ACCOUNT_NUMBER / SS_API_KEY in Vercel)." };
    const lines = p.lines.filter((l) => l.sku && l.qty > 0);
    if (!lines.length) return { ok: false as const, error: "Nothing to order." };
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const from = mergeSettings(st?.data).ship.from;
    if (!from.street1 || !from.zip) return { ok: false as const, error: "Add our street address in Shipping center → Settings first (S&S ships here)." };
    const po = (p.label || "Stock").trim().slice(0, 50);
    // paid with our saved card (ending 5488), never the account's terms
    const card = await ssOurCard(await shopEmails(v.user?.email));
    if (!card.ok) return { ok: false as const, error: card.error };
    const res = await ssPlaceOrder({
      payment: { email: card.profile.email, profileID: card.profile.profileID }, quote: p.quote,
      lines: lines.map((l) => ({ identifier: l.sku, qty: Math.round(l.qty) })), po, test: p.test, shippingMethod: p.shippingMethod || "40",
      shipTo: { customer: from.company || "FBS Print", attn: from.name || "Receiving", address: [from.street1, from.street2].filter(Boolean).join(" "), city: from.city, state: from.state, zip: from.zip },
      email: p.test ? undefined : v.user!.email || undefined,
    });
    const results = res.map((r) => ({ orderNumber: r.orderNumber, warehouse: r.warehouseAbbr, total: r.total, expected: r.expectedDeliveryDate }));
    if (!p.test) {
      const expected = results.map((r) => r.expected).filter(Boolean).sort().pop() || null;
      const row = {
        order_id: p.orderId || null, customer_id: p.customerId || null, activity_id: p.activityId || null, label: po,
        supplier: "ss", supplier_order: results.map((r) => r.orderNumber).join(", "), po, status: "ordered", placed_via: "api",
        lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, label: l.label })), total: results.reduce((a, r) => a + r.total, 0) || null,
        expected_date: expected ? expected.slice(0, 10) : null, created_by: v.user!.email || "staff", note: p.quote?.trim() ? `S&S quote ${p.quote.trim()}` : "",
      };
      const { error } = await admin.from("blank_orders").insert(row);
      // bought already: say so plainly if it couldn't be recorded (the migration isn't run yet)
      if (error) return { ok: true as const, results, warn: `Ordered with S&S (${row.supplier_order}), but it couldn't be saved here: ${/order_id|customer_id|activity_id|label/.test(error.message) ? "run supabase/migrations/117_goods_orders_without_order.sql in Supabase" : error.message}.` };
      if (p.orderId) await admin.from("orders").update({ status: "blanks" }).eq("id", p.orderId).in("status", ["approved", "art"]);
    }
    return { ok: true as const, results };
  } catch (e) { return fail(e); }
}

/** Goods ordered here lately, newest first (with their order once linked). */
export async function recentGoods() {
  try {
    await staff();
    const admin = createAdminClient();
    const { data, error } = await admin.from("blank_orders").select("id, order_id, customer_id, activity_id, label, supplier_order, status, total, expected_date, lines, created_by, created_at").eq("placed_via", "api").order("created_at", { ascending: false }).limit(25);
    if (error) return { ok: false as const, error: /column/.test(error.message) ? "Run supabase/migrations/117_goods_orders_without_order.sql in Supabase to turn on Order goods." : error.message };
    const ids = [...new Set((data || []).map((b) => b.order_id).filter(Boolean))] as string[];
    const { data: os } = ids.length ? await admin.from("orders").select("id, number").in("id", ids) : { data: [] as { id: string; number: number }[] };
    const num = new Map((os || []).map((o) => [o.id, o.number]));
    return { ok: true as const, list: (data || []).map((b) => ({ ...b, number: b.order_id ? num.get(b.order_id) || null : null })) };
  } catch (e) { return fail(e); }
}

/** Link goods bought ahead to their order once it exists. */
export async function linkGoods(goodsId: string, orderId: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { error } = await admin.from("blank_orders").update({ order_id: orderId }).eq("id", goodsId);
    if (error) return { ok: false as const, error: error.message };
    await admin.from("orders").update({ status: "blanks" }).eq("id", orderId).in("status", ["approved", "art"]);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** How S&S orders are paid and shipped, to show before ordering: our saved card, closest warehouse first. */
export async function goodsPayInfo() {
  try {
    const v = await staff();
    if (!ssConfigured()) return { ok: false as const, error: "S&S isn't connected." };
    const c = await ssOurCard(await shopEmails(v.user?.email));
    return c.ok ? { ok: true as const, card: c.profile.label } : { ok: false as const, error: c.error };
  } catch (e) { return fail(e); }
}

/** our S&S rep (for the page: who a quote request goes to) */
export async function goodsRep() { return { ...SS_REP }; }

/**
 * Ask our S&S rep (Tiffany Clark) for a custom quote on these goods: an email from your own mailbox with the list.
 * She replies with a quote number; put it in "S&S quote #" and the order is priced against it.
 */
export async function askRepForQuote(p: { subject: string; body: string }) {
  try {
    const v = await staff();
    if (!p.body.trim()) return { ok: false as const, error: "Write the email first." };
    const admin = createAdminClient();
    const from = await accountForUser(admin, v.user!.id);
    if (!from?.enabled) return { ok: false as const, error: "Connect your email in the Inbox first, so the request goes out from your address." };
    const signature = from.signature_on !== false ? from.signature_html || "" : "";
    const page = replyHtml({ body: p.body, signature, css: signature ? from.signature_css : "" });
    const { html, attachments } = inlineImages(page);
    const subject = (p.subject || "Quote request").slice(0, 200);
    const { messageId } = await sendFromMailbox(cfgOf(from), { to: SS_REP.email, subject, text: replyText({ body: p.body, signature }), html, attachments });
    await admin.from("activities").insert({
      customer_id: null, kind: "email", direction: "out", subject, body: p.body.trim(), from_email: from.email, to_email: SS_REP.email, external_id: messageId,
      occurred_at: new Date().toISOString(), created_by: v.user!.email || "staff", ai_processed_at: new Date().toISOString(), meta: { mailbox: "sent", via: "portal", account_id: from.id, account: from.email, goods_quote: true },
    }).then(() => null, () => null);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
