import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MailCfg } from "./config";
import { imapClient, sentFolder } from "./imap";

const smtpOf = (c: MailCfg) => nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, requireTLS: c.smtpPort !== 465, authMethod: "LOGIN", auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000 });

/** what a sending error means, in plain words (Intermedia turns SMTP off per mailbox until it's ticked in HostPilot) */
export function smtpProblem(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/535|5\.7\.3|Authentication unsuccessful|Invalid login/i.test(m)) return "Your mailbox isn't allowed to send from other apps yet. In HostPilot go to Services → Exchange → your name → Advanced Settings, tick SMTP (next to IMAP) and save. Then try again in a few minutes.";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(m)) return `Couldn't reach the mail server to send (${m}). Try again in a minute.`;
  return m;
}

/** can this mailbox send? (signs in to the outgoing server; sends nothing) */
export async function checkSending(c: MailCfg) {
  const smtp = smtpOf(c);
  try { await smtp.verify(); return null; } catch (e) { return smtpProblem(e); } finally { smtp.close(); }
}

/**
 * Send an email from a staff member's own mailbox over SMTP, as a reply in the customer's thread when
 * inReplyTo/references are given, and put a copy in Sent Items so it shows in Outlook like any other reply.
 */
export async function sendFromMailbox(c: MailCfg, o: {
  to: string; cc?: string; subject: string; text: string; html?: string; inReplyTo?: string; references?: string[];
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string; contentDisposition?: "inline" | "attachment" }[];
}) {
  const messageId = `<${crypto.randomUUID()}@fbsprint.com>`;
  const mail = {
    from: { name: c.fromName, address: c.user }, to: o.to, cc: o.cc || undefined, subject: o.subject, text: o.text, html: o.html || undefined, attachments: o.attachments?.length ? o.attachments : undefined,
    inReplyTo: o.inReplyTo || undefined, references: o.references?.length ? o.references : undefined, messageId, date: new Date(),
  };
  const smtp = smtpOf(c);
  try { await smtp.sendMail(mail); } catch (e) { throw new Error(smtpProblem(e)); }
  // a copy in Sent Items (SMTP doesn't keep one); the next mailbox read sees it and skips it as already on file
  try {
    const raw = await new MailComposer(mail).compile().build();
    const client = imapClient(c);
    await client.connect();
    try { await client.append(await sentFolder(client), raw, ["\\Seen"]); } finally { await client.logout().catch(() => null); }
  } catch { /* sent anyway; only the Outlook copy is missing */ }
  return { messageId };
}
