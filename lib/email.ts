import "server-only";

/**
 * Sends an email through Brevo (BREVO_API_KEY) or Resend (RESEND_API_KEY), whichever is set.
 * Returns false when email is off or the send fails.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string; replyTo?: string }) {
  const from = process.env.EMAIL_FROM || "";
  if (!opts.to || !from) return false;
  try {
    if (process.env.BREVO_API_KEY) {
      // EMAIL_FROM looks like: FBS Print <orders@fbsprint.com>
      const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      const sender = m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender, to: [{ email: opts.to }], subject: opts.subject, htmlContent: opts.html, replyTo: opts.replyTo ? { email: opts.replyTo } : undefined }),
      });
      return res.ok;
    }
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, reply_to: opts.replyTo }),
      });
      return res.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Simple branded email body with one button. */
export function emailLayout(shopName: string, heading: string, body: string, buttonLabel: string, url: string) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#141D2B">
  <div style="font-weight:800;font-size:18px;letter-spacing:.02em;margin-bottom:18px">${escape(shopName)}</div>
  <h1 style="font-size:20px;margin:0 0 10px">${escape(heading)}</h1>
  <div style="font-size:15px;line-height:1.5;color:#3C475A;white-space:pre-line">${escape(body)}</div>
  <p style="margin:24px 0"><a href="${url}" style="background:#0A7BA6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block">${escape(buttonLabel)}</a></p>
  <div style="font-size:12px;color:#7A8599">Or open this link: ${url}</div>
</div>`;
}
