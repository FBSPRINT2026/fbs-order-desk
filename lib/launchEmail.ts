/**
 * The "It's here" email that tells customers about the new portal (Oct 25 2026, Nick picked the dark banner with the big
 * dashboard picture, the three-step login strip and four captioned screens). Plain tables and inline styles so it looks
 * the same in Gmail, Outlook and Apple Mail. The pictures live in public/email/launch/.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const LAUNCH_SUBJECT = "It's here: your new FBS Print customer portal";

export function launchEmailHtml(o: { site: string; portalUrl: string; firstName?: string; replyTo?: string }) {
  const img = (f: string) => `${o.site.replace(/\/$/, "")}/email/launch/${f}`;
  const F = "font-family:Helvetica,Arial,sans-serif";
  const hi = o.firstName ? `Hi ${esc(o.firstName)}, w` : "W";
  const step = (n: number, txt: string, color: string) => `<td width="33%" align="center" valign="top" style="padding:12px 6px 10px;border-bottom:4px solid ${color};${F};font-size:13px;line-height:1.35;color:#ffffff"><div style="font-size:11px;color:#AAB4C3;padding-bottom:3px">Step ${n}</div>${txt}</td>`;
  const tile = (f: string, alt: string, head: string, sub: string) => `<td width="50%" valign="top" style="padding:0 5px 16px">
      <img src="${img(f)}" width="262" alt="${alt}" style="display:block;width:100%;max-width:262px;height:auto;border:0;border-radius:8px">
      <div style="${F};font-size:13px;line-height:1.4;padding-top:6px;color:#141D2B"><b>${head}</b> <span style="color:#5B6678">${sub}</span></div></td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(LAUNCH_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Track orders, approve art, reorder and pay, all in one place. Your login is already set up.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F5"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td align="center" style="background:#141D2B;padding:30px 28px 20px;${F};color:#ffffff">
    <img src="${img("logo-white.png")}" width="64" height="64" alt="FBS Print" style="display:block;border:0;margin:0 auto">
    <div style="font-size:40px;line-height:1.1;font-weight:bold;padding-top:16px">It's here.</div>
    <div style="font-size:18px;line-height:1.4;color:#DDE3EA;padding-top:6px">Your new FBS Print customer portal</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 0"><tr><td width="50" height="5" style="background:#0e9bd8;font-size:0;line-height:0">&nbsp;</td><td width="50" height="5" style="background:#f26660;font-size:0;line-height:0">&nbsp;</td><td width="50" height="5" style="background:#fcb122;font-size:0;line-height:0">&nbsp;</td></tr></table>
  </td></tr>
  <tr><td style="padding:0;line-height:0;font-size:0">
    <a href="${o.portalUrl}"><img src="${img("hero.png")}" width="600" alt="The FBS Print customer portal dashboard" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a>
  </td></tr>
  <tr><td align="center" style="padding:22px 36px 0;${F};font-size:15px;line-height:1.55;color:#3A4558">${hi}e're excited to share it with you. Your orders, art, payments and messages, all in one place. <b style="color:#141D2B">If you got this email, your login is already set up.</b></td></tr>
  <tr><td style="padding:20px 28px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#141D2B;border-radius:10px;overflow:hidden"><tr>
      ${step(1, `Go to <a href="${o.portalUrl}" style="color:#ffffff;text-decoration:underline">portal.fbsprint.com</a>`, "#0e9bd8")}
      ${step(2, "Enter your email", "#f26660")}
      ${step(3, "Type the 6-digit code we email you", "#fcb122")}
    </tr></table>
    <div style="${F};font-size:12.5px;color:#7A8599;text-align:center;padding-top:8px">No password to remember. The code comes to this email address.</div>
  </td></tr>
  <tr><td style="padding:18px 23px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${tile("orders.png", "Your orders", "Track it.", "Every job, every step.")}${tile("artwork.png", "Your artwork", "Approve it.", "Proofs in a tap.")}</tr>
      <tr>${tile("reorder.png", "Order again", "Run it again.", "Past jobs, saved.")}${tile("payments.png", "Payments", "Pay it.", "Online, any time.")}</tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:10px 28px 8px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#0e9bd8;border-radius:8px"><a href="${o.portalUrl}" style="display:inline-block;padding:14px 36px;${F};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Open your portal</a></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:8px 30px 26px;${F};font-size:13px;line-height:1.5;color:#5B6678">Questions? Reply to this email or call us, and we'll walk you through it.</td></tr>
  <tr><td align="center" style="background:#141D2B;padding:16px 28px;${F};font-size:11.5px;line-height:1.6;color:#AAB4C3">FBS Print · 811 Alpha Dr, Ste 343, Richardson, TX 75081 · (972) 487-7858</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
