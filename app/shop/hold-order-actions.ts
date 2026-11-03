"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Flag, FlagKey } from "@/lib/orderStages";
import type { HoldShow } from "@/lib/holds";

/** On hold from the order's status menu (lib/holds.ts): why, what's going on, and what the customer sees */
export async function putOnHold(orderId: string, key: FlagKey, note: string, show: HoldShow): Promise<{ ok: true; flags: Flag[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const { setHold } = await import("@/lib/holdServer");
    const r = await setHold(createAdminClient(), orderId, { key, note, show: ["message", "hold", "none"].includes(show) ? show : "message", by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") });
    return r.ok ? { ok: true, flags: r.flags } : r;
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Take it off hold (every hold, or one reason); anything now ready asks for its separations (lib/autoSeps.ts) */
export async function takeOffHold(orderId: string, only?: FlagKey): Promise<{ ok: true; flags: Flag[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient();
    const { clearHold } = await import("@/lib/holdServer");
    const r = await clearHold(admin, orderId, String((v.staff as { name?: string } | null)?.name || v.email || "shop"), only);
    if (!r.ok) return r;
    await (await import("@/lib/autoSeps")).autoSeparations(admin, orderId, "off hold");
    return { ok: true, flags: r.flags as Flag[] };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
