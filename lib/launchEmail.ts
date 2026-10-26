/**
 * The "It's here" email that tells customers about the new portal (Oct 25 2026, Nick picked the dark banner with the big
 * dashboard picture, the three-step login strip and four captioned screens; Oct 26 redone: the dashboard set into the dark band with a
 * full-width fade running behind it where the dark meets the white, the steps as three cards with their numbers on a fade line (no sample code), and four tiles drawn
 * like the portal: jobs, a real proof to approve (no little t-shirts), reorders and payments). Plain tables and inline
 * styles so it looks the same in Gmail, Outlook and Apple Mail; full width (Oct 26, Nick: "it fills your email pane… on
 * the phone, it's just a good mobile version"): the dark band, the color line and the footer run edge to edge, the rest
 * is 680 wide in the middle and shrinks on a phone; the fade bars and steps are pictures because Outlook
 * can't draw a fade. The pictures live in public/email/launch/.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const LAUNCH_SUBJECT = "It's here: your new FBS Print customer portal";

export function launchEmailHtml(o: { site: string; portalUrl: string; firstName?: string; replyTo?: string }) {
  const img = (f: string) => `${o.site.replace(/\/$/, "")}/email/launch/${f}`;
  const F = "font-family:Helvetica,Arial,sans-serif";
  const hi = o.firstName ? `Hi ${esc(o.firstName)}, w` : "W";
  const tile = (f: string, alt: string, sub: string) => `<td width="50%" valign="top" style="padding:0 6px 14px">
      <a href="${o.portalUrl}" style="text-decoration:none"><img src="${img(f)}" width="300" alt="${alt}" style="display:block;width:100%;max-width:300px;height:auto;border:0"></a>
      <div style="${F};font-size:13px;line-height:1.4;padding:6px 2px 0;color:#5B6678">${sub}</div></td>`;
  return `<!doctype html><html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(LAUNCH_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Track orders, approve art, reorder and pay, all in one place. Your login is already set up.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff">
  <tr><td align="center" bgcolor="#141D2B" style="background:#141D2B;padding:28px 20px 16px;${F};color:#ffffff">
    <img src="${img("logo-white.png")}" width="64" height="64" alt="FBS Print" style="display:block;border:0;margin:0 auto">
    <div style="font-size:42px;line-height:1;font-weight:bold;padding-top:16px;letter-spacing:-0.5px">It's here.</div>
    <div style="font-size:18px;line-height:1.3;color:#DDE3EA;padding-top:4px">Your new FBS Print customer portal</div>
  </td></tr>
  <tr><td align="center" bgcolor="#141D2B" style="background:#141D2B;padding:0 20px;line-height:0;font-size:0">
    <a href="${o.portalUrl}"><img src="${img("hero-top.png")}" width="680" alt="The FBS Print customer portal dashboard" style="display:block;width:100%;max-width:680px;height:auto;border:0"></a>
  </td></tr>
  <tr><td style="padding:0;line-height:0;font-size:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="33%" height="3" bgcolor="#0e9bd8" style="background:#0e9bd8;height:3px;line-height:3px;font-size:0;mso-line-height-rule:exactly">&nbsp;</td>
      <td width="34%" height="3" bgcolor="#f26660" style="background:#f26660;height:3px;line-height:3px;font-size:0;mso-line-height-rule:exactly">&nbsp;</td>
      <td width="33%" height="3" bgcolor="#fcb122" style="background:#fcb122;height:3px;line-height:3px;font-size:0;mso-line-height-rule:exactly">&nbsp;</td>
    </tr></table>
  </td></tr>
  <tr><td align="center" style="padding:0 20px;line-height:0;font-size:0">
    <a href="${o.portalUrl}"><img src="${img("hero-bottom.png")}" width="680" alt="" style="display:block;width:100%;max-width:680px;height:auto;border:0"></a>
  </td></tr>
  <tr><td align="center" style="padding:0 16px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px">
  <tr><td align="center" style="padding:24px 40px 0;${F};font-size:15px;line-height:1.55;color:#3A4558">${hi}e're excited to share it with you: your orders, art, payments and messages, all in one place. <b style="color:#141D2B">Your login is already set up.</b></td></tr>
  <tr><td align="center" style="padding:26px 28px 0;${F};font-size:12px;font-weight:bold;letter-spacing:1px;color:#5B6678">SIGN IN IN THREE STEPS</td></tr>
  <tr><td style="padding:12px 28px 0">
    <a href="${o.portalUrl}" style="text-decoration:none"><img src="${img("steps.png")}" width="624" alt="1. Open the portal at portal.fbsprint.com. 2. Enter your email, the one this came to. 3. Type the code we email you." style="display:block;width:100%;max-width:624px;height:auto;border:0"></a>
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
      <tr>${tile("devices.png", "Phone or computer: FBS On the go", "Mobile and full browser versions.")}${tile("messages.png", "Message us", "Talk to us right on the order.")}</tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:14px 28px 8px">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${o.portalUrl}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="16%" stroke="f" fillcolor="#0e9bd8"><w:anchorlock/><center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;">Open your portal</center></v:roundrect><![endif]-->
    <!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#0e9bd8" style="background:#0e9bd8;border-radius:10px;box-shadow:0 4px 12px rgba(14,155,216,.35)"><a href="${o.portalUrl}" style="display:block;min-width:200px;padding:16px 40px;border:1px solid #0b86bc;border-radius:10px;${F};font-size:17px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;text-align:center">Open your portal</a></td></tr></table><!--<![endif]-->
  </td></tr>
  <tr><td align="center" style="padding:10px 30px 28px;${F};font-size:13px;line-height:1.5;color:#5B6678">Questions? Reply to this email or call us at (972) 487-7858, and we'll walk you through it.</td></tr>
</table>
  </td></tr>
  <tr><td style="padding:0;line-height:0;font-size:0"><img src="${img("fade-wide.png")}" width="1200" height="4" alt="" style="display:block;width:100%;height:4px;border:0"></td></tr>
  <tr><td align="center" bgcolor="#141D2B" style="background:#141D2B;padding:16px 20px 18px;${F};font-size:11.5px;line-height:1.6;color:#AAB4C3">FBS Print · 811 Alpha Dr, Ste 343, Richardson, TX 75081 · (972) 487-7858</td></tr>
</table>
</body></html>`;
}
