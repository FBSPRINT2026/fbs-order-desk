import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import type { MailAccount } from "@/lib/mail/config";
import { runAccount } from "@/lib/mail/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read new mail in every connected staff mailbox (Inbox + Sent Items), longest-waiting first, until the minute is
 * nearly up. Called every 2 minutes by the database schedule (mail_sync_tick, migration 107) with the sync token.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const deadline = Date.now() + 48000, cutoff = new Date(Date.now() - 15 * 60000).toISOString();
  const { data } = await admin.from("mail_accounts").select("*").eq("enabled", true).or(`last_error_at.is.null,last_error_at.lt.${cutoff}`).order("last_run_at", { ascending: true, nullsFirst: true });
  const out: Record<string, unknown> = {};
  for (const a of (data || []) as MailAccount[]) {
    if (Date.now() > deadline - 8000) break;
    out[a.email] = await runAccount(admin, a, Math.min(deadline, Date.now() + 30000));
  }
  return NextResponse.json({ ok: true, mailboxes: out });
}
