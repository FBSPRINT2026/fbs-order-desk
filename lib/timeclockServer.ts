import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings } from "@/lib/pricing";
import { localDay, mergeTime, nextKinds, timecard, type Punch, type TimeSettings } from "@/lib/timeclock";

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
  return { last, next: nextKinds(last), todayMinutes: card.worked, state: card.state, since: card.since };
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
  const { data, error } = await admin.from("time_punches").insert({ employee_id: p.employeeId, kind: p.kind, at, source: p.source, device_id: p.deviceId || null, photo_path, lat: p.lat ?? null, lng: p.lng ?? null, accuracy: p.accuracy ?? null, note: p.note || "" }).select("id, at, kind").single();
  if (error) return { error: error.message, status: st };
  return { punch: data, status: await statusOf(admin, s, p.employeeId) };
}
