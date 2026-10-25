"use server";
import { getViewer } from "@/lib/supabase/server";
import { sendEmail, siteUrl } from "@/lib/email";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";

/** The portal launch email: a test copy to the signed-in owner only. Nothing goes to customers from here. */
export async function sendLaunchTest(): Promise<{ ok: boolean; to?: string; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can send this." };
  const site = siteUrl();
  const first = String(v.user.user_metadata?.full_name || v.user.user_metadata?.name || "").split(/\s+/)[0] || "";
  const ok = await sendEmail({ to: v.email, subject: `[Test] ${LAUNCH_SUBJECT}`, html: launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: first }) });
  return ok ? { ok: true, to: v.email } : { ok: false, error: "The email service didn't take it. Check Settings → Connections." };
}
