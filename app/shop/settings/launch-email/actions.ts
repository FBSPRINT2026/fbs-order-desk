"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, siteUrl } from "@/lib/email";
import { accountForUser, cfgOf } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";

/**
 * The portal launch email: a test copy to the signed-in owner only, from their own mailbox (the one connected in the
 * Inbox), else the site's email service. Nothing goes to customers from here.
 */
export async function sendLaunchTest(): Promise<{ ok: boolean; to?: string; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can send this." };
  const site = siteUrl();
  const first = String(v.user.user_metadata?.full_name || v.user.user_metadata?.name || "").split(/\s+/)[0] || "";
  const subject = `[Test] ${LAUNCH_SUBJECT}`;
  const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: first });
  const text = `It's here: your new FBS Print customer portal.\n\nYour login is already set up.\n1. Go to ${site}/portal\n2. Enter your email\n3. Type the 6-digit code we email you\n`;
  let why = "";
  try {
    const own = await accountForUser(createAdminClient(), v.user.id);
    if (own?.enabled) { await sendFromMailbox(cfgOf(own), { to: v.email, subject, text, html }); return { ok: true, to: v.email }; }
  } catch (e) { why = e instanceof Error ? e.message : String(e); }
  if (await sendEmail({ to: v.email, subject, html })) return { ok: true, to: v.email };
  return { ok: false, error: why || "Couldn't send it: connect your email in the Inbox, or check the email service in Settings → Connections." };
}
