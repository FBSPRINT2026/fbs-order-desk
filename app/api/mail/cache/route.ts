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
  // well inside the 60-second limit (Oct 12: runs cut off by the limit left mailbox connections open)
  const deadline = Date.now() + 42000, cutoff = new Date(Date.now() - 15 * 60000).toISOString();
  const { data } = await admin.from("mail_accounts").select("*").eq("enabled", true).or(`last_error_at.is.null,last_error_at.lt.${cutoff}`).order("last_run_at", { ascending: true, nullsFirst: true });
  const out: Record<string, unknown> = {};
  const all = (data || []) as MailAccount[];
  // take turns on who goes first (Oct 12: one mailbox used the whole minute and a newly connected one never got a turn)
  const k = all.length ? Math.floor(Date.now() / 120000) % all.length : 0;
  const accts = [...all.slice(k), ...all.slice(0, k)];
  // the Inbox summaries (AI, no mailbox connection) run alongside the caching instead of before it
  const summaries = Promise.all(accts.map(async (a) => {
    try {
      const { data: who } = await admin.from("staff").select("name, role").eq("email", a.email.toLowerCase()).maybeSingle();
      if (!organizerFor(a.email, String(who?.role || ""))) return;
      const [sig, { data: kept }] = await Promise.all([inboxSig(admin, a.id), admin.from("mail_brief").select("sig, at").eq("account_id", a.id).maybeSingle()]);
      if (!kept || (kept.sig !== sig && Date.parse(kept.at as string) < Date.now() - 5 * 60000)) {
        const r = await writeBrief(admin, a, a.email.toLowerCase(), String(who?.name || "").split(/\s+/)[0] || a.name.split(/\s+/)[0] || "");
        out[`${a.email} summary`] = r.ok ? "written" : r.error;
      }
    } catch (e) { out[`${a.email} summary`] = e instanceof Error ? e.message : String(e); }
  }));
  for (let i = 0; i < accts.length; i++) {
    const a = accts[i];
    if (Date.now() > deadline - 5000) { out[a.email] = "next time"; continue; }
    // the mail check has this mailbox right now: not both at once (two connections at a time is what the server allows)
    const busyUntil = (a as MailAccount & { running_until?: string | null }).running_until;
    if (busyUntil && Date.parse(busyUntil) > Date.now()) { out[a.email] = "mail check running"; continue; }
    // an equal share of what's left for each mailbox still to go
    const share = Math.max(12000, (deadline - Date.now()) / (accts.length - i));
    try { out[a.email] = await cacheAccount(admin, a, Math.min(deadline, Date.now() + share)); }
    catch (e) { out[a.email] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  await Promise.race([summaries, new Promise((r) => setTimeout(r, Math.max(0, deadline + 4000 - Date.now())))]);
  return NextResponse.json({ ok: true, mailboxes: out });
}
