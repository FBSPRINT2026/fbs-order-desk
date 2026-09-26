"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Design } from "@/lib/pricing";

/** Files the browser can draw as a preview. AI / EPS / PDF originals need a separate preview image. */
export const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;
export const DESIGN_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd,.dst";

function imageSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 }); URL.revokeObjectURL(url); };
    img.onerror = () => { res(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

const safe = (n: string) => n.replace(/[^\w.\-]+/g, "_");

/** Upload customer art as a new design (original file + preview) and return the saved record. */
export async function uploadDesign(sb: SupabaseClient, opts: { file: File; preview?: File | null; customer_id: string | null; name?: string; colors?: number; inks?: string; notes?: string; method?: string; by?: string }): Promise<Design> {
  const key = crypto.randomUUID();
  const orig = `designs/${key}/${safe(opts.file.name)}`;
  const up = await sb.storage.from("proofs").upload(orig, opts.file, { contentType: opts.file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const pv = PREVIEWABLE.test(opts.file.type) ? opts.file : opts.preview && PREVIEWABLE.test(opts.preview.type) ? opts.preview : null;
  let preview_path = "";
  if (pv === opts.file) preview_path = orig;
  else if (pv) {
    preview_path = `designs/${key}/preview-${safe(pv.name)}`;
    const u2 = await sb.storage.from("proofs").upload(preview_path, pv, { contentType: pv.type });
    if (u2.error) preview_path = "";
  }
  const dims = pv ? await imageSize(pv) : null;
  const { data, error } = await sb.from("designs").insert({
    customer_id: opts.customer_id, name: (opts.name || opts.file.name.replace(/\.[^.]+$/, "")).trim(),
    file_path: orig, file_name: opts.file.name, file_type: opts.file.type || "", preview_path,
    width_px: dims?.w || null, height_px: dims?.h || null, method: opts.method || "screen",
    colors: opts.colors || 1, inks: opts.inks || "", notes: opts.notes || "", created_by: opts.by || "",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as Design;
}

/** Replace a design's preview image (keeps the original file). */
export async function setDesignPreview(sb: SupabaseClient, d: Design, f: File): Promise<Design> {
  const path = `designs/${d.id}-${crypto.randomUUID().slice(0, 8)}/preview-${safe(f.name)}`;
  const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type });
  if (up.error) throw new Error(up.error.message);
  const dims = await imageSize(f);
  const { data, error } = await sb.from("designs").update({ preview_path: path, width_px: dims?.w || null, height_px: dims?.h || null }).eq("id", d.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Design;
}

/** Signed links for design previews, keyed by design id. */
export async function previewUrls(sb: SupabaseClient, list: Design[]): Promise<Record<string, string>> {
  const withPv = list.filter((d) => d.preview_path);
  if (!withPv.length) return {};
  const { data } = await sb.storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((r, i) => { if (r.signedUrl) out[withPv[i].id] = r.signedUrl; });
  return out;
}
