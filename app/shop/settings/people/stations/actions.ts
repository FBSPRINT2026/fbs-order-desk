"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin } from "@/lib/timeclockServer";

/** the shop computer PIN (lib/stations.ts), set by the owner; kept scrambled, never in the code */
export async function setStationPin(pin: string): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer().catch(() => null);
  if (!v?.user || v.role !== "owner") return { ok: false, error: "Only the owner can set the shop computer PIN." };
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "Use 4 to 8 numbers." };
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as Record<string, unknown>;
  const r = await admin.from("settings").update({ data: { ...d, stations: { ...((d.stations || {}) as object), pinHash: hashPin(pin), setAt: new Date().toISOString(), setBy: v.email, fails: 0, lockedUntil: null } } }).eq("id", 1);
  return r.error ? { ok: false, error: r.error.message } : { ok: true };
}
