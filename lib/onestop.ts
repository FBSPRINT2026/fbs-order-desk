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

/* ---------- the catalog, for the garment search and the Mockup Creator (Oct 29, Nick: "integrating their product
 * catalog and their images, like into the mockup creator") ---------- */

const MEDIA = "https://media.onestopinc.com/";
const media = (p: unknown) => { const x = s(p); return !x ? "" : /^https?:\/\//i.test(x) ? x : MEDIA + x.replace(/^\//, ""); };
/** our size names (S, M, L, 2XL…) from One Stop's (SM, MD, LG, 2X…) */
export const osOurSize = (z: string) => { const k = String(z || "").toUpperCase().replace(/\s+/g, ""); return ({ SM: "S", MD: "M", LG: "L", "2X": "2XL", "3X": "3XL", "4X": "4XL", "5X": "5XL", "6X": "6XL", XXL: "2XL", XXXL: "3XL", ONE: "OS", OSFA: "OS" } as Record<string, string>)[k] || k; };

/** a style found at One Stop: the maker's brand and style number (Fruit of the Loom 3930), and One Stop's own code */
export type OsHit = { brand: string; style: string; osStyle: string; title: string; image: string };

/** a catalog read (items/…) as it comes, its first rows only (for the connection check) */
export async function osItemsRaw(path: string) {
  if (!/^items\/[\w\/?=&,.\- %]*$/.test(path)) throw new OneStopError("Only items/… reads.");
  const j = await os<unknown>(path, { timeoutMs: 20_000 });
  const r0 = (j as { results?: unknown } | null)?.results;
  const rs: unknown[] = Array.isArray(r0) ? r0 : r0 && typeof r0 === "object" ? Object.entries(r0 as Record<string, unknown>).map(([k, v]) => ({ _key: k, ...(v as object) })) : [];
  return { keys: Object.keys((j || {}) as object), shape: Array.isArray(r0) ? "array" : typeof r0, meta: Object.fromEntries(Object.entries((j || {}) as Record<string, unknown>).filter(([k]) => k !== "results")), count: rs.length, first: rs.slice(0, 2) };
}
/** the raw first rows of One Stop's search (for the connection check) */
export async function osSearchRaw(q: string) {
  const j = await os<unknown>(`items/?search=${encodeURIComponent(q)}&flat=Y&supplies=false`, { timeoutMs: 15_000 });
  const rs = results(j);
  return { keys: Object.keys((j || {}) as object), count: rs.length, first: rs.slice(0, 3) };
}

/**
 * One Stop's catalog, a row per style, kept in onestop_catalog (their own search only knows their codes: "GD110" finds
 * it, "3930" or "fruit of the loom" find nothing). Their flat listing (items/?flat=Y) gives each style's maker, the
 * maker's style number, name and photo. A full pass runs when it's a week old (the hourly goods pass, or the check).
 */
export async function osCatalogSync(admin: SupabaseClient, deadline = Date.now() + 45_000): Promise<{ styles: number; pages: number; done: boolean }> {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (st?.data || {}) as { osCatalog?: { at?: string; page?: number; started?: string } };
  const prog = d.osCatalog || {};
  let page = prog.page && prog.started ? prog.page : 1, started = prog.started && prog.page ? prog.started : new Date().toISOString(), styles = 0, pages = 0, done = false;
  while (Date.now() < deadline) {
    const j = await os<{ results?: unknown; total_pages?: number }>(`items/?flat=Y&supplies=false&page=${page}`, { timeoutMs: 30_000 });
    const r0 = j?.results;
    const rows = (Array.isArray(r0) ? r0 : r0 && typeof r0 === "object" ? Object.values(r0 as Record<string, unknown>) : []) as Raw[];
    const ups = rows.map((r) => ({ style: s(r.style || r.style_code).toUpperCase(), brand: s(r.mill_name), mill_code: s(r.mill_code), mill_style_code: s(r.mill_style_code), title: s(r.web_name || r.description), image: media(r.generic_image || (r.images as Raw | undefined)?.main), filters: s(r.filters), sizes: s(r.sizes), active: true, synced_at: new Date().toISOString() })).filter((x) => x.style);
    for (let k = 0; k < ups.length; k += 500) await admin.from("onestop_catalog").upsert(ups.slice(k, k + 500));
    styles += ups.length; pages++;
    const total = +(j?.total_pages || 0);
    if (!rows.length || (total && page >= total)) { done = true; break; }
    page++;
  }
  const { data: cur } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const base = (cur?.data || {}) as Record<string, unknown>;
  if (done) {
    // styles One Stop no longer lists: kept, but out of the search
    await admin.from("onestop_catalog").update({ active: false }).lt("synced_at", started);
    await admin.from("settings").update({ data: { ...base, osCatalog: { at: new Date().toISOString() } } }).eq("id", 1);
  } else await admin.from("settings").update({ data: { ...base, osCatalog: { ...(prog.at ? { at: prog.at } : {}), page, started } } }).eq("id", 1);
  return { styles, pages, done };
}
/** the catalog copy is a week old or was never finished: carry on with it (for the goods pass) */
export async function osCatalogDue(admin: SupabaseClient): Promise<boolean> {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const c = ((st?.data || {}) as { osCatalog?: { at?: string; page?: number } }).osCatalog;
  return !c?.at || !!c.page || Date.now() - Date.parse(c.at) > 7 * 864e5;
}

/** One Stop styles matching what was typed: the maker's name or style number, One Stop's code, or words of the name */
export async function osSearch(admin: SupabaseClient, q: string): Promise<OsHit[]> {
  const words = s(q).toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9\-+&\/]/g, "")).filter(Boolean).slice(0, 5);
  if (!words.length || s(q).length < 2) return [];
  type Row = { style: string; brand: string; mill_style_code: string; title: string; image: string };
  let qb = admin.from("onestop_catalog").select("style, brand, mill_style_code, title, image").eq("active", true);
  for (const w of words) qb = qb.or([`style.ilike.%${w}%`, `mill_style_code.ilike.${w}%`, `brand.ilike.%${w}%`, `title.ilike.%${w}%`].join(","));
  const rows = ((await qb.limit(300)).data || []) as Row[];
  const full = s(q).toLowerCase(), lc = (x: string) => (x || "").toLowerCase();
  const score = (r: Row) => (lc(r.mill_style_code) === full || lc(r.style) === full || `${lc(r.brand)} ${lc(r.mill_style_code)}` === full ? 0 : words.some((w) => lc(r.mill_style_code).startsWith(w) || lc(r.style).startsWith(w)) ? 1 : 2);
  return rows.sort((a, b) => score(a) - score(b) || a.brand.localeCompare(b.brand) || a.mill_style_code.localeCompare(b.mill_style_code)).slice(0, 25)
    .map((r) => ({ brand: r.brand, style: r.mill_style_code || r.style, osStyle: r.style, title: r.title, image: r.image }));
}

export type OsGarment = {
  style: string; brand: string; description: string; fabric: string; fabric_at: string; colors: string[]; cost: number; sizes: string[];
  size_costs: Record<string, number>; color_size_costs: Record<string, Record<string, number>>; image: string;
  color_images: Record<string, { front: string; back: string; side: string; hex: string }>; supplier: "onestop"; supplier_style: string;
};

/**
 * A One Stop style as a catalog garment (the same shape as S&S's and SanMar's): every color with its front, back and
 * side photos, the sizes, and our price by size and color. `code`: One Stop's style code (NL207CVC, GD110), or the maker's
 * style number with `brand` (6210 + Next Level), which is looked up first.
 */
export async function osGarment(admin: SupabaseClient, code: string, brand = ""): Promise<OsGarment | null> {
  let st = s(code).toUpperCase();
  if (!st) return null;
  // the maker's number: their code for it
  if (brand || /^\d/.test(st)) {
    const its = await osStyle(admin, brand, st).catch(() => [] as OsItem[]);
    if (its.length) st = its[0].style.toUpperCase();
  }
  const j = await os<Raw>(`items/style/${encodeURIComponent(st)}/`).catch(() => null);
  const top = ((j?.results as Raw[] | undefined)?.[0] || j || {}) as Raw;
  const colorsRaw = (top.colors || {}) as Record<string, Raw>;
  type Sz = { code: string; size: string; color: string };
  const skus: Sz[] = [];
  const color_images: OsGarment["color_images"] = {};
  for (const c of Object.values(colorsRaw)) {
    const name = s(c.name);
    if (!name) continue;
    color_images[name] = { front: media(c.front || c.main), back: media(c.back), side: media(c.side), hex: "" };
    for (const z of (Array.isArray(c.sizes) ? c.sizes : []) as Raw[]) { const cd = s(z.onestop_code || z.code); if (cd && z.size) skus.push({ code: cd, size: osOurSize(s(z.size)), color: name }); }
  }
  if (!skus.length) return null;
  // the maker and name: from the style's record, or from one of its sizes
  let mk = { brand: s(top.mill_name), millStyle: s(top.mill_style_code), name: s(top.web_name || top.description), desc: s(top.web_description) };
  if (!mk.brand) {
    const one = results(await os<unknown>(`items/?code=${encodeURIComponent(skus[0].code)}`).catch(() => null))[0];
    if (one) mk = { brand: s(one.mill_name), millStyle: s(one.mill_style_code), name: s(one.web_name || one.description), desc: s(one.web_description) };
  }
  const px = await osPrices(skus.slice(0, 600).map((x) => x.code)).catch(() => new Map<string, { onHand: number; price: number; gtin: string }>());
  const ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
  const sizes = [...new Set(skus.map((x) => x.size))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const size_costs: Record<string, number> = {}, color_size_costs: Record<string, Record<string, number>> = {};
  for (const k of skus) {
    const v = px.get(k.code)?.price || 0;
    if (!(v > 0)) continue;
    size_costs[k.size] = size_costs[k.size] ? Math.min(size_costs[k.size], v) : v;
    const m = (color_size_costs[k.color] ||= {}); m[k.size] = m[k.size] ? Math.min(m[k.size], v) : v;
  }
  const base = Math.min(...Object.values(size_costs), Infinity);
  const colors = Object.keys(color_images);
  const first = color_images[colors.find((c) => /white/i.test(c)) || colors[0]];
  return {
    style: (mk.millStyle || st).toUpperCase(), brand: mk.brand || "One Stop", description: mk.name, fabric: mk.desc.replace(/<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n").trim().slice(0, 600),
    fabric_at: new Date().toISOString(), colors, cost: isFinite(base) ? base : 0, sizes, size_costs, color_size_costs, image: first?.front || "", color_images, supplier: "onestop", supplier_style: st,
  };
}
