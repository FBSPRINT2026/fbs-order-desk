import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MailAccount } from "@/lib/mail/config";
import { ewsFolders, ewsList, ewsOpen, ewsReady, ewsSearch } from "@/lib/mail/ewsBox";
import { ewsProbe, forceNtlm } from "@/lib/mail/ews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EWS health check (sync token only): for each mailbox, whether EWS works and how long the folder list, the Inbox,
 * Sent Items and a search take. Counts and times only — no email content.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const term = new URL(req.url).searchParams.get("q") || "fbs";
  const { data } = await admin.from("mail_accounts").select("*").eq("enabled", true);
  const out: Record<string, unknown> = {};
  // ?ntlm=<email>: sign that mailbox in with NTLM only and report (checks the NTLM sign-in on a mailbox Basic works for)
  const ntlmFor = new URL(req.url).searchParams.get("ntlm");
  if (ntlmFor) {
    const a = ((data || []) as MailAccount[]).find((x) => x.email.toLowerCase() === ntlmFor.toLowerCase());
    if (!a) return NextResponse.json({ error: "No such mailbox" });
    forceNtlm(a.email);
    const r = await ewsProbe(a);
    forceNtlm(a.email, false);
    return NextResponse.json({ [a.email]: { ntlm: r } });
  }
  for (const a of (data || []) as MailAccount[]) {
    const me = a.email.toLowerCase(), r: Record<string, unknown> = {};
    if (!(await ewsReady(admin, a))) { out[me] = "EWS not working for this mailbox"; continue; }
    const time = async (k: string, fn: () => Promise<unknown>) => { const t0 = Date.now(); try { r[k] = { ...(await fn() as object), ms: Date.now() - t0 }; } catch (e) { r[k] = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }; } };
    await time("folders", async () => { const f = await ewsFolders(a); return { count: f.length, special: f.filter((x) => x.special).map((x) => `${x.path} ${x.special} ${x.messages}`) }; });
    await time("inbox", async () => { const l = await ewsList(admin, a, me, "INBOX"); return { rows: l.rows.length, more: l.more, newest: l.rows[0]?.date || null, seenFlags: l.rows.filter((x) => !x.seen).length }; });
    let first: { path: string; uid: number } | null = null;
    await time("sent", async () => { const l = await ewsList(admin, a, me, "Sent Items"); if (l.rows[0]) first = { path: "Sent Items", uid: l.rows[0].uid }; return { rows: l.rows.length, fromMe: l.rows.filter((x) => x.sent).length }; });
    // open one (a sent one: already read, so nothing changes)
    await time("open", async () => { if (!first) return { skipped: true }; const o = await ewsOpen(admin, a, first.path, first.uid, (id) => id); return { found: !!o, html: o?.html.length || 0, attachments: o?.attachments.length || 0, to: (o?.to || "").includes("@") }; });
    await time("search", async () => { const s = await ewsSearch(admin, a, me, term); return { convos: s.convos.length, folders: s.folders, partial: s.partial, oldest: s.convos.map((c) => c.last).sort()[0] || null }; });
    out[me] = r;
  }
  return NextResponse.json(out);
}
