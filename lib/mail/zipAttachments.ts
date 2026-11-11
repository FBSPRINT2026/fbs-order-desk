import type { SupabaseClient } from "@supabase/supabase-js";
import { unzip } from "@/lib/unzip";

/**
 * A zipped attachment opened: the files inside it become attachments of the email too (Nov 10, Nick on Dear Heart's
 * "11/6 Reorder": each design's S&S confirmation came zipped, "DH-WS-Forged-Tee-Char-410pcs.zip", and Create order
 * read the order without its sizes: "zip file could not be opened"). Each inner file is named after its zip
 * ("DH-WS-Forged-Tee-Char-410pcs › S&S_Activewear_Order_Confirmation_77674799.pdf"), so which design it belongs to
 * isn't lost; the zip stays on the list too. Done when an email comes in (lib/mail/process.ts saveAttachments) and,
 * for emails already on file, the first time their files are read (lib/mail/imap.ts refetchAttachments).
 */
export type Att = { name: string; path: string; type: string; size: number };
export const isZip = (a: { name: string; type?: string }) => /\.zip$/i.test(a.name) || /zip/i.test(a.type || "");
export const zipLabel = (zipName: string) => zipName.replace(/\.zip$/i, "");
const SEP = " › ";
const typeOf = (n: string) => (/\.pdf$/i.test(n) ? "application/pdf" : /\.png$/i.test(n) ? "image/png" : /\.jpe?g$/i.test(n) ? "image/jpeg" : /\.(xlsx|xlsm)$/i.test(n) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.csv$/i.test(n) ? "text/csv" : /\.svg$/i.test(n) ? "image/svg+xml" : /\.(ai|eps)$/i.test(n) ? "application/postscript" : "application/octet-stream");

/** the files in one zip saved beside it, as attachments (at most 20, each under 40 MB; zips in zips aren't opened) */
export async function saveZipped(admin: SupabaseClient, zipName: string, bytes: Uint8Array | ArrayBuffer, folder: string): Promise<Att[]> {
  const files = await unzip(new Blob([bytes as BlobPart])).catch(() => [] as File[]);
  const out: Att[] = [];
  for (const f of files.slice(0, 20)) {
    if (!f.size || f.size > 40 * 1024 * 1024 || /^\./.test(f.name) || isZip(f)) continue;
    const name = `${zipLabel(zipName)}${SEP}${f.name.replace(/\.pdf\.pdf$/i, ".pdf")}`;
    const safe = name.replace(/[^\w.\- ]+/g, "_").slice(-140);
    const path = `${folder}/${Date.now().toString(36)}-${safe}`;
    const type = f.type || typeOf(f.name);
    const { error } = await admin.storage.from("proofs").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: type, upsert: false });
    if (!error) out.push({ name, path, type, size: f.size });
  }
  return out;
}

/** an email's zips not opened yet, opened: the list with their files added (unchanged when there's nothing to open) */
export async function openZips(admin: SupabaseClient, atts: Att[]): Promise<{ atts: Att[]; changed: boolean }> {
  let list = atts, changed = false;
  for (const z of atts.filter(isZip)) {
    if (list.some((x) => x.name.startsWith(zipLabel(z.name) + SEP))) continue;
    const { data } = await admin.storage.from("proofs").download(z.path).catch(() => ({ data: null }));
    if (!data) continue;
    const inner = await saveZipped(admin, z.name, await data.arrayBuffer(), z.path.replace(/\/[^/]*$/, ""));
    if (!inner.length) continue;
    const at = list.indexOf(z);
    list = [...list.slice(0, at + 1), ...inner, ...list.slice(at + 1)];
    changed = true;
  }
  return { atts: list, changed };
}
