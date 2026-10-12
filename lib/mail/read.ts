import "server-only";
import { simpleParser } from "mailparser";
import { cfgOf, type MailAccount } from "./config";
import { imapClient } from "./imap";

/**
 * One email straight from the person's Inbox (by its uid, checked by Message-ID): for reading non-customer mail in
 * the portal without keeping it. Pictures sent inside the email come back as data: images in the HTML.
 */
export async function readLive(acct: MailAccount, r: { uid: number; uidvalidity: number; message_id: string }) {
  const client = imapClient(cfgOf(acct));
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mb = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
      let uid: number | undefined = Number(mb?.uidValidity || 0) === Number(r.uidvalidity) ? Number(r.uid) : undefined;
      if (r.message_id) {
        const hit = await client.search({ header: { "message-id": r.message_id } }, { uid: true }).catch(() => [] as number[]);
        const list = Array.isArray(hit) ? hit : [];
        uid = list.length ? (uid && list.includes(uid) ? uid : list[0]) : uid;
      }
      if (!uid) return null;
      const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
      if (!msg || !msg.source) return null;
      if ((msg.size || 0) > 30 * 1024 * 1024) return { messageId: "", references: [] as string[], fromAddress: "", fromName: "", html: "", text: "This email is too big to show here. Open it in Outlook.", from: "", to: "", cc: "", subject: "", date: "", attachments: [] as { name: string; size: number }[] };
      const p = await simpleParser(msg.source);
      const addr = (a: unknown) => (Array.isArray(a) ? a : a ? [a] : []).map((x: { text?: string }) => x.text || "").filter(Boolean).join(", ");
      let html = typeof p.html === "string" ? p.html : "";
      if (html.length > 3_500_000) html = "";
      return {
        messageId: p.messageId || "", references: (Array.isArray(p.references) ? p.references : p.references ? String(p.references).split(/\s+/) : []).filter(Boolean) as string[],
        fromAddress: ((p.replyTo?.value?.[0]?.address || p.from?.value?.[0]?.address) || "").toLowerCase(), fromName: p.from?.value?.[0]?.name || "",
        html, text: (p.text || "").slice(0, 200000), from: addr(p.from), to: addr(p.to), cc: addr(p.cc), subject: p.subject || "", date: p.date ? p.date.toISOString() : "",
        attachments: (p.attachments || []).filter((x) => !(x.contentDisposition === "inline" && x.cid)).map((x) => ({ name: x.filename || "attachment", size: x.size || 0 })),
      };
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => null); }
}
