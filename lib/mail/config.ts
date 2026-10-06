import "server-only";

/**
 * The shop mailbox the portal reads and sends from: Nicholas's Intermedia hosted Exchange mailbox, over IMAP (993,
 * SSL) and SMTP (587, STARTTLS). Server names are in HostPilot → Services → Mailboxes → (user) → server settings.
 * Vercel env: MAIL_PASSWORD (Nicholas adds it himself), optionally MAIL_USER, MAIL_IMAP_HOST, MAIL_SMTP_HOST,
 * MAIL_FROM_NAME. Nothing works until MAIL_PASSWORD is set.
 */
export function mailConfig() {
  const user = (process.env.MAIL_USER || "nicholas@fbsprint.com").trim();
  const pass = process.env.MAIL_PASSWORD || "";
  const imapHost = (process.env.MAIL_IMAP_HOST || "east.exch021.serverdata.net").trim();
  const smtpHost = (process.env.MAIL_SMTP_HOST || imapHost).trim();
  return {
    user, pass, imapHost, smtpHost,
    imapPort: +(process.env.MAIL_IMAP_PORT || 993), smtpPort: +(process.env.MAIL_SMTP_PORT || 587),
    fromName: process.env.MAIL_FROM_NAME || "Nicholas | FBS Print",
    ready: !!pass,
  };
}
export const mailReady = () => mailConfig().ready;
