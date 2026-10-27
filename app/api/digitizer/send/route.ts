import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cfgOf, type MailAccount } from "@/lib/mail/config";
import { sendFromMailbox } from "@/lib/mail/send";
import { inlineImages, replyHtml, replyText } from "@/lib/mail/compose";
import { DIGITIZE_FROM, DIGITIZER } from "@/lib/digitizer";
import { orderGroups, type Design, type Order } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send a digitizing request (the Digitizer, components/tools/DigitizerTool.tsx): from Amanda's mailbox to Volikes,
 * with the digitizing sheet PDF (made in the browser) and the logo's original file. Only when staff press Send.
 * The logo is marked requested (designs.specs.embroidery.request, with the email's Message-ID so their reply is matched).
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { orderId?: string; imprintId?: string; to?: string; subject?: string; body?: string; pdf?: string; pdfName?: string };
  const to = String(b.to || DIGITIZER.email).trim();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i.test(to)) return NextResponse.json({ error: "Put in the digitizer's email." }, { status: 400 });
  const body = String(b.body || "").trim(), subject = String(b.subject || "").trim().slice(0, 200);
  if (!body || !subject) return NextResponse.json({ error: "Write the subject and the email first." }, { status: 400 });
  const pdf = String(b.pdf || "").replace(/^data:application\/pdf;base64,/, "");
  if (!pdf || pdf.length > 20_000_000) return NextResponse.json({ error: "The digitizing sheet didn't come through. Try again." }, { status: 400 });

  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("*").eq("id", String(b.orderId || "")).maybeSingle();
  if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const groups = orderGroups(o as Order);
  const g = groups.find((x) => x.imprints.some((im) => im.id === b.imprintId));
  const im = g?.imprints.find((x) => x.id === b.imprintId);
  if (!g || !im) return NextResponse.json({ error: "That print isn't on the order anymore." }, { status: 404 });
  const { data: d } = im.design_id ? await admin.from("designs").select("*").eq("id", im.design_id).maybeSingle() : { data: null };
  const design = d as Design | null;

  const { data: acct } = await admin.from("mail_accounts").select("*").eq("email", DIGITIZE_FROM).maybeSingle();
  const from = acct as MailAccount | null;
  if (!from?.enabled) return NextResponse.json({ error: `${DIGITIZE_FROM}'s mailbox isn't connected in the Inbox, so the request can't go out from it.` }, { status: 400 });

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [{ filename: (b.pdfName || "digitizing.pdf").replace(/[^\w.\- ]+/g, "_"), content: Buffer.from(pdf, "base64"), contentType: "application/pdf" }];
  // the original art file (the vector or the picture they sent), else our picture of it
  // (the file before anyone edited it, when it was edited here)
  const first = design?.specs?.original?.path ? { path: design.specs.original.path, name: design.specs.original.name } : design?.file_path ? { path: design.file_path, name: design.file_name } : design?.preview_path ? { path: design.preview_path, name: "" } : null;
  if (first) {
    const { data: blob } = await admin.storage.from("proofs").download(first.path);
    if (blob && blob.size < 20 * 1024 * 1024) attachments.push({ filename: (first.name || first.path.split("/").pop() || "logo.png").replace(/[^\w.\- ]+/g, "_"), content: Buffer.from(await blob.arrayBuffer()), contentType: blob.type || "application/octet-stream" });
  }

  const signature = from.signature_on !== false ? from.signature_html || "" : "";
  const { html, attachments: inline } = inlineImages(replyHtml({ body, signature, css: signature ? from.signature_css : "" }));
  let messageId = "";
  try { ({ messageId } = await sendFromMailbox(cfgOf(from), { to, subject, text: replyText({ body, signature }), html, attachments: [...inline, ...attachments] })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "The email didn't go out." }, { status: 502 }); }

  const now = new Date().toISOString();
  const { data: act } = await admin.from("activities").insert({
    customer_id: null, order_id: o.id, kind: "email", direction: "out", subject, body, from_email: from.email, to_email: to, external_id: messageId,
    occurred_at: now, created_by: v.user.email || "staff", ai_processed_at: now,
    meta: { mailbox: "sent", via: "portal", account_id: from.id, account: from.email, digitize: { order_id: o.id, imprint_id: im.id, design_id: design?.id || null }, attachments: attachments.map((a) => ({ name: a.filename, type: a.contentType, size: a.content.length })) },
  }).select("id").single();
  if (design) {
    const sp = (design.specs || {}) as Record<string, unknown>, emb = (sp.embroidery || {}) as Record<string, unknown>;
    await admin.from("designs").update({ specs: { ...sp, embroidery: { ...emb, request: { at: now, by: v.user.email || "", size: im.size || "", to, messageId, order_id: o.id, imprint_id: im.id, activity: act?.id || null, via: "email" }, reply: null } } }).eq("id", design.id);
  }
  return NextResponse.json({ ok: true, messageId, sentAt: now });
}
