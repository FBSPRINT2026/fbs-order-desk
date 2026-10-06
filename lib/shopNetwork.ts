import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is this request coming from the shop's network (the FBS Wi-Fi)? The shop's internet address (or addresses) is saved
 * in settings (Shipping Center → Settings → Shop network, "Use this network" while at the shop). Crew PIN sign-ins only
 * open the shop tools from there; nothing is enforced until an address is saved.
 */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for") || h.get("x-real-ip") || "").split(",")[0].trim();
}

export async function shopNetwork(admin: SupabaseClient): Promise<{ ip: string; ips: string[]; names: Record<string, string>; configured: boolean; on: boolean }> {
  const [ip, { data }] = await Promise.all([requestIp(), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
  const net = ((data?.data as Record<string, unknown>)?.network || {}) as { ips?: string[]; names?: Record<string, string> };
  const ips = (net.ips || []).map((x) => String(x).trim()).filter(Boolean);
  // an IPv6 address matches on its first four groups (the network part); IPv4 exactly
  const same = (a: string, b: string) => (a.includes(":") && b.includes(":") ? a.split(":").slice(0, 4).join(":") === b.split(":").slice(0, 4).join(":") : a === b);
  return { ip, ips, names: net.names || {}, configured: ips.length > 0, on: !!ip && ips.some((x) => same(x, ip)) };
}
