import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailAccount } from "@/lib/mail/config";
import { ewsOpen, ewsReady, ewsSearch } from "@/lib/mail/ewsBox";

/**
 * Every email with a customer about one design (Oct 14, Nick: "search the email for the same-name product… it's going
 * to be an email cache issue"). The portal's copy of the mailbox (mail_cache) only goes back to Aug 28, 2026, so the
 * whole mailbox is searched through Exchange's own index (every year, every folder: ewsSearch, the Inbox's search),
 * kept to the customer's people, and each email's text read once. What's found is kept (design_mail_cache) for a day,
 * so opening the history again is instant; "Search again" looks again. The portal's copy and the emails kept in the
 * portal (with their pictures) are added in, without doubles.
 */
export type DesignEmail = { date: string; from: string; incoming: boolean; subject: string; text: string; pics?: string[]; folder?: string; /** to open the whole email: in the mailbox (folder + uid) or kept in the portal (activity id) */ uid?: number; act?: string };

const FREE = /@(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|me|comcast|att|sbcglobal)\./;
const clean = (t: string) => String(t || "").replace(/\r/g, "").split(/\n(?:On .{5,160} wrote:|-----Original Message-----|From: .{3,200}\n(?:Sent|Date): )/)[0].replace(/\n{3,}/g, "\n\n").trim();
const htmlText = (h: string) => h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+\n/g, "\n");
const key = (subject: string, date: string) => `${subject.toLowerCase().replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim()}|${date.slice(0, 15)}`;

export async function customerPeople(admin: SupabaseClient, customerId: string) {
  const { data: cust } = await admin.from("customers").select("email, contact2_email").eq("id", customerId).maybeSingle();
  const { data: cts } = await admin.from("customer_contacts").select("email").eq("customer_id", customerId);
  const addrs = [cust?.email, cust?.contact2_email, ...(cts || []).map((c) => c.email)].map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@"));
  const domains = [...new Set(addrs.filter((e) => !FREE.test(e)).map((e) => e.split("@")[1]))];
  return { addrs, domains, theirs: (t: string) => { const x = t.toLowerCase(); return addrs.some((a) => x.includes(a)) || domains.some((d) => x.includes("@" + d)); } };
}

/** the whole mailbox's emails with the customer about the design (cached a day; `fresh` searches again) */
async function mailboxEmails(admin: SupabaseClient, acct: MailAccount | null, customerId: string, words: string[], fresh: boolean): Promise<{ emails: DesignEmail[]; searched: boolean }> {
  if (!acct || !words.length) return { emails: [], searched: false };
  const k = `${customerId}:${acct.email.toLowerCase()}:${[...words].sort().join(" ")}`;
  if (!fresh) {
    const { data } = await admin.from("design_mail_cache").select("emails, searched_at").eq("key", k).maybeSingle();
    if (data && Date.now() - new Date(data.searched_at).getTime() < 24 * 3600_000) return { emails: data.emails as DesignEmail[], searched: true };
  }
  if (!(await ewsReady(admin, acct))) return { emails: [], searched: false };
  const me = acct.email.toLowerCase();
  const who = await customerPeople(admin, customerId);
  const rows = new Map<string, { folder: string; uid: number; subject: string; from: string; fromName: string; date: string; sent: boolean; to: string[] }>();
  for (const w of words.slice(0, 3)) {
    const r = await ewsSearch(admin, acct, me, w).catch(() => null);
    for (const c of r?.convos || []) for (const m of c.msgs) {
      if (!who.theirs([m.from, ...(m.to || []), ...(m.cc || [])].join(" "))) continue;
      rows.set(`${m.folder}:${m.uid}`, { folder: m.folder, uid: m.uid, subject: m.subject, from: m.from, fromName: m.fromName, date: m.date, sent: !!m.sent, to: m.to || [] });
    }
  }
  // each email's own words (newest 40), a few at a time
  const list = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-40);
  const out: DesignEmail[] = [];
  const queue = [...list];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const m = queue.shift()!;
      const full = await ewsOpen(admin, acct, m.folder, m.uid, (id) => id).catch(() => null);
      const text = clean(full?.text || htmlText(full?.html || ""));
      const incoming = !m.sent && !String(m.from).toLowerCase().includes(me) && !/@fbsprint\.com/i.test(m.from);
      out.push({ date: m.date, from: incoming ? (m.fromName || m.from) : (m.fromName || "FBS"), incoming, subject: m.subject, text: text.slice(0, 3000), folder: m.folder, uid: m.uid });
    }
  }));
  out.sort((a, b) => a.date.localeCompare(b.date));
  await admin.from("design_mail_cache").upsert({ key: k, emails: out, searched_at: new Date().toISOString() });
  return { emails: out, searched: true };
}

/** every email about the design: the whole mailbox (all years), the portal's copy, and emails kept in the portal */
export async function designEmails(admin: SupabaseClient, acct: MailAccount | null, customerId: string, words: string[], opts: { fresh?: boolean; pics?: (paths: string[]) => Promise<string[]> } = {}): Promise<{ emails: DesignEmail[]; wholeMailbox: boolean }> {
  const hit = (t: unknown) => { const x = String(t || "").toLowerCase(); return words.some((w) => x.includes(w)); };
  const who = await customerPeople(admin, customerId);
  const box = await mailboxEmails(admin, acct, customerId, words, !!opts.fresh).catch(() => ({ emails: [] as DesignEmail[], searched: false }));
  const seen = new Set(box.emails.map((e) => key(e.subject, e.date)));
  const out = [...box.emails];
  const { data: mails } = await admin.from("mail_cache").select("subject, from_email, from_name, to_text, sent_at, body_text, folder, uid, account_id").or(words.map((w) => `hay.ilike.%${w}%`).join(",")).is("gone_at", null).order("sent_at").limit(150);
  for (const m of mails || []) {
    if (!who.theirs(`${m.from_email} ${m.to_text}`)) continue;
    const k = key(m.subject || "", String(m.sent_at));
    if (seen.has(k)) continue;
    seen.add(k);
    const incoming = !/@fbsprint\.com/i.test(String(m.from_email || ""));
    out.push({ date: String(m.sent_at), from: incoming ? (m.from_name || m.from_email) : (m.from_name || "FBS"), incoming, subject: m.subject || "", text: clean(m.body_text || "").slice(0, 3000), ...(m.folder && m.uid && acct && m.account_id === acct.id ? { folder: String(m.folder), uid: Number(m.uid) } : {}) });
  }
  const { data: acts } = await admin.from("activities").select("id, occurred_at, direction, subject, body, from_email, meta").eq("customer_id", customerId).order("occurred_at").limit(600);
  for (const a of (acts || []).filter((x) => hit(x.subject) || hit(x.body))) {
    const k = key(a.subject || "", String(a.occurred_at));
    const att = (((a.meta || {}) as { attachments?: { path?: string; signature?: boolean }[] }).attachments || []).filter((f) => f.path && /\.(jpe?g|png|webp)$/i.test(f.path) && !f.signature).map((f) => f.path!).slice(0, 3);
    if (seen.has(k)) {
      // the same email from the mailbox: add its pictures
      const e = out.find((x) => key(x.subject, x.date) === k);
      if (e && att.length && opts.pics) e.pics = await opts.pics(att);
      if (e && !e.act) e.act = String(a.id);
      continue;
    }
    seen.add(k);
    out.push({ date: String(a.occurred_at), from: a.direction === "in" ? a.from_email : "FBS", incoming: a.direction === "in", subject: a.subject || "", text: clean(a.body || "").slice(0, 3000), act: String(a.id), ...(att.length && opts.pics ? { pics: await opts.pics(att) } : {}) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { emails: out, wholeMailbox: box.searched };
}
