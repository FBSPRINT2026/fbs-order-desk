import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCustomerOrders, listCustomers, listOrders, PrintavoError, PrintavoThrottled } from "@/lib/printavo";
import { copyFiles, importCustomer, importOrder } from "@/lib/printavoImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Printavo sync, run every minute by the database's schedule (see migration 029). READ-ONLY toward Printavo.
 *   job=api      talks to Printavo (about 2 requests a second, Printavo's limit):
 *                1. lists every order once, 2. imports what's new or changed (newest first),
 *                   (the full pass goes customer by customer: Printavo's all-orders list stops after 10,000 orders)
 *                3. every 5 minutes checks the active jobs (the ~500 orders with the latest due dates) for changes, and
 *                   keeps walking Printavo's whole order list the same way (a full pass about every half hour): each order's
 *                   fingerprint (changed time, total, balance, status, due date, customer) is compared, so edits, payments,
 *                   status changes and new orders come over,
 *                4. re-reads recent orders in full once a day (catches new messages/files), 5. picks up new customers daily.
 *   job=files-N  copies artwork into our storage (doesn't use Printavo's request limit).
 */
const RUN_MS = 47000;
const QUICK_EVERY = 10 * 60000, QUICK_PAGES = 20; // active jobs: 20 pages x 25 = the 500 orders with the latest due dates
// only orders created in the last 30 days are imported / refreshed (older ones stay as they are); keeps the load light
const RECENT_DAYS = 30;
const recentSince = () => new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
// after hours (7 PM – 6 AM shop time): older orders we never got (the rest of 2023) are brought over, once each
const afterHours = () => { const h = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()); return h >= 19 || h < 6; };
type Sync = { enabled: boolean; token: string; pause_until: string | null; quick_cursor: string | null; quick_pages: number; quick_done_at: string | null; sweep_cursor: string | null; sweep_no: number; sweep_started_at: string | null; sweep_done_at: string | null; customers_cursor: string | null; customers_done_at: string | null };
type Idx = { printavo_id: string; fingerprint: string; status: string; imported_fingerprint: string | null; archived_id: string | null };

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("enabled, token, pause_until, quick_cursor, quick_pages, quick_done_at, sweep_cursor, sweep_no, sweep_started_at, sweep_done_at, customers_cursor, customers_done_at").eq("id", 1).single();
  const sync = s as Sync | null;
  if (!sync || req.headers.get("x-sync-token") !== sync.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  if (!sync.enabled) return NextResponse.json({ off: true });
  const job = new URL(req.url).searchParams.get("job") || "api";
  // Printavo asked us to slow down recently: the part that talks to Printavo waits (copying files doesn't use Printavo's limit)
  if (job === "api" && sync.pause_until && new Date(sync.pause_until).getTime() > Date.now()) return NextResponse.json({ pausedUntil: sync.pause_until });
  if (!/^(api|files-\d)$/.test(job)) return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  const { data: got } = await admin.rpc("printavo_sync_claim", { p_job: job, p_seconds: 58 });
  if (!got) return NextResponse.json({ busy: true });
  const deadline = Date.now() + RUN_MS;
  let out: Record<string, unknown> = {};
  try {
    out = job === "api" ? await apiJob(admin, sync, deadline) : await filesJob(admin, deadline);
    await admin.from("printavo_sync").update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", 1);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const pause = e instanceof PrintavoThrottled ? { pause_until: new Date(Date.now() + 5 * 60000).toISOString() } : {};
    await admin.from("printavo_sync").update({ last_error: `${job}: ${msg}`, last_error_at: new Date().toISOString(), last_run_at: new Date().toISOString(), ...pause }).eq("id", 1);
    out = { error: msg };
  } finally {
    await admin.rpc("printavo_sync_release", { p_job: job });
  }
  return NextResponse.json({ job, ...out });
}

/* ---------- talking to Printavo ---------- */

async function apiJob(admin: SupabaseClient, sync: Sync, deadline: number) {
  const did = { listed: 0, imported: 0, changed: 0, customers: 0, deep: 0 };
  let turn = 0;
  while (Date.now() < deadline - 3000) {
    turn++;
    // 1. the first pass lists every order before anything else (so we know the whole job and can go newest first)
    if (sync.sweep_no === 0) { await sweepPage(admin, sync, did); continue; }

    // every 10 minutes: the active jobs (the ~500 orders with the latest due dates) are checked for changes first
    const quickDue = !!sync.quick_cursor || !sync.quick_done_at || Date.now() - new Date(sync.quick_done_at).getTime() > QUICK_EVERY;
    if (quickDue) { await quickPage(admin, sync, did); continue; }

    let { data: next } = await admin.from("printavo_index").select("printavo_id, attempts").eq("status", "pending").gte("created_at", recentSince()).order("created_at", { ascending: false, nullsFirst: false }).limit(1);
    if (!next?.length && afterHours()) ({ data: next } = await admin.from("printavo_index").select("printavo_id, attempts").eq("status", "pending").is("archived_id", null).order("created_at", { ascending: false, nullsFirst: false }).limit(1));
    const pending = next?.[0] as { printavo_id: string; attempts: number } | undefined;

    // 2. keep noticing changes even during the big import: every 6th turn reads one page of the order list
    // the full pass over every order: during the import it keeps going alongside; once caught up, a new pass starts 6 hours
    // after the last (each pass touches every order we have: ~23,000 row updates; the quick check above covers active jobs)
    // (off for now: the quick check of active jobs finds new orders; the full pass re-read every order)
    const sweepDue = false as boolean;
    // a pass that's under way gets most turns (it only reads lists, and it's how new orders are found); otherwise every 6th
    if (sweepDue && (!pending || (sync.sweep_cursor ? turn % 3 !== 0 : turn % 6 === 1))) { await sweepPage(admin, sync, did); continue; }

    // a big order can take 15+ seconds to read at our pace: don't start one near the end of the run
    if (pending) { if (Date.now() > deadline - 17000) break; await importOne(admin, pending.printavo_id, pending.attempts, did); continue; }

    // 3. nothing waiting: a full re-read of a recent order (new messages, files, approvals), once a day each
    const since = recentSince(), stale = new Date(Date.now() - 86400000).toISOString();
    const { data: deep } = await admin.from("printavo_index").select("printavo_id").eq("status", "done").gte("created_at", since).or(`deep_at.is.null,deep_at.lt.${stale}`).order("created_at", { ascending: false }).limit(1);
    if (deep?.[0]) { if (Date.now() > deadline - 17000) break; await importOne(admin, deep[0].printavo_id, 0, did, true); continue; }

    // 4. once a day: customers who have no orders yet (new ones in Printavo)
    if (!sync.customers_done_at || Date.now() - new Date(sync.customers_done_at).getTime() > 86400000 || sync.customers_cursor) { await customersPage(admin, sync, did, deadline); continue; }
    break; // all caught up
  }
  return did;
}

/** Compares a page of Printavo's order list with what we have: new orders are queued, changed ones are queued again. */
async function comparePage(admin: SupabaseClient, orders: Awaited<ReturnType<typeof listOrders>>["orders"], did: Record<string, number>, pass: number | null, currentPass = 0) {
  if (!orders.length) return;
  const ids = orders.map((o) => o.id);
  const { data: have } = await admin.from("printavo_index").select("printavo_id, fingerprint, status, imported_fingerprint, archived_id").in("printavo_id", ids);
  const known = new Map(((have || []) as Idx[]).map((r) => [r.printavo_id, r]));
  // orders made here and sent into Printavo (the 40,000 series) are ours already: never imported back as a second copy,
  // nor anything numbered 40,000 or up in Printavo
  const { data: linked } = await admin.from("orders").select("printavo_id").in("printavo_id", ids);
  const ours = new Set((linked || []).map((r) => String(r.printavo_id)));
  // a 40,000+ number in Printavo that we didn't send means Printavo's own counter reached our range: not imported,
  // but listed as a problem on the import page so it isn't missed
  const strays = orders.filter((o) => !ours.has(o.id) && +o.visualId >= 40000 && !known.has(o.id));
  if (strays.length) await admin.from("printavo_index").upsert(strays.map((o) => ({ printavo_id: o.id, visual_id: o.visualId, kind: o.kind, customer_pid: o.customerId, created_at: o.createdAt || null, fingerprint: o.fingerprint, status: "error", error: `Printavo #${o.visualId} is in the 40,000 range but wasn't sent from the new system, so it wasn't imported. Printavo's numbering may have jumped: check its next order number.`, seen_sweep: pass || currentPass })), { onConflict: "printavo_id" });
  const back: string[] = [];
  const rows = orders.flatMap((o) => {
    if (ours.has(o.id) || +o.visualId >= 40000) return [];
    const k = known.get(o.id);
    const row = { printavo_id: o.id, visual_id: o.visualId, kind: o.kind, customer_pid: o.customerId, created_at: o.createdAt || null, fingerprint: o.fingerprint, status: "pending", seen_sweep: pass || currentPass }; // (every row sends the same columns; an order seen by the quick check counts as seen)
    // older than 30 days: left as it is
    if (o.createdAt && o.createdAt < recentSince()) return [];
    if (!k) return [row];
    // back after being marked removed, and nothing changed since we imported it: no need to read it all again
    if (k.status === "gone" && k.archived_id && k.imported_fingerprint === o.fingerprint) { back.push(o.id); return []; }
    if (k.fingerprint !== o.fingerprint || k.status === "gone") { did.changed++; return [row]; }
    return [];
  });
  if (back.length) await admin.from("printavo_index").update({ status: "files", seen_sweep: pass || currentPass }).in("printavo_id", back); // the file copier finishes it (right away if nothing is missing);
  if (rows.length) { const { error } = await admin.from("printavo_index").upsert(rows, { onConflict: "printavo_id" }); if (error) throw new Error(error.message); }
  if (pass) {
    const unchanged = ids.filter((id) => !rows.some((r) => r.printavo_id === id));
    if (unchanged.length) await admin.from("printavo_index").update({ seen_sweep: pass }).in("printavo_id", unchanged);
  }
  did.listed += orders.length;
}

/** One page of the active jobs (latest due dates first). */
async function quickPage(admin: SupabaseClient, sync: Sync, did: Record<string, number>) {
  const page = await listOrders(sync.quick_cursor, true);
  await comparePage(admin, page.orders, did, null, sync.sweep_no + 1);
  sync.quick_pages = (sync.quick_cursor ? sync.quick_pages : 0) + 1;
  if (!page.next || sync.quick_pages >= QUICK_PAGES) {
    sync.quick_cursor = null; sync.quick_done_at = new Date().toISOString();
    await admin.from("printavo_sync").update({ quick_cursor: null, quick_pages: 0, quick_done_at: sync.quick_done_at }).eq("id", 1);
  } else {
    sync.quick_cursor = page.next;
    await admin.from("printavo_sync").update({ quick_cursor: page.next, quick_pages: sync.quick_pages }).eq("id", 1);
  }
}

/**
 * One page of the full pass. Printavo's all-orders list stops after 10,000 orders, so the pass walks every customer
 * and reads each one's orders (25 a page). Cursor: "c:<customer id>|<page cursor>".
 * New orders are queued; changed ones (different fingerprint) are queued again. When a customer is finished, their
 * orders we didn't see this pass were removed in Printavo (we keep our copy, just mark it).
 */
async function sweepPage(admin: SupabaseClient, sync: Sync, did: Record<string, number>) {
  const pass = sync.sweep_no + 1;
  if (!sync.sweep_cursor && !sync.sweep_started_at) {
    sync.sweep_started_at = new Date().toISOString();
    await admin.from("printavo_sync").update({ sweep_started_at: sync.sweep_started_at }).eq("id", 1);
  }
  const m = /^c:([^|]*)\|(.*)$/.exec(sync.sweep_cursor || "");
  let cust = m ? m[1] : "", after: string | null = m && m[2] ? m[2] : null;
  if (!cust) {
    const { data } = await admin.from("printavo_customers").select("printavo_id").order("printavo_id").limit(1);
    cust = (data?.[0] as { printavo_id: string } | undefined)?.printavo_id || "";
    if (!cust) return finishPass(admin, sync, pass);
  }
  const page = await listCustomerOrders(cust, after);
  if (page) await comparePage(admin, page.orders, did, pass);
  let next: string | null = null;
  if (page?.next) next = `c:${cust}|${page.next}`;
  else {
    // this customer is done
    if (page) await admin.from("printavo_index").update({ status: "gone" }).eq("customer_pid", cust).lt("seen_sweep", pass).neq("status", "gone");
    const { data } = await admin.from("printavo_customers").select("printavo_id").gt("printavo_id", cust).order("printavo_id").limit(1);
    const nc = (data?.[0] as { printavo_id: string } | undefined)?.printavo_id;
    if (nc) next = `c:${nc}|`;
  }
  if (!next) return finishPass(admin, sync, pass);
  sync.sweep_cursor = next;
  await admin.from("printavo_sync").update({ sweep_cursor: next }).eq("id", 1);
}
async function finishPass(admin: SupabaseClient, sync: Sync, pass: number) {
  sync.sweep_cursor = null; sync.sweep_no = pass; sync.sweep_started_at = null; sync.sweep_done_at = new Date().toISOString();
  await admin.from("printavo_sync").update({ sweep_cursor: null, sweep_no: pass, sweep_started_at: null, sweep_done_at: sync.sweep_done_at }).eq("id", 1);
}

/** Imports (or refreshes) one order with everything on it. */
async function importOne(admin: SupabaseClient, printavoId: string, attempts: number, did: Record<string, number>, deep = false) {
  const { data: cur } = await admin.from("printavo_index").select("fingerprint").eq("printavo_id", printavoId).single();
  try {
    const r = await importOrder(admin, printavoId);
    const now = new Date().toISOString();
    await admin.from("printavo_index").update({ status: r.filesLeft ? "files" : "done", archived_id: r.id, imported_fingerprint: cur?.fingerprint || null, imported_at: now, deep_at: now, attempts: 0, error: r.warnings.length ? r.warnings.join("; ").slice(0, 500) : null }).eq("printavo_id", printavoId);
    if (deep) did.deep++; else did.imported++;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const gone = e instanceof PrintavoError && /not found/i.test(msg);
    if (e instanceof PrintavoThrottled) throw e; // not the order's fault: leave it as it was
    await admin.from("printavo_index").update({ status: gone ? "gone" : attempts + 1 >= 3 ? "error" : "pending", attempts: attempts + 1, error: msg, deep_at: new Date().toISOString() }).eq("printavo_id", printavoId);
    if (e instanceof PrintavoThrottled || /Printavo answered HTTP 401|403|isn't connected/i.test(msg)) throw e; // slow down / bad credentials: stop this run
  }
}

/** One page of Printavo's customer list: customers we don't have yet are imported (orders come with the order list). */
async function customersPage(admin: SupabaseClient, sync: Sync, did: Record<string, number>, deadline: number) {
  const page = await listCustomers(sync.customers_cursor);
  if (page.customers.length) {
    const { data: have } = await admin.from("printavo_customers").select("printavo_id").in("printavo_id", page.customers.map((c) => c.id));
    const known = new Set(((have || []) as { printavo_id: string }[]).map((x) => x.printavo_id));
    for (const c of page.customers) {
      if (known.has(c.id)) continue;
      if (Date.now() > deadline) return; // finish this page next run
      try { await importCustomer(admin, c.id); did.customers++; } catch (e) { if (e instanceof PrintavoThrottled) throw e; /* otherwise next time */ }
    }
  }
  sync.customers_cursor = page.next;
  const patch = page.next ? { customers_cursor: page.next } : { customers_cursor: null, customers_done_at: new Date().toISOString() };
  if (!page.next) sync.customers_done_at = patch.customers_done_at as string;
  await admin.from("printavo_sync").update(patch).eq("id", 1);
}

/* ---------- copying files (no Printavo requests) ---------- */

async function filesJob(admin: SupabaseClient, deadline: number) {
  let orders = 0, copied = 0;
  while (Date.now() < deadline - 12000) {
    const { data: rows } = await admin.from("printavo_index").select("printavo_id, archived_id").eq("status", "files").not("archived_id", "is", null).order("created_at", { ascending: false }).limit(12);
    let worked = false;
    for (const r of (rows || []) as { printavo_id: string; archived_id: string }[]) {
      if (Date.now() > deadline - 12000) break;
      const { data: mine } = await admin.rpc("printavo_sync_claim", { p_job: "file:" + r.archived_id, p_seconds: 55 });
      if (!mine) continue; // the other file job has it
      worked = true;
      try {
        // no new download starts in the last ~20 seconds (a big mockup can take a while)
        const res = await copyFiles(admin, r.archived_id, deadline - 17000, deadline + 6000);
        copied += res.copied; orders++;
        if (res.storageFull) throw new Error("Storage is full: " + res.failed.join("; "));
        if (!res.left) await admin.from("printavo_index").update({ status: "done" }).eq("printavo_id", r.printavo_id);
      } finally { await admin.rpc("printavo_sync_release", { p_job: "file:" + r.archived_id }); }
    }
    if (!worked) break;
  }
  return { orders, copied };
}
