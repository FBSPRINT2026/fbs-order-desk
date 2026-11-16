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

/**
 * Something that only lives at the shop asked from here (a print relay, the wall clock): this address is the shop's
 * network as it is now (Nick, Nov 16 2026: the crew's phones were turned away on the FBS Wi-Fi after the shop's internet
 * address changed). Kept a week; shopNetwork counts it like a saved address.
 */
export async function seenAtShop(admin: SupabaseClient, source: string) {
  const ip = await requestIp();
  if (!ip) return;
  await admin.from("shop_ips").upsert({ ip, source, last_seen: new Date().toISOString() }).then(() => null, () => null);
}

export async function shopNetwork(admin: SupabaseClient): Promise<{ ip: string; ips: string[]; names: Record<string, string>; configured: boolean; on: boolean }> {
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const [ip, { data }, { data: seen }] = await Promise.all([requestIp(), admin.from("settings").select("data").eq("id", 1).maybeSingle(), admin.from("shop_ips").select("ip").gte("last_seen", week)]);
  const net = ((data?.data as Record<string, unknown>)?.network || {}) as { ips?: string[]; names?: Record<string, string> };
  const saved = (net.ips || []).map((x) => String(x).trim()).filter(Boolean);
  const ips = [...new Set([...saved, ...((seen || []) as { ip: string }[]).map((x) => x.ip)])];
  // an IPv6 address matches on its first four groups (the network part); IPv4 exactly
  const same = (a: string, b: string) => (a.includes(":") && b.includes(":") ? a.split(":").slice(0, 4).join(":") === b.split(":").slice(0, 4).join(":") : a === b);
  return { ip, ips, names: net.names || {}, configured: saved.length > 0, on: !!ip && ips.some((x) => same(x, ip)) };
}
