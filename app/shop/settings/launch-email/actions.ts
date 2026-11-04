"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendEmailWhy, siteUrl } from "@/lib/email";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";
import { siteFrom } from "@/lib/siteEmail";

/**
 * The portal launch email: a test copy (to the owner or one address they type), from the site's address like every
 * site email. Sending to customers is its own step below (sendLaunchBatch), owner only,
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
  // from the site's address like every site email (Oct 26, Nick: "all emails come from portal… the test email is still
  // coming from my address"): the portal mailbox when it's connected
  const r = await sendEmailWhy({ to, subject, html });
  return r.ok ? { ok: true, to } : { ok: false, error: `Not sent from ${r.from}. ${r.why || ""}`.trim() };
}

export type LaunchRecipient = { id: string; company: string; name: string; email: string; moved: boolean; sentAt: string | null; /** moved without the launch email (Customers → Move to the portal) */ quiet: boolean };

/** Customers it can go to: an email on file, not a test account; with when they last got it */
export async function listLaunchRecipients(): Promise<{ ok: boolean; rows?: LaunchRecipient[]; from?: string; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can see this." };
  const admin = createAdminClient();
  const rows: { id: string; company: string | null; name: string | null; email: string | null; is_test: boolean | null; moved_at: string | null; launch_quiet: boolean | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("customers").select("id, company, name, email, is_test, moved_at, launch_quiet").order("company").range(from, from + 999);
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
    rows: rows.filter((r) => !r.is_test && ok(String(r.email || "").trim())).map((r) => ({ id: r.id, company: String(r.company || "").trim(), name: String(r.name || "").trim(), email: String(r.email).trim().toLowerCase(), moved: !!r.moved_at, sentAt: last.get(r.id) || null, quiet: !!r.launch_quiet })),
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
  // one sender for this and the scheduled send (lib/launchSend.ts)
  const { sendLaunchTo } = await import("@/lib/launchSend");
  const r = await sendLaunchTo(createAdminClient(), ids.slice(0, 25), v.email || "");
  return { ok: true, ...r };
}
