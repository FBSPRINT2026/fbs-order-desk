/**
 * The "It's here" email that tells customers about the new portal (Oct 25 2026, Nick picked the dark banner with the big
 * dashboard picture, the three-step login strip and four captioned screens; Oct 26 redone: one fade bar under the title
 * with room around it, the steps as three cards with their numbers on a fade line (no sample code), and four tiles drawn
 * like the portal: jobs, a real proof to approve (no little t-shirts), reorders and payments). Plain tables and inline
 * styles so it looks the same in Gmail, Outlook and Apple Mail; the fade bars and steps are pictures because Outlook
 * can't draw a fade. The pictures live in public/email/launch/.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const LAUNCH_SUBJECT = "It's here: your new FBS Print customer portal";

export function launchEmailHtml(o: { site: string; portalUrl: string; firstName?: string; replyTo?: string }) {
  const img = (f: string) => `${o.site.replace(/\/$/, "")}/email/launch/${f}`;
  const F = "font-family:Helvetica,Arial,sans-serif";
  const hi = o.firstName ? `Hi ${esc(o.firstName)}, w` : "W";
  const tile = (f: string, alt: string, sub: string) => `<td width="50%" valign="top" style="padding:0 6px 14px">
      <a href="${o.portalUrl}" style="text-decoration:none"><img src="${img(f)}" width="262" alt="${alt}" style="display:block;width:100%;max-width:262px;height:auto;border:0"></a>
      <div style="${F};font-size:13px;line-height:1.4;padding:6px 2px 0;color:#5B6678">${sub}</div></td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(LAUNCH_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Track orders, approve art, reorder and pay, all in one place. Your login is already set up.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F5"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td align="center" style="background:#141D2B;padding:32px 28px 30px;${F};color:#ffffff">
    <img src="${img("logo-white.png")}" width="64" height="64" alt="FBS Print" style="display:block;border:0;margin:0 auto">
    <div style="font-size:40px;line-height:1.1;font-weight:bold;padding-top:18px">It's here.</div>
    <div style="font-size:18px;line-height:1.4;color:#DDE3EA;padding-top:8px">Your new FBS Print customer portal</div>
    <img src="${img("fade-bar.png")}" width="180" height="5" alt="" style="display:block;width:180px;height:5px;border:0;margin:22px auto 0">
  </td></tr>
  <tr><td style="padding:0;line-height:0;font-size:0">
    <a href="${o.portalUrl}"><img src="${img("hero.png")}" width="600" alt="The FBS Print customer portal dashboard" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a>
  </td></tr>
  <tr><td align="center" style="padding:24px 40px 0;${F};font-size:15px;line-height:1.55;color:#3A4558">${hi}e're excited to share it with you: your orders, art, payments and messages, all in one place. <b style="color:#141D2B">Your login is already set up.</b></td></tr>
  <tr><td align="center" style="padding:26px 28px 0;${F};font-size:12px;font-weight:bold;letter-spacing:1px;color:#5B6678">SIGN IN IN THREE STEPS</td></tr>
  <tr><td style="padding:12px 28px 0">
    <a href="${o.portalUrl}" style="text-decoration:none"><img src="${img("steps.png")}" width="544" alt="1. Open the portal at portal.fbsprint.com. 2. Enter your email, the one this came to. 3. Type the code we email you." style="display:block;width:100%;max-width:544px;height:auto;border:0"></a>
    <div style="${F};font-size:12.5px;color:#7A8599;text-align:center;padding-top:10px">No password to remember. The code comes to this email address. <a href="${o.portalUrl}" style="color:#0e9bd8">portal.fbsprint.com</a></div>
  </td></tr>
  <tr><td align="center" style="padding:30px 28px 0">
    <img src="${img("fade-short.png")}" width="64" height="4" alt="" style="display:block;width:64px;height:4px;border:0;margin:0 auto">
    <div style="${F};font-size:20px;font-weight:bold;color:#141D2B;padding-top:12px">What you can do in it</div>
  </td></tr>
  <tr><td style="padding:16px 22px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${tile("orders.png", "Track every job", "Every job, from proof to pickup.")}${tile("artwork.png", "Approve your art", "See the proof, approve it in a tap.")}</tr>
      <tr>${tile("reorder.png", "Reorder in a click", "Same art, same specs, saved.")}${tile("payments.png", "Pay online", "Card or bank, any time. Statements too.")}</tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:14px 28px 8px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#0e9bd8;border-radius:8px"><a href="${o.portalUrl}" style="display:inline-block;padding:15px 42px;${F};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Open your portal</a></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:10px 30px 28px;${F};font-size:13px;line-height:1.5;color:#5B6678">Questions? Reply to this email or call us at (972) 487-7858, and we'll walk you through it.</td></tr>
  <tr><td style="background:#141D2B;padding:0;line-height:0;font-size:0"><img src="${img("fade-wide.png")}" width="600" height="4" alt="" style="display:block;width:100%;max-width:600px;height:4px;border:0"></td></tr>
  <tr><td align="center" style="background:#141D2B;padding:14px 28px 16px;${F};font-size:11.5px;line-height:1.6;color:#AAB4C3">FBS Print · 811 Alpha Dr, Ste 343, Richardson, TX 75081 · (972) 487-7858</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
