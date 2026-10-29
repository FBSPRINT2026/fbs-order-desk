"use server";
import { getViewer } from "@/lib/supabase/server";
import { sizeRank } from "@/lib/sizeOrder";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, orderGroups, uid, type Group, type Order } from "@/lib/pricing";
import { SS_REP, ssAllocate, ssConfigured, ssOurCard, ssPlaceOrder, ssSearch, ssSkus, ssStock } from "@/lib/ss";
import { SANMAR_BUFFER, sanmarConfigured, sanmarInventory, sanmarPOMode, sanmarPOWhse, sanmarPreSubmit, sanmarSkus, sanmarStockKey, sanmarSubmitPO, type SanMarPOLine } from "@/lib/sanmar";
import { SM_WH, type Src } from "@/lib/goodsPlan";
import { cleanGoodsPo, customerShort, defaultGoodsPo, typedShort } from "@/lib/goodsPo";
import { carries, supplierBrands } from "@/lib/supplierBrands";
import { osConfigured, osOrder, osOrdersLive, osPrices, osStyle } from "@/lib/onestop";
import { OS_FREE_AT, paidShipBlock } from "@/lib/goodsShip";
// a SanMar warehouse by its number, else by its city (PromoStandards may name it instead)
/** the short names the shop typed for customers' goods POs (lib/goodsPo.ts): read for the default, kept when a typed
 *  one differs from ours (Oct 29, Nick: "Dear Heart Designs could be DHD… then I can type over it") */
async function learnedShort(admin: ReturnType<typeof createAdminClient>, customerId?: string | null) {
  if (!customerId) return "";
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return String(((data?.data || {}) as { goodsShort?: Record<string, string> }).goodsShort?.[customerId] || "");
}
async function keepShort(admin: ReturnType<typeof createAdminClient>, customerId: string | null | undefined, po: string) {
  const t = typedShort(po); if (!customerId || !t) return;
  const { data: c } = await admin.from("customers").select("company, name").eq("id", customerId).maybeSingle();
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as { goodsShort?: Record<string, string> };
  const have = d.goodsShort?.[customerId] || customerShort(String(c?.company || c?.name || ""));
  if (t === have || /^stock$/i.test(t)) return;
  await admin.from("settings").update({ data: { ...d, goodsShort: { ...(d.goodsShort || {}), [customerId]: t } } }).eq("id", 1);
}
const smWh = (id: string, name: string) => (SM_WH[id] ? id : Object.entries(SM_WH).find(([, v]) => name && new RegExp(v[1], "i").test(name))?.[0] || id);
import { matchToSS, checkOnly, placeWithLogin, shopEmails, ssPayEmail, type GoodsRow } from "@/lib/ssMatch";
import { accountForUser, cfgOf } from "@/lib/mail/config";
import { goodsPcs, goodsSizes, type GoodsGarment } from "@/lib/goodsGarments";
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
/**
 * The Order goods panel (Oct 26, Nick: "the right side… pop-up just like you do with create an order"): the garments it
 * read from the email, after staff said which blank and which colors, as S&S lines (sku, stock, price) by size.
 */
export async function goodsFromGroups(groups: Group[]) {
  try {
    await staff();
    const rows: GoodsRow[] = [];
    for (const g of groups || []) for (const l of g.lines || []) for (const [z, q] of Object.entries(l.sizes || {})) {
      const qty = +(q || 0); if (!qty || !String(l.style || "").trim()) continue;
      const key = `${l.brand}|${l.style}|${l.color}|${z}`.toLowerCase();
      const have = rows.find((r) => r.key === key);
      if (have) have.qty += qty;
      else rows.push({ key, brand: l.brand || "", style: l.style || "", color: l.color || "", size: z, qty, sku: "", price: 0, stock: 0, found: false, note: "" });
    }
    rows.sort((a, b) => `${a.brand}|${a.style}|${a.color}`.localeCompare(`${b.brand}|${b.style}|${b.color}`) || sizeRank(a.size) - sizeRank(b.size));
    if (rows.length && ssConfigured()) await matchToSS(createAdminClient(), rows);
    return { ok: true as const, rows, ss: ssConfigured() };
  } catch (e) { return fail(e); }
}

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
      const { data: o } = await admin.from("orders").select("id, number, nickname, groups, lines, customer_id, due_date, production_date, customers(id, company, name)").eq("id", p.order).maybeSingle();
      if (!o) return { ok: false as const, error: "Order not found." };
      const c = (o as unknown as { customers: { id: string; company: string; name: string } | null }).customers;
      const rows = rowsOf(orderGroups(o as unknown as Order));
      if (ssConfigured()) await matchToSS(admin, rows);
      // when the goods have to be here (Oct 27, Nick: Order goods goes by the day they arrive): the day before production,
      // else the in-hands date less the goods lead days (Settings → Shipping)
      const prod = (o as { production_date?: string | null }).production_date || null, due = (o as { due_date?: string | null }).due_date || null;
      let needBy: string | null = null;
      if (prod || due) {
        const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
        const lead = prod ? 1 : Math.max(1, +(mergeSettings(st?.data).ship.goodsLeadDays || 3));
        const d = new Date((prod || due)!.slice(0, 10) + "T12:00");
        let n = lead; while (n > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
        needBy = d.toISOString().slice(0, 10);
      }
      return { ok: true as const, needBy, production: prod, due, order: { id: o.id as string, number: o.number as number, nickname: (o.nickname as string) || "" }, customer: c ? { id: c.id, name: c.company || c.name } : null, rows, label: `#${o.number} ${c?.company || c?.name || ""}`.trim(), po: defaultGoodsPo({ orderNo: o.number as number, customer: c?.company || c?.name, short: await learnedShort(admin, c?.id as string | undefined) }) };
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
      return { ok: true as const, email: { id: a.id as string, subject: (a.subject as string) || "", from: (a.from_email as string) || "" }, customer: c ? { id: c.id as string, name: (c.company as string) || (c.name as string) } : null, rows, label: `${c?.company || c?.name || a.from_email} (ahead of order)`, po: defaultGoodsPo({ customer: c?.company || c?.name || a.from_email, short: await learnedShort(admin, c?.id as string | undefined) }), read: !!pl };
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
export async function placeGoods(p: { lines: { sku: string; qty: number; label: string; price?: number }[]; shippingMethod: string; test: boolean; /** said yes to paying for shipping (lib/goodsShip.ts) */ paidShipOk?: boolean; warehouses?: "fewest" | "fastest"; label: string; /** the PO name typed on Order goods (lib/goodsPo.ts) */ po?: string; orderId?: string | null; customerId?: string | null; activityId?: string | null; quote?: string; garments?: GoodsGarment[];
  /** each sku's warehouse picked by Order goods' plan (lib/goodsPlan.ts); without it the closest that has it */ from?: { sku: string; qty: number; warehouse: string }[] }) {
  try {
    const v = await staff();
    if (!ssConfigured()) return { ok: false as const, error: "S&S isn't connected (SS_ACCOUNT_NUMBER / SS_API_KEY in Vercel)." };
    const lines = p.lines.filter((l) => l.sku && l.qty > 0);
    if (!lines.length) return { ok: false as const, error: "Nothing to order." };
    const paidNo = paidShipBlock("ss", p.shippingMethod, p.test, p.paidShipOk);
    if (paidNo) return { ok: false as const, error: paidNo };
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const from = mergeSettings(st?.data).ship.from;
    if (!from.street1 || !from.zip) return { ok: false as const, error: "Add our street address in Shipping center → Settings first (S&S ships here)." };
    const po = cleanGoodsPo(p.po || "") || defaultGoodsPo({ customer: p.label });
    // paid with our saved card (ending 5488), never the account's terms
    // each line from the closest warehouse that has it (Fort Worth first)
    const picked = (p.from || []).filter((f) => f.sku && f.qty > 0 && f.warehouse && lines.some((l) => l.sku === f.sku));
    const alloc = picked.length ? { lines: picked.map((f) => ({ identifier: f.sku, qty: Math.round(f.qty), warehouseAbbr: f.warehouse })), short: [] as string[] }
      : await ssAllocate(lines.map((l) => ({ identifier: l.sku, qty: Math.round(l.qty) })), p.warehouses === "fastest" ? "fastest" : "fewest");
    if (alloc.short.length) return { ok: false as const, error: `S&S doesn't have enough of: ${alloc.short.join("; ")}.` };
    const card = await ssOurCard(await shopEmails(v.user?.email));
    if (!card.ok) return { ok: false as const, error: card.error };
    // the S&S website login the card belongs to: the one a dry run proved, else each likely email until S&S takes one
    // the dry run stops here: checked in the portal, nothing sent to S&S's ordering
    if (p.test) return { ok: true as const, results: checkOnly(alloc, (sku) => lines.find((l) => l.sku === sku)?.price || 0), card: card.profile.label, from: alloc.lines.map((l) => ({ sku: l.identifier, qty: l.qty, warehouse: l.warehouseAbbr })) };
    const payEmail = await ssPayEmail(admin, card.profile.email, v.user?.email, p.test);
    if (!payEmail.ok) return { ok: false as const, error: payEmail.error };
    const res = await placeWithLogin(payEmail.emails, (email) => ssPlaceOrder({
      payment: { email, profileID: card.profile.profileID }, quote: p.quote,
      lines: alloc.lines, po, test: p.test, shippingMethod: p.shippingMethod || "40",
      shipTo: { customer: from.company || "FBS Print", attn: from.name || "Receiving", address: [from.street1, from.street2].filter(Boolean).join(" "), city: from.city, state: from.state, zip: from.zip },
      email: p.test ? undefined : v.user!.email || undefined,
    }), admin, p.test);
    const results = res.map((r) => ({ orderNumber: r.orderNumber, warehouse: r.warehouseAbbr, total: r.total, expected: r.expectedDeliveryDate }));
    if (!p.test) await keepShort(admin, p.customerId, po).catch(() => null);
    if (!p.test) {
      const expected = results.map((r) => r.expected).filter(Boolean).sort().pop() || null;
      const row = {
        order_id: p.orderId || null, customer_id: p.customerId || null, activity_id: p.activityId || null, label: po,
        supplier: "ss", supplier_order: results.map((r) => r.orderNumber).join(", "), po, status: "ordered", placed_via: "api",
        lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, label: l.label })), total: results.reduce((a, r) => a + r.total, 0) || null,
        expected_date: expected ? expected.slice(0, 10) : null, created_by: v.user!.email || "staff", note: p.quote?.trim() ? `S&S quote ${p.quote.trim()}` : "",
      };
      // what was bought, per garment and color (Oct 26, Nick: bought from an email before there's an order, Create order
      // uses these later instead of asking again what the customer meant)
      const garments = (p.garments || []).filter((g) => g && g.style && goodsPcs(g) > 0).slice(0, 60);
      let ins = await admin.from("blank_orders").insert({ ...row, garments }).select("id").single();
      if (ins.error && /garments/.test(ins.error.message)) ins = await admin.from("blank_orders").insert(row).select("id").single();
      const { error } = ins;
      // bought already: say so plainly if it couldn't be recorded (the migration isn't run yet)
      if (error) return { ok: true as const, results, warn: `Ordered with S&S (${row.supplier_order}), but it couldn't be saved here: ${/order_id|customer_id|activity_id|label/.test(error.message) ? "run supabase/migrations/117_goods_orders_without_order.sql in Supabase" : error.message}.` };
      if (p.orderId) await admin.from("orders").update({ status: "blanks" }).eq("id", p.orderId).in("status", ["approved", "art"]);
      // no order yet: a to-do on the email, so it isn't forgotten (closed when Create order uses these goods)
      else if (p.activityId && ins.data?.id) {
        const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
        const what = garments.map((g) => `${[g.brand, g.style].filter(Boolean).join(" ")} ${g.color}: ${goodsSizes(g)}`).join("\n");
        await admin.from("tasks").insert({
          owner: (v.user!.email || "").toLowerCase(), title: `Make the order for ${po}: goods ordered (S&S #${row.supplier_order})`.slice(0, 200),
          notes: `Goods were ordered from this email before there was an order. Create order on the email uses them.\n${what}`.slice(0, 1000),
          area: "customer", due: tomorrow, status: "open", source: "email", activity_id: p.activityId, url: `/shop/inbox?show=${p.activityId}`,
          ref: `goods:${ins.data.id}`, created_by: v.user!.email || "staff",
        }).then(() => null, () => null);
      }
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

/**
 * Goods bought ahead with no order yet (Oct 26, Nick: "when I create order later… hey I noticed we placed an order on
 * Thursday for these goods. Are we completing this order"): from this email, or for this customer lately. Newest first.
 */
export async function goodsWaiting(p: { activityId?: string | null; customerId?: string | null }) {
  try {
    await staff();
    if (!p.activityId && !p.customerId) return { ok: true as const, list: [] };
    const admin = createAdminClient();
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    const id = (x?: string | null) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : "");
    const or = [id(p.activityId) ? `activity_id.eq.${id(p.activityId)}` : "", id(p.customerId) ? `customer_id.eq.${id(p.customerId)}` : ""].filter(Boolean).join(",");
    if (!or) return { ok: true as const, list: [] };
    const { data, error } = await admin.from("blank_orders").select("id, activity_id, customer_id, label, supplier_order, status, expected_date, created_at, created_by, garments")
      .is("order_id", null).eq("placed_via", "api").neq("status", "cancelled").gte("created_at", since).or(or).order("created_at", { ascending: false }).limit(6);
    if (error) return { ok: true as const, list: [] };
    const list = (data || []).filter((b) => Array.isArray(b.garments) && b.garments.length) as { id: string; activity_id: string | null; customer_id: string | null; label: string; supplier_order: string; status: string; expected_date: string | null; created_at: string; created_by: string; garments: GoodsGarment[] }[];
    // each garment's name from our catalog ("Unisex CVC Tee"), for the order's lines
    const styles = [...new Set(list.flatMap((b) => b.garments.map((g) => g.style)))];
    if (styles.length) {
      const { data: gs } = await admin.from("garments").select("style, description").in("style", styles);
      const name = new Map((gs || []).map((g) => [String(g.style).toUpperCase(), String(g.description || "")]));
      for (const b of list) b.garments = b.garments.map((g) => ({ ...g, name: g.name || name.get(g.style.toUpperCase()) || "" }));
    }
    return { ok: true as const, list };
  } catch (e) { return fail(e); }
}

/** Link goods bought ahead to their order once it exists. */
export async function linkGoods(goodsId: string, orderId: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { error } = await admin.from("blank_orders").update({ order_id: orderId }).eq("id", goodsId);
    if (error) return { ok: false as const, error: error.message };
    // its reminder to-do is done now
    await admin.from("tasks").update({ status: "done", done_at: new Date().toISOString(), done_by: "Create order: used the goods" }).eq("ref", `goods:${goodsId}`).eq("status", "open");
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

/**
 * Where the list would ship from right now (live, as the list changes): each sku's warehouses and quantities, by the
 * Fewest / Fastest choice, and anything short. Read-only: nothing is sent to S&S's ordering.
 */
export async function goodsWarehouses(lines: { sku: string; qty: number }[], mode: "fewest" | "fastest" = "fewest") {
  try {
    await staff();
    if (!ssConfigured()) return { ok: false as const, error: "S&S isn't connected." };
    const ls = lines.filter((l) => l.sku && l.qty > 0);
    if (!ls.length) return { ok: true as const, from: [], short: [] as string[] };
    const a = await ssAllocate(ls.map((l) => ({ identifier: l.sku, qty: Math.round(l.qty) })), mode === "fastest" ? "fastest" : "fewest");
    return { ok: true as const, from: a.lines.map((l) => ({ sku: l.identifier, qty: l.qty, warehouse: l.warehouseAbbr })), short: a.short };
  } catch (e) { return fail(e); }
}

/* ---------- S&S and SanMar side by side (Oct 27, Nick) ---------- */

/** our card fee at SanMar, in percent (Settings: data.goods.sanmarFee); S&S charges none */
async function sanmarFeePct(admin: ReturnType<typeof createAdminClient>) { return (await goodsMoney(admin)).fee; }
/**
 * Paying by card (Oct 27, Nick: "every dollar is 2 points… a cent per point… there's a 20% tax on that"): SanMar's card
 * fee, points a dollar, a point's value and the tax rate, for the Points decision (owners only). Settings data.goods.
 */
export type GoodsMoney = { fee: number; ppd: number; pointValue: number; tax: number; bigRun: number };
async function goodsMoney(admin: ReturnType<typeof createAdminClient>): Promise<GoodsMoney> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const g = ((data?.data as { goods?: Partial<Record<"sanmarFee" | "pointsPerDollar" | "pointValue" | "taxRate" | "bigRun", number>> } | null)?.goods) || {};
  const ok = (v: unknown, lo: number, hi: number, d: number) => { const n = +(v ?? NaN); return isFinite(n) && n >= lo && n < hi ? n : d; };
  return { fee: ok(g.sanmarFee, 0, 20, 3.25), ppd: ok(g.pointsPerDollar, 0, 20, 2), pointValue: ok(g.pointValue, 0, 1, 0.01), tax: ok(g.taxRate, 0, 90, 20), bigRun: Math.round(ok(g.bigRun, 1, 1e6, 250)) };
}
export async function setGoodsMoney(p: Partial<GoodsMoney>) {
  try {
    await staff();
    const admin = createAdminClient();
    const cur = await goodsMoney(admin);
    const num = (v: unknown) => Math.round(+(v as number) * 10000) / 10000;
    const next = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && isFinite(+v)).map(([k, v]) => [k, num(v)])) } as GoodsMoney;
    if (next.fee < 0 || next.fee >= 20 || next.ppd < 0 || next.ppd >= 20 || next.pointValue < 0 || next.pointValue >= 1 || next.tax < 0 || next.tax >= 90 || next.bigRun < 1) return { ok: false as const, error: "One of those numbers is out of range." };
    const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const d = (data?.data || {}) as Record<string, unknown>;
    const { error } = await admin.from("settings").update({ data: { ...d, goods: { ...((d.goods as object) || {}), sanmarFee: next.fee, pointsPerDollar: next.ppd, pointValue: next.pointValue, taxRate: next.tax, bigRun: Math.round(next.bigRun) } } }).eq("id", 1);
    return error ? { ok: false as const, error: error.message } : { ok: true as const, money: next, fee: next.fee };
  } catch (e) { return fail(e); }
}
export async function setSanmarFee(pct: number) { return setGoodsMoney({ fee: pct }); }

// SanMar writes colors short ("Athletic Ht", "DkHtGray"): both sides spelled out the same way to compare
const ABBR: [RegExp, string][] = [[/\bhthr\b|\bhtr\b|\bht\b/g, "heather"], [/\bdk\b/g, "dark"], [/\blt\b/g, "light"], [/\bgry\b|\bgy\b|\bgrey\b/g, "gray"], [/\bgrn\b/g, "green"], [/\bblu\b/g, "blue"], [/\bath\b/g, "athletic"], [/\bnvy\b|\bnv\b/g, "navy"], [/\bryl\b|\bry\b/g, "royal"], [/\bmrn\b/g, "maroon"], [/\bprpl\b|\bprp\b/g, "purple"], [/\bblk\b/g, "black"], [/\bwht\b/g, "white"], [/\borg\b|\borng\b/g, "orange"], [/\bchar\b/g, "charcoal"], [/\bslt\b/g, "slate"], [/\btr\b/g, "true"], [/\bvtg\b|\bvint\b/g, "vintage"]];
const colorWords = (c: string) => {
  let s = String(c || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9/ ]+/g, " ");
  for (const [re, w] of ABBR) s = s.replace(re, w);
  return s.replace(/\s+/g, "");
};
// S&S and SanMar call a few styles differently (Next Level 6210 = NL6210, Bella+Canvas 3001CVC = BC3001CVC)
async function sanmarStyleOf(admin: ReturnType<typeof createAdminClient>, brand: string, style: string) {
  const st = style.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!st) return "";
  const { data } = await admin.from("sanmar_styles").select("style, brand").or(`style.eq.${st},style.ilike.%${st}`).eq("sellable", true).limit(12);
  const b = brand.toLowerCase().replace(/[^a-z]/g, "").slice(0, 4);
  const list = (data || []) as { style: string; brand: string }[];
  const same = (x: { brand: string }) => !b || String(x.brand || "").toLowerCase().replace(/[^a-z]/g, "").startsWith(b);
  return (list.find((x) => x.style.toUpperCase() === st && same(x)) || list.find((x) => same(x) && /^[A-Z]{1,3}$/.test(x.style.toUpperCase().slice(0, x.style.length - st.length)) && x.style.toUpperCase().endsWith(st)) || null)?.style || "";
}

/** One Stop's size codes (SM, MD, LG, XL, 2X…) as ours (S, M, L, XL, 2XL…) */
const osSizeOf = (z: string) => { const k = String(z || "").toUpperCase().replace(/\s+/g, ""); return ({ SM: "S", MD: "M", LG: "L", "2X": "2XL", "3X": "3XL", "4X": "4XL", "5X": "5XL", "6X": "6XL", XXL: "2XL", XXXL: "3XL", ONE: "OS", OSFA: "OS" } as Record<string, string>)[k] || k; };
export type SanMarRef = { style: string; color: string; size: string; inventoryKey?: string; sizeIndex?: string };
/**
 * Where each size can come from: S&S (its warehouses, our price) and SanMar (its warehouses, our price before the card
 * fee). Order goods makes the Easiest / Cheapest / Fastest plans from these (lib/goodsPlan.ts).
 */
export async function goodsOptions(rows: { key: string; brand: string; style: string; color: string; size: string; qty: number; sku: string; price: number }[]) {
  try {
    await staff();
    const admin = createAdminClient();
    const srcs: Record<string, Src[]> = {}, sm: Record<string, SanMarRef> = {}, os: Record<string, { code: string }> = {}, notes: string[] = [];
    for (const r of rows) srcs[r.key] = [];
    // S&S, SanMar and the money settings all at once (Oct 29, Nick: the screen "sits there for quite a while")
    const ssJob = (async () => {
      const skus = rows.map((r) => r.sku).filter(Boolean);
      if (!ssConfigured() || !skus.length) return;
      const st = await ssStock(skus).catch((e) => { notes.push("S&S stock: " + (e instanceof Error ? e.message : String(e))); return new Map(); });
      for (const r of rows) for (const w of (st.get(r.sku) || []) as { warehouseAbbr: string; qty: number }[]) if (r.price > 0) srcs[r.key].push({ sup: "ss", wh: w.warehouseAbbr, stock: w.qty, price: r.price });
    })();
    const moneyJob = goodsMoney(admin);
    // SanMar: the same garment, color and size there
    if (sanmarConfigured()) {
      const styles = [...new Set(rows.map((r) => `${r.brand}|${r.style}`))];
      // a brand SanMar doesn't carry (its own catalog: Team 365, Comfort Colors' S&S-only lines…) isn't looked for there
      const brands = await supplierBrands(admin).catch(() => null);
      await Promise.all(styles.map(async (k) => {
        const [brand, style] = k.split("|");
        if (brands && !carries(brands, "sm", brand)) { notes.push(`SanMar doesn't carry ${brand}`); return; }
        const smStyle = await sanmarStyleOf(admin, brand, style);
        const mine = rows.filter((r) => `${r.brand}|${r.style}` === k);
        if (!smStyle) { notes.push(`SanMar doesn't carry ${style}`); return; }
        const [skus, inv] = await Promise.all([sanmarSkus(smStyle).catch(() => []), sanmarInventory(smStyle).catch((e) => { notes.push(`SanMar stock for ${smStyle}: ${e instanceof Error ? e.message : String(e)}`); return new Map(); })]);
        for (const r of mine) {
          const want = colorWords(r.color);
          const hit = skus.find((x) => x.size === r.size && (colorWords(x.color) === want || colorWords(x.catalogColor) === want));
          if (!hit) { if (skus.length && !skus.some((x) => colorWords(x.color) === want || colorWords(x.catalogColor) === want)) notes.push(`SanMar ${smStyle} doesn't come in ${r.color}`); continue; }
          const price = hit.myPrice || hit.casePrice || hit.piecePrice;
          sm[r.key] = { style: smStyle, color: hit.catalogColor || hit.color, size: hit.rawSize, inventoryKey: hit.inventoryKey || undefined, sizeIndex: hit.sizeIndex || undefined };
          const whs = (inv.get(sanmarStockKey(hit.catalogColor, hit.rawSize)) || inv.get(sanmarStockKey(hit.color, hit.rawSize)) || []) as { whse: string; qty: number }[];
          // only what's past SanMar's buffer: an order for a warehouse's last pieces is put on hold (SANMAR_BUFFER)
          if (price > 0) for (const w of whs) if (w.qty > SANMAR_BUFFER) srcs[r.key].push({ sup: "sm", wh: smWh(w.whse, (w as { name?: string }).name || ""), stock: w.qty - SANMAR_BUFFER, price });
        }
      }));
    }
    const [money] = await Promise.all([moneyJob, ssJob]);
    // One Stop, the third choice (Oct 29, Nick: "when S&S and SanMar are out of a specific size or color"): only for the
    // sizes the first two can't fill, found by the maker's brand and style number (their own codes don't follow the maker's)
    const short = rows.filter((r) => srcs[r.key].reduce((a, x) => a + x.stock, 0) < r.qty);
    const shortKeys = new Set(short.map((r) => r.key));
    let osFreight = 0;
    if (short.length && osConfigured()) {
      const brands = await supplierBrands(admin).catch(() => null);
      // every row of those styles: the short sizes to buy there, the rest only to reach One Stop's free ground ($175)
      const styles = [...new Set(short.map((r) => `${r.brand}|${r.style}`))];
      const found: { key: string; code: string }[] = [];
      await Promise.all(styles.map(async (k) => {
        const [brand, style] = k.split("|");
        if (brands && !carries(brands, "os", brand)) { notes.push(`One Stop doesn't carry ${brand}`); return; }
        const its = await osStyle(admin, brand, style).catch((e) => { notes.push(e instanceof Error ? e.message : String(e)); return []; });
        if (!its.length) { notes.push(`One Stop doesn't carry ${brand} ${style}`); return; }
        for (const r of rows.filter((x) => `${x.brand}|${x.style}` === k)) {
          const want = colorWords(r.color), size = osSizeOf(r.size);
          const hit = its.find((x) => osSizeOf(x.size) === size && colorWords(x.color) === want);
          if (hit) found.push({ key: r.key, code: hit.code });
          else if (shortKeys.has(r.key) && !its.some((x) => colorWords(x.color) === want)) notes.push(`One Stop ${style} doesn't come in ${r.color}`);
        }
      }));
      const px = found.length ? await osPrices(found.map((f) => f.code)).catch((e) => { notes.push(e instanceof Error ? e.message : String(e)); return new Map(); }) : new Map();
      for (const f of found) {
        const p = px.get(f.code) as { onHand: number; price: number } | undefined;
        os[f.key] = { code: f.code };
        if (p && p.onHand > 0 && p.price > 0) srcs[f.key].push({ sup: "os", wh: "MI", stock: p.onHand, price: p.price, ...(shortKeys.has(f.key) ? {} : { topUp: true }) });
      }
      osFreight = await osFreightGuess(admin);
    }
    // S&S first in each list, as before
    for (const k of Object.keys(srcs)) srcs[k].sort((a, b) => (a.sup === b.sup ? 0 : a.sup === "ss" ? -1 : 1));
    return { ok: true as const, srcs, sm, os, notes: [...new Set(notes)], fee: money.fee, money, sanmar: sanmarConfigured(), sanmarOrders: sanmarPOMode(), onestop: osConfigured(), onestopLive: osOrdersLive(), osFreight, osFreeAt: OS_FREE_AT };
  } catch (e) { return fail(e); }
}

// SanMar's ship methods (Purchase Order Integration Guide 24.6, p. 9); will call is the pickup warehouse's code in the
// ship method instead (p. 10: "<shipMethod>REN</shipMethod>"), and needs Warehouse Selection on our account
// Ground to the shop goes PSST (Oct 29, Nick: "I am a PSST decorator already"): SanMar's Pack Separately, Ship Together
// program, free freight to an approved decorator (our ship-to must match SanMar's file: Shipping center → Settings)
const SM_SHIP: Record<string, string> = { psst: "PSST", "40": "PSST", "14": "PSST", "16": "UPS 3RD DAY", "3": "UPS 2ND DAY", "2": "UPS NEXT DAY" };
const SM_WILL_CALL: Record<string, string> = { "1": "PRE", "2": "CIN", "3": "COP", "4": "REN", "5": "NJE", "6": "JAC", "7": "MSP", "12": "PHX", "31": "VA1" };
/** SanMar's part of a plan: checked (test) or ordered, shipped to us and paid with the card on our sanmar.com account */
/** what One Stop charges for ground under $175: learned from their checks (each check's freight), $30 until we've seen one */
async function osFreightGuess(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const f = (data?.data as { osFreight?: { n: number; avg: number } } | null)?.osFreight;
  return f && f.n > 0 && f.avg > 0 ? Math.round(f.avg * 100) / 100 : 30;
}
async function learnOsFreight(admin: ReturnType<typeof createAdminClient>, freight: number) {
  if (!(freight > 0)) return;
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as { osFreight?: { n: number; avg: number } };
  const n = Math.min(20, (d.osFreight?.n || 0) + 1), avg = d.osFreight?.n ? d.osFreight.avg + (freight - d.osFreight.avg) / n : freight;
  await admin.from("settings").update({ data: { ...d, osFreight: { n, avg: Math.round(avg * 100) / 100 } } }).eq("id", 1);
}

/**
 * One Stop's part of the goods (lib/onestop.ts): checked first (their preflight: nothing is ordered, and it gives the
 * freight), then placed by their codes on the card ending 5488. The card's CVV is typed in Order goods each time and
 * passed straight to One Stop; it's never saved. Orders go to One Stop's test system until ONESTOP_ORDERS=on.
 */
export async function placeOneStop(p: { lines: { code: string; qty: number; label: string; price: number }[]; shippingMethod: string; cvv: string; test: boolean; paidShipOk?: boolean; label: string; po?: string; orderId?: string | null; customerId?: string | null; activityId?: string | null; garments?: GoodsGarment[] }) {
  try {
    const v = await staff();
    if (!osConfigured()) return { ok: false as const, error: "One Stop isn't connected (ONESTOP_API_TOKEN in Vercel)." };
    const lines = p.lines.filter((l) => l.code && l.qty > 0);
    if (!lines.length) return { ok: false as const, error: "Nothing to order from One Stop." };
    const paidNo = paidShipBlock("os", p.shippingMethod, p.test, p.paidShipOk, lines.reduce((a, l) => a + l.qty * (l.price || 0), 0));
    if (paidNo) return { ok: false as const, error: paidNo };
    if (!p.test && !/^\d{3,4}$/.test(String(p.cvv || "").trim())) return { ok: false as const, error: "Type the card's security code (CVV) for One Stop. It isn't saved." };
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const zip = mergeSettings(st?.data).ship.from.zip || "";
    if (!zip) return { ok: false as const, error: "Add our address in Shipping center → Settings first (One Stop ships there)." };
    const po = (cleanGoodsPo(p.po || "") || defaultGoodsPo({ customer: p.label })).slice(0, 15).trim();
    const r = await osOrder({ lines: lines.map((l) => ({ code: l.code, qty: l.qty })), po, shipVia: p.shippingMethod, cvv: p.cvv || "", zip, place: !p.test });
    if (r.shipping > 0) await learnOsFreight(admin, r.shipping).catch(() => null);
    if (p.test) return { ok: true as const, total: Math.round((r.subtotal + r.shipping + r.tax) * 100) / 100 || lines.reduce((a, l) => a + l.qty * l.price, 0), freight: r.shipping, shipVia: r.shipVia, messages: r.messages, live: osOrdersLive() };
    await keepShort(admin, p.customerId, po).catch(() => null);
    const garments = (p.garments || []).filter((g) => g && g.style && goodsPcs(g) > 0).slice(0, 60);
    const row = {
      order_id: p.orderId || null, customer_id: p.customerId || null, activity_id: p.activityId || null, label: po, supplier: "onestop", supplier_order: r.orderNumber || po, po,
      status: "ordered", placed_via: "api", lines: lines.map((l) => ({ sku: l.code, qty: l.qty, label: l.label })), total: r.total || null, expected_date: null, created_by: v.user!.email || "staff",
      note: `One Stop${osOrdersLive() ? "" : " TEST SYSTEM (not charged or shipped)"}: ${r.shipVia}, freight ${r.shipping.toFixed(2)}.`, garments,
    };
    const ins = await admin.from("blank_orders").insert(row).select("id").single();
    if (ins.error) return { ok: true as const, po: r.orderNumber, warn: `Ordered with One Stop (${r.orderNumber}), but it couldn't be saved here: ${ins.error.message}` };
    if (p.orderId && osOrdersLive()) await admin.from("orders").update({ status: "blanks" }).eq("id", p.orderId).in("status", ["approved", "art"]);
    return { ok: true as const, po: r.orderNumber, total: r.total, freight: r.shipping, live: osOrdersLive() };
  } catch (e) { return fail(e); }
}

export async function placeSanmar(p: { lines: (SanMarPOLine & { label: string; price: number })[]; shippingMethod: string; test: boolean; paidShipOk?: boolean; label: string; /** the PO name typed on Order goods (lib/goodsPo.ts) */ po?: string; orderId?: string | null; customerId?: string | null; activityId?: string | null; garments?: GoodsGarment[] }) {
  try {
    const v = await staff();
    if (!sanmarPOMode()) return { ok: false as const, error: "SanMar ordering isn't turned on yet (SanMar's integration team has to switch it on for our account)." };
    const lines = p.lines.filter((l) => l.style && l.qty > 0);
    if (!lines.length) return { ok: false as const, error: "Nothing to order from SanMar." };
    const paidNo = paidShipBlock("sm", p.shippingMethod, p.test, p.paidShipOk);
    if (paidNo) return { ok: false as const, error: paidNo };
    // every line names its warehouse (Oct 28, SanMar: with Warehouse Selection on, a line without one fails the whole order)
    if (sanmarPOWhse()) {
      const none = lines.filter((l) => !l.whse);
      if (none.length) return { ok: false as const, error: `No SanMar warehouse picked for ${none.map((l) => (l as { label?: string }).label || `${l.style} ${l.color} ${l.size}`).join(", ")}. Nothing was sent.` };
    }
    // will call is picked up at SanMar Dallas, on its own PO (SanMar: will call and shipped orders are separate POs; the
    // panel uses one way for the whole order, so this order is all will call)
    if (p.shippingMethod === "6") {
      const away = lines.filter((l) => l.whse !== "3");
      if (away.length) return { ok: false as const, error: `Will call is only from SanMar Dallas. ${away.map((l) => (l as { label?: string }).label || `${l.style} ${l.color} ${l.size}`).join(", ")} ${away.length === 1 ? "comes" : "come"} from another warehouse: ship ${away.length === 1 ? "it" : "them"} by UPS instead, as a separate order. Nothing was sent.` };
    }
    const admin = createAdminClient();
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const from = mergeSettings(st?.data).ship.from;
    if (!from.street1 || !from.zip) return { ok: false as const, error: "Add our street address in Shipping center → Settings first (SanMar ships here)." };
    const poNum = cleanGoodsPo(p.po || "") || defaultGoodsPo({ customer: p.label });
    const order = { poNum: poNum.slice(0, 28), attention: from.name || "Receiving", shipTo: from.company || "FBS Print", address1: from.street1, address2: from.street2 || "", city: from.city, state: from.state, zip: from.zip, email: v.user?.email || "", shipMethod: p.shippingMethod === "6" ? SM_WILL_CALL["3"] : SM_SHIP[p.shippingMethod] || "UPS", lines };
    const fee = await sanmarFeePct(admin);
    const sub = lines.reduce((a, l) => a + l.qty * (l.price || 0), 0);
    if (p.test) {
      const r = await sanmarPreSubmit(order);
      return { ok: true as const, checked: r, total: Math.round(sub * (1 + fee / 100) * 100) / 100, po: order.poNum };
    }
    const r = await sanmarSubmitPO(order);
    await keepShort(admin, p.customerId, order.poNum).catch(() => null);
    const garments = (p.garments || []).filter((g) => g && g.style && goodsPcs(g) > 0).slice(0, 60);
    const row = {
      order_id: p.orderId || null, customer_id: p.customerId || null, activity_id: p.activityId || null, label: order.poNum, supplier: "sanmar", supplier_order: order.poNum, po: order.poNum,
      status: "ordered", placed_via: "api", lines: lines.map((l) => ({ sku: [l.style, l.color, l.size].join(" "), qty: l.qty, label: l.label })), total: Math.round(sub * (1 + fee / 100) * 100) / 100,
      expected_date: null, created_by: v.user!.email || "staff", note: `SanMar: ${r.message}. Card fee ${fee}%.`, garments,
    };
    const ins = await admin.from("blank_orders").insert(row).select("id").single();
    if (ins.error) return { ok: true as const, po: order.poNum, warn: `Ordered with SanMar (PO ${order.poNum}), but it couldn't be saved here: ${ins.error.message}` };
    if (p.orderId) await admin.from("orders").update({ status: "blanks" }).eq("id", p.orderId).in("status", ["approved", "art"]);
    return { ok: true as const, po: order.poNum, id: ins.data.id };
  } catch (e) { return fail(e); }
}

/**
 * Extras bought with an order's goods go back on the order (Oct 29, Nick: "if you order extra… you have to indicate what
 * it is, and then we've got to add it back to the order… like the extras for McKenna… printed, not printed"): an Extras
 * line under the garment it copies (the same group), with the reason as its note, printed or not, charged or not; and a
 * line in the order's history. The order's own quantities aren't changed.
 */
export async function addExtrasToOrder(orderId: string, extras: { brand: string; style: string; color: string; sizes: Record<string, number>; reason: string; print: boolean; free: boolean; /** the shop's own (hidden from the customer) */ shop?: boolean }[], placedAt: string) {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, groups").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    const groups = orderGroups(o as unknown as Order);
    const same = (a: string, b: string) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const said: string[] = [];
    for (const x of extras) {
      const n = Object.values(x.sizes).reduce((a, q) => a + (+q || 0), 0); if (!n) continue;
      const g = groups.find((y) => (y.lines || []).some((l) => same(l.style, x.style) && same(l.color, x.color))) || groups[0];
      if (!g) continue;
      const base = (g.lines || []).find((l) => same(l.style, x.style) && same(l.color, x.color) && !l.extras);
      // the same extras for the same reason again: added to that line
      const have = (g.lines || []).find((l) => l.extras && same(l.style, x.style) && same(l.color, x.color) && same(String(l.note || ""), x.reason) && !!l.extrasPrint === x.print && !!l.extrasFree === x.free && !!l.shopUse === !!x.shop);
      if (have) { for (const [z, q] of Object.entries(x.sizes)) if (q) have.sizes[z as keyof typeof have.sizes] = ((have.sizes[z as keyof typeof have.sizes] || 0) as number) + q; }
      else g.lines.splice(base ? g.lines.indexOf(base) + 1 : g.lines.length, 0, { ...(base ? JSON.parse(JSON.stringify(base)) : {}), id: uid(), brand: x.brand || base?.brand || "", style: x.style, color: x.color, sizes: { ...x.sizes }, extras: true, extrasPrint: x.print, extrasFree: x.free || !!x.shop, priceOverride: x.free || x.shop ? 0 : null, note: x.reason, ...(x.shop ? { shopUse: true } : { shopUse: undefined }) });
      said.push(`${n} extra (${Object.entries(x.sizes).filter(([, q]) => q).map(([z, q]) => `${q} ${z}`).join(", ")}) ${[x.brand, x.style, x.color].filter(Boolean).join(" ")} for ${x.reason.toLowerCase()}${x.print ? ", printed" : ", not printed"}${x.shop ? ", ours (not on the customer's invoice)" : x.free ? ", no charge" : ", charged"}`);
    }
    if (!said.length) return { ok: true as const };
    const { error } = await admin.from("orders").update({ groups }).eq("id", orderId);
    if (error) return { ok: false as const, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Ordered ${said.join("; ")}, with the goods (${placedAt}). Added to the order as Extras. — ${v.user?.email || "staff"}` });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
