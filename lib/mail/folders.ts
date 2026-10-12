import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { cfgOf, type MailAccount } from "./config";
import { imapClient } from "./imap";
import { ARCHIVED } from "./mirror";

/**
 * Email (Oct 12, Nick: "you have to be able to see the other folders… search as a conversation"). Everything read
 * live from the person's mailbox over IMAP, nothing stored: the folder list, a folder's messages, one message (and
 * its attachments), moving a message to any folder (Archive, SaneBox, their own), and search that groups what was
 * found, received and sent, into conversations in order.
 */
export type Folder = { path: string; name: string; parent: string; depth: number; special: string; messages: number; unseen: number; sane: boolean };
export type MsgRow = { folder: string; uid: number; messageId: string; inReplyTo: string; subject: string; from: string; fromName: string; to: string[]; cc: string[]; date: string; seen: boolean; flagged: boolean; sent: boolean; size: number };

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");
// folders that aren't mail to browse
const SKIP = /^(calendar|contacts|tasks|notes|journal|sync issues|conversation history|rss feeds|outbox|suggested contacts|conflicts|local failures|server failures)(\/|$)/i;

export async function withBox<T>(acct: MailAccount, fn: (c: ImapFlow) => Promise<T>) {
  const client = imapClient(cfgOf(acct));
  await client.connect();
  try { return await fn(client); } finally { await client.logout().catch(() => null); }
}

export async function listFolders(c: ImapFlow): Promise<Folder[]> {
  const list = await c.list({ statusQuery: { messages: true, unseen: true } });
  return list
    .filter((f) => !f.flags?.has("\\Noselect") && !SKIP.test(f.path))
    .map((f) => {
      const delim = f.delimiter || "/";
      const parts = f.path.split(delim);
      const special = f.specialUse || (/^inbox$/i.test(f.path) ? "\\Inbox" : /^sent items$/i.test(f.name) ? "\\Sent" : /^deleted items$/i.test(f.name) ? "\\Trash" : /^drafts$/i.test(f.name) ? "\\Drafts" : /^junk e-?mail$/i.test(f.name) ? "\\Junk" : /^archive$/i.test(f.path) ? "\\Archive" : "");
      return { path: f.path, name: f.name, parent: parts.slice(0, -1).join(delim), depth: parts.length - 1, special, messages: f.status?.messages || 0, unseen: f.status?.unseen || 0, sane: /^@sane/i.test(f.name) };
    });
}

const toRow = (folder: string, me: string, m: { uid: number; flags?: Set<string>; envelope?: { messageId?: string; inReplyTo?: string; subject?: string; date?: Date; from?: { address?: string; name?: string }[]; to?: { address?: string }[]; cc?: { address?: string }[] }; size?: number; internalDate?: Date | string }): MsgRow => {
  const e = m.envelope || {};
  const from = lc(e.from?.[0]?.address);
  return {
    folder, uid: m.uid, messageId: mid(e.messageId), inReplyTo: mid(e.inReplyTo), subject: e.subject || "", from, fromName: e.from?.[0]?.name || "",
    to: (e.to || []).map((x) => lc(x.address)).filter(Boolean), cc: (e.cc || []).map((x) => lc(x.address)).filter(Boolean),
    date: new Date(e.date || m.internalDate || Date.now()).toISOString(), seen: !!m.flags?.has("\\Seen"), flagged: !!m.flags?.has("\\Flagged"), sent: from === me, size: m.size || 0,
  };
};

/** the newest messages in a folder, 50 at a time (`before`: the sequence number to page back from) */
export async function listMessages(c: ImapFlow, me: string, path: string, before?: number) {
  const lock = await c.getMailboxLock(path);
  try {
    const mb = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
    const total = Number(mb?.exists || 0);
    const top = Math.min(total, before && before > 0 ? before - 1 : total);
    if (top < 1) return { total, rows: [] as MsgRow[], next: 0 };
    const from = Math.max(1, top - 49);
    const rows: MsgRow[] = [];
    for await (const m of c.fetch(`${from}:${top}`, { uid: true, flags: true, envelope: true, size: true, internalDate: true })) rows.push(toRow(path, me, m as never));
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return { total, rows, next: from > 1 ? from : 0 };
  } finally { lock.release(); }
}

export type FullMsg = { folder: string; uid: number; messageId: string; references: string[]; fromAddress: string; fromName: string; from: string; to: string; cc: string; subject: string; date: string; html: string; text: string; attachments: { i: number; name: string; size: number; type: string }[] };

async function parsed(c: ImapFlow, path: string, uid: number): Promise<ParsedMail | null> {
  const lock = await c.getMailboxLock(path);
  try {
    const msg = await c.fetchOne(String(uid), { source: true, size: true }, { uid: true });
    if (!msg || !msg.source) return null;
    if ((msg.size || 0) > 35 * 1024 * 1024) throw new Error("This email is too big to open here. Open it in Outlook.");
    // opening it marks it read, like Outlook
    await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => null);
    return await simpleParser(msg.source);
  } finally { lock.release(); }
}

export async function getMessage(c: ImapFlow, path: string, uid: number): Promise<FullMsg | null> {
  const p = await parsed(c, path, uid);
  if (!p) return null;
  const addr = (a: unknown) => (Array.isArray(a) ? a : a ? [a] : []).map((x: { text?: string }) => x.text || "").filter(Boolean).join(", ");
  let html = typeof p.html === "string" ? p.html : "";
  if (html.length > 4_000_000) html = "";
  return {
    folder: path, uid, messageId: p.messageId || "", references: (Array.isArray(p.references) ? p.references : p.references ? String(p.references).split(/\s+/) : []).filter(Boolean) as string[],
    fromAddress: lc(p.replyTo?.value?.[0]?.address || p.from?.value?.[0]?.address), fromName: p.from?.value?.[0]?.name || "",
    from: addr(p.from), to: addr(p.to), cc: addr(p.cc), subject: p.subject || "", date: p.date ? p.date.toISOString() : "", html, text: (p.text || "").slice(0, 200000),
    attachments: (p.attachments || []).map((a, i) => ({ i, name: a.filename || `attachment-${i + 1}`, size: a.size || 0, type: a.contentType || "application/octet-stream", inline: a.contentDisposition === "inline" && !!a.cid })).filter((a) => !a.inline).map(({ i, name, size, type }) => ({ i, name, size, type })),
  };
}

export async function getAttachment(c: ImapFlow, path: string, uid: number, i: number) {
  const p = await parsed(c, path, uid);
  const a = p?.attachments?.[i];
  if (!a) return null;
  return { name: a.filename || `attachment-${i + 1}`, type: a.contentType || "application/octet-stream", content: a.content };
}

/** where "Archive" and the SaneBox moves go, by key, or any folder path */
export async function resolveFolder(c: ImapFlow, to: string) {
  const list = await c.list();
  const sane: Record<string, string> = { later: "@SaneLater", news: "@SaneNews", receipts: "@SaneReceipts", cc: "@SaneCC", blackhole: "@SaneBlackHole" };
  if (to === "archive") return (list.find((f) => f.specialUse === "\\Archive") || list.find((f) => /^archive$/i.test(f.path)) || list.find((f) => /^archive$/i.test(f.name)))?.path || null;
  if (to === "trash") return (list.find((f) => f.specialUse === "\\Trash") || list.find((f) => /^deleted items$/i.test(f.name)))?.path || null;
  if (sane[to]) return list.find((f) => f.name.toLowerCase() === sane[to].toLowerCase())?.path || null;
  return list.find((f) => f.path === to)?.path || null;
}

/** move one message; moving out of the Inbox also updates the Inbox mirror and closes the email's to-dos */
export async function moveMessage(admin: SupabaseClient, acct: MailAccount, c: ImapFlow, path: string, uid: number, to: string, by: string) {
  const dest = await resolveFolder(c, to);
  if (!dest) throw new Error(to === "blackhole" || to === "later" || to === "news" || to === "receipts" || to === "cc" ? "That SaneBox folder isn't in your mailbox." : "That folder isn't in your mailbox.");
  if (dest === path) return { dest };
  let messageId = "";
  const lock = await c.getMailboxLock(path);
  try {
    const m = await c.fetchOne(String(uid), { envelope: true }, { uid: true });
    messageId = mid(m && m.envelope ? m.envelope.messageId : "");
    await c.messageMove(String(uid), dest, { uid: true });
  } finally { lock.release(); }
  if (/^inbox$/i.test(path) && messageId) {
    const now = new Date().toISOString();
    const { data: rows } = await admin.from("mail_inbox").select("id, activity_id").eq("account_id", acct.id).eq("message_id", messageId).is("gone_at", null);
    for (const r of (rows || []) as { id: string; activity_id: string | null }[]) {
      await admin.from("mail_inbox").update({ gone_at: now, done_by: `${by} → ${dest}`.slice(0, 80) }).eq("id", r.id);
      await admin.from("tasks").update({ status: "done", done_at: now, done_by: ARCHIVED }).eq("mail_inbox_id", r.id).eq("status", "open");
      if (r.activity_id) {
        const { data: a } = await admin.from("activities").select("meta").eq("id", r.activity_id).maybeSingle();
        await admin.from("activities").update({ meta: { ...((a?.meta || {}) as object), outlook_archived: now } }).eq("id", r.activity_id);
      }
    }
  }
  return { dest };
}

export type Convo = { key: string; subject: string; people: string[]; last: string; count: number; unread: number; msgs: MsgRow[] };
const normSubj = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Search the mailbox and group what's found into conversations (received and sent, oldest first inside each).
 * A customer's name finds their email addresses (customers, contacts) so "Dear Heart" finds fisher@dearheartdesigns.com.
 */
export async function searchConversations(admin: SupabaseClient, c: ImapFlow, me: string, q: string, deadline: number) {
  const term = q.trim();
  if (term.length < 2) return { convos: [] as Convo[], folders: 0, partial: false };
  // a customer's addresses and domain, by name
  const addrs = new Set<string>();
  if (!term.includes("@")) {
    const { data: cs } = await admin.from("customers").select("id, email, contact2_email").or(`company.ilike.%${term.replace(/[%,()]/g, " ")}%,name.ilike.%${term.replace(/[%,()]/g, " ")}%`).limit(5);
    const ids = (cs || []).map((x) => x.id as string);
    for (const x of cs || []) for (const e of [x.email, x.contact2_email]) if (e) addrs.add(lc(e as string));
    if (ids.length) { const { data: ks } = await admin.from("customer_contacts").select("email").in("customer_id", ids).limit(30); for (const k of ks || []) if (k.email) addrs.add(lc(k.email as string)); }
  }
  const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|att|sbcglobal)\./i;
  const domains = new Set([...addrs].filter((a) => !FREE.test(a)).map((a) => a.split("@")[1]).filter(Boolean));
  const keys = [term, ...domains, ...[...addrs].filter((a) => FREE.test(a))].slice(0, 12);
  const crit = { or: keys.flatMap((k) => [{ from: k }, { to: k }, { cc: k }, ...(k === term ? [{ subject: k }] : [])]) };
  const folders = (await listFolders(c)).filter((f) => !/\\(Junk|Trash|Drafts)/.test(f.special) && f.messages > 0 && !/^@saneblackhole$/i.test(f.name));
  // Inbox, Sent and Archive first: they hold almost every conversation
  const rank = (f: Folder) => (/\\Inbox/.test(f.special) ? 0 : /\\Sent/.test(f.special) ? 1 : /\\Archive/.test(f.special) ? 2 : 3);
  folders.sort((a, b) => rank(a) - rank(b));
  const found: MsgRow[] = [];
  let looked = 0, partial = false;
  for (const f of folders) {
    if (Date.now() > deadline) { partial = true; break; }
    const lock = await c.getMailboxLock(f.path);
    try {
      const hit = await c.search(crit, { uid: true }).catch(() => [] as number[]);
      const uids = (Array.isArray(hit) ? hit : []).sort((a, b) => a - b).slice(-120);
      if (uids.length) for await (const m of c.fetch(uids.join(","), { uid: true, flags: true, envelope: true, size: true, internalDate: true }, { uid: true })) found.push(toRow(f.path, me, m as never));
      looked++;
    } finally { lock.release(); }
  }
  // the same email in two folders (Inbox + Archive copy): once
  const seen = new Map<string, MsgRow>();
  for (const m of found) { const k = m.messageId || `${m.folder}:${m.uid}`; if (!seen.has(k)) seen.set(k, m); }
  const msgs = [...seen.values()];
  // group: replies by Message-ID, else by the subject without Re:/Fwd:
  const parent = new Map<string, string>();
  const root = (k: string): string => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const join = (a: string, b: string) => { const ra = root(a), rb = root(b); if (ra !== rb) parent.set(ra, rb); };
  const byId = new Map(msgs.filter((m) => m.messageId).map((m) => [m.messageId, m]));
  const bySubj = new Map<string, string>();
  for (const m of msgs) {
    const k = m.messageId || `${m.folder}:${m.uid}`;
    if (!parent.has(k)) parent.set(k, k);
    if (m.inReplyTo && byId.has(m.inReplyTo)) { if (!parent.has(m.inReplyTo)) parent.set(m.inReplyTo, m.inReplyTo); join(k, m.inReplyTo); }
    const s = normSubj(m.subject);
    if (s.length >= 3) { if (bySubj.has(s)) join(k, bySubj.get(s)!); else bySubj.set(s, k); }
  }
  const groups = new Map<string, MsgRow[]>();
  for (const m of msgs) { const r = root(m.messageId || `${m.folder}:${m.uid}`); groups.set(r, [...(groups.get(r) || []), m]); }
  const convos: Convo[] = [...groups.entries()].map(([key, ms]) => {
    ms.sort((a, b) => a.date.localeCompare(b.date));
    const people = [...new Set(ms.flatMap((m) => (m.sent ? m.to : [m.fromName || m.from])).filter((x) => x && x !== me))].slice(0, 4);
    return { key, subject: ms[0].subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "") || "(no subject)", people, last: ms[ms.length - 1].date, count: ms.length, unread: ms.filter((m) => !m.seen && !m.sent).length, msgs: ms };
  }).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 60);
  return { convos, folders: looked, partial };
}
