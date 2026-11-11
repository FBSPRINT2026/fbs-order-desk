import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/readAll";
import type { CheckinRow } from "@/lib/checkinShared";
import type { Flag } from "@/lib/orderStages";
import { whoWorks, type GoodsIssue, type IssueItem, type IssueOwner } from "@/lib/goodsIssueShared";

/**
 * Goods issues (Nov 2, Nick: "something at the top that says issues… when receiving checks in goods… they sent us a wrong
 * box, the wrong color, they shorted us sizes… and whether the customer needs to work it or whether we're working it…
 * treat it like a suborder"). One row per problem, shown at the top of Goods for the shop and the customer:
 *  - check-in (openFromCheckin): short, over, wrong item, damaged; the items still owed are a small order of their own,
 *    so the replacement box is matched to it (lib/manifest.ts counts what's owed as need) and checking it in closes it;
 *  - tracking (scanTracking): a label made but no scan by the next morning, delayed, an exception, return to sender,
 *    damaged or undeliverable.
 * Who works it: the customer (their own S&S account or vendor) or the shop (our own blank orders: SanMar, our S&S).
 * While one is open on an order, the order is on hold for goods (flag goods_wrong); the account's owner gets an alert in
 * the shop. No emails go out from here.
 */

const BY = "Goods issues";
const pcs = (n: number) => `${n} pc${n === 1 ? "" : "s"}`;
const label = (it: IssueItem) => [it.style, it.color, it.size].filter(Boolean).join(" ");

/** the order's goods hold on or off (only the one this added; a hold staff set by hand stays) */
export async function holdForGoods(admin: SupabaseClient, orderId: string, note: string | null) {
  const { data: o } = await admin.from("orders").select("flags").eq("id", orderId).maybeSingle();
  if (!o) return;
  const flags = ((o.flags || []) as Flag[]).filter(Boolean);
  const mine = flags.find((f) => f.key === "goods_wrong");
  let next = flags;
  if (note) next = mine ? flags.map((f) => (f.key === "goods_wrong" && f.by === BY ? { ...f, note } : f)) : [...flags, { key: "goods_wrong", note, by: BY, at: new Date().toISOString() } as Flag];
  else if (mine && mine.by === BY) next = flags.filter((f) => f !== mine);
  if (next !== flags) await admin.from("orders").update({ flags: next }).eq("id", orderId);
}

/** an alert for whoever's on the account (in the shop; no email) */
async function tellAccount(admin: SupabaseClient, i: { id: string; customer_id: string | null; order_id: string | null; title: string; detail: string }, number: number | string) {
  if (!i.customer_id) return;
  const { data: c } = await admin.from("customers").select("owner_email, company, name").eq("id", i.customer_id).maybeSingle();
  const owner = String(c?.owner_email || "").toLowerCase();
  if (!owner) return;
  await admin.from("alerts").insert({ owner, kind: "goods", title: `#${number} on hold: ${i.title}`.slice(0, 120), body: `${c?.company || c?.name || ""}: ${i.detail}`.slice(0, 400),
    url: i.order_id ? `/shop/orders/${i.order_id}` : "/shop/receiving", dedupe_key: `goods-issue:${i.id}:${owner}` });
  await admin.from("goods_issues").update({ alerted_at: new Date().toISOString() }).eq("id", i.id);
}

/** what a job's goods came as: whose account (our blanks or theirs), the supplier, its order # and PO */
async function goodsSource(admin: SupabaseClient, orderId: string | null, archivedId: string | null) {
  const q = admin.from("supplier_manifest_lines").select("supplier, supplier_order, customer_po, kind, tracking");
  const { data } = orderId ? await q.eq("order_id", orderId).limit(400) : archivedId ? await q.eq("archived_order_id", archivedId).limit(400) : { data: [] };
  const ls = (data || []) as { supplier: string; supplier_order: string; customer_po: string; kind: string; tracking: string }[];
  const blanks = ls.some((l) => l.kind === "blanks");
  return {
    owner: whoWorks({ blanks, supplier: ls[0]?.supplier || "" }),
    supplier: ls[0]?.supplier || "",
    supplierOrder: [...new Set(ls.map((l) => l.supplier_order).filter(Boolean))].join(", "),
    po: [...new Set(ls.map((l) => l.customer_po).filter(Boolean))].join(", "),
  };
}

/** A check-in with problems becomes an issue: what's still owed, who works it, the order on hold, the account told. */
export async function openFromCheckin(admin: SupabaseClient, c: CheckinRow, by: string, ownerPick?: IssueOwner | "auto") {
  const bad = (c.lines || []).filter((l) => l.issue);
  if (!bad.length) return null;
  const items: IssueItem[] = bad.map((l) => ({
    style: l.style, color: l.color, size: l.size, expected: l.expected, received: l.received, bad: l.bad || 0, issue: l.issue, note: l.note || "",
    // what's still owed: the pieces short, or the damaged / wrong ones to be replaced (over: nothing owed)
    owed: l.issue === "over" ? 0 : l.issue === "short" ? Math.max(0, l.expected - l.received) : Math.max(l.bad || 0, l.expected - l.received, 0),
  }));
  const src = await goodsSource(admin, c.order_id, c.archived_order_id);
  const { data: o } = c.order_id ? await admin.from("orders").select("number, customer_id, po_number").eq("id", c.order_id).maybeSingle()
    : await admin.from("archived_orders").select("visual_id, customer_id, po_number").eq("id", c.archived_order_id || "").maybeSingle();
  const number = (o as { number?: number; visual_id?: string } | null)?.number ?? (o as { visual_id?: string } | null)?.visual_id ?? "";
  const owed = items.reduce((a, it) => a + it.owed, 0);
  const kinds = [...new Set(items.map((it) => it.issue))];
  const kind = kinds.length === 1 ? kinds[0] : kinds.includes("damaged") ? "damaged" : kinds.includes("mispick") ? "mispick" : "short";
  // said the way the items read: "5 pieces short", "2 pieces damaged" (Nov 2, Nick)
  const title = kind === "short" ? `${pcs(owed)} short` : kind === "over" ? `${pcs(items.reduce((a, it) => a + Math.max(0, it.received - it.expected), 0))} over` : kind === "damaged" ? `${pcs(owed)} damaged` : kind === "mispick" ? `${pcs(owed)} wrong` : `${pcs(owed)} to replace`;
  const detail = items.map((it) => `${label(it)}: got ${it.received} of ${it.expected}${it.bad ? ` (${it.bad} ${it.issue === "mispick" ? "wrong" : "damaged"})` : ""}`).join("; ");
  const row = {
    order_id: c.order_id, archived_order_id: c.archived_order_id, customer_id: (o as { customer_id?: string } | null)?.customer_id || null, checkin_id: c.id,
    kind, source: "checkin", owner: ownerPick && ownerPick !== "auto" ? ownerPick : src.owner, supplier: src.supplier, supplier_order: src.supplierOrder, po: src.po || String((o as { po_number?: string } | null)?.po_number || ""),
    items, title, detail: detail.slice(0, 2000), photos: c.photos || [], status: "open", dedupe_key: `checkin:${c.id}`, created_by: by,
  };
  const { data: made, error } = await admin.from("goods_issues").upsert(row, { onConflict: "dedupe_key" }).select("*").single();
  if (error || !made) return null;
  if (c.order_id) await holdForGoods(admin, c.order_id, `${title}: ${detail}`.slice(0, 300));
  await tellAccount(admin, made as GoodsIssue, number).catch(() => null);
  return made as GoodsIssue;
}

/**
 * A count that came out right: the order's issues waiting on a replacement (reported or replacing) are done.
 * Called after every check-in without problems.
 */
export async function closeOnGoodCount(admin: SupabaseClient, orderId: string | null, archivedId: string | null, by: string) {
  const q = admin.from("goods_issues").select("id, order_id").is("closed_at", null).neq("kind", "tracking").neq("kind", "over");
  const { data } = orderId ? await q.eq("order_id", orderId) : archivedId ? await q.eq("archived_order_id", archivedId) : { data: [] };
  for (const i of (data || []) as { id: string }[]) await closeIssue(admin, i.id, by, "The replacement was checked in");
}

/** Close one; the order comes off its goods hold when nothing else is open; the check-in it came from is resolved. */
export async function closeIssue(admin: SupabaseClient, id: string, by: string, how: string) {
  const { data: i } = await admin.from("goods_issues").update({ status: "closed", closed_at: new Date().toISOString(), closed_by: by, closed_how: how.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id).is("closed_at", null).select("order_id, checkin_id").maybeSingle();
  if (!i) return;
  if (i.checkin_id) await admin.from("goods_checkins").update({ resolved_at: new Date().toISOString(), resolved_by: by, resolution: how.slice(0, 1000) }).eq("id", i.checkin_id).is("resolved_at", null);
  if (i.order_id) {
    const { count } = await admin.from("goods_issues").select("id", { count: "exact", head: true }).eq("order_id", i.order_id).is("closed_at", null).neq("kind", "tracking");
    if (!count) await holdForGoods(admin, i.order_id, null);
  }
}

/**
 * Tracking that's gone wrong, for orders whose goods are on the way: no scan by the morning after the label was made
 * (the supplier's ship date), or the carrier says delayed, exception, return to sender, damaged or undeliverable. One
 * issue per order and tracking number; it closes by itself when the package moves again or arrives. "We're watching it"
 * (the shop) unless the customer sent it themselves.
 */
export async function scanTracking(admin: SupabaseClient, deadline: number) {
  const out = { opened: 0, closed: 0 };
  const since = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
  const { data } = await allRows((r0, r1) => admin.from("supplier_manifest_lines").select("order_id, archived_order_id, customer_id, supplier, supplier_order, customer_po, tracking, track_status, track_detail, ship_date, method, delivered_at, kind")
    .in("kind", ["goods", "blanks"]).neq("tracking", "").is("delivered_at", null).gte("ship_date", since).order("id").range(r0, r1), 20000);
  type T = { order_id: string | null; archived_order_id: string | null; customer_id: string | null; supplier: string; supplier_order: string; customer_po: string; tracking: string; track_status: string; track_detail: string; ship_date: string | null; method: string; kind: string };
  const byTrk = new Map<string, T & { boxes: number }>();
  for (const l of (data || []) as T[]) {
    if (!l.order_id && !l.archived_order_id) continue;
    if (/ltl|freight|truck/i.test(l.method || "")) continue; // freight and the local truck don't scan like a parcel
    const k = `${l.order_id || l.archived_order_id}|${l.tracking}`;
    const x = byTrk.get(k); if (x) x.boxes++; else byTrk.set(k, { ...l, boxes: 1 });
  }
  const now = Date.now();
  for (const t of byTrk.values()) {
    if (Date.now() > deadline) break;
    const st = (t.track_status || "").toLowerCase(), det = t.track_detail || "";
    // the morning after it shipped (about 7 AM Central): a parcel should have its first scan by then
    const scanBy = t.ship_date ? Date.parse(`${t.ship_date}T12:00:00Z`) + 86400000 : 0;
    const noScan = (!st || st === "pre_transit" || st === "unknown") && scanBy && now > scanBy;
    const bad = ["failure", "return_to_sender", "error", "cancelled"].includes(st) || /damag|undeliver|exception|refused|delay/i.test(det);
    const key = `trk:${t.order_id || t.archived_order_id}:${t.tracking}`;
    if (!noScan && !bad) {
      // moving again or here: an open one closes
      const { data: open } = await admin.from("goods_issues").select("id").eq("dedupe_key", key).is("closed_at", null).maybeSingle();
      if (open) { await closeIssue(admin, open.id, "Tracking", st === "delivered" ? "It arrived" : "It's moving again"); out.closed++; }
      continue;
    }
    const title = noScan ? "Box not scanned yet" : st === "return_to_sender" ? "Returning to the supplier" : /damag/i.test(det) ? "Damaged in transit" : /undeliver|refused/i.test(det) ? "Undeliverable" : /delay/i.test(det) ? "Delayed" : "Carrier problem";
    const detail = noScan ? `Label made ${t.ship_date}, no carrier scan since${t.boxes > 1 ? ` (${t.boxes} boxes on this tracking)` : ""}` : `${det || st}${t.boxes > 1 ? ` · ${t.boxes} boxes on this tracking` : ""}`;
    const { data: exists } = await admin.from("goods_issues").select("id, title").eq("dedupe_key", key).maybeSingle();
    if (exists) { if (exists.title !== title) await admin.from("goods_issues").update({ title, detail, updated_at: new Date().toISOString() }).eq("id", exists.id); continue; }
    const { data: made } = await admin.from("goods_issues").insert({
      order_id: t.order_id, archived_order_id: t.archived_order_id, customer_id: t.customer_id, kind: "tracking", source: "tracking", owner: "shop",
      supplier: t.supplier, supplier_order: t.supplier_order, po: t.customer_po, tracking: t.tracking, title, detail, dedupe_key: key, created_by: "Tracking",
    }).select("*").single();
    if (made) out.opened++;
  }
  return out;
}

/** the issues these customers see (all customers when null): open, and closed in the last week */
export async function listIssues(admin: SupabaseClient, customerIds: string[] | null): Promise<GoodsIssue[]> {
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  let q = admin.from("goods_issues").select("*").or(`closed_at.is.null,closed_at.gte.${week}`).order("created_at", { ascending: false }).limit(300);
  if (customerIds) q = q.in("customer_id", customerIds.length ? customerIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  const list = (data || []) as GoodsIssue[];
  // the order's number and name, and photos to look at
  const oIds = [...new Set(list.map((i) => i.order_id).filter(Boolean))] as string[], aIds = [...new Set(list.map((i) => i.archived_order_id).filter(Boolean))] as string[];
  const [{ data: os }, { data: as }] = await Promise.all([
    oIds.length ? admin.from("orders").select("id, number, nickname, discarded_at").in("id", oIds) : Promise.resolve({ data: [] }),
    aIds.length ? admin.from("archived_orders").select("id, visual_id, nickname").in("id", aIds) : Promise.resolve({ data: [] }),
  ]);
  const name = new Map<string, { number: string; nickname: string }>();
  // an order that was deleted (a test order, a duplicate) takes its goods issues with it (Nov 11, Nick: #99005)
  const gone = new Set(((os || []) as { id: string; discarded_at: string | null }[]).filter((o) => o.discarded_at).map((o) => o.id));
  for (const o of (os || []) as { id: string; number: number; nickname: string }[]) name.set(o.id, { number: String(o.number), nickname: o.nickname || "" });
  for (const o of (as || []) as { id: string; visual_id: string; nickname: string }[]) name.set(o.id, { number: String(o.visual_id), nickname: o.nickname || "" });
  const paths = [...new Set(list.flatMap((i) => (i.photos || []) as string[]))];
  const signed = paths.length ? (await admin.storage.from("proofs").createSignedUrls(paths, 30 * 86400)).data || [] : [];
  const url = new Map(paths.map((p, k) => [p, signed[k]?.signedUrl || ""]));
  return list.filter((i) => !(i.order_id && gone.has(i.order_id))).map((i) => ({ ...i, number: name.get(i.order_id || i.archived_order_id || "")?.number || "", nickname: name.get(i.order_id || i.archived_order_id || "")?.nickname || "", photoUrls: ((i.photos || []) as string[]).map((p) => url.get(p) || "").filter(Boolean) }));
}

/** the supplier reps on file: the shop's (customer null) and this customer's */
export async function repsFor(admin: SupabaseClient, customerId: string | null) {
  const { data } = await admin.from("goods_reps").select("customer_id, supplier, email, name").or(customerId ? `customer_id.is.null,customer_id.eq.${customerId}` : "customer_id.is.null");
  return (data || []) as { customer_id: string | null; supplier: string; email: string; name: string }[];
}
