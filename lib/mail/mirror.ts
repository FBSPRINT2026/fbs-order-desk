import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { cfgOf, type MailAccount } from "./config";
import { imapClient, toMsg } from "./imap";
import { simpleParser } from "mailparser";
import { aiState } from "@/lib/ai/claude";
import { organizeEmail } from "@/lib/ai/organize";

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
type Env = { uid: number; flags: Set<string>; att: boolean; messageId: string; from: { address: string; name: string }; to: string[]; cc: string[]; subject: string; date: Date | null };
type Row = { id: string; uid: number; uidvalidity: number; message_id: string; activity_id: string | null; unread: boolean; flagged: boolean; has_attachments?: boolean };
/** an attachment anywhere in the message (a file, not a picture inside the body) */
type Node = { type?: string; disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; id?: string; childNodes?: Node[] };
const hasFile = (n?: Node | null): boolean => !!n && ((n.disposition || "").toLowerCase() === "attachment" || ((n.disposition || "").toLowerCase() !== "inline" && !n.id && !(n.type || "").startsWith("text/") && !(n.type || "").startsWith("multipart/") && !!(n.dispositionParameters?.filename || n.parameters?.name)) || (n.childNodes || []).some(hasFile));

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");

export async function mirrorInbox(admin: SupabaseClient, client: ImapFlow, acct: Pick<MailAccount, "id" | "email" | "name">, validity: number, deadline = Date.now() + 20000) {
  const me = lc(acct.email);
  // what's in the Inbox is read first and compared after: an email archived in the portal meanwhile isn't brought
  // back as "moved back into the Inbox" (Oct 14, Nick: "if I archive something it pops back into the inbox")
  const t0 = new Date().toISOString();
  const found = await client.search({ all: true }, { uid: true });
  const all = (Array.isArray(found) ? found : []).sort((a, b) => a - b);
  const uids = all.slice(-MAX);
  const truncated = all.length > uids.length;
  const envs: Env[] = [];
  if (uids.length) {
    for await (const m of client.fetch(uids.join(","), { uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true })) {
      const e = m.envelope;
      const ad = (l?: { address?: string; name?: string }[]) => (l || []).map((x) => lc(x.address)).filter(Boolean);
      envs.push({
        uid: m.uid, flags: m.flags || new Set(), att: hasFile(m.bodyStructure as unknown as Node), messageId: mid(e?.messageId), subject: (e?.subject || "").slice(0, 300),
        from: { address: lc(e?.from?.[0]?.address), name: (e?.from?.[0]?.name || "").slice(0, 200) }, to: ad(e?.to), cc: ad(e?.cc),
        date: e?.date ? new Date(e.date) : m.internalDate ? new Date(m.internalDate) : null,
      });
    }
  }
  const { data: cur } = await admin.from("mail_inbox").select("id, uid, uidvalidity, message_id, activity_id, unread, flagged, has_attachments").eq("account_id", acct.id).is("gone_at", null).limit(2000);
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
      if (!!r.has_attachments !== e.att) patch.has_attachments = e.att;
      if (!r.activity_id && act) patch.activity_id = act.id;
      if (Object.keys(patch).length) await admin.from("mail_inbox").update(patch).eq("id", r.id);
    } else {
      const cc_only = !e.to.includes(me) && e.cc.includes(me);
      // moved back into the Inbox: the same row comes back, and the to-dos archiving closed are open again
      const { data: was } = e.messageId ? await admin.from("mail_inbox").select("id, gone_at").eq("account_id", acct.id).eq("message_id", e.messageId).not("gone_at", "is", null).order("gone_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
      if (was && (was as { gone_at: string }).gone_at >= t0) continue; // moved out after the Inbox was read: stays gone
      if (was) {
        await admin.from("mail_inbox").update({ gone_at: null, done_by: null, uid: e.uid, uidvalidity: validity, unread, flagged, has_attachments: e.att, ...(act ? { activity_id: act.id } : {}) }).eq("id", was.id);
        await admin.from("tasks").update({ status: "open", done_at: null, done_by: null }).eq("mail_inbox_id", was.id).eq("status", "done").eq("done_by", ARCHIVED);
        keep.add(was.id as string);
        if (act && act.meta.outlook_archived) { const { outlook_archived: _d, ...rest } = act.meta; void _d; await admin.from("activities").update({ meta: { ...rest, back_in_inbox_at: now } }).eq("id", act.id); }
        continue;
      }
      const { error } = await admin.from("mail_inbox").insert({
        account_id: acct.id, uid: e.uid, uidvalidity: validity, message_id: e.messageId, from_email: e.from.address, from_name: e.from.name,
        subject: e.subject, received_at: e.date && !isNaN(+e.date) ? e.date.toISOString() : null, cc_only, unread, flagged, has_attachments: e.att, activity_id: act?.id || null,
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
    // archiving the email in Outlook = done with it: its to-dos close (moving it back reopens them)
    await admin.from("tasks").update({ status: "done", done_at: now, done_by: ARCHIVED }).in("mail_inbox_id", gone.map((r) => r.id)).eq("status", "open");
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
  const sorted = await sortPending(admin, client, acct, deadline).catch((e) => { console.error("sortPending", e instanceof Error ? e.message : e); return 0; });
  return { inbox: envs.length, added, gone: gone.length, archived: out.length, sorted };
}

export const ARCHIVED = "Archived in Outlook";

/**
 * Between mail checks (and while IMAP is refusing connections), the Inbox list can still show an email SaneBox or
 * Outlook already moved out; opening it then says it isn't there (Oct 14, Nick: the Pizza Hut email). For a mailbox
 * EWS works on, what's in the Inbox is read in under a second each time the list loads, and anything no longer there
 * is gone from the list. Only takes away (new mail still comes in with the mail check); at most every 15 s a mailbox.
 */
const pruned = new Map<string, number>();
export async function pruneInboxEws(admin: SupabaseClient, acct: MailAccount, force = false) {
  const k = acct.id;
  if (!force && Date.now() - (pruned.get(k) || 0) < 15000) return 0;
  pruned.set(k, Date.now());
  const { ewsReady, ewsInboxMessageIds } = await import("./ewsBox");
  if (!(await ewsReady(admin, acct))) return 0;
  const t0 = new Date(Date.now() - 60000).toISOString();
  const ids = await ewsInboxMessageIds(acct);
  if (!ids) return 0;
  // only emails the mirror had before this read (a brand-new one may not be listed yet)
  const { data: cur } = await admin.from("mail_inbox").select("id, message_id, activity_id").eq("account_id", acct.id).is("gone_at", null).lt("first_seen", t0).limit(2000);
  const gone = ((cur || []) as { id: string; message_id: string | null; activity_id: string | null }[]).filter((r) => r.message_id && !ids.has(r.message_id));
  if (!gone.length) return 0;
  const now = new Date().toISOString();
  await admin.from("mail_inbox").update({ gone_at: now }).in("id", gone.map((r) => r.id)).is("gone_at", null);
  await archiveActs(admin, gone.map((r) => r.activity_id).filter(Boolean) as string[], now);
  await admin.from("tasks").update({ status: "done", done_at: now, done_by: ARCHIVED }).in("mail_inbox_id", gone.map((r) => r.id)).eq("status", "open");
  return gone.length;
}

/** who gets the personal organizer (AI reading all their mail into to-dos and events): the two owners only, Oct 12 */
export const ORGANIZER_EMAILS = ["amanda@fbsprint.com"];
export const organizerFor = (email: string, role: string) => role === "owner" || ORGANIZER_EMAILS.includes(lc(email));

/**
 * My Day: what each email in the Inbox means for the person. Customer email is "customer" (its own flow); everything
 * else is read by the AI once: to-do / event / just so you know / ignore, with its to-dos and suggested events.
 * SaneBox already moves receipts and newsletters out of the Inbox, so what's left is mostly real email.
 * A few per mailbox check (newest first), so a run never runs long.
 */
async function sortPending(admin: SupabaseClient, client: ImapFlow, acct: Pick<MailAccount, "id" | "email" | "name">, deadline: number) {
  const { data } = await admin.from("mail_inbox").select("id, uid, message_id, activity_id, from_email, from_name, subject, received_at, cc_only")
    .eq("account_id", acct.id).is("gone_at", null).is("sorted_at", null).order("received_at", { ascending: false, nullsFirst: false }).limit(12);
  const rows = (data || []) as { id: string; uid: number; message_id: string; activity_id: string | null; from_email: string; from_name: string; subject: string; received_at: string | null; cc_only: boolean }[];
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  // customer email: its own flow (Needs reply, orders); the summary is the one on file
  for (const r of rows.filter((x) => x.activity_id)) {
    const { data: a } = await admin.from("activities").select("meta").eq("id", r.activity_id!).maybeSingle();
    const sum = String(((a?.meta || {}) as { triage?: { summary?: string } }).triage?.summary || "");
    await admin.from("mail_inbox").update({ bucket: "customer", summary: sum.slice(0, 300), sorted_at: now }).eq("id", r.id);
  }
  const rest = rows.filter((x) => !x.activity_id);
  if (!rest.length) return 0;
  // the personal organizer is for the owners (Nick, Amanda) only; everyone else's mail just mirrors
  const { data: who } = await admin.from("staff").select("role").eq("email", lc(acct.email)).maybeSingle();
  if (!organizerFor(acct.email, String(who?.role || ""))) return 0;
  const st = await aiState(admin);
  if (!st.ready) return 0;
  const owner = lc(acct.email);
  let n = 0;
  for (const r of rest.slice(0, 5)) {
    if (Date.now() > deadline - 12000) break;
    // a customer email still being read in (the next check links it): leave it for then
    if (Date.parse(r.received_at || now) > Date.now() - 4 * 60000) continue;
    let body = "", to = "", cc = "";
    try {
      const msg = await client.fetchOne(String(r.uid), { source: true, size: true }, { uid: true });
      if (msg && msg.source && (msg.size || 0) < 25 * 1024 * 1024) { const m = toMsg(await simpleParser(msg.source)); body = m.text; to = m.to.map((x) => x.address).join(", "); cc = m.cc.map((x) => x.address).join(", "); }
    } catch { /* read what we have: sender and subject */ }
    const res = await organizeEmail(st.settings, { owner, ownerName: acct.name || "", from: `${r.from_name} <${r.from_email}>`, to, cc, subject: r.subject, date: r.received_at || "", body: body || "(no text)" }, { admin, by: "mail" });
    if (!res.ok) { await admin.from("mail_inbox").update({ sorted_at: now, bucket: "fyi", summary: "" }).eq("id", r.id); continue; }
    const o = res.data, ymd = /^\d{4}-\d{2}-\d{2}$/;
    await admin.from("mail_inbox").update({ bucket: o.bucket, summary: (o.summary || "").slice(0, 300), sorted_at: now }).eq("id", r.id);
    const todos = (o.bucket === "ignore" ? [] : o.todos || []).filter((t) => t.title?.trim()).slice(0, 3);
    if (todos.length) await admin.from("tasks").insert(todos.map((t) => ({
      owner, title: t.title.trim().slice(0, 200), notes: (t.notes || "").slice(0, 1000), area: ["personal", "money", "shop"].includes(t.area) ? t.area : "shop",
      due: t.due && ymd.test(t.due) ? t.due : null, source: "email", mail_inbox_id: r.id, message_id: r.message_id, created_by: "ai",
    })));
    const evs = (o.bucket === "ignore" ? [] : o.events || []).filter((e) => e.title?.trim() && ymd.test(e.date || "")).slice(0, 3);
    if (evs.length) await admin.from("events").insert(evs.map((e) => {
      const hm = /^\d{1,2}:\d{2}$/;
      const at = (t: string | null) => (t && hm.test(t) ? chicago(e.date, t) : null);
      return { owner, title: e.title.trim().slice(0, 200), notes: (e.notes || "").slice(0, 1000), place: (e.place || "").slice(0, 200), day: e.date, all_day: !at(e.start), starts_at: at(e.start), ends_at: at(e.end), status: "suggested", source: "email", mail_inbox_id: r.id, message_id: r.message_id, created_by: "ai" };
    }));
    n++;
  }
  return n;
}

/** a Central-time date and HH:MM as an ISO timestamp (daylight saving handled by asking Intl for the offset) */
export function chicago(day: string, hm: string) {
  const [h, m] = hm.split(":").map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const off = Number((tz.match(/GMT([+-]\d+)/) || [, "-5"])[1]);
  return new Date(+guess - off * 3600e3).toISOString();
}

async function archiveActs(admin: SupabaseClient, ids: string[], at: string) {
  if (!ids.length) return;
  const { data } = await admin.from("activities").select("id, meta").in("id", ids);
  for (const a of (data || []) as { id: string; meta: Record<string, unknown> | null }[]) {
    if (a.meta?.outlook_archived) continue;
    await admin.from("activities").update({ meta: { ...(a.meta || {}), outlook_archived: at } }).eq("id", a.id);
  }
}

/**
 * Where an email can be moved from the portal: Archive (Outlook's Archive button) or a SaneBox folder. SaneBox
 * learns from moves, the same as dragging in Outlook: Black Hole blocks the sender, Later / News / Receipts / CC
 * send that sender's mail there from now on.
 */
export const MOVES = {
  archive: { label: "Archive", sane: "" },
  later: { label: "Later", sane: "@SaneLater" },
  news: { label: "News", sane: "@SaneNews" },
  receipts: { label: "Receipts", sane: "@SaneReceipts" },
  cc: { label: "CC", sane: "@SaneCC" },
  blackhole: { label: "Black Hole", sane: "@SaneBlackHole" },
} as const;
export type MoveTo = keyof typeof MOVES;

async function folderFor(client: ImapFlow, to: MoveTo) {
  const list = await client.list();
  if (to === "archive") return (list.find((f) => f.specialUse === "\\Archive") || list.find((f) => /^archive$/i.test(f.path)) || list.find((f) => /^archive$/i.test(f.name)))?.path || null;
  const want = MOVES[to].sane.toLowerCase();
  return list.find((f) => f.name.toLowerCase() === want)?.path || null;
}

export async function archiveInbox(admin: SupabaseClient, acct: MailAccount, rowId: string, by: string, to: MoveTo = "archive") {
  const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id, activity_id, gone_at").eq("id", rowId).maybeSingle();
  if (!r || r.account_id !== acct.id) throw new Error("That email isn't in your Inbox.");
  const now = new Date().toISOString();
  if (!r.gone_at) {
    const client = imapClient(cfgOf(acct));
    await client.connect();
    try {
      const dest = await folderFor(client, to);
      if (!dest) throw new Error(to === "archive" ? "Couldn't find your Archive folder in Outlook." : `Couldn't find the ${MOVES[to].sane} folder (SaneBox) in your mailbox.`);
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
        // Archive and Black Hole: marked read on the way (Oct 15, Nick)
        if (uid && (to === "archive" || to === "blackhole")) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => null);
        if (uid) await client.messageMove(String(uid), dest, { uid: true });
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => null); }
  }
  await admin.from("mail_inbox").update({ gone_at: r.gone_at || now, done_by: `${by} → ${MOVES[to].label}`.slice(0, 80) }).eq("id", r.id);
  await admin.from("tasks").update({ status: "done", done_at: now, done_by: ARCHIVED }).eq("mail_inbox_id", r.id).eq("status", "open");
  if (r.activity_id) await archiveActs(admin, [r.activity_id], now);
}

/**
 * Emails in the Inbox from someone who wasn't a customer when they came in, and is now (Oct 14: Cheri Ong's Mewjira
 * reprint showed "New sender" because she was added as a Furry Feline contact afterwards): linked to that customer
 * when the Inbox list loads, by the same matching as new mail (email, contact, Printavo, company domain). At most every
 * minute a mailbox; only emails still in the Inbox.
 */
const relinked = new Map<string, number>();
export async function relinkInboxLeads(admin: SupabaseClient, acct: Pick<MailAccount, "id">) {
  if (Date.now() - (relinked.get(acct.id) || 0) < 60000) return 0;
  relinked.set(acct.id, Date.now());
  const { data: rows } = await admin.from("mail_inbox").select("activity_id").eq("account_id", acct.id).is("gone_at", null).not("activity_id", "is", null).limit(300);
  const ids = [...new Set(((rows || []) as { activity_id: string }[]).map((r) => r.activity_id))];
  if (!ids.length) return 0;
  const { data: acts } = await admin.from("activities").select("id, from_email, meta").in("id", ids).is("customer_id", null).eq("direction", "in").limit(100);
  if (!acts?.length) return 0;
  const { matchAddress } = await import("./process");
  let n = 0;
  for (const a of acts as { id: string; from_email: string; meta: Record<string, unknown> | null }[]) {
    const m = await matchAddress(admin, a.from_email).catch(() => null);
    if (!m?.customerId || m.ignore) continue;
    const { error } = await admin.from("activities").update({ customer_id: m.customerId, meta: { ...(a.meta || {}), lead: false, linked_by: m.how || "match" } }).eq("id", a.id).is("customer_id", null);
    if (!error) n++;
  }
  return n;
}
