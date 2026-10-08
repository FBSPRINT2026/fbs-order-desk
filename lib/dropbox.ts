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
