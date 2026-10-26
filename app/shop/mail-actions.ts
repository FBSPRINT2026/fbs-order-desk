"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountById, accountForUser, cfgOf, DEFAULT_MAIL_HOST, encryptSecret, publicAccount, type MailAccount } from "@/lib/mail/config";
import { checkSending, sendFromMailbox } from "@/lib/mail/send";
import { imapClient } from "@/lib/mail/imap";
import { addContact, closeAnswered, closeWrittenTo, saveBody } from "@/lib/mail/process";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";
import { detectSignature } from "@/lib/mail/signature";
import { mailboxToRead, viewedEmail, VIEWING_NO } from "@/lib/mail/viewing";
import { runAccount } from "@/lib/mail/run";
import { archiveInbox, MOVES, type MoveTo } from "@/lib/mail/mirror";
import { cleanCc, type TeamMember } from "@/lib/mail/ccWords";

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
    const v = await staff(), { admin, user, role } = v;
    const { acct: mine, viewing } = await mailboxToRead(admin, v);
    let all: ReturnType<typeof publicAccount>[] = [];
    if (role === "owner" || role === "admin") { const { data } = await admin.from("mail_accounts").select("*").order("email"); all = ((data || []) as MailAccount[]).map(publicAccount); }
    return { ok: true as const, mine: mine ? publicAccount(mine) : null, all, defaultHost: DEFAULT_MAIL_HOST, myEmail: viewing || user!.email || "", viewing };
  } catch (e) { return fail(e); }
}

/** connect (or reconnect) your own mailbox: the sign-in is tested first, then the password is stored encrypted */
export async function connectMailbox(input: { email: string; password: string; name: string; host: string }) {
  try {
    const v = await staff(), { admin } = v;
    // an owner viewing as someone can connect that person's mailbox for them (Oct 12, Nick: "just connect her email");
    // the owner types the password; it's tied to that person's sign-in, not the owner's
    const viewing = await viewedEmail(v);
    let user = v.user;
    if (viewing) {
      if (input.email.trim().toLowerCase() !== viewing) return { ok: false as const, error: `While viewing as ${viewing}, you can only connect ${viewing}.` };
      let found: { id: string } | null = null;
      for (let page = 1; page <= 10 && !found; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        found = (data?.users || []).find((u) => (u.email || "").toLowerCase() === viewing) || null;
        if (!data?.users?.length || data.users.length < 200) break;
      }
      if (!found) return { ok: false as const, error: `${viewing} hasn't signed in to the portal yet. They need to sign in once first.` };
      user = found as typeof user;
    }
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
    // reading works; check sending too (Intermedia keeps SMTP off per mailbox until it's ticked)
    const sendProblem = await checkSending({ user: email, pass: input.password, imapHost: host, smtpHost: host, imapPort: 993, smtpPort: 587, fromName: "" }).catch(() => null);
    return { ok: true as const, sendProblem };
  } catch (e) { return fail(e); }
}

/** stop reading your mailbox (the connection and stored password are removed; email already on file stays) */
export async function disconnectMailbox() {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const a = await accountForUser(admin, user!.id);
    if (a) await admin.from("mail_accounts").update({ enabled: false, enc_password: encryptSecret(""), updated_at: new Date().toISOString() }).eq("id", a.id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/**
 * Reply to a customer's email from your mailbox, the way Outlook would: what you wrote, your Outlook signature
 * (logo and all), then their email quoted under From/Sent/To/Subject. Same thread; a copy lands in Sent Items and
 * on the timeline.
 */
export async function sendEmailReply(input: { activityId: string; subject: string; body: string; suggestionId?: string; cc?: string[] }) {
  try {
    const v = await staff(), { admin, email, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    if (!input.body.trim()) return { ok: false as const, error: "Write the reply first." };
    const { data: a } = await admin.from("activities").select("*").eq("id", input.activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    const meta = (a.meta || {}) as { references?: string[]; from_name?: string; account_id?: string; cc?: string[]; html?: string };
    const refs = [...(meta.references || []), a.external_id].filter(Boolean) as string[];
    // from your own mailbox when you have one (an email sent to both owners is stored once, under one of them: Amanda
    // answering States Made goes out from her address, not Nick's); else the mailbox it came to
    const own = await accountForUser(admin, user!.id);
    const acct = own?.enabled ? null : meta.account_id ? await accountById(admin, meta.account_id) : null;
    const from = own?.enabled ? own : acct?.enabled ? acct : own;
    if (!from?.enabled) return { ok: false as const, error: "Connect your email in the Inbox first, so the reply can go out from your address." };
    const subject = input.subject || `Re: ${a.subject || ""}`;
    const sent = new Date(a.occurred_at as string).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ");
    let origHtml = "";
    if (meta.html) { const { data: blob } = await admin.storage.from("proofs").download(meta.html); if (blob && blob.size < 1_500_000) origHtml = await blob.text(); }
    const quote = { from: meta.from_name ? `${meta.from_name} <${a.from_email}>` : (a.from_email as string), sent, to: String(a.to_email || from.email), cc: (meta.cc || []).join("; "), subject: String(a.subject || ""), html: origHtml, text: String(a.body || "") };
    const signature = from.signature_on !== false ? from.signature_html || "" : "";
    const page = replyHtml({ body: input.body, signature, css: signature ? from.signature_css : "", quote });
    const { html, attachments } = inlineImages(page);
    const text = replyText({ body: input.body, signature, quote });
    // Cc (Oct 12): who you added, never the customer or yourself again
    const cc = cleanCc(input.cc, [String(a.from_email || ""), from.email]);
    const { messageId } = await sendFromMailbox(cfgOf(from), { to: a.from_email as string, cc: cc.join(", ") || undefined, subject, text, html, attachments, inReplyTo: (a.external_id as string) || undefined, references: refs });
    const body = await saveBody(admin, { html: page, attachments: [] }, (a.customer_id as string) || "leads").catch(() => ({}));
    await admin.from("activities").insert({
      customer_id: a.customer_id, order_id: a.order_id, kind: "email", direction: "out", subject: subject.slice(0, 500), body: input.body.trim(),
      from_email: from.email, to_email: a.from_email, external_id: messageId, thread_id: a.thread_id || a.external_id, occurred_at: new Date().toISOString(),
      created_by: email || "staff", ai_processed_at: new Date().toISOString(), meta: { references: refs.slice(-20), mailbox: "sent", via: "portal", account_id: from.id, account: from.email, ...(cc.length ? { cc } : {}), ...body, html_checked: true },
    });
    await closeAnswered(admin, { inReplyTo: (a.external_id as string) || "", references: refs }, email || "staff");
    await closeWrittenTo(admin, [String(a.from_email || "")], new Date().toISOString(), email || "staff");
    if (input.suggestionId) await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: email || "staff" }).eq("id", input.suggestionId);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/**
 * Forward (Oct 14, Nick: the email toolbar's first section is "basic email function like reply and forward"): to
 * whoever you type, with your note on top, the original underneath (as Outlook forwards it) and its attachments.
 * From your mailbox, kept on the customer's timeline like a reply.
 */
export async function forwardEmail(input: { activityId: string; to: string; body: string }) {
  try {
    const v = await staff(), { admin, email, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const to = [...new Set((input.to.match(/[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/gi) || []).map((x) => x.toLowerCase()))].slice(0, 10);
    if (!to.length) return { ok: false as const, error: "Who should it go to? Type an email address." };
    const { data: a } = await admin.from("activities").select("*").eq("id", input.activityId).maybeSingle();
    if (!a) return { ok: false as const, error: "That email isn't on file." };
    const meta = (a.meta || {}) as { from_name?: string; account_id?: string; cc?: string[]; html?: string; attachments?: { name: string; path: string; type?: string; size?: number }[] };
    const own = await accountForUser(admin, user!.id);
    const acct = own?.enabled ? null : meta.account_id ? await accountById(admin, meta.account_id) : null;
    const from = own?.enabled ? own : acct?.enabled ? acct : own;
    if (!from?.enabled) return { ok: false as const, error: "Connect your email in the Inbox first, so it can go out from your address." };
    const subject = /^(fw|fwd):/i.test(String(a.subject || "")) ? String(a.subject) : `Fwd: ${a.subject || ""}`;
    const sent = new Date(a.occurred_at as string).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ");
    let origHtml = "";
    if (meta.html) { const { data: blob } = await admin.storage.from("proofs").download(meta.html); if (blob && blob.size < 1_500_000) origHtml = await blob.text(); }
    const quote = { from: meta.from_name ? `${meta.from_name} <${a.from_email}>` : String(a.from_email || ""), sent, to: String(a.to_email || from.email), cc: (meta.cc || []).join("; "), subject: String(a.subject || ""), html: origHtml, text: String(a.body || "") };
    const signature = from.signature_on !== false ? from.signature_html || "" : "";
    const page = replyHtml({ body: input.body || " ", signature, css: signature ? from.signature_css : "", quote });
    const { html, attachments } = inlineImages(page);
    const text = replyText({ body: input.body || "", signature, quote });
    // the original's attachments go along (up to 20 MB in all)
    const files: { filename: string; content: Buffer; contentType: string; contentDisposition: "attachment" }[] = [];
    let total = 0;
    for (const f of (meta.attachments || []).slice(0, 15)) {
      if (!f?.path) continue;
      const { data: blob } = await admin.storage.from("proofs").download(f.path);
      if (!blob || total + blob.size > 20_000_000) continue;
      total += blob.size;
      files.push({ filename: f.name || "attachment", content: Buffer.from(await blob.arrayBuffer()), contentType: f.type || blob.type || "application/octet-stream", contentDisposition: "attachment" });
    }
    const { messageId } = await sendFromMailbox(cfgOf(from), { to: to.join(", "), subject, text, html, attachments: [...attachments, ...files] });
    const saved = await saveBody(admin, { html: page, attachments: [] }, (a.customer_id as string) || "leads").catch(() => ({}));
    await admin.from("activities").insert({
      customer_id: a.customer_id, order_id: a.order_id, kind: "email", direction: "out", subject: subject.slice(0, 500), body: (input.body || "").trim() || `(forwarded to ${to.join(", ")})`,
      from_email: from.email, to_email: to.join(", "), external_id: messageId, thread_id: a.thread_id || a.external_id, occurred_at: new Date().toISOString(),
      created_by: email || "staff", ai_processed_at: new Date().toISOString(), meta: { mailbox: "sent", via: "portal", forwarded: a.id, account_id: from.id, account: from.email, ...saved, html_checked: true },
    });
    return { ok: true as const, to };
  } catch (e) { return fail(e); }
}

/**
 * A new email (Oct 22, Nick: "how do you send a new email in the email client?"): to whoever you type, with Cc, a
 * subject, your message, your signature and files you attach (uploaded to storage first, then sent from there). From
 * your own mailbox, so it's in your Outlook Sent Items; kept on the customer's timeline when it's to a customer.
 */
export async function sendNewEmail(input: { to: string; cc?: string; subject: string; body: string; files?: { path: string; name: string; type?: string }[] }) {
  try {
    const v = await staff(), { admin, email, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const addrs = (s?: string) => [...new Set((String(s || "").match(/[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/gi) || []).map((x) => x.toLowerCase()))];
    const to = addrs(input.to).slice(0, 20);
    if (!to.length) return { ok: false as const, error: "Who should it go to? Type an email address." };
    const subject = String(input.subject || "").trim().slice(0, 500);
    if (!subject) return { ok: false as const, error: "Add a subject." };
    if (!String(input.body || "").trim() && !(input.files || []).length) return { ok: false as const, error: "Write the message first." };
    const from = await accountForUser(admin, user!.id);
    if (!from?.enabled) return { ok: false as const, error: "Connect your email in the Inbox first, so it can go out from your address." };
    const cc = cleanCc(addrs(input.cc), [...to, from.email]);
    const signature = from.signature_on !== false ? from.signature_html || "" : "";
    const page = replyHtml({ body: input.body || " ", signature, css: signature ? from.signature_css : "" });
    const { html, attachments } = inlineImages(page);
    const text = replyText({ body: input.body || "", signature });
    // the files you attached (up to 20 MB in all)
    const files: { filename: string; content: Buffer; contentType: string; contentDisposition: "attachment" }[] = [];
    let total = 0;
    for (const f of (input.files || []).slice(0, 15)) {
      if (!f?.path || f.path.includes("..")) continue;
      const { data: blob } = await admin.storage.from("proofs").download(f.path);
      if (!blob) continue;
      if (total + blob.size > 20_000_000) return { ok: false as const, error: "The attachments are over 20 MB. Send fewer or smaller files." };
      total += blob.size;
      files.push({ filename: f.name || "attachment", content: Buffer.from(await blob.arrayBuffer()), contentType: f.type || blob.type || "application/octet-stream", contentDisposition: "attachment" });
    }
    const { messageId } = await sendFromMailbox(cfgOf(from), { to: to.join(", "), cc: cc.join(", ") || undefined, subject, text, html, attachments: [...attachments, ...files] });
    // the customer it's to (their email, or one of their contacts), for their timeline
    const { data: c1 } = await admin.from("customers").select("id").in("email", to).limit(1);
    let customerId = (c1?.[0]?.id as string) || null;
    if (!customerId) { const { data: c2 } = await admin.from("customer_contacts").select("customer_id").in("email", to).limit(1); customerId = (c2?.[0]?.customer_id as string) || null; }
    const saved = await saveBody(admin, { html: page, attachments: [] }, customerId || "leads").catch(() => ({}));
    await admin.from("activities").insert({
      customer_id: customerId, kind: "email", direction: "out", subject, body: (input.body || "").trim() || "(attachments)",
      from_email: from.email, to_email: to.join(", "), external_id: messageId, thread_id: messageId, occurred_at: new Date().toISOString(),
      created_by: email || "staff", ai_processed_at: new Date().toISOString(),
      meta: { mailbox: "sent", via: "portal", new_email: true, account_id: from.id, account: from.email, ...(cc.length ? { cc } : {}), ...((input.files || []).length ? { attachments: (input.files || []).map((f) => ({ name: f.name, path: f.path, type: f.type || "" })) } : {}), ...saved, html_checked: true },
    });
    if (customerId) await closeWrittenTo(admin, to, new Date().toISOString(), email || "staff").catch(() => null);
    return { ok: true as const, to };
  } catch (e) { return fail(e); }
}

/** your signature as it'll go on replies (and whether it's on) */
export async function getSignature() {
  try {
    const { admin, user } = await staff();
    const a = await accountForUser(admin, user!.id);
    if (!a) return { ok: true as const, html: "", css: "", on: false, at: null as string | null, connected: false };
    return { ok: true as const, html: a.signature_html || "", css: a.signature_css || "", on: a.signature_on !== false, at: a.signature_at || null, connected: a.enabled };
  } catch (e) { return fail(e); }
}

/** read your signature again from the emails you've sent from Outlook */
export async function refreshSignature() {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const a = await accountForUser(admin, user!.id);
    if (!a?.enabled) return { ok: false as const, error: "Connect your email first." };
    const r = await detectSignature(admin, a.id);
    if (!r.sig) return { ok: false as const, error: r.looked < 2
      ? "There aren't enough emails you've sent to customers from Outlook yet. Send a couple from Outlook (with your signature), give it a few minutes, and try again."
      : "Couldn't find a signature your recent Outlook emails share. Check that Outlook adds it to replies (File → Options → Mail → Signatures), send one more, and try again." };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** signature on replies sent from the portal: on or off */
export async function setSignatureOn(on: boolean) {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const a = await accountForUser(admin, user!.id);
    if (a) await admin.from("mail_accounts").update({ signature_on: on }).eq("id", a.id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Email settings: how your replies end, and whether the AI writes as you or as the shop */
export async function getMailPrefs() {
  try {
    const { admin, user } = await staff();
    const a = await accountForUser(admin, user!.id);
    return { ok: true as const, connected: !!a, signOff: a?.sign_off ?? "Thanks,", writeAs: (a?.write_as === "shop" ? "shop" : "me") as "me" | "shop", name: a?.name || "" };
  } catch (e) { return fail(e); }
}
export async function setMailPrefs(input: { signOff?: string; writeAs?: "me" | "shop" }) {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const a = await accountForUser(admin, user!.id);
    if (!a) return { ok: false as const, error: "Connect your email first." };
    const row: Record<string, string> = {};
    if (input.signOff !== undefined) row.sign_off = input.signOff.replace(/\s+$/, "").slice(0, 120);
    if (input.writeAs) row.write_as = input.writeAs === "shop" ? "shop" : "me";
    await admin.from("mail_accounts").update(row).eq("id", a.id);
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

/**
 * "This is someone at <customer>": the sender becomes a contact on that customer's account (not a new account),
 * and their email goes to that customer from now on.
 */
export async function setEmailCustomer(activityId: string, customerId: string) {
  try {
    const { admin, email } = await staff();
    const { data: a } = await admin.from("activities").select("id, from_email, meta").eq("id", activityId).maybeSingle();
    if (!a?.from_email) return { ok: false as const, error: "That email isn't on file." };
    await admin.from("mail_senders").upsert({ email: (a.from_email as string).toLowerCase(), kind: "customer", customer_id: customerId, decided_by: email || "staff", decided_at: new Date().toISOString() });
    await admin.from("activities").update({ customer_id: customerId, meta: { ...((a.meta || {}) as object), lead: false, match: "override" } }).eq("from_email", a.from_email).is("customer_id", null);
    await admin.from("ai_suggestions").update({ customer_id: customerId }).eq("activity_id", a.id);
    const added = await addContact(admin, customerId, a.from_email as string, ((a.meta || {}) as { from_name?: string }).from_name || "", true);
    return { ok: true as const, added };
  } catch (e) { return fail(e); }
}

/** read your mailbox now instead of waiting for the next 2-minute check */
export async function checkMailNow() {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
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


/** Messages → Save to project (Oct 14): the email is kept with the customer's project (shown on the project page) */
export async function setEmailProject(activityId: string, projectId: string | null) {
  try {
    const { admin } = await staff();
    const { error } = await admin.from("activities").update({ project_id: projectId }).eq("id", activityId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Messages → Add to order notes (Oct 14): who wrote, when, and what they said (the AI's summary, or the start of the
 *  email) appended to the order's notes; the email is filed under that order too */
export async function addEmailToOrderNotes(activityId: string, orderId: string) {
  try {
    const { admin } = await staff();
    const [{ data: a }, { data: o }] = await Promise.all([
      admin.from("activities").select("id, from_email, subject, body, occurred_at, meta").eq("id", activityId).maybeSingle(),
      admin.from("orders").select("id, number, notes").eq("id", orderId).maybeSingle(),
    ]);
    if (!a || !o) return { ok: false as const, error: "That email or order isn't there any more." };
    const meta = (a.meta || {}) as { from_name?: string; triage?: { summary?: string } };
    const when = new Date(a.occurred_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    const what = (meta.triage?.summary || String(a.body || "").replace(/\s+/g, " ").trim().slice(0, 600)).trim();
    const line = `From ${meta.from_name || a.from_email}'s email (${when}, "${String(a.subject || "").slice(0, 80)}"): ${what}`;
    if (String(o.notes || "").includes(line)) return { ok: true as const, number: o.number as number };
    const notes = [String(o.notes || "").trim(), line].filter(Boolean).join("\n").slice(0, 8000);
    const { error } = await admin.from("orders").update({ notes }).eq("id", orderId);
    if (error) return { ok: false as const, error: error.message };
    await admin.from("activities").update({ order_id: orderId }).eq("id", activityId).is("order_id", null);
    return { ok: true as const, number: o.number as number };
  } catch (e) { return fail(e); }
}

export type InboxItem = { id: string; uid: number; from_email: string; from_name: string; subject: string; received_at: string | null; cc_only: boolean; unread: boolean; flagged: boolean; activity_id: string | null; bucket: string | null; summary: string; /** a file attached (the list's paperclip) */ has_attachments?: boolean;
  /** who else it went to (To and Cc, names and addresses), for the list's search (Oct 21, Nick: "when I search Alvin, this email doesn't come up") */ people?: string;
  /** from someone at a customer (their email or a contact on file), even before it's linked (Oct 24, Nick: "I've got 10 emails from Dear Heart Designs… you're only showing 6") */ customer?: boolean;
  /** a calendar invite or an evite (Oct 24, Nick: "events should just be when someone sends us a calendar invite… or an evite") */ invite?: boolean };

/** your Outlook Inbox as it is right now (the mirror, refreshed every mailbox check): your to-do list */
export async function getOutlookInbox(quick = false) {
  try {
    const v = await staff(), { admin } = v;
    const { acct: a } = await mailboxToRead(admin, v);
    if (!a || !a.enabled) return { ok: true as const, items: [] as InboxItem[], connected: false };
    // drop what SaneBox / Outlook already moved out (EWS, under a second); never holds the list up for long
    { const { addInboxEws, pruneInboxEws, relinkInboxLeads } = await import("@/lib/mail/mirror");
      await Promise.race([Promise.all([
        pruneInboxEws(admin, a).catch((e) => console.warn("pruneInboxEws", e instanceof Error ? e.message : e)),
        // new Inbox email straight from Exchange, in case the regular check can't read the Inbox (Oct 20)
        addInboxEws(admin, a).catch((e) => console.warn("addInboxEws", e instanceof Error ? e.message : e)),
        // someone who wasn't a customer when they wrote, and is now: their emails are linked (no "New sender")
        quick ? Promise.resolve() : relinkInboxLeads(admin, a).catch((e) => console.warn("relinkInboxLeads", e instanceof Error ? e.message : e)),
      ]), new Promise((r) => setTimeout(r, 4000))]); }
    const { data } = await admin.from("mail_inbox").select("id, uid, from_email, from_name, subject, received_at, cc_only, unread, flagged, activity_id, bucket, summary, has_attachments, message_id")
      .eq("account_id", a.id).is("gone_at", null).order("received_at", { ascending: false, nullsFirst: false }).limit(500);
    const rows = (data || []) as (InboxItem & { message_id?: string })[];
    // To and Cc from our copy of the mailbox (mail_cache), so searching the list finds someone who was only copied
    const ids = [...new Set(rows.map((r) => r.message_id || "").filter(Boolean))];
    const people = new Map<string, string>(), invites = new Set<string>();
    const INVITE_FROM = /@(evite\.com|.*\.evite\.com|paperlesspost\.com|punchbowl\.com|greenvelope\.com|joinpaperlesspost\.com)$/i;
    await Promise.race([Promise.all(Array.from({ length: Math.ceil(ids.length / 80) }, async (_, i) => {
      const { data: c } = await admin.from("mail_cache").select("message_id, to_text, cc_text, attachments").eq("account_id", a.id).in("message_id", ids.slice(i * 80, i * 80 + 80));
      for (const x of (c || []) as { message_id: string; to_text: string; cc_text: string; attachments: { name?: string; type?: string }[] | null }[]) {
        people.set(x.message_id, `${x.to_text} ${x.cc_text}`.trim());
        // a calendar invite carries a calendar part (text/calendar, an .ics file)
        if ((x.attachments || []).some((f) => /calendar|ics/i.test(String(f.type || "")) || /\.ics$/i.test(String(f.name || "")))) invites.add(x.message_id);
      }
    })).catch(() => null), new Promise((r) => setTimeout(r, 3000))]);
    // who's a customer: their email, a second email or a contact on the customer's file (linking the email to the
    // customer happens in the background, lib/mail/mirror.ts linkCustomerInbox)
    const unlinked = [...new Set(rows.filter((r) => !r.activity_id).map((r) => (r.from_email || "").trim().toLowerCase()).filter(Boolean))];
    const known = new Set<string>();
    if (unlinked.length) await Promise.race([(async () => {
      const [{ data: c1 }, { data: c2 }, { data: k }] = await Promise.all([
        admin.from("customers").select("email").in("email", unlinked),
        admin.from("customers").select("contact2_email").in("contact2_email", unlinked),
        admin.from("customer_contacts").select("email").in("email", unlinked),
      ]);
      for (const x of [...(c1 || []).map((y) => y.email), ...(c2 || []).map((y) => y.contact2_email), ...(k || []).map((y) => y.email)]) if (x) known.add(String(x).toLowerCase());
    })().catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
    const items: InboxItem[] = rows.map(({ message_id, ...r }) => ({
      ...r, people: (message_id && people.get(message_id)) || "",
      customer: !!r.activity_id || known.has((r.from_email || "").trim().toLowerCase()),
      invite: (!!message_id && invites.has(message_id)) || INVITE_FROM.test(r.from_email || "") || /^(invitation|updated invitation|new event|event invitation)\b|you('|’)re invited|\binvited you\b/i.test(r.subject || ""),
    }));
    return { ok: true as const, items, connected: true, checked: a.last_ok_at };
  } catch (e) { return fail(e); }
}

/**
 * Just the unread count for the menu's Email badge (Oct 16): a count, no Outlook check and no list. The menu used to call
 * getOutlookInbox on every page, which talked to Outlook for up to 4 s and sent back 500 emails, and server actions
 * run one at a time, so every page's own loading waited behind it.
 */
export async function getInboxUnread() {
  try {
    const v = await staff(), { admin } = v;
    const { acct: a } = await mailboxToRead(admin, v);
    if (!a || !a.enabled) return { ok: true as const, unread: 0 };
    const { count } = await admin.from("mail_inbox").select("id", { count: "exact", head: true }).eq("account_id", a.id).is("gone_at", null).eq("unread", true);
    return { ok: true as const, unread: count || 0 };
  } catch (e) { return fail(e); }
}

/** Archive: moves the email to Archive in your Outlook, the same as Outlook's Archive button (by row, or by the customer email on file) */
export async function archiveOutlookEmail(input: { id?: string; activityId?: string; to?: MoveTo; /** Black Hole on a customer, after the page asked */ confirmed?: boolean }) {
  try {
    const v = await staff(), { admin, user, email } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    const a = await accountForUser(admin, user!.id);
    if (!a || !a.enabled) return { ok: false as const, error: "Connect your email first." };
    let id = input.id || "";
    if (!id && input.activityId) {
      const { data } = await admin.from("mail_inbox").select("id").eq("account_id", a.id).eq("activity_id", input.activityId).is("gone_at", null).limit(1).maybeSingle();
      id = (data?.id as string) || "";
    }
    if (!id) return { ok: false as const, error: "That email isn't in your Outlook Inbox." };
    const to: MoveTo = input.to && input.to in MOVES ? input.to : "archive";
    // never Black Hole a customer without asking (Oct 14, Nick)
    if (to === "blackhole" && !input.confirmed) {
      const { data: row } = await admin.from("mail_inbox").select("from_email, activity_id").eq("id", id).maybeSingle();
      const { data: act } = row?.activity_id ? await admin.from("activities").select("customer_id").eq("id", row.activity_id).maybeSingle() : { data: null };
      let custId = (act?.customer_id as string) || "";
      if (!custId && row?.from_email) { const { matchAddress } = await import("@/lib/mail/process"); const mm = await matchAddress(admin, String(row.from_email)).catch(() => null); custId = mm?.customerId && !mm.ignore ? mm.customerId : ""; }
      if (custId) { const { data: c } = await admin.from("customers").select("company, name").eq("id", custId).maybeSingle(); return { ok: false as const, error: `${c?.company || c?.name || "This sender"} is a customer. Open the email and press Black Hole there to confirm.` }; }
    }
    await archiveInbox(admin, a, id, email || "portal", to);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** an Inbox email the portal didn't keep (a sender it couldn't place): kept now, so the email's Actions work on it */
export async function keepInboxEmail(inboxId: string) {
  try {
    const v = await staff(), { admin } = v;
    const { acct: a } = await mailboxToRead(admin, v);
    if (!a || !a.enabled) return { ok: false as const, error: "Connect your email first." };
    const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id, activity_id").eq("id", inboxId).maybeSingle();
    if (!r || r.account_id !== a.id) return { ok: false as const, error: "That email isn't in your Inbox." };
    if (r.activity_id) return { ok: true as const, activityId: r.activity_id as string };
    const { simpleParser } = await import("mailparser");
    const { toMsg } = await import("@/lib/mail/imap");
    const { keepIncoming } = await import("@/lib/mail/process");
    let raw: Buffer | null = null;
    const { ewsReady, ewsMimeByMessageId } = await import("@/lib/mail/ewsBox");
    if (r.message_id && (await ewsReady(admin, a))) raw = await ewsMimeByMessageId(a, String(r.message_id)).catch(() => null);
    if (!raw) {
      const { withBox } = await import("@/lib/mail/folders");
      raw = await withBox(a, async (c) => { const lock = await c.getMailboxLock("INBOX"); try { const m = await c.fetchOne(String(r.uid), { source: true }, { uid: true }); return m && m.source ? Buffer.from(m.source) : null; } finally { lock.release(); } }, Date.now() + 40000).catch(() => null);
    }
    if (!raw) return { ok: false as const, error: "Couldn't read that email from your mailbox. Try again in a minute." };
    const m = toMsg(await simpleParser(raw));
    const id = await keepIncoming(admin, m, { id: a.id, email: a.email });
    await admin.from("mail_inbox").update({ activity_id: id }).eq("id", r.id);
    return { ok: true as const, activityId: id };
  } catch (e) { return fail(e); }
}

/**
 * An email from any folder (Archive, a customer folder, a search result) kept in the portal, so Create order works on
 * it exactly as from the Inbox (Oct 22, Nick: "if the email is not in the inbox and I go to create an order from it, it
 * does a whole separate task… I had to do it by hand"). Already kept (same message id): that one.
 */
export async function keepFolderEmail(input: { folder: string; uid: number; messageId?: string }) {
  try {
    const v = await staff(), { admin } = v;
    const { acct: a } = await mailboxToRead(admin, v);
    if (!a || !a.enabled) return { ok: false as const, error: "Connect your email first." };
    const mid = (input.messageId || "").trim();
    if (mid) {
      const b = mid.replace(/^<|>$/g, "");
      const { data: hit } = await admin.from("activities").select("id").eq("kind", "email").in("external_id", [b, `<${b}>`]).limit(1).maybeSingle();
      if (hit) return { ok: true as const, activityId: hit.id as string };
    }
    const { simpleParser } = await import("mailparser");
    const { toMsg } = await import("@/lib/mail/imap");
    const { keepIncoming } = await import("@/lib/mail/process");
    let raw: Buffer | null = null;
    const { ewsReady, ewsMimeByMessageId } = await import("@/lib/mail/ewsBox");
    if (mid && (await ewsReady(admin, a))) raw = await ewsMimeByMessageId(a, mid).catch(() => null);
    if (!raw) {
      const { withBox } = await import("@/lib/mail/folders");
      raw = await withBox(a, async (c) => { const lock = await c.getMailboxLock(input.folder); try { const m = await c.fetchOne(String(input.uid), { source: true }, { uid: true }); return m && m.source ? Buffer.from(m.source) : null; } finally { lock.release(); } }, Date.now() + 40000).catch(() => null);
    }
    if (!raw) return { ok: false as const, error: "Couldn't read that email from your mailbox. Try again in a minute." };
    const id = await keepIncoming(admin, toMsg(await simpleParser(raw)), { id: a.id, email: a.email });
    return { ok: true as const, activityId: id };
  } catch (e) { return fail(e); }
}

/** read any email in your Inbox, live from the mailbox (the portal doesn't keep non-customer mail) */
export async function readInboxEmail(id: string) {
  try {
    const v = await staff(), { admin } = v;
    const { acct: a } = await mailboxToRead(admin, v);
    if (!a || !a.enabled) return { ok: false as const, error: "Connect your email first." };
    const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id").eq("id", id).maybeSingle();
    if (!r || r.account_id !== a.id) return { ok: false as const, error: "That email isn't in your Inbox." };
    const { readLive } = await import("@/lib/mail/read");
    const m = await readLive(a, r as { uid: number; uidvalidity: number; message_id: string });
    if (!m) {
      // gone from the Inbox: take it off the list too (checked over EWS when it works for this mailbox)
      const { pruneInboxEws } = await import("@/lib/mail/mirror");
      const n = await pruneInboxEws(admin, a, true).catch(() => 0);
      return { ok: false as const, error: "It's not in your Inbox any more (archived or moved in Outlook?).", gone: n > 0 };
    }
    return { ok: true as const, ...m };
  } catch (e) { return fail(e); }
}

/** reply to any email in your Inbox (not only customers'): sent from your mailbox, threaded, with your signature */
export async function replyInboxEmail(input: { id: string; body: string; subject?: string; cc?: string[] }) {
  try {
    const v = await staff(), { admin, user } = v;
    if (await viewedEmail(v)) return { ok: false as const, error: VIEWING_NO };
    if (!input.body.trim()) return { ok: false as const, error: "Write the reply first." };
    const a = await accountForUser(admin, user!.id);
    if (!a || !a.enabled) return { ok: false as const, error: "Connect your email first." };
    const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id").eq("id", input.id).maybeSingle();
    if (!r || r.account_id !== a.id) return { ok: false as const, error: "That email isn't in your Inbox." };
    const { readLive } = await import("@/lib/mail/read");
    const m = await readLive(a, r as { uid: number; uidvalidity: number; message_id: string });
    if (!m || !m.fromAddress) return { ok: false as const, error: "Couldn't open that email to reply to it." };
    const subject = input.subject || (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`);
    const sent = m.date ? new Date(m.date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ") : "";
    const quote = { from: m.from, sent, to: m.to || a.email, cc: m.cc, subject: m.subject, html: m.html.length < 1_500_000 ? m.html : "", text: m.text };
    const signature = a.signature_on !== false ? a.signature_html || "" : "";
    const page = replyHtml({ body: input.body, signature, css: signature ? a.signature_css : "", quote });
    const { html, attachments } = inlineImages(page);
    const text = replyText({ body: input.body, signature, quote });
    const refs = [...m.references, m.messageId].filter(Boolean).slice(-20);
    const cc = cleanCc(input.cc, [m.fromAddress, a.email]);
    await sendFromMailbox(cfgOf(a), { to: m.fromAddress, cc: cc.join(", ") || undefined, subject, text, html, attachments, inReplyTo: m.messageId || undefined, references: refs });
    return { ok: true as const, to: m.fromAddress };
  } catch (e) { return fail(e); }
}

/**
 * Cc suggestions (Oct 12): the team. Everyone on staff, plus the shop addresses that have written to you lately
 * (Claudia isn't on the portal yet). Not you.
 */
export async function ccTeam() {
  try {
    const { admin, email } = await staff();
    const me = (email || "").toLowerCase();
    const [{ data: st }, { data: seen }] = await Promise.all([
      admin.from("staff").select("email, name"),
      admin.from("mail_inbox").select("from_email, from_name").ilike("from_email", "%@fbsprint.com").gte("received_at", new Date(Date.now() - 120 * 864e5).toISOString()).limit(400),
    ]);
    const out = new Map<string, TeamMember>();
    const nameOf = (n: string, e: string) => { const t = String(n || "").replace(/["']/g, "").trim(); const flip = /^([^,]+),\s*(.+)$/.exec(t); return (flip ? `${flip[2]} ${flip[1]}` : t) || e.split("@")[0].replace(/^./, (c) => c.toUpperCase()); };
    for (const x of (st || []) as { email: string; name: string | null }[]) out.set(x.email.toLowerCase(), { email: x.email.toLowerCase(), name: nameOf(x.name || "", x.email) });
    for (const x of (seen || []) as { from_email: string; from_name: string | null }[]) { const e = x.from_email.toLowerCase(); if (!out.has(e) || !out.get(e)!.name.includes(" ")) out.set(e, { email: e, name: nameOf(x.from_name || "", e) }); }
    out.delete(me);
    return { ok: true as const, team: [...out.values()].filter((x) => !/^(no-?reply|notifications?|info|orders?|sales)@/.test(x.email)).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (e) { return fail(e); }
}

/**
 * Add to customer (Oct 26, Nick: "for everybody's email… there should be a button… add customer… it's basically add a
 * contact automatically to a customer. It pulls up the customer. You enter the name or number if you got it"). Works
 * from any email in any folder (it doesn't have to be in the portal yet): the person goes on the customer's contacts
 * (or a new customer is made for them), and their email is matched to that customer from now on.
 */
export async function addSenderToCustomer(input: { email: string; name?: string; phone?: string; title?: string; customerId?: string | null; newCompany?: string }) {
  try {
    const { admin, email: me } = await staff();
    const e = String(input.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false as const, error: "That email address doesn't look right." };
    const name = String(input.name || "").trim().slice(0, 120), phone = String(input.phone || "").trim().slice(0, 40), title = String(input.title || "").trim().slice(0, 80);
    let customerId = input.customerId || null, label = "";
    if (!customerId) {
      const company = String(input.newCompany || "").trim();
      if (!company && !name) return { ok: false as const, error: "Pick a customer, or type the new customer's company." };
      const { data: c, error } = await admin.from("customers").insert({ company: company || name, name, email: e, phone }).select("id, company, name").single();
      if (error || !c) return { ok: false as const, error: error?.message || "Couldn't make the customer." };
      customerId = c.id as string; label = String(c.company || c.name || "");
    } else {
      const { data: c } = await admin.from("customers").select("id, company, name, email").eq("id", customerId).maybeSingle();
      if (!c) return { ok: false as const, error: "That customer isn't on file." };
      label = String(c.company || c.name || "");
      if (String(c.email || "").toLowerCase() !== e) {
        const { data: have } = await admin.from("customer_contacts").select("id, name, phone, title").eq("customer_id", customerId).ilike("email", e).is("removed_at", null).limit(1).maybeSingle();
        if (have) {
          // already a contact: fill in what we didn't have
          const patch: Record<string, string> = {};
          if (name && !have.name) patch.name = name;
          if (phone && !have.phone) patch.phone = phone;
          if (title && !have.title) patch.title = title;
          if (Object.keys(patch).length) await admin.from("customer_contacts").update(patch).eq("id", have.id);
        } else {
          const { error } = await admin.from("customer_contacts").insert({ customer_id: customerId, email: e, name, phone: phone || null, title: title || null, portal_access: false });
          if (error) return { ok: false as const, error: error.message };
        }
      }
    }
    // their email is this customer's from now on, and what's already in the portal from them moves onto it
    await admin.from("mail_senders").upsert({ email: e, kind: "customer", customer_id: customerId, decided_by: me || "staff", decided_at: new Date().toISOString() });
    const { data: acts } = await admin.from("activities").select("id, meta").eq("from_email", e).is("customer_id", null).limit(500);
    for (const a of (acts || []) as { id: string; meta: Record<string, unknown> | null }[]) await admin.from("activities").update({ customer_id: customerId, meta: { ...(a.meta || {}), lead: false, match: "override" } }).eq("id", a.id);
    await admin.from("ai_suggestions").update({ customer_id: customerId }).in("activity_id", ((acts || []) as { id: string }[]).map((a) => a.id));
    return { ok: true as const, customerId: customerId as string, customer: label };
  } catch (e) { return fail(e); }
}
