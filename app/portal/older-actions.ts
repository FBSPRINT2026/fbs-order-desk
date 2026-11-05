"use server";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { oldOrderRows, oldOrdersRest } from "@/lib/portalArchive";

/** the rest of a long old-order history, fetched by the portal just after it's on screen (lib/portalArchive.ts) */
export async function portalOlderOrders(as: string) {
  const ctx = await getPortalCtx(as || undefined);
  if (!ctx.customerIds.length) return { orders: [], payments: [] };
  const admin = createAdminClient();
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const movedIds = new Set(ctx.customers.filter((c) => !!(c as { moved_at?: string | null }).moved_at).map((c) => c.id));
  const r = await oldOrderRows(admin, await oldOrdersRest(admin, ctx.customerIds), { href: (id) => `/portal/archive/${id}${qs}`, movedIds });
  return { orders: r.orders, payments: r.payments };
}
