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
    "Take a look when you get a chance, and let me know what you think. If you don't see that email, please check your spam folder.",
    "Thank you for your business. We truly appreciate it.",
  ],
};
export type NoteText = { subject: string; paragraphs: string[] };

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function noteText(admin: SupabaseClient): Promise<NoteText> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const n = (data?.data as { personalLaunchNote?: Partial<NoteText> } | null)?.personalLaunchNote;
  return { subject: n?.subject || NOTE_DEFAULT.subject, paragraphs: n?.paragraphs?.length ? n.paragraphs : NOTE_DEFAULT.paragraphs };
}

/** the note as it goes: the FBS header (logo, the three-color bar), the words, then the sender's own signature */
export function noteHtml(t: NoteText, first: string, site: string, signature: string) {
  const F = "font-family:Calibri,Helvetica,Arial,sans-serif";
  const body = t.paragraphs.map((p) => `<p style="margin:0 0 14px;${F};font-size:15px;line-height:1.6;color:#2A3446">${esc(p.replace(/\{first\}/g, first || "there"))}</p>`).join("");
  return `<div style="${F}">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-collapse:collapse">
<tr><td style="background:#141D2B;padding:16px 20px;border-radius:8px 8px 0 0"><img src="${site.replace(/\/$/, "")}/email/launch/logo-white.png?v=${APP_VERSION}" width="44" height="44" alt="FBS Print" style="display:block;border:0"></td></tr>
<tr><td style="padding:0;line-height:0;font-size:0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
<td width="33%" height="3" bgcolor="#0e9bd8" style="height:3px;font-size:0">&nbsp;</td><td width="34%" height="3" bgcolor="#f26660" style="height:3px;font-size:0">&nbsp;</td><td width="33%" height="3" bgcolor="#fcb122" style="height:3px;font-size:0">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:22px 4px 4px">${body}</td></tr>
</table>
${signature ? `<div style="margin-top:6px">${signature}</div>` : ""}
</div>`;
}
export const noteTextPlain = (t: NoteText, first: string) => t.paragraphs.map((p) => p.replace(/\{first\}/g, first || "there")).join("\n\n");
