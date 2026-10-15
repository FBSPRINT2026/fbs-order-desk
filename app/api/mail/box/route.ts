import { after, NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cfgOf } from "@/lib/mail/config";
import { mailboxToRead, VIEWING_NO } from "@/lib/mail/viewing";
import { customerAddrs, getAttachment, getMessage, groupConvos, listFolders, listMessages, listOlder, markSeen, moveMessage, searchConversations, withBox } from "@/lib/mail/folders";
import { keepBody, cachedList, cachedMessage, cachedSearch, folderCached } from "@/lib/mail/cache";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";
import { sendFromMailbox } from "@/lib/mail/send";
import { ewsAttachment, ewsMessage } from "@/lib/mail/ews";
import { ewsFolders, ewsList, ewsMarkRead, ewsMove, ewsOpen, ewsReady, ewsSaveSent, ewsSearch, isEwsUid } from "@/lib/mail/ewsBox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Email, live from your own mailbox (staff only; only ever your own mailbox):
 *   GET ?do=folders                       the folder list with counts
 *   GET ?do=list&path=…[&before=n]        a folder's newest 50
 *   GET ?do=message&path=…&uid=n          one email (marks it read)
 *   GET ?do=attachment&path=…&uid=n&i=k   download an attachment
 *   GET ?do=search&q=…                    conversations found (received and sent, in order)
 *   POST { do: "move", path, uid, to }    to "archive", a SaneBox key (later, news, receipts, cc, blackhole), "trash" or a folder path
 *   POST { do: "reply", path, uid, body, all? }
 */
async function mine() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { err: NextResponse.json({ error: "Staff only." }, { status: 403 }) };
  const admin = createAdminClient();
  // View as a person: their mailbox, read only (POST refuses)
  const { acct, viewing } = await mailboxToRead(admin, v);
  if (!acct || !acct.enabled) return { err: NextResponse.json({ error: viewing ? `${viewing} hasn't connected their email yet.` : "Connect your email first (Email → Email settings)." }, { status: 400 }) };
  return { v, admin, acct, viewing };
}
const bad = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(req: Request) {
  const m = await mine(); if ("err" in m) return m.err;
  const { admin, acct } = m;
  const u = new URL(req.url), q = u.searchParams, what = q.get("do"), path = q.get("path") || "INBOX", uid = Number(q.get("uid") || 0);
  const me = acct.email.toLowerCase();
  const pic = (id: string) => `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id })}`;
  try {
    // a mailbox EWS works on (Oct 14): the folder list, a folder, search and opening an email all go through EWS — no
    // IMAP connection limit. If EWS has a problem, the IMAP way below still answers.
    const ews = await ewsReady(admin, acct);
    if (ews) {
      try {
        if (what === "folders") return NextResponse.json({ folders: await ewsFolders(acct), ews: true });
        if (what === "list") { const r = await ewsList(admin, acct, me, path, q.get("older") || undefined); return NextResponse.json({ rows: r.rows, more: r.more, live: true, ews: true }); }
        if (what === "search") {
          // the server's own index: every year at once, so "older" has nothing more to add
          if (q.get("older") === "1") return NextResponse.json({ convos: [], folders: 0, partial: false, scope: "older", all: true });
          const t0 = Date.now();
          // a person or customer picked from the suggestions (Oct 15, Nick: "if I search Cheri, ask: all emails from Cheri
          // Ong?"): their addresses, and only the conversations they're in (not every email that mentions the name)
          // an address (cheri@furry-feline.com) or a whole company's domain (@peticolasbrewing.com)
          const who = (q.get("who") || "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^([^\s@"]+)?@[^\s@"]+\.[a-z]{2,}$/.test(e)).slice(0, 12);
          const r = await ewsSearch(admin, acct, me, who.length ? who.map((e) => `"${e.replace(/^@/, "")}"`).join(" OR ") : q.get("q") || "");
          if (who.length) {
            const theirs = (m: { from: string; to?: string[]; cc?: string[] }) => [m.from, ...(m.to || []), ...(m.cc || [])].some((x) => { const a = String(x || "").toLowerCase(); return who.some((w) => (w.startsWith("@") ? a.endsWith(w) : a === w)); });
            r.convos = r.convos.filter((c) => c.msgs.some(theirs));
          }
          console.info(`mail search ews "${(q.get("q") || "").slice(0, 40)}"${who.length ? ` (${who.length} addresses)` : ""}: ${r.convos.length} conversations, ${r.folders} folders, ${Date.now() - t0}ms`);
          return NextResponse.json({ ...r, scope: "all", all: true });
        }
        if (what === "message" && (isEwsUid(uid) || q.get("live") === "1")) {
          const t0 = Date.now();
          const e = await ewsOpen(admin, acct, path, uid, pic);
          console.info(`mail open ${path}:${uid} ews ${Date.now() - t0}ms`);
          if (!e) return NextResponse.json({ error: "That email isn't there any more (moved or deleted?)." }, { status: 404 });
          const { ews: _x, read, itemId, ...msg } = e;
          if (!read && !m.viewing) after(async () => { try { await ewsMarkRead(acct, itemId); } catch { /* fine */ } });
          if (!isEwsUid(uid)) after(async () => { try { await keepBody(admin, acct.id, path, uid, msg); } catch { /* fine */ } });
          return NextResponse.json(msg);
        }
      } catch (e) {
        console.warn(`mail ${what} ews failed: ${e instanceof Error ? e.message : e}`);
        if (isEwsUid(uid)) throw e;
      }
    }
    // the folder list alone is quick; counts (how many, unread) come in a second call in the background
    if (what === "folders") return NextResponse.json({ folders: await withBox(acct, (c) => listFolders(c, q.get("counts") === "1")) });
    // a folder: from the 45-day cache when it's complete (instant), paging back past it live; else live
    if (what === "list") {
      const older = q.get("older");
      if (older) { const r = await withBox(acct, (c) => listOlder(c, me, path, older)); return NextResponse.json({ rows: r.rows, more: r.more, live: true }); }
      if (await folderCached(admin, acct.id, path)) {
        const rows = await cachedList(admin, acct.id, me, path, q.get("beforeDate") || undefined);
        return NextResponse.json({ rows, cached: true, more: true });
      }
      return NextResponse.json(await withBox(acct, (c) => listMessages(c, me, path, Number(q.get("before") || 0) || undefined)));
    }
    if (what === "message") {
      const t0 = Date.now();
      const hit = q.get("live") === "1" ? null : await cachedMessage(admin, acct.id, path, uid);
      console.info(`mail open ${path}:${uid} ${hit ? "cache" : "live"} ${Date.now() - t0}ms`);
      if (hit) {
        // mark it read in Outlook too, after answering — only when it isn't already (each one is a connection to the
        // mailbox, and the mailbox only allows a few at a time, shared with the phone and Outlook: Oct 13)
        if (!m.viewing && !hit.seen) after(async () => {
          try {
            if (ews) { const { itemIdFor } = await import("@/lib/mail/ewsBox"); const id = await itemIdFor(admin, acct, path, uid); if (id) await ewsMarkRead(acct, id); }
            else await withBox(acct, (c) => markSeen(c, path, uid), Date.now() + 20000);
            await admin.from("mail_cache").update({ seen: true }).eq("account_id", acct.id).eq("folder", path).eq("uid", uid);
          } catch { /* fine */ }
        });
        return NextResponse.json({ ...hit, cached: true });
      }
      // over EWS first (Oct 13): HTTPS like Outlook, no IMAP connection limit, and it hands over the big emails IMAP
      // drops; pictures and attachments come through EWS too. Kept so it opens instantly next time.
      if (ews) {
        let failed = false;
        const e = await ewsOpen(admin, acct, path, uid, pic).catch(() => { failed = true; return null; });
        if (e) {
          const { ews: _x, read, itemId, ...msg } = e;
          if (!read && !m.viewing) after(async () => { try { await ewsMarkRead(acct, itemId); } catch { /* fine */ } });
          after(async () => { try { await keepBody(admin, acct.id, path, uid, msg); } catch { /* fine */ } });
          console.info(`mail open ${path}:${uid} ews ${Date.now() - t0}ms`);
          return NextResponse.json(msg);
        }
        // EWS answered and it isn't in the Inbox: SaneBox / Outlook moved it out. Say so now (not after 50 s of IMAP)
        // and take it off the Inbox list (Oct 14, Nick: the Pizza Hut email)
        if (!failed && /^inbox$/i.test(path)) {
          const { pruneInboxEws } = await import("@/lib/mail/mirror");
          await pruneInboxEws(admin, acct, true).catch(() => 0);
          return NextResponse.json({ error: "It's not in your Inbox any more (archived or moved in Outlook?).", gone: true }, { status: 404 });
        }
      }
      const { data: kept } = await admin.from("mail_cache").select("message_id").eq("account_id", acct.id).eq("folder", path).eq("uid", uid).limit(1).maybeSingle();
      const mid = (kept?.message_id as string) || q.get("mid") || "";
      // (over EWS only when it works for this mailbox: handled above; a refused EWS sign-in is a failed sign-in on the mailbox)
      if (mid && ews) {
        const e = await ewsMessage(acct, path, uid, mid, (id) => `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id })}`).catch((x) => { console.warn(`mail open ${path}:${uid} ews failed: ${x instanceof Error ? x.message : x}`); return null; });
        if (e) {
          console.info(`mail open ${path}:${uid} ews ${Date.now() - t0}ms`);
          const { ews: _e, ...msg } = e;
          after(async () => { try { await keepBody(admin, acct.id, path, uid, msg); } catch { /* fine */ } });
          return NextResponse.json(msg);
        }
      }
      // read it from the mailbox (the page offers Try again), and keep it so it opens instantly next time
      // the server builds a big email the first time it's asked for: up to 50 s (the page waits 55)
      const r = await withBox(acct, (c) => getMessage(c, path, uid), Date.now() + 50000, 50000).catch((e) => {
        console.warn(`mail open ${path}:${uid} live failed ${Date.now() - t0}ms: ${String(e?.message || e)}`);
        throw new Error(/Connection not available|Socket timeout|closed|ETIMEDOUT|ECONNRESET|Too many/i.test(String(e?.message || e)) ? "The mail server didn't hand this email over. It may be busy (it allows only a few connections at a time, shared with your phone and Outlook): try again in a moment. If it keeps happening with this email, open it in Outlook." : String(e?.message || e));
      });
      console.info(`mail open ${path}:${uid} live done ${Date.now() - t0}ms`);
      if (r) after(async () => { try { await keepBody(admin, acct.id, path, uid, r); } catch { /* fine */ } });
      return r ? NextResponse.json(r) : NextResponse.json({ error: "That email isn't there any more." }, { status: 404 });
    }
    // a picture inside an email, or an attachment, over EWS (by its EWS id; your own mailbox only)
    if (what === "ewsatt") {
      const a = await ewsAttachment(acct, q.get("id") || "");
      if (!a) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return new Response(new Uint8Array(a.content), { headers: { "Content-Type": a.type, "Content-Disposition": `${/^(image\/|application\/pdf)/.test(a.type) ? "inline" : "attachment"}; filename="${a.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, max-age=86400" } });
    }
    if (what === "attachment") {
      const a = await withBox(acct, (c) => getAttachment(c, path, uid, Number(q.get("i") || 0)));
      if (!a) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return new Response(new Uint8Array(a.content), { headers: { "Content-Type": a.type, "Content-Disposition": `${/^(image\/|application\/pdf)/.test(a.type) ? "inline" : "attachment"}; filename="${a.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, no-store" } });
    }
    // search: the last 45 days from the cache (instant); older mail on request, live
    if (what === "search") {
      // a person picked from the suggestions: their (first) address
      const term = (q.get("who") || "").split(",")[0]?.trim() || q.get("q") || "";
      const addrs = [...(await customerAddrs(admin, term.trim()))];
      const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|att|sbcglobal)\./i;
      const extra = [...new Set([...addrs.filter((a) => FREE.test(a)), ...addrs.filter((a) => !FREE.test(a)).map((a) => "@" + a.split("@")[1])])];
      // older mail: from the kept headers (instant; Oct 13); while those are still being filled in, the mailbox too
      if (q.get("older") === "1") {
        const { indexSearch } = await import("@/lib/mail/mailIndex");
        const ix = await indexSearch(admin, acct.id, me, term, extra);
        const cutoff = new Date(Date.now() - 45 * 864e5).toISOString();
        let rows = ix.rows.filter((r) => r.date < cutoff), partial = false;
        if (!ix.done) {
          const live = await searchConversations(admin, acct, me, term, Date.now() + 35000, true).catch(() => null);
          if (live) { rows = [...rows, ...live.convos.flatMap((c) => c.msgs)]; partial = live.partial; } else partial = true;
        }
        console.info(`mail search older "${term.slice(0, 40)}": ${rows.length} (index ${ix.indexed}/${ix.total})`);
        return NextResponse.json({ convos: groupConvos(rows, me), folders: 0, partial, scope: "older", indexing: ix.done ? null : { indexed: ix.indexed, total: ix.total } });
      }
      const rows = await cachedSearch(admin, acct.id, me, term, extra);
      return NextResponse.json({ convos: groupConvos(rows, me), folders: 0, partial: false, scope: "45d" });
    }
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) { return bad(e); }
}

export async function POST(req: Request) {
  const m = await mine(); if ("err" in m) return m.err;
  const { admin, acct, v } = m;
  if (m.viewing) return NextResponse.json({ error: VIEWING_NO }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { do?: string; path?: string; uid?: number; to?: string; body?: string; all?: boolean; cc?: string[] };
  const path = String(b.path || "INBOX"), uid = Number(b.uid || 0);
  if (!uid) return NextResponse.json({ error: "Which email?" }, { status: 400 });
  try {
    const ews = await ewsReady(admin, acct);
    if (b.do === "move") {
      // never Black Hole a customer without asking (Oct 14, Nick): the page asks first; a swipe or anything else that
      // didn't is refused with who they are
      if (String(b.to || "") === "blackhole" && !(b as { confirmed?: boolean }).confirmed) {
        const who = await customerSender(admin, acct.id, path, uid);
        if (who) return NextResponse.json({ error: `${who} is a customer. Open the email and press Black Hole there to confirm.` }, { status: 409 });
      }
      // over EWS when it works for this mailbox (no IMAP connection needed); an EWS-listed email only that way
      if (ews || isEwsUid(uid)) {
        try { const r = await ewsMove(admin, acct, path, uid, String(b.to || "archive"), v.email || "portal"); return NextResponse.json({ ok: true, dest: r.dest }); }
        catch (e) { if (isEwsUid(uid)) throw e; console.warn(`mail move ews failed: ${e instanceof Error ? e.message : e}`); }
      }
      const r = await withBox(acct, (c) => moveMessage(admin, acct, c, path, uid, String(b.to || "archive"), v.email || "portal"));
      return NextResponse.json({ ok: true, dest: r.dest });
    }
    if (b.do === "reply") {
      if (!String(b.body || "").trim()) return NextResponse.json({ error: "Write the reply first." }, { status: 400 });
      const viaEws = ews || isEwsUid(uid) ? await ewsOpen(admin, acct, path, uid, (id) => `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id })}`).catch((e) => { if (isEwsUid(uid)) throw e; return null; }) : null;
      const msg = viaEws ? (({ ews: _x, read: _r, itemId: _i, ...rest }) => rest)(viaEws) : await withBox(acct, (c) => getMessage(c, path, uid));
      if (!msg) return NextResponse.json({ error: "That email isn't there any more." }, { status: 404 });
      const me = acct.email.toLowerCase();
      // replying to something I sent goes to the people I sent it to
      const fromMe = msg.fromAddress === me || (!msg.fromAddress.includes("@") && /sent/i.test(path));
      const split = (s: string) => (s.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []).map((x) => x.toLowerCase());
      const toList = fromMe ? split(msg.to) : [msg.fromAddress];
      // reply all: everyone on it; plus anyone added in Cc (Oct 12)
      const added = (Array.isArray(b.cc) ? b.cc : []).map((x: unknown) => String(x || "").trim().toLowerCase()).filter((x: string) => /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(x));
      const ccList = [...new Set([...(b.all ? [...split(msg.to), ...split(msg.cc)] : []), ...added])].filter((x) => x !== me && !toList.includes(x)).slice(0, 20);
      const subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`;
      const sent = msg.date ? new Date(msg.date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ") : "";
      const quote = { from: msg.from, sent, to: msg.to, cc: msg.cc, subject: msg.subject, html: msg.html.length < 1_500_000 ? msg.html : "", text: msg.text };
      const signature = acct.signature_on !== false ? acct.signature_html || "" : "";
      const page = replyHtml({ body: String(b.body), signature, css: signature ? acct.signature_css : "", quote });
      const { html, attachments } = inlineImages(page);
      const text = replyText({ body: String(b.body), signature, quote });
      await sendFromMailbox(cfgOf(acct), { to: toList.join(", "), cc: ccList.join(", ") || undefined, subject, text, html, attachments, inReplyTo: msg.messageId || undefined, references: [...msg.references, msg.messageId].filter(Boolean).slice(-20) },
        // the Sent Items copy over EWS when it works (no IMAP connection)
        ews ? (raw) => ewsSaveSent(acct, raw) : undefined);
      return NextResponse.json({ ok: true, to: toList.join(", ") });
    }
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) { return bad(e); }
}

/** the customer this email is from (their name), if it's from one: looked up by the sender on file for it */
async function customerSender(admin: ReturnType<typeof createAdminClient>, accountId: string, path: string, uid: number): Promise<string> {
  const [{ data: ib }, { data: mc }] = await Promise.all([
    /^inbox$/i.test(path) ? admin.from("mail_inbox").select("from_email").eq("account_id", accountId).eq("uid", uid).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("mail_cache").select("from_email").eq("account_id", accountId).eq("folder", path).eq("uid", uid).limit(1).maybeSingle(),
  ]);
  const from = String((ib as { from_email?: string } | null)?.from_email || (mc as { from_email?: string } | null)?.from_email || "");
  if (!from) return "";
  const { matchAddress } = await import("@/lib/mail/process");
  const m = await matchAddress(admin, from).catch(() => null);
  if (!m?.customerId || m.ignore) return "";
  const { data: c } = await admin.from("customers").select("company, name").eq("id", m.customerId).maybeSingle();
  return String(c?.company || c?.name || "This sender");
}
