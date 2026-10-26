"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, siteUrl } from "@/lib/email";
import { accountForUser, cfgOf } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";
import { siteFrom } from "@/lib/siteEmail";

/**
 * The portal launch email: a test copy to the signed-in owner only, from their own mailbox (the one connected in the
 * Inbox), else the site's email service. Sending to customers is its own step below (sendLaunchBatch), owner only,
 * picked customer by customer.
 */
/** a test copy: to you, or to any one address you type (Oct 26, Nick: "send it to Amanda just to see how it shows on her phone") */
export async function sendLaunchTest(company = "", toAddr = ""): Promise<{ ok: boolean; to?: string; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can send this." };
  const to = (toAddr || v.email || "").trim().toLowerCase();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) return { ok: false, error: "Type one email address." };
  const site = siteUrl();
  const first = String(v.user.user_metadata?.full_name || v.user.user_metadata?.name || "").split(/\s+/)[0] || "";
  const subject = `[Test] ${LAUNCH_SUBJECT}`;
  const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: first, company: company.trim().slice(0, 42) || undefined });
  const text = `It's here: your new FBS Print customer portal.\n\nYour login is already set up.\n1. Go to ${site}/portal\n2. Enter your email\n3. Type the 6-digit code we email you\n`;
  let why = "";
  try {
    const own = await accountForUser(createAdminClient(), v.user.id);
    if (own?.enabled) { await sendFromMailbox(cfgOf(own), { to, subject, text, html }); return { ok: true, to }; }
  } catch (e) { why = e instanceof Error ? e.message : String(e); }
  if (await sendEmail({ to, subject, html })) return { ok: true, to };
  return { ok: false, error: why || "Couldn't send it: connect your email in the Inbox, or check the email service in Settings → Connections." };
}

export type LaunchRecipient = { id: string; company: string; name: string; email: string; moved: boolean; sentAt: string | null };

/** Customers it can go to: an email on file, not a test account; with when they last got it */
export async function listLaunchRecipients(): Promise<{ ok: boolean; rows?: LaunchRecipient[]; from?: string; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can see this." };
  const admin = createAdminClient();
  const rows: { id: string; company: string | null; name: string | null; email: string | null; is_test: boolean | null; moved_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("customers").select("id, company, name, email, is_test, moved_at").order("company").range(from, from + 999);
    if (error) return { ok: false, error: error.message };
    rows.push(...((data || []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const { data: sent } = await admin.from("launch_email_sends").select("customer_id, sent_at").eq("ok", true).order("sent_at", { ascending: false });
  const last = new Map<string, string>();
  for (const r of (sent || []) as { customer_id: string | null; sent_at: string }[]) if (r.customer_id && !last.has(r.customer_id)) last.set(r.customer_id, r.sent_at);
  const ok = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
  return {
    ok: true, from: await siteFrom(),
    rows: rows.filter((r) => !r.is_test && ok(String(r.email || "").trim())).map((r) => ({ id: r.id, company: String(r.company || "").trim(), name: String(r.name || "").trim(), email: String(r.email).trim().toLowerCase(), moved: !!r.moved_at, sentAt: last.get(r.id) || null })),
  };
}

/**
 * Send the launch email to these customers (owner only; the page sends a few at a time). Each copy has their first name
 * and their company in the portal picture ("Your Company" when there's none); it goes from the site's address (Settings →
 * Connections → Site email). Every send is written down, so the list shows who already has it.
 */
export async function sendLaunchBatch(ids: string[]): Promise<{ ok: boolean; sent: number; failed: { email: string; why: string }[]; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, sent: 0, failed: [], error: "Only the owner can send this." };
  const admin = createAdminClient();
  const { data } = await admin.from("customers").select("id, company, name, email, is_test").in("id", ids.slice(0, 25));
  const site = siteUrl();
  let sent = 0; const failed: { email: string; why: string }[] = [];
  for (const c of (data || []) as { id: string; company: string | null; name: string | null; email: string | null; is_test: boolean | null }[]) {
    const to = String(c.email || "").trim().toLowerCase();
    if (!to || c.is_test) continue;
    const first = String(c.name || "").trim().split(/\s+/)[0] || "";
    const company = String(c.company || "").trim();
    const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: first, company: company || undefined });
    let ok = false, why = "";
    try { ok = await sendEmail({ to, subject: LAUNCH_SUBJECT, html }); if (!ok) why = "The email service didn't take it."; } catch (e) { why = e instanceof Error ? e.message : String(e); }
    await admin.from("launch_email_sends").insert({ customer_id: c.id, email: to, company: company || null, ok, error: ok ? null : why.slice(0, 300), sent_by: v.email });
    if (ok) sent++; else failed.push({ email: to, why });
  }
  return { ok: true, sent, failed };
}
