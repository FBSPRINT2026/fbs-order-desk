import "server-only";
import { EMAIL_FROM } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/mail/config";

/**
 * The site's own email address (Oct 26, Nick: "set up an email just for the site's communication… portal@fbsprint.com…
 * it shouldn't be my address… add a little section to the settings page… set the email where you're… sending from").
 * Kept in settings (row 1, data.siteEmail): the name and address emails come from, and where replies go. No passwords:
 * the sending service's key stays in Vercel. Unset, the EMAIL_FROM env value is used as before.
 */
export type SiteEmail = { fromName?: string; fromAddress?: string; replyTo?: string };

let cache: { at: number; v: SiteEmail } | null = null;
export async function siteEmail(): Promise<SiteEmail> {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  try {
    const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
    const v = ((data?.data as { siteEmail?: SiteEmail } | null)?.siteEmail || {}) as SiteEmail;
    cache = { at: Date.now(), v };
    return v;
  } catch { return {}; }
}
export const forgetSiteEmail = () => { cache = null; box = null; };

/** the site's own mailbox to send through (site_mailbox), with its password decrypted; null when not connected */
let box: { at: number; v: { email: string; host: string; pass: string } | null } | null = null;
export async function siteMailbox(): Promise<{ email: string; host: string; pass: string } | null> {
  if (box && Date.now() - box.at < 15_000) return box.v;
  let v: { email: string; host: string; pass: string } | null = null;
  try {
    const { data } = await createAdminClient().from("site_mailbox").select("email, smtp_host, enc_password").eq("id", 1).maybeSingle();
    if (data?.enc_password) v = { email: String(data.email), host: String(data.smtp_host), pass: decryptSecret(String(data.enc_password)) };
  } catch { v = null; }
  box = { at: Date.now(), v };
  return v;
}

/** "Name <address>": the settings when an address is set, else EMAIL_FROM */
export async function siteFrom(): Promise<string> {
  const s = await siteEmail();
  if (s.fromAddress && /@/.test(s.fromAddress)) return `${(s.fromName || "FBS Print").replace(/[<>"]/g, "")} <${s.fromAddress.trim()}>`;
  return EMAIL_FROM || "";
}
