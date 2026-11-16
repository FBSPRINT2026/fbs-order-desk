"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPin, hashPin, validPin } from "@/lib/timeclockServer";

/**
 * Each person's own PIN to show pay figures (Nick, Nov 16 2026: "we're gonna leave our login open on an employee's
 * computer… they're gonna see what everybody makes"). Kept scrambled in `pay_pins` (only the server reads it); five
 * wrong tries lock it for 5 minutes. The figures stay hidden in the browser until it's typed (lib/payLock.ts).
 */
type R = { ok: boolean; error?: string };
async function me() {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) throw new Error("Sign in again.");
  return { id: user.id, admin: createAdminClient() };
}

export async function payPinState(): Promise<{ ok: boolean; has?: boolean; error?: string }> {
  try {
    const { id, admin } = await me();
    const { data } = await admin.from("pay_pins").select("user_id").eq("user_id", id).maybeSingle();
    return { ok: true, has: !!data };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't check." }; }
}

export async function payPinCheck(pin: string): Promise<R> {
  try {
    const { id, admin } = await me();
    const { data } = await admin.from("pay_pins").select("hash, fails, locked_until").eq("user_id", id).maybeSingle();
    if (!data) return { ok: false, error: "Set your PIN first." };
    if (data.locked_until && new Date(data.locked_until) > new Date()) return { ok: false, error: "Too many tries. Wait a few minutes." };
    if (checkPin(String(pin || ""), data.hash)) {
      if (data.fails) await admin.from("pay_pins").update({ fails: 0, locked_until: null }).eq("user_id", id);
      return { ok: true };
    }
    const fails = (data.fails || 0) + 1;
    await admin.from("pay_pins").update({ fails: fails >= 5 ? 0 : fails, locked_until: fails >= 5 ? new Date(Date.now() + 5 * 60_000).toISOString() : null }).eq("user_id", id);
    return { ok: false, error: fails >= 5 ? "Too many tries. Wait 5 minutes." : "That's not your PIN." };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't check." }; }
}

/** Set your own PIN; changing it asks for the old one. */
export async function payPinSet(pin: string, old?: string): Promise<R> {
  try {
    const { id, admin } = await me();
    if (!validPin(pin)) return { ok: false, error: "Use 4 to 6 numbers." };
    const { data } = await admin.from("pay_pins").select("hash").eq("user_id", id).maybeSingle();
    if (data && !checkPin(String(old || ""), data.hash)) return { ok: false, error: "Your current PIN isn't right." };
    const { error } = await admin.from("pay_pins").upsert({ user_id: id, hash: hashPin(pin), fails: 0, locked_until: null, updated_at: new Date().toISOString() });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}
