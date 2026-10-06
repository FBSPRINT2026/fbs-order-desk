import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState } from "@/lib/ai/claude";
import { triageEmail } from "@/lib/ai/tasks";
import { processEmailActivity } from "@/lib/ai/email";

/**
 * What happens to each email read from the shop mailbox:
 *  Inbox: from a customer (their address, a contact's, their company domain, a past Printavo order's, or a reply in a
 *    thread we already have) → onto the customer's timeline, linked to the order (order # in the subject, the thread,
 *    or the AI matching it to an open order), artwork attachments saved, and the Assistant drafts a reply / a quote.
 *    From someone we don't know: the AI decides whether it's a new customer (a lead) or not; vendors, newsletters,
 *    receipts and personal mail are skipped and NOT stored.
 *  Sent Items: Nicholas's own emails to customers go on the timeline too, and close the Assistant's "reply to" card
 *    for that thread (he already answered in Outlook).
 */
export type MailAddr = { address: string; name: string };
export type MailAttachment = { filename: string; contentType: string; size: number; content: Buffer; inline: boolean };
export type MailMsg = {
  messageId: string; inReplyTo: string; references: string[]; date: Date;
  from: MailAddr; to: MailAddr[]; cc: MailAddr[]; subject: string; text: string;
  headers: Record<string, string>; attachments: MailAttachment[];
};

const lc = (s: string) => (s || "").trim().toLowerCase();
const domainOf = (e: string) => lc(e).split("@")[1] || "";
const OWN_DOMAINS = new Set(["fbsprint.com"]);
const FREE = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "bellsouth.net", "charter.net", "cox.net", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com"]);
/** suppliers, carriers and services: never customers by domain (a person there can still be matched by exact address) */
const VENDORS = /(^|\.)(ssactivewear|sanmar|alphabroder|ups|fedex|usps|dhl|avient|wilflex|rutland|internationalcoatings|iccink|monarchcolor|inktek|screenprintsupplies|ryonet|intermedia|serverdata|stax|staxpayments|paypal|stripe|intuit|quickbooks|printavo|vercel|supabase|github|google|microsoft|apple|amazon|shopify|godaddy|squarespace|adobe|canva|mailchimp|constantcontact|hubspot|linkedin|facebook|instagram|zoom|dropbox|wetransfer|docusign|brevo|sendgrid|resend)\.(com|net|org|io|co)$/i;

export function isAutomated(m: MailMsg) {
  const h = m.headers;
  if (h["list-unsubscribe"] || h["list-id"]) return true;
  if (/bulk|junk|list/i.test(h["precedence"] || "")) return true;
  if (h["auto-submitted"] && !/^no$/i.test(h["auto-submitted"])) return true;
  if (/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|notifications?|alerts?|news(letter)?|marketing|info@.*\.(?:mail|email)\.)/i.test(m.from.address.split("@")[0] + "@")) return true;
  return false;
}

export type Match = { customerId: string | null; how: "override" | "email" | "contact" | "printavo" | "domain" | "thread" | null; ignore?: boolean };
const clean = (e: string) => lc(e).replace(/[,()"'\\]/g, "");

/** which customer an address belongs to */
export async function matchAddress(admin: SupabaseClient, email: string): Promise<Match> {
  const e = clean(email);
  if (!e || OWN_DOMAINS.has(domainOf(e))) return { customerId: null, how: null };
  const { data: o } = await admin.from("mail_senders").select("kind, customer_id").eq("email", e).maybeSingle();
  if (o?.kind === "ignore") return { customerId: null, how: "override", ignore: true };
  if (o?.kind === "customer" && o.customer_id) return { customerId: o.customer_id as string, how: "override" };
  const { data: c } = await admin.from("customers").select("id").or(`email.ilike.${e},contact2_email.ilike.${e}`).limit(1);
  if (c?.[0]) return { customerId: c[0].id as string, how: "email" };
  const { data: k } = await admin.from("customer_contacts").select("customer_id").ilike("email", e).limit(1);
  if (k?.[0]?.customer_id) return { customerId: k[0].customer_id as string, how: "contact" };
  const { data: p } = await admin.from("printavo_customers").select("customer_id").ilike("data->>email", e).not("customer_id", "is", null).limit(1);
  if (p?.[0]?.customer_id) return { customerId: p[0].customer_id as string, how: "printavo" };
  // their company's domain (not gmail & co, not a supplier): only when it points at exactly one customer
  const d = domainOf(e);
  if (d && !FREE.has(d) && !VENDORS.test(d)) {
    const [{ data: cs }, { data: ks }] = await Promise.all([
      admin.from("customers").select("id").or(`email.ilike.%@${d},contact2_email.ilike.%@${d}`).limit(5),
      admin.from("customer_contacts").select("customer_id").ilike("email", `%@${d}`).limit(5),
    ]);
    const ids = [...new Set([...(cs || []).map((x) => x.id as string), ...(ks || []).map((x) => x.customer_id as string)].filter(Boolean))];
    if (ids.length === 1) return { customerId: ids[0], how: "domain" };
  }
  return { customerId: null, how: null };
}

/** an email we already have in the same thread (it was a reply to, or referenced, one of ours) */
async function threadParent(admin: SupabaseClient, m: MailMsg) {
  const ids = [...new Set([m.inReplyTo, ...m.references].filter(Boolean))].slice(-20);
  if (!ids.length) return null;
  const { data } = await admin.from("activities").select("id, customer_id, order_id, external_id, occurred_at").in("external_id", ids).order("occurred_at", { ascending: false }).limit(5);
  return (data || []).find((x) => x.customer_id) || (data || [])[0] || null;
}

const ART = /^(image\/|application\/(pdf|postscript|illustrator|eps|x-eps|vnd\.adobe|zip|x-zip|octet-stream))/i;
const ART_EXT = /\.(png|jpe?g|gif|webp|tiff?|bmp|svg|pdf|ai|eps|ps|psd|cdr|zip|heic)$/i;
/** artwork and documents customers send (not signature logos): saved privately with the email */
async function saveAttachments(admin: SupabaseClient, m: MailMsg, folder: string) {
  const out: { name: string; path: string; type: string; size: number }[] = [];
  for (const a of m.attachments.slice(0, 15)) {
    if (!a.filename || !(ART.test(a.contentType) || ART_EXT.test(a.filename))) continue;
    if (a.size > 40 * 1024 * 1024) continue;
    if (a.inline && /^image\//.test(a.contentType) && a.size < 60 * 1024) continue; // signature logos, social icons
    const name = a.filename.replace(/[^\w.\- ]+/g, "_").slice(-120);
    const path = `emails/${folder}/${Date.now().toString(36)}-${name}`;
    const { error } = await admin.storage.from("proofs").upload(path, a.content, { contentType: a.contentType || "application/octet-stream", upsert: false });
    if (!error) out.push({ name: a.filename, path, type: a.contentType, size: a.size });
  }
  return out;
}

const orderNum = (subject: string) => subject.match(/(?:#|order\s*#?\s*|quote\s*#?\s*|invoice\s*#?\s*|job\s*#?\s*)(\d{3,7})\b/i)?.[1];
async function orderFor(admin: SupabaseClient, customerId: string | null, subject: string) {
  const num = orderNum(subject);
  if (!num || !customerId) return null;
  const { data: o } = await admin.from("orders").select("id, customer_id").eq("number", +num).maybeSingle();
  return o && o.customer_id === customerId ? (o.id as string) : null;
}

export type Outcome = "customer" | "lead" | "sent" | "skipped" | "duplicate";

export async function handleIncoming(admin: SupabaseClient, m: MailMsg, mailbox: string): Promise<Outcome> {
  const from = lc(m.from.address);
  if (!from || from === lc(mailbox) || OWN_DOMAINS.has(domainOf(from))) return "skipped";
  if (m.messageId) { const { data: dup } = await admin.from("activities").select("id").eq("external_id", m.messageId).maybeSingle(); if (dup) return "duplicate"; }
  const parent = await threadParent(admin, m);
  let match = await matchAddress(admin, from);
  if (match.ignore) return "skipped";
  if (!match.customerId && parent?.customer_id) match = { customerId: parent.customer_id as string, how: "thread" };
  if (!match.customerId && isAutomated(m)) return "skipped";
  let lead = false;
  if (!match.customerId) {
    // someone new: is it a customer (a quote request, a question about printing) or something else?
    if (VENDORS.test(domainOf(from))) return "skipped";
    const { settings, ready } = await aiState(admin);
    if (!ready) return "skipped";
    const t = await triageEmail(settings, { from: `${m.from.name} <${from}>`, subject: m.subject, body: m.text }, { admin, by: "mail" });
    if (!t.ok || t.data.intent === "not_customer" || (t.data.intent === "other" && !t.data.needs_reply)) return "skipped";
    lead = true;
  }
  const orderId = parent?.order_id || (await orderFor(admin, match.customerId, m.subject));
  const attachments = await saveAttachments(admin, m, match.customerId || "leads");
  const { data: ins, error } = await admin.from("activities").insert({
    customer_id: match.customerId, order_id: orderId, kind: "email", direction: "in",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: from,
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "mailbox",
    meta: { from_name: m.from.name.slice(0, 200), match: match.how, lead, references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, mailbox: "inbox" },
  }).select("id").single();
  if (error) throw new Error(error.message);
  await processEmailActivity(admin, ins.id as string).catch(() => null);
  return lead ? "lead" : "customer";
}

export async function handleSent(admin: SupabaseClient, m: MailMsg): Promise<Outcome> {
  if (m.messageId) { const { data: dup } = await admin.from("activities").select("id").eq("external_id", m.messageId).maybeSingle(); if (dup) return "duplicate"; }
  const parent = await threadParent(admin, m);
  let customerId: string | null = parent?.customer_id || null;
  if (!customerId) for (const r of [...m.to, ...m.cc]) { const x = await matchAddress(admin, r.address); if (x.customerId && !x.ignore) { customerId = x.customerId; break; } }
  if (!customerId) return "skipped";
  const orderId = parent?.order_id || (await orderFor(admin, customerId, m.subject));
  const attachments = await saveAttachments(admin, m, customerId);
  await admin.from("activities").insert({
    customer_id: customerId, order_id: orderId, kind: "email", direction: "out",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: lc(m.from.address),
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "mailbox", ai_processed_at: new Date().toISOString(),
    meta: { references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, mailbox: "sent" },
  });
  await closeAnswered(admin, m, "Answered in Outlook");
  return "sent";
}

/** the customer's emails this one answers: their "reply to" cards are done */
export async function closeAnswered(admin: SupabaseClient, m: Pick<MailMsg, "inReplyTo" | "references">, by: string) {
  const ids = [...new Set([m.inReplyTo, ...m.references].filter(Boolean))];
  if (!ids.length) return;
  const { data: acts } = await admin.from("activities").select("id").in("external_id", ids).eq("direction", "in");
  const aIds = (acts || []).map((x) => x.id as string);
  if (aIds.length) await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by }).in("activity_id", aIds).eq("kind", "email_reply").in("status", ["open", "snoozed"]);
}
