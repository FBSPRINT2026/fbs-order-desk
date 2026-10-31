import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailAccount } from "./config";
import { slimHtml, withBox, type Convo, type FullMsg, type MsgRow } from "./folders";
import { ewsMessage } from "./ews";
import { allRows } from "@/lib/readAll";

/**
 * Email cached mode (Oct 12): the last 45 days of a person's mail kept in mail_cache, like Outlook's cached mode, so
 * folders, opening an email and search are instant. /api/mail/cache keeps it current every 2 minutes: per folder it
 * asks the server which emails are from the last 45 days, saves the ones not cached yet (newest first, as many as
 * the minute allows) and marks the ones that left the folder (moved, archived, deleted) as gone.
 * Not cached: Junk, Deleted, Drafts, SaneBox Black Hole and News (nobody reads those here).
 */
export const CACHE_DAYS = 45;
const SKIP = /^(calendar|contacts|tasks|notes|journal|sync issues|conversation history|rss feeds|outbox|suggested contacts|conflicts|local failures|server failures)(\/|$)/i;
const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");
const since = () => new Date(Date.now() - CACHE_DAYS * 864e5);

export async function cacheFolders(c: ImapFlow) {
  const list = await c.list();
  const rank = (f: { specialUse?: string; path: string }) => (/^inbox$/i.test(f.path) ? 0 : f.specialUse === "\\Sent" || /^sent items$/i.test(f.path) ? 1 : f.specialUse === "\\Archive" || /archive$/i.test(f.path) ? 2 : 3);
  return list
    .filter((f) => !f.flags?.has("\\Noselect") && !SKIP.test(f.path))
    .filter((f) => !["\\Junk", "\\Trash", "\\Drafts"].includes(f.specialUse || "") && !/^(junk e-?mail|deleted items|drafts)$/i.test(f.name) && !/^@sane(blackhole|news)$/i.test(f.name))
    .sort((a, b) => rank(a) - rank(b));
}

const addrList = (a: unknown) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x: { value?: { address?: string; name?: string }[] }) => x.value || []);

/** keep one mailbox's cache current until the deadline; returns how many emails were saved / marked gone */
export async function cacheAccount(admin: SupabaseClient, acct: MailAccount, deadline: number) {
  const tally = { saved: 0, gone: 0, folders: 0 };
  // the Inbox first, then the folder that waited longest (Oct 13: the runs ran out of time before INBOX/Archive every
  // time, so it hadn't been looked at since the day before and most of its emails weren't kept)
  const { data: states } = await admin.from("mail_cache_state").select("folder, checked_at").eq("account_id", acct.id);
  const lastLook = new Map(((states || []) as { folder: string; checked_at: string | null }[]).map((x) => [x.folder, x.checked_at || ""]));
  // emails kept without a body, over EWS first (no IMAP connection needed, and it hands over the big ones IMAP drops)
  if (Date.now() < deadline - 12000) await fixBodiesEws(admin, acct, Math.min(deadline - 10000, Date.now() + 7000)).catch((e) => console.warn(`mail cache ews ${acct.email}: ${e instanceof Error ? e.message : e}`));
  await withBox(acct, async (c) => {
    const order = (await cacheFolders(c)).map((f, i) => ({ f, i, at: /^inbox$/i.test(f.path) ? "0" : lastLook.get(f.path) || "" }))
      .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1)).map((x) => x.f);
    // Inbox first, always
    order.sort((a, b) => (/^inbox$/i.test(a.path) ? -1 : /^inbox$/i.test(b.path) ? 1 : 0));
    for (const f of order) {
      if (Date.now() > deadline - 4000) break;
      const lock = await c.getMailboxLock(f.path);
      try {
        const mb = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
        const validity = Number(mb?.uidValidity || 0);
        // a search that fails (the connection dropped) is NOT an empty folder: skip the folder this time, never mark its
        // emails gone (Oct 12: a dropped search marked all 474 of Nick's Sent emails gone)
        const found = await c.search({ since: since() }, { uid: true }).catch(() => null);
        if (!Array.isArray(found)) continue;
        const inWindow = new Set(found);
        const { data: have } = await allRows((r0, r1) => admin.from("mail_cache").select("id, uid, uidvalidity").eq("account_id", acct.id).eq("folder", f.path).is("gone_at", null).order("id").range(r0, r1));
        const rows = (have || []) as { id: string; uid: number; uidvalidity: number }[];
        const cached = new Set(rows.filter((r) => Number(r.uidvalidity) === validity).map((r) => Number(r.uid)));
        // left the folder (or the folder was rebuilt): gone
        const gone = rows.filter((r) => Number(r.uidvalidity) !== validity || !inWindow.has(Number(r.uid))).map((r) => r.id);
        for (let i = 0; i < gone.length; i += 200) await admin.from("mail_cache").update({ gone_at: new Date().toISOString() }).in("id", gone.slice(i, i + 200));
        tally.gone += gone.length;
        // not cached yet: newest first
        const missing = [...inWindow].filter((u) => !cached.has(u)).sort((a, b) => b - a);
        let saved = 0;
        for (const uid of missing) {
          if (Date.now() > deadline - 3000) break;
          try {
            // the size first: a big email (over 5 MB, usually attachments) is kept by its headers only, and opened live
            // when clicked (Oct 12: one huge email in Nick's Inbox/Archive stalled every run)
            const head = await c.fetchOne(String(uid), { size: true, flags: true, envelope: true, internalDate: true }, { uid: true });
            if (!head) continue;
            const big = (head.size || 0) > 5 * 1024 * 1024;
            const m = big ? head : await c.fetchOne(String(uid), { source: true, size: true, flags: true, envelope: true, internalDate: true }, { uid: true });
            // a big one: its words and HTML only (no attachments), so it still opens from the cache (Oct 13)
            const bigBody = big ? await bodyOnly(c, uid).catch(() => null) : null;
            if (!m) continue;
            const p = !big && m.source ? await simpleParser(m.source) : null;
            const env = m.envelope;
            const from = p ? addrList(p.from)[0] : env?.from?.[0];
            const to = p ? addrList(p.to) : env?.to || [], cc = p ? addrList(p.cc) : env?.cc || [];
            const subject = (p?.subject ?? env?.subject ?? "").slice(0, 500);
            const rawHtml = typeof p?.html === "string" ? p.html : bigBody?.html || "";
            const text = (p?.text || bigBody?.text || (rawHtml ? htmlText(rawHtml) : "")).slice(0, 100000);
            // big pasted pictures are left out of the kept HTML, so the email still opens from the cache (Oct 13)
            const slim = rawHtml ? slimHtml(rawHtml) : null;
            const html = slim ? slim.html : null;
            const atts = (p?.attachments || []).map((a, i) => ({ i, name: a.filename || `attachment-${i + 1}`, size: a.size || 0, type: a.contentType || "application/octet-stream", inline: a.contentDisposition === "inline" && !!a.cid })).filter((a) => !a.inline).map(({ i, name, size, type }) => ({ i, name, size, type }));
            const refs = p ? (Array.isArray(p.references) ? p.references : p.references ? String(p.references).split(/\s+/) : []).filter(Boolean).map(mid).slice(-30) : [];
            const toText = to.map((x: { address?: string; name?: string }) => [x.name, x.address].filter(Boolean).join(" ")).join(", ");
            const ccText = cc.map((x: { address?: string; name?: string }) => [x.name, x.address].filter(Boolean).join(" ")).join(", ");
            const row = {
              account_id: acct.id, folder: f.path, uidvalidity: validity, uid,
              message_id: mid(p?.messageId || env?.messageId), in_reply_to: mid(typeof p?.inReplyTo === "string" ? p.inReplyTo : env?.inReplyTo), refs,
              subject, from_email: lc(from?.address), from_name: (from?.name || "").slice(0, 200),
              to_list: to.map((x: { address?: string }) => lc(x.address)).filter(Boolean), cc_list: cc.map((x: { address?: string }) => lc(x.address)).filter(Boolean),
              to_text: toText.slice(0, 2000), cc_text: ccText.slice(0, 2000), reply_to: lc(addrList(p?.replyTo)[0]?.address),
              sent_at: new Date(p?.date || env?.date || m.internalDate || Date.now()).toISOString(),
              seen: !!m.flags?.has("\\Seen"), flagged: !!m.flags?.has("\\Flagged"), size: m.size || 0,
              body_text: text, body_html: html, body_trimmed: !!slim?.trimmed || big, body_fixed_at: big && !bigBody ? null : new Date().toISOString(), attachments: atts,
              hay: [from?.name, from?.address, toText, ccText, subject, text.slice(0, 4000)].filter(Boolean).join(" ").toLowerCase().slice(0, 8000),
            };
            const { error } = await admin.from("mail_cache").upsert(row, { onConflict: "account_id,folder,uidvalidity,uid" });
            if (!error) { saved++; tally.saved++; }
          } catch { /* skip this one; tried again next run */ }
        }
        // emails saved before Oct 13 without their HTML (pasted pictures made it too big, or over 5 MB): read once more
        // and kept without the big pictures, a few per run, so they open from the cache instead of the mailbox
        await admin.from("mail_cache_state").upsert({ account_id: acct.id, folder: f.path, uidvalidity: validity, in_window: inWindow.size, cached: cached.size + saved, checked_at: new Date().toISOString() });
        tally.folders++;
      } finally { lock.release(); }
    }
  }, deadline); // a hard stop at the deadline: never left hanging past the time limit
  return tally;
}

/** readable text from email HTML (when it has no plain-text part) */
const htmlText = (h: string) => h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<img\b[^>]*>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

type BS = { part?: string; type?: string; disposition?: string; childNodes?: BS[] };
/** an email's text and HTML parts only, not its attachments (a 9 MB email is usually 20 KB of words and 9 MB of files) */
async function bodyOnly(c: ImapFlow, uid: number): Promise<{ html: string; text: string } | null> {
  const m = await c.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
  const root = (m && (m as unknown as { bodyStructure?: BS }).bodyStructure) || null;
  if (!root) return null;
  // not split into parts (a plain email, no attachments): the whole thing is small, read it as is
  if (!root.childNodes?.length) {
    const src = await c.fetchOne(String(uid), { source: true }, { uid: true });
    if (!src || !src.source) return null;
    const p = await simpleParser(src.source);
    return { html: typeof p.html === "string" ? p.html : "", text: p.text || "" };
  }
  let html = "", text = "";
  const want: { part: string; kind: "html" | "text" }[] = [];
  const walk = (n: BS, top: boolean) => {
    if (n.childNodes?.length) { n.childNodes.forEach((x) => walk(x, false)); return; }
    if (/attachment/i.test(n.disposition || "")) return;
    const part = n.part || (top ? "1" : "");
    if (!part) return;
    if (/^text\/html$/i.test(n.type || "") && !want.some((w) => w.kind === "html")) want.push({ part, kind: "html" });
    if (/^text\/plain$/i.test(n.type || "") && !want.some((w) => w.kind === "text")) want.push({ part, kind: "text" });
  };
  walk(root, true);
  for (const w of want) {
    const d = await c.download(String(uid), w.part, { uid: true, maxBytes: 4 * 1024 * 1024 });
    if (!d?.content) continue; // the server didn't have that part
    const chunks: Buffer[] = [];
    for await (const ch of d.content as AsyncIterable<Buffer>) chunks.push(Buffer.from(ch));
    const body = Buffer.concat(chunks).toString("utf8");
    if (w.kind === "html") html = body; else text = body;
  }
  // pictures shown from the email's own attachments (cid:) aren't kept: a note instead of a broken picture
  html = html.replace(/<img\b[^>]*src\s*=\s*["']?cid:[^>]*>/gi, '<span style="display:inline-block;margin:4px 0;padding:6px 10px;border:1px dashed #b8c0cc;border-radius:6px;color:#6b7686;font:12px sans-serif">Picture left out here (Show the full email to see it)</span>');
  return { html, text };
}

/**
 * Emails kept without a body, read over EWS (Oct 13: Nick's big emails, which IMAP drops during the busy day). Up to
 * 5 a run, the worst first; whether EWS works for the mailbox is kept in app_keys "ews" (a failure waits 6 hours).
 */
export async function fixBodiesEws(admin: SupabaseClient, acct: MailAccount, deadline: number) {
  const { data: k } = await admin.from("app_keys").select("value").eq("name", "ews").maybeSingle();
  const st = ((k?.value || {}) as Record<string, { ok: boolean; detail: string; at: string }>);
  const mine = st[acct.email.toLowerCase()];
  if (mine && !mine.ok && Date.parse(mine.at) > Date.now() - 6 * 3600e3) return;
  const base = () => admin.from("mail_cache").select("id, folder, uid, message_id, size, body_tries").eq("account_id", acct.id)
    .is("gone_at", null).is("body_html", null).is("body_fixed_at", null).neq("message_id", "").lt("body_tries", 6).order("sent_at", { ascending: false }).limit(5);
  let { data } = await base().or("body_text.is.null,body_text.eq.");
  if (!data?.length) ({ data } = await base().gt("size", 200000));
  let result: { ok: boolean; detail: string } | null = null;
  for (const r of (data || []) as { id: string; folder: string; uid: number; message_id: string; size: number; body_tries: number }[]) {
    if (Date.now() > deadline) break;
    try {
      const e = await ewsMessage(acct, r.folder, r.uid, r.message_id, (id) => `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id })}`);
      result = { ok: true, detail: "" };
      if (!e) { await admin.from("mail_cache").update({ body_tries: (r.body_tries || 0) + 1 }).eq("id", r.id); continue; } // not found over EWS (moved): IMAP tries
      const { ews: _x, ...m } = e;
      await keepBody(admin, acct.id, r.folder, r.uid, m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`mail cache ews ${r.folder}:${r.uid}: ${msg}`);
      if (/401|sign-in refused|EWS 40[34]|EWS 5\d\d/.test(msg)) { result = { ok: false, detail: msg.slice(0, 200) }; break; }
    }
  }
  if (result && (!mine || mine.ok !== result.ok)) await admin.from("app_keys").upsert({ name: "ews", value: { ...st, [acct.email.toLowerCase()]: { ...result, at: new Date().toISOString() } } }, { onConflict: "name" });
}

/**
 * The slow lane (Oct 13): emails kept without a body, read over IMAP with all the time they need, in their own job
 * (/api/mail/bodies, every 5 minutes, up to 4 minutes). The mail server builds a big email the first time it's asked
 * for (that took longer than the 2-minute cache run allows, and the cut connection ended the run), so it's done here,
 * one email at a time, without holding up the cache.
 */
export async function fixBodiesSlow(admin: SupabaseClient, acct: MailAccount, deadline: number, skipBodies = false) {
  // one connection, at most 100 s (it's one of the couple the mail server allows: the mail check needs one too):
  // the header index first (Search older mail), then bodies of emails up to 6 MB (bigger ones never came through)
  const until = Math.min(deadline, Date.now() + 100000);
  return withBox(acct, async (c) => {
    const { indexAccount } = await import("./mailIndex");
    const idx = await indexAccount(admin, acct, c, until - 30000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    if (!skipBodies) await fixBodies(admin, acct.id, c, until - 10000);
    return idx;
  }, until + 5000, 60000);
}

async function fixBodies(admin: SupabaseClient, accountId: string, c: ImapFlow, deadline: number) {
  // HTML missing and something to fix: no text at all, or a big email (pictures / attachments). A small plain-text
  // email has no HTML to get.
  const base = () => admin.from("mail_cache").select("id, folder, uid, uidvalidity, size, body_tries").eq("account_id", accountId)
    .is("gone_at", null).is("body_html", null).is("body_fixed_at", null).lt("body_tries", 6).lte("size", 6 * 1024 * 1024).order("sent_at", { ascending: false }).limit(3);
  let { data } = await base().or("body_text.is.null,body_text.eq.");
  if (!data?.length) ({ data } = await base().gt("size", 200000));
  for (const r of (data || []) as { id: string; folder: string; uid: number; uidvalidity: number; size: number; body_tries: number }[]) {
    if (Date.now() > deadline) break;
    const patch: Record<string, unknown> = { body_fixed_at: new Date().toISOString() };
    // counted before asking: an email that makes the server drop the connection ends this run, so it can't be
    // counted afterwards (tried twice, then left alone)
    await admin.from("mail_cache").update({ body_tries: (r.body_tries || 0) + 1 }).eq("id", r.id);
    let lock: { release: () => void } | null = null;
    try {
      lock = await c.getMailboxLock(r.folder);
      const mb = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
      if (Number(mb?.uidValidity || 0) !== Number(r.uidvalidity)) continue; // the folder was rebuilt: the cache run sorts it out
      // only the words and the HTML, never the attachments (Oct 13: downloading a 9.5 MB email whole got the
      // connection cut every run)
      const b = await bodyOnly(c, r.uid);
      if (!b) { console.warn(`mail cache body ${r.folder}:${r.uid}: not read`); continue; }
      const slim = b.html ? slimHtml(b.html) : null;
      if (slim) { patch.body_html = slim.html; patch.body_trimmed = true; }
      patch.body_text = (b.text || (b.html ? htmlText(b.html) : "")).slice(0, 100000);
    } catch (e) { console.warn(`mail cache body ${r.folder}:${r.uid} (${r.size} bytes): ${e instanceof Error ? e.message : e}`); continue; /* tried again next run */ }
    finally { lock?.release(); }
    await admin.from("mail_cache").update(patch).eq("id", r.id);
  }
}

/** a live read, kept in the cache so it opens instantly next time (Oct 13) */
export async function keepBody(admin: SupabaseClient, accountId: string, folder: string, uid: number, m: FullMsg) {
  const slim = m.html ? slimHtml(m.html) : null;
  const patch: Record<string, unknown> = { body_fixed_at: new Date().toISOString() };
  if (slim) { patch.body_html = slim.html; patch.body_trimmed = slim.trimmed; }
  patch.body_text = (m.text || (m.html ? htmlText(m.html) : "")).slice(0, 100000);
  // read over EWS: its attachments (opened by their EWS id) are kept too, so they show from the cache
  if (m.attachments?.some((a) => a.ews)) { patch.attachments = m.attachments; patch.body_trimmed = !!slim?.trimmed; }
  await admin.from("mail_cache").update(patch).eq("account_id", accountId).eq("folder", folder).eq("uid", uid).is("body_html", null);
}

/** is this folder fully cached (the server's 45-day count and ours agree, checked in the last 15 minutes)? */
export async function folderCached(admin: SupabaseClient, accountId: string, folder: string) {
  const { data } = await admin.from("mail_cache_state").select("in_window, cached, checked_at").eq("account_id", accountId).eq("folder", folder).maybeSingle();
  return !!data && !!data.checked_at && Date.parse(data.checked_at as string) > Date.now() - 15 * 60000 && Number(data.cached) >= Number(data.in_window);
}

type CacheRow = { folder: string; uid: number; message_id: string; in_reply_to: string; refs: string[]; subject: string; from_email: string; from_name: string; to_list: string[]; cc_list: string[]; to_text: string; cc_text: string; reply_to: string; sent_at: string; seen: boolean; flagged: boolean; size: number; body_text: string; body_html: string | null; attachments: { i: number; name: string; size: number; type: string }[] };
const ROW_COLS = "folder, uid, message_id, in_reply_to, subject, from_email, from_name, to_list, cc_list, to_text, sent_at, seen, flagged, size";
export const rowOf = (r: CacheRow, me: string): MsgRow => ({ folder: r.folder, uid: Number(r.uid), messageId: r.message_id, inReplyTo: r.in_reply_to, subject: r.subject, from: r.from_email, fromName: r.from_name, to: r.to_list || [], toNames: (r.to_text || "").split(/,\s*/).map((x) => x.replace(/\s*\S+@\S+$/, "").trim() || x.trim()).filter(Boolean), cc: r.cc_list || [], date: r.sent_at, seen: r.seen, flagged: r.flagged, sent: r.from_email === me, size: r.size });

/** a folder's newest 50 from the cache (`beforeDate`: page back) */
export async function cachedList(admin: SupabaseClient, accountId: string, me: string, folder: string, beforeDate?: string) {
  let q = admin.from("mail_cache").select(ROW_COLS).eq("account_id", accountId).eq("folder", folder).is("gone_at", null).order("sent_at", { ascending: false }).limit(50);
  if (beforeDate) q = q.lt("sent_at", beforeDate);
  const { data } = await q;
  return ((data || []) as unknown as CacheRow[]).map((r) => rowOf(r, me));
}

/** one email from the cache, as the live reader returns it (null: not cached, or too big to have kept its HTML) */
export async function cachedMessage(admin: SupabaseClient, accountId: string, folder: string, uid: number): Promise<FullMsg | null> {
  const { data } = await admin.from("mail_cache").select("*").eq("account_id", accountId).eq("folder", folder).eq("uid", uid).is("gone_at", null).order("cached_at", { ascending: false }).limit(1).maybeSingle();
  const r = data as (CacheRow & { size: number }) | null;
  if (!r) return null;
  // nothing kept to show (saved by its headers only): read it live. Only plain text kept: show that now, with
  // "Show the full email" (Oct 13: these waited on the mailbox and sat on "Opening…")
  if (!r.body_html && !(r.body_text || "").trim()) return null;
  const who = (name: string, addr: string) => (name ? `"${name}" <${addr}>` : addr);
  return {
    folder, uid, messageId: r.message_id ? `<${r.message_id}>` : "", references: (r.refs || []).map((x) => `<${x}>`),
    fromAddress: r.reply_to || r.from_email, fromName: r.from_name, from: who(r.from_name, r.from_email), to: r.to_text, cc: r.cc_text, subject: r.subject, date: r.sent_at,
    html: r.body_html || "", text: r.body_text, attachments: r.attachments || [],
    partial: !!(r as { body_trimmed?: boolean }).body_trimmed || (!r.body_html && r.size > 200_000), seen: r.seen,
  };
}

/**
 * Search the last 45 days instantly: every word must appear (in who, subject or the text); a customer's name also
 * finds their addresses. Grouped into conversations like the live search.
 */
export async function cachedSearch(admin: SupabaseClient, accountId: string, me: string, q: string, extraAddrs: string[]) {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_,()]/g, "")).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [] as MsgRow[];
  const pick = async (fn: (x: ReturnType<typeof base>) => ReturnType<typeof base>) => { const { data } = await fn(base()).limit(400); return (data || []) as unknown as CacheRow[]; };
  const base = () => admin.from("mail_cache").select(ROW_COLS).eq("account_id", accountId).is("gone_at", null);
  const byWords = await pick((x) => { let y = x; for (const w of words) y = y.ilike("hay", `%${w}%`); return y; });
  const byAddr = extraAddrs.length ? await pick((x) => x.or(extraAddrs.slice(0, 10).map((a) => `hay.ilike.%${a.replace(/[%_,()]/g, "")}%`).join(","))) : [];
  const seen = new Set<string>(), out: MsgRow[] = [];
  for (const r of [...byWords, ...byAddr]) { const k = r.message_id || `${r.folder}:${r.uid}`; if (seen.has(k)) continue; seen.add(k); out.push(rowOf(r, me)); }
  return out;
}

/**
 * The quick first answer to a search (Oct 20, Nick: "the search function on my email is very slow"): from our own copy
 * of the mailbox only — the 45-day cache (who, subject and the words inside) and the kept headers going back years —
 * in well under a second (trigram indexes on `hay`). The page shows these at once while the mailbox's own search
 * (EWS: 14–27 s the first time a word is searched) finishes, then shows the mailbox's answer.
 * `who`: only emails from / to / cc those addresses (or "@domain"); `words` may then be empty (everything with them).
 */
export async function mirrorSearch(admin: SupabaseClient, accountId: string, me: string, q: string, addrs: string[], who: string[] = []) {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_,()]/g, "")).filter((w) => w.length >= 2).slice(0, 6);
  const keys = [...new Set([...who, ...addrs].map((a) => a.toLowerCase().replace(/[%_,()"]/g, "")).filter((a) => a.length >= 3))].slice(0, 12);
  if (!words.length && !keys.length) return [] as MsgRow[];
  const idxCols = "folder, uid, message_id, in_reply_to, subject, from_email, from_name, to_list, cc_list, to_text, sent_at, size";
  const cache = () => admin.from("mail_cache").select(ROW_COLS).eq("account_id", accountId).is("gone_at", null).order("sent_at", { ascending: false }).limit(200);
  const index = () => admin.from("mail_index").select(idxCols).eq("account_id", accountId).order("sent_at", { ascending: false }).limit(250);
  const anyKey = keys.map((a) => `hay.ilike.%${a}%`).join(",");
  const none = Promise.resolve({ data: [] as unknown[] });
  // a person picked: their emails (about a project: the emails with those words, then only theirs); else the words,
  // and a customer's addresses when the words are their name
  const byKeys = keys.length && (!who.length || !words.length);
  let cw = cache(), iw = index();
  for (const w of words) { cw = cw.ilike("hay", `%${w}%`); iw = iw.ilike("hay", `%${w}%`); }
  const [c1, c2, i1, i2] = await Promise.all([
    words.length ? cw : none,
    byKeys ? cache().or(anyKey) : none,
    words.length ? iw : none,
    byKeys ? index().or(anyKey) : none,
  ]);
  type IdxRow = Omit<CacheRow, "seen" | "flagged">;
  const rows: MsgRow[] = [], seen = new Set<string>();
  const add = (m: MsgRow) => { const k = m.messageId || `${m.folder}:${m.uid}`; if (seen.has(k)) return; seen.add(k); rows.push(m); };
  // the cache first: it's kept current (moved / gone emails), the kept headers may still show an email's old folder
  for (const r of [...((c1.data || []) as unknown as CacheRow[]), ...((c2.data || []) as unknown as CacheRow[])]) add(rowOf(r, me));
  for (const r of [...((i1.data || []) as unknown as IdxRow[]), ...((i2.data || []) as unknown as IdxRow[])]) add(rowOf({ ...(r as CacheRow), seen: true, flagged: false }, me));
  // never junk, deleted or drafts (as the mailbox search leaves them out)
  const hidden = (f: string) => /(^|\/)(junk( e-?mail)?|deleted items|trash|drafts|@saneblackhole)$/i.test(f);
  const mine = (m: MsgRow) => !who.length || [m.from, ...(m.to || []), ...(m.cc || [])].some((x) => { const a = String(x || "").toLowerCase(); return who.some((w) => (w.startsWith("@") ? a.endsWith(w) : a === w)); });
  return rows.filter((m) => !hidden(m.folder) && mine(m));
}

export type { Convo };
