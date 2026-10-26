"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmailWhy } from "@/lib/email";
import { forgetSiteEmail, siteFrom, type SiteEmail } from "@/lib/siteEmail";
import { DEFAULT_MAIL_HOST, encryptSecret } from "@/lib/mail/config";
import { checkSending } from "@/lib/mail/send";

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
  const r = await sendEmailWhy({ to: me.email, subject: "[Test] FBS Print site email", html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#141D2B;padding:16px">This came from <b>${(await siteFrom()).replace(/</g, "&lt;")}</b>, the address the portal sends from. Reply to it to check where replies go.</div>` });
  return r.ok ? { ok: true, to: me.email, from: r.from } : { ok: false, from: r.from, error: `Not sent from ${r.from}. ${r.why || ""}`.trim() };
}

/** the portal mailbox: connected or not (never the password) */
export async function siteMailboxStatus(): Promise<{ connected: boolean; email?: string; host?: string; okAt?: string | null }> {
  const me = await getViewer();
  if (me.role !== "owner") return { connected: false };
  const { data } = await createAdminClient().from("site_mailbox").select("email, smtp_host, ok_at").eq("id", 1).maybeSingle();
  return data ? { connected: true, email: String(data.email), host: String(data.smtp_host), okAt: (data.ok_at as string | null) || null } : { connected: false };
}

/**
 * Connect the site's own mailbox to send through (owner only). The owner types its password here; it's checked by signing
 * in to the mail server (nothing is sent), then kept encrypted like a staff mailbox. It never comes back to the page.
 */
export async function connectSiteMailbox(email: string, password: string, host: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getViewer();
  if (me.role !== "owner") return { ok: false, error: "Only the owner can connect it." };
  const e = email.trim().toLowerCase(), h = (host || DEFAULT_MAIL_HOST).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) || !password) return { ok: false, error: "Type the mailbox address and its password." };
  const problem = await checkSending({ user: e, pass: password, imapHost: h, smtpHost: h, imapPort: 993, smtpPort: 587, fromName: "FBS Print" });
  if (problem) return { ok: false, error: problem.replace(/Your mailbox/i, "That mailbox").replace(/→ your name →/, "→ the portal mailbox →") };
  const { error } = await createAdminClient().from("site_mailbox").upsert({ id: 1, email: e, smtp_host: h, enc_password: encryptSecret(password), ok_at: new Date().toISOString(), last_error: null, updated_by: me.email, updated_at: new Date().toISOString() });
  forgetSiteEmail();
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function disconnectSiteMailbox(): Promise<{ ok: boolean }> {
  const me = await getViewer();
  if (me.role !== "owner") return { ok: false };
  await createAdminClient().from("site_mailbox").delete().eq("id", 1);
  forgetSiteEmail();
  return { ok: true };
}
