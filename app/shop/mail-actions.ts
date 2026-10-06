"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountById, accountForUser, cfgOf, DEFAULT_MAIL_HOST, encryptSecret, publicAccount, type MailAccount } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { imapClient } from "@/lib/mail/imap";
import { closeAnswered } from "@/lib/mail/process";
import { runAccount } from "@/lib/mail/run";

// Staff actions for the mailboxes: connect your own, reply from the mailbox an email came to, sort a sender, check now.

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return { ...v, admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

/** your mailbox (and, for owners and admins, everyone's connection status) */
export async function getMailStatus() {
  try {
    const { admin, user, role } = await staff();
    const mine = await accountForUser(admin, user!.id);
    let all: ReturnType<typeof publicAccount>[] = [];
    if (role === "owner" || role === "admin") { const { data } = await admin.from("mail_accounts").select("*").order("email"); all = ((data || []) as MailAccount[]).map(publicAccount); }
    return { ok: true as const, mine: mine ? publicAccount(mine) : null, all, defaultHost: DEFAULT_MAIL_HOST, myEmail: user!.email || "" };
  } catch (e) { return fail(e); }
}

/** connect (or reconnect) your own mailbox: the sign-in is tested first, then the password is stored encrypted */
export async function connectMailbox(input: { email: string; password: string; name: string; host: string }) {
  try {
    const { admin, user } = await staff();
    const email = input.email.trim().toLowerCase(), host = (input.host || DEFAULT_MAIL_HOST).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, error: "Enter your full email address." };
    if (!input.password) return { ok: false as const, error: "Enter your email password." };
    const client = imapClient({ user: email, pass: input.password, imapHost: host, smtpHost: host, imapPort: 993, smtpPort: 587, fromName: "" });
    try { await client.connect(); await client.logout().catch(() => null); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); return { ok: false as const, error: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m) ? `Couldn't reach ${host}. Check the server name in HostPilot (Exchange settings, your site's "Incoming mail").` : `Your mailbox didn't accept that sign-in. Check the password, and that IMAP is ticked for your mailbox in HostPilot. (${m})` }; }
    const row = { user_id: user!.id, email, name: input.name.trim().slice(0, 80), imap_host: host, smtp_host: host, enc_password: encryptSecret(input.password), enabled: true, last_error: null, last_error_at: null, updated_at: new Date().toISOString() };
    const existing = await accountForUser(admin, user!.id);
    const { error } = existing
      ? await admin.from("mail_accounts").update({ ...row, ...(existing.email !== email ? { inbox_validity: null, inbox_uid: null, sent_folder: null, sent_validity: null, sent_uid: null } : {}) }).eq("id", existing.id)
      : await admin.from("mail_accounts").insert(row);
    if (error) return { ok: false as const, error: /duplicate|unique/i.test(error.message) ? "Someone else already connected that mailbox." : error.message };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** stop reading your mailbox (the connection and stored password are removed; email already on file stays) */
export async function disconnectMailbox() {
  try {
    const { admin, user } = await staff();
    const a = await accountForUser(admin, user!.id);
    if (a) await admin.from("mail_accounts").update({ enabled: false, enc_password: encryptSecret(""), updated_at: new Date().toISOString() }).eq("id", a.id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** reply to a customer's email from the shop mailbox, in the same thread; it lands in Sent Items and on the timeline */
export async function sendEmailReply(input: { activityId: string; subject: string; body: string; suggestionId?: string }) {
  try {
    const { admin, email, user } = await staff();
    if (!input.body.trim()) return { ok: false as const, error: "Write the reply first." };
    const { data: a } = await admin.from("activities").select("*").eq("id", input.activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    const meta = (a.meta || {}) as { references?: string[]; from_name?: string };
    const refs = [...(meta.references || []), a.external_id].filter(Boolean) as string[];
    const when = new Date(a.occurred_at as string).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    const quoted = String(a.body || "").split("\n").slice(0, 60).map((l) => `> ${l}`).join("\n");
    const text = `${input.body.trim()}\n\nOn ${when}, ${meta.from_name || a.from_email} wrote:\n${quoted}`;
    // from the mailbox the email came to (the thread stays in that person's Outlook), else your own
    const acct = (meta as { account_id?: string }).account_id ? await accountById(admin, (meta as { account_id?: string }).account_id!) : null;
    const from = acct?.enabled ? acct : await accountForUser(admin, user!.id);
    if (!from?.enabled) return { ok: false as const, error: "Connect your email in the Inbox first, so the reply can go out from your address." };
    const { messageId } = await sendFromMailbox(cfgOf(from), { to: a.from_email as string, subject: input.subject || `Re: ${a.subject || ""}`, text, inReplyTo: (a.external_id as string) || undefined, references: refs });
    await admin.from("activities").insert({
      customer_id: a.customer_id, order_id: a.order_id, kind: "email", direction: "out", subject: (input.subject || `Re: ${a.subject || ""}`).slice(0, 500), body: input.body.trim(),
      from_email: from.email, to_email: a.from_email, external_id: messageId, thread_id: a.thread_id || a.external_id, occurred_at: new Date().toISOString(),
      created_by: email || "staff", ai_processed_at: new Date().toISOString(), meta: { references: refs.slice(-20), mailbox: "sent", via: "portal", account_id: from.id, account: from.email },
    });
    await closeAnswered(admin, { inReplyTo: (a.external_id as string) || "", references: refs }, email || "staff");
    if (input.suggestionId) await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: email || "staff" }).eq("id", input.suggestionId);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** "Not a customer": never read this sender again, and take their email off the lists */
export async function markNotCustomer(activityId: string) {
  try {
    const { admin, email } = await staff();
    const { data: a } = await admin.from("activities").select("id, from_email, meta").eq("id", activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    await admin.from("mail_senders").upsert({ email: (a.from_email as string).toLowerCase(), kind: "ignore", customer_id: null, decided_by: email || "staff", decided_at: new Date().toISOString() });
    await admin.from("activities").update({ customer_id: null, order_id: null, meta: { ...((a.meta || {}) as object), ignored: true } }).eq("id", a.id);
    await admin.from("ai_suggestions").update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: email || "staff" }).eq("activity_id", a.id).in("status", ["open", "snoozed"]);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** "This is <customer>": this sender's email goes to that customer from now on (a new contact, a lead who's now a customer) */
export async function setEmailCustomer(activityId: string, customerId: string) {
  try {
    const { admin, email } = await staff();
    const { data: a } = await admin.from("activities").select("id, from_email, meta").eq("id", activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    await admin.from("mail_senders").upsert({ email: (a.from_email as string).toLowerCase(), kind: "customer", customer_id: customerId, decided_by: email || "staff", decided_at: new Date().toISOString() });
    await admin.from("activities").update({ customer_id: customerId, meta: { ...((a.meta || {}) as object), lead: false, match: "override" } }).eq("from_email", a.from_email).is("customer_id", null);
    await admin.from("ai_suggestions").update({ customer_id: customerId }).eq("activity_id", a.id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** read your mailbox now instead of waiting for the next 2-minute check */
export async function checkMailNow() {
  try {
    const { admin, user } = await staff();
    const a = await accountForUser(admin, user!.id);
    if (!a?.enabled) return { ok: false as const, error: "Connect your email first." };
    const r = await runAccount(admin, a, Date.now() + 35000);
    if ("busy" in r) return { ok: false as const, error: "It's checking right now. Give it a minute." };
    if ("error" in r) return { ok: false as const, error: r.error as string };
    return { ok: true as const, tally: r.tally };
  } catch (e) { return fail(e); }
}

/** a new customer from a lead's email (name and address from the email), and their email moves onto it */
export async function customerFromEmail(activityId: string, company: string) {
  try {
    const { admin } = await staff();
    const { data: a } = await admin.from("activities").select("id, from_email, meta").eq("id", activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    const name = ((a.meta || {}) as { from_name?: string }).from_name || "";
    const { data: c, error } = await admin.from("customers").insert({ company: company.trim() || name || a.from_email, name, email: (a.from_email as string).toLowerCase() }).select("id").single();
    if (error) return { ok: false as const, error: error.message };
    const r = await setEmailCustomer(activityId, c.id as string);
    return r.ok ? { ok: true as const, id: c.id as string } : r;
  } catch (e) { return fail(e); }
}

/** file an email under one of the customer's orders */
export async function setEmailOrder(activityId: string, orderId: string | null) {
  try {
    const { admin } = await staff();
    await admin.from("activities").update({ order_id: orderId }).eq("id", activityId);
    await admin.from("ai_suggestions").update({ order_id: orderId }).eq("activity_id", activityId);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
