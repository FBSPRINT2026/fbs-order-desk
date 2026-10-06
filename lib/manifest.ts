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
      ship_date: excelDate(get(r, "ship_date")), customer_name: ourName(get(r, "customer_name")), customer_account: get(r, "customer_account"), customer_po: get(r, "customer_po"), invoice: get(r, "invoice"),
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

/** Freight (LTL pallets: R&L, Estes, XPO…): no parcel tracking; receiving signs for it. */
export const isFreight = (method: string) => /\bltl\b|freight|r\s*&\s*l\b|estes|xpo|saia|old dominion|\bodfl\b|yrc|abf|southeastern|averitt/i.test(method || "");
const freightCarrier = (method: string) => {
  const m = (method.split(/[-–]/)[0] || method).trim();
  return m.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bR&l\b/i, "R&L").replace(/\bLtl\b/, "LTL");
};
/** SanMar has our account under the company's legal name: Franklin Business Services = FBS */
const FRANKLIN = /^franklin\s+business\s+serv/i;
export const ourName = (name: string) => (FRANKLIN.test(name.trim()) ? "FBS" : name);
const isUs = (name: string) => /^fbs(\s|$|print)/i.test(name.trim()) || FRANKLIN.test(name.trim());
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
  // the job number in the PO ("34380 STEADHAM"): that job, whatever its status (blanks for a job that's already
  // printed still belong to it, and then drop off Goods & Receiving)
  const nums = [...new Set(words(g.customer_po).filter((w) => /^\d{4,6}$/.test(w)))];
  if (nums.length) {
    const [{ data: an }, { data: on }] = await Promise.all([
      admin.from("archived_orders").select("id, visual_id").in("visual_id", nums).limit(5),
      admin.from("orders").select("id, number").in("number", nums.map(Number)).limit(5),
    ]);
    const hits = [...((an || []) as { id: string; visual_id: string | number }[]).map((x) => ({ id: PV + x.id, n: +x.visual_id })), ...((on || []) as { id: string; number: number }[]).map((x) => ({ id: x.id, n: x.number }))];
    if (hits.length === 1) return { orderId: hits[0].id, kind: "blanks", how: `job number in the PO (#${hits[0].n})`, sure: true };
  }
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
  // shortened POs: "COR Softball" = City of Richardson's softball job (the customer's initials), "COR Huffines" =
  // the "Huffine Shirts" job (a word of the job name, give or take an s)
  const shortHit = (o: C) => abbrevHit(g.customer_po, o.who.split("|"), o.nickname);
  const near = exact.length ? [] : list.filter((o) => nearPoHit(o, g.customer_po));
  if (near.length === 1 && (!near[0].items.length || fit(near[0]) >= 0.9)) return { orderId: near[0].id, kind: "blanks", how: `PO ${g.customer_po} is one digit off #${near[0].number}'s`, sure: true };
  const byName = exact.length ? [] : list.filter((o) => nameHit(o) || shortHit(o));
  let pool = exact.length ? exact : byName, via = exact.length ? "PO / job name" : byName.some(nameHit) ? "customer name in PO" : "short name in the PO (customer's initials or a word of the job name)";
  const pcsShipped = g.lines.reduce((x, l) => x + l.qty_shipped, 0);
  const pcsOf = (o: C) => o.items.reduce((x, it) => x + it.need, 0);
  // nothing in the PO points anywhere: the garments decide.
  // Nicholas: "24 pieces of Gildan 5000 in Azalea and an order in the next two weeks for that quantity, style and color:
  // that's a link." So: one open job due within two weeks with exactly the same pieces of each style + color links on
  // its own; otherwise a job with nearly the same styles, sizes and count is suggested.
  if (!pool.length) {
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), late = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const ship = sumByStyleColor(g.lines.map((l) => ({ style: l.style, color: l.color, qty: l.qty_shipped })));
    const exactJobs = list.filter((o) => o.items.length && (!o.due_date || (o.due_date >= late && o.due_date <= soon)) && coversJob(ship, o.items));
    if (exactJobs.length === 1) {
      const o = exactJobs[0];
      return { orderId: o.id, kind: "blanks", how: `same pieces of each style and color as #${o.number} (${pcsShipped} pcs${o.due_date ? `, due ${o.due_date}` : ""})`, sure: true };
    }
    if (!exactJobs.length && pcsShipped >= 24) {
      const ss = bySizeOf(g.lines.map((l) => ({ size: l.size, qty: l.qty_shipped })));
      const twins = list.filter((o) => (!o.due_date || (o.due_date >= late && o.due_date <= soon)) && sameSizes(ss, bySizeOf(o.items.map((it) => ({ size: it.size, qty: it.need })))));
      if (twins.length === 1) return { orderId: twins[0].id, kind: "blanks", how: `same count in every size as #${twins[0].number} (${pcsShipped} pcs: ${sizeLine(ss)})`, sure: true };
    }
    if (exactJobs.length > 1) {
      const o = [...exactJobs].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))[0];
      return { orderId: o.id, kind: "blanks", how: `same pieces of each style and color as ${exactJobs.length} jobs: #${exactJobs.map((x) => x.number).join(", #")} (the soonest due picked; check it)`, sure: false };
    }
    const close = list.filter((o) => o.items.length && Math.abs(pcsOf(o) - pcsShipped) <= Math.max(2, pcsShipped * 0.05)).map((o) => ({ o, f: fit(o) })).filter((x) => x.f >= 0.95);
    if (close.length !== 1) return null;
    pool = [close[0].o]; via = `the garments match (${pcsShipped} pcs, same styles and sizes)`;
  }
  let scored = pool.map((o) => ({ o, f: o.items.length ? fit(o) : 0.5 })).sort((a, b) => b.f - a.f || Math.abs(pcsOf(a.o) - pcsShipped) - Math.abs(pcsOf(b.o) - pcsShipped));
  // a short-name guess (initials, a word) only counts when the garments agree
  if (!exact.length && !byName.some(nameHit)) { scored = scored.filter((x) => x.f >= 0.5); if (!scored.length) return null; }
  const best = scored[0], next = scored[1];
  if (best.f < 0.5 && pool.length > 1) return null;
  const clear = !next || best.f - next.f >= 0.25;
  const how = `${via}${best.o.items.length ? `; ${Math.round(best.f * 100)}% of the pieces are on #${best.o.number}` : ""}`;
  // matched on the garments alone: a suggestion to OK, never linked on its own
  if (!exact.length && !byName.length) return { orderId: best.o.id, kind: "blanks", how, sure: false };
  // sure: one clear order whose garments cover (almost) everything that shipped
  return { orderId: best.o.id, kind: "blanks", how, sure: clear && (best.f >= 0.9 || (!best.o.items.length && pool.length === 1 && exact.length === 1)) };
}

/**
 * A shortened PO pointing at a job: the customer's initials as a word of the PO ("COR" = City Of Richardson, "DFD" =
 * Dallas Fire Department; at least 3 letters), or a word of the job name or customer name, give or take a plural s or a
 * letter ("Huffines" ~ "Huffine Shirts"; words of 5+ letters).
 */
const STOP = new Set(["of", "the", "and", "for", "a", "an", "at", "in", "&"]);
/** words too common to point at one job */
const GENERIC = /^(t?shirts?|tees?|hoodies?|sweatshirts?|polos?|hats?|caps?|beanies?|jackets?|jerseys?|shorts|pants|tanks?|orders?|reorders?|staff|event|events|teams?|crews?|logos?|front|back|prints?|printing|embroidery|apparel|company|blanks?|goods|sample|samples|extras?|order|new|helper)$/;
export function abbrevHit(po: string, names: string[], nickname: string): boolean {
  const pw = words(po).filter((w) => !/^(po|p|o|order|purchase|so)$/.test(w));
  if (!pw.length) return false;
  const inits = new Set<string>();
  for (const n of names) {
    const ws = words(n.replace(/&/g, " and "));
    if (ws.length < 2) continue;
    inits.add(ws.map((w) => w[0]).join(""));
    const sig = ws.filter((w) => !STOP.has(w));
    if (sig.length >= 2) inits.add(sig.map((w) => w[0]).join(""));
    // "City of Richardson Parks" → "cor" too (the first words)
    for (let k = 3; k < ws.length; k++) inits.add(ws.slice(0, k).map((w) => w[0]).join(""));
  }
  if (pw.some((w) => w.length >= 3 && inits.has(w))) return true;
  const near = (a: string, b: string) => a === b || a + "s" === b || b + "s" === a || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 4 && b.length >= a.length + 3 && b.startsWith(a));
  const theirs = [...words(nickname), ...names.flatMap((n) => words(n))].filter((w) => w.length >= 5 && !STOP.has(w) && !GENERIC.test(w));
  return pw.some((w) => w.length >= 4 && !GENERIC.test(w) && theirs.some((t) => near(w, t)));
}

/**
 * A PO one typo away from the order's: the same letter codes and a number off by one digit ("LYL 092425" for the job
 * "Lyles MS Theatre Arts - LYL 092426"). Numbers of 4+ digits only, so short numbers can't collide.
 */
export function nearPoHit(o: { po_number: string; nickname: string }, po: string, bare = false) {
  const pw = words(po).filter((w) => !/^(po|p|o|so)$/.test(w));
  const nums = pw.filter((w) => /^\d{4,}$/.test(w)), lets = pw.filter((w) => !/^\d+$/.test(w) && w.length >= 2);
  // a letter code too ("LYL"): a bare number one digit off is too loose across all jobs; within one customer's own
  // orders (bare = true) a 5+ digit number one off is fine ("PO 27364" for "PO 27366 JOSEY RECORDS")
  if (!nums.length || (!lets.length && !(bare && nums.every((n) => n.length >= 5)))) return false;
  const theirs = [...words(o.po_number), ...words(o.nickname)];
  if (!lets.every((w) => theirs.includes(w))) return false;
  const off1 = (a: string, b: string) => a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length <= 1;
  return nums.every((n) => theirs.some((t) => /^\d+$/.test(t) && off1(n, t)));
}
/**
 * The shipment is this job's goods: every style + color the job lists, in exactly the job's count, plus up to the
 * job's extras (lines with no style, like "EXTRAS 1 S 1 M"), and nothing the job doesn't list.
 */
function coversJob(ship: { style: string; color: string; qty: number }[], items: { style: string; color: string; need: number }[]) {
  const styled = sumByStyleColor(items.filter((it) => it.style || it.color).map((it) => ({ style: it.style, color: it.color, qty: it.need })));
  const extras = items.filter((it) => !it.style && !it.color).reduce((a, it) => a + it.need, 0);
  const sh = sumByStyleColor(ship);
  if (!styled.length || sh.length !== styled.length) return false;
  let over = 0;
  for (const x of sh) {
    const y = styled.find((j) => styleEq(j.style, x.style) && colorEq(j.color, x.color));
    if (!y || x.qty < y.qty) return false;
    over += x.qty - y.qty;
  }
  return over <= extras;
}

/**
 * An unknown supplier account: which customer is it? The upcoming job (due in the next three weeks, or up to a week
 * late) whose garments include exactly these pieces of each style and color (the job can have more, like hats the
 * customer sends separately). Several such jobs: the one whose name shares a word with the PO. Returns null unless
 * exactly one job fits.
 */
async function guessCustomerByGoods(admin: SupabaseClient, g: Group) {
  const ship = sumByStyleColor((g.lines as Line[]).map((l) => ({ style: l.style, color: l.color, qty: l.qty_shipped })));
  if (!ship.length) return null;
  const pcs = ship.reduce((a, x) => a + x.qty, 0);
  if (pcs < 6) return null; // a couple of pieces fit too many jobs
  const lo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), hi = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const [{ data: ar }, { data: os }] = await Promise.all([
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, customer_id, status_name, due_date, data, customers(company, name)").gte("due_date", lo).lte("due_date", hi).not("status_name", "ilike", "%job completed%").limit(1500),
    admin.from("orders").select("id, number, nickname, po_number, customer_id, due_date, status, groups, lines, customers(company, name)").in("status", ["approved", "art", "blanks", "production"]).gte("due_date", lo).lte("due_date", hi).limit(500),
  ]);
  type J = { id: string; number: number; nickname: string; po: string; customerId: string | null; customer: string; due: string | null; items: { style: string; color: string; qty: number }[] };
  const jobs: J[] = [
    ...((ar || []) as unknown as { id: string; visual_id: string | number; nickname: string; po_number: string; customer_id: string | null; status_name: string; due_date: string | null; data: { groups?: { lines?: { itemNumber?: string; color?: string; sizes?: Record<string, number> }[] }[] }; customers: { company: string; name: string } | null }[])
      .filter((o) => !PV_CLOSED.test(o.status_name || "") && !PV_PRINTED.test(o.status_name || ""))
      .map((o) => ({ id: PV + o.id, number: +o.visual_id || 0, nickname: o.nickname || "", po: o.po_number || "", customerId: o.customer_id, customer: o.customers?.company || o.customers?.name || "", due: o.due_date,
        items: (o.data?.groups || []).flatMap((gr) => (gr.lines || []).map((l) => ({ style: l.itemNumber || "", color: l.color || "", qty: Object.values(l.sizes || {}).reduce((a, q) => a + (+q || 0), 0) }))) })),
    ...((os || []) as unknown as (Candidate & { due_date: string | null; customers: { company: string; name: string } | null })[]).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", po: o.po_number || "", customerId: o.customer_id, customer: o.customers?.company || o.customers?.name || "", due: o.due_date,
      items: orderGroups(o as unknown as Order).flatMap((gr) => gr.lines.map((l) => ({ style: l.style || "", color: l.color || "", qty: Object.values(l.sizes || {}).reduce((a: number, q) => a + (+(q || 0)), 0) }))) })),
  ];
  // every style + color that shipped is on the job in exactly that count
  const fits = jobs.filter((j) => { const js = sumByStyleColor(j.items.filter((it) => it.style || it.color)); return ship.every((x) => js.some((y) => styleEq(x.style, y.style) && colorEq(x.color, y.color) && x.qty === y.qty)); });
  const poWords = words(g.customer_po).filter((w) => w.length >= 4 && !GENERIC.test(w) && !STOP.has(w));
  const named = fits.filter((j) => poWords.some((w) => words(`${j.nickname} ${j.po}`).includes(w)));
  const pick = fits.length === 1 ? fits[0] : named.length === 1 ? named[0] : null;
  if (!pick) return null;
  const what = ship.map((x) => `${x.qty} ${x.style} ${x.color}`).join(", ");
  const why = named.includes(pick) ? `, and the PO "${g.customer_po}" matches the job name` : "";
  return { orderId: pick.id, customerId: pick.customerId, customer: pick.customer, number: pick.number,
    how: `"${g.customer_name}" isn't a customer we know, but these ${pcs} pcs (${what}) are exactly what #${pick.number} ${pick.nickname} for ${pick.customer} needs${why}. Is ${g.customer_name} ${pick.customer}?` };
}

/**
 * One of the customer's jobs completed in the last 60 days with exactly the same count in every size as the shipment
 * (Agape's "VLC Serve Day" 134 pcs for the completed #34328 "Serve Day Order"). Goods for it link there, then drop off.
 */
async function doneTwin(admin: SupabaseClient, custIds: string[], lines: Line[]) {
  const pcs = lines.reduce((x, l) => x + l.qty_shipped, 0);
  if (pcs < 12) return null;
  const ss = bySizeOf(lines.map((l) => ({ size: l.size, qty: l.qty_shipped })));
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const { data: done } = await admin.from("archived_orders").select("id, visual_id, nickname, data").in("customer_id", custIds).gte("due_date", since).ilike("status_name", "%job completed%").limit(300);
  const twins = ((done || []) as { id: string; visual_id: string | number; nickname: string; data: { groups?: { lines?: { sizes?: Record<string, number> }[] }[] } }[])
    .filter((o) => sameSizes(ss, bySizeOf((o.data?.groups || []).flatMap((gr) => (gr.lines || []).flatMap((l) => Object.entries(l.sizes || {}).map(([k, q]) => ({ size: pvSize(k), qty: +q || 0 })))))));
  if (twins.length !== 1) return null;
  return { alloc: lines.map((line) => ({ line, parts: [{ orderId: PV + twins[0].id, qty: line.qty_shipped }] })), unplaced: [] as Line[], auto: true,
    how: `same count in every size as #${twins[0].visual_id} ${twins[0].nickname} (already completed; ${pcs} pcs: ${sizeLine(ss)})` };
}

/** pieces per size ("L" → 310) */
const bySizeOf = (xs: { size: string; qty: number }[]) => { const m = new Map<string, number>(); for (const x of xs) if (x.qty) m.set(sizeKey(x.size), (m.get(sizeKey(x.size)) || 0) + x.qty); return m; };
/** the same count in every size (S 95, M 280, L 310, XL 60, 2XL 12 = S 95, M 280 …) */
const sameSizes = (a: Map<string, number>, b: Map<string, number>) => a.size > 0 && a.size === b.size && [...a].every(([z, q]) => b.get(z) === q);
const sizeLine = (m: Map<string, number>) => [...m].map(([z, q]) => `${z} ${q}`).join(", ");

/** numbers of 5+ digits in a text, even glued to letters ("PeterMEI93298390" → 93298390; "12341-90246" → 12341, 90246) */
const numRuns = (t: string) => [...new Set((t.match(/\d{5,}/g) || []))];

/** pieces per style + color (style and color compared loosely: "TundraBlu" = "Tundra Blue", "pc54" = "PC54") */
function sumByStyleColor(xs: { style: string; color: string; qty: number }[]) {
  const out: { style: string; color: string; qty: number }[] = [];
  for (const x of xs) {
    if (!x.qty) continue;
    const hit = out.find((o) => styleEq(o.style, x.style) && colorEq(o.color, x.color));
    if (hit) hit.qty += x.qty; else out.push({ style: x.style, color: x.color, qty: x.qty });
  }
  return out;
}
/** the same styles and colors, with exactly the same number of pieces of each */
function sameStyleColor(a: ReturnType<typeof sumByStyleColor>, b: ReturnType<typeof sumByStyleColor>) {
  if (!a.length || a.length !== b.length) return false;
  return a.every((x) => b.some((y) => styleEq(x.style, y.style) && colorEq(x.color, y.color) && x.qty === y.qty));
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
  // every word of the PO inside the order's PO or name: "HUD 092226" in "Hudson Lady Basketball - HUD 092226" (needs a
  // number of 4+ digits, so a word or two can't do it alone)
  { const pw = words(g.customer_po).filter((w) => !/^(po|p|o|so)$/.test(w)), theirs = new Set([...words(o.po_number), ...words(o.nickname)]);
    if (pw.length && pw.some((w) => /^\d{4,}$/.test(w)) && pw.every((w) => theirs.has(w))) return true; }
  // our own POs often start with the job number: "34380 STEADHAM", "34339 WHITT CLR RUN"
  if (o.number >= 1000 && words(g.customer_po).includes(String(o.number))) return true;
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
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, customer_id, status_name, due_date, data").in("customer_id", custIds).or(`due_date.gte.${since},due_date.is.null`).not("status_name", "ilike", "%job completed%").order("due_date", { ascending: false, nullsFirst: true }).limit(600),
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
    // a job line with no style (Printavo jobs often put it in the description) matches on color and size
    const hits = orders.flatMap((o) => o.items.map((it, i) => ({ o, i, it })).filter(({ it }) => it.size === z && (it.style ? styleEq(it.style, line.style) : !!it.color) && colorEq(it.color, line.color)));
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
  if (!custIds.length) {
    // an account we don't know ("UPSHOT HOLDINGS"): if the goods are exactly what one upcoming job needs, ask whether
    // that's the customer (never linked on its own: the person OKs it, and can make it a rule)
    const gs = await guessCustomerByGoods(admin, g).catch(() => null);
    if (!gs) return empty;
    return { customerId: null, alloc: lines.map((line) => ({ line, parts: [{ orderId: gs.orderId, qty: line.qty_shipped }] })), unplaced: [], auto: false, how: gs.how };
  }
  const orders = await openOrders(admin, custIds);
  if (!orders.length) {
    // no open jobs at all (Agape: the job already printed): a recently completed one with the same count in every size
    const d = await doneTwin(admin, custIds, lines);
    return d ? { customerId, ...d } : empty;
  }
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
  // the PO's number (5+ digits, even glued to letters: "PeterMEI93298390", "AMS 42992 CLEVELAND") on exactly one of the
  // customer's orders ("MEI Store … Cart #93298390", "42992 ALL MY SONS CLEVELAND"): that order
  const pr = numRuns(g.customer_po);
  if (pr.length) {
    const byNum = orders.filter((o) => numRuns(`${o.nickname} ${o.po_number}`).some((r) => pr.includes(r)));
    if (byNum.length === 1) {
      const r = pr.find((x) => numRuns(`${byNum[0].nickname} ${byNum[0].po_number}`).includes(x));
      return { customerId, alloc: lines.map((line) => ({ line, parts: [{ orderId: byNum[0].id, qty: line.qty_shipped }] })), unplaced: [], auto: true, how: `PO number ${r} is on #${byNum[0].number}` };
    }
    // the number is on several jobs (a screen print job and its embroidery job, "42998 ARMSTRONG ATLANTA" and
    // "42998 ARMSTRONG ATLANTA - EMBROIDERY"): split the goods between them by style, color and size
    if (byNum.length > 1) {
      const a = allocate(lines, byNum);
      if (!a.unplaced.length) return { customerId, ...a, auto: a.sure, how: `PO number on ${byNum.length} jobs (#${byNum.map((o) => o.number).join(", #")}), split by style, color and size` };
    }
    // not on an open job: maybe on one that's already printed (goods for it still belong to it, then drop off)
    if (!byNum.length) {
      const since = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
      const { data: done } = await admin.from("archived_orders").select("id, visual_id, nickname, po_number").in("customer_id", custIds).gte("due_date", since).ilike("status_name", "%job completed%").limit(600);
      const hit = ((done || []) as { id: string; visual_id: string | number; nickname: string; po_number: string }[]).filter((o) => numRuns(`${o.nickname} ${o.po_number}`).some((r) => pr.includes(r)));
      if (hit.length === 1) return { customerId, alloc: lines.map((line) => ({ line, parts: [{ orderId: PV + hit[0].id, qty: line.qty_shipped }] })), unplaced: [], auto: true, how: `PO number is on #${hit[0].visual_id} (already completed)` };
    }
    // the customer numbers their jobs this way, but no open job has this number yet (the job isn't entered yet):
    // wait for it instead of guessing another job
    const numbered = orders.filter((o) => numRuns(`${o.nickname} ${o.po_number}`).length).length;
    if (!byNum.length && numbered >= Math.max(2, orders.length * 0.5) && !orders.some((o) => nearPoHit(o, g.customer_po, true)))
      return { ...empty, how: `PO number ${pr.join(", ")} isn't on any of their open jobs yet` };
  }
  // a PO one typo off one order's ("LYL 092425" for "LYL 092426"), and the goods fit it: that order
  const near = orders.filter((o) => nearPoHit(o, g.customer_po, true));
  if (near.length === 1) {
    const a1 = allocate(lines, near);
    if (!a1.unplaced.length) return { customerId, ...a1, auto: true, how: `PO ${g.customer_po} is one digit off #${near[0].number}'s` };
  }
  // the sizes say it: one open order with exactly the same count in every size (Nicholas: "the quantity exactly lines
  // up, 757 to 757"; the job line may not even name a style or color: "4/4 IMPRINT + 1-COLOR LEFT SLEEVE…")
  const shipSizes = bySizeOf(lines.map((l) => ({ size: l.size, qty: l.qty_shipped })));
  const pcsIn = lines.reduce((x, l) => x + l.qty_shipped, 0);
  const sizeTwins = orders.filter((o) => sameSizes(shipSizes, bySizeOf(o.items.map((it) => ({ size: it.size, qty: it.need })))));
  if (sizeTwins.length === 1 && pcsIn >= 12)
    return { customerId, alloc: lines.map((line) => ({ line, parts: [{ orderId: sizeTwins[0].id, qty: line.qty_shipped }] })), unplaced: [], auto: true, how: `same count in every size as #${sizeTwins[0].number} (${pcsIn} pcs: ${sizeLine(shipSizes)})` };
  // nothing open fits: a job of theirs that's already been printed (goods often show on a manifest after the job ran)
  if (!sizeTwins.length) { const d = await doneTwin(admin, custIds, lines); if (d) return { customerId, ...d }; }
  // the customer's only open order, and the pieces add up exactly
  if (orders.length === 1 && pcsIn >= 12 && orders[0].items.reduce((x, it) => x + it.need, 0) === pcsIn)
    return { customerId, alloc: lines.map((line) => ({ line, parts: [{ orderId: orders[0].id, qty: line.qty_shipped }] })), unplaced: [], auto: true, how: `their only open order, and the pieces add up exactly (${pcsIn})` };
  const a = allocate(lines, orders);
  const used = new Set(a.alloc.flatMap((x) => x.parts.map((p) => p.orderId)));
  const how = !a.alloc.length ? "" : `No order has PO ${g.customer_po || "(none)"}; items match ${[...used].map((id) => "#" + orders.find((o) => o.id === id)?.number).join(", ")}`;
  // Nicholas: the same quantity, style and color as an order due in the next two weeks is a link
  if (used.size === 1 && !a.unplaced.length) {
    const o = orders.find((x) => used.has(x.id))!;
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), late = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const others = orders.filter((x) => x.id !== o.id && coversJob(lines.map((l) => ({ style: l.style, color: l.color, qty: l.qty_shipped })), x.items));
    if ((!o.due_date || (o.due_date >= late && o.due_date <= soon)) && !others.length && coversJob(lines.map((l) => ({ style: l.style, color: l.color, qty: l.qty_shipped })), o.items))
      return { customerId, ...a, auto: true, how: `same pieces of each style and color as #${o.number}${o.due_date ? ` (due ${o.due_date})` : ""}` };
  }
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
  for (const trk of [...new Set(lines.filter((l) => !isFreight(l.method)).map((l) => l.tracking).filter(Boolean))]) {
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
  const notFor = await unlinkedFrom(admin).catch(() => new Map());
  for (const g of groupLines((data || []) as Waiting[])) {
    if (Date.now() > deadline - 15000) break;
    // staff unlinked it from a job: the rules leave it alone (the AI, which knows which job was wrong, has a go)
    if (notFor.has(g.key)) continue;
    if (isUs(g.customer_name)) {
      const m = await matchBlanks(admin, g).catch(() => null);
      if (m?.sure) { await applyGroup(admin, g.supplier, g, m.orderId, m.kind, m.how); out.linked++; }
      else if (m && !g.lines.some((l) => l.suggest_order_id || l.suggest_archived_id || (l.suggest_how || "").startsWith(AI_TAG))) { await suggestBlanks(admin, g, m.orderId, m.how); out.suggested++; }
      continue;
    }
    const had = g.lines.some((l) => l.suggest_order_id || l.suggest_archived_id);
    const p = await planShipment(admin, g).catch(() => null);
    if (!p) continue;
    // the AI has a say on this one: only a sure rule link replaces it
    if (isAiGuess(g) && !(p.auto && !p.unplaced.length)) continue;
    // nothing fits any more (e.g. the PO's job number isn't entered yet): drop an old guess so nobody OKs a wrong job
    if (!p.alloc.length && had) { await admin.from("supplier_manifest_lines").update({ suggest_order_id: null, suggest_archived_id: null, suggest_how: p.how || "" }).in("id", g.lines.map((l) => l.id)); continue; }
    if (p.customerId && g.lines.some((l) => !l.customer_id)) await admin.from("supplier_manifest_lines").update({ customer_id: p.customerId }).in("id", g.lines.map((l) => l.id));
    if (p.auto && !p.unplaced.length) {
      const rows: { line: Line; orderId: string }[] = [];
      for (const a of p.alloc) rows.push(...(await splitLine(admin, a.line, a.parts)));
      await linkLines(admin, g, rows, p.how, "auto"); out.linked++; continue;
    }
    // a new suggestion, or a better one than the old guess (the matching has learned something since)
    if (p.alloc.length && (!had || g.lines.some((l) => (l.suggest_how || "") !== p.how))) { await resolveShipment(admin, g); out.suggested++; }
  }
  // tracking for shipments still waiting for an order
  const trk = new Map<string, Waiting>();
  const { data: pvLinked } = await admin.from("supplier_manifest_lines").select("*").in("kind", ["goods", "blanks"]).not("archived_order_id", "is", null).neq("track_status", "delivered").neq("tracking", "").limit(1000);
  for (const l of [...((data || []) as Waiting[]), ...((pvLinked || []) as Waiting[])]) if (l.tracking && !isFreight(l.method) && l.track_status !== "delivered" && !trk.has(l.tracking)) trk.set(l.tracking, l);
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
  tracking: { carrier: string; tracking: string; status: string; detail: string; eta: string | null; delivered: boolean; delivered_at?: string | null; boxes?: number; pcs?: number; freight?: boolean }[]; how: string; lines: PendingLine[];
  orders: { id: string; number: number; nickname: string; po: string; due_date: string | null; printavo: boolean }[];
  /** an unknown account: the customer whose job these goods fit (to ask "is X them?") */
  suggestCustomer?: { id: string; name: string } | null;
};

function summarize(g: Group<Waiting>, customer: { id: string; name: string } | null, orders: PendingShipment["orders"]): PendingShipment {
  const trk = new Map<string, PendingShipment["tracking"][number]>();
  const carrierFor = (l: Waiting) => (isFreight(l.method) ? freightCarrier(l.method) : carrierOf(l.tracking) || (/ups/i.test(l.method) ? "UPS" : /fedex/i.test(l.method) ? "FedEx" : (l.method.split(/[-–]/)[0] || "").trim()));
  for (const l of g.lines) if (l.tracking && !trk.has(l.tracking)) {
    const same = g.lines.filter((x) => x.tracking === l.tracking);
    const freight = isFreight(l.method);
    // freight (LTL) can't be tracked here: expect it the next business day after it ships, and sign for it when it comes
    trk.set(l.tracking, { carrier: carrierFor(l), tracking: l.tracking, status: l.track_status, detail: l.track_detail || (freight ? `PRO ${l.tracking}` : ""), eta: l.est_delivery || (freight && l.ship_date ? nextBusinessDay(l.ship_date) : null), delivered: l.track_status === "delivered", delivered_at: l.delivered_at, boxes: new Set(same.map((x) => x.box)).size, pcs: same.reduce((a, x) => a + x.qty_shipped, 0), freight });
  }
  const noTrk = g.lines.find((l) => !l.tracking);
  // no tracking (the supplier's local truck): due the next business day; "delivered" only when someone marks it received
  const here = !!noTrk && g.lines.filter((l) => !l.tracking).every((l) => l.track_status === "delivered");
  if (noTrk) { const same = g.lines.filter((x) => !x.tracking); trk.set("", { carrier: SUPPLIER_NAME[g.supplier] || g.supplier, tracking: "", status: here ? "delivered" : "", detail: noTrk.method || "local truck", eta: noTrk.ship_date ? nextBusinessDay(noTrk.ship_date) : null, delivered: here, delivered_at: here ? same.map((x) => x.delivered_at).filter(Boolean).sort().pop() || null : null, boxes: new Set(same.map((x) => x.box)).size, pcs: same.reduce((a, x) => a + x.qty_shipped, 0) }); }
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
    let suggestCustomer: { id: string; name: string } | null = null;
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
        liveIds.length ? admin.from("orders").select("id, number, nickname, po_number, due_date, customer_id, customers(company, name)").in("id", liveIds) : Promise.resolve({ data: [] }),
        pvIds.length ? admin.from("archived_orders").select("id, visual_id, nickname, po_number, due_date, customer_id, customers(company, name)").in("id", pvIds) : Promise.resolve({ data: [] }),
      ]);
      type R = { id: string; number?: number; visual_id?: string | number; nickname: string; po_number: string; due_date: string | null; customer_id?: string | null; customers: { company: string; name: string } | null };
      // the customer of the job we guessed (an unknown account: "is X them?"; our blanks: whose job it is)
      { const first = [...((lo || []) as unknown as R[]), ...((po || []) as unknown as R[])].find((o) => o.customer_id);
        if (first) suggestCustomer = { id: first.customer_id!, name: first.customers?.company || first.customers?.name || "" }; }
      orders = [
        ...((lo || []) as unknown as R[]).map((o) => ({ id: o.id, number: o.number || 0, nickname: [o.customers?.company || o.customers?.name, o.nickname].filter(Boolean).join(" · "), po: o.po_number || "", due_date: o.due_date, printavo: false })),
        ...((po || []) as unknown as R[]).map((o) => ({ id: PV + o.id, number: +(o.visual_id || 0), nickname: [o.customers?.company || o.customers?.name, o.nickname].filter(Boolean).join(" · "), po: o.po_number || "", due_date: o.due_date, printavo: true })),
      ];
    }
    out.push({ ...summarize(g, customer, orders), suggestCustomer });
  }
  return out;
}

/** Link a waiting shipment's lines to orders by hand (staff or the customer). `pick`: line id → order id. */
export async function linkByHand(admin: SupabaseClient, pick: { lineId: string; orderId: string }[], by: string, allowedCustomers?: string[], note = "") {
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
    // staff links teach the AI matcher (customers linking their own goods don't)
    if (!allowedCustomers) await saveGoodsLesson(admin, g, rows[0].orderId, by, note).catch(() => null);
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
export const __test = { allocate, styleEq, colorEq, matchBlanks, guessCustomerByGoods };
/** helpers the AI matcher (lib/goodsAi.ts) shares with the rules */
export const __ai = { isUs, groupLines, styleEq, colorEq, words, norm, numRuns, sumByStyleColor, bySizeOf, sameSizes, sizeLine, PV_CLOSED, pvSize, GENERIC, STOP };
export type { Waiting, Line as ManifestRow };
/** a guess the AI made (the rules leave these alone; the AI pass revisits them) */
export const AI_TAG = "🤖 AI";
const isAiGuess = (g: Group<Waiting>) => g.lines.some((l) => (l.suggest_how || "").startsWith(AI_TAG));

/**
 * Remember how staff linked a shipment (picked by hand, or OK'd a guess), with their note on why: the AI matcher reads
 * the latest of these as worked examples, so it links the next one like it on its own.
 */
export async function saveGoodsLesson(admin: SupabaseClient, g: Group<Waiting>, orderId: string, by: string, note = "") {
  const guess = g.lines.map((l) => l.suggest_order_id || (l.suggest_archived_id ? PV + l.suggest_archived_id : "")).find(Boolean) || "";
  const isPv = orderId.startsWith(PV);
  const { data: o } = isPv
    ? await admin.from("archived_orders").select("visual_id, nickname, po_number, status_name, due_date, customers(company, name)").eq("id", orderId.slice(PV.length)).maybeSingle()
    : await admin.from("orders").select("number, nickname, po_number, status, due_date, customers(company, name)").eq("id", orderId).maybeSingle();
  if (!o) return;
  const r = o as unknown as { visual_id?: string | number; number?: number; nickname: string; po_number: string; status_name?: string; status?: string; due_date: string | null; customers: { company: string; name: string } | null };
  let guessNo = 0;
  if (guess && guess !== orderId) {
    const { data: gx } = guess.startsWith(PV) ? await admin.from("archived_orders").select("visual_id").eq("id", guess.slice(PV.length)).maybeSingle() : await admin.from("orders").select("number").eq("id", guess).maybeSingle();
    guessNo = +((gx as { visual_id?: number; number?: number } | null)?.visual_id || (gx as { number?: number } | null)?.number || 0);
  }
  const by_sc = sumByStyleColor((g.lines as Line[]).map((l) => ({ style: l.style, color: l.color, qty: l.qty_shipped })));
  const pcs = by_sc.reduce((a, x) => a + x.qty, 0);
  const payload = {
    supplier: g.supplier, account: g.customer_name, po: g.customer_po, pcs, ship_date: g.lines[0]?.ship_date || null,
    items: by_sc.map((x) => `${x.qty} ${x.style} ${x.color}`).join(", "), sizes: sizeLine(bySizeOf((g.lines as Line[]).map((l) => ({ size: l.size, qty: l.qty_shipped })))),
    job: +(r.visual_id || r.number || 0), jobName: r.nickname || "", jobPo: r.po_number || "", jobCustomer: r.customers?.company || r.customers?.name || "", jobStatus: r.status_name || r.status || "", jobDue: r.due_date,
    how: !guess ? "picked by hand (no guess)" : guess === orderId ? ((g.lines.find((l) => l.suggest_how)?.suggest_how || "").startsWith(AI_TAG) ? "OK'd the AI's guess" : "OK'd the rules' guess") : `picked by hand; the guess #${guessNo || "?"} was wrong`,
    note: note.slice(0, 500), by,
  };
  await admin.from("ai_suggestions").upsert({ dedupe_key: `goods-lesson:${g.supplier}|${g.supplier_order}|${g.customer_po}`, kind: "goods_lesson", source: "staff", status: "done", title: `${g.customer_name} PO ${g.customer_po} → #${payload.job}`.slice(0, 300), body: note.slice(0, 2000), payload, decided_at: new Date().toISOString(), decided_by: by }, { onConflict: "dedupe_key" });
}

export type PrintavoGoods = { kind: "goods" | "blanks"; lineIds: string[]; ship_date: string | null; po: string; archivedId: string; number: number; nickname: string; customer: string; due_date: string | null; supplier: string; supplier_order: string; pcs: number; boxes: number; tracking: PendingShipment["tracking"]; delivered: boolean; eta: string | null };
/** a Printavo job that's been printed (or closed): its goods drop off Goods & Receiving */
export const PV_PRINTED = /job\s*completed|shipping|ready\s*to\s*ship|ready\s*for\s*pick|fulfil?lment|delivered|invoiced|quote\s*-\s*closed|cancel/i;
/**
 * Goods linked to Printavo orders (until go-live), shipment by shipment, for Goods & Receiving. They stay (arrived or
 * not) until the job is printed: goods often sit here 20 days before the job runs. Anything else can be ignored by
 * hand (Goods & Receiving → Ignore).
 */
export async function printavoGoods(admin: SupabaseClient): Promise<PrintavoGoods[]> {
  // two links to archived_orders (linked + guessed): name the one we mean, or the query fails and returns nothing
  const { data, error } = await admin.from("supplier_manifest_lines").select("*, archived_orders!supplier_manifest_lines_archived_order_id_fkey(visual_id, nickname, due_date, status_name, customers(company, name))").in("kind", ["goods", "blanks"]).not("archived_order_id", "is", null).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(`Goods on Printavo jobs: ${error.message}`);
  type Row = Waiting & { archived_order_id: string; archived_orders: { visual_id: string | number; nickname: string; due_date: string | null; status_name?: string; customers: { company: string; name: string } | null } | null };
  const m = new Map<string, Row[]>();
  for (const l of (data || []) as Row[]) { const k = `${l.archived_order_id}|${l.supplier}|${l.supplier_order}|${(l as Row & { kind: string }).kind}`; m.set(k, [...(m.get(k) || []), l]); }
  const out: PrintavoGoods[] = [];
  for (const ls of m.values()) {
    const f = ls[0], a = f.archived_orders;
    const s = summarize({ key: "", supplier: f.supplier, customer_name: f.customer_name, customer_account: f.customer_account, customer_po: f.customer_po, supplier_order: f.supplier_order, lines: ls }, null, []);
    const delivered = s.tracking.length > 0 && s.tracking.every((t) => t.delivered);
    const lastDelivered = ls.map((l) => l.delivered_at).filter(Boolean).sort().pop();
    // printed already: done here
    if (PV_PRINTED.test(a?.status_name || "")) continue;
    // a safety net for jobs that never get marked done in Printavo
    if (delivered && lastDelivered && Date.now() - Date.parse(lastDelivered) > 120 * 86400000) continue;
    out.push({ kind: (f as Row & { kind: string }).kind === "blanks" ? "blanks" : "goods", lineIds: ls.map((l) => l.id), ship_date: f.ship_date, po: f.customer_po, archivedId: f.archived_order_id, number: +(a?.visual_id || 0), nickname: a?.nickname || "", customer: a?.customers?.company || a?.customers?.name || f.customer_name, due_date: a?.due_date || null, supplier: f.supplier, supplier_order: f.supplier_order, pcs: s.pcs, boxes: s.boxes, tracking: s.tracking, delivered, eta: s.tracking.map((t) => t.eta).filter(Boolean).sort().pop() || null });
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

/* ---------- the S&S local truck (Fort Worth): no tracking, so receiving signs for it ---------- */

export type TruckStop = { key: string; supplier_order: string; who: string; po: string; order: { number: number; href: string } | null; unlinked: boolean; ours: boolean; boxes: number; pcs: number; ship_date: string | null; lineIds: string[] };

/** Everything on S&S's local truck (no tracking number) that nobody has signed for yet. */
export async function truckPending(admin: SupabaseClient): Promise<TruckStop[]> {
  const { data } = await admin.from("supplier_manifest_lines").select("id, supplier_order, customer_name, customer_po, box, qty_shipped, ship_date, kind, order_id, archived_order_id, customer_id, orders!supplier_manifest_lines_order_id_fkey(number, customers(company, name)), archived_orders!supplier_manifest_lines_archived_order_id_fkey(visual_id, customers(company, name)), customers(company, name)")
    .eq("supplier", "ss").eq("tracking", "").neq("kind", "ignored").neq("track_status", "delivered").order("ship_date", { ascending: false }).limit(3000);
  type R = { id: string; supplier_order: string; customer_name: string; customer_po: string; box: string; qty_shipped: number; ship_date: string | null; kind: string; order_id: string | null; archived_order_id: string | null;
    orders: { number: number; customers: { company: string; name: string } | null } | null; archived_orders: { visual_id: string | number; customers: { company: string; name: string } | null } | null; customers: { company: string; name: string } | null };
  const m = new Map<string, R[]>();
  for (const l of (data || []) as unknown as R[]) { const k = `${l.supplier_order}|${l.order_id || l.archived_order_id || ""}`; m.set(k, [...(m.get(k) || []), l]); }
  return [...m.entries()].map(([key, ls]) => {
    const f = ls[0], c = f.orders?.customers || f.archived_orders?.customers || f.customers;
    return {
      key, supplier_order: f.supplier_order, po: f.customer_po, ship_date: f.ship_date, ours: isUs(f.customer_name), unlinked: !f.order_id && !f.archived_order_id,
      who: isUs(f.customer_name) && !c ? "FBS (our blanks)" : c?.company || c?.name || f.customer_name,
      order: f.order_id && f.orders ? { number: f.orders.number, href: `/shop/orders/${f.order_id}` } : f.archived_order_id && f.archived_orders ? { number: +f.archived_orders.visual_id, href: `/shop/archive/${f.archived_order_id}` } : null,
      boxes: new Set(ls.map((l) => l.box)).size, pcs: ls.reduce((a, l) => a + l.qty_shipped, 0), lineIds: ls.map((l) => l.id),
    };
  }).sort((a, b) => a.who.localeCompare(b.who));
}

/**
 * The S&S truck is here: everything checked is delivered at `at`, signed by `by`. Lines on orders here also mark their
 * goods / blanks shipment delivered (and customer goods move to "Arrived, checking in").
 */
export async function receiveTruck(admin: SupabaseClient, lineIds: string[], at: string, by: string) {
  if (!lineIds.length) throw new Error("Check what came on the truck.");
  const who = by.trim().slice(0, 80);
  if (!who) throw new Error("Who signed for it?");
  const when = isNaN(Date.parse(at)) ? new Date().toISOString() : new Date(at).toISOString();
  const detail = `Delivered by S&S truck · signed by ${who}`;
  const { data } = await admin.from("supplier_manifest_lines").update({ track_status: "delivered", delivered_at: when, track_detail: detail, track_updated_at: new Date().toISOString() })
    .in("id", lineIds).eq("tracking", "").select("order_id, kind, supplier_order");
  const rows = (data || []) as { order_id: string | null; kind: string; supplier_order: string }[];
  for (const r of rows.filter((x) => x.order_id)) {
    const table = r.kind === "blanks" ? "blank_shipments" : "goods_shipments";
    await admin.from(table).update({ track_status: "delivered", delivered_at: when, track_detail: detail }).eq("order_id", r.order_id!).eq("tracking", "").ilike("note", `%${r.supplier_order}%`);
    if (r.kind === "goods") await admin.from("order_goods").update({ status: "arrived", updated_by: who, updated_at: new Date().toISOString() }).eq("order_id", r.order_id!).in("status", ["waiting", "on_way"]);
  }
  return { lines: rows.length };
}

/** Freight (an LTL pallet) is here: delivered at `at`, received by `by`. Also marks it on orders here, if linked. */
export async function receiveFreight(admin: SupabaseClient, lineIds: string[], at: string, by: string, yes = true) {
  if (!lineIds.length) throw new Error("Nothing to receive.");
  const who = by.trim().slice(0, 80);
  if (yes && !who) throw new Error("Who received it?");
  const when = isNaN(Date.parse(at)) ? new Date().toISOString() : new Date(at).toISOString();
  const { data } = await admin.from("supplier_manifest_lines").update(yes
    ? { track_status: "delivered", delivered_at: when, track_detail: `Freight received · signed by ${who}`, track_updated_at: new Date().toISOString() }
    : { track_status: "", delivered_at: null, track_detail: "" }).in("id", lineIds).select("order_id, kind, tracking");
  for (const r of ((data || []) as { order_id: string | null; kind: string; tracking: string }[]).filter((x) => x.order_id && x.tracking)) {
    await admin.from(r.kind === "blanks" ? "blank_shipments" : "goods_shipments").update(yes ? { track_status: "delivered", delivered_at: when, track_detail: `Freight received · signed by ${who}` } : { track_status: "", delivered_at: null, track_detail: "" }).eq("order_id", r.order_id!).eq("tracking", r.tracking);
    if (yes && r.kind === "goods") await admin.from("order_goods").update({ status: "arrived", updated_by: who, updated_at: new Date().toISOString() }).eq("order_id", r.order_id!).in("status", ["waiting", "on_way"]);
  }
  return { lines: (data || []).length };
}

export type ManifestHit = {
  key: string; supplier: string; supplier_order: string; who: string; po: string; ship_date: string | null; boxes: number; pcs: number; kind: string;
  order: { number: number; href: string } | null; styles: string; tracking: PendingShipment["tracking"];
  lineIds: string[]; customer_id: string | null; customer_name: string; customer_account: string;
};
/**
 * Search every manifest line we've ever imported (PO, customer, supplier order, tracking/PRO, style, color), one hit per
 * shipment, with where it is now and which order it's on.
 */
export async function searchManifests(admin: SupabaseClient, q: string): Promise<ManifestHit[]> {
  const t = q.trim().replace(/[%,()*]/g, " ").trim().slice(0, 60);
  if (t.length < 2) return [];
  const like = `%${t}%`;
  const { data, error } = await admin.from("supplier_manifest_lines")
    .select("*, orders!supplier_manifest_lines_order_id_fkey(id, number, customers(company, name)), archived_orders!supplier_manifest_lines_archived_order_id_fkey(id, visual_id, customers(company, name)), customers(company, name)")
    .neq("kind", "ignored")
    .or(["customer_po", "customer_name", "supplier_order", "tracking", "style", "color", "invoice", "sku"].map((c) => `${c}.ilike.${like}`).join(","))
    .order("ship_date", { ascending: false }).limit(1500);
  if (error) throw new Error(error.message);
  type R = Waiting & { kind: string; order_id: string | null; archived_order_id: string | null;
    orders: { id: string; number: number; customers: { company: string; name: string } | null } | null;
    archived_orders: { id: string; visual_id: string | number; customers: { company: string; name: string } | null } | null; customers: { company: string; name: string } | null };
  const m = new Map<string, R[]>();
  for (const l of (data || []) as R[]) { const k = `${l.supplier}|${l.supplier_order}|${l.order_id || l.archived_order_id || ""}|${l.kind}`; m.set(k, [...(m.get(k) || []), l]); }
  return [...m.entries()].slice(0, 100).map(([key, ls]) => {
    const f = ls[0];
    const c = f.orders?.customers || f.archived_orders?.customers || f.customers;
    const s = summarize({ key, supplier: f.supplier, customer_name: f.customer_name, customer_account: f.customer_account, customer_po: f.customer_po, supplier_order: f.supplier_order, lines: ls }, null, []);
    return {
      key, supplier: f.supplier, supplier_order: f.supplier_order, who: isUs(f.customer_name) && !c ? "FBS" : c?.company || c?.name || f.customer_name, po: f.customer_po, ship_date: f.ship_date,
      boxes: s.boxes, pcs: s.pcs, kind: f.kind, styles: s.styles, tracking: s.tracking,
      lineIds: ls.map((l) => l.id), customer_id: (f as R & { customer_id: string | null }).customer_id, customer_name: f.customer_name, customer_account: f.customer_account,
      order: f.order_id && f.orders ? { number: f.orders.number, href: `/shop/orders/${f.order_id}` } : f.archived_order_id && f.archived_orders ? { number: +f.archived_orders.visual_id, href: `/shop/archive/${f.archived_order_id}` } : null,
    };
  });
}

export type OpenOrderPick = { id: string; number: number; nickname: string; po: string; due_date: string | null; status: string; printavo: boolean; items: string; pcs: number; match: boolean };
/**
 * A customer's open orders to link a shipment to: orders here and (until go-live) open Printavo jobs, with what's on
 * them. `po` (the shipment's PO) floats matching orders to the top.
 */
export async function openOrdersFor(admin: SupabaseClient, customerId: string, po = ""): Promise<OpenOrderPick[]> {
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10), since60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const [{ data: os }, { data: ar }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, po_number, due_date, status, submitted_at, groups, lines").eq("customer_id", customerId).not("status", "in", "(quote)").order("number", { ascending: false }).limit(80),
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, due_date, status_name, qty, data").eq("customer_id", customerId).or(`due_date.gte.${since},due_date.is.null`).order("visual_id", { ascending: false }).limit(80),
  ]);
  const g = { customer_po: po, supplier_order: "" };
  const itemsOf = (lines: { style: string; color: string; n: number }[]) => {
    const m = new Map<string, number>();
    for (const l of lines) { const k = `${l.style} ${l.color}`.trim(); if (k) m.set(k, (m.get(k) || 0) + l.n); }
    return [...m.entries()].slice(0, 3).map(([k, n]) => `${k} (${n})`).join(", ") + (m.size > 3 ? ` +${m.size - 3} more` : "");
  };
  const out: OpenOrderPick[] = [];
  for (const o of (os || []) as (Candidate & { due_date: string | null; submitted_at: string | null; groups: unknown; lines: unknown })[]) {
    if (o.status === "request" && !o.submitted_at) continue;
    const ls: { style: string; color: string; n: number }[] = [];
    for (const gr of orderGroups(o as unknown as Order)) for (const l of gr.lines) ls.push({ style: [l.brand, l.style].filter(Boolean).join(" "), color: l.color || "", n: Object.values(l.sizes || {}).reduce((a: number, q) => a + (+(q || 0)), 0) });
    out.push({ id: o.id, number: o.number, nickname: o.nickname || "", po: o.po_number || "", due_date: o.due_date, status: o.status, printavo: false, items: itemsOf(ls), pcs: ls.reduce((a, l) => a + l.n, 0), match: !!po && poHit(o, g) });
  }
  for (const o of (ar || []) as { id: string; visual_id: string | number; nickname: string; po_number: string; due_date: string | null; status_name: string; qty: number | null; data: { groups?: { lines?: { itemNumber?: string; color?: string; sizes?: Record<string, number> }[] }[] } }[]) {
    // completed jobs too (goods often arrive after the job printed), but not quotes or cancelled ones
    const done = /job\s*completed/i.test(o.status_name || "");
    if (PV_CLOSED.test(o.status_name || "") && !done) continue;
    if (done && o.due_date && o.due_date < since60) continue;
    const ls = (o.data?.groups || []).flatMap((gr) => (gr.lines || []).map((l) => ({ style: l.itemNumber || "", color: l.color || "", n: Object.values(l.sizes || {}).reduce((a, q) => a + (+q || 0), 0) })));
    const c: Candidate = { id: PV + o.id, number: +o.visual_id || 0, nickname: o.nickname || "", po_number: o.po_number || "", customer_id: customerId, price_type: "", status: o.status_name };
    out.push({ id: PV + o.id, number: c.number, nickname: c.nickname, po: c.po_number, due_date: o.due_date, status: o.status_name, printavo: true, items: itemsOf(ls), pcs: o.qty || ls.reduce((a, l) => a + l.n, 0), match: !!po && poHit(c, g) });
  }
  // open jobs first (soonest due), completed ones after
  const isDone = (o: OpenOrderPick) => /completed/i.test(o.status);
  return out.sort((a, b) => Number(b.match) - Number(a.match) || Number(isDone(a)) - Number(isDone(b)) || (isDone(a) ? (b.due_date || "").localeCompare(a.due_date || "") : (a.due_date || "9999").localeCompare(b.due_date || "9999")));
}

/**
 * Unlink: the goods go back to "not linked", and that job is remembered as wrong for this shipment, so neither the rules
 * nor the AI put them back on it (and the AI learns from it). Nothing is deleted: tracking rows already on an order here
 * stay on it as history.
 */
export async function unlinkLines(admin: SupabaseClient, lineIds: string[], by: string, note = "") {
  const { data } = await admin.from("supplier_manifest_lines").select("*").in("id", lineIds).in("kind", ["goods", "blanks"]);
  const lines = (data || []) as (Waiting & { kind: string; order_id: string | null; archived_order_id: string | null; match_how: string })[];
  if (!lines.length) throw new Error("Those goods aren't linked to anything.");
  for (const g of groupLines(lines)) {
    const wrong = [...new Set(g.lines.map((l) => { const x = l as typeof lines[number]; return x.order_id || (x.archived_order_id ? PV + x.archived_order_id : ""); }).filter(Boolean))];
    const key = `goods-unlink:${g.key}`;
    const { data: cur } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key).maybeSingle();
    const before = ((cur?.payload as { orderIds?: string[] } | undefined)?.orderIds) || [];
    // the job numbers, for the AI and for people reading it
    const nums: number[] = [];
    for (const id of wrong) {
      const { data: o } = id.startsWith(PV) ? await admin.from("archived_orders").select("visual_id").eq("id", id.slice(PV.length)).maybeSingle() : await admin.from("orders").select("number").eq("id", id).maybeSingle();
      const n = +((o as { visual_id?: number; number?: number } | null)?.visual_id || (o as { number?: number } | null)?.number || 0);
      if (n) nums.push(n);
    }
    const how = (g.lines[0] as typeof lines[number]).match_how || "";
    await admin.from("ai_suggestions").upsert({ dedupe_key: key, kind: "goods_unlink", source: "staff", status: "done", title: `${g.customer_name} PO ${g.customer_po}: not #${nums.join(", #")}`.slice(0, 300), body: note.slice(0, 2000),
      payload: { orderIds: [...new Set([...before, ...wrong])], numbers: nums, account: g.customer_name, po: g.customer_po, wasHow: how, note: note.slice(0, 500), by }, decided_at: new Date().toISOString(), decided_by: by }, { onConflict: "dedupe_key" });
    await admin.from("supplier_manifest_lines").update({ kind: "", order_id: null, archived_order_id: null, match_how: "", linked_by: null, suggest_order_id: null, suggest_archived_id: null, suggest_how: `unlinked by ${by}${nums.length ? ` (not #${nums.join(", #")})` : ""}` }).in("id", g.lines.map((l) => l.id));
  }
  return lines.length;
}

/** Jobs staff said a shipment is NOT for (by group key). */
export async function unlinkedFrom(admin: SupabaseClient): Promise<Map<string, { orderIds: string[]; numbers: number[]; note: string; wasHow: string }>> {
  const { data } = await admin.from("ai_suggestions").select("dedupe_key, payload").eq("kind", "goods_unlink").limit(2000);
  return new Map(((data || []) as { dedupe_key: string; payload: { orderIds: string[]; numbers: number[]; note: string; wasHow: string } }[]).map((x) => [x.dedupe_key.slice("goods-unlink:".length), x.payload]));
}
