"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mockupStale } from "@/lib/mockupFresh";
import { orderGroups, type Order } from "@/lib/pricing";

/**
 * The groups whose saved mockup pictures are out of date, for the shop's quiet redraw (components/MockupFreshener.tsx).
 * Oct 29, Nick: "the little box is wrong again somewhere else… why is it wrong again on the invoice?": the pictures were
 * only drawn again when someone opened the order, so an invoice, the portal or a list printed the old one until then.
 * Same rule as the order page (lib/mockupFresh.ts mockupStale), for every open order.
 */
export async function staleMockupGroups(limit = 6) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: true as const, groups: [] };
    const admin = createAdminClient();
    const { data: os } = await admin.from("orders").select("id, status, groups").not("status", "in", "(request,completed,void)").is("discarded_at", null).eq("draft", false).order("updated_at", { ascending: false }).limit(600);
    const orders = (os || []) as unknown as Pick<Order, "id" | "status" | "groups" | "lines">[];
    const withPics = orders.map((o) => ({ o, gs: orderGroups(o as Order).filter((g) => (g.mockupThumbs || []).some(Boolean)) })).filter((x) => x.gs.length);
    const ids = [...new Set(withPics.flatMap((x) => x.gs.flatMap((g) => (g.imprints || []).map((im) => im.design_id).filter(Boolean) as string[])))];
    const designs: { id: string; preview_path: string | null; file_path: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 200) { const { data } = await admin.from("designs").select("id, preview_path, file_path").in("id", ids.slice(i, i + 200)); designs.push(...((data || []) as typeof designs)); }
    const out: { orderId: string; groupId: string; mockupKind?: "logo"; mockupAt: string }[] = [];
    for (const { o, gs } of withPics) for (const g of gs) if (mockupStale(g, designs)) out.push({ orderId: o.id, groupId: g.id, mockupKind: g.mockupKind, mockupAt: g.mockupAt || "" });
    return { ok: true as const, groups: out.slice(0, limit), more: Math.max(0, out.length - limit) };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong.", groups: [] }; }
}
