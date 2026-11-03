import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dropbox, read only: the shop's film folder (FBS Film Folder/<customer>/<job>.ai). The Dropbox app's key and secret
 * are in Vercel (DROPBOX_APP_KEY / DROPBOX_APP_SECRET); the owner connects it once from Settings, and the long-lived
 * sign-in is kept in integration_tokens (server only).
 */
export const dropboxConfigured = () => !!(process.env.DROPBOX_APP_KEY?.trim() && process.env.DROPBOX_APP_SECRET?.trim());
const basic = () => "Basic " + Buffer.from(`${process.env.DROPBOX_APP_KEY?.trim()}:${process.env.DROPBOX_APP_SECRET?.trim()}`).toString("base64");

export class DropboxError extends Error {}
let cached: { token: string; until: number } | null = null;

/** trades the code from Dropbox's sign-in page for the long-lived sign-in, and keeps it */
export async function dropboxConnect(admin: SupabaseClient, code: string, redirectUri: string, by: string) {
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: redirectUri }) });
  const j = await r.json().catch(() => ({})) as { refresh_token?: string; access_token?: string; expires_in?: number; account_id?: string; error_description?: string };
  if (!r.ok || !j.refresh_token) throw new DropboxError(j.error_description || `Dropbox said ${r.status}`);
  cached = j.access_token ? { token: j.access_token, until: Date.now() + ((j.expires_in || 3600) - 120) * 1000 } : null;
  const me = await api<{ name?: { display_name?: string }; email?: string }>(admin, "users/get_current_account", null).catch(() => null);
  await admin.from("integration_tokens").upsert({ name: "dropbox", data: { refresh_token: j.refresh_token, account_id: j.account_id || "", who: me?.name?.display_name || "", email: me?.email || "" }, updated_at: new Date().toISOString(), updated_by: by });
}

export async function dropboxStatus(admin: SupabaseClient) {
  if (!dropboxConfigured()) return { configured: false, connected: false, who: "" };
  const { data } = await admin.from("integration_tokens").select("data, updated_at").eq("name", "dropbox").maybeSingle();
  const d = (data?.data || {}) as { refresh_token?: string; who?: string; email?: string };
  return { configured: true, connected: !!d.refresh_token, who: [d.who, d.email].filter(Boolean).join(" · "), at: data?.updated_at || null };
}

async function token(admin: SupabaseClient) {
  if (cached && cached.until > Date.now()) return cached.token;
  if (!dropboxConfigured()) throw new DropboxError("Dropbox isn't set up (DROPBOX_APP_KEY / DROPBOX_APP_SECRET in Vercel).");
  const { data } = await admin.from("integration_tokens").select("data").eq("name", "dropbox").maybeSingle();
  const rt = (data?.data as { refresh_token?: string } | null)?.refresh_token;
  if (!rt) throw new DropboxError("Dropbox isn't connected yet (Settings → Dropbox → Connect).");
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }) });
  const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new DropboxError("Dropbox sign-in expired: connect it again in Settings. " + (j.error_description || ""));
  cached = { token: j.access_token, until: Date.now() + ((j.expires_in || 14400) - 120) * 1000 };
  return cached.token;
}

async function api<T>(admin: SupabaseClient, endpoint: string, body: unknown): Promise<T> {
  const t = await token(admin);
  const r = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${t}`, ...(body === null ? {} : { "Content-Type": "application/json" }) }, body: body === null ? undefined : JSON.stringify(body), cache: "no-store" });
  if (!r.ok) throw new DropboxError(`Dropbox ${endpoint}: ${(await r.text().catch(() => "")).slice(0, 200) || r.status}`);
  return r.json() as Promise<T>;
}

export type DbxEntry = { ".tag": "file" | "folder"; id: string; name: string; path_display: string; path_lower: string; server_modified?: string; client_modified?: string; size?: number; rev?: string };

export async function listFolder(admin: SupabaseClient, path: string, recursive = false): Promise<DbxEntry[]> {
  const out: DbxEntry[] = [];
  let r = await api<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(admin, "files/list_folder", { path, recursive, limit: 2000 });
  out.push(...r.entries);
  for (let i = 0; r.has_more && i < 20; i++) { r = await api(admin, "files/list_folder/continue", { cursor: r.cursor }); out.push(...r.entries); }
  return out;
}

export async function download(admin: SupabaseClient, pathOrId: string): Promise<{ buf: ArrayBuffer; meta: DbxEntry }> {
  const t = await token(admin);
  const r = await fetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": JSON.stringify({ path: pathOrId }).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) }, cache: "no-store" });
  if (!r.ok) throw new DropboxError(`Dropbox download: ${(await r.text().catch(() => "")).slice(0, 200) || r.status}`);
  return { buf: await r.arrayBuffer(), meta: JSON.parse(r.headers.get("dropbox-api-result") || "{}") as DbxEntry };
}

/**
 * Save a file into Dropbox (never over another: a name already there gets " (1)"). Needs the app's files.content.write
 * permission (Oct 29: added so films go to FilmMaker's hot folder through Dropbox, not through the browser).
 */
export async function uploadFile(admin: SupabaseClient, path: string, bytes: Uint8Array): Promise<DbxEntry> {
  const t = await token(admin);
  const arg = JSON.stringify({ path, mode: "add", autorename: true, mute: true }).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": arg, "Content-Type": "application/octet-stream" }, body: bytes as unknown as BodyInit, cache: "no-store" });
  if (!r.ok) {
    const txt = (await r.text().catch(() => "")).slice(0, 300);
    if (/missing_scope|files\.content\.write/i.test(txt)) throw new DropboxError("Dropbox doesn't allow saving yet: tick files.content.write on the Dropbox app (Permissions), then Settings → Dropbox → Connect again.");
    throw new DropboxError(`Dropbox upload: ${txt || r.status}`);
  }
  return r.json() as Promise<DbxEntry>;
}

/** files whose name matches, anywhere in the Dropbox (newest first), optionally only these extensions */
export async function searchFiles(admin: SupabaseClient, query: string, exts: string[] = [], max = 60): Promise<DbxEntry[]> {
  const r = await api<{ matches: { metadata: { metadata: DbxEntry } }[] }>(admin, "files/search_v2", { query: query.slice(0, 200), options: { max_results: Math.min(max, 1000), file_status: "active", filename_only: true, ...(exts.length ? { file_extensions: exts } : {}) } });
  return (r.matches || []).map((m) => m.metadata?.metadata).filter((x): x is DbxEntry => !!x && x[".tag"] === "file")
    .sort((a, b) => (b.server_modified || "").localeCompare(a.server_modified || ""));
}

/**
 * The files behind a Dropbox share link (a customer's folder: Tiger Blue links one per job), read one by one through the
 * shop's Dropbox sign-in instead of as one zip (Nov 2: #2848's folder was too big to come down as a zip, so nothing came
 * in). Sub-folders two levels down; each file at most `each` bytes, `total` in all. Throws DropboxError when Dropbox
 * won't (not connected, or the app lacks the sharing.read permission), so the caller can try the zip instead.
 */
export async function sharedLinkFiles(admin: SupabaseClient, url: string, o: { each: number; total: number; files: number; deadline: number }) {
  const link = (() => { try { const u = new URL(url); u.searchParams.delete("dl"); return u.toString(); } catch { return url; } })();
  const found: DbxEntry[] = [];
  const walk = async (path: string, depth: number) => {
    let r = await api<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(admin, "files/list_folder", { path, shared_link: { url: link } });
    const all = [...r.entries];
    for (let i = 0; r.has_more && i < 5; i++) { r = await api(admin, "files/list_folder/continue", { cursor: r.cursor }); all.push(...r.entries); }
    for (const e of all) {
      if (e[".tag"] === "file") found.push({ ...e, path_display: `${path}/${e.name}` });
      else if (e[".tag"] === "folder" && depth < 2) await walk(`${path}/${e.name}`, depth + 1);
    }
  };
  await walk("", 0);
  const out: { name: string; buf: Buffer; type: string }[] = [], skipped: string[] = [];
  let used = 0;
  const t = await token(admin);
  for (const e of found.sort((a, b) => (a.size || 0) - (b.size || 0))) {
    if (out.length >= o.files || Date.now() > o.deadline) { skipped.push(e.name); continue; }
    if ((e.size || 0) > o.each || used + (e.size || 0) > o.total) { skipped.push(e.name); continue; }
    const arg = JSON.stringify({ url: link, path: e.path_display }).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const r = await fetch("https://content.dropboxapi.com/2/sharing/get_shared_link_file", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": arg }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!r || !r.ok) {
      const txt = r ? (await r.text().catch(() => "")).slice(0, 300) : "";
      if (/missing_scope|sharing\.read/i.test(txt)) throw new DropboxError("Dropbox doesn't allow reading share links yet: tick sharing.read on the Dropbox app (Permissions), then Settings → Dropbox → Connect again.");
      skipped.push(e.name); continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    used += buf.length;
    out.push({ name: e.name, buf, type: r.headers.get("content-type")?.split(";")[0] || "application/octet-stream" });
  }
  return { files: out, skipped };
}
