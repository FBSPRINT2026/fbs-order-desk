import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, siteUrl } from "@/lib/email";
import { calcGroup, mergeSettings, type Group, type Settings } from "@/lib/pricing";
import {
  bySize, canChange, fmtDate, isOpen, isYouthSize, orderCode, orderTotals, preorderLine, r2, slugify, unitPrice, DEFAULT_FIELDS, STORE_STEPS,
  type Field, type MerchOrder, type OrderItem, type Product, type Store, type StoreStatus,
} from "@/lib/merch";

/* ------------------------------------------------------------------ who may do what */

export type MerchAccess = { admin: SupabaseClient; staff: boolean; email: string; customerIds: string[]; settings: Settings };

/**
 * Staff can work on every store. A customer marked as a merch-store client (customers.merch_client) can build and run
 * their own stores from the portal. Everyone else is turned away.
 */
export async function merchAccess(): Promise<MerchAccess> {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  const admin = createAdminClient();
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  if (isStaff) return { admin, staff: true, email, customerIds: [], settings };
  // row security: only their own customer records come back
  const { data: cs } = await supabase.from("customers").select("id, merch_client");
  const ids = ((cs || []) as { id: string; merch_client: boolean }[]).filter((c) => c.merch_client).map((c) => c.id);
  if (!ids.length) throw new Error("Online stores aren't turned on for your account yet. Ask FBS Print to turn them on.");
  return { admin, staff: false, email, customerIds: ids, settings };
}

/** a store this person may work on (throws otherwise) */
export async function storeFor(a: MerchAccess, storeId: string): Promise<Store> {
  const { data } = await a.admin.from("merch_stores").select("*").eq("id", storeId).maybeSingle();
  if (!data) throw new Error("That store doesn't exist.");
  if (!a.staff && !a.customerIds.includes(data.customer_id)) throw new Error("That isn't one of your stores.");
  return data as Store;
}

/* ------------------------------------------------------------------ prices */

/**
 * FBS's price per piece for a store product, from our retail pricing: the blank (with our markup) + the print at the
 * expected quantity + the setup spread over those pieces, rounded up to the next 50¢.
 */
export function suggestBasePrice(settings: Settings, o: { cost: number; color: string; method?: string; colors?: number; expected?: number; locations?: number }) {
  const qty = Math.max(12, Math.round(o.expected || 48));
  const imprints = Array.from({ length: Math.max(1, o.locations || 1) }, (_, i) => ({ id: "i" + i, method: (o.method || "screen") as "screen", location: i ? "Full Back" : "Full Front", colors: Math.max(1, o.colors || 1), inks: "", size: "", notes: "" }));
  const g: Group = { id: "g", lines: [{ id: "l", style: "", brand: "", garment: "", color: o.color || "White", cost: o.cost || 0, sizes: { M: qty }, priceOverride: null }], imprints };
  const c = calcGroup(g, { waive_setup: false, price_type: "retail" }, settings);
  const each = (c.lines[0]?.each || 0) + c.setup / qty;
  return Math.ceil(each * 2) / 2;
}

/** 2XL+ upcharges from our price list (the size runs we sell) */
export const defaultUpcharges = (settings: Settings, sizes: string[]) => Object.fromEntries(sizes.filter((z) => +(settings.upcharges as Record<string, number>)[z] > 0).map((z) => [z, +(settings.upcharges as Record<string, number>)[z]]));

/* ------------------------------------------------------------------ stores */

export async function uniqueSlug(admin: SupabaseClient, base: string, notId?: string) {
  const root = slugify(base) || "store";
  for (let i = 0; i < 50; i++) {
    const s = i ? `${root}-${i + 1}` : root;
    const { data } = await admin.from("merch_stores").select("id").eq("slug", s).maybeSingle();
    if (!data || data.id === notId) return s;
  }
  return `${root}-${randomBytes(2).toString("hex")}`;
}

export function withEvent(st: Pick<Store, "timeline">, status: string, by: string, note = "") {
  return [...(st.timeline || []), { status, at: new Date().toISOString(), by, ...(note ? { note } : {}) }];
}

/** A store whose close time has passed is closed (done when anyone looks at it, so no timer is needed). */
export async function autoClose(admin: SupabaseClient, stores: Store[]) {
  const now = Date.now();
  for (const st of stores) {
    if (st.status === "open" && st.closes_at && Date.parse(st.closes_at) <= now) {
      st.timeline = withEvent(st, "closed", "auto", "closed on schedule");
      st.status = "closed";
      await admin.from("merch_stores").update({ status: "closed", timeline: st.timeline, updated_at: new Date().toISOString() }).eq("id", st.id).eq("status", "open");
    }
  }
  return stores;
}

export async function loadOrders(admin: SupabaseClient, storeId: string): Promise<MerchOrder[]> {
  const { data: os } = await admin.from("merch_orders").select("*").eq("store_id", storeId).order("number");
  const orders = (os || []) as MerchOrder[];
  if (!orders.length) return [];
  const items: OrderItem[] = [];
  const ids = orders.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await admin.from("merch_order_items").select("*").in("order_id", ids.slice(i, i + 300)).order("created_at");
    items.push(...((data || []) as (OrderItem & { order_id: string })[]));
  }
  for (const o of orders) o.items = (items as (OrderItem & { order_id: string })[]).filter((it) => it.order_id === o.id);
  return orders;
}

/* ------------------------------------------------------------------ the public store */

export type PublicStore = Omit<Store, "password" | "notes" | "created_by" | "order_id" | "contact"> & { locked: boolean; open: boolean; contactName: string; /** give-back raised so far (paid orders) */ raised: number };
export type PublicProduct = Omit<Product, "cost" | "base_price" | "giveback"> & { prices: Record<string, number> };

/** The store as a shopper sees it (no costs, FBS prices or notes). With a password, products come only after it's given. */
export async function publicStore(slug: string, pass = ""): Promise<{ store: PublicStore; products: PublicProduct[] } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("merch_stores").select("*").eq("slug", slug).maybeSingle();
  if (!data) return null;
  const [st] = await autoClose(admin, [data as Store]);
  if (st.status === "draft" || st.status === "review") {
    // only staff (and the store's own customer) can preview a store that isn't open yet
    const { isStaff } = await getViewer().catch(() => ({ isStaff: false }));
    if (!isStaff) return { store: shape(st, true), products: [] };
  }
  const locked = !!st.password && pass.trim().toLowerCase() !== st.password.trim().toLowerCase();
  const { data: ps } = locked ? { data: [] } : await admin.from("merch_products").select("*").eq("store_id", st.id).eq("active", true).order("position");
  const products = ((ps || []) as Product[]).map((p) => {
    const { cost: _c, base_price: _b, giveback: _g, ...rest } = p;
    return { ...rest, prices: Object.fromEntries((p.sizes || []).map((z) => [z, unitPrice(p, z)])) } as PublicProduct;
  });
  // the fundraiser meter (only when the store has a goal)
  let raised = 0;
  if (!locked && +(st.giveback?.goal || 0) > 0) {
    const { data: gs } = await admin.from("merch_orders").select("giveback").eq("store_id", st.id).not("status", "in", "(cancelled,refunded,pending)");
    raised = r2(((gs || []) as { giveback: number }[]).reduce((a, x) => a + +x.giveback, 0));
  }
  return { store: shape(st, locked, raised), products };
}
function shape(st: Store, locked: boolean, raised = 0): PublicStore {
  const { password: _p, notes: _n, created_by: _c, order_id: _o, contact, ...rest } = st;
  return { ...rest, locked, open: isOpen(st), contactName: contact?.name || "", raised };
}

/* ------------------------------------------------------------------ checkout */

export type CartLine = { product_id: string; color: string; size: string; qty: number; personalization?: Record<string, string> };
/** one student's bag in a checkout: the store's questions (student, grade, teacher…) and what goes in it */
export type StudentCart = { answers: Record<string, string>; cart: CartLine[] };
export type CheckoutInput = {
  slug: string; pass?: string; shopper: { name: string; email: string; phone?: string };
  /** one entry per student (siblings check out together: one payment, one bag each). Older clients send answers + cart. */
  students?: StudentCart[]; answers?: Record<string, string>; cart?: CartLine[];
  delivery: "org" | "pickup" | "ship"; ship_to?: MerchOrder["ship_to"];
  /** Stax payment method (from Stax.js), or "test" (staff only: a test order, no charge) */
  paymentMethodId: string; method: "card" | "bank" | "test";
};

const clean = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** Check the cart against the store and price it from our records (never from the browser). */
async function priceCart(admin: SupabaseClient, st: Store, cart: CartLine[]) {
  if (!cart.length) throw new Error("Your cart is empty.");
  const ids = [...new Set(cart.map((c) => c.product_id))];
  const { data: ps } = await admin.from("merch_products").select("*").eq("store_id", st.id).in("id", ids);
  const products = (ps || []) as Product[];
  const items: OrderItem[] = cart.map((c) => {
    const p = products.find((x) => x.id === c.product_id && x.active);
    if (!p) throw new Error("Something in your bag isn't in this store anymore. Please remove it and add it again.");
    const color = p.colors.find((x) => x.name === c.color) || (p.colors.length === 1 ? p.colors[0] : null);
    if (!color) throw new Error(`Pick a color for ${p.name}.`);
    const sizes = color.sizes?.length ? color.sizes : p.sizes;
    if (!sizes.includes(c.size)) throw new Error(`${c.size} isn't available for ${p.name} in ${color.name}.`);
    const qty = Math.max(1, Math.min(99, Math.round(+c.qty || 1)));
    const pers: Record<string, string> = {};
    let extra = 0;
    for (const f of p.personalize || []) { const v = clean(c.personalization?.[f.label], f.max || 30); if (v) { pers[f.label] = v; extra += +f.price || 0; } }
    const style = p.imprint?.youth && isYouthSize(c.size) ? p.imprint.youth.style : p.style;
    return { product_id: p.id, name: p.name, style, color: color.name, size: c.size, qty, unit_price: r2(unitPrice(p, c.size) + extra), base_price: r2(+p.base_price + +(p.upcharges?.[c.size] || 0) + extra), giveback: r2(+p.giveback), personalization: pers };
  });
  return items;
}

/** the store's questions, checked (required, from the list) */
function checkAnswers(st: Store, raw: Record<string, string> | undefined, who: string) {
  const answers: Record<string, string> = {};
  for (const f of (st.fields || DEFAULT_FIELDS) as Field[]) {
    const v = clean(raw?.[f.key], 80);
    if (f.required && !v) throw new Error(`${who}${f.label} is required.`);
    if (v && f.kind === "select" && f.options.length && !f.options.includes(v)) throw new Error(`${who}pick ${f.label.toLowerCase()} from the list.`);
    if (v) answers[f.key] = v;
  }
  return answers;
}

/**
 * A shopper checks out: one payment for everything, and one order (one bag, labeled and sorted for hand-out) per
 * student. Brothers and sisters in different homerooms each get their own bag.
 */
export async function placeOrder(input: CheckoutInput): Promise<{ ok: true; token: string; code: string; total: number; orders: { token: string; code: string }[] } | { ok: false; error: string }> {
  try {
    const admin = createAdminClient();
    const { data: sd } = await admin.from("merch_stores").select("*").eq("slug", input.slug).maybeSingle();
    if (!sd) return { ok: false, error: "This store doesn't exist." };
    const [st] = await autoClose(admin, [sd as Store]);
    const test = input.method === "test";
    const { isStaff } = test ? await getViewer().catch(() => ({ isStaff: false })) : { isStaff: false };
    if (test && !isStaff) return { ok: false, error: "Pick a payment method." };
    // staff can place test orders in any store (to try it out); shoppers only while it's open
    if (!isOpen(st) && !(test && isStaff)) return { ok: false, error: st.status === "open" && st.opens_at && Date.parse(st.opens_at) > Date.now() ? `This store opens ${fmtDate(st.opens_at)}.` : "This store is closed and isn't taking orders." };
    if (st.password && !isStaff && clean(input.pass).toLowerCase() !== st.password.trim().toLowerCase()) return { ok: false, error: "Enter the store's password." };
    const shopper = { name: clean(input.shopper?.name, 80), email: clean(input.shopper?.email, 120).toLowerCase(), phone: clean(input.shopper?.phone, 30) };
    if (!shopper.name) return { ok: false, error: "Enter your name." };
    if (!okEmail(shopper.email)) return { ok: false, error: "Enter a good email address: your receipt and order updates go there." };
    const delivery = input.delivery;
    if (!(st.delivery as Store["delivery"])?.[delivery]?.on) return { ok: false, error: "Pick how you'll get your order." };
    let ship_to: MerchOrder["ship_to"] = {};
    if (delivery === "ship") {
      const s = input.ship_to || {};
      ship_to = { name: clean(s.name, 80) || shopper.name, street1: clean(s.street1, 120), street2: clean(s.street2, 120), city: clean(s.city, 60), state: clean(s.state, 2).toUpperCase(), zip: clean(s.zip, 10) };
      if (!ship_to.street1 || !ship_to.city || !/^[A-Z]{2}$/.test(ship_to.state || "") || !/^\d{5}(-\d{4})?$/.test(ship_to.zip || "")) return { ok: false, error: "Enter the full shipping address." };
    }

    // one bag per student (empty ones are dropped)
    const raw = (input.students?.length ? input.students : [{ answers: input.answers || {}, cart: input.cart || [] }]).filter((s) => (s.cart || []).some((c) => +c.qty > 0)).slice(0, 8);
    if (!raw.length) return { ok: false, error: "Your bag is empty." };
    const many = raw.length > 1;
    const bags: { answers: Record<string, string>; items: OrderItem[]; t: ReturnType<typeof orderTotals> }[] = [];
    for (const [i, s] of raw.entries()) {
      const who = many ? `Student ${i + 1}: ` : "";
      const answers = checkAnswers(st, s.answers, who);
      const items = await priceCart(admin, st, s.cart.filter((c) => +c.qty > 0));
      // shipping is charged once per checkout (on the first bag)
      const t = orderTotals(items, { taxRate: st.tax_rate, taxExempt: st.tax_exempt, shipping: delivery === "ship" && i === 0 ? +st.delivery.ship.flat || 0 : 0 });
      bags.push({ answers, items, t });
    }
    const total = r2(bags.reduce((a, b) => a + b.t.total, 0));
    const forWho = bags.map((b) => b.answers.student || "").filter(Boolean).join(" & ") || shopper.name;

    // payment (Stax), or a staff test order
    let processor = "", payMethod = "";
    if (test) payMethod = "Test (no charge)";
    else {
      if (!process.env.STAX_API_KEY) return { ok: false, error: "Online payments aren't set up yet. Please contact FBS Print." };
      if (!/^[\w-]{6,}$/.test(input.paymentMethodId || "")) return { ok: false, error: "Enter your payment details again." };
      const all = bags.flatMap((b) => b.items);
      const res = await fetch("https://apiprod.fattlabs.com/charge", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.STAX_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          payment_method_id: input.paymentMethodId, total, pre_auth: 0,
          meta: {
            reference: `${st.name} online store`.slice(0, 200), memo: `${st.name} order for ${forWho}`.slice(0, 200),
            subtotal: r2(bags.reduce((a, b) => a + b.t.subtotal + b.t.shipping, 0)), tax: r2(bags.reduce((a, b) => a + b.t.tax, 0)),
            lineItems: all.map((i) => ({ item: `${i.name} (${i.color}, ${i.size})`.slice(0, 100), details: Object.values(i.personalization).join(" ").slice(0, 100), quantity: i.qty, price: i.unit_price })),
            transaction_initiation_type: "CIT", transaction_schedule_type: "unscheduled",
          },
        }),
      });
      const txn = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || !txn || txn.success === false) {
        const why = (txn && (txn.message || (Array.isArray(txn.error) ? txn.error.join(" ") : txn.error))) || `The payment didn't go through (${res.status}).`;
        return { ok: false, error: String(why) };
      }
      processor = String(txn.id || "");
      payMethod = input.method === "card" ? "Credit card" : "ACH";
    }

    // save each bag as its own order (the number is the next one in this store; retried if two shoppers check out at once)
    const checkout_id = many ? crypto.randomUUID() : null;
    const saved: MerchOrder[] = [];
    for (const b of bags) {
      let order: MerchOrder | null = null;
      for (let i = 0; i < 6 && !order; i++) {
        const { data: n } = await admin.rpc("merch_next_number", { p_store: st.id });
        const { data, error } = await admin.from("merch_orders").insert({
          store_id: st.id, number: (n as number) + i, token: randomBytes(16).toString("hex"), shopper, answers: b.answers, delivery, ship_to, checkout_id,
          subtotal: b.t.subtotal, tax: b.t.tax, shipping: b.t.shipping, total: b.t.total, giveback: b.t.giveback, status: "paid", paid_at: new Date().toISOString(), processor_id: processor, pay_method: payMethod,
        }).select("*").single();
        if (!error) order = data as MerchOrder;
        else if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      }
      if (!order) throw new Error(saved.length || !test ? "We couldn't save your order, but your card was charged. Please call FBS Print and we'll fix it." : "We couldn't save your order. Try again.");
      const { error: ie } = await admin.from("merch_order_items").insert(b.items.map((i) => ({ ...i, order_id: order!.id })));
      if (ie) throw new Error(ie.message);
      order.items = b.items;
      saved.push(order);
    }
    await sendConfirmation(st, saved).catch(() => false);
    return { ok: true, token: saved[0].token, code: orderCode(st, saved[0].number), total, orders: saved.map((o) => ({ token: o.token, code: orderCode(st, o.number) })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." };
  }
}

/* ------------------------------------------------------------------ the shopper's order (by its private link) */

export async function orderByToken(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token || "")) return null;
  const admin = createAdminClient();
  const { data: o } = await admin.from("merch_orders").select("*").eq("token", token).maybeSingle();
  if (!o) return null;
  const { data: s } = await admin.from("merch_stores").select("*").eq("id", o.store_id).maybeSingle();
  if (!s) return null;
  const [st] = await autoClose(admin, [s as Store]);
  const { data: items } = await admin.from("merch_order_items").select("*").eq("order_id", o.id).order("created_at");
  const { data: ps } = await admin.from("merch_products").select("id, name, colors, sizes, base_price, giveback, upcharges, imprint, active").eq("store_id", st.id);
  // brothers and sisters from the same checkout (their own bags)
  const { data: sib } = o.checkout_id ? await admin.from("merch_orders").select("number, token, answers").eq("checkout_id", o.checkout_id).neq("id", o.id).order("number") : { data: [] };
  const siblings = ((sib || []) as Pick<MerchOrder, "number" | "token" | "answers">[]).map((x) => ({ code: orderCode(st, x.number), token: x.token, student: x.answers?.student || "" }));
  return { store: shape(st, false), order: { ...(o as MerchOrder), items: (items || []) as OrderItem[] }, products: (ps || []) as Pick<Product, "id" | "name" | "colors" | "sizes" | "base_price" | "giveback" | "upcharges" | "imprint" | "active">[], canChange: canChange(st), siblings };
}

/**
 * The shopper changes their own order before the goods are ordered: a different size or color of the same item, or the
 * student / grade / teacher. A change that would cost a different amount becomes a request to FBS instead.
 */
export async function changeOrder(token: string, ch: { items: { id: string; color: string; size: string }[]; answers: Record<string, string> }): Promise<{ ok: boolean; error?: string; requested?: boolean }> {
  const got = await orderByToken(token);
  if (!got) return { ok: false, error: "We couldn't find that order." };
  const { order, products } = got;
  const admin = createAdminClient();
  const { data: sd } = await admin.from("merch_stores").select("*").eq("id", order.store_id).single();
  const st = sd as Store;
  if (!canChange(st)) return { ok: false, error: "The goods for this store have been ordered, so changes go through FBS Print now. Use \"Ask for a change\"." };
  const what: string[] = [];
  for (const c of ch.items || []) {
    const it = order.items?.find((x) => x.id === c.id);
    if (!it || (it.color === c.color && it.size === c.size)) continue;
    const p = products.find((x) => x.id === it.product_id);
    if (!p) return { ok: false, error: "That item can't be changed online. Use \"Ask for a change\"." };
    const col = p.colors.find((x) => x.name === c.color);
    if (!col || !(col.sizes?.length ? col.sizes : p.sizes).includes(c.size)) return { ok: false, error: `${c.size} in ${c.color} isn't available.` };
    const extra = r2(it.unit_price - unitPrice(p as Product, it.size));
    const newPrice = r2(unitPrice(p as Product, c.size) + extra);
    if (Math.abs(newPrice - it.unit_price) > 0.004) return { ok: false, error: `${it.name} in ${c.size} is ${newPrice > it.unit_price ? "more" : "less"} than what you paid, so we'll handle it for you: use "Ask for a change".` };
    const style = p.imprint?.youth && isYouthSize(c.size) ? p.imprint.youth.style : (await admin.from("merch_products").select("style").eq("id", p.id).single()).data?.style || it.style;
    await admin.from("merch_order_items").update({ color: c.color, size: c.size, style }).eq("id", it.id);
    what.push(`${it.name}: ${it.color} ${it.size} → ${c.color} ${c.size}`);
  }
  const answers = { ...order.answers };
  for (const f of (st.fields || []) as Field[]) {
    if (!(f.key in (ch.answers || {}))) continue;
    const v = clean(ch.answers[f.key], 80);
    if (f.required && !v) return { ok: false, error: `${f.label} is required.` };
    if (v && f.kind === "select" && f.options.length && !f.options.includes(v)) return { ok: false, error: `Pick ${f.label.toLowerCase()} from the list.` };
    if ((answers[f.key] || "") !== v) { what.push(`${f.label}: ${answers[f.key] || "—"} → ${v || "—"}`); if (v) answers[f.key] = v; else delete answers[f.key]; }
  }
  if (!what.length) return { ok: true };
  await admin.from("merch_orders").update({ answers, changes: [...(order.changes || []), { at: new Date().toISOString(), by: "shopper", what: what.join("; ") }], updated_at: new Date().toISOString() }).eq("id", order.id);
  return { ok: true };
}

/** "Ask for a change": the shopper's message goes to FBS (email) and onto the order. */
export async function requestChange(token: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const got = await orderByToken(token);
  if (!got) return { ok: false, error: "We couldn't find that order." };
  const msg = String(message || "").trim().slice(0, 2000);
  if (msg.length < 3) return { ok: false, error: "Tell us what you'd like to change." };
  const { order, store } = got;
  const admin = createAdminClient();
  await admin.from("merch_orders").update({ changes: [...(order.changes || []), { at: new Date().toISOString(), by: "shopper (request)", what: msg }], updated_at: new Date().toISOString() }).eq("id", order.id);
  const code = orderCode(store, order.number);
  if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, replyTo: order.shopper.email, subject: `[Store] Change request: ${store.name} ${code}`, html: shell(store, `Change request for ${code}`, `<p><b>${esc(order.shopper.name)}</b> (${esc(order.shopper.email)}) asked:</p><blockquote style="border-left:3px solid #ccc;margin:0;padding:4px 12px">${esc(msg).replace(/\n/g, "<br>")}</blockquote><p><a href="${siteUrl()}/shop/stores/${store.id}?order=${order.id}">Open the order</a> · reply to this email to answer them.</p>`) }).catch(() => false);
  return { ok: true };
}

/* ------------------------------------------------------------------ emails */

const esc = (s: string) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
/** emails look like the school's store (its name and color), "fulfilled by FBS Print" underneath */
function shell(st: Pick<Store, "name" | "brand">, heading: string, body: string, button?: { label: string; url: string }) {
  const c = st.brand?.primary || "#1F3A8A";
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#141D2B">
  <div style="background:${esc(c)};color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-weight:800;font-size:18px">${esc(st.brand?.school || st.name)}<div style="font-weight:500;font-size:13px;opacity:.9">${esc(st.name)}</div></div>
  <div style="border:1px solid #e3e7ee;border-top:0;border-radius:0 0 12px 12px;padding:20px 22px">
  <h1 style="font-size:19px;margin:0 0 12px">${esc(heading)}</h1>${body}
  ${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:${esc(c)};color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ""}
  <p style="color:#7A8599;font-size:12px;margin-top:22px">This store is run and fulfilled by FBS Print · Richardson, TX</p></div></div>`;
}

/** a size as people say it in an email ("Youth M", "Adult XL") */
const sizeWords = (z: string) => ({ YXS: "Youth XS", YS: "Youth S", YM: "Youth M", YL: "Youth L", YXL: "Youth XL", OS: "One size" } as Record<string, string>)[z] || `Adult ${z}`;

/** The receipt: every bag in the checkout (one per student), each with its own "see / change your order" link. */
export async function sendConfirmation(st: Store, orders: MerchOrder[]) {
  if (!orders.length) return false;
  const fields = (st.fields || []) as Field[];
  const c = st.brand?.primary || "#1F3A8A";
  const many = orders.length > 1;
  const bag = (o: MerchOrder) => {
    const code = orderCode(st, o.number), url = `${siteUrl()}/s/${st.slug}/o/${o.token}`;
    const rows = (o.items || []).map((i) => `<tr><td style="padding:7px 0;border-bottom:1px solid #eef1f4">${esc(i.name)}<div style="color:#7A8599;font-size:12px">${esc(i.color)} · ${esc(sizeWords(i.size))}${Object.values(i.personalization || {}).length ? " · " + esc(Object.values(i.personalization).join(", ")) : ""}</div></td><td style="padding:7px 0;border-bottom:1px solid #eef1f4;text-align:center">${i.qty}</td><td style="padding:7px 0;border-bottom:1px solid #eef1f4;text-align:right">${money(i.qty * i.unit_price)}</td></tr>`).join("");
    const ans = fields.map((f) => (o.answers?.[f.key] ? `${esc(f.label)}: <b>${esc(o.answers[f.key])}</b>` : "")).filter(Boolean).join(" &nbsp;·&nbsp; ");
    return `<div style="border:1px solid #e3e7ee;border-radius:10px;padding:14px 16px;margin:0 0 14px">
      <div style="font-weight:800;font-size:16px">${many && o.answers?.student ? `${esc(o.answers.student)}'s bag` : "Your bag"} <span style="color:#7A8599;font-weight:600;font-size:13px">· ${code}</span></div>
      ${ans ? `<div style="font-size:13px;color:#4A5568;margin-top:4px">${ans}</div>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">${rows}
      <tr><td colspan="2" style="padding:6px 0 0;text-align:right;color:#7A8599">Items</td><td style="padding:6px 0 0;text-align:right">${money(o.subtotal)}</td></tr>
      ${o.shipping ? `<tr><td colspan="2" style="text-align:right;color:#7A8599">Shipping</td><td style="text-align:right">${money(o.shipping)}</td></tr>` : ""}
      <tr><td colspan="2" style="text-align:right;color:#7A8599">Tax</td><td style="text-align:right">${money(o.tax)}</td></tr></table>
      <p style="margin:12px 0 0"><a href="${esc(url)}" style="color:${esc(c)};font-weight:700">${many ? `See or change ${esc(o.answers?.student || code)}'s order` : "See or change your order"} →</a></p></div>`;
  };
  const total = r2(orders.reduce((a, o) => a + o.total, 0));
  const first = orders[0];
  const html = shell(st, many ? `Thank you! Your ${orders.length} orders are in.` : `Thank you! Your order ${orderCode(st, first.number)} is in.`, `
    <div style="background:#FFF7E0;border:1px solid #F0D58A;border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:16px"><b>${esc(preorderLine(st))}</b></div>
    ${many ? `<p style="font-size:14px;margin:0 0 12px">Each student's things are packed in their own labeled bag.</p>` : ""}
    ${orders.map(bag).join("")}
    <table style="width:100%;font-size:15px"><tr><td style="font-weight:700">${first.pay_method === "Test (no charge)" ? "Test order (no charge)" : "Charged"}</td><td style="text-align:right;font-weight:800">${money(total)}</td></tr></table>
    <p style="font-size:13px;color:#4A5568;margin-top:14px"><b>The charge on your statement will say FBS Print</b>: we print and fulfill this store for ${esc(st.brand?.school || st.name)}.</p>
    <p style="font-size:13px;color:#4A5568">Need a different size, or to fix a student's info? Use the link${many ? "s" : ""} above: you can change it yourself until we order the goods${st.closes_at ? ` (after the store closes ${fmtDate(st.closes_at, false)})` : ""}. Keep this email: the link${many ? "s" : ""} always show${many ? "" : "s"} where your order is.</p>`);
  return sendEmail({ to: first.shopper.email, subject: many ? `${orders.length} orders confirmed: ${st.name}` : `Order ${orderCode(st, first.number)} confirmed: ${st.name}`, html, replyTo: SHOP_NOTIFY_EMAIL || undefined });
}

/**
 * "Email me my order links": everything this email address ordered in the store, one email. It always answers the same
 * way, so nobody can use it to find out who ordered.
 */
export async function emailOrderLinks(slug: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const e = clean(email, 120).toLowerCase();
  if (!okEmail(e)) return { ok: false, error: "Enter the email you ordered with." };
  const admin = createAdminClient();
  const { data: sd } = await admin.from("merch_stores").select("*").eq("slug", slug).maybeSingle();
  if (!sd) return { ok: false, error: "This store doesn't exist." };
  const st = sd as Store;
  const { data: os } = await admin.from("merch_orders").select("number, token, answers, created_at, status").eq("store_id", st.id).ilike("shopper->>email", e).order("number").limit(20);
  const list = (os || []) as Pick<MerchOrder, "number" | "token" | "answers" | "created_at" | "status">[];
  if (list.length) {
    const rows = list.map((o) => `<li style="margin:0 0 8px"><a href="${siteUrl()}/s/${st.slug}/o/${o.token}" style="color:${esc(st.brand?.primary || "#1F3A8A")};font-weight:700">${orderCode(st, o.number)}${o.answers?.student ? ` · ${esc(o.answers.student)}` : ""}</a> <span style="color:#7A8599;font-size:12px">ordered ${fmtDate(o.created_at, false)}${o.status === "cancelled" ? " · cancelled" : ""}</span></li>`).join("");
    await sendEmail({ to: e, subject: `Your orders: ${st.name}`, html: shell(st, "Here are your orders", `<p style="font-size:14px">Tap an order to see where it is or change it.</p><ul style="padding-left:18px;font-size:14px">${rows}</ul>`), replyTo: SHOP_NOTIFY_EMAIL || undefined }).catch(() => false);
  }
  return { ok: true };
}

/** a short update to every shopper in the store (goods ordered, packed, delivered…) */
export async function emailShoppers(st: Store, orders: MerchOrder[], heading: string, text: string) {
  let n = 0;
  for (const o of orders.filter((x) => x.status !== "cancelled" && x.status !== "refunded" && x.shopper?.email)) {
    const ok = await sendEmail({ to: o.shopper.email, subject: `${heading}: ${st.name}`, html: shell(st, heading, `<p style="font-size:14px;line-height:1.55">${esc(text)}</p><p style="font-size:13px;color:#4A5568">Order ${orderCode(st, o.number)}${o.answers?.student ? ` for ${esc(o.answers.student)}` : ""}.</p>`, { label: "Check your order", url: `${siteUrl()}/s/${st.slug}/o/${o.token}` }), replyTo: SHOP_NOTIFY_EMAIL || undefined }).catch(() => false);
    if (ok) n++;
  }
  return n;
}

/** what each store step tells shoppers (sent when staff move the store along, if the store's updates are on) */
export function stepMessage(st: Store, status: StoreStatus): { heading: string; text: string } | null {
  const by = st.deliver_by ? ` We expect everything ${st.delivery?.org?.on ? `at ${st.delivery.org.label || st.brand?.school || "the school"}` : "ready"} around ${fmtDate(st.deliver_by)}.` : "";
  switch (status) {
    case "ordered": return { heading: "Your store's goods are ordered", text: `${st.name} is closed and we've ordered the shirts. Next we print, then pack every order in its own bag.${by}` };
    case "production": return { heading: "Your order is being printed", text: `Your ${st.name} order is on the press now.${by}` };
    case "ready": return { heading: "Your order is packed", text: `Your ${st.name} order is packed in its own labeled bag${st.delivery?.org?.on ? ` and is going to ${st.delivery.org.label || st.brand?.school || "the school"}, sorted by homeroom` : ""}.${by}` };
    case "delivered": return { heading: st.delivery?.org?.on ? "Delivered to the school" : "Your order is ready", text: st.delivery?.org?.on ? `Your ${st.name} order was delivered to ${st.delivery.org.label || st.brand?.school || "the school"}, sorted by homeroom. The school is handing the bags out.` : `Your ${st.name} order is ready.` };
    default: return null;
  }
}

export const STEP_LABEL = (s: StoreStatus) => STORE_STEPS.find((x) => x.k === s)?.label || s;

/* ------------------------------------------------------------------ close-out */

/** totals to order the blanks: by blank (supplier + style), color and size, from every paid order */
export function blanksNeeded(products: Product[], orders: MerchOrder[]) {
  const live = orders.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status));
  const rows = new Map<string, { supplier: string; style: string; brand: string; color: string; sizes: Record<string, number>; total: number; product: string }>();
  for (const o of live) for (const it of o.items || []) {
    const p = products.find((x) => x.id === it.product_id);
    const youth = p?.imprint?.youth && isYouthSize(it.size) ? p.imprint.youth : null;
    const supplier = youth ? youth.supplier : p?.supplier || "", style = it.style || (youth ? youth.style : p?.style || ""), brand = youth ? youth.brand : p?.brand || "";
    const k = `${supplier}|${style}|${it.color}`;
    const r = rows.get(k) || { supplier, style, brand, color: it.color, sizes: {}, total: 0, product: it.name };
    r.sizes[it.size] = (r.sizes[it.size] || 0) + it.qty; r.total += it.qty;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => a.supplier.localeCompare(b.supplier) || a.style.localeCompare(b.style) || a.color.localeCompare(b.color)).map((r) => ({ ...r, sizeList: Object.keys(r.sizes).sort(bySize) }));
}

/**
 * Make the production job for a closed store: one job in Orders with every blank, color and size, so it goes through
 * art, blanks, the schedule, receiving and check-in like any job. Shoppers already paid, so the job carries no balance.
 */
export async function makeProductionJob(a: MerchAccess, st: Store) {
  if (st.order_id) return st.order_id;
  const [{ data: ps }, orders] = await Promise.all([a.admin.from("merch_products").select("*").eq("store_id", st.id), loadOrders(a.admin, st.id)]);
  const products = (ps || []) as Product[];
  const live = orders.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status));
  if (!live.length) throw new Error("This store has no orders to produce.");
  const groups: Group[] = [];
  for (const p of products) {
    const its = live.flatMap((o) => (o.items || []).filter((i) => i.product_id === p.id));
    if (!its.length) continue;
    const byBlank = new Map<string, Group["lines"][number]>();
    for (const it of its) {
      const youth = p.imprint?.youth && isYouthSize(it.size) ? p.imprint.youth : null;
      const k = `${it.style}|${it.color}`;
      const l = byBlank.get(k) || { id: crypto.randomUUID(), style: it.style || (youth ? youth.style : p.style), brand: youth ? youth.brand : p.brand, garment: "", color: it.color, cost: +(youth ? youth.cost?.[it.size] : p.cost?.[it.size]) || 0, sizes: {}, priceOverride: 0 };
      (l.sizes as Record<string, number>)[it.size] = ((l.sizes as Record<string, number>)[it.size] || 0) + it.qty;
      byBlank.set(k, l);
    }
    groups.push({ id: crypto.randomUUID(), name: p.name, lines: [...byBlank.values()], imprints: [{ id: crypto.randomUUID(), method: (p.imprint?.method || "screen") as "screen", location: p.imprint?.location || "Full Front", colors: p.imprint?.colors || 1, inks: p.imprint?.inks || "", size: p.imprint?.width ? `${p.imprint.width}" wide` : "", notes: "", design_id: p.design_id || undefined }] });
  }
  const pcs = live.reduce((s, o) => s + (o.items || []).reduce((x, i) => x + i.qty, 0), 0);
  const sales = r2(live.reduce((s, o) => s + o.total, 0));
  const { data: job, error } = await a.admin.from("orders").insert({
    customer_id: st.customer_id, nickname: `${st.name} ONLINE STORE`.slice(0, 120), type: "invoice", status: "approved", approved_at: new Date().toISOString(), approved_name: "Merch store (paid by shoppers)",
    due_date: st.deliver_by, groups, lines: [], tax_exempt: true, waive_setup: true, source: "merch", po_number: `STORE ${st.slug}`.slice(0, 60),
    delivery_method: st.delivery?.org?.on ? "deliver" : "pickup", ship_to: st.delivery?.org?.address || "", qty: pcs,
    notes: `Merch store: ${live.length} orders, ${pcs} pcs, ${sales.toLocaleString("en-US", { style: "currency", currency: "USD" })} paid by shoppers online (no balance here). FOLD GARMENTS: every order is packed in its own bag (Merch Stores → ${st.name} → Packing).`,
  }).select("id, number").single();
  if (error) throw new Error(error.message);
  await a.admin.from("merch_stores").update({ order_id: job.id, timeline: withEvent(st, "job", a.email, `production job #${job.number}`), updated_at: new Date().toISOString() }).eq("id", st.id);
  return job.id as string;
}
