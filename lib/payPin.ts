import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Take a Payment's PIN (Nov 3, Nick: "someone… go to my computer and accidentally charge somebody… once you hit go, you
 * have to put in the PIN"): 4 to 8 digits per person, kept only as a salted scrypt hash in staff_pay_pins (no one can
 * read that table from a browser). Five wrong tries lock it for 15 minutes.
 */
const N = 16384;
const hashOf = (pin: string, salt = randomBytes(16).toString("hex")) => `scrypt$${salt}$${scryptSync(pin, salt, 32, { N }).toString("hex")}`;
export const pinOk = (pin: string) => /^\d{4,8}$/.test(pin);

export async function hasPin(admin: SupabaseClient, email: string) {
  const { data } = await admin.from("staff_pay_pins").select("email").eq("email", email.toLowerCase()).maybeSingle();
  return !!data;
}
export async function setPin(admin: SupabaseClient, email: string, pin: string, by: string) {
  if (!pinOk(pin)) return { ok: false as const, error: "The PIN is 4 to 8 numbers." };
  const { error } = await admin.from("staff_pay_pins").upsert({ email: email.toLowerCase(), hash: hashOf(pin), fails: 0, locked_until: null, set_at: new Date().toISOString(), set_by: by });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
export async function checkPin(admin: SupabaseClient, email: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await admin.from("staff_pay_pins").select("hash, fails, locked_until").eq("email", email.toLowerCase()).maybeSingle();
  const row = data as { hash: string; fails: number; locked_until: string | null } | null;
  if (!row) return { ok: false, error: "Set your payment PIN first." };
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) return { ok: false, error: "Too many wrong PINs. Try again in 15 minutes." };
  const [, salt, want] = row.hash.split("$");
  const got = scryptSync(String(pin || ""), salt, 32, { N });
  const good = pinOk(String(pin || "")) && timingSafeEqual(got, Buffer.from(want, "hex"));
  if (good) { if (row.fails) await admin.from("staff_pay_pins").update({ fails: 0, locked_until: null }).eq("email", email.toLowerCase()); return { ok: true }; }
  const fails = (row.fails || 0) + 1;
  await admin.from("staff_pay_pins").update({ fails, locked_until: fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null }).eq("email", email.toLowerCase());
  return { ok: false, error: fails >= 5 ? "Too many wrong PINs. Try again in 15 minutes." : "That PIN isn't right." };
}
