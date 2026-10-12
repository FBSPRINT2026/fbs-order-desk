"use server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushTo, vapidKeys } from "@/lib/push";
import { organizerFor } from "@/lib/mail/mirror";

/**
 * Alerts & Away mode (Oct 12): Away mode on/off, phone alerts on this device, which alerts a person gets, and what
 * was sent. Everyone on staff can use Away mode and phone alerts; the Job watcher's to-dos go to the owners.
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const admin = createAdminClient();
  // viewing as someone: theirs, read only
  let email = v.email.toLowerCase(), viewing = false;
  if (v.role === "owner") {
    const want = ((await cookies()).get("fbs_view_as")?.value || "").toLowerCase();
    if (want.includes("@") && want !== email) { email = want; viewing = true; }
  }
  return { v, admin, email, viewing };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const VIEW_NO = "You're viewing as someone else: switch back to change their alerts.";

export type AlertRow = { id: string; kind: string; title: string; body: string; url: string; created_at: string; pushed_at: string | null; push_result: string | null };
export type AlertState = { away: boolean; awaySince: string | null; jobs: boolean; jobsFor: boolean; key: string; devices: { id: string; device: string; created_at: string; last_ok_at: string | null; last_error: string | null; endpoint: string }[]; recent: AlertRow[]; viewing: boolean; name: string };

export async function getAlerts() {
  try {
    const { admin, email, viewing } = await me();
    const [{ data: s }, { data: subs }, { data: al }, keys] = await Promise.all([
      admin.from("staff").select("name, role, away_on, away_since, alerts").ilike("email", email).maybeSingle(),
      admin.from("push_subs").select("id, device, created_at, last_ok_at, last_error, endpoint").eq("email", email).order("created_at", { ascending: false }),
      admin.from("alerts").select("id, kind, title, body, url, created_at, pushed_at, push_result").eq("owner", email).order("created_at", { ascending: false }).limit(40),
      vapidKeys(admin),
    ]);
    const prefs = (s?.alerts || {}) as { jobs?: boolean };
    const st: AlertState = {
      away: !!s?.away_on, awaySince: (s?.away_since as string) || null, jobsFor: organizerFor(email, String(s?.role || "")), jobs: prefs.jobs !== false,
      key: keys.publicKey, devices: (subs || []) as AlertState["devices"], recent: (al || []) as AlertRow[], viewing, name: String(s?.name || email.split("@")[0]),
    };
    return { ok: true as const, ...st };
  } catch (e) { return fail(e); }
}

export async function setAway(on: boolean) {
  try {
    const { admin, email, viewing } = await me();
    if (viewing) return { ok: false as const, error: VIEW_NO };
    await admin.from("staff").update({ away_on: on, away_since: on ? new Date().toISOString() : null }).ilike("email", email);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function setAlertPref(k: "jobs", on: boolean) {
  try {
    const { admin, email, viewing } = await me();
    if (viewing) return { ok: false as const, error: VIEW_NO };
    const { data: s } = await admin.from("staff").select("alerts").ilike("email", email).maybeSingle();
    await admin.from("staff").update({ alerts: { ...((s?.alerts as object) || {}), [k]: on } }).ilike("email", email);
    // turned off: the Job watcher's open to-dos go away
    if (k === "jobs" && !on) await admin.from("tasks").update({ status: "done", done_at: new Date().toISOString(), done_by: "Job watcher: turned off" }).eq("owner", email).eq("source", "jobs").eq("status", "open");
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** this browser's push subscription (from PushManager.subscribe) */
export async function savePushSub(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string) {
  try {
    const { admin, email, viewing } = await me();
    if (viewing) return { ok: false as const, error: VIEW_NO };
    if (!/^https:\/\//.test(sub?.endpoint || "") || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false as const, error: "That browser didn't give a usable subscription." };
    const { error } = await admin.from("push_subs").upsert({ email, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device.slice(0, 80), last_error: null }, { onConflict: "endpoint" });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function removePushSub(id: string) {
  try {
    const { admin, email, viewing } = await me();
    if (viewing) return { ok: false as const, error: VIEW_NO };
    await admin.from("push_subs").delete().eq("id", id).eq("email", email);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function testPush() {
  try {
    const { admin, email, viewing } = await me();
    if (viewing) return { ok: false as const, error: VIEW_NO };
    const r = await pushTo(admin, email, { title: "Alerts are on", body: "This is how something urgent will show up. Tap to open the portal.", url: "/shop/alerts", tag: "test" });
    if (!r.devices) return { ok: false as const, error: "No phone or computer has alerts turned on yet." };
    if (!r.sent) return { ok: false as const, error: `The notification service said no: ${r.errors[0] || "unknown"}` };
    return { ok: true as const, sent: r.sent };
  } catch (e) { return fail(e); }
}

export async function markAlertsSeen() {
  try {
    const { admin, email, viewing } = await me();
    if (!viewing) await admin.from("alerts").update({ seen_at: new Date().toISOString() }).eq("owner", email).is("seen_at", null);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
