import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";
import { carrierOf } from "@/lib/goods";
import { companyKey } from "@/lib/printavoImport";
import { startTracker } from "@/lib/goodsTrack";
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

type Group = { key: string; supplier: string; customer_name: string; customer_account: string; customer_po: string; supplier_order: string; lines: (ManifestLine & { id?: string })[] };

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

/** Which order a shipment (one supplier order) belongs to, and how sure we are. */
async function matchGroup(admin: SupabaseClient, g: Group): Promise<{ orderId: string; kind: "goods" | "blanks"; how: string } | null> {
  const po = norm(g.customer_po);
  const poMatches = (o: Candidate) => !!po && (norm(o.po_number) === po || norm(o.nickname) === po || String(o.number) === g.customer_po.replace(/\D/g, "") && g.customer_po.replace(/\D/g, "").length >= 3 || (!!o.supplier_po && (norm(o.supplier_po) === po || norm(o.supplier_po) === norm(g.supplier_order))));
  if (isUs(g.customer_name)) {
    // our own blanks: the PO is usually the customer or job name ("Peticolas")
    const { data } = await admin.from("orders").select("id, number, nickname, po_number, customer_id, price_type, status, customers(company, name)").in("status", ["approved", "art", "blanks", "production"]).limit(400);
    const list = (data || []) as unknown as (Candidate & { customers: { company: string; name: string } | null })[];
    const exact = list.filter(poMatches);
    const byCustomer = po.length >= 4 ? list.filter((o) => { const c = norm(o.customers?.company || o.customers?.name || ""); return c && (c.includes(po) || po.includes(c)); }) : [];
    const pick = exact.length === 1 ? exact[0] : byCustomer.length === 1 ? byCustomer[0] : null;
    return pick ? { orderId: pick.id, kind: "blanks", how: exact.length === 1 ? "PO / job name" : "customer name in PO" } : null;
  }
  // a wholesale customer's own purchase
  const custIds = await customerForAccount(admin, g.supplier, g.customer_name, g.customer_account);
  if (!custIds.length) return null;
  const { data: os } = await admin.from("orders").select("id, number, nickname, po_number, customer_id, price_type, status, submitted_at").in("customer_id", custIds).eq("price_type", "wholesale").not("status", "in", "(completed,quote)");
  const open = ((os || []) as (Candidate & { submitted_at: string | null })[]).filter((o) => !(o.status === "request" && !o.submitted_at));
  if (!open.length) return null;
  const { data: gd } = await admin.from("order_goods").select("order_id, supplier_po").in("order_id", open.map((o) => o.id));
  const spo = new Map(((gd || []) as { order_id: string; supplier_po: string }[]).map((x) => [x.order_id, x.supplier_po]));
  open.forEach((o) => { o.supplier_po = spo.get(o.id) || ""; });
  const exact = open.filter(poMatches);
  if (exact.length === 1) return { orderId: exact[0].id, kind: "goods", how: "customer + PO" };
  if (!exact.length && open.length === 1) return { orderId: open[0].id, kind: "goods", how: "customer's only open wholesale order" };
  return null;
}

/** Put a matched supplier shipment on the order: goods tracking (wholesale) or just the link (our blanks). */
export async function applyGroup(admin: SupabaseClient, supplier: string, g: Group, orderId: string, kind: "goods" | "blanks", how: string) {
  const ids = g.lines.map((l) => l.id).filter(Boolean) as string[];
  if (ids.length) await admin.from("supplier_manifest_lines").update({ order_id: orderId, kind, match_how: how }).in("id", ids);
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
  const rows = lines.map((l) => ({ ...l, supplier, file_name: fileName.slice(0, 200) }));
  const { data: saved, error } = await admin.from("supplier_manifest_lines").upsert(rows, { onConflict: "supplier,supplier_order,sku,box,tracking,style,color,size", ignoreDuplicates: true }).select("*");
  if (error) throw new Error(error.message);
  const fresh = (saved || []) as (ManifestLine & { id: string; kind: string })[];
  const groups = new Map<string, Group>();
  for (const l of fresh) {
    const key = `${l.customer_name}|${l.customer_account}|${l.customer_po}|${l.supplier_order}`;
    if (!groups.has(key)) groups.set(key, { key, supplier, customer_name: l.customer_name, customer_account: l.customer_account, customer_po: l.customer_po, supplier_order: l.supplier_order, lines: [] });
    groups.get(key)!.lines.push(l);
  }
  const out = { lines: lines.length, new: fresh.length, shipments: groups.size, matched: 0, blanks: 0, unmatched: 0 };
  for (const g of groups.values()) {
    const m = await matchGroup(admin, g).catch(() => null);
    if (!m) { out.unmatched++; continue; }
    await applyGroup(admin, supplier, g, m.orderId, m.kind, m.how);
    if (m.kind === "blanks") out.blanks++; else out.matched++;
  }
  return out;
}

/** Manifest shipments nobody matched yet, grouped (for the "to match" list), with the customer if we know the account. */
export async function unmatchedGroups(admin: SupabaseClient) {
  const { data } = await admin.from("supplier_manifest_lines").select("*").eq("kind", "").order("created_at", { ascending: false }).limit(2000);
  const lines = (data || []) as (ManifestLine & { id: string; supplier: string })[];
  type G = { key: string; supplier: string; customer_name: string; customer_account: string; customer_po: string; supplier_order: string; ship_date: string | null; boxes: number; pcs: number; methods: string; styles: string; lineIds: string[]; customer: { id: string; name: string } | null; us: boolean };
  const map = new Map<string, G & { boxSet: Set<string> }>();
  for (const l of lines) {
    const key = `${l.supplier}|${l.customer_name}|${l.customer_account}|${l.customer_po}|${l.supplier_order}`;
    const g = map.get(key) || { key, supplier: l.supplier, customer_name: l.customer_name, customer_account: l.customer_account, customer_po: l.customer_po, supplier_order: l.supplier_order, ship_date: l.ship_date, boxes: 0, pcs: 0, methods: "", styles: "", lineIds: [], customer: null, us: isUs(l.customer_name), boxSet: new Set<string>() };
    g.lineIds.push(l.id); g.pcs += l.qty_shipped; g.boxSet.add(`${l.tracking}|${l.box}`);
    g.methods = [...new Set([...g.methods.split(", ").filter(Boolean), l.method].filter(Boolean))].join(", ");
    g.styles = [...new Set([...g.styles.split(", ").filter(Boolean), `${l.mill} ${l.style}`.trim()])].slice(0, 3).join(", ");
    map.set(key, g);
  }
  const out: G[] = [];
  for (const g of map.values()) {
    if (!g.us) {
      const ids = await customerForAccount(admin, g.supplier, g.customer_name, g.customer_account);
      if (ids.length === 1) { const { data: c } = await admin.from("customers").select("id, company, name").eq("id", ids[0]).maybeSingle(); if (c) g.customer = { id: c.id, name: c.company || c.name }; }
    }
    const { boxSet, ...rest } = g;
    out.push({ ...rest, boxes: boxSet.size });
  }
  return out;
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
  for (const g of groups.values()) { const m = await matchGroup(admin, g).catch(() => null); if (m) { await applyGroup(admin, supplier, g, m.orderId, m.kind, m.how); matched++; } }
  return { shipments: groups.size, matched };
}
