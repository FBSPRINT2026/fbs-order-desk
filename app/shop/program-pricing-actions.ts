"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import type { DesignPrice, RateCard } from "@/lib/programs";

/**
 * Program pricing on the order page (Oct 14, Nick): the customer's rate card (with the base shirt's blank cost now),
 * and what they paid before for the same design ("Furry Feline has a reorder of Mewjira: what was the pricing and qtys
 * on the other orders of that design?").
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.money) throw new Error("Prices aren't on for you.");
  return { admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

/** the customer's program: the rate card (with the base shirt's S–XL blank cost from the catalog) and the designs'
 *  own prices (program items); null when they have neither */
export async function programCard(customerId: string) {
  try {
    const { admin } = await me();
    const { data: p } = await admin.from("programs").select("id, name, rate_card").eq("customer_id", customerId).order("created_at").limit(1).maybeSingle();
    if (!p) return { ok: true as const, card: null, baseCost: null, items: [] as DesignPrice[] };
    const { data: its } = await admin.from("program_items").select("id, name, style, price, min_qty, design_id, active").eq("program_id", p.id).eq("active", true);
    const items = ((its || []) as DesignPrice[]).filter((x) => +x.price > 0);
    let card = (p.rate_card || null) as RateCard | null;
    if (card && !Object.values(card.prices || {}).some((x) => +x > 0)) card = null;
    let baseCost: number | null = null;
    if (card) {
      const { data: g } = await admin.from("garments").select("cost, brand").ilike("style", card.base.style.trim()).limit(5);
      const hit = ((g || []) as { cost: number; brand: string }[]).find((x) => !card!.base.brand || x.brand.toLowerCase() === card!.base.brand.toLowerCase()) || (g || [])[0];
      baseCost = hit?.cost ? +hit.cost : card.base.cost ?? null;
    }
    return { ok: true as const, card, baseCost, items };
  } catch (e) { return fail(e); }
}

export type PastPrice = { number: string; date: string; nickname: string; source: "printavo" | "portal"; orderId: string;
  lines: { style: string; color: string; qty: number; price: number; deco: string }[]; fees: string[]; total: number; setup: boolean };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^(shirt|shirts|tees?|hoodies?|order|reorder|print|screen|front|back|with)$/.test(w));

/**
 * Past orders of the same design for this customer, newest first: Printavo history and orders here. Matched by the
 * design names on the order's prints and the order's name ("Mewjira"), so Printavo-era orders (no design links) count.
 */
export async function pastPricesForDesign(input: { customerId: string; orderId: string; terms: string[] }) {
  try {
    const { admin } = await me();
    const keys = [...new Set(input.terms.flatMap(words))].slice(0, 4);
    if (!keys.length) return { ok: true as const, rows: [] as PastPrice[], keys };
    const like = keys.map((k) => `nickname.ilike.%${k}%`).join(",");
    const [{ data: arch }, { data: ours }] = await Promise.all([
      admin.from("archived_orders").select("id, visual_id, order_date, nickname, total, data").eq("customer_id", input.customerId).neq("kind", "quote").or(keys.map((k) => `search_text.ilike.%${k}%`).join(",")).order("order_date", { ascending: false }).limit(12),
      admin.from("orders").select("id, number, created_at, nickname, total, groups, waive_setup, type").eq("customer_id", input.customerId).eq("type", "invoice").neq("id", input.orderId).or(like).order("created_at", { ascending: false }).limit(8),
    ]);
    const rows: PastPrice[] = [];
    type PvLine = { itemNumber?: string; color?: string; items?: number; price?: number; description?: string };
    type PvData = { groups?: { lines?: PvLine[] }[]; fees?: { description?: string; quantity?: number; unitPrice?: number; amount?: number }[] };
    for (const a of (arch || []) as { id: string; visual_id: string; order_date: string; nickname: string; total: number; data: PvData }[]) {
      const lines = (a.data?.groups || []).flatMap((g) => g.lines || []).filter((l) => +(l.items || 0) > 0)
        .map((l) => ({ style: l.itemNumber || "", color: l.color || "", qty: +(l.items || 0), price: +(l.price || 0), deco: (l.description || "").split(/\r?\n/).slice(1).join(" · ").trim() }));
      const fees = (a.data?.fees || []).map((f) => `${f.description || "Fee"}: ${f.quantity && f.unitPrice ? `${f.quantity} × $${(+f.unitPrice).toFixed(2)}` : `$${(+(f.amount || 0)).toFixed(2)}`}`);
      rows.push({ number: a.visual_id, date: a.order_date, nickname: a.nickname || "", source: "printavo", orderId: a.id, lines, fees, total: +a.total || 0, setup: fees.some((f) => /setup|screen/i.test(f)) });
    }
    type OLine = { style?: string; color?: string; sizes?: Record<string, number>; priceOverride?: number | null; prog?: { each: number } };
    for (const o of (ours || []) as { id: string; number: number; created_at: string; nickname: string; total: number; groups: { lines?: OLine[]; imprints?: { location?: string; colors?: number }[] }[]; waive_setup: boolean }[]) {
      const lines = (o.groups || []).flatMap((g) => (g.lines || []).map((l) => ({ l, deco: (g.imprints || []).map((d) => `${d.colors || 1}c ${d.location || ""}`).join(" + ") })))
        .map(({ l, deco }) => ({ style: l.style || "", color: l.color || "", qty: Object.values(l.sizes || {}).reduce((s, n) => s + (+n || 0), 0), price: +(l.priceOverride ?? 0), deco }))
        .filter((l) => l.qty > 0);
      rows.push({ number: String(o.number), date: o.created_at.slice(0, 10), nickname: o.nickname || "", source: "portal", orderId: o.id, lines, fees: [], total: +o.total || 0, setup: !o.waive_setup });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true as const, rows: rows.slice(0, 10), keys };
  } catch (e) { return fail(e); }
}
