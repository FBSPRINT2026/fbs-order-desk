import { createAdminClient } from "@/lib/supabase/admin";
import { parseUsers, zkCommandResults, zkDevice, zkKeep, zkNextCommands, zkOptions, zkProcess, zkSeen } from "@/lib/zkteco";

/**
 * The ZKTeco wall clock talks to us here (its Cloud Server Setting points at portal.fbsprint.com, port 443, HTTPS on).
 *   GET  /iclock/cdata?SN=…&options=all   it checks in; we send its settings
 *   POST /iclock/cdata?SN=…&table=ATTLOG  face scans, one per line
 *   POST /iclock/cdata?SN=…&table=OPERLOG who's enrolled, changes made at the clock
 *   GET  /iclock/getrequest?SN=…          anything for it to do (add our employees)
 *   POST /iclock/devicecmd?SN=…           how those went
 * Plain text in and out. No staff login: the clock is known by its serial number and does nothing until an owner or
 * admin turns it on (lib/zkteco.ts).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (s: string, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const what = (path || []).join("/").toLowerCase().replace(/\.aspx$/, "");
  const url = new URL(req.url);
  const sn = url.searchParams.get("SN") || url.searchParams.get("sn") || "";
  if (what === "ping") return text("OK");
  const admin = createAdminClient();
  const d = await zkDevice(admin, sn);
  if (!d) return text("Unknown device", 400);
  const body = req.method === "POST" ? await req.text().catch(() => "") : "";
  const lines = body.split(/\r?\n/);

  // newer firmware registers first
  if (what === "registry") { await zkSeen(admin, d, { registry: body.slice(0, 2000) }); return text(`RegistryCode=${d.id.replace(/-/g, "").slice(0, 10)}`); }
  if (what === "push") { await zkSeen(admin, d); return text(zkOptions(d)); }

  if (what === "cdata") {
    if (req.method === "GET") {
      await zkSeen(admin, d, { pushver: url.searchParams.get("pushver") || "", language: url.searchParams.get("language") || "", hello: new Date().toISOString() });
      return text(zkOptions(d));
    }
    const table = (url.searchParams.get("table") || "").toUpperCase();
    const stamp = url.searchParams.get("Stamp") || url.searchParams.get("OpStamp") || "";
    if (table === "ATTLOG") {
      const n = await zkKeep(admin, d, "att", lines);
      await admin.from("timeclock_devices").update({ att_stamp: stamp || d.att_stamp, last_seen_at: new Date().toISOString() }).eq("id", d.id);
      if (d.active) await zkProcess(admin, d.id).catch(() => null);
      return text(`OK: ${n}`);
    }
    if (table === "OPERLOG" || table === "USERINFO" || table === "USER") {
      const users = parseUsers(lines);
      const n = await zkKeep(admin, d, Object.keys(users).length ? "user" : "op", lines);
      const info = Object.keys(users).length ? { users: { ...((d.info?.users as Record<string, string>) || {}), ...users }, usersAt: new Date().toISOString() } : undefined;
      await zkSeen(admin, d, info);
      if (table === "OPERLOG" && stamp) await admin.from("timeclock_devices").update({ op_stamp: stamp }).eq("id", d.id);
      return text(`OK: ${n}`);
    }
    if (table === "OPTIONS") {
      const opts = Object.fromEntries(body.split(/[,\n]/).map((kv) => kv.replace(/^~/, "").split("=")).filter((x) => x.length === 2 && x[0].length < 40).map(([k, v]) => [k.trim(), v.trim().slice(0, 120)]));
      await zkSeen(admin, d, { options: opts });
      return text("OK");
    }
    // photos and anything else: thanks, not kept
    await zkSeen(admin, d);
    return text("OK");
  }
  if (what === "getrequest") {
    const inf = url.searchParams.get("INFO");
    await zkSeen(admin, d, inf ? { about: inf.slice(0, 300) } : undefined);
    return text(d.active ? await zkNextCommands(admin, d.id) : "OK");
  }
  if (what === "devicecmd") { await zkCommandResults(admin, d.id, body); await zkSeen(admin, d); return text("OK"); }
  await zkSeen(admin, d);
  return text("OK");
}

export const GET = handle;
export const POST = handle;
