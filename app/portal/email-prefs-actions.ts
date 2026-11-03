"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanPrefs, kindOn, type EmailPerson, type EmailPrefs } from "@/lib/customerEmails";

/**
 * Who gets which email at a customer (lib/customerEmails.ts), from the portal's Settings (their own account) and the
 * shop's customer page (staff, any customer). The same component for both (components/EmailPrefs.tsx).
 */
type R<T> = ({ ok: true } & T) | { ok: false; error: string };
async function who(customerId: string) {
  const v = await getViewer();
  if (!v.user) throw new Error("Please sign in again.");
  const admin = createAdminClient();
  if (!v.isStaff) {
    // a customer: only an account they're on (row security decides)
    const { data } = await v.supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (!data) throw new Error("We couldn't find your account.");
  }
  return { admin, staff: v.isStaff, role: v.role };
}

export async function loadEmailPrefs(customerId: string): Promise<R<{ people: EmailPerson[]; prefs: EmailPrefs; auto: boolean; owner: boolean }>> {
  try {
    const { admin, staff, role } = await who(customerId);
    const { peopleOf, autoEmailsOn } = await import("@/lib/customerEmailServer");
    const [{ people, prefs }, auto] = await Promise.all([peopleOf(admin, customerId), autoEmailsOn(admin)]);
    return { ok: true, people, prefs, auto, owner: staff && role === "owner" };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't load your email settings." }; }
}

export async function saveEmailPrefs(customerId: string, prefs: EmailPrefs): Promise<R<{ prefs: EmailPrefs }>> {
  try {
    const { admin, staff } = await who(customerId);
    const v = await getViewer();
    if (!staff && v.isStaff) return { ok: false, error: "This is a preview." };
    const { peopleOf } = await import("@/lib/customerEmailServer");
    const { people } = await peopleOf(admin, customerId);
    const clean = cleanPrefs(prefs, people);
    // the older Messages switch follows (other places still read it)
    const { error } = await admin.from("customers").update({ email_prefs: clean, message_email: kindOn(clean, "messages") }).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/settings");
    return { ok: true, prefs: clean };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/** the shop's switch for automatic customer emails (owner only): off until Nick says go */
export async function setAutoEmails(on: boolean): Promise<R<{ auto: boolean }>> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff || v.role !== "owner") return { ok: false, error: "Only the owner can turn these on." };
    const admin = createAdminClient();
    const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const d = ((data as { data?: Record<string, unknown> } | null)?.data || {}) as Record<string, unknown>;
    const { error } = await admin.from("settings").update({ data: { ...d, customerEmails: { ...((d.customerEmails as object) || {}), auto: on, by: v.email, at: new Date().toISOString() } } }).eq("id", 1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, auto: on };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}
