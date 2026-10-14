import "server-only";
import { cfgOf, type MailAccount } from "./config";
import type { FullMsg } from "./folders";
import { ntlmPost } from "./ntlm";

/**
 * Exchange Web Services (Oct 13, Nick: "we don't ever want to go back to Outlook"): the same mailbox over HTTPS, the
 * way Outlook itself reads it. IMAP on Intermedia allows only a couple of connections at a time (shared with the
 * phone, Outlook and SaneBox) and drops some big emails outright; EWS has no such limit, so an email IMAP won't hand
 * over is opened through EWS instead, pictures and attachments included.
 */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
/** the inside of each <t:Name …>…</t:Name> (any namespace prefix) */
export const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, "g"))].map((m) => ({ attrs: m[1] || "", inner: m[2] || "" }));
export const one = (xml: string, name: string) => all(xml, name)[0]?.inner ?? "";
export const attr = (attrs: string, name: string) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || "";

export const ewsUrl = (host: string) => `https://${host}/EWS/Exchange.asmx`;

/** which sign-in works for each mailbox (Basic for most; NTLM where Basic is turned down, Oct 13) */
const useNtlm = new Map<string, boolean>();

export async function call(acct: MailAccount, body: string, timeoutMs = 25000): Promise<string> {
  const c = cfgOf(acct);
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><soap:Header><t:RequestServerVersion Version="Exchange2013_SP1"/></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
  const key = acct.email.toLowerCase();
  let status = 0, text = "", www = "";
  if (!useNtlm.get(key)) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ewsUrl(c.imapHost), { method: "POST", signal: ctrl.signal, cache: "no-store", headers: { "Content-Type": "text/xml; charset=utf-8", Authorization: `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString("base64")}` }, body: soap });
      status = res.status; text = await res.text(); www = res.headers.get("www-authenticate") || "";
    } finally { clearTimeout(t); }
  }
  // Basic turned down but NTLM offered: sign in with NTLM (and keep using it for this mailbox)
  if (useNtlm.get(key) || (status === 401 && /ntlm/i.test(www))) {
    const r = await ntlmPost(ewsUrl(c.imapHost), c.user, c.pass, "text/xml; charset=utf-8", soap, timeoutMs);
    status = r.status; text = r.body; www = ([] as string[]).concat(r.headers["www-authenticate"] || []).join(", ");
    if (status !== 401) useNtlm.set(key, true);
  }
  if (status < 200 || status >= 300) {
    const fault = one(text, "faultstring") || one(text, "MessageText");
    throw new Error(status === 401 ? `EWS sign-in refused (401; Basic and NTLM; the server offers: ${www || "?"})` : `EWS ${status}${fault ? `: ${unesc(fault).slice(0, 200)}` : ""}`);
  }
  const bad = all(text, "ResponseCode").map((x) => x.inner).find((x) => x && x !== "NoError");
  if (bad) throw new Error(`EWS ${bad}: ${unesc(one(text, "MessageText")).slice(0, 200)}`);
  return text;
}

/** can this mailbox be read over EWS? (no secrets in the answer) */
export async function ewsProbe(acct: MailAccount): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  try {
    const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="1" Offset="0" BasePoint="Beginning"/><m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`, 15000);
    return { ok: true, detail: `inbox items: ${attr(all(x, "RootFolder")[0]?.attrs || "", "TotalItemsInView") || "?"}`, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }; }
}

/** folders that might hold an IMAP folder's emails ("INBOX/Archive" → every folder called "Archive", and the Inbox) */
async function foldersFor(acct: MailAccount, imapPath: string): Promise<string[]> {
  const leaf = imapPath.split("/").pop() || imapPath;
  const ids: string[] = [];
  const dist = /^inbox$/i.test(imapPath) ? "inbox" : /^sent( items)?$/i.test(imapPath) ? "sentitems" : /^(deleted items|trash)$/i.test(imapPath) ? "deleteditems" : /^drafts$/i.test(imapPath) ? "drafts" : /^junk/i.test(imapPath) ? "junkemail" : "";
  if (dist) return [`<t:DistinguishedFolderId Id="${dist}"/>`];
  const x = await call(acct, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="folder:DisplayName"/><t:FieldURIOrConstant><t:Constant Value="${esc(leaf)}"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction><m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>`);
  for (const f of all(x, "FolderId")) { const id = attr(f.attrs, "Id"); if (id) ids.push(`<t:FolderId Id="${esc(id)}"/>`); }
  return ids.length ? ids : [`<t:DistinguishedFolderId Id="inbox"/>`];
}

/** the EWS id of an email, by its Message-ID, in the folders an IMAP folder maps to (then the Inbox and Sent) */
async function findItem(acct: MailAccount, imapPath: string, messageId: string): Promise<string> {
  const mid = `<${messageId.replace(/^<|>$/g, "")}>`;
  const tried = new Set<string>();
  for (const f of [...(await foldersFor(acct, imapPath)), `<t:DistinguishedFolderId Id="inbox"/>`, `<t:DistinguishedFolderId Id="sentitems"/>`]) {
    if (tried.has(f)) continue;
    tried.add(f);
    const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="2" Offset="0" BasePoint="Beginning"/><m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURIOrConstant><t:Constant Value="${esc(mid)}"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction><m:ParentFolderIds>${f}</m:ParentFolderIds></m:FindItem>`);
    const id = attr(all(x, "ItemId")[0]?.attrs || "", "Id");
    if (id) return id;
  }
  return "";
}

export type EwsAtt = { id: string; name: string; type: string; size: number; inline: boolean; cid: string };

/**
 * One email over EWS, shaped like the IMAP reader's. Pictures shown inside the email (cid:) point at
 * `picUrl(attachmentId)`, which serves them through EWS too; the attachments are listed with their EWS ids.
 */
export async function ewsMessage(acct: MailAccount, imapPath: string, uid: number, messageId: string, picUrl: (id: string) => string): Promise<(FullMsg & { ews: EwsAtt[] }) | null> {
  if (!messageId) return null;
  const id = await findItem(acct, imapPath, messageId);
  if (!id) return null;
  return ewsGetById(acct, id, imapPath, uid, picUrl);
}

/** the EWS id of an email by its Message-ID (in the folder it was listed in, else the Inbox and Sent) */
export const ewsFindByMessageId = findItem;

/** one email by its EWS id, shaped like the IMAP reader's (see ewsMessage) */
export async function ewsGetById(acct: MailAccount, id: string, imapPath: string, uid: number, picUrl: (id: string) => string): Promise<(FullMsg & { ews: EwsAtt[]; read: boolean }) | null> {
  const x = await call(acct, `<m:GetItem><m:ItemShape><t:BaseShape>Default</t:BaseShape><t:BodyType>HTML</t:BodyType><t:AdditionalProperties><t:FieldURI FieldURI="item:Body"/><t:FieldURI FieldURI="item:Attachments"/><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURI FieldURI="message:References"/><t:FieldURI FieldURI="message:ReplyTo"/><t:FieldURI FieldURI="message:IsRead"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(id)}"/></m:ItemIds></m:GetItem>`, 40000);
  const box = (xml: string) => all(xml, "Mailbox").map((m) => ({ name: unesc(one(m.inner, "Name")), addr: unesc(one(m.inner, "EmailAddress")).toLowerCase() }));
  const fmt = (l: { name: string; addr: string }[]) => l.map((p) => (p.name && p.name !== p.addr ? `"${p.name}" <${p.addr}>` : p.addr)).join(", ");
  const from = box(one(x, "From"))[0] || { name: "", addr: "" };
  const replyTo = box(one(x, "ReplyTo"))[0];
  const atts: EwsAtt[] = all(x, "FileAttachment").map((a) => ({
    id: attr(all(a.inner, "AttachmentId")[0]?.attrs || "", "Id"), name: unesc(one(a.inner, "Name")) || "attachment", type: unesc(one(a.inner, "ContentType")) || "application/octet-stream",
    size: Number(one(a.inner, "Size")) || 0, inline: one(a.inner, "IsInline") === "true", cid: unesc(one(a.inner, "ContentId")).replace(/^<|>$/g, ""),
  })).filter((a) => a.id);
  let html = unesc(one(x, "Body"));
  // pictures inside the email: served from EWS when the page shows them
  for (const a of atts) if (a.cid) html = html.split(`cid:${a.cid}`).join(picUrl(a.id));
  const text = "";
  const listed = atts.filter((a) => !(a.inline && a.cid && html.includes(picUrl(a.id))));
  return {
    folder: imapPath, uid, messageId: unesc(one(x, "InternetMessageId")), references: unesc(one(x, "References")).split(/\s+/).filter(Boolean),
    fromAddress: replyTo?.addr || from.addr, fromName: from.name, from: fmt([from]), to: fmt(box(one(x, "ToRecipients"))), cc: fmt(box(one(x, "CcRecipients"))),
    subject: unesc(one(x, "Subject")), date: one(x, "DateTimeSent") || one(x, "DateTimeReceived"), html, text,
    // attachments: numbered after the IMAP ones would be; opened by their EWS id (see ewsAttachment)
    attachments: listed.map((a, i) => ({ i: 1000 + i, name: a.name, size: a.size, type: a.type, ews: a.id })),
    ews: atts, read: one(x, "IsRead") === "true",
  };
}

/** one attachment (or picture) by its EWS id */
export async function ewsAttachment(acct: MailAccount, id: string): Promise<{ name: string; type: string; content: Buffer } | null> {
  const x = await call(acct, `<m:GetAttachment><m:AttachmentIds><t:AttachmentId Id="${esc(id)}"/></m:AttachmentIds></m:GetAttachment>`, 50000);
  const a = all(x, "FileAttachment")[0];
  if (!a) return null;
  return { name: unesc(one(a.inner, "Name")) || "attachment", type: unesc(one(a.inner, "ContentType")) || "application/octet-stream", content: Buffer.from(one(a.inner, "Content"), "base64") };
}
