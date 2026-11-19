"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickQuoteOptions } from "@/lib/quoteOptionsServer";

/** staff pick the options on a quote by hand (approving it for the customer): lib/quoteOptionsServer.ts */
export async function pickOptionsByHand(orderId: string, picks: Record<string, string>) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false as const, error: "Staff only." };
    const by = String((v.staff as { name?: string } | null)?.name || v.email || "shop");
    const r = await pickQuoteOptions(createAdminClient(), orderId, picks, by);
    return r.ok ? { ok: true as const, picked: r.picked, groups: r.groups } : r;
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
