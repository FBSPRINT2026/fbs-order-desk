"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";

/**
 * Account owners at a glance (Oct 26, Nick: "a quick update of who owns each account… take the top 30 accounts… I'll
 * put the account owner on there"). The biggest customers of the last 12 months with their owner (customer_private),
 * and who Printavo had on their latest order as a hint. Owners and admins only; one click saves.
 */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  if (!["owner", "admin"].includes(v.role)) throw new Error("Only an owner or admin can set account owners.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export type OwnerRow = { id: string; name: string; sales: number; orders: number; owner: string; printavo: string };

export async function ownerList(limit: number) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10), from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const { data: top, error } = await v.supabase.rpc("shop_top_customers", { p_from: from, p_to: to, p_limit: Math.max(1, Math.min(500, limit)) });
    if (error) throw new Error(error.message);
    const rows = ((top || []) as { customer_id: string; name: string; sales: number; orders: number }[]).filter((r) => r.customer_id);
    const ids = rows.map((r) => r.customer_id);
    const [{ data: pr }, { data: st }] = await Promise.all([
      admin.from("customer_private").select("customer_id, account_owner").in("customer_id", ids),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const own = new Map(((pr || []) as { customer_id: string; account_owner: string | null }[]).map((p) => [p.customer_id, p.account_owner || ""]));
    // who Printavo had on each customer's latest order (a hint, never saved on its own)
    const pv = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data: ao } = await allRows((r0, r1) => admin.from("archived_orders").select("customer_id, order_date, owner:data->>owner").in("customer_id", ids.slice(i, i + 100)).not("order_date", "is", null).order("order_date", { ascending: false }).order("id").range(r0, r1), 5000);
      for (const a of (ao || []) as { customer_id: string; owner: string | null }[]) if (a.owner && !pv.has(a.customer_id)) pv.set(a.customer_id, a.owner);
    }
    const owners = (((st?.data as { accountOwners?: { name: string }[] } | null)?.accountOwners) || []).map((o) => o.name).filter(Boolean);
    return { ok: true as const, owners, rows: rows.map((r): OwnerRow => ({ id: r.customer_id, name: r.name, sales: +r.sales || 0, orders: +r.orders || 0, owner: own.get(r.customer_id) || "", printavo: pv.get(r.customer_id) || "" })) };
  } catch (e) { return fail(e); }
}

/** set (or clear) the owners of one or more customers */
export async function setOwners(items: { id: string; owner: string }[]) {
  try {
    await me();
    const admin = createAdminClient();
    const ok = items.filter((x) => /^[0-9a-f-]{36}$/i.test(x.id)).slice(0, 500);
    const { data: have } = await admin.from("customer_private").select("customer_id").in("customer_id", ok.map((x) => x.id));
    const has = new Set(((have || []) as { customer_id: string }[]).map((h) => h.customer_id));
    for (const x of ok) {
      const owner = String(x.owner || "").trim().slice(0, 60);
      const { error } = has.has(x.id)
        ? await admin.from("customer_private").update({ account_owner: owner, updated_at: new Date().toISOString() }).eq("customer_id", x.id)
        : await admin.from("customer_private").insert({ customer_id: x.id, account_owner: owner });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, saved: ok.length };
  } catch (e) { return fail(e); }
}
