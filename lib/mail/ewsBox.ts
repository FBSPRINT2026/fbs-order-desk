import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailAccount } from "./config";
import { all, attr, call, esc, ewsFindByMessageId, ewsGetById, one, unesc, type EwsAtt } from "./ews";
import { afterInboxMove, groupConvos, readOnMove, SKIP, type Convo, type Folder, type FullMsg, type MsgRow } from "./folders";

/**
 * Email over EWS (Oct 14, Nick: "how can we make this more like Apple's Mail app… it seems like we're just fighting
 * this"). Apple Mail and Outlook talk to Exchange through its own sync; the portal used IMAP, which on Intermedia
 * allows only a couple of connections at a time and won't hand over some big emails. For a mailbox EWS works on,
 * everything the Email page does goes through EWS instead (HTTPS, no connection limit): the folder list, a folder's
 * emails, opening an email, search (the server's own index: every year, the words inside the emails too), moving and
 * archiving, and the Sent copy of a reply. The page doesn't change: an email listed over EWS gets a number
 * (mail_ews_ids, from 1e12 up) that stands for its EWS id.
 */
export const EWS_UID = 1e12;
export const isEwsUid = (uid: number) => uid >= EWS_UID;
const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const mid = (s?: string | null) => (s || "").trim().replace(/^<|>$/g, "");

/** does EWS work for this mailbox? (app_keys "ews", kept by the mail jobs; a minute in memory) */
const readyMemo = new Map<string, { ok: boolean; at: number }>();
export async function ewsReady(admin: SupabaseClient, acct: MailAccount) {
  const k = acct.email.toLowerCase(), hit = readyMemo.get(k);
  if (hit && Date.now() - hit.at < 60000) return hit.ok;
  const { data } = await admin.from("app_keys").select("value").eq("name", "ews").maybeSingle();
  const ok = !!(data?.value as Record<string, { ok?: boolean }> | null)?.[k]?.ok;
  readyMemo.set(k, { ok, at: Date.now() });
  return ok;
}

/* ------------------------------------------------------------------ folders */

type EF = { id: string; parent: string; name: string; cls: string; total: number; unread: number };
type Tree = { at: number; byPath: Map<string, Folder & { id: string }>; inbox: string; sent: string; trash: string; drafts: string; junk: string };
const trees = new Map<string, Tree>();

/** the mailbox's folders, named and nested the way IMAP named them ("INBOX", "INBOX/Archive", "Sent Items") */
export async function ewsTree(acct: MailAccount, fresh = false): Promise<Tree> {
  const k = acct.email.toLowerCase(), have = trees.get(k);
  if (have && !fresh && Date.now() - have.at < 5 * 60000) return have;
  const dist = ["msgfolderroot", "inbox", "sentitems", "deleteditems", "drafts", "junkemail"];
  const [d, x] = await Promise.all([
    call(acct, `<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>${dist.map((id) => `<t:DistinguishedFolderId Id="${id}"/>`).join("")}</m:FolderIds></m:GetFolder>`),
    call(acct, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:DisplayName"/><t:FieldURI FieldURI="folder:ParentFolderId"/><t:FieldURI FieldURI="folder:FolderClass"/><t:FieldURI FieldURI="folder:TotalCount"/><t:FieldURI FieldURI="folder:UnreadCount"/></t:AdditionalProperties></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned="1000" Offset="0" BasePoint="Beginning"/><m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>`),
  ]);
  const ids = all(d, "FolderId").map((f) => attr(f.attrs, "Id"));
  const [root, inbox, sent, trash, drafts, junk] = ids;
  const fs: EF[] = all(x, "Folder").map((f) => ({
    id: attr(all(f.inner, "FolderId")[0]?.attrs || "", "Id"), parent: attr(all(f.inner, "ParentFolderId")[0]?.attrs || "", "Id"), name: unesc(one(f.inner, "DisplayName")),
    cls: one(f.inner, "FolderClass"), total: Number(one(f.inner, "TotalCount")) || 0, unread: Number(one(f.inner, "UnreadCount")) || 0,
  })).filter((f) => f.id);
  const byId = new Map(fs.map((f) => [f.id, f]));
  const pathOf = (f: EF): string => {
    const own = f.id === inbox ? "INBOX" : f.name;
    const p = f.parent && f.parent !== root ? byId.get(f.parent) : undefined;
    return p ? `${pathOf(p)}/${own}` : own;
  };
  const byPath = new Map<string, Folder & { id: string }>();
  for (const f of fs) {
    if (f.cls && !/^IPF\.Note/i.test(f.cls)) continue; // calendars, contacts, tasks, notes
    const path = pathOf(f);
    if (SKIP.test(path)) continue;
    const parts = path.split("/");
    const special = f.id === inbox ? "\\Inbox" : f.id === sent ? "\\Sent" : f.id === trash ? "\\Trash" : f.id === drafts ? "\\Drafts" : f.id === junk ? "\\Junk" : /^archive$/i.test(path) ? "\\Archive" : "";
    byPath.set(path, { id: f.id, path, name: f.id === inbox ? "Inbox" : f.name, parent: parts.slice(0, -1).join("/"), depth: parts.length - 1, special, messages: f.total, unseen: f.unread, sane: /^@sane/i.test(f.name) });
  }
  const t: Tree = { at: Date.now(), byPath, inbox, sent, trash, drafts, junk };
  trees.set(k, t);
  return t;
}

export async function ewsFolders(acct: MailAccount): Promise<Folder[]> {
  const t = await ewsTree(acct, true);
  return [...t.byPath.values()].map(({ id: _id, ...f }) => f);
}

async function folderId(acct: MailAccount, path: string) {
  const t = await ewsTree(acct);
  const f = t.byPath.get(path) || (await ewsTree(acct, true)).byPath.get(path);
  return f?.id || "";
}

/** where "archive", "trash", a SaneBox key or a folder path goes (the same names the IMAP mover took) */
async function destOf(acct: MailAccount, to: string) {
  const t = await ewsTree(acct);
  const list = [...t.byPath.values()];
  const sane: Record<string, string> = { later: "@SaneLater", news: "@SaneNews", receipts: "@SaneReceipts", cc: "@SaneCC", blackhole: "@SaneBlackHole" };
  if (to === "archive") return list.find((f) => f.special === "\\Archive") || list.find((f) => /^archive$/i.test(f.name) && f.depth === 0) || list.find((f) => /^archive$/i.test(f.name)) || null;
  if (to === "trash") return list.find((f) => f.special === "\\Trash") || null;
  if (sane[to]) return list.find((f) => f.name.toLowerCase() === sane[to].toLowerCase()) || null;
  return t.byPath.get(to) || null;
}

/* ------------------------------------------------------------------ numbers for EWS ids */

async function uidsFor(admin: SupabaseClient, accountId: string, folder: string, itemIds: string[]) {
  const out = new Map<string, number>();
  if (!itemIds.length) return out;
  await admin.from("mail_ews_ids").upsert(itemIds.map((item_id) => ({ account_id: accountId, item_id, folder })), { onConflict: "account_id,item_id", ignoreDuplicates: true });
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data } = await admin.from("mail_ews_ids").select("id, item_id").eq("account_id", accountId).in("item_id", itemIds.slice(i, i + 100));
    for (const r of (data || []) as { id: number; item_id: string }[]) out.set(r.item_id, Number(r.id));
  }
  return out;
}

/** the EWS id an email number stands for: an EWS number directly, an IMAP number through its Message-ID */
export async function itemIdFor(admin: SupabaseClient, acct: MailAccount, path: string, uid: number): Promise<string> {
  if (isEwsUid(uid)) {
    const { data } = await admin.from("mail_ews_ids").select("item_id").eq("account_id", acct.id).eq("id", uid).maybeSingle();
    return (data?.item_id as string) || "";
  }
  const messageId = await messageIdOf(admin, acct, path, uid);
  return messageId ? ewsFindByMessageId(acct, path, messageId) : "";
}

async function messageIdOf(admin: SupabaseClient, acct: MailAccount, path: string, uid: number) {
  const tries = [
    admin.from("mail_cache").select("message_id").eq("account_id", acct.id).eq("folder", path).eq("uid", uid).limit(1).maybeSingle(),
    admin.from("mail_index").select("message_id").eq("account_id", acct.id).eq("folder", path).eq("uid", uid).limit(1).maybeSingle(),
    admin.from("mail_inbox").select("message_id").eq("account_id", acct.id).eq("uid", uid).limit(1).maybeSingle(),
  ];
  for (const t of tries) { const { data } = await t; if (data?.message_id) return String(data.message_id); }
  return "";
}

/* ------------------------------------------------------------------ lists and search */

const ITEM_PROPS = ["item:ParentFolderId", "item:Subject", "message:From", "item:DisplayTo", "item:DisplayCc", "item:DateTimeReceived", "message:IsRead", "item:Size", "message:InternetMessageId", "item:HasAttachments", "item:ConversationId", "item:Flag"]
  .map((f) => `<t:FieldURI FieldURI="${f}"/>`).join("");
const KINDS = "Message|MeetingRequest|MeetingResponse|MeetingCancellation|PostItem|Item";

function rowsOf(xml: string, folder: string, me: string, sentFolder = false): { id: string; row: Omit<MsgRow, "uid"> & { conv: string } }[] {
  const out: { id: string; row: Omit<MsgRow, "uid"> & { conv: string } }[] = [];
  for (const m of xml.matchAll(new RegExp(`<t:(${KINDS})>([\\s\\S]*?)</t:\\1>`, "g"))) {
    const x = m[2];
    const id = attr(all(x, "ItemId")[0]?.attrs || "", "Id");
    if (!id) continue;
    // people in our own company can come back as an Exchange address, not an email address: in Sent Items that's me
    const fromBox = one(x, "From"), raw = lc(unesc(one(fromBox, "EmailAddress"))), from = raw.includes("@") ? raw : sentFolder ? me : "";
    const toNames = unesc(one(x, "DisplayTo")).split(/;\s*/).filter(Boolean);
    out.push({ id, row: {
      folder, messageId: mid(unesc(one(x, "InternetMessageId"))), inReplyTo: "", subject: unesc(one(x, "Subject")), from, fromName: unesc(one(fromBox, "Name")),
      to: [], toNames, cc: [], date: one(x, "DateTimeReceived") || new Date().toISOString(), seen: one(x, "IsRead") !== "false",
      flagged: /Flagged/.test(one(x, "FlagStatus")), sent: sentFolder || from === me, size: Number(one(x, "Size")) || 0, conv: attr(all(x, "ConversationId")[0]?.attrs || "", "Id"),
    } });
  }
  return out;
}

/** Exchange's hidden "AllItems" search folder (every email in the mailbox), if it has one */
const allItems = new Map<string, string>();
async function allItemsId(acct: MailAccount) {
  const k = acct.email.toLowerCase();
  if (allItems.has(k)) return allItems.get(k)!;
  let id = "";
  try {
    const x = await call(acct, `<m:FindFolder Traversal="Shallow"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="folder:DisplayName"/><t:FieldURIOrConstant><t:Constant Value="AllItems"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction><m:ParentFolderIds><t:DistinguishedFolderId Id="root"/></m:ParentFolderIds></m:FindFolder>`, 15000);
    id = attr(all(x, "FolderId")[0]?.attrs || "", "Id");
  } catch { /* none */ }
  allItems.set(k, id);
  return id;
}

/** a folder's newest 50 (`older`: the ones before that date, for "Older emails") */
export async function ewsList(admin: SupabaseClient, acct: MailAccount, me: string, path: string, older?: string) {
  const fid = await folderId(acct, path);
  if (!fid) throw new Error("That folder isn't in your mailbox.");
  const restrict = older ? `<m:Restriction><t:IsLessThan><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="${esc(older)}"/></t:FieldURIOrConstant></t:IsLessThan></m:Restriction>` : "";
  const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${ITEM_PROPS}</t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="50" Offset="0" BasePoint="Beginning"/>${restrict}<m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:FolderId Id="${esc(fid)}"/></m:ParentFolderIds></m:FindItem>`);
  const got = rowsOf(x, path, me, fid === (await ewsTree(acct)).sent);
  const ids = await uidsFor(admin, acct.id, path, got.map((g) => g.id));
  const rows: MsgRow[] = got.filter((g) => ids.has(g.id)).map((g) => { const { conv: _c, ...r } = g.row; return { ...r, uid: ids.get(g.id)! }; });
  const root = all(x, "RootFolder")[0]?.attrs || "";
  return { rows, more: attr(root, "IncludesLastItemInRange") === "false" };
}

/**
 * Search the whole mailbox with the server's own index (every year, who, subject and the words inside), every mail
 * folder at once, newest first; grouped into conversations.
 */
export async function ewsSearch(admin: SupabaseClient, acct: MailAccount, me: string, q: string) {
  const term = q.trim().replace(/[<>]/g, " ").slice(0, 900);
  if (term.length < 2) return { convos: [] as Convo[], folders: 0, partial: false };
  const t = await ewsTree(acct);
  // the whole mailbox in one search, through Exchange's own "AllItems" folder (one index lookup instead of one per
  // folder: Amanda's 18 folders took 14 s one by one); each result is put back in the folder it's in
  // (Intermedia's AllItems answers nothing — tried Oct 14 — so this is off unless EWS_ALLITEMS is set)
  const allId = process.env.EWS_ALLITEMS ? await allItemsId(acct) : "";
  if (allId) {
    try {
      const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${ITEM_PROPS}</t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="250" Offset="0" BasePoint="Beginning"/><m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:FolderId Id="${esc(allId)}"/></m:ParentFolderIds><m:QueryString>${esc(term)}</m:QueryString></m:FindItem>`, 25000);
      const pathById = new Map([...t.byPath.values()].map((f) => [f.id, f]));
      const blocks = [...x.matchAll(new RegExp(`<t:(${KINDS})>([\\s\\S]*?)</t:\\1>`, "g"))];
      const found: MsgRow[] = [];
      const byFolder = new Map<string, { id: string; row: Omit<MsgRow, "uid"> & { conv: string } }[]>();
      for (const b of blocks) {
        const f = pathById.get(attr(all(b[2], "ParentFolderId")[0]?.attrs || "", "Id"));
        if (!f || /\\(Junk|Trash|Drafts)/.test(f.special) || /^@saneblackhole$/i.test(f.name)) continue; // not shown: junk, deleted, drafts, calendars…
        const [r] = rowsOf(b[0], f.path, me, f.id === t.sent);
        if (r) byFolder.set(f.path, [...(byFolder.get(f.path) || []), r]);
      }
      console.info(`mail search AllItems "${term.slice(0, 30)}": ${blocks.length} found, ${[...byFolder.values()].reduce((n, x) => n + x.length, 0)} in mail folders, total ${attr(all(x, "RootFolder")[0]?.attrs || "", "TotalItemsInView")}`);
      // nothing at all from AllItems (some servers don't search it): never again for this mailbox, folder by folder
      if (!blocks.length) { allItems.set(acct.email.toLowerCase(), ""); throw new Error("AllItems found nothing"); }
      for (const [path, got] of byFolder) {
        const ids = await uidsFor(admin, acct.id, path, got.map((g) => g.id));
        for (const g of got) { const u = ids.get(g.id); if (u) { const { conv: _c, ...r } = g.row; found.push({ ...r, uid: u }); } }
      }
      return { convos: groupConvos(found, me), folders: byFolder.size, partial: false };
    } catch (e) { console.warn(`mail search AllItems failed, folder by folder instead: ${e instanceof Error ? e.message : e}`); }
  }
  const folders = [...t.byPath.values()].filter((f) => !/\\(Junk|Trash|Drafts)/.test(f.special) && !/^@saneblackhole$/i.test(f.name) && f.messages > 0);
  const found: MsgRow[] = [];
  let partial = false, looked = 0;
  const queue = [...folders].sort((a, b) => (a.special ? 0 : 1) - (b.special ? 0 : 1));
  const failed: (Folder & { id: string })[] = [];
  const one1 = async (f: Folder & { id: string }, again = false) => {
    try {
      const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${ITEM_PROPS}</t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="80" Offset="0" BasePoint="Beginning"/><m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:FolderId Id="${esc(f.id)}"/></m:ParentFolderIds><m:QueryString>${esc(term)}</m:QueryString></m:FindItem>`, 20000);
      const got = rowsOf(x, f.path, me, f.id === t.sent);
      const ids = await uidsFor(admin, acct.id, f.path, got.map((g) => g.id));
      for (const g of got) { const u = ids.get(g.id); if (u) { const { conv: _c, ...r } = g.row; found.push({ ...r, uid: u }); } }
      looked++;
    } catch (e) {
      if (again) { partial = true; console.warn(`mail search ${f.path}: ${e instanceof Error ? e.message : e}`); } else failed.push(f);
    }
  };
  // several folders at a time: EWS has no connection limit (IMAP allowed two)
  await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) await one1(queue.shift()!); }));
  // a folder the server was too busy for: once more, one at a time
  for (const f of failed) await one1(f, true);
  return { convos: groupConvos(found, me), folders: looked, partial };
}

/* ------------------------------------------------------------------ one email, moving, read */

export async function ewsOpen(admin: SupabaseClient, acct: MailAccount, path: string, uid: number, picUrl: (id: string) => string): Promise<(FullMsg & { ews: EwsAtt[]; read: boolean; itemId: string }) | null> {
  const id = await itemIdFor(admin, acct, path, uid);
  if (!id) return null;
  const m = await ewsGetById(acct, id, path, uid, picUrl);
  return m ? { ...m, itemId: id } : null;
}

/** the Message-IDs of everything sitting in the Inbox right now, or null if the list didn't come back whole */
export async function ewsInboxMessageIds(acct: MailAccount): Promise<Set<string> | null> {
  const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="message:InternetMessageId"/></t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="1000" Offset="0" BasePoint="Beginning"/><m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`, 8000);
  if (attr(all(x, "RootFolder")[0]?.attrs || "", "IncludesLastItemInRange") !== "true") return null;
  return new Set(all(x, "InternetMessageId").map((m) => mid(unesc(m.inner))).filter(Boolean));
}

/** an Inbox email's raw message (MIME), found by its Message-ID, for keeping it in the portal */
export async function ewsMimeByMessageId(acct: MailAccount, messageId: string): Promise<Buffer | null> {
  const id = await ewsFindByMessageId(acct, "INBOX", messageId).catch(() => "");
  if (!id) return null;
  const x = await call(acct, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(id)}"/></m:ItemIds></m:GetItem>`, 40000);
  const b64 = one(x, "MimeContent").replace(/\s+/g, "");
  return b64 ? Buffer.from(b64, "base64") : null;
}

export async function ewsMarkRead(acct: MailAccount, itemId: string) {
  await call(acct, `<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve" SuppressReadReceipts="true"><m:ItemChanges><t:ItemChange><t:ItemId Id="${esc(itemId)}"/><t:Updates><t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>true</t:IsRead></t:Message></t:SetItemField></t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`);
}

/** move an email (never deletes: "trash" is the Deleted Items folder); out of the Inbox, its to-dos follow */
export async function ewsMove(admin: SupabaseClient, acct: MailAccount, path: string, uid: number, to: string, by: string) {
  const dest = await destOf(acct, to);
  if (!dest) throw new Error(["blackhole", "later", "news", "receipts", "cc"].includes(to) ? "That SaneBox folder isn't in your mailbox." : "That folder isn't in your mailbox.");
  if (dest.path === path) return { dest: dest.path };
  const id = await itemIdFor(admin, acct, path, uid);
  if (!id) throw new Error("That email isn't there any more.");
  const messageId = isEwsUid(uid) ? mid(unesc(one(await call(acct, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="message:InternetMessageId"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(id)}"/></m:ItemIds></m:GetItem>`), "InternetMessageId"))) : await messageIdOf(admin, acct, path, uid);
  // Archive and Black Hole: marked read on the way (Oct 15, Nick: "if an email is moved to archive or blackhole it is marked read")
  if (readOnMove(to, dest.path)) { try { await ewsMarkRead(acct, id); } catch { /* moved either way */ } }
  const x = await call(acct, `<m:MoveItem><m:ToFolderId><t:FolderId Id="${esc(dest.id)}"/></m:ToFolderId><m:ItemIds><t:ItemId Id="${esc(id)}"/></m:ItemIds></m:MoveItem>`);
  // the moved email has a new EWS id: its number follows it
  const newId = attr(all(x, "ItemId")[0]?.attrs || "", "Id");
  if (newId && isEwsUid(uid)) await admin.from("mail_ews_ids").update({ item_id: newId, folder: dest.path }).eq("account_id", acct.id).eq("id", uid);
  if (/^inbox$/i.test(path) && messageId) await afterInboxMove(admin, acct, messageId, dest.path, by);
  return { dest: dest.path };
}

/** the Sent Items copy of a reply sent by SMTP (SMTP doesn't keep one), as a sent, read email */
export async function ewsSaveSent(acct: MailAccount, raw: Buffer) {
  const t = await ewsTree(acct);
  await call(acct, `<m:CreateItem MessageDisposition="SaveOnly"><m:SavedItemFolderId><t:FolderId Id="${esc(t.sent)}"/></m:SavedItemFolderId><m:Items><t:Message><t:MimeContent CharacterSet="UTF-8">${raw.toString("base64")}</t:MimeContent><t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="3591" PropertyType="Integer"/><t:Value>1</t:Value></t:ExtendedProperty></t:Message></m:Items></m:CreateItem>`, 40000);
}

/**
 * Check again whether EWS works for a mailbox it didn't (every 10 minutes, from the mail job), so a mailbox switches
 * over by itself once EWS is turned on for it (Oct 14: Nick's, in HostPilot).
 */
export async function recheckEws(admin: SupabaseClient, acct: MailAccount) {
  const { data } = await admin.from("app_keys").select("value").eq("name", "ews").maybeSingle();
  const st = (data?.value || {}) as Record<string, { ok: boolean; detail: string; at: string }>;
  const k = acct.email.toLowerCase(), mine = st[k];
  // every 30 minutes (each refused try counts as a failed sign-in on the mailbox: not too many)
  if (mine?.ok || (mine && Date.parse(mine.at) > Date.now() - 30 * 60000)) return mine?.ok ?? false;
  const { ewsProbe } = await import("./ews");
  const r = await ewsProbe(acct);
  const { data: again } = await admin.from("app_keys").select("value").eq("name", "ews").maybeSingle();
  await admin.from("app_keys").upsert({ name: "ews", value: { ...((again?.value || {}) as object), [k]: { ok: r.ok, detail: r.detail.slice(0, 200), at: new Date().toISOString() } } }, { onConflict: "name" });
  readyMemo.delete(k);
  if (r.ok && !mine?.ok) console.info(`mail ews now works for ${k}`);
  return r.ok;
}
