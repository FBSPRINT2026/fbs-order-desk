import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { cfgOf, type MailAccount } from "./config";
import { imapClient } from "./imap";

/**
 * The Outlook Inbox, mirrored (Oct 12, Nick: "I leave in there just the stuff I need to work on for the day… I archive
 * them to get them out… I don't want to double work"). Every mailbox check lists what's sitting in the person's Inbox
 * right now (mail_inbox, one row per email):
 *  - archived / moved out in Outlook → the row is gone (gone_at), and a customer email stops needing a reply
 *    (activities.meta.outlook_archived);
 *  - moved back into the Inbox → it's back, and needs a reply again if it did;
 *  - Archive in the portal moves it to Archive in Outlook (archiveInbox).
 * Non-customer mail (tax, receipts, vendors) is listed by sender and subject only; the portal still doesn't keep it.
 * cc_only: the person is only on Cc, not To (copied, not theirs to answer).
 */
const MAX = 500;
type Env = { uid: number; flags: Set<string>; messageId: string; from: { address: string; name: string }; to: string[]; cc: string[]; subject: string; date: Date | null };
type Row = { id: string; uid: number; uidvalidity: number; message_id: string; activity_id: string | null; unread: boolean; flagged: boolean };

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");

export async function mirrorInbox(admin: SupabaseClient, client: ImapFlow, acct: Pick<MailAccount, "id" | "email">, validity: number) {
  const me = lc(acct.email);
  const found = await client.search({ all: true }, { uid: true });
  const all = (Array.isArray(found) ? found : []).sort((a, b) => a - b);
  const uids = all.slice(-MAX);
  const truncated = all.length > uids.length;
  const envs: Env[] = [];
  if (uids.length) {
    for await (const m of client.fetch(uids.join(","), { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })) {
      const e = m.envelope;
      const ad = (l?: { address?: string; name?: string }[]) => (l || []).map((x) => lc(x.address)).filter(Boolean);
      envs.push({
        uid: m.uid, flags: m.flags || new Set(), messageId: mid(e?.messageId), subject: (e?.subject || "").slice(0, 300),
        from: { address: lc(e?.from?.[0]?.address), name: (e?.from?.[0]?.name || "").slice(0, 200) }, to: ad(e?.to), cc: ad(e?.cc),
        date: e?.date ? new Date(e.date) : m.internalDate ? new Date(m.internalDate) : null,
      });
    }
  }
  const { data: cur } = await admin.from("mail_inbox").select("id, uid, uidvalidity, message_id, activity_id, unread, flagged").eq("account_id", acct.id).is("gone_at", null).limit(2000);
  const rows = (cur || []) as Row[];
  const byUid = new Map(rows.filter((r) => Number(r.uidvalidity) === validity).map((r) => [Number(r.uid), r]));
  const byMsg = new Map(rows.filter((r) => r.message_id).map((r) => [r.message_id, r]));
  const now = new Date().toISOString(), keep = new Set<string>();
  // the customer email on file for these messages
  const ids = [...new Set(envs.map((e) => e.messageId).filter(Boolean))];
  const acts = new Map<string, { id: string; meta: Record<string, unknown> }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("activities").select("id, external_id, meta").eq("kind", "email").in("external_id", ids.slice(i, i + 100).flatMap((x) => [x, `<${x}>`]));
    for (const a of (data || []) as { id: string; external_id: string; meta: Record<string, unknown> | null }[]) if (!acts.has(mid(a.external_id))) acts.set(mid(a.external_id), { id: a.id, meta: a.meta || {} });
  }
  let added = 0;
  for (const e of envs) {
    const r = byUid.get(e.uid) || (e.messageId ? byMsg.get(e.messageId) : undefined);
    const act = e.messageId ? acts.get(e.messageId) : undefined;
    const unread = !e.flags.has("\\Seen"), flagged = e.flags.has("\\Flagged");
    if (r) {
      keep.add(r.id);
      const patch: Record<string, unknown> = {};
      if (Number(r.uid) !== e.uid || Number(r.uidvalidity) !== validity) { patch.uid = e.uid; patch.uidvalidity = validity; }
      if (r.unread !== unread) patch.unread = unread;
      if (r.flagged !== flagged) patch.flagged = flagged;
      if (!r.activity_id && act) patch.activity_id = act.id;
      if (Object.keys(patch).length) await admin.from("mail_inbox").update(patch).eq("id", r.id);
    } else {
      const cc_only = !e.to.includes(me) && e.cc.includes(me);
      const { error } = await admin.from("mail_inbox").insert({
        account_id: acct.id, uid: e.uid, uidvalidity: validity, message_id: e.messageId, from_email: e.from.address, from_name: e.from.name,
        subject: e.subject, received_at: e.date && !isNaN(+e.date) ? e.date.toISOString() : null, cc_only, unread, flagged, activity_id: act?.id || null,
      });
      if (!error) added++;
    }
    // in the Inbox: a customer email archived earlier (in Outlook or here) is back
    if (act && act.meta.outlook_archived) {
      const { outlook_archived: _drop, ...rest } = act.meta; void _drop;
      await admin.from("activities").update({ meta: { ...rest, back_in_inbox_at: now } }).eq("id", act.id);
      act.meta = rest;
    }
  }
  // no longer in the Inbox: archived, moved or deleted in Outlook
  const gone = rows.filter((r) => !keep.has(r.id));
  if (gone.length) {
    await admin.from("mail_inbox").update({ gone_at: now }).in("id", gone.map((r) => r.id));
    await archiveActs(admin, gone.map((r) => r.activity_id).filter(Boolean) as string[], now);
  }
  // customer email from this mailbox that isn't in the Inbox any more (archived before the mirror started, or never
  // linked): stops needing a reply. Only as far back as the Inbox was read.
  const inbox = new Set(ids);
  const oldest = truncated ? envs.reduce((m, e) => (e.date && (!m || e.date < m) ? e.date : m), null as Date | null) : null;
  const since = new Date(Math.max(Date.now() - 30 * 864e5, oldest ? +oldest : 0)).toISOString();
  const { data: mine } = await admin.from("activities").select("id, external_id, meta").eq("kind", "email").eq("direction", "in")
    .eq("meta->>account_id", acct.id).eq("meta->>mailbox", "inbox").is("meta->>outlook_archived", null).gte("occurred_at", since).limit(800);
  const out = ((mine || []) as { id: string; external_id: string | null }[]).filter((a) => a.external_id && !inbox.has(mid(a.external_id))).map((a) => a.id);
  if (out.length) await archiveActs(admin, out, now);
  return { inbox: envs.length, added, gone: gone.length, archived: out.length };
}

async function archiveActs(admin: SupabaseClient, ids: string[], at: string) {
  if (!ids.length) return;
  const { data } = await admin.from("activities").select("id, meta").in("id", ids);
  for (const a of (data || []) as { id: string; meta: Record<string, unknown> | null }[]) {
    if (a.meta?.outlook_archived) continue;
    await admin.from("activities").update({ meta: { ...(a.meta || {}), outlook_archived: at } }).eq("id", a.id);
  }
}

/** the folder Outlook's Archive button uses: special-use \Archive, else the top-level "Archive" */
async function archiveFolder(client: ImapFlow) {
  const list = await client.list();
  return (list.find((f) => f.specialUse === "\\Archive") || list.find((f) => /^archive$/i.test(f.path)) || list.find((f) => /^archive$/i.test(f.name)))?.path || null;
}

/** Archive in the portal: moves the email to Archive in the person's Outlook (their own mailbox only) */
export async function archiveInbox(admin: SupabaseClient, acct: MailAccount, rowId: string, by: string) {
  const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id, activity_id, gone_at").eq("id", rowId).maybeSingle();
  if (!r || r.account_id !== acct.id) throw new Error("That email isn't in your Inbox.");
  const now = new Date().toISOString();
  if (!r.gone_at) {
    const client = imapClient(cfgOf(acct));
    await client.connect();
    try {
      const dest = await archiveFolder(client);
      if (!dest) throw new Error("Couldn't find your Archive folder in Outlook.");
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mb = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
        let uid: number | undefined = Number(mb?.uidValidity || 0) === Number(r.uidvalidity) ? Number(r.uid) : undefined;
        // make sure it's the same email (by Message-ID) before moving anything
        if (r.message_id) {
          const hit = await client.search({ header: { "message-id": r.message_id } }, { uid: true }).catch(() => [] as number[]);
          const list = Array.isArray(hit) ? hit : [];
          uid = list.length ? (uid && list.includes(uid) ? uid : list[0]) : undefined;
        }
        if (uid) await client.messageMove(String(uid), dest, { uid: true });
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => null); }
  }
  await admin.from("mail_inbox").update({ gone_at: r.gone_at || now, done_by: by.slice(0, 80) }).eq("id", r.id);
  if (r.activity_id) await archiveActs(admin, [r.activity_id], now);
}
