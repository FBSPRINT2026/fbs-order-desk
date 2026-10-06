import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Each staff member connects their own mailbox (Intermedia hosted Exchange: IMAP 993 SSL, SMTP 587 STARTTLS; server
 * names from HostPilot → Exchange settings, east or west site). The password is stored encrypted in mail_accounts
 * (AES-256-GCM). The key comes from MAIL_ENCRYPTION_KEY when set, else from the server's Supabase secret, so nothing
 * extra has to be added in Vercel; mail_accounts has no client access at all.
 */
export const DEFAULT_MAIL_HOST = "east.exch021.serverdata.net";

function key() {
  const k = process.env.MAIL_ENCRYPTION_KEY || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!k) throw new Error("No server secret to encrypt mailbox passwords with.");
  return createHash("sha256").update(`fbs-mail:${k}`).digest();
}
export function encryptSecret(plain: string) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decryptSecret(s: string) {
  const [v, iv, tag, data] = s.split(":");
  if (v !== "v1") throw new Error("Unknown password format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export type MailAccount = {
  id: string; user_id: string; email: string; name: string; imap_host: string; smtp_host: string; enc_password: string; enabled: boolean;
  inbox_validity: number | null; inbox_uid: number | null; sent_folder: string | null; sent_validity: number | null; sent_uid: number | null;
  last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; stats: Record<string, Record<string, number>>;
  signature_html?: string | null; signature_css?: string | null; signature_on?: boolean; signature_at?: string | null; signature_checked_at?: string | null;
};
export type MailCfg = { user: string; pass: string; imapHost: string; smtpHost: string; imapPort: number; smtpPort: number; fromName: string };

export const cfgOf = (a: Pick<MailAccount, "email" | "name" | "imap_host" | "smtp_host" | "enc_password">): MailCfg => ({
  user: a.email, pass: decryptSecret(a.enc_password), imapHost: a.imap_host || DEFAULT_MAIL_HOST, smtpHost: a.smtp_host || a.imap_host || DEFAULT_MAIL_HOST,
  imapPort: 993, smtpPort: 587, fromName: a.name ? `${a.name} | FBS Print` : "FBS Print",
});

export async function accountById(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("mail_accounts").select("*").eq("id", id).maybeSingle();
  return (data as MailAccount | null) || null;
}
export async function accountForUser(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("mail_accounts").select("*").eq("user_id", userId).maybeSingle();
  return (data as MailAccount | null) || null;
}
/** strip the secret before anything goes to a browser */
export const publicAccount = (a: MailAccount) => ({ id: a.id, email: a.email, name: a.name, imap_host: a.imap_host, smtp_host: a.smtp_host, enabled: a.enabled, last_run_at: a.last_run_at, last_ok_at: a.last_ok_at, last_error: a.last_error, stats: a.stats });
