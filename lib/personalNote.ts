import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_VERSION } from "@/lib/version";

/**
 * The personal note about the portal launch (Nov 3, Nick): from Nick's or Amanda's own mailbox (the account owner's), to
 * the account's main person, after the launch email from portal@. One person writes it ("I wanted to follow up"), their
 * own Outlook signature under it. The words are kept in settings.personalLaunchNote so they can change without code;
 * {first} is the person's first name.
 */
export const NOTE_DEFAULT = {
  subject: "Our new customer portal is here",
  paragraphs: [
    "Hi {first},",
    "You should have just received an email from portal@fbsprint.com introducing our new customer portal. I wanted to follow up personally, because we're really excited about it.",
    "We've been working on this for a long time, and it's finally ready. Your orders, proofs, payments and past jobs are now all in one place, so checking on a job or placing a reorder is quick and easy. Your login is already set up.",
    "There's a brief tutorial when you log in for the first time that walks you through the new features. Take a look when you get a chance, and please let me know if you have any questions.",
    "If you don't see the portal email, please check your spam folder.",
    "Thank you for your business. We truly appreciate it.",
  ],
};
/** for customers who've worked with us through ClickUp and Printavo every day (Nov 3, Nick): the old tools stay open to
 *  mid-month, their orders are moved, and we offer their team a training. Kept in settings.personalLaunchNoteClickup. */
export const NOTE_CLICKUP = {
  subject: "Our new customer portal is here",
  paragraphs: [
    "Hi {first},",
    "You should have just received an email from portal@fbsprint.com introducing our new customer portal. I wanted to follow up personally, because we're really excited about it.",
    "We know you and your team work with us every day through ClickUp and Printavo. Both will stay available through the middle of this month, but you don't have to wait: we've backed up all of your orders and moved your account over, so you can submit orders directly through the portal starting today. Your orders, proofs, payments and past jobs are all in one place, and your login is already set up.",
    "We'd love to sit down with you and your team for a quick training and walk through it together. There's also a brief tutorial when you log in for the first time that explains the new features. Please let me know if you have any questions.",
    "If you don't see the portal email, please check your spam folder.",
    "Thank you for your business. We truly appreciate it.",
  ],
};
export type NoteText = { subject: string; paragraphs: string[] };
export type NoteKind = "standard" | "clickup";

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function noteText(admin: SupabaseClient, kind: NoteKind = "standard"): Promise<NoteText> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as { personalLaunchNote?: Partial<NoteText>; personalLaunchNoteClickup?: Partial<NoteText> };
  const n = kind === "clickup" ? d.personalLaunchNoteClickup : d.personalLaunchNote, def = kind === "clickup" ? NOTE_CLICKUP : NOTE_DEFAULT;
  return { subject: n?.subject || def.subject, paragraphs: n?.paragraphs?.length ? n.paragraphs : def.paragraphs };
}

/** the note as it goes: the FBS header (Nov 3, Nick picked #13: the logo, a divider, EXCITING ANNOUNCEMENT on one line, the
 *  three-color bar under it, "Our new customer portal is here"), the words, room, then the
 *  sender's own signature (Nov 3, Nick: "my signature is too close… add a couple lines") */
export function noteHtml(t: NoteText, first: string, site: string, signature: string) {
  const F = "font-family:Calibri,Helvetica,Arial,sans-serif";
  const body = t.paragraphs.map((p) => `<p style="margin:0 0 14px;${F};font-size:15px;line-height:1.6;color:#2A3446">${esc(p.replace(/\{first\}/g, first || "there"))}</p>`).join("");
  return `<div style="${F}">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-collapse:collapse">
<tr><td style="background:#141D2B;padding:22px 24px;border-radius:8px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>
<td width="56" style="vertical-align:middle;padding:0 20px 0 0"><!-- the three-color bar: Outlook draws an empty cell a line of text tall unless its line height is set exactly (Nov 4: it came out a thick band) --><img src="${site.replace(/\/$/, "")}/email/launch/logo-white.png?v=${APP_VERSION}" width="56" height="56" alt="FBS Print" style="display:block;border:0"></td>
<td style="vertical-align:middle;border-left:1px solid #2C3A52;padding:0 0 0 20px;${F}">
<div style="${F};font-size:20px;font-weight:700;letter-spacing:2px;line-height:1.2;color:#FFFFFF;white-space:nowrap">EXCITING ANNOUNCEMENT</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:10px 0 8px"><tr><td width="33%" height="3" bgcolor="#0e9bd8" style="height:3px;font-size:1px;line-height:3px;mso-line-height-rule:exactly">&nbsp;</td><td width="34%" height="3" bgcolor="#f26660" style="height:3px;font-size:1px;line-height:3px;mso-line-height-rule:exactly">&nbsp;</td><td width="33%" height="3" bgcolor="#fcb122" style="height:3px;font-size:1px;line-height:3px;mso-line-height-rule:exactly">&nbsp;</td></tr></table>
<div style="${F};font-size:15px;line-height:1.4;color:#AEB8C8">${esc(t.subject)}</div></td>
</tr></table></td></tr>
<tr><td style="padding:22px 4px 4px">${body}</td></tr>
</table>
${signature ? `<p style="margin:0;font-size:15px;line-height:1.6">&nbsp;</p><p style="margin:0;font-size:15px;line-height:1.6">&nbsp;</p><div>${signature}</div>` : ""}
</div>`;
}
export const noteTextPlain = (t: NoteText, first: string) => t.paragraphs.map((p) => p.replace(/\{first\}/g, first || "there")).join("\n\n");
