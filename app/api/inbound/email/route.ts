import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeInboundEmail, type InboundEmail } from "@/lib/crm/inbound";
import { processEmailActivity } from "@/lib/ai/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Incoming email → customer timeline (and, with AI on, the Assistant reads it).
// Point an inbound-email service here, e.g. Brevo Inbound Parsing, Cloudflare Email Workers, or a
// Gmail/Outlook forwarding rule through Zapier/Make. URL:  /api/inbound/email?key=INBOUND_EMAIL_SECRET
// Off until INBOUND_EMAIL_SECRET is set in Vercel.
//
// Accepts Brevo's inbound format ({ items: [{ From:{Address,Name}, To:[{Address}], Subject, RawTextBody | ExtractedMarkdownMessage, MessageId, InReplyTo, SentAtDate }] })
// or a simple one ({ from, from_name, to, subject, text, message_id, in_reply_to, date }).

type Addr = { Address?: string; Name?: string } | undefined;
type BrevoItem = { From?: Addr; To?: Addr[]; Subject?: string; RawTextBody?: string; ExtractedMarkdownMessage?: string; RawHtmlBody?: string; MessageId?: string; InReplyTo?: string; SentAtDate?: string };

const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function toEmails(body: unknown): InboundEmail[] {
  const b = body as { items?: BrevoItem[] } & Record<string, unknown>;
  if (Array.isArray(b?.items)) {
    return b.items.map((it) => ({
      from: it.From?.Address || "", fromName: it.From?.Name, to: (it.To || []).map((t) => t?.Address).filter(Boolean).join(", "),
      subject: it.Subject || "", text: it.ExtractedMarkdownMessage || it.RawTextBody || stripHtml(it.RawHtmlBody || ""),
      messageId: it.MessageId, inReplyTo: it.InReplyTo, date: it.SentAtDate,
    }));
  }
  const s = (k: string) => (typeof b?.[k] === "string" ? (b[k] as string) : "");
  const from = s("from").match(/<([^>]+)>/)?.[1] || s("from");
  return [{ from, fromName: s("from_name"), to: s("to"), subject: s("subject"), text: s("text") || stripHtml(s("html")), messageId: s("message_id"), inReplyTo: s("in_reply_to"), date: s("date") }];
}

export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return NextResponse.json({ error: "Inbound email is not set up" }, { status: 503 });
  const url = new URL(req.url);
  const given = url.searchParams.get("key") || req.headers.get("x-inbound-secret") || "";
  const ok = given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  const admin = createAdminClient();
  const saved: string[] = [];
  for (const e of toEmails(body).slice(0, 25)) {
    if (!e.from || (!e.text && !e.subject)) continue;
    try {
      const r = await storeInboundEmail(admin, e);
      if (r.id) saved.push(r.id);
    } catch { /* keep going with the rest */ }
  }
  // read them with AI after answering, so the email service isn't kept waiting
  if (saved.length) after(async () => { for (const id of saved) await processEmailActivity(admin, id).catch(() => null); });
  return NextResponse.json({ ok: true, saved: saved.length });
}
