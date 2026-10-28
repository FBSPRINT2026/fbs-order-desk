import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cfgOf, type MailAccount } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";
import { DIGITIZE_FROM, DIGITIZER } from "@/lib/digitizer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send a digitized file back for changes (Oct 28, Nick: "send back to Volikes for changes… what needs to be changed…
 * you would reply back on the previous email from Volikes… thanks for sending this. We actually need these changes.
 * Please send it back"). Staff only, when Send is pressed. From Amanda's mailbox, as a reply in their thread (In-Reply-To
 * their last email), with their file attached for reference. The logo goes back to Requested (request.changes) and
 * their next reply's files come in as its new version (lib/digitizerAuto.ts).
 * POST { designId, body, subject? }
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { designId?: string; body?: string; subject?: string; changes?: string };
  const body = String(b.body || "").trim();
  if (!body) return NextResponse.json({ error: "Say what needs to change first." }, { status: 400 });
  const admin = createAdminClient();
  const { data: d } = await admin.from("designs").select("id, number, specs").eq("id", String(b.designId || "")).maybeSingle();
  if (!d) return NextResponse.json({ error: "Logo not found." }, { status: 404 });
  const sp = (d.specs || {}) as Record<string, unknown>;
  const emb = (sp.embroidery || {}) as { files?: { path: string; name: string; at?: string }[]; request?: Record<string, unknown> | null; reply?: { activity?: string; order_id?: string; imprint_id?: string; subject?: string } | null; replies?: unknown[] };
  // their last email about this logo: the reply that brought the files (kept on the logo), else the request we sent
  const replyAct = emb.reply?.activity || (emb.request?.activity as string | undefined) || "";
  const { data: last } = replyAct ? await admin.from("activities").select("id, subject, external_id, from_email, order_id, meta").eq("id", replyAct).maybeSingle() : { data: null };
  const refs = [...((((last?.meta || {}) as { references?: string[] }).references) || []), ...(last?.external_id ? [String(last.external_id)] : [])].slice(-20);
  const orderId = emb.reply?.order_id || (emb.request?.order_id as string | undefined) || (last?.order_id as string | undefined) || null;
  const imprintId = emb.reply?.imprint_id || (emb.request?.imprint_id as string | undefined) || null;
  const to = last?.from_email && /@/.test(String(last.from_email)) && !/fbsprint\.com$/i.test(String(last.from_email)) ? String(last.from_email) : DIGITIZER.email;
  const subj0 = String(b.subject || last?.subject || `FOR DIGITIZING: D-${d.number}`).trim();
  const subject = (/^re:/i.test(subj0) ? subj0 : `Re: ${subj0}`).slice(0, 200);

  const { data: acct } = await admin.from("mail_accounts").select("*").eq("email", DIGITIZE_FROM).maybeSingle();
  const from = acct as MailAccount | null;
  if (!from?.enabled) return NextResponse.json({ error: `${DIGITIZE_FROM}'s mailbox isn't connected in the Inbox, so this can't go out from it.` }, { status: 400 });

  // their file, for reference (the one being changed)
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  const cur = (emb.files || []).slice(-1)[0];
  if (cur?.path) { const { data: blob } = await admin.storage.from("proofs").download(cur.path); if (blob && blob.size < 15 * 1024 * 1024) attachments.push({ filename: cur.name.replace(/[^\w.\- #()]+/g, "_"), content: Buffer.from(await blob.arrayBuffer()), contentType: "application/octet-stream" }); }

  const signature = from.signature_on !== false ? from.signature_html || "" : "";
  const { html, attachments: inline } = inlineImages(replyHtml({ body, signature, css: signature ? from.signature_css : "" }));
  let messageId = "";
  try { ({ messageId } = await sendFromMailbox(cfgOf(from), { to, subject, text: replyText({ body, signature }), html, attachments: [...inline, ...attachments], ...(last?.external_id ? { inReplyTo: String(last.external_id) } : {}), references: refs })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "The email didn't go out." }, { status: 502 }); }

  const now = new Date().toISOString();
  const { data: act } = await admin.from("activities").insert({
    customer_id: null, order_id: orderId, kind: "email", direction: "out", subject, body, from_email: from.email, to_email: to, external_id: messageId,
    thread_id: (refs[0] || last?.external_id || messageId || "").slice(0, 500) || null, occurred_at: now, created_by: v.user.email || "staff", ai_processed_at: now,
    meta: { mailbox: "sent", via: "portal", account_id: from.id, account: from.email, references: refs, digitize: { order_id: orderId, imprint_id: imprintId, design_id: d.id, items: [{ imprint_id: imprintId, design_id: d.id }], changes: true }, attachments: attachments.map((a) => ({ name: a.filename, type: a.contentType, size: a.content.length })) },
  }).select("id").single();
  // back to Requested, the changes asked kept; the reply that brought the first files is kept with the others
  await admin.from("designs").update({ specs: { ...sp, embroidery: { ...emb, request: { at: now, by: v.user.email || "", to, messageId, order_id: orderId, imprint_id: imprintId, activity: act?.id || null, via: "email", changes: String(b.changes || body).slice(0, 2000) }, reply: null, replies: [...(emb.replies || []), ...(emb.reply ? [emb.reply] : [])].slice(-10) } } }).eq("id", d.id);
  return NextResponse.json({ ok: true, sentAt: now });
}
