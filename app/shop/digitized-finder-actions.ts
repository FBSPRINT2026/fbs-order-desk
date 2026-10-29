"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MailAccount } from "@/lib/mail/config";

/**
 * "Already digitized?" (components/DigitizedFinder.tsx; Oct 29, Nick: "Amanda already got it in her email from before, so
 * I go find the email and we select it and you upload it… or we should be able to go on the server and find it… treat it
 * just like a package: the DST, the EMB, and the PDF"). Finds the stitch files in the shop's mailboxes or in Dropbox and
 * brings the picked ones into the portal's storage for the finder to read and keep. Staff only; reads, sends nothing.
 */
type Found = { path: string; name: string; type: string };
const SEW = /\.(dst|emb|zip)$/i, PACK = /\.(dst|emb|pdf|zip)$/i;
const safe = (s: string) => s.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const words = (q: string) => [...new Set((q || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 2))];

export type MailHit = { key: string; accountId: string; account: string; folder: string; uid: number; messageId: string; subject: string; from: string; date: string; files: string[] };

/** emails with a DST or EMB attached (any shop mailbox, last 18 months), best matches for the words first */
export async function findDigitizedEmails(q: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const since = new Date(Date.now() - 540 * 86400000).toISOString();
    const ws = words(q);
    let qb = admin.from("mail_cache").select("account_id, folder, uid, message_id, subject, from_email, from_name, sent_at, attachments").gte("sent_at", since).neq("attachments", "[]").is("gone_at", null);
    if (ws.length) qb = qb.or(ws.slice(0, 6).flatMap((w) => [`subject.ilike.%${w}%`, `hay.ilike.%${w}%`]).join(","));
    const { data } = await qb.order("sent_at", { ascending: false }).limit(800);
    const { data: accts } = await admin.from("mail_accounts").select("id, email");
    const acc = new Map(((accts || []) as { id: string; email: string }[]).map((a) => [a.id, a.email]));
    const seen = new Map<string, MailHit & { score: number }>();
    for (const r of (data || []) as { account_id: string; folder: string; uid: number; message_id: string; subject: string; from_email: string; from_name: string; sent_at: string; attachments: { name?: string }[] }[]) {
      const files = (r.attachments || []).map((a) => a.name || "").filter((n) => PACK.test(n));
      if (!files.some((n) => SEW.test(n))) continue;
      const hay = `${r.subject} ${files.join(" ")}`.toLowerCase();
      const score = ws.filter((w) => hay.includes(w)).length * 10 + (/inbox/i.test(r.folder) ? 1 : 0);
      const k = r.message_id || `${r.account_id}:${r.folder}:${r.uid}`;
      const prev = seen.get(k);
      if (prev && prev.score >= score) continue;
      seen.set(k, { key: k, accountId: r.account_id, account: acc.get(r.account_id) || "", folder: r.folder, uid: r.uid, messageId: r.message_id, subject: r.subject || "(no subject)", from: r.from_name || r.from_email, date: r.sent_at, files, score });
    }
    const list = [...seen.values()].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 25).map(({ score: _s, ...h }) => { void _s; return h; });
    return { ok: true as const, list };
  } catch (e) { return fail(e); }
}

/** the picked email's stitch files (DST, EMB, the PDF worksheet, or a zip), brought into storage to read */
export async function takeEmailDigitized(accountId: string, folder: string, uid: number, messageId: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: a } = await admin.from("mail_accounts").select("*").eq("id", accountId).maybeSingle();
    if (!a) return { ok: false as const, error: "That mailbox isn't connected anymore." };
    const { readWhole } = await import("@/lib/digitizerOutside");
    const m = await readWhole(admin, a as MailAccount, folder, uid, messageId);
    if (!m) return { ok: false as const, error: "Couldn't read that email from the mailbox. Try again in a minute." };
    const out: Found[] = [];
    const stamp = Date.now();
    for (const f of m.attachments.filter((x) => PACK.test(x.filename || ""))) {
      const path = `embroidery/incoming/${stamp}-${safe(f.filename!)}`;
      const r = await admin.storage.from("proofs").upload(path, f.content, { contentType: f.contentType || "application/octet-stream", upsert: true });
      if (!r.error) out.push({ path, name: f.filename!, type: f.contentType || "" });
    }
    if (!out.some((x) => SEW.test(x.name))) return { ok: false as const, error: "That email doesn't have a DST or EMB attached." };
    return { ok: true as const, files: out };
  } catch (e) { return fail(e); }
}

export type DbxHit = { path: string; name: string; folder: string; date: string; size: number };
/** stitch files in Dropbox whose name matches */
export async function findDigitizedDropbox(q: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { searchFiles, dropboxStatus } = await import("@/lib/dropbox");
    const st = await dropboxStatus(admin);
    if (!st.connected) return { ok: false as const, error: "Dropbox isn't connected (Settings → Dropbox)." };
    const query = (q || "").trim();
    if (!query) return { ok: true as const, list: [] as DbxHit[] };
    const found = await searchFiles(admin, query, ["dst", "emb", "pdf", "zip"], 80);
    const list: DbxHit[] = found.map((f) => ({ path: f.path_display, name: f.name, folder: f.path_display.slice(0, f.path_display.length - f.name.length - 1) || "/", date: f.server_modified || "", size: f.size || 0 }));
    // a PDF only beside a stitch file (a worksheet), not every PDF with the word in it
    const withSew = new Set(list.filter((x) => SEW.test(x.name)).map((x) => x.folder));
    return { ok: true as const, list: list.filter((x) => SEW.test(x.name) || withSew.has(x.folder)).slice(0, 40) };
  } catch (e) { return fail(e); }
}

/** the picked Dropbox files, brought into storage to read */
export async function takeDropboxDigitized(paths: string[]) {
  try {
    await staff();
    const admin = createAdminClient();
    const { download } = await import("@/lib/dropbox");
    const out: Found[] = [];
    const stamp = Date.now();
    for (const p of paths.filter((x) => PACK.test(x)).slice(0, 6)) {
      const { buf, meta } = await download(admin, p);
      const name = meta.name || p.split("/").pop() || "file";
      const path = `embroidery/incoming/${stamp}-${safe(name)}`;
      const r = await admin.storage.from("proofs").upload(path, new Uint8Array(buf), { contentType: /\.pdf$/i.test(name) ? "application/pdf" : "application/octet-stream", upsert: true });
      if (!r.error) out.push({ path, name, type: /\.pdf$/i.test(name) ? "application/pdf" : "" });
    }
    if (!out.some((x) => SEW.test(x.name))) return { ok: false as const, error: "Pick the DST (or the zip) too." };
    return { ok: true as const, files: out };
  } catch (e) { return fail(e); }
}
