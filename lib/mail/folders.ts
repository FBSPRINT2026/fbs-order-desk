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
export type MsgRow = { folder: string; uid: number; messageId: string; inReplyTo: string; subject: string; from: string; fromName: string; to: string[]; /** who it went to, by name where there is one */ toNames?: string[]; cc: string[]; date: string; seen: boolean; flagged: boolean; sent: boolean; size: number };

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");
// folders that aren't mail to browse
const SKIP = /^(calendar|contacts|tasks|notes|journal|sync issues|conversation history|rss feeds|outbox|suggested contacts|conflicts|local failures|server failures)(\/|$)/i;

/**
 * One connection to the mailbox for the work in fn, always closed after. `until` (default 45 s from now) is a hard
 * stop: the connection is closed then even mid-step (Oct 12: a cache run stuck on one huge email was cut off by the
 * 60-second limit every time, leaving connections open until the mail server refused new ones: "Connection not
 * available" for everything, mail checks and opening emails too).
 */
export async function withBox<T>(acct: MailAccount, fn: (c: ImapFlow) => Promise<T>, until = Date.now() + 45000) {
  const client = imapClient(cfgOf(acct));
  const stop = setTimeout(() => { try { client.close(); } catch { /* closed */ } }, Math.max(2000, until - Date.now()));
  try {
    await client.connect();
    return await fn(client);
  } finally { clearTimeout(stop); await Promise.race([client.logout().catch(() => null), new Promise((r) => setTimeout(r, 3000))]); try { client.close(); } catch { /* closed */ } }
}

export async function listFolders(c: ImapFlow, counts = true): Promise<Folder[]> {
  const list = await c.list();
  // counts: how many in each, and unread for the folders that aren't huge (unread on a million-email archive is slow)
  if (counts) for (const f of list) {
    if (f.flags?.has("\\Noselect") || SKIP.test(f.path)) continue;
    try {
      const st = await c.status(f.path, { messages: true });
      const n = st.messages || 0;
      const un = n && n <= 20000 ? (await c.status(f.path, { unseen: true })).unseen || 0 : 0;
      f.status = { path: f.path, messages: n, unseen: un } as typeof f.status;
    } catch { /* leave it uncounted */ }
  }
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
    to: (e.to || []).map((x) => lc(x.address)).filter(Boolean), toNames: (e.to || []).map((x) => (x as { name?: string }).name || lc(x.address)).filter(Boolean), cc: (e.cc || []).map((x) => lc(x.address)).filter(Boolean),
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

/** 50 emails older than a date, live (paging past the 45 days the cache holds) */
export async function listOlder(c: ImapFlow, me: string, path: string, beforeIso: string) {
  const lock = await c.getMailboxLock(path);
  try {
    const d = new Date(beforeIso);
    const hit = await c.search({ before: d }, { uid: true }).catch(() => [] as number[]);
    const uids = (Array.isArray(hit) ? hit : []).sort((a, b) => a - b).slice(-50);
    const rows: MsgRow[] = [];
    if (uids.length) for await (const m of c.fetch(uids.join(","), { uid: true, flags: true, envelope: true, size: true, internalDate: true }, { uid: true })) rows.push(toRow(path, me, m as never));
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return { rows, more: (Array.isArray(hit) ? hit.length : 0) > 50 };
  } finally { lock.release(); }
}

/** mark an email read on the server (opening it from the cache) */
export async function markSeen(c: ImapFlow, path: string, uid: number) {
  const lock = await c.getMailboxLock(path);
  try { await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } finally { lock.release(); }
}

export type FullMsg = { folder: string; uid: number; messageId: string; references: string[]; fromAddress: string; fromName: string; from: string; to: string; cc: string; subject: string; date: string; html: string; text: string; attachments: { i: number; name: string; size: number; type: string }[];
  /** from the cache with big pasted pictures left out (or as plain text): "Show the full email" reads it live */ partial?: boolean; seen?: boolean };

/**
 * Email HTML without the big pictures pasted into it (each picture is inside the HTML as text, so a long reply chain
 * with screenshots and mockups runs to megabytes). Pictures over 40 KB become a small "picture left out" note; the
 * rest of the email (and its small pictures, like signatures) stays as it was. null when it's still too big.
 */
export function slimHtml(html: string, max = 900_000): { html: string; trimmed: boolean } | null {
  if (html.length <= max) return { html, trimmed: false };
  let trimmed = false;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (tag.length < 40_000 || !/src\s*=\s*["']?data:/i.test(tag)) return tag;
    trimmed = true;
    return '<span style="display:inline-block;margin:4px 0;padding:6px 10px;border:1px dashed #b8c0cc;border-radius:6px;color:#6b7686;font:12px sans-serif">Picture left out here (Show the full email to see it)</span>';
  }).replace(/url\(\s*["']?data:[^)]{40000,}\)/gi, () => { trimmed = true; return "none"; });
  return out.length <= max ? { html: out, trimmed } : null;
}

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
/** a customer's addresses (customers, contacts) when the search is their name */
export async function customerAddrs(admin: SupabaseClient, term: string) {
  const addrs = new Set<string>();
  if (!term.includes("@")) {
    const { data: cs } = await admin.from("customers").select("id, email, contact2_email").or(`company.ilike.%${term.replace(/[%,()]/g, " ")}%,name.ilike.%${term.replace(/[%,()]/g, " ")}%`).limit(5);
    const ids = (cs || []).map((x) => x.id as string);
    for (const x of cs || []) for (const e of [x.email, x.contact2_email]) if (e) addrs.add(lc(e as string));
    if (ids.length) { const { data: ks } = await admin.from("customer_contacts").select("email").in("customer_id", ids).limit(30); for (const k of ks || []) if (k.email) addrs.add(lc(k.email as string)); }
  }
  return addrs;
}

export async function searchConversations(admin: SupabaseClient, acct: MailAccount, me: string, q: string, deadline: number, olderOnly = false) {
  const term = q.trim();
  if (term.length < 2) return { convos: [] as Convo[], folders: 0, partial: false };
  const addrs = await customerAddrs(admin, term);
  const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|att|sbcglobal)\./i;
  const domains = new Set([...addrs].filter((a) => !FREE.test(a)).map((a) => a.split("@")[1]).filter(Boolean));
  const keys = [term, ...domains, ...[...addrs].filter((a) => FREE.test(a))].slice(0, 12);
  const crit: Record<string, unknown> = { or: keys.flatMap((k) => [{ from: k }, { to: k }, { cc: k }, ...(k === term ? [{ subject: k }] : [])]) };
  // older than the cached 45 days only (the cache answers the rest instantly)
  if (olderOnly) crit.before = new Date(Date.now() - 45 * 864e5);
  const folders = (await withBox(acct, (c) => listFolders(c, false))).filter((f) => !/\\(Junk|Trash|Drafts)/.test(f.special) && !/^@saneblackhole$/i.test(f.name));
  // Inbox, Sent and Archive first: they hold almost every conversation
  const rank = (f: Folder) => (/\\Inbox/.test(f.special) ? 0 : /\\Sent/.test(f.special) ? 1 : /\\Archive/.test(f.special) ? 2 : 3);
  folders.sort((a, b) => rank(a) - rank(b));
  // each folder on its own connection, a few at a time; a folder that takes too long is left out (partial)
  const found: MsgRow[] = [];
  let looked = 0, partial = false;
  const timing: Record<string, number | string> = {};
  const one = async (f: Folder) => {
    const t0 = Date.now();
    const left = deadline - Date.now();
    if (left < 2000) { partial = true; return; }
    const client = imapClient(cfgOf(acct));
    let done = false;
    const work = (async () => {
      await client.connect();
      const lock = await client.getMailboxLock(f.path);
      try {
        const hit = await client.search(crit, { uid: true }).catch(() => [] as number[]);
        const uids = (Array.isArray(hit) ? hit : []).sort((a, b) => a - b).slice(-120);
        const rows: MsgRow[] = [];
        if (uids.length) for await (const m of client.fetch(uids.join(","), { uid: true, flags: true, envelope: true, size: true, internalDate: true }, { uid: true })) rows.push(toRow(f.path, me, m as never));
        return rows;
      } finally { lock.release(); }
    })();
    const timer = new Promise<null>((res) => setTimeout(() => res(null), left));
    const rows = await Promise.race([work.catch(() => [] as MsgRow[]), timer]);
    done = true; void done;
    if (rows === null) { partial = true; timing[f.path] = "timed out"; client.close(); return; }
    timing[f.path] = Date.now() - t0;
    looked++; found.push(...rows);
    await client.logout().catch(() => null);
  };
  const queue = [...folders];
  // two at a time: the mailbox only allows so many connections, and the phone and Outlook use some (Oct 12)
  await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length) await one(queue.shift()!); }));
  return { convos: groupConvos(found, me), folders: looked, partial, timing };
}

/** group emails into conversations: replies by Message-ID, else by the subject without Re:/Fwd:; oldest first inside */
export function groupConvos(found: MsgRow[], me: string): Convo[] {
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
  return convos;
}
