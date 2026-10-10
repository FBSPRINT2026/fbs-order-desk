import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderFiles, type PvOrder } from "@/lib/archive";
import { pathHandle, pvHandle, withExt } from "@/lib/printavoNames";

/**
 * Filestack's public metadata for a Printavo file (no key needed): the name it was uploaded with, its type and size.
 * Read-only; never touches Printavo itself.
 */
export type FileMeta = { filename: string; mimetype: string; size: number | null };
export class FilestackBusy extends Error {}

export async function fetchFileMeta(handle: string, timeoutMs = 10000): Promise<FileMeta | "missing"> {
  const r = await fetch(`https://www.filestackapi.com/api/file/${encodeURIComponent(handle)}/metadata?filename=true&mimetype=true&size=true`, {
    cache: "no-store", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" },
  });
  if (r.status === 404 || r.status === 410) { await r.body?.cancel().catch(() => {}); return "missing"; }
  if (r.status === 429 || r.status === 503) { await r.body?.cancel().catch(() => {}); throw new FilestackBusy(`HTTP ${r.status}`); }
  if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error(`HTTP ${r.status}`); }
  const j = (await r.json().catch(() => null)) as { filename?: string; mimetype?: string; size?: number } | null;
  if (!j) throw new Error("not JSON");
  return { filename: String(j.filename || "").trim(), mimetype: String(j.mimetype || ""), size: Number.isFinite(+j.size!) ? Math.round(+j.size!) : null };
}

/** Saves one lookup's result. */
export async function saveFileMeta(admin: SupabaseClient, handle: string, got: FileMeta | "missing" | { error: string }, tries?: number) {
  const now = new Date().toISOString();
  const row = got === "missing" ? { handle, status: "missing", fetched_at: now, last_error: null }
    : "error" in got ? { handle, status: "error", fetched_at: now, last_error: got.error.slice(0, 300) }
    : { handle, status: got.filename ? "ok" : "missing", filename: got.filename || null, mimetype: got.mimetype || null, size: got.size, fetched_at: now, last_error: null };
  await admin.from("printavo_file_names").upsert(tries == null ? row : { ...row, tries }, { onConflict: "handle" });
}

/**
 * Original names for these handles (handle → name). Names not looked up yet are fetched now when `live` (a few at a
 * time, briefly) and saved, so a new order made from an old job gets the real name right away.
 */
export async function namesFor(admin: SupabaseClient, handles: (string | null | undefined)[], live = false): Promise<Record<string, string>> {
  const hs = [...new Set(handles.filter((h): h is string => !!h))];
  const out: Record<string, string> = {};
  if (!hs.length) return out;
  for (let i = 0; i < hs.length; i += 200) {
    const { data } = await admin.from("printavo_file_names").select("handle, filename, status").in("handle", hs.slice(i, i + 200));
    for (const r of (data || []) as { handle: string; filename: string | null; status: string | null }[]) if (r.filename) out[r.handle] = r.filename;
  }
  if (live) {
    const todo = hs.filter((h) => !out[h]).slice(0, 24);
    await Promise.all(todo.map(async (h) => {
      try {
        const m = await fetchFileMeta(h, 6000);
        await saveFileMeta(admin, h, m);
        if (m !== "missing" && m.filename) out[h] = m.filename;
      } catch { /* left for the backfill */ }
    }));
  }
  return out;
}

/**
 * Original names for our copies of Printavo files, by storage path (printavo/<archived id>/…): Printavo's own name for
 * the file, else the name it was uploaded with (looked up now if need be). path → { name, visualId }.
 */
export async function namesForPaths(admin: SupabaseClient, paths: string[]): Promise<Record<string, { name: string; visualId: string }>> {
  const want = [...new Set(paths.filter((p) => /^printavo\/[0-9a-f-]{36}\//i.test(p)))];
  const out: Record<string, { name: string; visualId: string }> = {};
  if (!want.length) return out;
  const ids = [...new Set(want.map((p) => p.split("/")[1]))];
  const { data } = await admin.from("archived_orders").select("id, visual_id, files, data").in("id", ids);
  const urlOf = new Map<string, { url: string; visualId: string; given: string }>();
  for (const r of (data || []) as { id: string; visual_id: string; files: Record<string, string> | null; data: PvOrder | null }[]) {
    const given = new Map<string, string>();
    if (r.data) {
      orderFiles(r.data).forEach((f) => { if (f.name) given.set(f.full, f.name); });
      (r.data.messages || []).forEach((m) => (m.attachments || []).forEach((a) => { if (a.name) given.set(a.url, a.name); }));
    }
    for (const [u, p] of Object.entries(r.files || {})) if (want.includes(p)) urlOf.set(p, { url: u, visualId: String(r.visual_id || ""), given: given.get(u) || "" });
  }
  const names = await namesFor(admin, want.map((p) => (urlOf.get(p)?.given ? null : pvHandle(urlOf.get(p)?.url) || pathHandle(p))), true);
  for (const p of want) {
    const u = urlOf.get(p);
    const h = pvHandle(u?.url) || pathHandle(p);
    const name = u?.given || (h ? names[h] : "") || "";
    if (name) out[p] = { name: withExt(name, p), visualId: u?.visualId || "" };
  }
  return out;
}
