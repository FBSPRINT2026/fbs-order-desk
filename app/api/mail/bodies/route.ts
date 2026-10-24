import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MailAccount } from "@/lib/mail/config";
import { fixBodiesEws, fixBodiesSlow } from "@/lib/mail/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Emails kept without a body (big ones the cache run couldn't wait for), read with all the time they need: every 5
 * minutes by the database schedule (mail_bodies_tick, migration 139) with the sync token. Skips a mailbox whose mail
 * check is running (the server only allows a couple of connections).
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  // answer at once and do the work after (Oct 14): the database's scheduler waits for each answer before it sends the
  // next jobs, so a 4-minute answer held up the mail check, the Printavo sync and the away alerts behind it
  after(() => work(admin));
  return NextResponse.json({ ok: true, started: true });
}

async function work(admin: ReturnType<typeof createAdminClient>) {
  const deadline = Date.now() + 240000;
  // customer emails that read as orders: worked out in the background so they're ready to approve (Oct 20, Nick)
  // Inbox email from customers that was never kept as a customer email (Oct 24): kept and linked now
  try { const { linkCustomerInbox } = await import("@/lib/mail/mirror"); console.info(`inbox customer emails linked ${await linkCustomerInbox(admin, Date.now() + 60000)}`); } catch (e) { console.warn("link customer inbox", e); }
  try { const { sortWaiting } = await import("@/lib/mail/mirror"); console.info(`inbox sorted ${JSON.stringify(await sortWaiting(admin, Date.now() + 60000))}`); } catch (e) { console.warn("sort waiting", e); }
  try { const { prepareOrders } = await import("@/lib/ai/prepareOrders"); console.info(`orders prepared ${JSON.stringify(await prepareOrders(admin, Date.now() + 150000))}`); } catch (e) { console.warn("prepare orders", e); }
  const { data } = await admin.from("mail_accounts").select("*").eq("enabled", true);
  const out: Record<string, unknown> = {};
  for (const a of (data || []) as MailAccount[]) {
    if (Date.now() > deadline - 40000) break;
    const { count } = await admin.from("mail_cache").select("id", { count: "exact", head: true }).eq("account_id", a.id).is("gone_at", null).is("body_html", null).is("body_fixed_at", null).lt("body_tries", 6).or("body_text.is.null,body_text.eq.,size.gt.200000");
    const t0 = Date.now();
    // a mailbox EWS didn't work for: check again (it switches over by itself once EWS is turned on)
    try { const { recheckEws } = await import("@/lib/mail/ewsBox"); await recheckEws(admin, a); } catch { /* next time */ }
    // over EWS first (several a minute); the mailbox connection only for what EWS can't do
    if (count) try { for (let i = 0; i < 8 && Date.now() < deadline - 60000; i++) await fixBodiesEws(admin, a, Date.now() + 20000); } catch { /* falls through to IMAP */ }
    const { data: k } = await admin.from("app_keys").select("value").eq("name", "ews").maybeSingle();
    const ewsOk = !!(k?.value as Record<string, { ok: boolean }> | null)?.[a.email.toLowerCase()]?.ok;
    // the mailbox connection: the header index for Search older mail (every mailbox), and bodies EWS couldn't do
    try { const idx = await fixBodiesSlow(admin, a, Math.min(deadline, Date.now() + 100000), ewsOk); out[a.email] = { waiting: count, ews: ewsOk, index: idx, ms: Date.now() - t0 }; }
    catch (e) { out[a.email] = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }; }
  }
  console.info(`mail bodies ${JSON.stringify(out)}`);
}
