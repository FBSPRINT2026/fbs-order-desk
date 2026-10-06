import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroups, type Order } from "@/lib/pricing";
import { sizeKey, PV } from "@/lib/manifest";

/**
 * Check-In: receiving counts each job's goods in, size by size.
 *
 * Built from how the decorator systems do it (DecoNetwork "Receive stock", Printavo Receiving, YoPrint PO receiving):
 * tick a row to take the full amount (green), type a lower number for a partial (yellow), save; plus what they leave
 * to paper: short / damaged / wrong item noted on the spot, and the job flagged until someone deals with it.
 *
 * The week's jobs come from the production schedule (Printavo's start date, else the due date; orders here: production
 * date, else due). What should be in the boxes comes from the supplier manifests when the job has them (style, color
 * and size, exactly what shipped), else from the job's own line items. A job whose manifest packages have all been
 * delivered is "Ready to count".
 */

export * from "@/lib/checkinShared";
import type { CheckItem, CheckJob, CheckLine, CheckinRow, Issue, JobState } from "@/lib/checkinShared";
const sizeOf = (k: string) => { const raw = k.replace(/^size_/, ""); if (/^(adj|adjustable|osfa|os|one\s*size)$/i.test(raw.trim())) return "OS"; const z = sizeKey(raw); return /^other$/i.test(z) ? "OTHER" : z; };

const ymd = (d: string | null | undefined) => (d ? d.slice(0, 10) : null);
/** a Printavo time ("2026-10-05T04:15:00-05:00") as the shop's local day */
const localDay = (t: string | null | undefined) => {
  if (!t) return null;
  const d = new Date(t); if (isNaN(+d)) return ymd(t);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
};

type ML = { id: string; order_id: string | null; archived_order_id: string | null; supplier: string; style: string; mill: string; color: string; size: string; qty_shipped: number; box: string | null; tracking: string; track_status: string; delivered_at: string | null; kind: string };

function itemsFromManifest(ls: ML[]): CheckItem[] {
  const m = new Map<string, CheckItem>();
  for (const l of ls) {
    const key = `${(l.style || "").trim().toUpperCase()}|${(l.color || "").trim().toUpperCase()}`;
    const it = m.get(key) || { key, style: l.style || "", color: l.color || "", desc: l.mill || "", sizes: {} };
    const z = sizeOf(l.size || "OTHER");
    it.sizes[z] = (it.sizes[z] || 0) + (l.qty_shipped || 0);
    m.set(key, it);
  }
  return [...m.values()].sort((a, b) => a.style.localeCompare(b.style) || a.color.localeCompare(b.color));
}

type PvLine = { itemNumber?: string; brand?: string; color?: string; description?: string; category?: string; sizes?: Record<string, number> };
function itemsFromPrintavo(data: { groups?: { lines?: PvLine[] }[] } | null): CheckItem[] {
  const out: CheckItem[] = [];
  for (const g of data?.groups || []) for (const l of g.lines || []) {
    const sizes: Record<string, number> = {};
    for (const [k, q] of Object.entries(l.sizes || {})) if (+q > 0) { const z = sizeOf(k); sizes[z] = (sizes[z] || 0) + +q; }
    if (!Object.keys(sizes).length) continue;
    out.push({ key: `${out.length}`, style: l.itemNumber || "", color: l.color || "", desc: [l.brand, l.description].filter(Boolean).join(" · ").slice(0, 80), sizes });
  }
  return out;
}
function itemsFromOrder(o: Pick<Order, "groups" | "lines">): CheckItem[] {
  const out: CheckItem[] = [];
  for (const g of orderGroups(o)) for (const l of g.lines) {
    const sizes: Record<string, number> = {};
    for (const [k, q] of Object.entries(l.sizes || {})) if (+(q || 0) > 0) { const z = sizeOf(k); sizes[z] = (sizes[z] || 0) + +(q || 0); }
    if (!Object.keys(sizes).length) continue;
    out.push({ key: `${out.length}`, style: l.style || "", color: l.color || "", desc: l.garment || "", sizes });
  }
  return out;
}
const total = (items: CheckItem[]) => items.reduce((s, it) => s + Object.values(it.sizes).reduce((a, b) => a + b, 0), 0);

/** Monday of the week a day falls in */
export const weekOf = (d: string) => { const x = new Date(d + "T12:00"); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x.toISOString().slice(0, 10); };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const CLOSED = /job\s*completed|quote|cancel|closed/i;

/**
 * The jobs scheduled from `from` to `to` (inclusive), with their goods: what's expected, what the manifests say shipped
 * and arrived, and any check-ins. Also every job with an open check-in problem, whatever its date.
 */
export async function checkinJobs(admin: SupabaseClient, from: string, to: string): Promise<{ jobs: CheckJob[]; problems: CheckJob[] }> {
  const lo = addDays(from, -21), hi = addDays(to, 30);
  const [{ data: pv, error: e1 }, { data: os, error: e2 }, { data: open, error: e3 }] = await Promise.all([
    admin.from("archived_orders").select("id, visual_id, nickname, status_name, due_date, po_number, qty, data, customers(company, name)").gte("due_date", lo).lte("due_date", hi).limit(1500),
    admin.from("orders").select("id, number, nickname, status, due_date, production_date, po_number, qty, groups, lines, customers(company, name)").not("status", "in", "(completed,quote,quote_sent,request)").limit(800),
    admin.from("goods_checkins").select("order_id, archived_order_id").eq("status", "issue").is("resolved_at", null).limit(500),
  ]);
  if (e1) throw new Error(`Printavo jobs: ${e1.message}`);
  if (e2) throw new Error(`Orders: ${e2.message}`);
  const checkinsReady = !e3;
  const openPv = new Set(((open || []) as { archived_order_id: string | null }[]).map((x) => x.archived_order_id).filter(Boolean) as string[]);
  const openO = new Set(((open || []) as { order_id: string | null }[]).map((x) => x.order_id).filter(Boolean) as string[]);

  type PvRow = { id: string; visual_id: string | number; nickname: string; status_name: string; due_date: string | null; po_number: string; qty: number | null; data: { startAt?: string; totalQuantity?: number; groups?: { lines?: PvLine[] }[] } | null; customers: { company: string; name: string } | null };
  type ORow = { id: string; number: number; nickname: string; status: string; due_date: string | null; production_date: string | null; po_number: string; qty: number | null; groups: unknown; lines: unknown; customers: { company: string; name: string } | null };
  const inWeek = (d: string | null) => !!d && d >= from && d <= to;
  const pvJobs = ((pv || []) as unknown as PvRow[]).filter((a) => {
    const start = localDay(a.data?.startAt), day = start || ymd(a.due_date);
    return (openPv.has(a.id)) || (!CLOSED.test(a.status_name || "") && inWeek(day));
  });
  const oJobs = ((os || []) as unknown as ORow[]).filter((o) => openO.has(o.id) || inWeek(ymd(o.production_date) || ymd(o.due_date)));

  const pvIds = pvJobs.map((a) => a.id), oIds = oJobs.map((o) => o.id);
  const [{ data: ml }, { data: ck }] = await Promise.all([
    Promise.all([
      pvIds.length ? admin.from("supplier_manifest_lines").select("id, order_id, archived_order_id, supplier, style, mill, color, size, qty_shipped, box, tracking, track_status, delivered_at, kind").in("archived_order_id", pvIds).in("kind", ["goods", "blanks"]) : Promise.resolve({ data: [] }),
      oIds.length ? admin.from("supplier_manifest_lines").select("id, order_id, archived_order_id, supplier, style, mill, color, size, qty_shipped, box, tracking, track_status, delivered_at, kind").in("order_id", oIds).in("kind", ["goods", "blanks"]) : Promise.resolve({ data: [] }),
    ]).then(([a, b]) => ({ data: [...((a.data || []) as ML[]), ...((b.data || []) as ML[])] })),
    checkinsReady ? Promise.all([
      pvIds.length ? admin.from("goods_checkins").select("*").in("archived_order_id", pvIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      oIds.length ? admin.from("goods_checkins").select("*").in("order_id", oIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]).then(([a, b]) => ({ data: [...((a.data || []) as CheckinRow[]), ...((b.data || []) as CheckinRow[])] })) : Promise.resolve({ data: [] as CheckinRow[] }),
  ]);
  const lines = (ml || []) as ML[], cks = (ck || []) as CheckinRow[];

  const build = (ref: string, base: Omit<CheckJob, "ref" | "items" | "source" | "shipped" | "arrived" | "lines" | "delivered" | "boxes" | "suppliers" | "state" | "checkins" | "ordered">, ordered: number, own: CheckItem[], ls: ML[], cs: CheckinRow[]): CheckJob => {
    const items = ls.length ? itemsFromManifest(ls) : own;
    const shipped = ls.reduce((s, l) => s + (l.qty_shipped || 0), 0);
    const isIn = (l: ML) => !!l.delivered_at || l.track_status === "delivered";
    const arrived = ls.filter(isIn).reduce((s, l) => s + (l.qty_shipped || 0), 0);
    const delivered = ls.filter(isIn).length;
    const boxes = new Set(ls.map((l) => l.box || l.tracking).filter(Boolean)).size;
    const openIssue = cs.some((c) => c.status === "issue" && !c.resolved_at);
        // ready to count: every package delivered, and they hold at least what the job needs (60 of 60); delivered but
    // fewer than the job (more coming some other way) is only partly here
    const need = ordered || total(own);
    const state: JobState = openIssue ? "issue" : cs.length ? "checked" : !ls.length ? "none" : delivered === ls.length ? (!need || arrived >= need ? "ready" : "partial") : delivered ? "partial" : "way";
    return { ...base, ref, ordered: ordered || total(own), items, source: ls.length ? "manifest" : "order", shipped, arrived, lines: ls.length, delivered, boxes, suppliers: [...new Set(ls.map((l) => (l.supplier === "ss" ? "S&S" : l.supplier === "sanmar" ? "SanMar" : l.supplier)))], state, checkins: cs };
  };

  const jobs: CheckJob[] = [];
  for (const a of pvJobs) {
    const start = localDay(a.data?.startAt), due = ymd(a.due_date);
    jobs.push(build(PV + a.id, { number: +a.visual_id || 0, nickname: a.nickname || "", customer: a.customers?.company || a.customers?.name || "", po: a.po_number || "", status: a.status_name || "", start, due, day: start || due || "", href: `/shop/archive/${a.id}` },
      +(a.data?.totalQuantity || a.qty || 0), itemsFromPrintavo(a.data), lines.filter((l) => l.archived_order_id === a.id), cks.filter((c) => c.archived_order_id === a.id)));
  }
  for (const o of oJobs) {
    const start = ymd(o.production_date), due = ymd(o.due_date);
    jobs.push(build(o.id, { number: o.number, nickname: o.nickname || "", customer: o.customers?.company || o.customers?.name || "", po: o.po_number || "", status: o.status, start, due, day: start || due || "", href: `/shop/orders/${o.id}` },
      +(o.qty || 0), itemsFromOrder(o as unknown as Order), lines.filter((l) => l.order_id === o.id), cks.filter((c) => c.order_id === o.id)));
  }
  const inRange = jobs.filter((j) => j.day >= from && j.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);
  const problems = jobs.filter((j) => j.state === "issue").sort((a, b) => (a.day || "").localeCompare(b.day || ""));
  return { jobs: inRange, problems };
}

/** Save a count. Differences become an open problem; manifest lines on the job count as arrived. */
export async function saveCheckin(admin: SupabaseClient, by: string, b: { ref: string; lines: CheckLine[]; boxes?: number | null; note?: string; photos?: string[]; source?: string }) {
  const pv = b.ref.startsWith(PV), id = pv ? b.ref.slice(PV.length) : b.ref;
  const lines: CheckLine[] = (b.lines || []).map((l) => {
    const expected = Math.max(0, Math.round(+l.expected || 0)), received = Math.max(0, Math.round(+l.received || 0)), bad = Math.max(0, Math.round(+(l.bad || 0)));
    // the reason: what they picked, else the difference itself
    const issue: Issue = (["short", "over", "damaged", "mispick"] as Issue[]).includes(l.issue) ? l.issue : bad > 0 ? "damaged" : received < expected ? "short" : received > expected ? "over" : "";
    return { item: String(l.item || "").slice(0, 80), style: String(l.style || "").slice(0, 60), color: String(l.color || "").slice(0, 60), size: String(l.size || "").slice(0, 12), expected, received, issue: received === expected && !bad && issue !== "mispick" && issue !== "damaged" ? "" : issue, ...(bad ? { bad } : {}), ...(l.note ? { note: String(l.note).slice(0, 300) } : {}) };
  });
  const expected = lines.reduce((s, l) => s + l.expected, 0), received = lines.reduce((s, l) => s + l.received, 0);
  const status = lines.some((l) => l.issue) ? "issue" : "complete";
  const row = { order_id: pv ? null : id, archived_order_id: pv ? id : null, lines, expected, received, boxes: b.boxes ?? null, source: b.source || "", status, note: String(b.note || "").slice(0, 2000), photos: (b.photos || []).slice(0, 12), by };
  const ins = await admin.from("goods_checkins").insert(row).select("*").single();
  if (ins.error) throw new Error(ins.error.message);
  // the job's manifest packages count as here now (the local truck and freight never report delivery themselves)
  const now = new Date().toISOString();
  await admin.from("supplier_manifest_lines").update({ track_status: "delivered", delivered_at: now, track_detail: `Counted in by ${by}` }).eq(pv ? "archived_order_id" : "order_id", id).is("delivered_at", null);
  // an order here: its customer supplied goods status follows the count
  if (!pv) {
    const first = lines.find((l) => l.issue);
    const { data: g } = await admin.from("order_goods").select("order_id").eq("order_id", id).maybeSingle();
    if (g) await admin.from("order_goods").update({ status: status === "issue" ? "issue" : "received", issue_type: first?.issue === "mispick" ? "mispick" : first?.issue || "", issue_note: status === "issue" ? `Check-in: ${received} of ${expected}` : "", updated_by: by, updated_at: now }).eq("order_id", id);
  }
  return ins.data as CheckinRow;
}

export async function resolveCheckin(admin: SupabaseClient, by: string, id: string, resolution: string, reopen = false) {
  const r = await admin.from("goods_checkins").update(reopen ? { resolved_at: null, resolved_by: "", resolution: "" } : { resolved_at: new Date().toISOString(), resolved_by: by, resolution: resolution.slice(0, 1000) }).eq("id", id).select("*").single();
  if (r.error) throw new Error(r.error.message);
  return r.data as CheckinRow;
}
