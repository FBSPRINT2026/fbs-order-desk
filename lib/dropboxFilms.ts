import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { download, listFolder, type DbxEntry } from "@/lib/dropbox";

/**
 * The film folder: "FBS Film Folder/<customer>/<job>.ai" in Dropbox. Finds the customer's folder by name and their
 * film files that look like the job (by its nickname: "Sit Down Shirts" → SitDown.ai, "FJ Shirts" → FJ.ai), newest
 * near the job's date first. A film opened from here is copied into our storage (films/…) so the browser can read it
 * and the order can keep it in its production files.
 */
export const FILM_ROOT = "/FBS Film Folder";
const ART = /\.(ai|pdf|eps)$/i;
const STOP = new Set(["shirt", "shirts", "tee", "tees", "tshirt", "tshirts", "t", "hoodie", "hoodies", "new", "colors", "color", "reorder", "the", "and", "of", "for", "a", "order", "job", "print", "prints", "logo", "logos", "front", "back"]);
const words = (s: string) => (s || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
const squash = (s: string) => words(s).join("");

let rootCache: { at: number; list: DbxEntry[] } | null = null;

async function customerFolder(admin: SupabaseClient, names: string[]) {
  if (!rootCache || Date.now() - rootCache.at > 10 * 60_000) rootCache = { at: Date.now(), list: (await listFolder(admin, FILM_ROOT)).filter((e) => e[".tag"] === "folder") };
  const want = names.filter(Boolean).map((n) => ({ w: words(n), s: squash(n) }));
  let best: { e: DbxEntry; score: number } | null = null;
  for (const e of rootCache.list) {
    const fw = words(e.name), fs = squash(e.name);
    for (const n of want) {
      if (!fs) continue;
      const score = fs === n.s ? 10 : n.s.startsWith(fs) || fs.startsWith(n.s) ? 6 : fw.filter((w) => n.w.includes(w) && w.length > 2).length * 3;
      if (score > (best?.score || 0)) best = { e, score };
    }
  }
  return best && best.score >= 3 ? best.e : null;
}

export type FilmHit = { id: string; name: string; path: string; modified: string; size: number; score: number };

/** the film folder's customer folders (for picking one on the customer page) */
export async function filmFolders(admin: SupabaseClient) {
  if (!rootCache || Date.now() - rootCache.at > 10 * 60_000) rootCache = { at: Date.now(), list: (await listFolder(admin, FILM_ROOT)).filter((e) => e[".tag"] === "folder") };
  return rootCache.list.map((e) => e.path_display).sort((a, b) => a.localeCompare(b));
}
export const guessFolder = async (admin: SupabaseClient, names: string[]) => (await customerFolder(admin, names))?.path_display || null;

export async function findFilms(admin: SupabaseClient, o: { names: string[]; nickname: string; date?: string | null; folder?: string | null }) {
  const path = o.folder || (await customerFolder(admin, o.names))?.path_display;
  if (!path) return { folder: null, films: [] as FilmHit[] };
  const folder = { path_display: path, path_lower: path.toLowerCase() };
  const files = (await listFolder(admin, folder.path_lower, true)).filter((e) => e[".tag"] === "file" && ART.test(e.name));
  const nw = words(o.nickname), ns = squash(o.nickname);
  const when = o.date ? new Date(o.date).getTime() : 0;
  const films = files.map((f) => {
    const fw = words(f.name), fs = squash(f.name);
    let score = 0;
    if (ns && fs && (fs === ns || fs.includes(ns) || ns.includes(fs))) score += 6;
    score += fw.filter((w) => nw.includes(w)).length * 2;
    // made around the time of the old job: a little more likely
    const t = new Date(f.client_modified || f.server_modified || 0).getTime();
    if (when && t && Math.abs(t - when) < 45 * 86400_000) score += 1;
    return { id: f.id, name: f.name, path: f.path_display, modified: f.client_modified || f.server_modified || "", size: f.size || 0, score };
  }).sort((a, b) => b.score - a.score || b.modified.localeCompare(a.modified));
  return { folder: folder.path_display, films };
}

/** copies a film into our storage (once per version) and returns where it is */
export async function cacheFilm(admin: SupabaseClient, id: string) {
  const { buf, meta } = await download(admin, id);
  const ext = (meta.name.match(/\.[a-z0-9]+$/i)?.[0] || ".ai").toLowerCase();
  const path = `films/${id.replace(/[^\w-]/g, "")}-${(meta.rev || "").slice(0, 12)}${ext}`;
  const up = await admin.storage.from("proofs").upload(path, buf, { contentType: ext === ".pdf" ? "application/pdf" : "application/postscript", upsert: true });
  if (up.error) throw new Error(up.error.message);
  return { path, name: meta.name, display: meta.path_display };
}
