import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { cfgOf, type MailAccount, type MailCfg } from "./config";
import { handleIncoming, handleSent, type MailMsg, type Outcome } from "./process";

export function imapClient(c: MailCfg) {
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

const FIRST_DAYS = 7, PER_RUN = 40, MAX_BYTES = 45 * 1024 * 1024;

/** read one mailbox's new mail in the Inbox and Sent Items since its last run (the first run goes back a week) */
export async function syncAccount(admin: SupabaseClient, acct: MailAccount, deadline: number) {
  const c = cfgOf(acct), st = { ...acct };
  const tally: Record<string, number> = {};
  const client = imapClient(c);
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
      } finally { lock.release(); }
    }
  } finally { await client.logout().catch(() => null); }
  return tally;
}
