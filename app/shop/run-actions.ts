"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, type Order } from "@/lib/pricing";
import { runCtxFor, sharesPrint } from "@/lib/runTogether";

/**
 * Run together (lib/runTogether.ts): link an order with others of the same customer, keep every order in a run priced
 * with the others (run_ctx and the saved total), and undo it.
 */

const OPEN = ["request", "quote", "quote_sent", "pending", "approved", "art", "blanks", "production", "revision"];
type Row = Order & { run_id?: string | null };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return { v, admin: createAdminClient() };
}

/** the customer's other open orders to pick from: ones sharing a print first, then the rest */
export async function runOptions(orderId: string): Promise<{ ok: true; rows: { id: string; number: number; nickname: string; qty: number; status: string; shares: boolean; inRun: boolean }[] } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    const { data: me } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!me) throw new Error("Order not found.");
    if (!me.customer_id) return { ok: true, rows: [] };
    const { data: os } = await admin.from("orders").select("id, number, nickname, qty, status, groups, lines, run_id").eq("customer_id", me.customer_id).neq("id", orderId).is("discarded_at", null).in("status", OPEN).order("number", { ascending: false }).limit(60);
    const rows = ((os || []) as Row[]).map((x) => ({ id: x.id, number: x.number, nickname: x.nickname || "", qty: +x.qty || 0, status: String(x.status), shares: sharesPrint(me as Row, x), inRun: !!me.run_id && x.run_id === me.run_id }))
      .sort((a, b) => Number(b.inRun) - Number(a.inRun) || Number(b.shares) - Number(a.shares) || b.number - a.number);
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't load the orders." }; }
}

/** every order in a run priced with the others: its run_ctx and saved total (a run of one is undone) */
export async function syncRun(runId: string | null | undefined): Promise<void> {
  if (!runId) return;
  const admin = createAdminClient();
  const [{ data: os }, { data: st }] = await Promise.all([
    admin.from("orders").select("*").eq("run_id", runId),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const all = (os || []) as Row[];
  if (all.length < 2) {
    for (const o of all) { await admin.from("orders").update({ run_id: null, run_ctx: null, total: calcOrder({ ...o, run_ctx: null }, mergeSettings(st?.data)).total }).eq("id", o.id); }
    return;
  }
  const settings = mergeSettings(st?.data);
  for (const o of all) {
    const ctx = runCtxFor(o, all);
    const done = String(o.status) === "completed";
    await admin.from("orders").update({ run_ctx: ctx, ...(done ? {} : { total: calcOrder({ ...o, run_ctx: ctx }, settings).total }) }).eq("id", o.id);
  }
}

/** set which orders run with this one (empty: it runs on its own again) */
export async function setRun(orderId: string, mateIds: string[]): Promise<{ ok: true; runId: string | null } | { ok: false; error: string }> {
  try {
    const { v, admin } = await staff();
    const { data: me } = await admin.from("orders").select("id, number, customer_id, run_id").eq("id", orderId).maybeSingle();
    if (!me) throw new Error("Order not found.");
    const ids = [...new Set(mateIds.filter((x) => x && x !== orderId))];
    const { data: ms } = ids.length ? await admin.from("orders").select("id, number, customer_id, run_id").in("id", ids) : { data: [] };
    const mates = (ms || []) as { id: string; number: number; customer_id: string | null; run_id: string | null }[];
    if (mates.some((m) => m.customer_id !== me.customer_id)) throw new Error("Only orders of the same customer run together.");
    const old = new Set([me.run_id, ...mates.map((m) => m.run_id)].filter(Boolean) as string[]);
    const by = v.email.split("@")[0];
    if (!mates.length) {
      await admin.from("orders").update({ run_id: null, run_ctx: null }).eq("id", orderId);
      await admin.from("order_events").insert({ order_id: orderId, kind: "edited", detail: "Runs on its own again (taken out of Run together)", actor: v.email });
      for (const r of old) await syncRun(r);
      const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
      if (o && String(o.status) !== "completed") await admin.from("orders").update({ total: calcOrder({ ...(o as Row), run_ctx: null }, mergeSettings(st?.data)).total }).eq("id", orderId);
      return { ok: true, runId: null };
    }
    const runId = me.run_id || mates.find((m) => m.run_id)?.run_id || crypto.randomUUID();
    // this order's run is exactly it and the picked ones: anyone else who was in it goes back on their own
    if (me.run_id) await admin.from("orders").update({ run_id: null, run_ctx: null }).eq("run_id", me.run_id).not("id", "in", `(${[orderId, ...ids].join(",")})`);
    await admin.from("orders").update({ run_id: runId }).in("id", [orderId, ...ids]);
    const nums = [me.number, ...mates.map((m) => m.number)].sort((a, b) => a - b).map((n) => `#${n}`).join(" + ");
    await admin.from("order_events").insert([orderId, ...ids].map((id) => ({ order_id: id, kind: "edited", detail: `Run together: ${nums} (by ${by})`, actor: v.email })));
    for (const r of new Set([runId, ...old])) await syncRun(r);
    // anyone dropped from the old run: their own price again
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const { data: loose } = await admin.from("orders").select("*").is("run_id", null).not("run_ctx", "is", null);
    for (const o of (loose || []) as Row[]) await admin.from("orders").update({ run_ctx: null, ...(String(o.status) !== "completed" ? { total: calcOrder({ ...o, run_ctx: null }, mergeSettings(st?.data)).total } : {}) }).eq("id", o.id);
    return { ok: true, runId };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't link them." }; }
}

/** after an order in a run is saved: its run-mates priced again (their break counts its pieces) */
export async function runChanged(orderId: string): Promise<void> {
  try {
    const { admin } = await staff();
    const { data: o } = await admin.from("orders").select("run_id").eq("id", orderId).maybeSingle();
    await syncRun((o as { run_id?: string | null } | null)?.run_id);
  } catch { /* */ }
}
