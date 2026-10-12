import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailAccount } from "./config";
import { withBox, type Convo, type FullMsg, type MsgRow } from "./folders";

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
  await withBox(acct, async (c) => {
    for (const f of await cacheFolders(c)) {
      if (Date.now() > deadline - 4000) break;
      const lock = await c.getMailboxLock(f.path);
      try {
        const mb = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
        const validity = Number(mb?.uidValidity || 0);
        const found = await c.search({ since: since() }, { uid: true }).catch(() => [] as number[]);
        const inWindow = new Set(Array.isArray(found) ? found : []);
        const { data: have } = await admin.from("mail_cache").select("id, uid, uidvalidity").eq("account_id", acct.id).eq("folder", f.path).is("gone_at", null).limit(20000);
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
            if (!m) continue;
            const p = !big && m.source ? await simpleParser(m.source) : null;
            const env = m.envelope;
            const from = p ? addrList(p.from)[0] : env?.from?.[0];
            const to = p ? addrList(p.to) : env?.to || [], cc = p ? addrList(p.cc) : env?.cc || [];
            const subject = (p?.subject ?? env?.subject ?? "").slice(0, 500);
            const text = (p?.text || "").slice(0, 100000);
            let html = typeof p?.html === "string" ? p.html : null;
            if (html && html.length > 900_000) html = null;
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
              body_text: text, body_html: big ? null : html, attachments: atts,
              hay: [from?.name, from?.address, toText, ccText, subject, text.slice(0, 4000)].filter(Boolean).join(" ").toLowerCase().slice(0, 8000),
            };
            const { error } = await admin.from("mail_cache").upsert(row, { onConflict: "account_id,folder,uidvalidity,uid" });
            if (!error) { saved++; tally.saved++; }
          } catch { /* skip this one; tried again next run */ }
        }
        await admin.from("mail_cache_state").upsert({ account_id: acct.id, folder: f.path, uidvalidity: validity, in_window: inWindow.size, cached: cached.size + saved, checked_at: new Date().toISOString() });
        tally.folders++;
      } finally { lock.release(); }
    }
  }, deadline); // a hard stop at the deadline: never left hanging past the time limit
  return tally;
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
  if (r.body_html === null && r.size > 600_000) return null; // big email: its formatting wasn't kept; read it live
  const who = (name: string, addr: string) => (name ? `"${name}" <${addr}>` : addr);
  return {
    folder, uid, messageId: r.message_id ? `<${r.message_id}>` : "", references: (r.refs || []).map((x) => `<${x}>`),
    fromAddress: r.reply_to || r.from_email, fromName: r.from_name, from: who(r.from_name, r.from_email), to: r.to_text, cc: r.cc_text, subject: r.subject, date: r.sent_at,
    html: r.body_html || "", text: r.body_text, attachments: r.attachments || [],
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
