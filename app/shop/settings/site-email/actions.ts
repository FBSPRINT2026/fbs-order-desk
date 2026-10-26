"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { forgetSiteEmail, siteFrom, type SiteEmail } from "@/lib/siteEmail";

const ok = (e: string) => !e || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

/** Save the site's email (owner only): name, from address, replies to. Only data.siteEmail changes in settings. */
export async function saveSiteEmail(v: SiteEmail): Promise<{ ok: boolean; error?: string }> {
  const me = await getViewer();
  if (me.role !== "owner") return { ok: false, error: "Only the owner can change this." };
  const clean: SiteEmail = { fromName: (v.fromName || "").trim().slice(0, 80), fromAddress: (v.fromAddress || "").trim().toLowerCase(), replyTo: (v.replyTo || "").trim().toLowerCase() };
  if (!ok(clean.fromAddress || "") || !ok(clean.replyTo || "")) return { ok: false, error: "That doesn't look like an email address." };
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const cur = (data?.data || {}) as Record<string, unknown>;
  const { error } = await admin.from("settings").update({ data: { ...cur, siteEmail: clean } }).eq("id", 1);
  forgetSiteEmail();
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** A test from the site's address to the signed-in owner only */
export async function testSiteEmail(): Promise<{ ok: boolean; to?: string; from?: string; error?: string }> {
  const me = await getViewer();
  if (me.role !== "owner" || !me.email) return { ok: false, error: "Only the owner can send this." };
  const from = await siteFrom();
  const sent = await sendEmail({ to: me.email, subject: "[Test] FBS Print site email", html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#141D2B;padding:16px">This came from <b>${from.replace(/</g, "&lt;")}</b>, the address the portal sends from. Reply to it to check where replies go.</div>` });
  return sent ? { ok: true, to: me.email, from } : { ok: false, from, error: "The email service didn't send it. Check that the address's domain is verified with the email service (Brevo or Resend)." };
}
