import "server-only";
import { textOf } from "./signature";

/**
 * A reply as Outlook writes one: what you typed, your signature, then the email you're answering under a
 * From/Sent/To/Subject header. Pictures inside it (your logo, theirs) go as attached pictures (cid:), the way
 * Outlook sends them, so they show in every mail program.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const linkify = (s: string) => s.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>');
const FALLBACK_CSS = `p.MsoNormal,li.MsoNormal,div.MsoNormal{margin:0in;font-size:11.0pt;font-family:"Calibri",sans-serif;}a:link{color:#0563C1;text-decoration:underline;}`;

/** the inside of an email's <body> (no head, scripts or styles) */
export function bodyOf(html: string) {
  const b = html.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i);
  return (b ? b[1] : html).replace(/<(script|style|title)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<\/?(html|head|body)\b[^>]*>/gi, "");
}

export function replyHtml(o: {
  body: string; signature?: string | null; css?: string | null;
  quote?: { from: string; sent: string; to: string; cc?: string; subject: string; html?: string; text: string };
}) {
  const typed = o.body.trim().split(/\r?\n/).map((l) => `<p class="MsoNormal">${l.trim() ? linkify(esc(l)) : "&nbsp;"}</p>`).join("\n");
  const sig = o.signature ? `<p class="MsoNormal">&nbsp;</p>\n${o.signature}` : "";
  let quoted = "";
  if (o.quote) {
    const q = o.quote;
    const head = `<b>From:</b> ${esc(q.from)}<br>\n<b>Sent:</b> ${esc(q.sent)}<br>\n<b>To:</b> ${esc(q.to)}<br>\n${q.cc ? `<b>Cc:</b> ${esc(q.cc)}<br>\n` : ""}<b>Subject:</b> ${esc(q.subject)}`;
    const original = q.html ? bodyOf(q.html) : `<div style="white-space:pre-wrap;font-family:Calibri,sans-serif;font-size:11pt">${linkify(esc(q.text))}</div>`;
    quoted = `<p class="MsoNormal">&nbsp;</p>\n<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in"><p class="MsoNormal">${head}</p></div>\n<p class="MsoNormal">&nbsp;</p>\n${original}`;
  }
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>${FALLBACK_CSS}\n${o.css || ""}</style></head><body lang="EN-US" link="#0563C1" vlink="#954F72" style="word-wrap:break-word"><div class="WordSection1">\n${typed}\n${sig}\n${quoted}\n</div></body></html>`;
}

/** the plain-text copy of a reply (for mail programs that don't show HTML) */
export function replyText(o: { body: string; signature?: string | null; quote?: { from: string; sent: string; to: string; subject: string; text: string } }) {
  const sig = o.signature ? `\n\n${textOf(o.signature)}` : "";
  const q = o.quote ? `\n\nFrom: ${o.quote.from}\nSent: ${o.quote.sent}\nTo: ${o.quote.to}\nSubject: ${o.quote.subject}\n\n${o.quote.text.split("\n").slice(0, 80).join("\n")}` : "";
  return `${o.body.trim()}${sig}${q}`;
}

/** data: pictures → attached pictures referenced by cid: (one attachment per distinct picture) */
export function inlineImages(html: string) {
  const seen = new Map<string, string>();
  const attachments: { filename: string; content: Buffer; contentType: string; cid: string; contentDisposition: "inline" }[] = [];
  const out = html.replace(/(\bsrc\s*=\s*)(["'])data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)\2/gi, (_m, pre: string, qt: string, type: string, b64: string) => {
    const data = b64.replace(/\s+/g, "");
    let cid = seen.get(data);
    if (!cid) {
      const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*$/, "");
      cid = `image${String(attachments.length + 1).padStart(3, "0")}.${ext}@${crypto.randomUUID().slice(0, 8)}.fbsprint.com`;
      seen.set(data, cid);
      attachments.push({ filename: cid.split("@")[0], content: Buffer.from(data, "base64"), contentType: type, cid, contentDisposition: "inline" });
    }
    return `${pre}${qt}cid:${cid}${qt}`;
  });
  return { html: out, attachments };
}
