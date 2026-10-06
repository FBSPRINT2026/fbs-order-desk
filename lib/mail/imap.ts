import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { mailConfig } from "./config";
import { handleIncoming, handleSent, type MailMsg, type Outcome } from "./process";

export function imapClient() {
  const c = mailConfig();
  return new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 40000 });
}

/** the Sent Items folder (special-use \Sent, else by name) */
export async function sentFolder(client: ImapFlow) {
  const list = await client.list();
  return (list.find((f) => f.specialUse === "\\Sent") || list.find((f) => /^sent( items| messages)?$/i.test(f.name)) || list.find((f) => /sent/i.test(f.path)))?.path || "Sent Items";
}

const addrs = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value || []).map((v) => ({ address: (v.address || "").toLowerCase(), name: v.name || "" })).filter((v) => v.address);
function toMsg(p: ParsedMail): MailMsg {
  const headers: Record<string, string> = {};
  p.headers.forEach((v, k) => { headers[k.toLowerCase()] = typeof v === "string" ? v : JSON.stringify(v); });
  const refs = Array.isArray(p.references) ? p.references : p.references ? String(p.references).split(/\s+/) : [];
  return {
    messageId: p.messageId || "", inReplyTo: p.inReplyTo || "", references: refs.filter(Boolean), date: p.date || new Date(),
    from: addrs(p.from)[0] || { address: "", name: "" }, to: addrs(p.to), cc: addrs(p.cc), subject: p.subject || "",
    text: (p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : "")).trim(),
    headers,
    attachments: (p.attachments || []).map((a) => ({ filename: a.filename || "", contentType: a.contentType || "", size: a.size || a.content?.length || 0, content: a.content, inline: a.contentDisposition === "inline" || !!a.cid })),
  };
}

type State = { inbox_validity: number | null; inbox_uid: number | null; sent_folder: string | null; sent_validity: number | null; sent_uid: number | null; mailbox: string };
const FIRST_DAYS = 7, PER_RUN = 40, MAX_BYTES = 45 * 1024 * 1024;

/** read new mail in the Inbox and Sent Items since the last run (the first run goes back a week) */
export async function syncMailbox(admin: SupabaseClient, deadline: number) {
  const c = mailConfig();
  const { data } = await admin.from("mail_sync").select("inbox_validity, inbox_uid, sent_folder, sent_validity, sent_uid, mailbox").eq("id", 1).single();
  const st = data as State;
  const tally: Record<string, number> = {};
  const client = imapClient();
  await client.connect();
  try {
    if (st.mailbox !== c.user) { st.inbox_validity = st.inbox_uid = st.sent_validity = st.sent_uid = null; await admin.from("mail_sync").update({ mailbox: c.user, inbox_validity: null, inbox_uid: null, sent_validity: null, sent_uid: null, sent_folder: null }).eq("id", 1); }
    const sent = st.sent_folder || (await sentFolder(client));
    if (sent !== st.sent_folder) await admin.from("mail_sync").update({ sent_folder: sent }).eq("id", 1);
    for (const [path, kind] of [["INBOX", "inbox"], [sent, "sent"]] as const) {
      if (Date.now() > deadline) break;
      const lock = await client.getMailboxLock(path);
      try {
        const mb = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
        const validity = Number(mb?.uidValidity || 0);
        const vKey = `${kind}_validity` as const, uKey = `${kind}_uid` as const;
        let last = st[vKey] === validity ? st[uKey] : null;
        const found = last == null
          ? await client.search({ since: new Date(Date.now() - FIRST_DAYS * 864e5) }, { uid: true })
          : await client.search({ uid: `${last + 1}:*` }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).filter((u) => last == null || u > last).sort((a, b) => a - b).slice(0, PER_RUN);
        if (last == null && !uids.length) { last = Number(mb?.uidNext || 1) - 1; await admin.from("mail_sync").update({ [vKey]: validity, [uKey]: last }).eq("id", 1); }
        for (const uid of uids) {
          if (Date.now() > deadline) break;
          let outcome: Outcome | "too_big" | "error" = "skipped";
          try {
            const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
            if (!msg || !msg.source) outcome = "skipped";
            else if ((msg.size || 0) > MAX_BYTES) outcome = "too_big";
            else {
              const m = toMsg(await simpleParser(msg.source));
              outcome = kind === "inbox" ? await handleIncoming(admin, m, c.user) : await handleSent(admin, m);
            }
          } catch { outcome = "error"; }
          tally[`${kind}_${outcome}`] = (tally[`${kind}_${outcome}`] || 0) + 1;
          last = uid;
          await admin.from("mail_sync").update({ [vKey]: validity, [uKey]: uid }).eq("id", 1);
        }
      } finally { lock.release(); }
    }
  } finally { await client.logout().catch(() => null); }
  return tally;
}
