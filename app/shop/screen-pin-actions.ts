"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, checkPin, validPin } from "@/lib/timeclockServer";

/**
 * The screen PIN in front of pay screens (Time Clock, Employees, Payroll; Nov 11, Nick: "if he leaves his computer open
 * and someone comes to grab a separation or a film, you can see what everybody makes… have him create a pin").
 * Only a hash is kept (staff_screen_pins, readable by the server alone). Five wrong tries lock it for 5 minutes.
 */
export async function screenPinState() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { has: false };
  const { data } = await createAdminClient().from("staff_screen_pins").select("email").eq("email", v.email).maybeSingle();
  return { has: !!data };
}

export async function setScreenPin(pin: string) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { ok: false, error: "Shop staff only." };
  if (!validPin(pin)) return { ok: false, error: "Use 4 to 6 numbers." };
  const admin = createAdminClient();
  const { data } = await admin.from("staff_screen_pins").select("email").eq("email", v.email).maybeSingle();
  if (data) return { ok: false, error: "You already have a PIN." };
  const { error } = await admin.from("staff_screen_pins").insert({ email: v.email, pin_hash: hashPin(pin) });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function checkScreenPin(pin: string) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { ok: false, error: "Shop staff only." };
  const admin = createAdminClient();
  const { data } = await admin.from("staff_screen_pins").select("pin_hash, fails, locked_until").eq("email", v.email).maybeSingle();
  if (!data) return { ok: false, error: "No PIN yet." };
  if (data.locked_until && new Date(data.locked_until as string) > new Date()) return { ok: false, error: "Too many tries. Wait 5 minutes." };
  if (!checkPin(pin, data.pin_hash as string)) {
    const fails = ((data.fails as number) || 0) + 1;
    await admin.from("staff_screen_pins").update({ fails: fails >= 5 ? 0 : fails, locked_until: fails >= 5 ? new Date(Date.now() + 5 * 60_000).toISOString() : null }).eq("email", v.email);
    return { ok: false, error: fails >= 5 ? "Too many tries. Wait 5 minutes." : "Wrong PIN." };
  }
  await admin.from("staff_screen_pins").update({ fails: 0, locked_until: null }).eq("email", v.email);
  return { ok: true };
}

/** the owner clears someone's PIN when they forget it; they make a new one next time */
export async function clearScreenPin(email: string) {
  const v = await getViewer();
  if (v.role !== "owner" && v.role !== "admin") return { ok: false, error: "Owner or admin only." };
  const { error } = await createAdminClient().from("staff_screen_pins").delete().eq("email", email.toLowerCase());
  return error ? { ok: false, error: error.message } : { ok: true };
}
