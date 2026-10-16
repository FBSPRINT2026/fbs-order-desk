import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localToIso, localDay } from "@/lib/timeclock";
import { stopJob } from "@/lib/timeclockServer";

/**
 * ZKTeco wall clock (SpeedFace-V4L, Oct 16 2026, Nick: "i finally got the time clock in"). The clock sends punches to
 * us over ZKTeco's push protocol ("ADMS"): it checks in at /iclock/cdata, posts each face scan as an ATTLOG line, and
 * asks /iclock/getrequest for anything we want it to do. Its "User ID" for each person is our employee code (101, 102…).
 *
 * A new clock shows up Off. Lines it sends are kept as sent (timeclock_raw) and only become punches once an owner or
 * admin turns it on, so a stranger can't add time. Face scans don't say in or out: the next punch follows the
 * person's last one (out → in, in → out, on break → back from break), a scan within 10 minutes of their last punch is ignored (the clock repeats itself while someone stands there; Nick, Oct 16), and
 * a clock-in left open from an earlier day starts a new day with a clock-in.
 */
export type ZkDevice = { id: string; name: string; active: boolean; serial: string; info: Record<string, unknown>; att_stamp: string | null; op_stamp: string | null; last_seen_at: string | null };

export const validSerial = (sn: string) => /^[A-Za-z0-9_-]{5,32}$/.test(sn);

/** The clock by its serial number; a new one is added Off (at most 5 clocks waiting to be turned on). */
export async function zkDevice(admin: SupabaseClient, sn: string): Promise<ZkDevice | null> {
  if (!validSerial(sn)) return null;
  const cols = "id, name, active, serial, info, att_stamp, op_stamp, last_seen_at";
  const { data } = await admin.from("timeclock_devices").select(cols).eq("serial", sn).maybeSingle();
  if (data) return data as ZkDevice;
  const { count } = await admin.from("timeclock_devices").select("id", { count: "exact", head: true }).eq("kind", "zk").eq("active", false);
  if ((count || 0) >= 5) return null;
  const { data: made } = await admin.from("timeclock_devices").insert({ name: `ZKTeco clock ${sn}`, kind: "zk", serial: sn, active: false, token_hash: `zk:${sn}`, created_by: "the clock" }).select(cols).single();
  return (made || null) as ZkDevice | null;
}

/** Note that the clock checked in (at most once a minute) and keep what it says about itself. */
export async function zkSeen(admin: SupabaseClient, d: ZkDevice, info?: Record<string, unknown>) {
  const stale = !d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 60000;
  if (!stale && !info) return;
  const up: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (info) up.info = { ...(d.info || {}), ...info };
  await admin.from("timeclock_devices").update(up).eq("id", d.id);
}

/** What we tell the clock when it checks in. Times on the clock are shop time (Central). */
export function zkOptions(d: ZkDevice) {
  const offHours = chicagoOffset();
  return [
    `GET OPTION FROM: ${d.serial}`,
    `ATTLOGStamp=${d.att_stamp || "0"}`,
    `OPERLOGStamp=${d.op_stamp || "0"}`,
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=30",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser",
    `TimeZone=${offHours}`,
    "Realtime=1",
    "Encrypt=None",
    "ServerVer=2.4.1",
  ].join("\n");
}
/** Central time's offset from UTC right now, in hours (-5 in summer, -6 in winter). */
function chicagoOffset() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 3600000);
}

/** The access-control firmware (the SpeedFace-V4L says "DeviceType=acc", push 3.x): its own settings reply and commands. */
export const isAcc = (d: ZkDevice) => typeof d.info?.acc === "boolean" ? (d.info.acc as boolean) : /DeviceType=acc/i.test(String(d.info?.registry || ""));
export function zkAccOptions(d: ZkDevice) {
  return [
    "ServerVersion=3.1.2", "ServerName=ADMS", "PushVersion=3.1.2", "ErrorDelay=30", "RequestDelay=10",
    "TransTimes=00:00\t14:00", "TransInterval=1", "TransTables=User\tTransaction", "Realtime=1",
    `SessionID=${d.id.replace(/-/g, "").slice(0, 16)}`, "TimeoutSec=10",
  ].join("\n");
}
/** Never keep a password the clock mentions about itself (its video login, a user's PIN). */
export const redact = (s: string) => s.replace(/((?:VMS)?Passw(?:or)?d|Password)=[^,\t\n]*/gi, "$1=…");

/** Keep each line the clock posts, as sent (a line sent twice is kept once). */
export async function zkKeep(admin: SupabaseClient, d: ZkDevice, kind: "att" | "op" | "user", lines: string[]) {
  const rows = lines.map((l) => l.replace(/\r/g, "")).filter((l) => l.trim()).slice(0, 2000).map((line) => ({ device_id: d.id, serial: d.serial, kind, line: line.slice(0, 2000) }));
  for (let i = 0; i < rows.length; i += 500) await admin.from("timeclock_raw").upsert(rows.slice(i, i + 500), { onConflict: "serial,kind,line", ignoreDuplicates: true });
  return rows.length;
}

/** "101\t2026-10-16 12:45:03\t0\t15\t…" → who, when (shop time) and the clock's state (0 in, 1 out, 2 break out, 3 break in). */
export function parseAtt(line: string) {
  // access-control firmware: "time=2026-10-16 13:22:30\tpin=115\tcardno=0\tevent=0\tinoutstatus=0\tverifytype=15…"
  if (/(^|\t)time=/.test(line)) {
    const kv = Object.fromEntries(line.split("\t").map((x) => { const i = x.indexOf("="); return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()]; }));
    const pin = (kv.pin || "").replace(/^0+/, "");
    const m = (kv.time || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    // no person (door events) or someone the clock didn't know (event 27): not a punch
    if (!pin || !m || kv.event === "27") return null;
    const at = new Date(Date.parse(localToIso(m[1], +m[2] * 60 + +m[3])) + (+(m[4] || 0)) * 1000).toISOString();
    return { pin, at, wall: `${m[1]} ${m[2].padStart(2, "0")}:${m[3]}:${m[4] || "00"}`, state: +(kv.inoutstatus || 0) || 0, verify: +(kv.verifytype || 0) || 0 };
  }
  const f = line.split("\t");
  const pin = (f[0] || "").trim();
  const m = (f[1] || "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!pin || !m) return null;
  const at = new Date(Date.parse(localToIso(m[1], +m[2] * 60 + +m[3])) + (+(m[4] || 0)) * 1000).toISOString();
  return { pin, at, wall: `${m[1]} ${m[2].padStart(2, "0")}:${m[3]}:${m[4] || "00"}`, state: +(f[2] || 0) || 0, verify: +(f[3] || 0) || 0 };
}

type Last = { kind: "in" | "out" | "break_start" | "break_end"; at: string } | null;

/** Turn this clock's waiting punch lines into punches (only while it's on). Returns how many punches were added. */
export async function zkProcess(admin: SupabaseClient, deviceId: string) {
  const { data: dev } = await admin.from("timeclock_devices").select("id, active, serial").eq("id", deviceId).maybeSingle();
  if (!dev?.active) return { added: 0, waiting: 0 };
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: raw } = await admin.from("timeclock_raw").select("id, line").eq("device_id", deviceId).eq("kind", "att").eq("done", false).gte("received_at", since).order("id").limit(1000);
  const lines = ((raw || []) as { id: number; line: string }[]).map((r) => ({ ...r, p: parseAtt(r.line) })).sort((a, b) => (a.p?.at || "").localeCompare(b.p?.at || ""));
  if (!lines.length) return { added: 0, waiting: 0 };
  const { data: emps } = await admin.from("employees").select("id, code, active").not("code", "is", null);
  const byCode = new Map(((emps || []) as { id: string; code: number; active: boolean }[]).map((e) => [String(e.code), e]));
  let added = 0, waiting = 0;
  for (const r of lines) {
    if (!r.p) { await admin.from("timeclock_raw").update({ done: true, note: "not a punch line" }).eq("id", r.id); continue; }
    const e = byCode.get(r.p.pin.replace(/^0+/, ""));
    if (!e) { waiting++; await admin.from("timeclock_raw").update({ note: `no employee with ID ${r.p.pin}` }).eq("id", r.id); continue; }
    const key = `zk:${dev.serial}:${r.p.pin}:${r.p.wall}`;
    const { data: lastRow } = await admin.from("time_punches").select("kind, at").eq("employee_id", e.id).eq("voided", false).lt("at", r.p.at).order("at", { ascending: false }).limit(1).maybeSingle();
    const last = (lastRow || null) as Last;
    const gapMin = last ? (Date.parse(r.p.at) - Date.parse(last.at)) / 60000 : Infinity;
    if (last && gapMin < 10) { await admin.from("timeclock_raw").update({ done: true, note: "repeat scan (within 10 minutes)" }).eq("id", r.id); continue; }
    const open = last && last.kind !== "out" && localDay(last.at) === localDay(r.p.at) && gapMin < 16 * 60;
    let kind: NonNullable<Last>["kind"];
    if (!open) kind = "in";
    else if (last!.kind === "break_start") kind = "break_end";
    else if (r.p.state === 2) kind = "break_start";
    else kind = "out";
    const { data: ins, error } = await admin.from("time_punches").upsert({ employee_id: e.id, kind, at: r.p.at, source: "zkteco", device_id: deviceId, note: "", uattend_id: key }, { onConflict: "uattend_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (error) { await admin.from("timeclock_raw").update({ note: error.message.slice(0, 200) }).eq("id", r.id); continue; }
    await admin.from("timeclock_raw").update({ done: true, punch_id: ins?.id || null, note: kind }).eq("id", r.id);
    if (ins) added++;
    // clocking out for the day finishes a job someone forgot to finish (same as the tablet clock)
    if (kind === "out" && ins && Date.now() - Date.parse(r.p.at) < 30 * 60000) await stopJob(admin, e.id, { auto: true }).catch(() => null);
  }
  return { added, waiting };
}

/** Names the clock can show: plain letters, at most 24. */
export const clockName = (first: string, last: string) => {
  const plain = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .'-]/g, "").replace(/\s+/g, " ").trim();
  const full = plain(`${first} ${last}`);
  // too long for the clock: the first first name and the first last name ("Vanessa Chirinos")
  return (full.length <= 24 ? full : plain(`${first.split(/\s+/)[0]} ${last.split(/\s+/)[0]}`)).slice(0, 24);
};

/**
 * Ask the clock to add everyone on our employee list by their ID. Their face is still added at the clock. People
 * already on the clock (Nick, the admin) are left alone, so their admin rights and password never change. Until the
 * clock has told us who's on it, we only ask it (the caller says "try again in a minute").
 */
export async function zkQueueUsers(admin: SupabaseClient, deviceId: string, by: string) {
  const { data: dev } = await admin.from("timeclock_devices").select("id, name, active, serial, info, att_stamp, op_stamp, last_seen_at").eq("id", deviceId).maybeSingle();
  if (!dev) return { sent: 0, waiting: false };
  const d = dev as ZkDevice, acc = isAcc(d);
  const onClock = (d.info?.users as Record<string, string>) || null;
  const ask = acc ? "DATA QUERY tablename=user,fielddesc=*,filter=*" : "DATA QUERY USERINFO";
  if (!onClock) { await admin.from("timeclock_cmds").insert({ device_id: deviceId, created_by: by, cmd: ask }); return { sent: 0, waiting: true }; }
  const { data: emps } = await admin.from("employees").select("first_name, last_name, code").eq("active", true).not("code", "is", null).order("code");
  const add = ((emps || []) as { first_name: string; last_name: string; code: number }[]).filter((e) => !onClock[String(e.code)]);
  const cmds = add.flatMap((e) => acc
    ? [{ device_id: deviceId, created_by: by, cmd: `DATA UPDATE user Pin=${e.code}\tName=${clockName(e.first_name, e.last_name)}\tPrivilege=0` },
       { device_id: deviceId, created_by: by, cmd: `DATA UPDATE userauthorize Pin=${e.code}\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1` }]
    : [{ device_id: deviceId, created_by: by, cmd: `DATA UPDATE USERINFO PIN=${e.code}\tName=${clockName(e.first_name, e.last_name)}` }]);
  if (cmds.length) await admin.from("timeclock_cmds").insert(cmds);
  await admin.from("timeclock_cmds").insert({ device_id: deviceId, created_by: by, cmd: ask });
  return { sent: add.length, waiting: false };
}

/** "user uid=1\tcardno=\tpin=115\tpassword=…\tname=Nicholas McCoy\tprivilege=14…" → { "115": "Nicholas McCoy" } (nothing else kept). */
export function parseAccUsers(lines: string[]) {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = l.match(/^user\s+(.*)$/i);
    if (!m) continue;
    const kv = Object.fromEntries(m[1].split("\t").map((x) => { const i = x.indexOf("="); return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()]; }));
    if (kv.pin) out[kv.pin] = kv.name || "";
  }
  return out;
}

/** The next things for the clock to do ("C:<id>:<command>" lines), marked sent. */
export async function zkNextCommands(admin: SupabaseClient, deviceId: string) {
  const { data } = await admin.from("timeclock_cmds").select("id, cmd").eq("device_id", deviceId).is("sent_at", null).order("id").limit(20);
  const rows = (data || []) as { id: number; cmd: string }[];
  if (!rows.length) return "OK";
  await admin.from("timeclock_cmds").update({ sent_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  return rows.map((r) => `C:${r.id}:${r.cmd}`).join("\n");
}

/** The clock's answers: "ID=12&Return=0&CMD=DATA" lines. */
export async function zkCommandResults(admin: SupabaseClient, deviceId: string, body: string) {
  for (const line of body.split(/\r?\n/).filter(Boolean)) {
    const q = new URLSearchParams(line);
    const id = +(q.get("ID") || 0);
    if (id) await admin.from("timeclock_cmds").update({ done_at: new Date().toISOString(), result: `${q.get("Return") ?? ""} ${q.get("CMD") ?? ""}`.trim() }).eq("id", id).eq("device_id", deviceId);
    // settings the clock reports back (GET OPTIONS): kept on the clock's info, minus passwords
    else if (/^[~A-Za-z][\w~]*=/.test(line) && !/^(ID|Return|CMD)=/.test(line)) {
      const { data } = await admin.from("timeclock_devices").select("info").eq("id", deviceId).maybeSingle();
      const kv = Object.fromEntries(redact(line).split(/[,&]/).map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim().slice(0, 200)]));
      await admin.from("timeclock_devices").update({ info: { ...((data?.info as Record<string, unknown>) || {}), settings: { ...(((data?.info as Record<string, unknown>)?.settings as Record<string, string>) || {}), ...kv } } }).eq("id", deviceId);
    }
  }
}

/** "USER PIN=101\tName=Miguel Araniva\tPri=0…" lines → who's on the clock. */
export function parseUsers(lines: string[]) {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = l.match(/^USER\s+(.*)$/);
    if (!m) continue;
    const f = Object.fromEntries(m[1].split("\t").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    if (f.PIN) out[f.PIN] = f.Name || "";
  }
  return out;
}
