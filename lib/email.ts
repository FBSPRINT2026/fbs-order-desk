import "server-only";

/** Sends an email through Resend when RESEND_API_KEY is set. Returns false when email is off or fails. */
export async function sendEmail(opts: { to: string; subject: string; html: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !opts.to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, reply_to: opts.replyTo }),
    });
    return res.ok;
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
