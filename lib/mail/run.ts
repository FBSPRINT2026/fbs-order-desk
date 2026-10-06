import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailAccount } from "./config";
import { syncAccount } from "./imap";

/** one mailbox's read, with its lock, its daily tallies and a plain-English error when it fails */
export async function runAccount(admin: SupabaseClient, a: MailAccount, deadline: number) {
  const { data: got } = await admin.rpc("mail_account_claim", { p_id: a.id, p_seconds: 58 });
  if (!got) return { busy: true };
  const now = new Date().toISOString();
  try {
    const tally = await syncAccount(admin, a, deadline);
    const day = now.slice(0, 10), today = { ...((a.stats || {})[day] || {}) };
    for (const [k, v] of Object.entries(tally)) today[k] = (today[k] || 0) + v;
    await admin.from("mail_accounts").update({ last_run_at: now, last_ok_at: new Date().toISOString(), last_error: null, last_error_at: null, running_until: null, stats: { [day]: today } }).eq("id", a.id);
    return { ok: true, tally };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = /auth|login|credential|password|LOGIN failed|NO /i.test(msg) ? `The mailbox refused the sign-in. Check the password (reconnect it), and that IMAP is on for this mailbox in HostPilot. (${msg})`
      : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg) ? `Couldn't reach the mail server ${a.imap_host}. Check the server name in HostPilot (east or west site). (${msg})` : msg;
    await admin.from("mail_accounts").update({ last_run_at: now, last_error: friendly.slice(0, 500), last_error_at: now, running_until: null }).eq("id", a.id);
    return { error: friendly };
  }
}
