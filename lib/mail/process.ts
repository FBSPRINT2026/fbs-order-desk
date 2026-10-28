import "server-only";
import { linkArtForEmail } from "@/lib/linkArt";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState } from "@/lib/ai/claude";
import { triageEmail } from "@/lib/ai/tasks";
import { processEmailActivity } from "@/lib/ai/email";
import { DIGITIZER } from "@/lib/digitizer";

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
export type MailAttachment = { filename: string; contentType: string; size: number; content: Buffer; inline: boolean; cid?: string };
export type MailMsg = {
  messageId: string; inReplyTo: string; references: string[]; date: Date;
  from: MailAddr; to: MailAddr[]; cc: MailAddr[]; subject: string; text: string;
  headers: Record<string, string>; html?: string; attachments: MailAttachment[];
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

export type Match = { customerId: string | null; how: "override" | "email" | "contact" | "printavo" | "domain" | "company" | "thread" | null; ignore?: boolean };
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
  // a contact at more than one customer: the newest one wins (the latest someone put them on); removed ones don't count
  const { data: k } = await admin.from("customer_contacts").select("customer_id").ilike("email", e).is("removed_at", null).order("created_at", { ascending: false }).limit(1);
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
    // the domain is the company's name: christine@shagcarpet.com → "Shag Carpet" (customers.company_key)
    const label = d.split(".").slice(0, -1).join("").replace(/^www/, "").replace(/[^a-z0-9]/g, "");
    if (label.length >= 4) {
      const { data: ck } = await admin.from("customers").select("id").eq("company_key", label).limit(2);
      if (ck?.length === 1) return { customerId: ck[0].id as string, how: "company" };
    }
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
const ART_EXT = /\.(png|jpe?g|gif|webp|tiff?|bmp|svg|pdf|ai|eps|ps|psd|cdr|zip|heic|xlsx|xlsm|xls|csv|tsv|numbers|docx|doc|txt|rtf|dst|emb|pes|exp)$/i;
/** spreadsheets and documents (size breakdowns, order sheets, rosters) are kept too, since Oct 7 */
const DOCS = /^(application\/(vnd\.openxmlformats-officedocument|vnd\.ms-excel|msword|rtf|vnd\.apple\.numbers)|text\/(csv|tab-separated-values|plain))/i;
/** artwork and documents customers send (not signature logos): saved privately with the email */
export async function saveAttachments(admin: SupabaseClient, m: MailMsg, folder: string) {
  const out: { name: string; path: string; type: string; size: number }[] = [];
  for (const a of m.attachments.slice(0, 15)) {
    if (!a.filename || !(ART.test(a.contentType) || DOCS.test(a.contentType) || ART_EXT.test(a.filename))) continue;
    if (a.size > 40 * 1024 * 1024) continue;
    if (a.inline && /^image\//.test(a.contentType) && (a.size < 60 * 1024 || (a.cid && m.html?.includes(a.cid)))) continue; // signature logos, pictures in the body (saved with the body)
    const name = a.filename.replace(/[^\w.\- ]+/g, "_").slice(-120);
    const path = `emails/${folder}/${Date.now().toString(36)}-${name}`;
    const { error } = await admin.storage.from("proofs").upload(path, a.content, { contentType: a.contentType || "application/octet-stream", upsert: false });
    if (!error) out.push({ name: a.filename, path, type: a.contentType, size: a.size });
  }
  return out;
}

/**
 * The email as it looks in Outlook: its HTML (formatting, signatures) saved privately, with the pictures that are
 * part of the message (cid: images: logos, pasted screenshots) saved beside it so the Inbox can show them.
 */
export async function saveBody(admin: SupabaseClient, m: Pick<MailMsg, "html" | "attachments">, folder: string): Promise<{ html?: string; inline?: Record<string, string> }> {
  if (!m.html || m.html.length > 40_000_000) return {};
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const inline: Record<string, string> = {};
  // pictures pasted right into the email (src="data:image/png;base64,…", Gmail / Apple Mail forwards): each saved as
  // its own file like the cid: pictures, so the HTML stays small and still shows them (Peticolas "Club logo 2026")
  let html = m.html, k = 0;
  const embedded: { key: string; type: string; data: string }[] = [];
  html = html.replace(/src=(["'])data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)\1/gi, (_all, q: string, type: string, data: string) => {
    if (k >= 20) return `src=${q}${q}`;
    const key = `embedded-${++k}`; embedded.push({ key, type, data }); return `src=${q}cid:${key}${q}`;
  });
  for (const e of embedded) {
    const buf = Buffer.from(e.data.replace(/\s+/g, ""), "base64");
    if (buf.length > 12 * 1024 * 1024) continue;
    const path = `emails/${folder}/${stamp}/inline-${e.key}.${(e.type.split("/")[1] || "png").replace(/[^\w]+/g, "")}`;
    const { error } = await admin.storage.from("proofs").upload(path, buf, { contentType: e.type, upsert: true });
    if (!error) inline[e.key] = path;
  }
  if (html.length > 3_000_000) return {};
  m = { ...m, html };
  for (const a of m.attachments) {
    if (!a.cid || !/^image\//.test(a.contentType) || a.size > 8 * 1024 * 1024 || !html.includes(a.cid)) continue;
    const path = `emails/${folder}/${stamp}/inline-${a.cid.replace(/[^\w.\-]+/g, "_").slice(0, 80)}`;
    const { error } = await admin.storage.from("proofs").upload(path, a.content, { contentType: a.contentType, upsert: true });
    if (!error) inline[a.cid] = path;
  }
  const path = `emails/${folder}/${stamp}/body.html`;
  const { error } = await admin.storage.from("proofs").upload(path, Buffer.from(html, "utf8"), { contentType: "text/html; charset=utf-8", upsert: true });
  return error ? {} : { html: path, inline };
}

/** someone at a customer we matched by their company: on the customer's contacts (no portal sign-in until staff turn it on) */
export async function addContact(admin: SupabaseClient, customerId: string, email: string, name: string, chosen = false) {
  const e = lc(email);
  if (!e || (!chosen && FREE.has(domainOf(e)))) return false;
  const { data: have } = await admin.from("customer_contacts").select("id").eq("customer_id", customerId).ilike("email", e).limit(1);
  if (have?.length) return false;
  const { data: cust } = await admin.from("customers").select("email").eq("id", customerId).maybeSingle();
  if (lc(String(cust?.email || "")) === e) return false; // already the customer's main email
  const { error } = await admin.from("customer_contacts").insert({ customer_id: customerId, email: e, name: (name || "").slice(0, 120), portal_access: false });
  return !error;
}

const orderNum = (subject: string) => subject.match(/(?:#|order\s*#?\s*|quote\s*#?\s*|invoice\s*#?\s*|job\s*#?\s*)(\d{3,7})\b/i)?.[1];
async function orderFor(admin: SupabaseClient, customerId: string | null, subject: string) {
  const num = orderNum(subject);
  if (!num || !customerId) return null;
  const { data: o } = await admin.from("orders").select("id, customer_id").eq("number", +num).maybeSingle();
  return o && o.customer_id === customerId ? (o.id as string) : null;
}

export type Outcome = "customer" | "lead" | "sent" | "skipped" | "duplicate" | "digitizer";

/**
 * The digitizer's answer to a digitizing request (the Digitizer, lib/digitizer.ts): a reply in the request's thread, or
 * an email from the digitizer naming the order (#40189). Kept on the order (not a customer email, no AI reply), its
 * files saved, and the logo marked "files came in" so Digitizing offers to add them. Nothing is added by itself.
 */
async function digitizerReply(admin: SupabaseClient, m: MailMsg, from: string, acct: Acct): Promise<Outcome | null> {
  const ids = [...new Set([m.inReplyTo, ...m.references].filter(Boolean))].slice(-20);
  let req: { id: string; order_id: string | null; meta: { digitize?: { order_id: string; imprint_id: string; design_id: string | null; /** a request for several logos at once (Oct 27) */ items?: { imprint_id: string; design_id: string | null }[] } } } | null = null;
  if (ids.length) {
    const { data } = await admin.from("activities").select("id, order_id, meta").in("external_id", ids).not("meta->digitize", "is", null).order("occurred_at", { ascending: false }).limit(1);
    req = (data?.[0] as typeof req) || null;
  }
  if (!req && domainOf(from) === DIGITIZER.domain) {
    const num = orderNum(m.subject);
    const { data: o } = num ? await admin.from("orders").select("id").eq("number", +num).maybeSingle() : { data: null };
    if (o) { const { data } = await admin.from("activities").select("id, order_id, meta").eq("order_id", o.id).not("meta->digitize", "is", null).order("occurred_at", { ascending: false }).limit(1); req = (data?.[0] as typeof req) || null; }
    if (!req) return null;
  }
  if (!req?.meta?.digitize) return null;
  const dz = req.meta.digitize;
  const attachments = await saveAttachments(admin, m, `digitizer/${dz.order_id}`);
  const body = await saveBody(admin, m, `digitizer/${dz.order_id}`);
  const now = new Date().toISOString();
  const { data: ins, error } = await admin.from("activities").insert({
    customer_id: null, order_id: dz.order_id, kind: "email", direction: "in",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: from,
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "mailbox", ai_processed_at: now,
    meta: { from_name: m.from.name.slice(0, 200), match: "digitizer", references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, ...body, mailbox: "inbox", account_id: acct.id, account: acct.email, digitizer_reply: { ...dz, request: req.id } },
  }).select("id").single();
  if (error) throw new Error(error.message);
  // each logo the request was for waits with their files on Digitizing (one request can be for several logos)
  const items = dz.items?.length ? dz.items : [{ imprint_id: dz.imprint_id, design_id: dz.design_id }];
  const files = attachments.filter((a) => /\.(zip|dst|emb|pdf)$/i.test(a.name));
  for (const it of items) {
    if (!it.design_id) continue;
    const { data: d } = await admin.from("designs").select("specs").eq("id", it.design_id).maybeSingle();
    const sp = (d?.specs || {}) as Record<string, unknown>, emb = (sp.embroidery || {}) as Record<string, unknown>;
    await admin.from("designs").update({ specs: { ...sp, embroidery: { ...emb, reply: { at: m.date.toISOString(), activity: ins.id, from, subject: m.subject.slice(0, 200), files, order_id: dz.order_id, imprint_id: it.imprint_id } } } }).eq("id", it.design_id);
  }
  // their files go on each logo by themselves, which moves it to Needs sew-out (Oct 28, Nick; lib/digitizerAuto.ts)
  if (files.some((f) => /\.(dst|zip)$/i.test(f.name))) {
    const { addReplyFiles } = await import("@/lib/digitizerAuto");
    for (const it of items) if (it.design_id) await addReplyFiles(admin, it.design_id, { others: items.length }).catch(() => null);
  }
  return "digitizer";
}

export type Acct = { id: string; email: string };
export async function handleIncoming(admin: SupabaseClient, m: MailMsg, acct: Acct): Promise<Outcome> {
  const from = lc(m.from.address);
  if (!from || from === lc(acct.email) || OWN_DOMAINS.has(domainOf(from))) return "skipped";
  if (m.messageId) { const { data: dup } = await admin.from("activities").select("id").eq("external_id", m.messageId).maybeSingle(); if (dup) return "duplicate"; }
  // the digitizer answering a digitizing request: kept on the order for Digitizing, not as a customer email
  const dz = await digitizerReply(admin, m, from, acct);
  if (dz) return dz;
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
  const body = await saveBody(admin, m, match.customerId || "leads");
  if (match.customerId && ["domain", "company"].includes(match.how || "")) await addContact(admin, match.customerId, from, m.from.name);
  const { data: ins, error } = await admin.from("activities").insert({
    customer_id: match.customerId, order_id: orderId, kind: "email", direction: "in",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: from,
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "mailbox",
    meta: { from_name: m.from.name.slice(0, 200), match: match.how, lead, references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, ...body, mailbox: "inbox", account_id: acct.id, account: acct.email },
  }).select("id").single();
  if (error) throw new Error(error.message);
  // art sent as a link (Canva, Dropbox, Google Drive): saved with the email before the AI reads it
  await linkArtForEmail(admin, ins.id as string).catch(() => null);
  await processEmailActivity(admin, ins.id as string).catch(() => null);
  return lead ? "lead" : "customer";
}

/**
 * Keep one Inbox email in the portal on request (Oct 14, Nick: "Kayla Heady sent an email and the actions toolbar
 * doesn't pop up"): the mail check skips senders it can't place, so Create order, Order goods and Match to customer
 * had nothing to work with. Saved like any customer email (attachments, body, the AI's read of it); linked to the
 * customer when the sender is one, else a new sender (lead). Returns the email's id here.
 */
export async function keepIncoming(admin: SupabaseClient, m: MailMsg, acct: Acct): Promise<string> {
  const from = lc(m.from.address);
  if (m.messageId) { const { data: dup } = await admin.from("activities").select("id").eq("external_id", m.messageId).maybeSingle(); if (dup) return dup.id as string; }
  // the digitizer answering a digitizing request: kept on the order for Digitizing, not as a customer email
  const dz = await digitizerReply(admin, m, from, acct);
  if (dz) return dz;
  const parent = await threadParent(admin, m);
  let match = await matchAddress(admin, from);
  if (!match.customerId && parent?.customer_id) match = { customerId: parent.customer_id as string, how: "thread" };
  const lead = !match.customerId;
  const orderId = parent?.order_id || (await orderFor(admin, match.customerId, m.subject));
  const attachments = await saveAttachments(admin, m, match.customerId || "leads");
  const body = await saveBody(admin, m, match.customerId || "leads");
  const { data: ins, error } = await admin.from("activities").insert({
    customer_id: match.customerId, order_id: orderId, kind: "email", direction: "in",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: from,
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "kept",
    meta: { from_name: m.from.name.slice(0, 200), match: match.how, lead, kept: true, references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, ...body, mailbox: "inbox", account_id: acct.id, account: acct.email },
  }).select("id").single();
  if (error) throw new Error(error.message);
  await linkArtForEmail(admin, ins.id as string).catch(() => null);
  await processEmailActivity(admin, ins.id as string).catch(() => null);
  return ins.id as string;
}

export async function handleSent(admin: SupabaseClient, m: MailMsg, acct: Acct): Promise<Outcome> {
  if (m.messageId) { const { data: dup } = await admin.from("activities").select("id").eq("external_id", m.messageId).maybeSingle(); if (dup) return "duplicate"; }
  const parent = await threadParent(admin, m);
  let customerId: string | null = parent?.customer_id || null;
  if (!customerId) for (const r of [...m.to, ...m.cc]) { const x = await matchAddress(admin, r.address); if (x.customerId && !x.ignore) { customerId = x.customerId; break; } }
  if (!customerId) return "skipped";
  const orderId = parent?.order_id || (await orderFor(admin, customerId, m.subject));
  const attachments = await saveAttachments(admin, m, customerId);
  const body = await saveBody(admin, m, customerId);
  await admin.from("activities").insert({
    customer_id: customerId, order_id: orderId, kind: "email", direction: "out",
    subject: m.subject.slice(0, 500), body: m.text.slice(0, 100000), from_email: lc(m.from.address),
    to_email: [...m.to, ...m.cc].map((x) => x.address).join(", ").slice(0, 500),
    external_id: m.messageId ? m.messageId.slice(0, 500) : null, thread_id: (m.inReplyTo || m.references[0] || m.messageId || "").slice(0, 500) || null,
    occurred_at: m.date.toISOString(), created_by: "mailbox", ai_processed_at: new Date().toISOString(),
    meta: { references: m.references.slice(-20), cc: m.cc.map((x) => x.address), attachments, ...body, mailbox: "sent", account_id: acct.id, account: acct.email },
  });
  await closeAnswered(admin, m, "Answered in Outlook");
  await closeWrittenTo(admin, [...m.to, ...m.cc].map((x) => lc(x.address)), m.date.toISOString(), "Answered in Outlook");
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

/** any later email to a person answers what they sent before it, even outside the thread (lib/inbox.ts agrees) */
export async function closeWrittenTo(admin: SupabaseClient, addrs: string[], at: string, by: string) {
  const to = [...new Set(addrs.filter((x) => x && !OWN_DOMAINS.has(domainOf(x))))];
  if (!to.length) return;
  const { data: acts } = await admin.from("activities").select("id").eq("kind", "email").eq("direction", "in").in("from_email", to).lt("occurred_at", at).gte("occurred_at", new Date(Date.parse(at) - 60 * 864e5).toISOString());
  const aIds = (acts || []).map((x) => x.id as string);
  if (aIds.length) await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by }).in("activity_id", aIds).eq("kind", "email_reply").in("status", ["open", "snoozed"]);
}
