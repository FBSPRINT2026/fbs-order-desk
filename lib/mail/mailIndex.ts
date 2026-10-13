import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import type { MailAccount } from "./config";
import { toRow, type MsgRow } from "./folders";
import { cacheFolders } from "./cache";

/**
 * Every email's header (who, to whom, subject, date), all the way back (Oct 13, Nick: "Searching older mail" found
 * nothing for Treadlabs). Searching older mail asked the mail server folder by folder, over a connection it allows
 * only a couple of, and failed quietly when it was busy. Now the headers are kept here, a few thousand per run
 * (newest first, then going back), and older mail is searched from our own copy, instantly.
 */
const lc = (s?: string | null) => (s || "").trim().toLowerCase();

export async function indexAccount(admin: SupabaseClient, acct: MailAccount, c: ImapFlow, deadline: number) {
  const tally = { added: 0, folders: 0 };
  const { data: sts } = await admin.from("mail_index_state").select("*").eq("account_id", acct.id);
  const state = new Map(((sts || []) as { folder: string; uidvalidity: number; total: number; indexed: number; low_uid: number | null; high_uid: number | null }[]).map((x) => [x.folder, x]));
  const folders = await cacheFolders(c);
  // folders still to finish first (Inbox, Sent, Archive lead), finished ones only for what's new
  const todo = folders.map((f, i) => ({ f, i, left: (() => { const s = state.get(f.path); return !s ? 1e9 : Math.max(0, s.total - s.indexed); })() }))
    .sort((a, b) => (b.left > 0 ? 1 : 0) - (a.left > 0 ? 1 : 0) || a.i - b.i).map((x) => x.f);
  for (const f of todo) {
    if (Date.now() > deadline - 3000) break;
    const lock = await c.getMailboxLock(f.path).catch(() => null);
    if (!lock) continue;
    try {
      const mb = c.mailbox && typeof c.mailbox === "object" ? c.mailbox : null;
      const validity = Number(mb?.uidValidity || 0);
      const st = state.get(f.path);
      const same = st && Number(st.uidvalidity) === validity;
      let low = same ? (st!.low_uid == null ? Infinity : Number(st!.low_uid)) : Infinity;
      let high = same ? (st!.high_uid == null ? 0 : Number(st!.high_uid)) : 0;
      let indexed = same ? st!.indexed : 0;
      const found = await c.search({ all: true }, { uid: true }).catch(() => null);
      if (!Array.isArray(found)) continue;
      const all = found.sort((a, b) => b - a);
      // new since last time (newest first), then the older ones not done yet
      const queue = [...all.filter((u) => u > high), ...all.filter((u) => u < low)];
      const save = () => admin.from("mail_index_state").upsert({ account_id: acct.id, folder: f.path, uidvalidity: validity, total: all.length, indexed: Math.min(indexed, all.length), low_uid: Number.isFinite(low) ? low : null, high_uid: high || null, checked_at: new Date().toISOString() });
      while (queue.length && Date.now() < deadline - 3000) {
        const batch = queue.splice(0, 400);
        const rows: Record<string, unknown>[] = [];
        for await (const m of c.fetch(batch.join(","), { uid: true, envelope: true, size: true, internalDate: true }, { uid: true })) {
          const r: MsgRow = toRow(f.path, lc(acct.email), m as never);
          const e = (m as { envelope?: { to?: { name?: string; address?: string }[]; cc?: { name?: string; address?: string }[] } }).envelope || {};
          const toText = [...(e.to || []), ...(e.cc || [])].map((x) => [x.name, x.address].filter(Boolean).join(" ")).join(", ").slice(0, 1500);
          rows.push({
            account_id: acct.id, folder: f.path, uidvalidity: validity, uid: r.uid, message_id: r.messageId, in_reply_to: r.inReplyTo, subject: r.subject.slice(0, 500),
            from_email: r.from, from_name: r.fromName.slice(0, 200), to_list: r.to, cc_list: r.cc, to_text: toText, sent_at: r.date, size: r.size,
            hay: [r.fromName, r.from, toText, r.subject].filter(Boolean).join(" ").toLowerCase().slice(0, 3000),
          });
        }
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await admin.from("mail_index").upsert(rows.slice(i, i + 500), { onConflict: "account_id,folder,uidvalidity,uid", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
        }
        tally.added += rows.length; indexed += rows.length;
        high = Math.max(high, ...batch); low = Math.min(low, ...batch);
        await save(); // after every batch: a run cut short keeps what it did
      }
      await save();
      tally.folders++;
    } finally { lock.release(); }
  }
  return tally;
}

/** search the kept headers (every word in who / to whom / subject; a customer's addresses too) */
export async function indexSearch(admin: SupabaseClient, accountId: string, me: string, q: string, extraAddrs: string[]) {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_,()]/g, "")).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return { rows: [] as MsgRow[], done: true, indexed: 0, total: 0 };
  const cols = "folder, uid, message_id, in_reply_to, subject, from_email, from_name, to_list, cc_list, to_text, sent_at, size";
  const base = () => admin.from("mail_index").select(cols).eq("account_id", accountId).order("sent_at", { ascending: false }).limit(300);
  type R = { folder: string; uid: number; message_id: string; in_reply_to: string; subject: string; from_email: string; from_name: string; to_list: string[]; cc_list: string[]; to_text: string; sent_at: string; size: number };
  let q1 = base(); for (const w of words) q1 = q1.ilike("hay", `%${w}%`);
  const [{ data: a }, { data: b }, { data: st }] = await Promise.all([
    q1,
    extraAddrs.length ? base().or(extraAddrs.slice(0, 10).map((x) => `hay.ilike.%${x.replace(/[%_,()]/g, "")}%`).join(",")) : Promise.resolve({ data: [] as R[] }),
    admin.from("mail_index_state").select("total, indexed").eq("account_id", accountId),
  ]);
  const seen = new Set<string>(), rows: MsgRow[] = [];
  for (const r of [...((a || []) as R[]), ...((b || []) as R[])]) {
    const k = r.message_id || `${r.folder}:${r.uid}`;
    if (seen.has(k)) continue; seen.add(k);
    rows.push({ folder: r.folder, uid: Number(r.uid), messageId: r.message_id, inReplyTo: r.in_reply_to, subject: r.subject, from: r.from_email, fromName: r.from_name, to: r.to_list || [], toNames: (r.to_text || "").split(/,\s*/).map((x) => x.replace(/\s*\S+@\S+$/, "").trim() || x.trim()).filter(Boolean), cc: r.cc_list || [], date: r.sent_at, seen: true, flagged: false, sent: r.from_email === me, size: r.size });
  }
  const s = (st || []) as { total: number; indexed: number }[];
  const total = s.reduce((n, x) => n + x.total, 0), indexed = s.reduce((n, x) => n + x.indexed, 0);
  return { rows, done: !!s.length && indexed >= total, indexed, total };
}
