"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { loadTokens, Qbo, QboError } from "@/lib/qbo/client";
import { qboEnv } from "@/lib/qbo/config";
import { loadQboSettings } from "@/lib/qbo/runner";
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
    if (!x) return { ok: true as const, synced: false, voided: false };
    const { data: o } = await x.admin.from("orders").select("id, number").eq("id", orderId).maybeSingle();
    if (!o) return { ok: true as const, synced: false, voided: false };
    const st = await x.p.orderState(o.id, +o.number, deep);
    return { ok: true as const, ...st };
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
