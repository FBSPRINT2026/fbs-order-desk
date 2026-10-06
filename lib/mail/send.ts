import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MailCfg } from "./config";
import { imapClient, sentFolder } from "./imap";

/**
 * Send an email from a staff member's own mailbox over SMTP, as a reply in the customer's thread when
 * inReplyTo/references are given, and put a copy in Sent Items so it shows in Outlook like any other reply.
 */
export async function sendFromMailbox(c: MailCfg, o: { to: string; cc?: string; subject: string; text: string; inReplyTo?: string; references?: string[] }) {
  const messageId = `<${crypto.randomUUID()}@fbsprint.com>`;
  const mail = {
    from: { name: c.fromName, address: c.user }, to: o.to, cc: o.cc || undefined, subject: o.subject, text: o.text,
    inReplyTo: o.inReplyTo || undefined, references: o.references?.length ? o.references : undefined, messageId, date: new Date(),
  };
  const smtp = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, requireTLS: c.smtpPort !== 465, auth: { user: c.user, pass: c.pass } });
  await smtp.sendMail(mail);
  // a copy in Sent Items (SMTP doesn't keep one); the next mailbox read sees it and skips it as already on file
  try {
    const raw = await new MailComposer(mail).compile().build();
    const client = imapClient(c);
    await client.connect();
    try { await client.append(await sentFolder(client), raw, ["\\Seen"]); } finally { await client.logout().catch(() => null); }
  } catch { /* sent anyway; only the Outlook copy is missing */ }
  return { messageId };
}
