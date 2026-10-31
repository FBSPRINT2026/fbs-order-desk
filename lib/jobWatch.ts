import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings, orderGroups, type Group, type Order } from "@/lib/pricing";
import { ssAllocate, ssConfigured } from "@/lib/ss";
import { matchToSS, type GoodsRow } from "@/lib/ssMatch";
import { allRows } from "@/lib/readAll";

/**
 * Only what's at risk (Oct 12, Nick, after the first run: "a bunch of jobs just naturally flow through… there shouldn't
 * be a task for them… the only time I need them is on my dashboard when it's getting close: if I don't order the heart
 * transplant shirts today we'll miss the deadline"): a step only comes up on the day it has to happen, or once it's
 * late. No to-dos; the dashboard's "Needs you today" and a phone alert.
 *
 * The Job watcher (Oct 12, Nick: "every job has a due date, so you can work off that… remind to ask for sizes, haven't
 * seen art yet in two days, the goods are coming from S&S and they take two days to ship so we have to order today").
 *
 * Every open job with an in-hands date is planned backwards from that date, in business days (Central time):
 *   ship by     in-hands − shipping days (shipped jobs; 2 by UPS Ground)
 *   print by    ship date − 1 (or in-hands − 1 for pickup / delivery)
 *   proof OK by print date − 1
 *   art by      proof date − 1
 *   goods here  in-hands − the goods lead time (Settings → Shipping, 3)
 *   order goods goods-here date − S&S transit from the warehouse that has them (Fort Worth 1 day, Kansas 2, …; checked
 *               live with S&S when it's close)
 *   sizes / approval by the order-goods date (goods can't be bought without them)
 * Each step that isn't done yet becomes a to-do on My Day from a few days before its date (due that date), and closes
 * itself once it's done (sizes on the order, art attached, proof approved, goods ordered…). A step that's due today or
 * late is "today": those are what the phone alerts are about.
 */

/** one "Needs you today" item, kept for the dashboard (app_keys "jobwatch") */
export type AtRisk = { key: string; title: string; notes: string; url: string; by: string; owner: string | null; step: string };
export type JobStep = "approve" | "sizes" | "art" | "proof" | "goods" | "goods_late" | "print" | "ship";
export type JobAction = { orderId: string; number: number; step: JobStep; title: string; notes: string; by: string; today: boolean; url: string; ref: string;
  /** the job's owner (a staff email): only they get it; none = the owners both */ owner?: string; /** a Printavo job (orderId is the archived order) */ archived?: boolean };

/** S&S warehouse → business days by UPS Ground to the shop (Richardson, TX) */
export const TRANSIT: Record<string, number> = { TX: 1, KS: 2, IL: 2, OK: 1, GA: 3, OH: 3, KY: 3, NV: 3, FL: 3, PA: 4, NJ: 4, CA: 4, MA: 4, DS: 5 };
export const WH: Record<string, string> = { TX: "Fort Worth", KS: "Kansas", IL: "Illinois", GA: "Georgia", OH: "Ohio", KY: "Kentucky", NV: "Nevada", FL: "Florida", PA: "Pennsylvania", NJ: "New Jersey", CA: "California", MA: "Massachusetts", DS: "the mill" };

/** today in Central time, YYYY-MM-DD */
export const ctToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const d2 = (s: string) => new Date(s + "T12:00:00Z");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** n business days before (n > 0) or after (n < 0) a date; weekends skipped */
export function bizAdd(day: string, n: number) {
  const d = d2(day), step = n < 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) { d.setUTCDate(d.getUTCDate() + step); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return ymd(d);
}
/** business days from a to b (b later = positive) */
export function bizBetween(a: string, b: string) {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1, d = d2(sign > 0 ? a : b), end = sign > 0 ? b : a;
  let n = 0;
  while (ymd(d) < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n * sign;
}
export const nice = (day: string) => d2(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Row = Pick<Order, "id" | "number" | "status" | "type" | "due_date" | "nickname" | "customer_id" | "delivery_method" | "price_type"> & { groups: Group[] | null; lines: unknown; created_at: string; approved_at: string | null; production_date: string | null };

const rowsOf = (groups: Group[]) => {
  const rows: GoodsRow[] = [];
  for (const g of groups) for (const l of g.lines || []) for (const [z, q] of Object.entries(l.sizes || {})) {
    const qty = +(q || 0); if (!qty) continue;
    const key = `${l.brand}|${l.style}|${l.color}|${z}`.toLowerCase();
    const have = rows.find((r) => r.key === key);
    if (have) have.qty += qty; else rows.push({ key, brand: l.brand || "", style: l.style || "", color: l.color || "", size: z, qty, sku: "", price: 0, stock: 0, found: false, note: "" });
  }
  return rows;
};

/** where S&S would ship this job's goods from, and how many business days that takes (null: couldn't tell) */
export async function goodsTransit(admin: SupabaseClient, groups: Group[]): Promise<{ days: number; from: string; short: string[] } | null> {
  if (!ssConfigured()) return null;
  const rows = rowsOf(groups);
  if (!rows.length) return null;
  await matchToSS(admin, rows).catch(() => null);
  const ls = rows.filter((r) => r.sku).map((r) => ({ identifier: r.sku, qty: Math.round(r.qty) }));
  if (!ls.length) return null;
  const a = await ssAllocate(ls, "fewest").catch(() => null);
  if (!a) return null;
  const whs = [...new Set(a.lines.map((l) => l.warehouseAbbr))];
  const days = Math.max(1, ...whs.map((w) => TRANSIT[w] ?? 3));
  return { days, from: whs.map((w) => WH[w] || w).join(" + "), short: a.short };
}

const custName = (c?: { company: string | null; name: string | null } | null) => c?.company || c?.name || "the customer";

/** every open job's next steps, today first */
/** opts.cut is set when it ran out of time before every job was looked at (then nothing is closed as done) */
export async function watchJobs(admin: SupabaseClient, opts: { live?: boolean; deadline?: number; cut?: boolean } = {}): Promise<JobAction[]> {
  const today = ctToday();
  const [{ data: s }, { data: os }] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("orders").select("id, number, status, type, due_date, nickname, customer_id, delivery_method, price_type, groups, lines, created_at, approved_at, production_date")
      .not("due_date", "is", null).gte("due_date", bizAdd(today, 10)).lte("due_date", bizAdd(today, -30))
      .not("status", "in", "(ready,completed,cancelled,canceled)").order("due_date").limit(300),
  ]);
  const settings = mergeSettings(s?.data);
  const lead = Math.max(1, settings.ship?.goodsLeadDays ?? 3);
  const orders = ((os || []) as unknown as Row[]).filter((o) => !/^test/i.test(o.nickname || ""));
  if (!orders.length) return watchPrintavoJobs(admin, today, lead, opts).catch(() => { opts.cut = true; return [] as JobAction[]; });
  const ids = orders.map((o) => o.id), cids = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[];
  const [{ data: cs }, { data: pf }, { data: bo }, { data: gc }] = await Promise.all([
    cids.length ? admin.from("customers").select("id, company, name, price_type, is_test").in("id", cids) : Promise.resolve({ data: [] }),
    admin.from("proofs").select("order_id, status, created_at").in("order_id", ids).is("archived_at", null),
    admin.from("blank_orders").select("order_id, status, expected_date, received_at, created_at").in("order_id", ids),
    admin.from("goods_checkins").select("order_id, status, created_at").in("order_id", ids),
  ]);
  const cust = new Map(((cs || []) as { id: string; company: string | null; name: string | null; price_type: string | null; is_test: boolean | null }[]).map((c) => [c.id, c]));
  const out: JobAction[] = [];
  for (const o of orders) {
    if (opts.deadline && Date.now() > opts.deadline) { opts.cut = true; break; }
    const c = o.customer_id ? cust.get(o.customer_id) : undefined;
    if (c?.is_test) continue;
    const due = o.due_date!, who = custName(c), job = `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`;
    const groups = orderGroups(o as unknown as Order);
    const shipped = /ship/i.test(o.delivery_method || "");
    const shipBy = shipped ? bizAdd(due, 2) : due;
    const printBy = bizAdd(shipBy, 1), proofBy = bizAdd(printBy, 1), artBy = bizAdd(proofBy, 1);
    const goodsHere = bizAdd(due, lead);
    const quote = o.type === "quote" || ["request", "quote", "quote_sent"].includes(o.status);
    const started = ["blanks", "production"].includes(o.status);
    const wholesale = (o.price_type || c?.price_type) === "wholesale";
    const pieces = groups.reduce((n, g) => n + (g.lines || []).reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, q) => a + (+(q || 0)), 0), 0), 0);
    const garments = groups.some((g) => (g.lines || []).some((l) => l.style || l.garment || l.color));
    const noArt = groups.some((g) => (g.imprints || []).length > 0 && (g.imprints || []).some((im) => !im.design_id) && !(g.customerMockups || []).length && !g.mockupAt);
    const proofs = (pf || []).filter((p) => p.order_id === o.id);
    const proofOk = proofs.some((p) => /approved/i.test(p.status)), proofWaiting = proofs.some((p) => /pending|sent|waiting/i.test(p.status));
    const goods = (bo || []).filter((b) => b.order_id === o.id), checkins = (gc || []).filter((g) => g.order_id === o.id);
    const ordered = goods.length > 0 || started || o.status === "blanks";
    const received = goods.some((b) => b.received_at) || checkins.some((g) => /received|done|ok/i.test(String(g.status)));
    const url = `/shop/orders/${o.id}`;
    const add = (step: JobStep, by: string, title: string, notes: string, link = url, startDays = 2) => {
      // shows from a couple of business days before its date
      if (by > today || startDays < -99) return; // only what's due today or late (Oct 12, Nick: jobs flow on their own; tell me when it has to happen today)
      out.push({ orderId: o.id, number: o.number, step, title, notes, by, today: by <= today, url: link, ref: `job:${o.id}:${step}` });
    };
    const late = (by: string) => (by < today ? ` (was due ${nice(by)})` : by === today ? " today" : ` by ${nice(by)}`);

    // goods: order date from the warehouse that really has them (live when it's close), else Fort Worth's 1 day
    let orderBy = bizAdd(goodsHere, 1), from = "", short: string[] = [];
    if (!wholesale && !ordered && !quote && pieces > 0 && opts.live !== false && bizBetween(today, bizAdd(goodsHere, 1)) <= 3) {
      const t = await goodsTransit(admin, groups).catch(() => null);
      if (t) { orderBy = bizAdd(goodsHere, t.days); from = t.from; short = t.short; }
    }
    const needBy = bizAdd(goodsHere, 1); // sizes / approval needed to buy goods (best case)

    if (quote) add("approve", needBy, `Get ${job} approved${late(needBy)}`, `${who} hasn't approved it yet. It's due in hands ${nice(due)}, and the goods have to be ordered by ${nice(needBy)} to make it.`, url, 3);
    if (garments && pieces === 0 && !started) add("sizes", needBy, `Ask ${who} for sizes on ${job}${late(needBy)}`, `No sizes on the order yet. Goods have to be ordered by ${nice(needBy)} for the ${nice(due)} in-hands date.`, url, 3);
    if (noArt && !proofOk && !started) {
      // art not in two days after the job was made, or it's getting close
      const waited = bizBetween(o.created_at.slice(0, 10), today) >= 2;
      if (artBy <= today && waited !== undefined) out.push({ orderId: o.id, number: o.number, step: "art", title: `Art for ${job} isn't in yet: ask ${who}${artBy <= today ? late(artBy) : ""}`, notes: `No art on the order${waited ? ` ${bizBetween(o.created_at.slice(0, 10), today)} business days after it was made` : ""}. We need it by ${nice(artBy)} to proof and print for ${nice(due)}.`, by: artBy, today: true, url, ref: `job:${o.id}:art` });
    }
    if (!noArt && !proofOk && proofWaiting && !started) add("proof", proofBy, `Get the proof for ${job} approved${late(proofBy)}`, `${who} hasn't approved the proof. It has to be approved by ${nice(proofBy)} to print by ${nice(printBy)}.`);
    if (!wholesale && !ordered && !quote && pieces > 0) {
      const fromTxt = from ? ` S&S ships them from ${from} (${bizBetween(orderBy, goodsHere)} business day${bizBetween(orderBy, goodsHere) === 1 ? "" : "s"}).` : "";
      add("goods", orderBy, `Order goods for ${job}${late(orderBy)}`, `${pieces} pcs need to be here by ${nice(goodsHere)} for the ${nice(due)} in-hands date.${fromTxt}${short.length ? ` Short at S&S: ${short.slice(0, 3).join(", ")}.` : ""}`, `/shop/order-goods?order=${o.id}`, 2);
    }
    if (ordered && !received && goods.length && today > goodsHere) {
      const exp = goods.map((b) => b.expected_date).filter(Boolean).sort().pop();
      out.push({ orderId: o.id, number: o.number, step: "goods_late", title: `Goods for ${job} aren't in yet`, notes: `They were needed by ${nice(goodsHere)}${exp ? ` (expected ${nice(exp)})` : ""}. Check the tracking; in hands ${nice(due)}.`, by: goodsHere, today: true, url: "/shop/receiving", ref: `job:${o.id}:goods_late` });
    }
    if (!quote && o.status !== "production" && printBy <= bizAdd(today, -1)) add("print", printBy, `Print ${job}${late(printBy)}`, `Still at "${o.status}". In hands ${nice(due)}${shipped ? `, ships ${nice(shipBy)}` : ""}.`, url, 1);
    if (shipped && o.status === "production" && shipBy <= today) add("ship", shipBy, `Ship ${job}${late(shipBy)}`, `UPS Ground to be there ${nice(due)}.`, url, 0);
  }
  // a portal job's owner (Oct 15: Amanda's "Needs you today" had Nick's Little Groupies): the customer's account owner
  // (Settings → Staff), else whoever owns their latest Printavo job; none found = both owners, as before
  const open = out.filter((x) => !x.archived && !x.owner);
  if (open.length) {
    const cidOf = new Map(orders.map((o) => [o.id, (o as { customer_id?: string | null }).customer_id || ""]));
    const owners = await customerOwners(admin, [...new Set(open.map((x) => cidOf.get(x.orderId) || "").filter(Boolean))]).catch(() => new Map<string, string>());
    for (const x of open) { const e = owners.get(cidOf.get(x.orderId) || ""); if (e) x.owner = e; }
  }
  if (opts.deadline && Date.now() > opts.deadline - 8000) opts.cut = true;
  else out.push(...await watchPrintavoJobs(admin, today, lead, opts).catch((e) => { console.error("watchPrintavoJobs", e); opts.cut = true; return [] as JobAction[]; }));
  return out.sort((a, b) => Number(b.today) - Number(a.today) || a.by.localeCompare(b.by));
}

/** whose customers these are (staff emails): the account owner set here, else the owner of their latest Printavo job */
export async function customerOwners(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const [{ data: st }, { data: ao }, { data: pv }] = await Promise.all([
    admin.from("staff").select("email, name"),
    admin.from("customer_private").select("customer_id, account_owner").in("customer_id", ids).neq("account_owner", ""),
    allRows((r0, r1) => admin.from("archived_orders").select("customer_id, order_date, owner:data->>owner").in("customer_id", ids).order("order_date", { ascending: false }).order("id").range(r0, r1), 2000),
  ]);
  const staff = (st || []) as { email: string; name: string | null }[];
  const emailOf = (n?: string | null) => { const t = (n || "").trim().toLowerCase(); if (!t) return undefined; const first = t.split(/\s+/)[0]; const m = staff.find((x) => (x.name || "").toLowerCase() === t) || staff.find((x) => (x.name || "").toLowerCase().split(/\s+/)[0] === first) || staff.find((x) => x.email.toLowerCase().split("@")[0] === first); return m?.email.toLowerCase(); };
  for (const r of (pv || []) as { customer_id: string; owner: string | null }[]) if (!out.has(r.customer_id)) { const e = emailOf(r.owner); if (e) out.set(r.customer_id, e); }
  for (const r of (ao || []) as { customer_id: string; account_owner: string }[]) { const e = emailOf(r.account_owner); if (e) out.set(r.customer_id, e); }
  return out;
}

/**
 * The jobs still run in Printavo until the switch (Nov 1): read from the Printavo mirror (archived_orders, kept current
 * every 5 minutes). Each garment line says whether its goods are ordered / received; sizes, mockups and approvals are
 * there too, and the job's owner (Nick or Amanda) gets its reminders.
 */
type PvLine = { brand?: string; color?: string; items?: number; sizes?: Record<string, number>; status?: string; mockups?: unknown[]; itemNumber?: string; description?: string; category?: string };
type PvGroup = { lines?: PvLine[]; imprints?: { mockups?: unknown[] }[] };
type PvData = { groups?: PvGroup[]; approvals?: { status?: string; name?: string }[]; deliveryMethod?: string; owner?: string; createdAt?: string; files?: unknown[] };
async function watchPrintavoJobs(admin: SupabaseClient, today: string, lead: number, opts: { live?: boolean; deadline?: number; cut?: boolean }): Promise<JobAction[]> {
  const [{ data: rows }, { data: st }] = await Promise.all([
    admin.from("archived_orders").select("id, visual_id, kind, nickname, status_name, due_date, customer_id, data, customers(company, name, is_test)")
      .not("due_date", "is", null).gte("due_date", today).lte("due_date", bizAdd(today, -30)).not("status_name", "ilike", "%complete%").not("status_name", "ilike", "%cancel%").limit(400),
    admin.from("staff").select("email, name"),
  ]);
  const staff = (st || []) as { email: string; name: string | null }[];
  const ownerEmail = (n?: string) => { const t = (n || "").trim().toLowerCase(); if (!t) return undefined; const first = t.split(/\s+/)[0]; const m = staff.find((x) => (x.name || "").toLowerCase() === t) || staff.find((x) => (x.name || "").toLowerCase().split(/\s+/)[0] === first) || staff.find((x) => x.email.toLowerCase().split("@")[0] === first); return m?.email.toLowerCase(); };
  const out: JobAction[] = [];
  for (const r of (rows || []) as unknown as { id: string; visual_id: string; kind: string; nickname: string | null; status_name: string | null; due_date: string; customer_id: string | null; data: PvData; customers: { company: string | null; name: string | null; is_test: boolean | null } | null }[]) {
    if (opts.deadline && Date.now() > opts.deadline) { opts.cut = true; break; }
    if (r.customers?.is_test) continue;
    const d = r.data || {}, due = r.due_date, who = custName(r.customers), job = `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""}`, stName = r.status_name || "";
    const owner = ownerEmail(d.owner), url = `/shop/archive/${r.id}`;
    const shipped = /ship/i.test(d.deliveryMethod || "");
    const shipBy = shipped ? bizAdd(due, 2) : due, goodsHere = bizAdd(due, lead), needBy = bizAdd(goodsHere, 1);
    const quote = r.kind === "quote" || /quote/i.test(stName);
    const lines = (d.groups || []).flatMap((g) => g.lines || []);
    // garment lines (a style or brand, not "EXTRAS" / fees), and the ones the customer brings
    const garments = lines.filter((l) => (l.itemNumber || l.brand) && (l.items || 0) > 0);
    const theirs = (l: PvLine) => /customer (supplied|provided|goods)|cust(omer)?'?s? (own )?goods|supplied by (the )?customer/i.test(l.description || "");
    const ours = garments.filter((l) => !theirs(l));
    const notOrdered = ours.filter((l) => !l.status), ordered = ours.filter((l) => l.status === "ordered" || l.status === "partially_received");
    const noSizes = garments.filter((l) => !Object.values(l.sizes || {}).some((q) => +q > 0));
    const art = (d.groups || []).some((g) => (g.imprints || []).some((im) => (im.mockups || []).length) || (g.lines || []).some((l) => (l.mockups || []).length));
    const apprs = d.approvals || [], approved = apprs.some((a) => a.status === "approved"), waiting = apprs.some((a) => a.status && a.status !== "approved" && !/declin|retract|revok/i.test(a.status));
    const add = (step: JobStep, by: string, title: string, notes: string, link = url, startDays = 2, today2?: boolean) => {
      if (by > today || startDays < -99) return; // only what's due today or late (Oct 12, Nick: jobs flow on their own; tell me when it has to happen today)
      out.push({ orderId: r.id, number: +r.visual_id || 0, step, title, notes, by, today: today2 ?? by <= today, url: link, ref: `pv:${r.id}:${step}`, owner, archived: true });
    };
    const late = (by: string) => (by < today ? ` (was due ${nice(by)})` : by === today ? " today" : ` by ${nice(by)}`);
    const held = /waiting on details|on hold/i.test(stName);
    // past the goods / art stage in Printavo (ready for production or scheduling, on press, ready to ship): the line
    // markings often lag, so nothing about goods, sizes or art (Oct 12: the first run flagged jobs that were done)
    const pastGoods = /ready for production|ready for scheduling|scheduling|press|printing|ready to ship|shipping|deliver|transfers ordered/i.test(stName);

    if (quote) { add("approve", needBy, `Get ${job} approved${late(needBy)}`, `${who} hasn't approved it yet. In hands ${nice(due)}; goods have to be ordered by ${nice(needBy)}.`, url, 3); continue; }
    if (!pastGoods && (noSizes.length || held)) add("sizes", needBy, `${noSizes.length ? `Get sizes from ${who}` : `Get the missing details from ${who}`} for ${job}${late(needBy)}`, `${noSizes.length ? `${noSizes.length} garment line${noSizes.length === 1 ? " has" : "s have"} no sizes` : `Printavo says "${stName}"`}. Goods have to be ordered by ${nice(needBy)} for the ${nice(due)} in-hands date.`, url, 3);
    if (waiting && !approved) add("proof", bizAdd(goodsHere, 0), `Get ${who}'s approval on ${job}${late(goodsHere)}`, `The approval in Printavo is still waiting. In hands ${nice(due)}.`, url, 2);
    if (!pastGoods && !art && garments.length && !approved) {
      const made = (d.createdAt || "").slice(0, 10), waited = made ? bizBetween(made, today) >= 2 : false, artBy = bizAdd(shipBy, 3);
      if (artBy <= today && waited !== undefined) out.push({ orderId: r.id, number: +r.visual_id || 0, step: "art", title: `No art or mockup on ${job} yet: ask ${who}`, notes: `Nothing on the job${waited ? ` ${bizBetween(made, today)} business days after it was made` : ""}. We need it by ${nice(artBy)} to proof and print for ${nice(due)}.`, by: artBy, today: true, url, ref: `pv:${r.id}:art`, owner, archived: true });
    }
    if (!pastGoods && notOrdered.length && !noSizes.length) {
      let orderBy = needBy, from = "";
      if (opts.live !== false && bizBetween(today, needBy) <= 3) {
        const groups = [{ lines: notOrdered.map((l) => ({ brand: l.brand || "", style: l.itemNumber || "", color: l.color || "", sizes: Object.fromEntries(Object.entries(l.sizes || {}).map(([k, q]) => [k.replace(/^size_/, "").toUpperCase(), q])) })) }] as unknown as Group[];
        const t = await goodsTransit(admin, groups).catch(() => null);
        if (t) { orderBy = bizAdd(goodsHere, t.days); from = ` S&S ships them from ${t.from} (${bizBetween(orderBy, goodsHere)} business day${bizBetween(orderBy, goodsHere) === 1 ? "" : "s"}).${t.short.length ? ` Short: ${t.short.slice(0, 3).join(", ")}.` : ""}`; }
      }
      const pcs = notOrdered.reduce((n, l) => n + (l.items || 0), 0);
      add("goods", orderBy, `Order goods for ${job}${late(orderBy)}`, `${pcs} pcs (${notOrdered.map((l) => `${l.brand || ""} ${l.itemNumber || ""} ${l.color || ""}`.trim()).slice(0, 3).join("; ")}) aren't marked ordered in Printavo. They need to be here by ${nice(goodsHere)} for ${nice(due)}.${from}`, url, 2);
    }
    const inProd = /press|production|printing|ship|deliver|embroider|ready/i.test(stName) && !/pre production|ready for production|scheduling/i.test(stName);
    if (ordered.length && today > goodsHere && !inProd && /receiving/i.test(stName)) out.push({ orderId: r.id, number: +r.visual_id || 0, step: "goods_late", title: `Goods for ${job} aren't all in`, notes: `${ordered.length} line${ordered.length === 1 ? " is" : "s are"} still "ordered" in Printavo; they were needed by ${nice(goodsHere)} for ${nice(due)}. Check the tracking.`, by: goodsHere, today: true, url, ref: `pv:${r.id}:goods_late`, owner, archived: true });
    if (false && /ready to ship/i.test(stName) && shipBy <= today) add("ship", shipBy, `${shipped ? "Ship" : "Deliver or set out"} ${job}${late(shipBy)}`, `It's ready (${stName}). In hands ${nice(due)}.`, url, 0);
  }
  return out;
}
