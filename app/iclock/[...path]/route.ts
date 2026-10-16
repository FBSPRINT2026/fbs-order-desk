import { createAdminClient } from "@/lib/supabase/admin";
import { isAcc, parseAccUsers, parseAtt, parseUsers, redact, zkAccOptions, zkCommandResults, zkDevice, zkKeep, zkNextCommands, zkOptions, zkProcess, zkSeen } from "@/lib/zkteco";

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
  // one line per call while we get the clock connected (Vercel logs: search "iclock")
  const tbl = (url.searchParams.get("table") || "").toUpperCase();
  if (what === "ping") return text("OK");
  // the SpeedFace (access-control firmware) reports its door state every couple of seconds: nothing to keep
  const body = req.method === "POST" ? await req.text().catch(() => "") : "";
  // …but say so in the logs when it reports an alarm (the yellow triangle; alarm=bits, sensor, relay, door)
  if (what === "cdata" && tbl === "RTSTATE") { if (/alarm=0*[1-9]/i.test(body)) console.log(`iclock rtstate ${body.slice(0, 300)}`); return text("OK"); }
  const lines = body.split(/\r?\n/);
  // real-time events: only the ones with a person in them (a face scan) go further
  const people = tbl === "RTLOG" ? lines.filter((l) => parseAtt(l)) : [];
  if (tbl === "RTLOG" && !people.length) return text("OK");
  if (what !== "getrequest") console.log(`iclock ${req.method} /${what} SN=${sn || "-"} ${url.search.slice(0, 160)}${people.length ? ` ${people.join(" | ").slice(0, 300)}` : ""}`);
  const admin = createAdminClient();
  const d = await zkDevice(admin, sn);
  if (!d) { console.log(`iclock refused SN=${sn || "-"}`); return text("Unknown device", 400); }

  // newer firmware registers first (what it says about itself, minus any passwords)
  if (what === "registry") { await zkSeen(admin, d, { registry: redact(body).slice(0, 4000), acc: /DeviceType=acc/i.test(body) }); return text(`RegistryCode=${d.id.replace(/-/g, "").slice(0, 10)}`); }
  if (what === "push") { await zkSeen(admin, d); return text(isAcc(d) ? zkAccOptions(d) : zkOptions(d)); }

  if (what === "cdata") {
    if (req.method === "GET") {
      // a time-attendance clock (push 2.x) checks in here without registering; one switched over from door access
      // (Oct 16: the SpeedFace went from A&C PUSH to T&A PUSH) stops being treated as a door controller
      const pv = url.searchParams.get("pushver") || "";
      await zkSeen(admin, d, { pushver: pv, language: url.searchParams.get("language") || "", hello: new Date().toISOString(), ...(pv && !pv.startsWith("3") ? { acc: false } : {}) });
      if (pv && !pv.startsWith("3")) d.info = { ...(d.info || {}), acc: false };
      return text(isAcc(d) ? zkAccOptions(d) : zkOptions(d));
    }
    const table = tbl;
    if (table === "RTLOG") {
      await zkKeep(admin, d, "att", people);
      await zkSeen(admin, d);
      if (d.active) await zkProcess(admin, d.id).catch(() => null);
      return text("OK");
    }
    // the clock's user list (access-control firmware): who's on it by ID and name; their passwords are never kept
    if (table === "TABLEDATA") {
      const name = (url.searchParams.get("tablename") || "").toLowerCase();
      if (name === "user") {
        const users = parseAccUsers(lines);
        await zkSeen(admin, d, { users: { ...((d.info?.users as Record<string, string>) || {}), ...users }, usersAt: new Date().toISOString() });
        return text(`user=${Object.keys(users).length}`);
      }
      await zkSeen(admin, d);
      return text(`${name || "table"}=${lines.filter(Boolean).length}`);
    }
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
      const opts = Object.fromEntries(redact(body).split(/[,\n]/).map((kv) => kv.replace(/^~/, "").split("=")).filter((x) => x.length === 2 && x[0].length < 40).map(([k, v]) => [k.trim(), v.trim().slice(0, 120)]));
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
  // answers to "who's on the clock" (access-control firmware posts them here)
  if (what === "querydata") {
    const name = (url.searchParams.get("tablename") || "").toLowerCase();
    if (name === "user") {
      const users = parseAccUsers(lines);
      const fresh = url.searchParams.get("packidx") === "1" || !url.searchParams.get("packidx");
      await zkSeen(admin, d, { users: { ...(fresh ? {} : (d.info?.users as Record<string, string>) || {}), ...users }, usersAt: new Date().toISOString() });
      return text(`user=${Object.keys(users).length}`);
    }
    // its settings (answer to GET OPTIONS): kept on the clock's info, passwords removed
    if (name === "options" || url.searchParams.get("type") === "options") {
      const clean = redact(body);
      console.log(`iclock options ${clean.slice(0, 3500)}`);
      const kv = Object.fromEntries(clean.split(/[,\t\r\n]+/).map((x) => { const i = x.indexOf("="); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim().slice(0, 200)] : null; }).filter((x): x is [string, string] => !!x && x[0].length < 60));
      await zkSeen(admin, d, { settings: { ...((d.info?.settings as Record<string, string>) || {}), ...kv }, settingsAt: new Date().toISOString() });
      return text(`options=${Object.keys(kv).length}`);
    }
    await zkSeen(admin, d);
    return text(`${name || "table"}=${lines.filter(Boolean).length}`);
  }
  if (what === "devicecmd") { if (/GET OPTIONS|INFO/i.test(body)) console.log(`iclock devicecmd ${redact(body).slice(0, 3000)}`); await zkCommandResults(admin, d.id, body); await zkSeen(admin, d); return text("OK"); }
  await zkSeen(admin, d);
  return text("OK");
}

export const GET = handle;
export const POST = handle;
