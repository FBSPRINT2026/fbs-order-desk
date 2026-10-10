/**
 * The original names of files copied from Printavo (Oct 10, 2026). Printavo's API only gave Filestack links; the name
 * each file was uploaded with is looked up from Filestack and kept in printavo_file_names (by Filestack handle).
 * Our copies keep their storage paths (history is locked), so a file is shown and downloaded under its original name
 * instead: Supabase signed links take `download=<name>`, which saves the file under that name.
 * Shared by the server and the browser.
 */

/** The Filestack handle in a Printavo file link: the LAST one (a thumbnail link wraps the original's link). */
export function pvHandle(url?: string | null): string | null {
  if (!url) return null;
  let last: string | null = null;
  for (const m of url.matchAll(/(?:filepicker\.io|filestackcontent\.com|filestackapi\.com)\/(?:api\/file\/)?([A-Za-z0-9]{20})(?![A-Za-z0-9])/g)) last = m[1];
  return last;
}

/** The handle at the end of one of our copies' paths (printavo/<id>/<stamp>-<handle>.<ext>), when the copy has no name. */
export const pathHandle = (path?: string | null) => (path ? path.match(/-([A-Za-z0-9]{20})\.[A-Za-z0-9]{1,6}$/)?.[1] || null : null);

const extOf = (s: string) => s.split("?")[0].match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || "";

/** A name keeps an extension: the original's own, else the one on our copy. */
export function withExt(name: string, path?: string | null): string {
  const n = name.trim();
  if (!n) return n;
  if (extOf(n)) return n;
  const e = path ? extOf(path) : "";
  return e ? `${n}.${e}` : n;
}

/** The name a download saves under: no path separators or characters Windows refuses. */
export const safeDownloadName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";

/** A Supabase signed link that saves the file as `name` (Content-Disposition) instead of our storage name. */
export function downloadUrl(signed: string | undefined | null, name?: string | null): string {
  if (!signed) return "";
  if (!name || !/\/storage\/v1\/object\/sign\//.test(signed) || !/[?&]token=/.test(signed)) return signed;
  return signed.replace(/[?&]download=[^&]*/, "") + "&download=" + encodeURIComponent(safeDownloadName(name));
}

/** What a copied file from Printavo is called: Printavo's own name, else the original upload's, else our copy's. */
export function pvFileName(o: { url?: string | null; name?: string | null; path?: string | null; names?: Record<string, string> | null }): string {
  const path = o.path && !["failed", "too-big"].includes(o.path) ? o.path : "";
  const h = pvHandle(o.url) || pathHandle(path);
  const orig = h ? o.names?.[h] : "";
  const given = (o.name || "").trim();
  if (given) return withExt(given, path);
  if (orig) return withExt(orig, path);
  const base = (path || o.url || "").split("?")[0].split("/").pop() || "File";
  return base.replace(/^[a-z0-9]{6,12}-/, "");
}

/** The art_files label for a file from an old Printavo job: "From the old Printavo job #33729: Peticolas Sit Down Forest.pdf". */
export const oldJobLabel = (visualId: string | number, file: string) => `From the old Printavo job #${visualId}: ${file}`;
/** The file name in such a label (what a download saves under). */
export const labelFileName = (label: string) => label.replace(/^(?:From the old Printavo job|Old mockup)[^:]*:\s*/i, "").trim() || label;
