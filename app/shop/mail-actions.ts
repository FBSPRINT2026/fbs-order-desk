"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mailConfig } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { syncMailbox } from "@/lib/mail/imap";
import { closeAnswered } from "@/lib/mail/process";

// Staff actions for the shop mailbox: reply from Nicholas's address, sort a sender, see the connection, check now.

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return { ...v, admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export async function getMailStatus() {
  try {
    const { admin } = await staff();
    const c = mailConfig();
    const { data } = await admin.from("mail_sync").select("enabled, last_run_at, last_ok_at, last_error, last_error_at, stats").eq("id", 1).single();
    return { ok: true as const, ready: c.ready, mailbox: c.user, ...(data || {}) };
  } catch (e) { return fail(e); }
}

/** reply to a customer's email from the shop mailbox, in the same thread; it lands in Sent Items and on the timeline */
export async function sendEmailReply(input: { activityId: string; subject: string; body: string; suggestionId?: string }) {
  try {
    const { admin, email } = await staff();
    if (!input.body.trim()) return { ok: false as const, error: "Write the reply first." };
    const { data: a } = await admin.from("activities").select("*").eq("id", input.activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    const meta = (a.meta || {}) as { references?: string[]; from_name?: string };
    const refs = [...(meta.references || []), a.external_id].filter(Boolean) as string[];
    const when = new Date(a.occurred_at as string).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    const quoted = String(a.body || "").split("\n").slice(0, 60).map((l) => `> ${l}`).join("\n");
    const text = `${input.body.trim()}\n\nOn ${when}, ${meta.from_name || a.from_email} wrote:\n${quoted}`;
    const { messageId } = await sendFromMailbox({ to: a.from_email as string, subject: input.subject || `Re: ${a.subject || ""}`, text, inReplyTo: (a.external_id as string) || undefined, references: refs });
    await admin.from("activities").insert({
      customer_id: a.customer_id, order_id: a.order_id, kind: "email", direction: "out", subject: (input.subject || `Re: ${a.subject || ""}`).slice(0, 500), body: input.body.trim(),
      from_email: mailConfig().user, to_email: a.from_email, external_id: messageId, thread_id: a.thread_id || a.external_id, occurred_at: new Date().toISOString(),
      created_by: email || "staff", ai_processed_at: new Date().toISOString(), meta: { references: refs.slice(-20), mailbox: "sent", via: "portal" },
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

/** read the mailbox now instead of waiting for the next 2-minute check */
export async function checkMailNow() {
  try {
    const { admin } = await staff();
    if (!mailConfig().ready) return { ok: false as const, error: "The mailbox isn't connected yet: add MAIL_PASSWORD in Vercel." };
    const { data: got } = await admin.rpc("mail_sync_claim", { p_seconds: 50 });
    if (!got) return { ok: false as const, error: "It's checking right now. Give it a minute." };
    const now = new Date().toISOString();
    try {
      const tally = await syncMailbox(admin, Date.now() + 35000);
      await admin.from("mail_sync").update({ last_run_at: now, last_ok_at: new Date().toISOString(), last_error: null, last_error_at: null, running_until: null }).eq("id", 1);
      return { ok: true as const, tally };
    } catch (e) {
      await admin.from("mail_sync").update({ last_run_at: now, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500), last_error_at: now, running_until: null }).eq("id", 1);
      throw e;
    }
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
