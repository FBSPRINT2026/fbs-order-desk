"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin } from "@/lib/timeclockServer";
import { shopNetwork } from "@/lib/shopNetwork";

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

/** "This is the shop's network": saves the internet address this computer is on (the same list Shipping Center → Settings
 *  keeps), so shop computers and crew PINs work from here */
export async function saveThisNetwork(): Promise<{ ok: boolean; error?: string; ip?: string }> {
  const v = await getViewer().catch(() => null);
  if (!v?.user || v.role !== "owner") return { ok: false, error: "Only the owner can save the shop's network." };
  const admin = createAdminClient();
  const net = await shopNetwork(admin);
  if (!net.ip) return { ok: false, error: "Couldn't tell this computer's internet address." };
  if (net.on) return { ok: true, ip: net.ip };
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as Record<string, unknown>;
  const cur = (d.network || {}) as { ips?: string[]; names?: Record<string, string> };
  const r = await admin.from("settings").update({ data: { ...d, network: { ...cur, ips: [...(cur.ips || []), net.ip], names: { ...(cur.names || {}), [net.ip]: "Shop" } } } }).eq("id", 1);
  return r.error ? { ok: false, error: r.error.message } : { ok: true, ip: net.ip };
}
