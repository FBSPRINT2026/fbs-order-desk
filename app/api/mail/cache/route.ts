import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import type { MailAccount } from "@/lib/mail/config";
import { cacheAccount } from "@/lib/mail/cache";
import { inboxSig, writeBrief } from "@/lib/mail/brief";
import { organizerFor } from "@/lib/mail/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Email cached mode: keep the last 45 days of each connected mailbox in mail_cache (lib/mail/cache.ts). Called every
 * 2 minutes (odd minutes) by the database schedule (mail_cache_tick, migration 129) with the sync token.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const deadline = Date.now() + 50000, cutoff = new Date(Date.now() - 15 * 60000).toISOString();
  const { data } = await admin.from("mail_accounts").select("*").eq("enabled", true).or(`last_error_at.is.null,last_error_at.lt.${cutoff}`).order("last_run_at", { ascending: true, nullsFirst: true });
  const out: Record<string, unknown> = {};
  const accts = (data || []) as MailAccount[];
  for (const a of accts) {
    if (Date.now() > deadline - 5000) break;
    // the Inbox summary, rewritten ahead of time when the Inbox changed (at most every 5 minutes), for the owners
    try {
      const { data: who } = await admin.from("staff").select("name, role").eq("email", a.email.toLowerCase()).maybeSingle();
      if (organizerFor(a.email, String(who?.role || ""))) {
        const [sig, { data: kept }] = await Promise.all([inboxSig(admin, a.id), admin.from("mail_brief").select("sig, at").eq("account_id", a.id).maybeSingle()]);
        if (!kept || (kept.sig !== sig && Date.parse(kept.at as string) < Date.now() - 5 * 60000)) {
          const r = await writeBrief(admin, a, a.email.toLowerCase(), String(who?.name || "").split(/\s+/)[0] || a.name.split(/\s+/)[0] || "");
          out[`${a.email} summary`] = r.ok ? "written" : r.error;
        }
      }
    } catch (e) { out[`${a.email} summary`] = e instanceof Error ? e.message : String(e); }
    try { out[a.email] = await cacheAccount(admin, a, Math.min(deadline, Date.now() + Math.max(15000, (deadline - Date.now()) / accts.length))); }
    catch (e) { out[a.email] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return NextResponse.json({ ok: true, mailboxes: out });
}
