import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { cfgOf, type MailAccount, type MailCfg } from "./config";
import { handleIncoming, handleSent, saveAttachments, saveBody, type MailMsg, type Outcome } from "./process";
import { accountById } from "./config";
import { addInboxEws, mirrorInbox } from "./mirror";

/**
 * A connection to the mailbox. Its errors (a socket timeout, the server dropping it) are caught here: an "error" event
 * nobody listens to is an uncaught exception that crashes the whole server process, and every other request running in
 * it (Oct 12: socket timeouts crashed the process mid sign-in refresh, which logged Nick and Amanda out, and pages hung).
 * The step that was waiting on the connection still fails normally and is handled where it was called.
 */
export function imapClient(c: MailCfg, socketTimeout = 40000) {
  const client = new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout });
  client.on("error", (e: Error) => { console.warn("imap connection:", e?.message || e); });
  return client;
}

/** the Sent Items folder (special-use \Sent, else by name) */
export async function sentFolder(client: ImapFlow) {
  const list = await client.list();
  return (list.find((f) => f.specialUse === "\\Sent") || list.find((f) => /^sent( items| messages)?$/i.test(f.name)) || list.find((f) => /sent/i.test(f.path)))?.path || "Sent Items";
}

const addrs = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value || []).map((v) => ({ address: (v.address || "").toLowerCase(), name: v.name || "" })).filter((v) => v.address);
export function toMsg(p: ParsedMail): MailMsg {
  const headers: Record<string, string> = {};
  p.headers.forEach((v, k) => { headers[k.toLowerCase()] = typeof v === "string" ? v : JSON.stringify(v); });
  const refs = Array.isArray(p.references) ? p.references : p.references ? String(p.references).split(/\s+/) : [];
  return {
    messageId: p.messageId || "", inReplyTo: p.inReplyTo || "", references: refs.filter(Boolean), date: p.date || new Date(),
    from: addrs(p.from)[0] || { address: "", name: "" }, to: addrs(p.to), cc: addrs(p.cc), subject: p.subject || "",
    text: (p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : "")).trim(),
    headers, html: typeof p.html === "string" ? p.html : "",
    attachments: (p.attachments || []).map((a) => ({ filename: a.filename || "", contentType: a.contentType || "", size: a.size || a.content?.length || 0, content: a.content, inline: a.contentDisposition === "inline" || !!a.cid, cid: a.cid ? String(a.cid).replace(/^<|>$/g, "") : "" })),
  };
}

const FIRST_DAYS = 7, PER_RUN = 40, MAX_BYTES = 45 * 1024 * 1024;

/** read one mailbox's new mail in the Inbox and Sent Items since its last run (the first run goes back a week) */
export async function syncAccount(admin: SupabaseClient, acct: MailAccount, deadline: number) {
  const c = cfgOf(acct), st = { ...acct };
  const tally: Record<string, number> = {};
  const client = imapClient(c);
  // a hard stop a few seconds after the deadline: the connection closes even mid-step, so a slow step can't run the
  // check past the 60-second limit (Oct 12: one did, and a cut-off run leaves the connection open)
  const stop = setTimeout(() => { try { client.close(); } catch { /* closed */ } }, Math.max(3000, deadline - Date.now() + 6000));
  await client.connect();
  try {
    const sent = st.sent_folder || (await sentFolder(client));
    if (sent !== st.sent_folder) await admin.from("mail_accounts").update({ sent_folder: sent }).eq("id", acct.id);
    for (const [path, kind] of [["INBOX", "inbox"], [sent, "sent"]] as const) {
      if (Date.now() > deadline) break;
      const lock = await client.getMailboxLock(path);
      try {
        const mb = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
        const validity = Number(mb?.uidValidity || 0);
        const vKey = `${kind}_validity` as const, uKey = `${kind}_uid` as const;
        let last = Number(st[vKey]) === validity && st[uKey] != null ? Number(st[uKey]) : null;
        // the Outlook Inbox list first (it's what the Email page shows), with up to half the time; then new mail
        if (kind === "inbox") {
          try { const r = await mirrorInbox(admin, client, acct, validity, Math.min(deadline, Date.now() + Math.max(8000, (deadline - Date.now()) / 2))); if (r.gone) tally.inbox_archived = r.gone; if (r.sorted) tally.inbox_sorted = r.sorted; if (r.added) tally.inbox_listed = r.added; if (!r.inbox) { const n = await addInboxEws(admin, acct).catch(() => 0); if (n) tally.inbox_listed_ews = n; } }
          catch (e) {
            tally.inbox_mirror_error = 1;
            const m = e instanceof Error ? e.message : String(e);
            (/Connection not available|closed/i.test(m) ? console.warn : console.error)("mirrorInbox", acct.email, m);
          }
        }
        const found = last == null
          ? await client.search({ since: new Date(Date.now() - FIRST_DAYS * 864e5) }, { uid: true })
          : await client.search({ uid: `${last + 1}:*` }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).filter((u) => last == null || u > last).sort((a, b) => a - b).slice(0, PER_RUN);
        if (last == null && !uids.length) { last = Number(mb?.uidNext || 1) - 1; await admin.from("mail_accounts").update({ [vKey]: validity, [uKey]: last }).eq("id", acct.id); }
        for (const uid of uids) {
          if (Date.now() > deadline) break;
          let outcome: Outcome | "too_big" | "error" = "skipped";
          try {
            const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
            if (!msg || !msg.source) outcome = "skipped";
            else if ((msg.size || 0) > MAX_BYTES) outcome = "too_big";
            else {
              const m = toMsg(await simpleParser(msg.source));
              outcome = kind === "inbox" ? await handleIncoming(admin, m, { id: acct.id, email: acct.email }) : await handleSent(admin, m, { id: acct.id, email: acct.email });
            }
          } catch { outcome = "error"; }
          tally[`${kind}_${outcome}`] = (tally[`${kind}_${outcome}`] || 0) + 1;
          last = uid;
          await admin.from("mail_accounts").update({ [vKey]: validity, [uKey]: uid }).eq("id", acct.id);
        }
        // (the Outlook Inbox list ran first, above. "Connection not available" there is the hard stop closing the
        // connection at the time limit, or Outlook dropping it: the next run picks up, so it's a note, not an error)
        if (Date.now() < deadline - 8000) { const f = await backfillHtml(admin, client, acct.id, kind, deadline - 5000); if (f) tally[`${kind}_formatted`] = f; }
      } finally { lock.release(); }
    }
  } finally { clearTimeout(stop); await Promise.race([client.logout().catch(() => null), new Promise((r) => setTimeout(r, 3000))]); try { client.close(); } catch { /* closed */ } }
  return tally;
}

/**
 * Email stored before the portal kept the HTML (formatting, signatures, pictures): look each one up again by its
 * Message-ID in this folder and save the HTML beside it. A few per run, last 30 days; each is only tried once.
 */
async function backfillHtml(admin: SupabaseClient, client: ImapFlow, accountId: string, kind: "inbox" | "sent", deadline: number) {
  const { data } = await admin.from("activities").select("id, customer_id, external_id, meta")
    .eq("kind", "email").eq("meta->>account_id", accountId).eq("meta->>mailbox", kind).is("meta->>html", null).is("meta->>html_checked", null)
    .not("external_id", "is", null).gte("occurred_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("occurred_at", { ascending: false }).limit(12);
  let n = 0;
  for (const a of data || []) {
    if (Date.now() > deadline) break;
    let body: { html?: string; inline?: Record<string, string> } = {};
    try {
      const found = await client.search({ header: { "message-id": String(a.external_id) } }, { uid: true });
      const uid = Array.isArray(found) ? found[0] : undefined;
      if (uid) {
        const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
        if (msg && msg.source && (msg.size || 0) <= MAX_BYTES) body = await saveBody(admin, toMsg(await simpleParser(msg.source)), (a.customer_id as string) || "leads");
      }
    } catch { /* tried; shows as plain text */ }
    await admin.from("activities").update({ meta: { ...((a.meta || {}) as object), ...body, html_checked: true } }).eq("id", a.id);
    if (body.html) n++;
  }
  return n;
}

/**
 * Go back to the mailbox for one stored email and save the attachments the portal skipped when it came in
 * (before Oct 7 spreadsheets and documents weren't kept). Files already on file are not saved twice. Done once
 * per email (meta.att_checked); returns the email's attachment list.
 */
/** a mailbox that just failed isn't tried again for a while (per server instance) */
const mailboxDown = new Map<string, number>();
export async function refetchAttachments(admin: SupabaseClient, activityId: string) {
  const { data: a } = await admin.from("activities").select("id, customer_id, external_id, meta").eq("id", activityId).maybeSingle();
  const meta = ((a?.meta || {}) as { account_id?: string; mailbox?: string; attachments?: { name: string; path: string; type: string; size: number }[]; att_checked?: boolean });
  const have = meta.attachments || [];
  if (!a || meta.att_checked || !a.external_id || !meta.account_id) return have;
  // Oct 26, Nick: "Bring in the sizes only… it's taking forever": Nick's mailbox had been refusing connections, and
  // every read sat ~50s on the socket timeout before going on with the files already on file. Now it's a few seconds at
  // most, and a mailbox that just failed is skipped for 10 minutes.
  if ((mailboxDown.get(meta.account_id) || 0) > Date.now()) return have;
  const acct = await accountById(admin, meta.account_id);
  if (!acct || !acct.enabled) return have;
  const client = imapClient(cfgOf(acct), 8000);
  let got = have, timer: ReturnType<typeof setTimeout> | undefined;
  const limit = have.length ? 6000 : 15000;
  // the slow attempt keeps going after the race is lost: its later failure is caught so it can't crash the server
  const work = (async () => {
        await client.connect();
        const folder = meta.mailbox === "sent" ? acct.sent_folder || (await sentFolder(client)) : "INBOX";
        const lock = await client.getMailboxLock(folder);
        try {
          const found = await client.search({ header: { "message-id": String(a.external_id) } }, { uid: true });
          const uid = Array.isArray(found) ? found[0] : undefined;
          if (uid) {
            const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
            if (msg && msg.source && (msg.size || 0) <= MAX_BYTES) {
              const m = toMsg(await simpleParser(msg.source));
              const names = new Set(have.map((x) => x.name));
              const fresh = await saveAttachments(admin, { ...m, attachments: m.attachments.filter((x) => !names.has(x.filename)) }, (a.customer_id as string) || "leads");
              got = [...have, ...fresh];
            }
          }
        } finally { lock.release(); }
      })();
  work.catch(() => null);
  try {
    await Promise.race([work, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("mailbox too slow")), limit); })]);
  } catch { /* mailbox unreachable or slow: keep what's on file, try again later */ mailboxDown.set(meta.account_id, Date.now() + 10 * 60_000); clearTimeout(timer); client.close(); return have; }
  clearTimeout(timer);
  await Promise.race([client.logout().catch(() => null), new Promise((ok) => setTimeout(ok, 2000))]); client.close();
  await admin.from("activities").update({ meta: { ...meta, attachments: got, att_checked: true } }).eq("id", a.id);
  return got;
}
