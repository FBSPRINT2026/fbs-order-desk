import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailAccount } from "./config";
import { slimHtml, withBox, type Convo, type FullMsg, type MsgRow } from "./folders";

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

async function cacheFolders(c: ImapFlow) {
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
        const { data: have } = await admin.from("mail_cache").select("id, uid, uidvalidity").eq("account_id", acct.id).eq("folder", f.path).is("gone_at", null).limit(20000);
        const rows = (have || []) as { id: string; uid: number; uidvalidity: number }[];
        const cached = new Set(rows.filter((r) => Number(r.uidvalidity) === validity).map((r) => Number(r.uid)));
        // left the folder (or the folder was rebuilt): gone
        const gone = rows.filter((r) => Number(r.uidvalidity) !== validity || !inWindow.has(Number(r.uid))).map((r) => r.id);
        for (let i = 0; i < gone.length; i += 200) await admin.from("mail_cache").update({ gone_at: new Date().toISOString() }).in("id", gone.slice(i, i + 200));
        tally.gone += gone.length;
        // emails kept without a body come before ones not kept yet, with up to 8 s of the run (an email that won't
        // open is worse than one that isn't in the cache yet: that one is read from the mailbox)
        if (Date.now() < deadline - 10000) await fixBodies(admin, acct.id, c, f.path, validity, Math.min(deadline - 6000, Date.now() + 8000));
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
            if (!m) continue;
            const p = !big && m.source ? await simpleParser(m.source) : null;
            const env = m.envelope;
            const from = p ? addrList(p.from)[0] : env?.from?.[0];
            const to = p ? addrList(p.to) : env?.to || [], cc = p ? addrList(p.cc) : env?.cc || [];
            const subject = (p?.subject ?? env?.subject ?? "").slice(0, 500);
            const text = (p?.text || (typeof p?.html === "string" ? htmlText(p.html) : "")).slice(0, 100000);
            // big pasted pictures are left out of the kept HTML, so the email still opens from the cache (Oct 13)
            const slim = typeof p?.html === "string" ? slimHtml(p.html) : null;
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
              body_text: text, body_html: big ? null : html, body_trimmed: !!slim?.trimmed, body_fixed_at: big ? null : new Date().toISOString(), attachments: atts,
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

async function fixBodies(admin: SupabaseClient, accountId: string, c: ImapFlow, folder: string, validity: number, deadline: number) {
  const base = () => admin.from("mail_cache").select("id, uid, size").eq("account_id", accountId).eq("folder", folder).eq("uidvalidity", validity)
    .is("gone_at", null).is("body_html", null).is("body_fixed_at", null).lte("size", 10 * 1024 * 1024).order("sent_at", { ascending: false }).limit(3);
  // the ones with nothing at all to show first (no text either), then the rest
  let { data } = await base().or("body_text.is.null,body_text.eq.");
  if (!data?.length) ({ data } = await base());
  for (const r of (data || []) as { id: string; uid: number; size: number }[]) {
    if (Date.now() > deadline) break;
    const patch: Record<string, unknown> = { body_fixed_at: new Date().toISOString() };
    try {
      const m = await c.fetchOne(String(r.uid), { source: true }, { uid: true });
      if (!m || !m.source) continue; // not read this time (connection cut): tried again next run
      const p = await simpleParser(m.source);
      const slim = typeof p.html === "string" ? slimHtml(p.html) : null;
      if (slim) { patch.body_html = slim.html; patch.body_trimmed = slim.trimmed; }
      patch.body_text = (p.text || (typeof p.html === "string" ? htmlText(p.html) : "")).slice(0, 100000);
    } catch { continue; /* the connection dropped: tried again next run */ }
    await admin.from("mail_cache").update(patch).eq("id", r.id);
  }
}

/** a live read, kept in the cache so it opens instantly next time (Oct 13) */
export async function keepBody(admin: SupabaseClient, accountId: string, folder: string, uid: number, m: FullMsg) {
  const slim = m.html ? slimHtml(m.html) : null;
  const patch: Record<string, unknown> = { body_fixed_at: new Date().toISOString() };
  if (slim) { patch.body_html = slim.html; patch.body_trimmed = slim.trimmed; }
  patch.body_text = (m.text || (m.html ? htmlText(m.html) : "")).slice(0, 100000);
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

export type { Convo };
