import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { mailConfig } from "@/lib/mail/config";
import { syncMailbox } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read new mail in the shop mailbox (Inbox + Sent Items). Called every 2 minutes by the database schedule
 * (mail_sync_tick, migration 106) with the sync token, or by staff ("Check now").
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const c = mailConfig(), now = new Date().toISOString();
  if (!c.ready) {
    await admin.from("mail_sync").update({ last_run_at: now, last_error: "Not connected: add MAIL_PASSWORD (the mailbox password) in Vercel.", last_error_at: now }).eq("id", 1);
    return NextResponse.json({ error: "MAIL_PASSWORD isn't set" }, { status: 503 });
  }
  const { data: got } = await admin.rpc("mail_sync_claim", { p_seconds: 58 });
  if (!got) return NextResponse.json({ busy: true });
  try {
    const tally = await syncMailbox(admin, Date.now() + 45000);
    const { data: s } = await admin.from("mail_sync").select("stats").eq("id", 1).single();
    const day = now.slice(0, 10), prev = ((s?.stats || {}) as Record<string, Record<string, number>>);
    const today = { ...(prev[day] || {}) };
    for (const [k, v] of Object.entries(tally)) today[k] = (today[k] || 0) + v;
    await admin.from("mail_sync").update({ last_run_at: now, last_ok_at: new Date().toISOString(), last_error: null, last_error_at: null, running_until: null, stats: { [day]: today } }).eq("id", 1);
    return NextResponse.json({ ok: true, tally });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = /auth|login|credential|password/i.test(msg) ? `The mailbox refused the sign-in (${msg}). Check MAIL_PASSWORD, and that IMAP is on for the mailbox in HostPilot.` : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg) ? `Couldn't reach the mail server ${c.imapHost} (${msg}). Check MAIL_IMAP_HOST against HostPilot.` : msg;
    await admin.from("mail_sync").update({ last_run_at: now, last_error: friendly.slice(0, 500), last_error_at: now, running_until: null }).eq("id", 1);
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
