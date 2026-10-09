"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, orderGroups, SIZES, type Order } from "@/lib/pricing";
import { ssAllocate, ssConfigured, ssOurCard, ssPlaceOrder } from "@/lib/ss";
import { matchToSS, shopEmails } from "@/lib/ssMatch";

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

export type BlankLine = { key: string; brand: string; style: string; color: string; size: string; qty: number; sku: string; price: number; stock: number; found: boolean; note: string };

/** What an order needs from the supplier: every style/color/size with its quantity, matched to S&S skus with price and stock. */
export async function blanksPlan(orderId: string): Promise<{ ok: boolean; error?: string; lines?: BlankLine[]; ss?: boolean; order?: { number: number; nickname: string; due_date: string | null; customer: string } }> {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, nickname, due_date, groups, lines, customer_id, customers(company, name)").eq("id", orderId).single();
    if (!o) return { ok: false, error: "Order not found." };
    const rows: BlankLine[] = [];
    for (const g of orderGroups(o as unknown as Order)) for (const l of g.lines) for (const z of SIZES) {
      const qty = +(l.sizes?.[z] || 0);
      if (!qty) continue;
      const key = `${l.brand}|${l.style}|${l.color}|${z}`.toLowerCase();
      const have = rows.find((r) => r.key === key);
      if (have) have.qty += qty;
      else rows.push({ key, brand: l.brand || "", style: l.style || "", color: l.color || "", size: z, qty, sku: "", price: 0, stock: 0, found: false, note: "" });
    }
    const ss = ssConfigured();
    if (ss) await matchToSS(admin, rows);
    const c = (o as unknown as { customers: { company: string; name: string } | null }).customers;
    return { ok: true, ss, lines: rows, order: { number: o.number, nickname: o.nickname || "", due_date: o.due_date, customer: c?.company || c?.name || "" } };
  } catch (e) { return fail(e); }
}

/** After blanks are ordered, the job moves to "Blanks Ordered" (unless it's already further along). */
async function markOrdered(admin: ReturnType<typeof createAdminClient>, orderId: string) {
  await admin.from("orders").update({ status: "blanks" }).eq("id", orderId).in("status", ["approved", "art"]);
}

/**
 * Order the blanks from S&S, shipped to our shop. `test: true` is a dry run: S&S creates the order and cancels it
 * right away, so we see stock, price and warehouses without buying anything.
 */
export async function orderBlanksSS(orderId: string, p: { lines: { sku: string; qty: number; label: string }[]; shippingMethod: string; test: boolean }): Promise<{ ok: boolean; error?: string; results?: { orderNumber: string; warehouse: string; total: number; expected: string | null }[] }> {
  try {
    const v = await staff();
    if (!ssConfigured()) return { ok: false, error: "S&S isn't connected (SS_ACCOUNT_NUMBER / SS_API_KEY)." };
    const lines = p.lines.filter((l) => l.sku && l.qty > 0);
    if (!lines.length) return { ok: false, error: "Nothing to order." };
    const admin = createAdminClient();
    const [{ data: o }, { data: st }] = await Promise.all([
      admin.from("orders").select("number, nickname, customers(company, name)").eq("id", orderId).single(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const from = mergeSettings(st?.data).ship.from;
    if (!from.street1 || !from.zip) return { ok: false, error: "Add our street address in Shipping center → Settings first (S&S ships here)." };
    const c = (o as unknown as { customers: { company: string; name: string } | null })?.customers;
    const po = `#${o?.number} ${c?.company || c?.name || o?.nickname || ""}`.trim();
    // paid with our saved card (ending 5488), never the account's terms
    // each line from the closest warehouse that has it (Fort Worth first)
    const alloc = await ssAllocate(lines.map((l) => ({ identifier: l.sku, qty: Math.round(l.qty) })));
    if (alloc.short.length) return { ok: false as const, error: `S&S doesn't have enough of: ${alloc.short.join("; ")}.` };
    const card = await ssOurCard(await shopEmails(v.user?.email));
    if (!card.ok) return { ok: false as const, error: card.error };
    const res = await ssPlaceOrder({
      payment: { email: card.profile.email, profileID: card.profile.profileID },
      lines: alloc.lines, po, test: p.test, shippingMethod: p.shippingMethod,
      shipTo: { customer: from.company || "FBS Print", attn: from.name || "Receiving", address: [from.street1, from.street2].filter(Boolean).join(" "), city: from.city, state: from.state, zip: from.zip },
      email: p.test ? undefined : v.email,
    });
    const results = res.map((r) => ({ orderNumber: r.orderNumber, warehouse: r.warehouseAbbr, total: r.total, expected: r.expectedDeliveryDate }));
    if (!p.test) {
      const expected = results.map((r) => r.expected).filter(Boolean).sort().pop() || null;
      await admin.from("blank_orders").insert({
        order_id: orderId, supplier: "ss", supplier_order: results.map((r) => r.orderNumber).join(", "), po, status: "ordered", placed_via: "api",
        lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, label: l.label })), total: results.reduce((a, r) => a + r.total, 0) || null,
        expected_date: expected ? expected.slice(0, 10) : null, created_by: v.email,
      });
      await markOrdered(admin, orderId);
    }
    return { ok: true, results };
  } catch (e) { return fail(e); }
}

/** Blanks ordered some other way (S&S or SanMar website, phone, another supplier): just record it. */
export async function recordBlanks(orderId: string, p: { supplier: string; supplier_order: string; expected_date: string | null; note: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const { error } = await admin.from("blank_orders").insert({
      order_id: orderId, supplier: (p.supplier || "").trim().slice(0, 60) || "other", supplier_order: (p.supplier_order || "").trim().slice(0, 120),
      expected_date: p.expected_date && /^\d{4}-\d{2}-\d{2}$/.test(p.expected_date) ? p.expected_date : null, note: (p.note || "").trim().slice(0, 1000), placed_via: "manual", created_by: v.email,
    });
    if (error) return { ok: false, error: error.message };
    await markOrdered(admin, orderId);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Blanks for an order are here and counted. */
export async function blanksReceived(blankOrderId: string, received: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    await staff();
    const { error } = await createAdminClient().from("blank_orders").update(received ? { status: "received", received_at: new Date().toISOString() } : { status: "ordered", received_at: null }).eq("id", blankOrderId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return fail(e); }
}
