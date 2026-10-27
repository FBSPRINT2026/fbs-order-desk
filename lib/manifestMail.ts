import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MAIL_HOST, encryptSecret, type MailAccount } from "@/lib/mail/config";
import { all, attr, call, esc, ewsAttachment, ewsProbe, one, unesc } from "@/lib/mail/ews";
import { importManifest, parseManifest } from "@/lib/manifest";
import { readXlsx } from "@/lib/xlsx";

/**
 * Supplier manifests from the shipping mailbox (Oct 27, Nick: "you automatically need to get the S&S Activewear and
 * SanMar goods manifests every morning… they go to shipping@fbsprint.com… I want to be able to change it quickly").
 * Goods & Receiving → Settings keeps the mailbox (address and password, the password encrypted; app_keys
 * "manifest_mailbox"). The hourly goods pass (6 a.m.–6 p.m. weekdays) looks in it for the last few days' supplier
 * manifest emails and imports each one once (the same import as "Import Supplier Manifests"). Nothing else in the
 * mailbox is read, and nothing in it is moved, marked or answered.
 */
const KEY = "manifest_mailbox";
export type ManifestBox = {
  email: string; host: string; enc_password: string; enabled: boolean;
  last_run?: string | null; last_ok?: string | null; last_error?: string | null;
  /** the emails already imported (their Message-IDs), newest last; and what each brought in */
  seen?: string[]; log?: { at: string; subject: string; file: string; supplier: string; lines: number; new: number; shipments: number; error?: string }[];
};
export type ManifestBoxPublic = Omit<ManifestBox, "enc_password" | "seen"> & { hasPassword: boolean };

export async function getBox(admin: SupabaseClient): Promise<ManifestBox | null> {
  const { data } = await admin.from("app_keys").select("value").eq("name", KEY).maybeSingle();
  return (data?.value as ManifestBox | null) || null;
}
async function putBox(admin: SupabaseClient, b: ManifestBox) {
  const { error } = await admin.from("app_keys").upsert({ name: KEY, value: b }, { onConflict: "name" });
  if (error) throw new Error(error.message);
}
export const publicBox = (b: ManifestBox | null): ManifestBoxPublic | null => {
  if (!b) return null;
  const { enc_password, seen: _s, ...rest } = b; void _s;
  return { ...rest, hasPassword: !!enc_password };
};
/** the mailbox shaped like a connected one, for the EWS reader (it's no one's inbox: never stored in mail_accounts) */
const acctOf = (b: ManifestBox) => ({
  id: "manifest-mailbox", user_id: "", email: b.email, name: "Shipping", imap_host: b.host || DEFAULT_MAIL_HOST, smtp_host: b.host || DEFAULT_MAIL_HOST, enc_password: b.enc_password, enabled: true,
  inbox_validity: null, inbox_uid: null, sent_folder: null, sent_validity: null, sent_uid: null, last_run_at: null, last_ok_at: null, last_error: null, last_error_at: null, stats: {},
}) as unknown as MailAccount;

/** set or change the mailbox (a blank password keeps the saved one); checks it can be read before saving */
export async function saveBox(admin: SupabaseClient, p: { email: string; password?: string; host?: string; enabled: boolean }) {
  const email = p.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter the full email address, like shipping@fbsprint.com.");
  const cur = await getBox(admin);
  const keep = cur && cur.email === email ? cur.enc_password : "";
  const enc = p.password ? encryptSecret(p.password) : keep;
  if (!enc) throw new Error("Enter that mailbox's password.");
  const next: ManifestBox = { ...(cur || {}), email, host: (p.host || cur?.host || DEFAULT_MAIL_HOST).trim().toLowerCase(), enc_password: enc, enabled: p.enabled, seen: cur && cur.email === email ? cur.seen || [] : [], log: cur && cur.email === email ? cur.log || [] : [] };
  if (p.enabled) {
    const probe = await ewsProbe(acctOf(next)).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 }));
    if (!probe.ok) throw new Error(`Couldn't sign in to ${email}: ${probe.detail}`);
  }
  await putBox(admin, { ...next, last_error: null });
  return publicBox(next);
}

const SUPPLIER_MAIL = /ssactivewear|sanmar/i;
const MANIFEST_SUBJECT = /manifest|shipment|ship notice|shipping notification|tracking/i;

/**
 * Look in the mailbox for supplier manifest emails from the last `days` days and import each new one. Returns what
 * it did (for Settings and the hourly pass).
 */
export async function checkManifestMail(admin: SupabaseClient, opts: { days?: number; deadline?: number } = {}) {
  const b = await getBox(admin);
  if (!b || !b.enabled || !b.email || !b.enc_password) return { skipped: "No shipping mailbox set (Goods & Receiving → Settings)." };
  const acct = acctOf(b), seen = new Set(b.seen || []), log = [...(b.log || [])];
  const out = { looked: 0, imported: 0, lines: 0, errors: [] as string[] };
  const since = new Date(Date.now() - (opts.days || 4) * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  try {
    // the Inbox and every folder under it (a rule may file the manifests away), but not Deleted Items or Junk
    const ff = await call(acct, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:DisplayName"/></t:AdditionalProperties></m:FolderShape><m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>`, 30000);
    const folders = all(ff, "Folder").map((f) => ({ id: attr(all(f.inner, "FolderId")[0]?.attrs || "", "Id"), name: unesc(one(f.inner, "DisplayName")) }))
      .filter((f) => f.id && !/^(deleted items|junk( e-?mail)?|drafts|outbox|sent items|conversation history|sync issues.*|conflicts|local failures|server failures|calendar|contacts|tasks|notes|journal|rss feeds)$/i.test(f.name));
    const ids = [`<t:DistinguishedFolderId Id="inbox"/>`, ...folders.map((f) => `<t:FolderId Id="${esc(f.id)}"/>`)];
    const items: { id: string; subject: string; from: string; mid: string; received: string }[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const x = await call(acct, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="item:HasAttachments"/></t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="100" Offset="0" BasePoint="Beginning"/><m:Restriction><t:IsGreaterThanOrEqualTo><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="${since}"/></t:FieldURIOrConstant></t:IsGreaterThanOrEqualTo></m:Restriction><m:ParentFolderIds>${ids.slice(i, i + 20).join("")}</m:ParentFolderIds></m:FindItem>`, 30000);
      for (const m of all(x, "Message")) {
        const from = unesc(one(one(m.inner, "From"), "EmailAddress")).toLowerCase(), subject = unesc(one(m.inner, "Subject"));
        if (one(m.inner, "HasAttachments") !== "true" || !SUPPLIER_MAIL.test(from + " " + subject) || !MANIFEST_SUBJECT.test(subject)) continue;
        items.push({ id: attr(all(m.inner, "ItemId")[0]?.attrs || "", "Id"), subject, from, mid: unesc(one(m.inner, "InternetMessageId")), received: one(m.inner, "DateTimeReceived") });
      }
    }
    items.sort((a, b2) => a.received.localeCompare(b2.received));
    for (const it of items) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const key = it.mid || it.id;
      if (!it.id || seen.has(key)) continue;
      out.looked++;
      const g = await call(acct, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Attachments"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(it.id)}"/></m:ItemIds></m:GetItem>`, 30000);
      const atts = all(g, "FileAttachment").map((a) => ({ id: attr(all(a.inner, "AttachmentId")[0]?.attrs || "", "Id"), name: unesc(one(a.inner, "Name")) })).filter((a) => a.id && /\.(xlsx|csv)$/i.test(a.name));
      let done = false;
      for (const a of atts) {
        try {
          const f = await ewsAttachment(acct, a.id);
          if (!f) continue;
          const r = await importFile(admin, f.name, f.content, /sanmar/i.test(it.from + it.subject) ? "sanmar" : "");
          out.imported++; out.lines += r.new; done = true;
          log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), file: f.name.slice(0, 120), supplier: r.supplier, lines: r.lines, new: r.new, shipments: r.shipments });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          out.errors.push(`${a.name}: ${msg}`);
          log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), file: a.name.slice(0, 120), supplier: "", lines: 0, new: 0, shipments: 0, error: msg.slice(0, 200) });
        }
      }
      // read once: a supplier email with no manifest file (an order confirmation) isn't looked at again either
      if (done || !atts.length) seen.add(key);
    }
    await putBox(admin, { ...b, seen: [...seen].slice(-400), log: log.slice(-40), last_run: new Date().toISOString(), last_ok: new Date().toISOString(), last_error: out.errors.length ? out.errors.join("; ").slice(0, 300) : null });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await putBox(admin, { ...b, seen: [...seen].slice(-400), log: log.slice(-40), last_run: new Date().toISOString(), last_error: msg.slice(0, 300) }).catch(() => null);
    return { ...out, error: msg };
  }
}

/** a manifest file (S&S or SanMar, .xlsx or .csv) into Goods & Receiving: the same import as uploading it by hand */
export async function importFile(admin: SupabaseClient, name: string, buf: Buffer, hint: "" | "ss" | "sanmar") {
  const rows = /\.csv$/i.test(name)
    ? buf.toString("utf8").split(/\r?\n/).map((line) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')))
    : readXlsx(buf);
  const title = rows.slice(0, 3).flat().join(" "), head = rows.slice(0, 5).flat().join(" | ");
  const sanmarCols = /decorator\s*customer\s*name|catalog\s*style|carton\s*number|customer\s*account/i.test(head) || rows.slice(0, 20).some((r) => r.some((c) => /^SO-\d{6,}$/.test(c.trim())));
  const supplier: "ss" | "sanmar" = hint === "sanmar" || /sanmar/i.test(title + name) || (sanmarCols && !/s&s\s*activewear/i.test(title)) ? "sanmar" : "ss";
  const lines = parseManifest(rows);
  if (!lines.length) throw new Error("No shipments in that file.");
  return { supplier, ...(await importManifest(admin, supplier, lines, name)) };
}
