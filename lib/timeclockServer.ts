import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings } from "@/lib/pricing";
import { localDay, mergeTime, nextKinds, timecard, type JobTime, type OpenJob, type Punch, type TimeSettings } from "@/lib/timeclock";

/** The cookie a tablet keeps once it's set up as a wall clock (the token itself; we only store its hash). */
export const DEVICE_COOKIE = "fbs_clock";
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newDeviceToken = () => randomBytes(32).toString("base64url");

/** PINs: scrypt with a salt per PIN. */
export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return `s1$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;
}
export function checkPin(pin: string, stored: string) {
  const [v, salt, hash] = stored.split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex"), b = scryptSync(pin, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);

export async function timeSettings(admin: SupabaseClient): Promise<TimeSettings> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return mergeTime((data?.data as { time?: unknown } | null)?.time);
}
export async function shopName(admin: SupabaseClient) {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return mergeSettings(data?.data).shop.name;
}

/** The wall clock this request comes from (by its cookie), or null. */
export async function deviceFor(admin: SupabaseClient, token: string | undefined) {
  if (!token) return null;
  const { data } = await admin.from("timeclock_devices").select("id, name, active, fails, locked_until").eq("token_hash", sha(token)).maybeSingle();
  if (!data || !data.active) return null;
  await admin.from("timeclock_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data as { id: string; name: string; active: boolean; fails: number; locked_until: string | null };
}

/** Too many wrong PINs on one clock: it waits a minute. */
export async function pinFailed(admin: SupabaseClient, dev: { id: string; fails: number }) {
  const fails = dev.fails + 1;
  await admin.from("timeclock_devices").update({ fails: fails >= 5 ? 0 : fails, locked_until: fails >= 5 ? new Date(Date.now() + 60000).toISOString() : null }).eq("id", dev.id);
  return fails >= 5;
}
export const pinOk = (admin: SupabaseClient, devId: string) => admin.from("timeclock_devices").update({ fails: 0, locked_until: null }).eq("id", devId);

export async function verifyEmployeePin(admin: SupabaseClient, employeeId: string, pin: string) {
  const { data } = await admin.from("employee_pins").select("pin_hash").eq("employee_id", employeeId).maybeSingle();
  return !!data && checkPin(pin, data.pin_hash as string);
}

/** Someone's last punch, and today's hours so far. */
export async function statusOf(admin: SupabaseClient, s: TimeSettings, employeeId: string) {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await admin.from("time_punches").select("id, employee_id, kind, at, source, voided").eq("employee_id", employeeId).eq("voided", false).gte("at", since).order("at");
  const punches = (data || []) as Punch[];
  const last = punches[punches.length - 1] || null;
  const today = localDay(new Date());
  const card = timecard(s, employeeId, punches, [], today, today);
  const [job, resume] = await Promise.all([runningJob(admin, employeeId), resumable(admin, employeeId)]);
  return { last, next: nextKinds(last), todayMinutes: card.worked, state: card.state, since: card.since, job, resume: job ? null : resume };
}

/* ---------- job punches ---------- */

const JOB_COLS = "id, employee_id, order_id, archived_order_id, job_label, task, station, started_at, ended_at, pieces, note, source, team_id, auto_stopped, voided";
export async function runningJob(admin: SupabaseClient, employeeId: string) {
  const { data } = await admin.from("job_time").select(JOB_COLS).eq("employee_id", employeeId).is("ended_at", null).eq("voided", false).order("started_at", { ascending: false }).limit(1);
  return ((data || [])[0] || null) as JobTime | null;
}
/** The job that a break or clock-out stopped today (offered as "Resume"). */
async function resumable(admin: SupabaseClient, employeeId: string) {
  const { data } = await admin.from("job_time").select(JOB_COLS).eq("employee_id", employeeId).eq("auto_stopped", true).eq("voided", false).gte("ended_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("ended_at", { ascending: false }).limit(1);
  const j = ((data || [])[0] || null) as JobTime | null;
  return j && localDay(j.ended_at!) === localDay(new Date()) ? j : null;
}

const PV_DONE = /job\s*completed|quote\s*-\s*closed|cancel/i;
/** Orders people can clock onto: new orders in the works, and open Printavo orders (until go-live). */
export async function openJobs(admin: SupabaseClient): Promise<OpenJob[]> {
  const [{ data: o }, { data: a }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, due_date, qty, status, customer_id").in("status", ["approved", "art", "blanks", "production", "ready"]).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
    admin.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, customer_id").eq("kind", "invoice").gte("due_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)).order("due_date").limit(500),
  ]);
  const pv = ((a || []) as { id: string; visual_id: string; nickname: string; due_date: string | null; qty: number; status_name: string; customer_id: string | null }[]).filter((x) => !PV_DONE.test(x.status_name || ""));
  const ids = [...new Set([...((o || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...pv.map((x) => x.customer_id)].filter(Boolean))] as string[];
  const { data: cs } = ids.length ? await admin.from("customers").select("id, company, name").in("id", ids) : { data: [] };
  const cn = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name]));
  return [
    ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null }[]).map((x): OpenJob => ({ kind: "o", id: x.id, number: String(x.number), name: x.nickname || "", customer: cn.get(x.customer_id || "") || "", due: x.due_date, qty: x.qty || 0, status: x.status })),
    ...pv.map((x): OpenJob => ({ kind: "a", id: x.id, number: x.visual_id, name: x.nickname || "", customer: cn.get(x.customer_id || "") || "", due: x.due_date, qty: x.qty || 0, status: x.status_name })),
  ].sort((p, q) => (p.due || "9").localeCompare(q.due || "9"));
}

/** Stop whatever job someone's on (a break or clock-out marks it auto-stopped, so the clock can offer to resume). */
export async function stopJob(admin: SupabaseClient, employeeId: string, opts: { pieces?: number | null; auto?: boolean; note?: string } = {}) {
  const run = await runningJob(admin, employeeId);
  if (!run) return null;
  const patch: Record<string, unknown> = { ended_at: new Date().toISOString(), auto_stopped: !!opts.auto };
  if (opts.pieces != null && opts.pieces >= 0) patch.pieces = Math.round(opts.pieces);
  if (opts.note) patch.note = opts.note;
  await admin.from("job_time").update(patch).eq("id", run.id);
  return run;
}

/** Start a job for someone (and teammates): whatever they were on stops first. */
export async function startJob(admin: SupabaseClient, p: { employeeId: string; job: { kind: "o" | "a"; id: string }; task: string; station?: string; team?: string[]; source: string }) {
  const { data: j } = p.job.kind === "o"
    ? await admin.from("orders").select("id, number, nickname").eq("id", p.job.id).maybeSingle()
    : await admin.from("archived_orders").select("id, visual_id, nickname").eq("id", p.job.id).maybeSingle();
  if (!j) return { error: "That order wasn't found." };
  const label = `#${(j as { number?: number; visual_id?: string }).number ?? (j as { visual_id?: string }).visual_id} ${(j as { nickname: string }).nickname || ""}`.trim();
  const people = [...new Set([p.employeeId, ...(p.team || [])])];
  const team_id = people.length > 1 ? crypto.randomUUID() : null;
  const now = new Date().toISOString();
  for (const e of people) await stopJob(admin, e);
  const rows = people.map((e) => ({ employee_id: e, order_id: p.job.kind === "o" ? p.job.id : null, archived_order_id: p.job.kind === "a" ? p.job.id : null, job_label: label, task: p.task.slice(0, 60), station: (p.station || "").slice(0, 60), started_at: now, source: p.source, team_id, started_by: p.employeeId }));
  const { error } = await admin.from("job_time").insert(rows);
  if (error) return { error: error.message };
  return { label, people: people.length };
}

/** Who's clocked in now (for picking teammates). */
export async function clockedIn(admin: SupabaseClient) {
  const { data } = await admin.from("time_punches").select("employee_id, kind, at").eq("voided", false).gte("at", new Date(Date.now() - 16 * 3600000).toISOString()).order("at");
  const last = new Map<string, string>();
  for (const p of (data || []) as { employee_id: string; kind: string }[]) last.set(p.employee_id, p.kind);
  return [...last.entries()].filter(([, k]) => k === "in" || k === "break_end").map(([id]) => id);
}

/** Record a punch after checking it makes sense (can't clock out twice, etc.). Photo is a JPEG data URL. */
export async function recordPunch(admin: SupabaseClient, p: { employeeId: string; kind: Punch["kind"]; source: string; deviceId?: string | null; photo?: string | null; lat?: number | null; lng?: number | null; accuracy?: number | null; note?: string }) {
  const s = await timeSettings(admin);
  const st = await statusOf(admin, s, p.employeeId);
  if (!st.next.includes(p.kind)) return { error: p.kind === "in" ? "You're already clocked in." : p.kind === "out" && st.state === "out" ? "You're not clocked in." : "That doesn't match your last punch.", status: st };
  const at = new Date().toISOString();
  let photo_path: string | null = null;
  if (p.photo && /^data:image\/(jpeg|png|webp);base64,/.test(p.photo) && p.photo.length < 1_500_000) {
    const buf = Buffer.from(p.photo.split(",")[1], "base64");
    const path = `${p.employeeId}/${at.slice(0, 10)}/${at.replace(/[:.]/g, "-")}-${p.kind}.jpg`;
    const up = await admin.storage.from("timeclock").upload(path, buf, { contentType: "image/jpeg", upsert: false });
    if (!up.error) photo_path = path;
  }
  // clocking out for the day finishes a job someone forgot to finish
  if (p.kind === "out") await stopJob(admin, p.employeeId, { auto: true });
  const { data, error } = await admin.from("time_punches").insert({ employee_id: p.employeeId, kind: p.kind, at, source: p.source, device_id: p.deviceId || null, photo_path, lat: p.lat ?? null, lng: p.lng ?? null, accuracy: p.accuracy ?? null, note: p.note || "" }).select("id, at, kind").single();
  if (error) return { error: error.message, status: st };
  return { punch: data, status: await statusOf(admin, s, p.employeeId) };
}

/** Start or stop a job (the employee app, phones, shop screens). Job time is separate from the shift clock: no clock-in needed. */
export async function jobAction(admin: SupabaseClient, employeeId: string, b: Record<string, unknown>, _deviceId: string | null, source = "clock"): Promise<{ error?: string; message?: string }> {
  if (b.action === "job_stop") {
    const pieces = b.pieces === "" || b.pieces == null ? null : Number(b.pieces);
    const run = await stopJob(admin, employeeId, { pieces: pieces != null && isFinite(pieces) ? pieces : null, note: typeof b.note === "string" ? b.note.slice(0, 200) : "" });
    return run ? { message: `Stopped ${run.job_label}` } : { error: "You're not on a job." };
  }
  const job = b.job as { kind?: string; id?: string } | undefined;
  if (!job?.id || (job.kind !== "o" && job.kind !== "a")) return { error: "Pick an order." };
  const task = String(b.task || "").trim();
  if (!task) return { error: "Pick what you're doing." };
  const team = Array.isArray(b.team) ? (b.team as unknown[]).map(String).filter((x) => x && x !== employeeId).slice(0, 12) : [];
  const r = await startJob(admin, { employeeId, job: { kind: job.kind, id: job.id }, task, station: String(b.station || ""), team, source });
  if ("error" in r && r.error) return { error: r.error };
  return { message: `Started ${r.label}${team.length ? ` with ${team.length} teammate${team.length === 1 ? "" : "s"}` : ""}` };
}

/** Someone's job entries today (the employee app shows them as a little log). */
export async function jobsToday(admin: SupabaseClient, employeeId: string) {
  const { data } = await admin.from("job_time").select(JOB_COLS).eq("employee_id", employeeId).eq("voided", false).gte("started_at", new Date(Date.now() - 20 * 3600000).toISOString()).order("started_at", { ascending: false });
  return ((data || []) as JobTime[]).filter((j) => localDay(j.started_at) === localDay(new Date()));
}
