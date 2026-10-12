import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountForUser, type MailAccount } from "./config";

/**
 * "View as" a person (owners, Oct 12, Nick: "when I go to her inbox under her view, it still shows my emails"): Email
 * shows their mailbox, read only. Reading (lists, emails, folders, search) uses theirs; sending, moving and settings
 * are refused while viewing as someone else, so nothing goes out from their account by accident.
 */
export async function viewedEmail(v: { role?: string; email?: string }) {
  if (v.role !== "owner") return null;
  const want = ((await cookies()).get("fbs_view_as")?.value || "").toLowerCase();
  return want.includes("@") && want !== (v.email || "").toLowerCase() ? want : null;
}

/** the mailbox to read: yours, or the person's you're viewing as (null when they haven't connected one) */
export async function mailboxToRead(admin: SupabaseClient, v: { role?: string; email?: string; user: { id: string } | null }): Promise<{ acct: MailAccount | null; viewing: string | null }> {
  const viewing = await viewedEmail(v);
  if (viewing) {
    const { data } = await admin.from("mail_accounts").select("*").ilike("email", viewing).maybeSingle();
    return { acct: (data as MailAccount | null) || null, viewing };
  }
  return { acct: v.user ? await accountForUser(admin, v.user.id) : null, viewing: null };
}

export const VIEWING_NO = "You're viewing as someone else. Go back to your view to send or move email.";
