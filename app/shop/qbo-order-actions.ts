"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { loadTokens, Qbo, QboError } from "@/lib/qbo/client";
import { qboEnv } from "@/lib/qbo/config";
import { claimLock, loadQboSettings, releaseLock, runQueue } from "@/lib/qbo/runner";
import { explainQboError, Pusher } from "@/lib/qbo/push";

/**
 * An order and QuickBooks (Oct 24, Nick): the order page's small "QB ✓" (is it in QuickBooks?), and deleting an order
 * that is: "this order has already been synced… would you like me to void the order in QuickBooks?" Voiding happens
 * right away (it's the person's own yes), even while the automatic sync is off. Nothing is ever deleted in QuickBooks.
 */
async function pusher(needConnection: boolean) {
  const admin = createAdminClient();
  const env = qboEnv();
  const tokens = env.configured ? await loadTokens(admin) : null;
  if (!tokens) { if (needConnection) throw new Error("QuickBooks isn't connected (Settings → QuickBooks)."); return null; }
  if (tokens.env && env.env && tokens.env !== env.env) { if (needConnection) throw new Error("QuickBooks needs to be connected again (Settings → QuickBooks)."); return null; }
  const qs = await loadQboSettings(admin);
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const qbo = new Qbo(admin);
  // the company from the saved sign-in (no call to Intuit just to show the order's QB check)
  const realm = tokens.realm_id || (await qbo.realm());
  return { admin, p: new Pusher(admin, qs, mergeSettings(st?.data), qbo, realm, true, true) };
}

/** Is this order's invoice in QuickBooks? `deep` also asks QuickBooks (used before deleting). */
export async function qboOrderState(orderId: string, deep = false) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can see this.");
    const x = await pusher(false);
    if (!x) return { ok: true as const, synced: false, voided: false, issue: "" };
    const { data: o } = await x.admin.from("orders").select("id, number, updated_at").eq("id", orderId).maybeSingle();
    if (!o) return { ok: true as const, synced: false, voided: false, issue: "" };
    const [st, { data: q }] = await Promise.all([
      x.p.orderState(o.id, +o.number, deep),
      // a problem syncing it (the order's red QB): its latest queue row needs a look, or keeps failing
      x.admin.from("qbo_queue").select("status, reason, attempts").eq("entity", "invoice").eq("local_id", o.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const row = q as { status: string; reason: string; attempts: number } | null;
    const issue = row && (row.status === "needs_review" || (row.status === "error" && row.attempts >= 3)) ? row.reason || "It didn't sync." : "";
    // changed since it went to QuickBooks (Oct 24, Nick: "once we make a change… turn it yellow… until it syncs back again
    // and goes green"): its newest change is still waiting in the queue
    let pending = !issue && !!row && (row.status === "pending" || row.status === "running" || row.status === "error");
    // a test invoice never goes through the sync: it's out of date when the order changed after it was last sent
    if (st.synced && st.source === "test") {
      const { data: l } = await x.admin.from("qbo_links").select("last_pushed_at, last_seen_at, created_at").eq("entity", "invoice").eq("local_id", o.id).eq("is_primary", true).maybeSingle();
      const sent = String(l?.last_pushed_at || l?.last_seen_at || l?.created_at || "");
      pending = !!o.updated_at && !!sent && Date.parse(String(o.updated_at)) > Date.parse(sent) + 5000;
    }
    return { ok: true as const, ...st, issue, pending };
  } catch (e) {
    return { ok: false as const, error: e instanceof QboError ? explainQboError(e) : e instanceof Error ? e.message : String(e) };
  }
}

/** Void the order's invoice in QuickBooks (owners and admins), before the order is deleted. */
export async function voidOrderInQbo(orderId: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff || !["owner", "admin"].includes(v.role)) throw new Error("Only an owner or admin can void an invoice in QuickBooks.");
    const x = await pusher(true);
    const { data: o } = await x!.admin.from("orders").select("id, number").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    const r = await x!.p.voidOrder(o.id, +o.number);
    await x!.admin.from("order_events").insert({ order_id: o.id, kind: "qbo_void", detail: r.reason.slice(0, 300), actor: v.email });
    return { ok: r.status === "done" || r.status === "skipped", status: r.status, message: r.reason };
  } catch (e) {
    return { ok: false as const, status: "error", message: e instanceof QboError ? explainQboError(e) : e instanceof Error ? e.message : String(e) };
  }
}

/**
 * QuickBooks sync problems for the menu's QB tool (Oct 24, Nick: "you're going to have issues where an invoice won't
 * sync. And it'll notify me… it makes a list and say, well, why did it error?"): what needs a look (needs review), and
 * anything that has failed 3 times or more. Owner only.
 */
export async function qboProblemCount() {
  try {
    const v = await getViewer();
    if (!v.user || v.role !== "owner") return { ok: true as const, n: 0 };
    const admin = createAdminClient();
    const [a, b] = await Promise.all([
      admin.from("qbo_queue").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
      admin.from("qbo_queue").select("id", { count: "exact", head: true }).eq("status", "error").gte("attempts", 3),
    ]);
    return { ok: true as const, n: (a.count || 0) + (b.count || 0) };
  } catch { return { ok: true as const, n: 0 }; }
}

/**
 * Sync this one order now (Oct 24, Nick: "when I right click on the sync symbol on an order… sync now… if you make a
 * change, it immediately syncs back to QuickBooks… There's a way to do that in Printavo too"). Queues the order's
 * invoice (and its customer) and runs just those rows, the same way the every-minute sync would: sent when the sync is
 * on and live, previewed when it's off. Owners and admins.
 */
export async function qboSyncOrder(orderId: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff || !["owner", "admin"].includes(v.role)) throw new Error("Only an owner or admin can sync to QuickBooks.");
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, type, customer_id").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    if (o.type !== "invoice") return { ok: false as const, message: "It's a quote: quotes don't go to QuickBooks. Make it an invoice first." };
    // a test company's order: Sync now updates its TEST invoice (the sync never sends test companies)
    const { data: cu } = o.customer_id ? await admin.from("customers").select("is_test").eq("id", o.customer_id).maybeSingle() : { data: null };
    if (cu?.is_test) {
      const x = await pusher(true);
      const r = await x!.p.testInvoice(o.id);
      return { ok: r.status === "done", message: r.reason.slice(0, 400) };
    }
    const qs = await loadQboSettings(admin);
    if (+o.number < qs.adopt_from_number) return { ok: false as const, message: `#${o.number} is from before the portal; Printavo keeps it in QuickBooks.` };
    if (o.customer_id) await admin.rpc("qbo_enqueue", { p_entity: "customer", p_local_id: o.customer_id, p_op: "upsert", p_reason: "sync now" });
    await admin.rpc("qbo_enqueue", { p_entity: "invoice", p_local_id: o.id, p_op: "upsert", p_reason: "sync now" });
    const { data: rows } = await admin.from("qbo_queue").select("id").in("status", ["pending", "error", "needs_review"]).or(`and(entity.eq.invoice,local_id.eq.${o.id})${o.customer_id ? `,and(entity.eq.customer,local_id.eq.${o.customer_id})` : ""}`);
    const ids = (rows || []).map((r) => r.id as number);
    if (!ids.length) return { ok: true as const, message: "Nothing waiting to sync." };
    const lockId = await claimLock(admin);
    if (!lockId) return { ok: false as const, message: "A sync is running right now. Try again in a minute." };
    try { await runQueue(admin, { mode: qs.enabled ? "auto" : "preview", deadline: Date.now() + 100000, lockId, ids }); }
    finally { await releaseLock(admin, lockId); }
    const { data: q } = await admin.from("qbo_queue").select("status, reason").eq("entity", "invoice").eq("local_id", o.id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const st = String(q?.status || ""), why = String(q?.reason || "");
    const live = qs.enabled && qs.mode === "live";
    const message = st === "done" ? `Synced to QuickBooks. ${why}`.trim() : st === "skipped" ? `Not sent: ${why}` : st === "needs_review" ? `Didn't sync: ${why}` : !live ? `The QuickBooks sync is ${qs.enabled ? "in preview" : "off"}, so nothing was sent. ${why}`.trim() : `Will try again: ${why}`;
    return { ok: st === "done" || st === "skipped" || !live, message: message.slice(0, 400) };
  } catch (e) {
    return { ok: false as const, message: e instanceof QboError ? explainQboError(e) : e instanceof Error ? e.message : String(e) };
  }
}
