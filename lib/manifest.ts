import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, orderGroups, type Order } from "@/lib/pricing";
import { carrierOf } from "@/lib/goods";
import { companyKey } from "@/lib/printavoImport";
import { readTracker, startTracker } from "@/lib/goodsTrack";
import { excelDate } from "@/lib/xlsx";

/**
 * Supplier manifests (S&S Activewear today; SanMar once we've seen theirs): every box shipping to us, with the
 * account it was bought on ("Customer Name"), their PO, tracking, and style/color/size/quantities.
 *   - "FBS" is us: blanks we bought for our own (retail) orders.
 *   - Any other name is a wholesale customer buying their own goods: matched to their open wholesale order, the
 *     tracking goes into that order's customer supplied goods (tracked live), and they're told in the goods conversation.
 * Anything we can't match confidently waits in "Manifest lines to match" on the Customer goods page.
 */

export type ManifestLine = {
  ship_date: string | null; customer_name: string; customer_account: string; customer_po: string; invoice: string; box: string; warehouse: string; method: string; tracking: string; weight: number | null;
  sku: string; mill: string; style: string; color: string; size: string; qty_ordered: number; qty_shipped: number; supplier_order: string;
};

/** Column names as suppliers write them (S&S today; SanMar names are added when we see a sample). */
const COLS: Record<keyof ManifestLine | "pro", RegExp> = {
  ship_date: /^ship\s*date$/i, customer_name: /^customer\s*name$/i, customer_account: /^customer\s*account/i, customer_po: /^(customer\s*)?po(\s*(number|#))?$/i, invoice: /invoice/i,
  box: /^(box(\s*(number|#))?|carton(\s*(number|#))?)$/i, warehouse: /^(warehouse|whse)$/i, method: /ship(ping)?\s*method|ship\s*via|^service$/i, tracking: /^tracking/i, pro: /^pro\s*(number|#)/i, weight: /^weight/i,
  sku: /^sku$/i, mill: /^(mill|brand)$/i, style: /^(catalog\s*)?style/i, color: /^(catalog\s*)?colou?r/i, size: /^(catalog\s*)?size$/i,
  qty_ordered: /qty\s*ordered|ordered\s*qty/i, qty_shipped: /qty\s*shipped|shipped\s*qty/i, supplier_order: /^(order\s*(number|#)|sales\s*order)$/i,
};

/** Turn the sheet into lines: finds the header row, then reads every row under it. */
export function parseManifest(rows: string[][]): ManifestLine[] {
  const h = rows.findIndex((r) => r.some((c) => /tracking/i.test(c)) && r.some((c) => /customer\s*name/i.test(c)));
  if (h < 0) throw new Error("This doesn't look like a supplier manifest (no Customer Name / Tracking Number columns).");
  const head = rows[h].map((c) => c.trim());
  const at = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, head.findIndex((c) => re.test(c))])) as Record<keyof ManifestLine | "pro", number>;
  const get = (r: string[], k: keyof ManifestLine | "pro") => (at[k] >= 0 ? (r[at[k]] || "").trim() : "");
  return rows.slice(h + 1).filter((r) => get(r, "customer_name") || get(r, "tracking")).map((r) => {
    const shipped = Math.round(+get(r, "qty_shipped") || 0);
    const pro = get(r, "pro");
    return {
      ship_date: excelDate(get(r, "ship_date")), customer_name: get(r, "customer_name"), customer_account: get(r, "customer_account"), customer_po: get(r, "customer_po"), invoice: get(r, "invoice"),
      box: get(r, "box"), warehouse: get(r, "warehouse"), method: get(r, "method"),
      // freight (LTL) has a PRO number instead of a tracking number
      // (for freight SanMar puts the carton id in the tracking column; the PRO number is what the freight line tracks)
      tracking: (pro || (get(r, "tracking") !== get(r, "box") ? get(r, "tracking") : "")).replace(/\s+/g, ""), weight: +get(r, "weight") || null,
      sku: get(r, "sku"), mill: get(r, "mill"), style: get(r, "style"), color: get(r, "color"), size: get(r, "size"),
      // SanMar lists only what shipped; S&S also lists what was ordered
      qty_ordered: at.qty_ordered >= 0 ? Math.round(+get(r, "qty_ordered") || 0) : shipped, qty_shipped: shipped, supplier_order: get(r, "supplier_order"),
    };
  });
}

const isUs = (name: string) => /^fbs(\s|$|print)/i.test(name.trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const day = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const nextBusinessDay = (d: string) => { const x = new Date(d + "T12:00"); do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0 || x.getDay() === 6); return x.toISOString().slice(0, 10); };
const SUPPLIER_NAME: Record<string, string> = { ss: "S&S Activewear", sanmar: "SanMar" };

export type Group<L = ManifestLine & { id?: string }> = { key: string; supplier: string; customer_name: string; customer_account: string; customer_po: string; supplier_order: string; lines: L[] };

/** Our customer for a supplier account: a saved "who is this?" answer first, then the same company name. */
export async function customerForAccount(admin: SupabaseClient, supplier: string, name: string, account: string): Promise<string[]> {
  const key = companyKey(name);
  const { data: al } = account
    ? await admin.from("supplier_accounts").select("customer_id").eq("supplier", supplier).eq("account", account).limit(1)
    : await admin.from("supplier_accounts").select("customer_id").eq("supplier", supplier).eq("account", "").eq("name_key", key).limit(1);
  const saved = ((al || []) as { customer_id: string }[]).map((x) => x.customer_id);
  if (saved.length) return [saved[0]];
  const { data: cs } = await admin.from("customers").select("id").eq("company_key", key);
  let ids = ((cs || []) as { id: string }[]).map((c) => c.id);
  if (!ids.length && key.length >= 5) {
    const { data: loose } = await admin.from("customers").select("id, company_key").ilike("company_key", `${key.slice(0, 5)}%`).limit(20);
    ids = ((loose || []) as { id: string; company_key: string }[]).filter((c) => c.company_key.startsWith(key) || key.startsWith(c.company_key)).map((c) => c.id);
  }
  return ids;
}
type Candidate = { id: string; number: number; nickname: string; po_number: string; customer_id: string | null; price_type: string; status: string; supplier_po?: string };

/**
 * Our own blanks on a manifest ("FBS"): which retail job they're for. The PO is usually the customer or job name
 * ("Peticolas"), so: exact PO / job name, else the customer's name in the PO, then the garments decide between that
 * customer's open jobs. Looks at orders here and (until go-live) open Printavo orders. `sure` = link without asking.
 */
async function matchBlanks(admin: SupabaseClient, g: Group): Promise<{ orderId: string; kind: "blanks"; how: string; sure: boolean } | null> {
  const po = norm(g.customer_po), core = poCore(g.customer_po);
  const since = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
  const [{ data }, { data: ar }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, po_number, customer_id, price_type, status, due_date, groups, lines, customers(company, name)").in("status", ["approved", "art", "blanks", "production"]).limit(400),
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, customer_id, status_name, due_date, data, customers(company, name)").or(`due_date.gte.${since},due_date.is.null`).limit(600),
  ]);
  type C = Open & { who: string };
  const who = (c: { company: string; name: string } | null) => [c?.company || "", c?.name || ""];
  const list: C[] = [
    ...((data || []) as unknown as (Candidate & { due_date: string | null; customers: { company: string; name: string } | null })[]).map((o) => {
      const items: Open["items"] = [];
      for (const gr of orderGroups(o as unknown as Order)) for (const l of gr.lines) for (const [z, q] of Object.entries(l.sizes || {})) if (q) items.push({ style: l.style || "", brand: l.brand || "", color: l.color || "", size: sizeKey(z), need: +q || 0 });
      return { ...o, items, who: who(o.customers).join("|") };
    }),
    ...((ar || []) as unknown as { id: string; visual_id: string | number; nickname: string; po_number: string; customer_id: string | null; status_name: string; due_date: string | null; data: { groups?: { lines?: { itemNumber?: string; brand?: string; color?: string; sizes?: Record<string, number> }[] }[] }; customers: { company: string; name: string } | null }[])
      .filter((o) => !PV_CLOSED.test(o.status_name || "") && !/^shipping/i.test(o.status_name || ""))
      .map((o): C => {
        const items: Open["items"] = [];
        for (const gr of o.data?.groups || []) for (const l of gr.lines || []) for (const [k, q] of Object.entries(l.sizes || {})) if (+q > 0) items.push({ style: l.itemNumber || "", brand: l.brand || "", color: l.color || "", size: pvSize(k), need: +q });
        return { id: PV + o.id, number: +o.visual_id || 0, nickname: o.nickname || "", po_number: o.po_number || "", customer_id: o.customer_id, price_type: "", status: o.status_name, due_date: o.due_date, items, who: who(o.customers).join("|") };
      }),
  ];
  // how well the shipment's garments fit an order (share of pieces that are on it)
  const fit = (o: C) => { const a = allocate(g.lines as Line[], [o]); const pcs = g.lines.reduce((x, l) => x + l.qty_shipped, 0) || 1; return a.alloc.reduce((x, r) => x + r.line.qty_shipped, 0) / pcs; };
  const exact = list.filter((o) => poHit(o, g));
  const nameHit = (o: C) => { const key = core || po; return key.length >= 4 && o.who.split("|").some((n) => { const c = norm(n); return c.length >= 4 && (c.includes(key) || key.includes(c)); }) || (key.length >= 5 && norm(o.nickname).includes(key)); };
  const byName = exact.length ? [] : list.filter(nameHit);
  const pool = exact.length ? exact : byName;
  if (!pool.length) return null;
  const scored = pool.map((o) => ({ o, f: o.items.length ? fit(o) : 0.5 })).sort((a, b) => b.f - a.f);
  const best = scored[0], next = scored[1];
  if (best.f < 0.5 && pool.length > 1) return null;
  const clear = !next || best.f - next.f >= 0.25;
  const how = `${exact.length ? "PO / job name" : "customer name in PO"}${best.o.items.length ? `; ${Math.round(best.f * 100)}% of the pieces are on #${best.o.number}` : ""}`;
  // sure: one clear order whose garments cover (almost) everything that shipped
  return { orderId: best.o.id, kind: "blanks", how, sure: clear && (best.f >= 0.9 || (!best.o.items.length && pool.length === 1 && exact.length === 1)) };
}

/** The PO without "PO", "#" and spaces: "PO 207" → "207". */
const poCore = (po: string) => norm(po.replace(/^\s*(p\.?\s*o\.?|purchase\s*order)\s*[#:-]?\s*/i, ""));
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/**
 * Does the shipment's PO point at this order? Exact PO, or the PO number standing on its own inside the order's PO or
 * name ("92063" in "PO 92063 RFD Shorts Reorder two"), the order number itself, or the supplier order the customer gave us.
 */
function poHit(o: Candidate, g: { customer_po: string; supplier_order: string }) {
  const po = norm(g.customer_po), core = poCore(g.customer_po), digits = g.customer_po.replace(/\D/g, "");
  if (!po) return false;
  if (norm(o.po_number) === po || norm(o.nickname) === po || (core && (poCore(o.po_number) === core || poCore(o.nickname) === core))) return true;
  if (core.length >= 3 && [...words(o.po_number), ...words(o.nickname)].includes(core)) return true;
  if (digits.length >= 3 && String(o.number) === digits && core === digits) return true;
  return !!o.supplier_po && (norm(o.supplier_po) === po || norm(o.supplier_po) === norm(g.supplier_order));
}

/* ---------- reading the goods: which of the customer's orders each style / color / size belongs to ---------- */

const SIZE_ALIAS: Record<string, string> = { xsmall: "XS", xs: "XS", small: "S", s: "S", medium: "M", med: "M", m: "M", large: "L", lg: "L", l: "L", xlarge: "XL", xl: "XL", xxl: "2XL", xxlarge: "2XL", "2xlarge": "2XL", xxxlarge: "3XL", "3xlarge": "3XL", "4xlarge": "4XL", "5xlarge": "5XL", xxsmall: "XS", "2x": "2XL", "2xl": "2XL", xxxl: "3XL", "3x": "3XL", "3xl": "3XL", xxxxl: "4XL", "4x": "4XL", "4xl": "4XL", "5x": "5XL", "5xl": "5XL", osfa: "OS", os: "OS", onesize: "OS", adjustable: "OS", ys: "YS", ym: "YM", yl: "YL", yxs: "YXS", yxl: "YXL", youthsmall: "YS", youthmedium: "YM", youthlarge: "YL", youthxs: "YXS", youthxl: "YXL" };
export const sizeKey = (z: string) => SIZE_ALIAS[norm(z)] || z.toUpperCase().replace(/\s+/g, "");
const styleEq = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 3 && (l.endsWith(s) || l.startsWith(s)) && /\d/.test(s);
};
const colorEq = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))); };

type Open = Candidate & { due_date: string | null; items: { style: string; brand: string; color: string; size: string; need: number }[] };
type Line = ManifestLine & { id: string; supplier: string; part?: number };
export type Plan = { customerId: string | null; alloc: { line: Line; parts: { orderId: string; qty: number }[] }[]; unplaced: Line[]; auto: boolean; how: string };

/** Printavo orders (our read-only copy) are "pv:<id>" in the matcher, so goods can link to them until go-live. */
export const PV = "pv:";
const PV_CLOSED = /job\s*completed|quote\s*-\s*closed|cancel/i;
/** Printavo size columns ("size_2xl", "size_other") as our sizes. */
const pvSize = (k: string) => sizeKey(k.replace(/^size_/, ""));

/**
 * The customer's open orders with what each still needs (their items minus goods already linked): orders in this
 * system, and (until go-live) their open Printavo orders.
 */
async function openOrders(admin: SupabaseClient, custIds: string[]): Promise<Open[]> {
  if (!custIds.length) return [];
  const since = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
  const [{ data: os }, { data: ar }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, po_number, customer_id, price_type, status, submitted_at, due_date, groups, lines").in("customer_id", custIds).not("status", "in", "(completed,quote)"),
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, customer_id, status_name, due_date, data").in("customer_id", custIds).or(`due_date.gte.${since},due_date.is.null`).limit(200),
  ]);
  const live = ((os || []) as (Candidate & { submitted_at: string | null; due_date: string | null; groups: unknown; lines: unknown })[]).filter((o) => !(o.status === "request" && !o.submitted_at));
  const pv = ((ar || []) as { id: string; visual_id: string | number; nickname: string; po_number: string; customer_id: string | null; status_name: string; due_date: string | null; data: { groups?: { lines?: { itemNumber?: string; brand?: string; color?: string; sizes?: Record<string, number> }[] }[] } }[])
    .filter((o) => !PV_CLOSED.test(o.status_name || ""));
  if (!live.length && !pv.length) return [];
  const liveIds = live.map((o) => o.id), pvIds = pv.map((o) => o.id);
  const [{ data: gd }, { data: have }, { data: havePv }] = await Promise.all([
    liveIds.length ? admin.from("order_goods").select("order_id, supplier_po").in("order_id", liveIds) : Promise.resolve({ data: [] }),
    liveIds.length ? admin.from("supplier_manifest_lines").select("order_id, style, color, size, qty_shipped").in("order_id", liveIds).eq("kind", "goods") : Promise.resolve({ data: [] }),
    pvIds.length ? admin.from("supplier_manifest_lines").select("archived_order_id, style, color, size, qty_shipped").in("archived_order_id", pvIds).eq("kind", "goods") : Promise.resolve({ data: [] }),
  ]);
  const spo = new Map(((gd || []) as { order_id: string; supplier_po: string }[]).map((x) => [x.order_id, x.supplier_po]));
  const useUp = (items: Open["items"], got: { style: string; color: string; size: string; qty_shipped: number }[]) => {
    for (const h of got) {
      let left = h.qty_shipped;
      for (const it of items) if (left > 0 && it.need > 0 && styleEq(it.style, h.style) && colorEq(it.color, h.color) && it.size === sizeKey(h.size)) { const t = Math.min(it.need, left); it.need -= t; left -= t; }
    }
    return items;
  };
  const out: Open[] = live.map((o) => {
    const items: Open["items"] = [];
    for (const g of orderGroups(o as unknown as Order)) for (const l of g.lines) for (const [z, q] of Object.entries(l.sizes || {})) if (q) items.push({ style: l.style || "", brand: l.brand || "", color: l.color || "", size: sizeKey(z), need: +q || 0 });
    // goods already here for this order use up its need
    return { ...o, supplier_po: spo.get(o.id) || "", items: useUp(items, ((have || []) as { order_id: string; style: string; color: string; size: string; qty_shipped: number }[]).filter((x) => x.order_id === o.id)) };
  });
  for (const o of pv) {
    const items: Open["items"] = [];
    for (const g of o.data?.groups || []) for (const l of g.lines || []) for (const [k, q] of Object.entries(l.sizes || {})) if (+q > 0) items.push({ style: l.itemNumber || "", brand: l.brand || "", color: l.color || "", size: pvSize(k), need: +q });
    out.push({ id: PV + o.id, number: +o.visual_id || 0, nickname: o.nickname || "", po_number: o.po_number || "", customer_id: o.customer_id, price_type: "", status: o.status_name, due_date: o.due_date,
      items: useUp(items, ((havePv || []) as { archived_order_id: string; style: string; color: string; size: string; qty_shipped: number }[]).filter((x) => x.archived_order_id === o.id)) });
  }
  return out.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
}

/** Spread the shipment's lines over the orders by what each order is waiting for. `sure` is false when we had to guess. */
function allocate(lines: Line[], orders: Open[]) {
  const alloc: Plan["alloc"] = [], unplaced: Line[] = [];
  let sure = true;
  const need = new Map<string, number>();
  const k = (o: Open, i: number) => `${o.id}:${i}`;
  orders.forEach((o) => o.items.forEach((it, i) => need.set(k(o, i), it.need)));
  for (const line of [...lines].sort((a, b) => b.qty_shipped - a.qty_shipped)) {
    const z = sizeKey(line.size);
    const hits = orders.flatMap((o) => o.items.map((it, i) => ({ o, i, it })).filter(({ it }) => it.size === z && styleEq(it.style, line.style) && colorEq(it.color, line.color)));
    const byOrder = [...new Set(hits.map((h) => h.o.id))];
    if (!byOrder.length) { unplaced.push(line); continue; }
    const left = (id: string) => hits.filter((h) => h.o.id === id).reduce((a, h) => a + (need.get(k(h.o, h.i)) || 0), 0);
    const take = (id: string, q: number) => { let r = q; for (const h of hits.filter((x) => x.o.id === id)) { const n = need.get(k(h.o, h.i)) || 0, t = Math.min(n, r); need.set(k(h.o, h.i), n - t); r -= t; } };
    const open = byOrder.filter((id) => left(id) > 0);
    let parts: { orderId: string; qty: number }[];
    if (byOrder.length === 1) parts = [{ orderId: byOrder[0], qty: line.qty_shipped }];
    else if (open.length === 1) parts = [{ orderId: open[0], qty: line.qty_shipped }];
    else if (open.find((id) => left(id) === line.qty_shipped)) parts = [{ orderId: open.find((id) => left(id) === line.qty_shipped)!, qty: line.qty_shipped }];
    else if (open.length > 1 && open.reduce((a, id) => a + left(id), 0) === line.qty_shipped) parts = open.map((id) => ({ orderId: id, qty: left(id) }));
    else {
      // more than one order wants it and the numbers don't settle it: fill the soonest due first (a guess)
      sure = false;
      parts = []; let r = line.qty_shipped;
      for (const id of open.length ? open : byOrder) { if (r <= 0) break; const t = Math.min(left(id) || r, r); parts.push({ orderId: id, qty: t }); r -= t; }
      if (r > 0) parts[parts.length - 1].qty += r;
    }
    parts.forEach((p) => take(p.orderId, p.qty));
    alloc.push({ line, parts });
  }
  return { alloc, unplaced, sure };
}

/**
 * Work out where a customer's shipment goes.
 *   - PO on the manifest = PO on exactly one order → that order, no questions.
 *   - PO shared by several orders → split by style / color / size; linked automatically when the numbers settle it.
 *   - Anything else → our best guess from what their open orders are waiting for, saved as a suggestion to OK.
 */
export async function planShipment(admin: SupabaseClient, g: Group): Promise<Plan> {
  const custIds = await customerForAccount(admin, g.supplier, g.customer_name, g.customer_account);
  const customerId = custIds.length === 1 ? custIds[0] : null;
  const lines = g.lines as Line[];
  const empty: Plan = { customerId, alloc: [], unplaced: lines, auto: false, how: "" };
  if (!custIds.length) return empty;
  const orders = await openOrders(admin, custIds);
  if (!orders.length) return empty;
  const exact = orders.filter((o) => poHit(o, g));
  if (exact.length === 1) {
    // one order carries this PO: it all goes there (anything it didn't list may be spares or a later change)
    return { customerId, alloc: lines.map((line) => ({ line, parts: [{ orderId: exact[0].id, qty: line.qty_shipped }] })), unplaced: [], auto: true, how: "PO matches the order" };
  }
  if (exact.length > 1) {
    const a = allocate(lines, exact);
    if (!a.unplaced.length) return { customerId, ...a, auto: a.sure, how: `PO on ${exact.length} orders, split by style, color and size` };
    // some lines aren't on any of the PO's orders: look at their other open orders for those (to OK)
    const rest = allocate(a.unplaced, orders.filter((o) => !exact.includes(o)));
    return { customerId, alloc: [...a.alloc, ...rest.alloc], unplaced: rest.unplaced, auto: false, how: `PO on ${exact.length} orders; some items matched other orders` };
  }
  const a = allocate(lines, orders);
  const used = new Set(a.alloc.flatMap((x) => x.parts.map((p) => p.orderId)));
  const how = !a.alloc.length ? "" : `No order has PO ${g.customer_po || "(none)"}; items match ${[...used].map((id) => "#" + orders.find((o) => o.id === id)?.number).join(", ")}`;
  return { customerId, ...a, auto: false, how };
}

/** Split a line between orders (one row per order), returning the rows with their order. */
async function splitLine(admin: SupabaseClient, line: Line, parts: { orderId: string; qty: number }[]) {
  if (parts.length === 1) return [{ line, orderId: parts[0].orderId }];
  const { data: sib } = await admin.from("supplier_manifest_lines").select("part").eq("supplier", line.supplier).eq("supplier_order", line.supplier_order).eq("sku", line.sku).eq("box", line.box).eq("tracking", line.tracking).eq("style", line.style).eq("color", line.color).eq("size", line.size);
  let next = Math.max(0, ...((sib || []) as { part: number }[]).map((x) => x.part)) + 1;
  const out: { line: Line; orderId: string }[] = [];
  const ratio = line.qty_shipped ? line.qty_ordered / line.qty_shipped : 1;
  for (const [i, p] of parts.entries()) {
    const fields = { qty_shipped: p.qty, qty_ordered: Math.round(p.qty * ratio) };
    if (i === 0) { await admin.from("supplier_manifest_lines").update(fields).eq("id", line.id); out.push({ line: { ...line, ...fields }, orderId: p.orderId }); continue; }
    const { id: _id, ...rest } = line as Line & Record<string, unknown>;
    delete (rest as Record<string, unknown>).created_at;
    void _id;
    const { data: row } = await admin.from("supplier_manifest_lines").insert({ ...rest, ...fields, part: next++, order_id: null, archived_order_id: null, kind: "", suggest_order_id: null, suggest_archived_id: null, suggest_how: "" }).select("*").single();
    if (row) out.push({ line: row as Line, orderId: p.orderId });
  }
  return out;
}

/** Link lines to orders now (per order: tracking goes on, the customer is told). */
export async function linkLines(admin: SupabaseClient, g: Group, rows: { line: Line; orderId: string }[], how: string, by: string) {
  const byOrder = new Map<string, Line[]>();
  for (const r of rows) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) || []), r.line]);
  for (const [orderId, ls] of byOrder) {
    const ids = ls.map((l) => l.id);
    if (orderId.startsWith(PV)) {
      // a Printavo order (still being worked in Printavo): the goods are tied to our copy of it; tracking keeps updating
      await admin.from("supplier_manifest_lines").update({ kind: "goods", archived_order_id: orderId.slice(PV.length), order_id: null, match_how: how, linked_by: by, suggest_order_id: null, suggest_archived_id: null, suggest_how: "" }).in("id", ids);
      continue;
    }
    await admin.from("supplier_manifest_lines").update({ linked_by: by, suggest_order_id: null, suggest_archived_id: null, suggest_how: "" }).in("id", ids);
    await applyGroup(admin, g.supplier, { ...g, lines: ls }, orderId, "goods", how);
  }
  return byOrder.size;
}

/** Plan a customer shipment and either link it (sure) or save the suggestion for someone to OK. */
export async function resolveShipment(admin: SupabaseClient, g: Group): Promise<"linked" | "suggested" | "waiting"> {
  const p = await planShipment(admin, g);
  const ids = (g.lines as Line[]).map((l) => l.id);
  if (p.customerId) await admin.from("supplier_manifest_lines").update({ customer_id: p.customerId }).in("id", ids).is("customer_id", null);
  if (!p.alloc.length) { await admin.from("supplier_manifest_lines").update({ suggest_order_id: null, suggest_archived_id: null, suggest_how: "" }).in("id", ids); return "waiting"; }
  const rows: { line: Line; orderId: string }[] = [];
  for (const a of p.alloc) rows.push(...(await splitLine(admin, a.line, a.parts)));
  if (p.auto && !p.unplaced.length) { await linkLines(admin, g, rows, p.how, "auto"); return "linked"; }
  for (const r of rows) await admin.from("supplier_manifest_lines").update(r.orderId.startsWith(PV) ? { suggest_order_id: null, suggest_archived_id: r.orderId.slice(PV.length), suggest_how: p.how } : { suggest_order_id: r.orderId, suggest_archived_id: null, suggest_how: p.how }).eq("id", r.line.id);
  return "suggested";
}

/** Our best guess for our own blanks, saved for someone to OK. */
async function suggestBlanks(admin: SupabaseClient, g: Group, orderId: string, how: string) {
  const ids = g.lines.map((l) => l.id).filter(Boolean) as string[];
  await admin.from("supplier_manifest_lines").update(orderId.startsWith(PV) ? { suggest_order_id: null, suggest_archived_id: orderId.slice(PV.length), suggest_how: how } : { suggest_order_id: orderId, suggest_archived_id: null, suggest_how: how }).in("id", ids);
}

/** Put a matched supplier shipment on the order: goods tracking (wholesale) or just the link (our blanks). */
export async function applyGroup(admin: SupabaseClient, supplier: string, g: Group, orderId: string, kind: "goods" | "blanks", how: string) {
  const ids = g.lines.map((l) => l.id).filter(Boolean) as string[];
  if (orderId.startsWith(PV)) {
    // a Printavo job (still worked in Printavo): tie the lines to our copy of it; tracking keeps updating here
    if (ids.length) await admin.from("supplier_manifest_lines").update({ kind, archived_order_id: orderId.slice(PV.length), order_id: null, match_how: how, suggest_order_id: null, suggest_archived_id: null, suggest_how: "" }).in("id", ids);
    return;
  }
  if (ids.length) await admin.from("supplier_manifest_lines").update({ order_id: orderId, kind, match_how: how }).in("id", ids);
  if (kind === "blanks") return applyBlanks(admin, supplier, g, orderId);
  if (kind !== "goods") return;
  const { data: o } = await admin.from("orders").select("id, number, customer_id, due_date").eq("id", orderId).single();
  if (!o) return;
  const { data: existing } = await admin.from("goods_shipments").select("tracking, note").eq("order_id", orderId);
  const have = new Set(((existing || []) as { tracking: string }[]).map((x) => x.tracking));
  const byTracking = new Map<string, ManifestLine[]>();
  for (const l of g.lines) byTracking.set(l.tracking, [...(byTracking.get(l.tracking) || []), l]);
  const sname = SUPPLIER_NAME[supplier] || supplier;
  let added = 0;
  for (const [trk, ls] of byTracking) {
    const boxes = new Set(ls.map((l) => l.box)).size;
    const pcs = ls.reduce((a, l) => a + l.qty_shipped, 0);
    const style = [...new Set(ls.map((l) => `${l.mill} ${l.style}`.trim()))].slice(0, 3).join(", ");
    if (trk) {
      if (have.has(trk)) continue;
      const carrier = carrierOf(trk) || (/ups/i.test(ls[0].method) ? "UPS" : /fedex/i.test(ls[0].method) ? "FedEx" : (ls[0].method.split(/[-–]/)[0] || "").trim().slice(0, 40));
      const { data: row } = await admin.from("goods_shipments").insert({ order_id: orderId, carrier, tracking: trk, boxes, eta: null, note: `${sname} order ${g.supplier_order} · ${pcs} pcs · ${style}`, files: [], added_by: "staff", author_name: `${sname} manifest`, source: "manifest" }).select("id").single();
      if (row) { const f = await startTracker(trk, carrier).catch(() => null); if (f) await admin.from("goods_shipments").update(f).eq("id", row.id); }
    } else {
      // supplier's own local truck: no tracking; it usually arrives the next business day
      const note = `${sname} local truck (${ls[0].method || "no tracking"}) · order ${g.supplier_order} · ${pcs} pcs · ${style}`;
      if (((existing || []) as { note: string }[]).some((x) => x.note === note)) continue;
      await admin.from("goods_shipments").insert({ order_id: orderId, carrier: sname, tracking: "", boxes, eta: ls[0].ship_date ? nextBusinessDay(ls[0].ship_date) : null, note, files: [], added_by: "staff", author_name: `${sname} manifest`, source: "manifest" });
    }
    added++;
  }
  if (!added) return;
  // goods record: supplier, their order #, ship date; on the way
  const { data: cur } = await admin.from("order_goods").select("status, supplier, supplier_po, ship_date").eq("order_id", orderId).maybeSingle();
  await admin.from("order_goods").upsert({
    order_id: orderId, supplier: cur?.supplier || supplier, supplier_po: cur?.supplier_po || g.supplier_order, ship_date: cur?.ship_date || g.lines[0].ship_date,
    ...(!cur || cur.status === "waiting" ? { status: "on_way" } : {}), updated_by: "manifest", updated_at: new Date().toISOString(),
  }, { onConflict: "order_id" });
  // tell the customer (and flag anything the supplier didn't ship)
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const shop = mergeSettings(st?.data).shop.name;
  const pcs = g.lines.reduce((a, l) => a + l.qty_shipped, 0), ordered = g.lines.reduce((a, l) => a + l.qty_ordered, 0);
  const boxes = new Set(g.lines.map((l) => `${l.tracking}|${l.box}`)).size;
  const methods = [...new Set(g.lines.map((l) => l.method).filter(Boolean))].join(", ");
  const short = g.lines.filter((l) => l.qty_shipped < l.qty_ordered);
  let body = `📦 ${sname} shipped your goods for #${o.number}${g.lines[0].ship_date ? ` on ${day(g.lines[0].ship_date)}` : ""}: ${boxes} box${boxes === 1 ? "" : "es"}${methods ? ` (${methods})` : ""}, ${pcs} piece${pcs === 1 ? "" : "s"}. Tracking updates here automatically.`;
  if (short.length) body += `\n\n⚠️ ${sname} shipped ${pcs} of ${ordered} pieces. Not shipped yet: ${short.slice(0, 8).map((l) => `${l.style} ${l.color} ${l.size} (${l.qty_ordered - l.qty_shipped})`).join(", ")}${short.length > 8 ? "…" : ""}. Please check with ${sname} whether these are backordered.`;
  await admin.from("messages").insert({ order_id: orderId, topic: "goods", author_type: "staff", author_email: "", author_name: shop, body });
  if (short.length) {
    const { data: c } = o.customer_id ? await admin.from("customers").select("email").eq("id", o.customer_id).maybeSingle() : { data: null };
    const subject = `Part of your goods for #${o.number} didn't ship`;
    if (c?.email) await sendEmail({ to: c.email, replyTo: SHOP_NOTIFY_EMAIL, subject, html: emailLayout(shop, subject, body, "Open your portal", `${siteUrl()}/portal?area=messages&c=${orderId}:goods`) }).catch(() => false);
    if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `[Goods] ${subject}`, html: emailLayout(shop, subject, body, "Open order", `${siteUrl()}/shop/orders/${orderId}`) }).catch(() => false);
  }
}

/** Save a manifest's lines (skipping ones we already have), then match and apply every shipment we can. */
export async function importManifest(admin: SupabaseClient, supplier: "ss" | "sanmar", lines: ManifestLine[], fileName: string) {
  const rows = lines.map((l) => ({ ...l, supplier, part: 0, file_name: fileName.slice(0, 200) }));
  const { data: saved, error } = await admin.from("supplier_manifest_lines").upsert(rows, { onConflict: "supplier,supplier_order,sku,box,tracking,style,color,size,part", ignoreDuplicates: true }).select("*");
  if (error) throw new Error(error.message);
  const fresh = (saved || []) as (ManifestLine & { id: string; kind: string })[];
  const groups = new Map<string, Group>();
  for (const l of fresh) {
    const key = `${l.customer_name}|${l.customer_account}|${l.customer_po}|${l.supplier_order}`;
    if (!groups.has(key)) groups.set(key, { key, supplier, customer_name: l.customer_name, customer_account: l.customer_account, customer_po: l.customer_po, supplier_order: l.supplier_order, lines: [] });
    groups.get(key)!.lines.push(l);
  }
  const out = { lines: lines.length, new: fresh.length, shipments: groups.size, matched: 0, blanks: 0, suggested: 0, unmatched: 0 };
  for (const g of groups.values()) {
    if (isUs(g.customer_name)) {
      const m = await matchBlanks(admin, g).catch(() => null);
      if (m?.sure) { await applyGroup(admin, supplier, g, m.orderId, m.kind, m.how); out.blanks++; }
      else { if (m) { await suggestBlanks(admin, g, m.orderId, m.how); out.suggested++; } else out.unmatched++; }
      await trackWaiting(admin, g.lines as Line[]).catch(() => null);
      continue;
    }
    const r = await resolveShipment(admin, g).catch(() => "waiting" as const);
    if (r === "linked") out.matched++; else if (r === "suggested") out.suggested++; else out.unmatched++;
    await trackWaiting(admin, g.lines as Line[]).catch(() => null);
  }
  return out;
}

/** Live tracking for a shipment we can't put on an order yet (so it still shows as on the way / arrived). */
async function trackWaiting(admin: SupabaseClient, lines: Line[]) {
  for (const trk of [...new Set(lines.map((l) => l.tracking).filter(Boolean))]) {
    const l = lines.find((x) => x.tracking === trk)!;
    const f = await startTracker(trk, carrierOf(trk) || (/ups/i.test(l.method) ? "UPS" : /fedex/i.test(l.method) ? "FedEx" : "")).catch(() => null);
    if (f) await admin.from("supplier_manifest_lines").update(f).eq("supplier", l.supplier).eq("tracking", trk).in("kind", ["", "goods", "blanks"]).is("order_id", null);
  }
}

type Waiting = Line & { customer_id: string | null; suggest_order_id: string | null; suggest_archived_id: string | null; suggest_how: string; track_status: string; track_detail: string; est_delivery: string | null; delivered_at: string | null; tracker_id: string; track_updated_at: string | null; created_at: string };
const groupKey = (l: Line) => `${l.supplier}|${l.customer_name}|${l.customer_account}|${l.customer_po}|${l.supplier_order}`;
function groupLines(lines: Waiting[]) {
  const m = new Map<string, Group<Waiting>>();
  for (const l of lines) {
    const key = groupKey(l);
    if (!m.has(key)) m.set(key, { key, supplier: l.supplier, customer_name: l.customer_name, customer_account: l.customer_account, customer_po: l.customer_po, supplier_order: l.supplier_order, lines: [] });
    m.get(key)!.lines.push(l);
  }
  return [...m.values()];
}

/**
 * The resolution pass (every 20 minutes with tracking): try every unlinked customer shipment again. New orders or a PO
 * added to an order link automatically; otherwise a fresh best guess is saved for someone to OK. Also refreshes tracking.
 */
export async function resolvePending(admin: SupabaseClient, deadline: number) {
  const { data } = await admin.from("supplier_manifest_lines").select("*").eq("kind", "").order("created_at").limit(3000);
  const out = { linked: 0, suggested: 0, tracked: 0 };
  for (const g of groupLines((data || []) as Waiting[])) {
    if (Date.now() > deadline - 15000) break;
    if (isUs(g.customer_name)) {
      const m = await matchBlanks(admin, g).catch(() => null);
      if (m?.sure) { await applyGroup(admin, g.supplier, g, m.orderId, m.kind, m.how); out.linked++; }
      else if (m && !g.lines.some((l) => l.suggest_order_id || l.suggest_archived_id)) { await suggestBlanks(admin, g, m.orderId, m.how); out.suggested++; }
      continue;
    }
    const had = g.lines.some((l) => l.suggest_order_id || l.suggest_archived_id);
    const p = await planShipment(admin, g).catch(() => null);
    if (!p) continue;
    if (p.customerId && g.lines.some((l) => !l.customer_id)) await admin.from("supplier_manifest_lines").update({ customer_id: p.customerId }).in("id", g.lines.map((l) => l.id));
    if (p.auto && !p.unplaced.length) {
      const rows: { line: Line; orderId: string }[] = [];
      for (const a of p.alloc) rows.push(...(await splitLine(admin, a.line, a.parts)));
      await linkLines(admin, g, rows, p.how, "auto"); out.linked++; continue;
    }
    // keep an existing suggestion as it is (someone may be looking at it); make one when there's none yet
    if (!had && p.alloc.length) { await resolveShipment(admin, g); out.suggested++; }
  }
  // tracking for shipments still waiting for an order
  const trk = new Map<string, Waiting>();
  const { data: pvLinked } = await admin.from("supplier_manifest_lines").select("*").in("kind", ["goods", "blanks"]).not("archived_order_id", "is", null).neq("track_status", "delivered").neq("tracking", "").limit(1000);
  for (const l of [...((data || []) as Waiting[]), ...((pvLinked || []) as Waiting[])]) if (l.tracking && l.track_status !== "delivered" && !trk.has(l.tracking)) trk.set(l.tracking, l);
  for (const l of trk.values()) {
    if (Date.now() > deadline - 10000) break;
    if (l.track_updated_at && Date.now() - Date.parse(l.track_updated_at) < 25 * 60000) continue;
    const f = l.tracker_id ? await readTracker(l.tracker_id).catch(() => null) : await startTracker(l.tracking, carrierOf(l.tracking)).catch(() => null);
    if (f) { await admin.from("supplier_manifest_lines").update(f).eq("tracking", l.tracking).in("kind", ["", "goods", "blanks"]).is("order_id", null); out.tracked++; }
  }
  return out;
}

export type PendingLine = { id: string; style: string; mill: string; color: string; size: string; qty: number; ordered: number; suggest: string | null };
export type PendingShipment = {
  key: string; supplier: string; customer_name: string; customer_account: string; customer_po: string; supplier_order: string; ship_date: string | null;
  boxes: number; pcs: number; methods: string; styles: string; lineIds: string[]; customer: { id: string; name: string } | null; us: boolean;
  tracking: { carrier: string; tracking: string; status: string; detail: string; eta: string | null; delivered: boolean }[]; how: string; lines: PendingLine[];
  orders: { id: string; number: number; nickname: string; po: string; due_date: string | null; printavo: boolean }[];
};

function summarize(g: Group<Waiting>, customer: { id: string; name: string } | null, orders: PendingShipment["orders"]): PendingShipment {
  const trk = new Map<string, PendingShipment["tracking"][number]>();
  for (const l of g.lines) if (l.tracking && !trk.has(l.tracking)) trk.set(l.tracking, { carrier: carrierOf(l.tracking) || (/ups/i.test(l.method) ? "UPS" : /fedex/i.test(l.method) ? "FedEx" : ""), tracking: l.tracking, status: l.track_status, detail: l.track_detail, eta: l.est_delivery || (l.ship_date ? null : null), delivered: l.track_status === "delivered" });
  const noTrk = g.lines.find((l) => !l.tracking);
  // no tracking (the supplier's local truck): due the next business day; "delivered" only when someone marks it received
  const here = !!noTrk && g.lines.filter((l) => !l.tracking).every((l) => l.track_status === "delivered");
  if (noTrk) trk.set("", { carrier: SUPPLIER_NAME[g.supplier] || g.supplier, tracking: "", status: here ? "delivered" : "", detail: noTrk.method || "local truck", eta: noTrk.ship_date ? nextBusinessDay(noTrk.ship_date) : null, delivered: here });
  return {
    key: g.key, supplier: g.supplier, customer_name: g.customer_name, customer_account: g.customer_account, customer_po: g.customer_po, supplier_order: g.supplier_order,
    ship_date: g.lines[0].ship_date, boxes: new Set(g.lines.map((l) => `${l.tracking}|${l.box}`)).size, pcs: g.lines.reduce((a, l) => a + l.qty_shipped, 0),
    methods: [...new Set(g.lines.map((l) => l.method).filter(Boolean))].join(", "), styles: [...new Set(g.lines.map((l) => `${l.mill} ${l.style}`.trim()))].slice(0, 3).join(", "),
    lineIds: g.lines.map((l) => l.id), customer, us: isUs(g.customer_name), tracking: [...trk.values()], how: g.lines.find((l) => l.suggest_how)?.suggest_how || "",
    // one row per style / color / size (a size can be in several boxes)
    lines: Object.values(g.lines.reduce((m, l) => {
      const sug = l.suggest_order_id || (l.suggest_archived_id ? PV + l.suggest_archived_id : null);
      const k = `${l.mill}|${l.style}|${l.color}|${l.size}|${sug || ""}`;
      const x = m[k] || (m[k] = { id: l.id, ids: [] as string[], style: l.style, mill: l.mill, color: l.color, size: l.size, qty: 0, ordered: 0, suggest: sug });
      x.ids.push(l.id); x.qty += l.qty_shipped; x.ordered += l.qty_ordered; return m;
    }, {} as Record<string, PendingLine & { ids: string[] }>)).map((x) => ({ ...x, id: x.ids.join(",") })),
    orders,
  };
}

/** Every shipment on a manifest that isn't on an order yet (the resolution center), with the customer's open orders to pick from. */
export async function unmatchedGroups(admin: SupabaseClient, onlyCustomers?: string[]): Promise<PendingShipment[]> {
  let q = admin.from("supplier_manifest_lines").select("*").eq("kind", "").order("created_at", { ascending: false }).limit(3000);
  if (onlyCustomers) q = q.in("customer_id", onlyCustomers.length ? onlyCustomers : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  const out: PendingShipment[] = [];
  const custCache = new Map<string, { id: string; name: string } | null>(), orderCache = new Map<string, PendingShipment["orders"]>();
  for (const g of groupLines((data || []) as Waiting[])) {
    let customer: { id: string; name: string } | null = null;
    if (!isUs(g.customer_name)) {
      const cid = g.lines.find((l) => l.customer_id)?.customer_id || (await customerForAccount(admin, g.supplier, g.customer_name, g.customer_account).then((ids) => (ids.length === 1 ? ids[0] : null)));
      if (cid) {
        if (!custCache.has(cid)) { const { data: c } = await admin.from("customers").select("id, company, name").eq("id", cid).maybeSingle(); custCache.set(cid, c ? { id: c.id, name: c.company || c.name } : null); }
        customer = custCache.get(cid) || null;
      }
    }
    let orders: PendingShipment["orders"] = [];
    if (customer) {
      if (!orderCache.has(customer.id)) {
        const since = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
        const [{ data: os }, { data: ar }] = await Promise.all([
          admin.from("orders").select("id, number, nickname, po_number, due_date, status, submitted_at").eq("customer_id", customer.id).not("status", "in", "(completed,quote)").order("number", { ascending: false }).limit(60),
          admin.from("archived_orders").select("id, visual_id, nickname, po_number, due_date, status_name").eq("customer_id", customer.id).or(`due_date.gte.${since},due_date.is.null`).order("visual_id", { ascending: false }).limit(60),
        ]);
        orderCache.set(customer.id, [
          ...((os || []) as { id: string; number: number; nickname: string; po_number: string; due_date: string | null; status: string; submitted_at: string | null }[]).filter((o) => !(o.status === "request" && !o.submitted_at)).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", po: o.po_number || "", due_date: o.due_date, printavo: false })),
          ...((ar || []) as { id: string; visual_id: string | number; nickname: string; po_number: string; due_date: string | null; status_name: string }[]).filter((o) => !PV_CLOSED.test(o.status_name || "")).map((o) => ({ id: PV + o.id, number: +o.visual_id || 0, nickname: o.nickname || "", po: o.po_number || "", due_date: o.due_date, printavo: true })),
        ]);
      }
      orders = orderCache.get(customer.id) || [];
    }
    if (!customer) {
      // our blanks (or unknown account): the order(s) we guessed, so the guess can be shown and OK'd
      const liveIds = [...new Set(g.lines.map((l) => l.suggest_order_id).filter(Boolean))] as string[];
      const pvIds = [...new Set(g.lines.map((l) => l.suggest_archived_id).filter(Boolean))] as string[];
      const [{ data: lo }, { data: po }] = await Promise.all([
        liveIds.length ? admin.from("orders").select("id, number, nickname, po_number, due_date, customers(company, name)").in("id", liveIds) : Promise.resolve({ data: [] }),
        pvIds.length ? admin.from("archived_orders").select("id, visual_id, nickname, po_number, due_date, customers(company, name)").in("id", pvIds) : Promise.resolve({ data: [] }),
      ]);
      type R = { id: string; number?: number; visual_id?: string | number; nickname: string; po_number: string; due_date: string | null; customers: { company: string; name: string } | null };
      orders = [
        ...((lo || []) as unknown as R[]).map((o) => ({ id: o.id, number: o.number || 0, nickname: [o.customers?.company || o.customers?.name, o.nickname].filter(Boolean).join(" · "), po: o.po_number || "", due_date: o.due_date, printavo: false })),
        ...((po || []) as unknown as R[]).map((o) => ({ id: PV + o.id, number: +(o.visual_id || 0), nickname: [o.customers?.company || o.customers?.name, o.nickname].filter(Boolean).join(" · "), po: o.po_number || "", due_date: o.due_date, printavo: true })),
      ];
    }
    out.push(summarize(g, customer, orders));
  }
  return out;
}

/** Link a waiting shipment's lines to orders by hand (staff or the customer). `pick`: line id → order id. */
export async function linkByHand(admin: SupabaseClient, pick: { lineId: string; orderId: string }[], by: string, allowedCustomers?: string[]) {
  const ids = pick.map((p) => p.lineId);
  const { data } = await admin.from("supplier_manifest_lines").select("*").in("id", ids).eq("kind", "");
  const lines = (data || []) as Waiting[];
  if (!lines.length) throw new Error("Those goods were already linked (or are gone).");
  const orderIds = [...new Set(pick.map((p) => p.orderId))];
  const liveIds = orderIds.filter((id) => !id.startsWith(PV)), pvIds = orderIds.filter((id) => id.startsWith(PV)).map((id) => id.slice(PV.length));
  const [{ data: lo }, { data: po }] = await Promise.all([
    liveIds.length ? admin.from("orders").select("id, customer_id").in("id", liveIds) : Promise.resolve({ data: [] }),
    pvIds.length ? admin.from("archived_orders").select("id, customer_id").in("id", pvIds) : Promise.resolve({ data: [] }),
  ]);
  const os = [...(lo || []), ...(po || [])];
  if (os.length !== orderIds.length) throw new Error("Pick an order.");
  if (allowedCustomers && ((os || []) as { customer_id: string | null }[]).some((o) => !o.customer_id || !allowedCustomers.includes(o.customer_id))) throw new Error("That isn't one of your orders.");
  if (allowedCustomers && lines.some((l) => !l.customer_id || !allowedCustomers.includes(l.customer_id))) throw new Error("Those goods aren't on your account.");
  let n = 0;
  for (const g of groupLines(lines)) {
    const rows = g.lines.map((line) => ({ line, orderId: pick.find((p) => p.lineId === line.id)!.orderId }));
    const accepted = rows.every((r) => (r.line.suggest_order_id || (r.line.suggest_archived_id ? PV + r.line.suggest_archived_id : null)) === r.orderId);
    n += await linkLines(admin, g, rows, accepted ? `suggestion OK'd (${by})` : `linked by ${by}`, by);
  }
  return n;
}

/**
 * "Who is GUNPOWDER & WHISKEY?" → Cowboy Cool: remember it (by account number when the supplier gives one, else by name)
 * and try again to match every waiting shipment from that account.
 */
export async function rememberAccount(admin: SupabaseClient, supplier: string, name: string, account: string, customerId: string) {
  await admin.from("supplier_accounts").upsert({ supplier, account: account || "", name_key: account ? "" : companyKey(name), name, customer_id: customerId }, { onConflict: "supplier,account,name_key" });
  const { data } = await admin.from("supplier_manifest_lines").select("*").eq("kind", "").eq("supplier", supplier).eq(account ? "customer_account" : "customer_name", account || name);
  const groups = new Map<string, Group>();
  for (const l of (data || []) as (ManifestLine & { id: string })[]) {
    const key = `${l.customer_po}|${l.supplier_order}`;
    if (!groups.has(key)) groups.set(key, { key, supplier, customer_name: l.customer_name, customer_account: l.customer_account, customer_po: l.customer_po, supplier_order: l.supplier_order, lines: [] });
    groups.get(key)!.lines.push(l);
  }
  let matched = 0;
  for (const g of groups.values()) { if ((await resolveShipment(admin, g).catch(() => "waiting")) === "linked") matched++; }
  return { shipments: groups.size, matched };
}

/** Our own blanks on a manifest: packages go on the order (tracked live); the blanks order is created if nobody recorded it. */
async function applyBlanks(admin: SupabaseClient, supplier: string, g: Group, orderId: string) {
  const sname = SUPPLIER_NAME[supplier] || supplier;
  const { data: bo } = await admin.from("blank_orders").select("id, supplier_order").eq("order_id", orderId).neq("status", "cancelled").order("created_at", { ascending: false });
  let blankId = ((bo || []) as { id: string; supplier_order: string }[]).find((b) => b.supplier_order.includes(g.supplier_order))?.id || (bo || [])[0]?.id;
  if (!blankId) {
    const { data: made } = await admin.from("blank_orders").insert({ order_id: orderId, supplier, supplier_order: g.supplier_order, po: g.customer_po, status: "ordered", placed_via: "manifest",
      lines: g.lines.map((l) => ({ sku: l.sku, qty: l.qty_ordered, label: `${l.style} ${l.color} ${l.size}` })), created_by: `${sname} manifest` }).select("id").single();
    blankId = made?.id;
    await admin.from("orders").update({ status: "blanks" }).eq("id", orderId).in("status", ["approved", "art"]);
  }
  const { data: existing } = await admin.from("blank_shipments").select("tracking, note").eq("order_id", orderId);
  const have = new Set(((existing || []) as { tracking: string }[]).map((x) => x.tracking));
  const byTracking = new Map<string, ManifestLine[]>();
  for (const l of g.lines) byTracking.set(l.tracking, [...(byTracking.get(l.tracking) || []), l]);
  for (const [trk, ls] of byTracking) {
    const boxes = new Set(ls.map((l) => l.box)).size, pcs = ls.reduce((a, l) => a + l.qty_shipped, 0);
    const note = `${sname} order ${g.supplier_order}${trk ? "" : ` · ${ls[0].method || "local truck, no tracking"}`}`;
    if (trk ? have.has(trk) : ((existing || []) as { note: string }[]).some((x) => x.note === note)) continue;
    const carrier = carrierOf(trk) || (/ups/i.test(ls[0].method) ? "UPS" : /fedex/i.test(ls[0].method) ? "FedEx" : trk ? (ls[0].method.split(/[-–]/)[0] || "").trim() : sname);
    const { data: row } = await admin.from("blank_shipments").insert({ order_id: orderId, blank_order_id: blankId || null, supplier, carrier, tracking: trk, boxes, pcs, note, eta: !trk && ls[0].ship_date ? nextBusinessDay(ls[0].ship_date) : null, source: "manifest" }).select("id").single();
    if (row && trk) { const f = await startTracker(trk, carrier).catch(() => null); if (f) await admin.from("blank_shipments").update(f).eq("id", row.id); }
  }
}
export const __test = { allocate, styleEq, colorEq };

export type PrintavoGoods = { kind: "goods" | "blanks"; lineIds: string[]; archivedId: string; number: number; nickname: string; customer: string; due_date: string | null; supplier: string; supplier_order: string; pcs: number; boxes: number; tracking: PendingShipment["tracking"]; delivered: boolean; eta: string | null };
/** Goods linked to Printavo orders (until go-live), shipment by shipment, for Goods & receiving. Delivered ones for 10 days. */
export async function printavoGoods(admin: SupabaseClient): Promise<PrintavoGoods[]> {
  // two links to archived_orders (linked + guessed): name the one we mean, or the query fails and returns nothing
  const { data, error } = await admin.from("supplier_manifest_lines").select("*, archived_orders!supplier_manifest_lines_archived_order_id_fkey(visual_id, nickname, due_date, customers(company, name))").in("kind", ["goods", "blanks"]).not("archived_order_id", "is", null).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(`Goods on Printavo jobs: ${error.message}`);
  type Row = Waiting & { archived_order_id: string; archived_orders: { visual_id: string | number; nickname: string; due_date: string | null; customers: { company: string; name: string } | null } | null };
  const m = new Map<string, Row[]>();
  for (const l of (data || []) as Row[]) { const k = `${l.archived_order_id}|${l.supplier}|${l.supplier_order}|${(l as Row & { kind: string }).kind}`; m.set(k, [...(m.get(k) || []), l]); }
  const out: PrintavoGoods[] = [];
  for (const ls of m.values()) {
    const f = ls[0], a = f.archived_orders;
    const s = summarize({ key: "", supplier: f.supplier, customer_name: f.customer_name, customer_account: f.customer_account, customer_po: f.customer_po, supplier_order: f.supplier_order, lines: ls }, null, []);
    const delivered = s.tracking.length > 0 && s.tracking.every((t) => t.delivered);
    const lastDelivered = ls.map((l) => l.delivered_at).filter(Boolean).sort().pop();
    if (delivered && lastDelivered && Date.now() - Date.parse(lastDelivered) > 10 * 86400000) continue;
    out.push({ kind: (f as Row & { kind: string }).kind === "blanks" ? "blanks" : "goods", lineIds: ls.map((l) => l.id), archivedId: f.archived_order_id, number: +(a?.visual_id || 0), nickname: a?.nickname || "", customer: a?.customers?.company || a?.customers?.name || f.customer_name, due_date: a?.due_date || null, supplier: f.supplier, supplier_order: f.supplier_order, pcs: s.pcs, boxes: s.boxes, tracking: s.tracking, delivered, eta: s.tracking.map((t) => t.eta).filter(Boolean).sort().pop() || null });
  }
  return out.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
}

/** Received & counted (or undo) for manifest lines tied to a Printavo job: local trucks never report delivery themselves. */
export async function markReceived(admin: SupabaseClient, lineIds: string[], yes: boolean, by: string) {
  if (!lineIds.length) return;
  await admin.from("supplier_manifest_lines").update(yes
    ? { track_status: "delivered", delivered_at: new Date().toISOString(), track_detail: `Received & counted by ${by}` }
    : { track_status: "", delivered_at: null, track_detail: "" }).in("id", lineIds).is("order_id", null);
}
