import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountForUser, cfgOf } from "@/lib/mail/config";
import { getAttachment, getMessage, listFolders, listMessages, moveMessage, searchConversations, withBox } from "@/lib/mail/folders";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";
import { sendFromMailbox } from "@/lib/mail/send";

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
  const acct = await accountForUser(admin, v.user.id);
  if (!acct || !acct.enabled) return { err: NextResponse.json({ error: "Connect your email first (Email → Email settings)." }, { status: 400 }) };
  return { v, admin, acct };
}
const bad = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(req: Request) {
  const m = await mine(); if ("err" in m) return m.err;
  const { admin, acct } = m;
  const u = new URL(req.url), q = u.searchParams, what = q.get("do"), path = q.get("path") || "INBOX", uid = Number(q.get("uid") || 0);
  const me = acct.email.toLowerCase();
  try {
    if (what === "folders") return NextResponse.json({ folders: await withBox(acct, (c) => listFolders(c)) });
    if (what === "list") return NextResponse.json(await withBox(acct, (c) => listMessages(c, me, path, Number(q.get("before") || 0) || undefined)));
    if (what === "message") { const r = await withBox(acct, (c) => getMessage(c, path, uid)); return r ? NextResponse.json(r) : NextResponse.json({ error: "That email isn't there any more." }, { status: 404 }); }
    if (what === "attachment") {
      const a = await withBox(acct, (c) => getAttachment(c, path, uid, Number(q.get("i") || 0)));
      if (!a) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return new Response(new Uint8Array(a.content), { headers: { "Content-Type": a.type, "Content-Disposition": `${/^(image\/|application\/pdf)/.test(a.type) ? "inline" : "attachment"}; filename="${a.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, no-store" } });
    }
    if (what === "search") return NextResponse.json(await withBox(acct, (c) => searchConversations(admin, c, me, q.get("q") || "", Date.now() + 40000)));
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) { return bad(e); }
}

export async function POST(req: Request) {
  const m = await mine(); if ("err" in m) return m.err;
  const { admin, acct, v } = m;
  const b = await req.json().catch(() => ({})) as { do?: string; path?: string; uid?: number; to?: string; body?: string; all?: boolean };
  const path = String(b.path || "INBOX"), uid = Number(b.uid || 0);
  if (!uid) return NextResponse.json({ error: "Which email?" }, { status: 400 });
  try {
    if (b.do === "move") {
      const r = await withBox(acct, (c) => moveMessage(admin, acct, c, path, uid, String(b.to || "archive"), v.email || "portal"));
      return NextResponse.json({ ok: true, dest: r.dest });
    }
    if (b.do === "reply") {
      if (!String(b.body || "").trim()) return NextResponse.json({ error: "Write the reply first." }, { status: 400 });
      const msg = await withBox(acct, (c) => getMessage(c, path, uid));
      if (!msg) return NextResponse.json({ error: "That email isn't there any more." }, { status: 404 });
      const me = acct.email.toLowerCase();
      // replying to something I sent goes to the people I sent it to
      const fromMe = msg.fromAddress === me;
      const split = (s: string) => (s.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []).map((x) => x.toLowerCase());
      const toList = fromMe ? split(msg.to) : [msg.fromAddress];
      const ccList = b.all ? [...new Set([...split(msg.to), ...split(msg.cc)])].filter((x) => x !== me && !toList.includes(x)) : [];
      const subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`;
      const sent = msg.date ? new Date(msg.date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(" at ", " ") : "";
      const quote = { from: msg.from, sent, to: msg.to, cc: msg.cc, subject: msg.subject, html: msg.html.length < 1_500_000 ? msg.html : "", text: msg.text };
      const signature = acct.signature_on !== false ? acct.signature_html || "" : "";
      const page = replyHtml({ body: String(b.body), signature, css: signature ? acct.signature_css : "", quote });
      const { html, attachments } = inlineImages(page);
      const text = replyText({ body: String(b.body), signature, quote });
      await sendFromMailbox(cfgOf(acct), { to: toList.join(", "), cc: ccList.join(", ") || undefined, subject, text, html, attachments, inReplyTo: msg.messageId || undefined, references: [...msg.references, msg.messageId].filter(Boolean).slice(-20) });
      return NextResponse.json({ ok: true, to: toList.join(", ") });
    }
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) { return bad(e); }
}
