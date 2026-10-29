import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandKey } from "@/lib/supplierBrands";
import { carrierOf } from "@/lib/goods";
import { startTracker } from "@/lib/goodsTrack";

/**
 * One Stop (onestopinc.com, Michigan): our third goods supplier, after S&S and SanMar (Oct 29, Nick: "usually our third
 * choice… when S&S and SanMar are out of a specific size or color… some of their product names are goofy… a Next Level
 * 6210 is NL207CVC"). Their REST API (api.onestopinc.com/documentation): `Authorization: Token <ONESTOP_API_TOKEN>`,
 * 60 calls a minute, ordering paused a few minutes between 5 and 6:30 am Eastern.
 *
 * Their codes don't follow the maker's, but every item carries the maker ("mill_name": Next Level Apparel) and the
 * maker's own style number ("mill_style_code": 6210), and each size its barcode (GTIN). So a garment is found by its
 * style number and brand, never by their code: `osStyle("Next Level", "6210")`.
 *
 * Everything uses their live system (our token isn't valid on their test system). The check before ordering is their
 * preflight, which never creates an order; placing an order waits for ONESTOP_ORDERS=on.
 */
const LIVE = "https://api.onestopinc.com/";
const TEST = "https://api-test.onestopinc.com/";
/** the token as pasted: just the code, even if "Token …", quotes or spaces came along with it */
const osToken = () => String(process.env.ONESTOP_API_TOKEN || "").trim().replace(/^["']|["']$/g, "").replace(/^(authorization:\s*)?token\s+/i, "").replace(/[\s\u200b-\u200d\ufeff]+/g, ""); // spaces and hidden characters that come along with a copy
export const osConfigured = () => !!osToken();
export const osOrdersLive = () => process.env.ONESTOP_ORDERS?.trim().toLowerCase() === "on";

export class OneStopError extends Error {}

/** is the token good, and on which of their systems (a token from their test dashboard only works on test)? */
export async function osPing(): Promise<{ live: string; test: string; token: { length: number; hex: boolean; otherChars: number } }> {
  const t = osToken();
  const one = async (test: boolean) => { try { await os("ping/", { test }); return "ok"; } catch (e) { return e instanceof Error ? e.message : String(e); } };
  // the token's shape only (never the token): their tokens are 40 letters and digits
  return { live: await one(false), test: await one(true), token: { length: t.length, hex: /^[0-9a-f]+$/i.test(t), otherChars: t.replace(/[0-9a-z]/gi, "").length } };
}

async function os<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown; test?: boolean; timeoutMs?: number }): Promise<T> {
  const token = osToken();
  if (!token) throw new OneStopError("One Stop isn't connected (ONESTOP_API_TOKEN in Vercel).");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init?.timeoutMs || 25_000);
  try {
    const r = await fetch((init?.test ? TEST : LIVE) + path.replace(/^\//, ""), {
      method: init?.method || "GET", cache: "no-store", signal: ctrl.signal,
      headers: { Authorization: `Token ${token}`, Accept: "application/json; version=1.0", "Content-Type": "application/json" },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const j = await r.json().catch(() => null) as Record<string, unknown> | null;
    const msg = j && (typeof j.detail === "string" ? j.detail : typeof j.error === "string" ? j.error : "");
    if (!r.ok || msg) throw new OneStopError(`One Stop: ${msg || `HTTP ${r.status}`}`);
    return j as T;
  } catch (e) {
    if (e instanceof OneStopError) throw e;
    throw new OneStopError(`One Stop didn't answer (${e instanceof Error ? e.message : String(e)}).`);
  } finally { clearTimeout(t); }
}

/** one size of a One Stop garment */
export type OsItem = {
  code: string; gtin: string; brand: string; millStyle: string; style: string; name: string;
  color: string; colorCode: string; size: string; sizeNumber: string; tracking: number; onHand: number;
};
type Raw = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v)).trim();

/** their item record, whichever of their response shapes it came in */
function item(r: Raw): OsItem {
  return {
    code: s(r.code || r.onestop_code || r.sku_code), gtin: s(r.gtin), brand: s(r.mill_name || r.mill), millStyle: s(r.mill_style_code),
    style: s(r.style || r.style_code), name: s(r.web_name || r.description), color: s(r.color_name), colorCode: s(r.color_code),
    size: s(r.size_code || r.size), sizeNumber: s(r.size_number), tracking: +(r.tracking_number as number) || 0, onHand: +(r.on_hand as number) || 0,
  };
}
const results = (j: unknown): Raw[] => {
  const x = (j as { results?: unknown })?.results;
  return Array.isArray(x) ? (x as Raw[]) : [];
};

/**
 * A maker's style at One Stop: every color and size, by the maker's style number and brand ("Next Level", "6210").
 * Their style numbers can hide extra letters (6210 / 6210L): the number must match exactly, and the brand loosely
 * (Next Level = Next Level Apparel). Cached a day in onestop_styles.
 */
export async function osStyle(admin: SupabaseClient, brand: string, style: string): Promise<OsItem[]> {
  const st = s(style).toUpperCase(), bk = brandKey(brand);
  if (!st) return [];
  const key = `${bk}|${st}`;
  const { data: c } = await admin.from("onestop_styles").select("items, fetched_at").eq("key", key).maybeSingle();
  if (c && Date.now() - Date.parse(c.fetched_at as string) < 864e5) return (c.items || []) as OsItem[];
  // the maker's number, and their own style code as a fallback (a brand that puts its number in their code)
  const found: OsItem[] = [];
  for (const q of [`items/?mill_style_code=${encodeURIComponent(st)}&supplies=false`, `items/?style=${encodeURIComponent(st)}&supplies=false`]) {
    let page = 1;
    while (page <= 5) {
      const j = await os<{ results?: Raw[] }>(`${q}&page=${page}`);
      const rs = results(j).map(item);
      found.push(...rs);
      if (rs.length < 1000) break;
      page++;
    }
    if (found.length) break;
  }
  const mine = found.filter((x) => (!bk || !x.brand || brandKey(x.brand).startsWith(bk) || bk.startsWith(brandKey(x.brand))) && (x.millStyle.toUpperCase() === st || x.style.toUpperCase().endsWith(st)));
  await admin.from("onestop_styles").upsert({ key, brand, style: st, items: mine, fetched_at: new Date().toISOString() });
  return mine;
}

/** today's stock and our price (dollars) for One Stop codes, 50 at a time */
export async function osPrices(codes: string[]): Promise<Map<string, { onHand: number; price: number; gtin: string }>> {
  const out = new Map<string, { onHand: number; price: number; gtin: string }>();
  const list = [...new Set(codes.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const j = await os<{ results?: Record<string, Raw>[] }>(`items/pricing/?skus=${list.slice(i, i + 50).map(encodeURIComponent).join(",")}`);
    for (const row of results(j)) for (const [code, v] of Object.entries(row as Record<string, Raw>)) {
      const p = (v.pricing || {}) as Raw;
      out.set(code, { onHand: +(v.on_hand as number) || 0, price: (+(p.my_price as number) || +(p.piece as number) || 0) / 100, gtin: s(v.gtin) });
    }
  }
  return out;
}

/** the brands One Stop carries (their mills), for skipping a lookup that can't find anything */
export async function osBrandNames(): Promise<string[]> {
  const j = await os<unknown>("items/mills/");
  return results(j).map((m) => s(m.mill_name || m.name || m.description || m.mill)).filter(Boolean);
}

/* ---------- ordering ---------- */

export type OsShipVia = { number: string; description: string };
type OsSetup = { terms: string; termsLabel: string; address: string; ships: OsShipVia[] };

/**
 * How we pay and where it ships, from their account: the payment method on file ending in our card's last 4
 * (ONESTOP_CARD_LAST4, default 5488) and our shop address (matched by ZIP). The ship-via list depends on both.
 */
export async function osSetup(zip: string, test: boolean): Promise<OsSetup> {
  const last4 = (process.env.ONESTOP_CARD_LAST4 || "5488").trim();
  const terms = results(await os<unknown>("customer/terms/", { test }));
  const t = terms.find((x) => JSON.stringify(x).includes(last4)) || null;
  if (!t) throw new OneStopError(`One Stop has no payment method ending ${last4} on our account (${terms.map((x) => s(x.description || x.terms_description)).filter(Boolean).join(", ") || "none"}).`);
  const addrs = results(await os<unknown>("customer/addresses/", { test }));
  const z5 = zip.replace(/\D/g, "").slice(0, 5);
  const a = addrs.find((x) => s(x.zip || x.zip_code || x.postal_code).replace(/\D/g, "").startsWith(z5)) || null;
  if (!a) throw new OneStopError(`One Stop has no ship-to address at ZIP ${z5} on our account. Add the shop's address in their dashboard.`);
  const termsNo = s(t.number || t.terms_number), addrNo = s(a.number || a.address_number);
  const ships = results(await os<unknown>("customer/shipping/", { method: "POST", test, body: { address_number: +addrNo, terms_number: +termsNo } }))
    .map((x) => ({ number: s(x.number), description: s(x.description) })).filter((x) => x.number);
  return { terms: termsNo, termsLabel: s(t.description || t.terms_description) || `card ending ${last4}`, address: addrNo, ships };
}

export type OsOrderResult = { orderNumber: string; subtotal: number; shipping: number; tax: number; total: number; shipVia: string; messages: string[] };
const money = (cents: unknown) => Math.round(+(cents as number) || 0) / 100;
function orderResult(j: Raw): OsOrderResult {
  const sv = (j.ship_via || {}) as Raw;
  return {
    orderNumber: s(j.order_number), subtotal: money(j.subtotal), shipping: money(j.shipping_fees), tax: money(j.sales_tax),
    total: money(j.balance_due ?? (+(j.subtotal as number) || 0) + (+(j.shipping_fees as number) || 0) + (+(j.sales_tax as number) || 0)),
    shipVia: s(sv.desc || sv.description), messages: (Array.isArray(j.messages) ? j.messages : []).map((m) => (typeof m === "string" ? m : JSON.stringify(m))),
  };
}

/**
 * Check (preflight: nothing is ordered; it gives the freight) or place an order by their codes. The card's CVV is
 * typed at order time and passed straight through; it's never kept anywhere (Oct 29, Nick: paid with the card ending 5488).
 */
export async function osOrder(o: { lines: { code: string; qty: number }[]; po: string; shipVia: string; cvv: string; zip: string; place: boolean }): Promise<OsOrderResult> {
  // our token works on One Stop's live system only (their test system says "Invalid token"): the check (preflight)
  // never orders anything, so it runs live; placing waits for ONESTOP_ORDERS=on
  if (o.place && !osOrdersLive()) throw new OneStopError("One Stop ordering isn't switched on yet (ONESTOP_ORDERS=on in Vercel). Checking prices, stock and freight works.");
  const test = false;
  const set = await osSetup(o.zip, test);
  const ship = set.ships.find((x) => x.number === o.shipVia) || set.ships.find((x) => /ups ground/i.test(x.description)) || set.ships[0];
  if (!ship) throw new OneStopError("One Stop gave no shipping methods for our address.");
  const po = o.po.replace(/[&<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 15);
  const body = { cvv: o.cvv.replace(/\D/g, "").slice(0, 4), po_number: po, line_items: o.lines.filter((l) => l.code && l.qty > 0).map((l) => ({ code: l.code, quantity: Math.round(l.qty) })), terms_number: +set.terms, address_number: +set.address, ship_via_number: +ship.number };
  if (!body.line_items.length) throw new OneStopError("Nothing to order from One Stop.");
  const j = await os<Raw>(o.place ? "orders/sku/create/" : "orders/sku/preflight/", { method: "POST", body, test, timeoutMs: 45_000 });
  const r = orderResult(((j.results as Raw) || j) as Raw);
  return { ...r, shipVia: r.shipVia || ship.description };
}

/** our One Stop orders' tracking (the last `days`), for the goods pass: order number → boxes */
export async function osTracking(days = 21): Promise<Map<string, { tracking: string; carrier: string }[]>> {
  const d = (n: number) => { const x = new Date(Date.now() - n * 864e5); return `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}/${x.getFullYear()}`; };
  const out = new Map<string, { tracking: string; carrier: string }[]>();
  for (let start = 0; start < 1000; start += 200) {
    const j = await os<unknown>("orders/tracking/list/", { method: "POST", body: { start_date: d(days), end_date: d(-1), max_rows: 200, start_at: start } });
    const rs = results(j);
    for (const o of rs) {
      const no = s(o.order_number).replace(/-\d+$/, "") || s(o.order_number);
      const boxes = (Array.isArray(o.tracking) ? o.tracking as Raw[] : []).map((t) => ({ tracking: s(t.tracking_number).replace(/\s+/g, ""), carrier: carrierOf(s(t.tracking_number)) || (/ups/i.test(s(t.tracking_url)) ? "UPS" : "") })).filter((t) => t.tracking);
      if (boxes.length) out.set(no, [...(out.get(no) || []), ...boxes]);
    }
    if (rs.length < 200) break;
  }
  return out;
}

/** the goods pass (app/api/goods/ai-match): One Stop doesn't email manifests, so its tracking is asked for here */
export async function osTrackingPass(admin: SupabaseClient): Promise<{ added: number }> {
  if (!osConfigured()) return { added: 0 };
  const { data: open } = await admin.from("blank_orders").select("id, order_id, supplier_order").eq("supplier", "onestop").is("received_at", null).neq("status", "cancelled").gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
  const rows = (open || []) as { id: string; order_id: string | null; supplier_order: string | null }[];
  if (!rows.length) return { added: 0 };
  const byOrder = await osTracking(30);
  let added = 0;
  for (const b of rows) {
    const boxes = [...byOrder].filter(([no]) => (b.supplier_order || "").split(/,\s*/).some((x) => x && (x === no || x.startsWith(no) || no.startsWith(x)))).flatMap(([, v]) => v);
    if (!boxes.length || !b.order_id) continue;
    const { data: have } = await admin.from("blank_shipments").select("tracking").eq("order_id", b.order_id);
    const seen = new Set(((have || []) as { tracking: string }[]).map((x) => x.tracking));
    for (const t of boxes) {
      if (seen.has(t.tracking)) continue;
      seen.add(t.tracking);
      const { data: row } = await admin.from("blank_shipments").insert({ order_id: b.order_id, blank_order_id: b.id, supplier: "onestop", carrier: t.carrier, tracking: t.tracking, note: `One Stop order ${b.supplier_order}`, source: "onestop" }).select("id").single();
      if (row) { const f = await startTracker(t.tracking, t.carrier).catch(() => null); if (f) await admin.from("blank_shipments").update(f).eq("id", row.id); }
      added++;
    }
  }
  return { added };
}
