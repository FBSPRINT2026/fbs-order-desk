"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Design } from "@/lib/pricing";
import { cropFileToArt, makePreview } from "@/lib/artPrep";

/** Files the browser can draw as a preview. AI / EPS / PDF originals need a separate preview image. */
export const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;
export const DESIGN_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd,.dst,.heic,.heif,.tif,.tiff,.bmp";

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
export async function uploadDesign(sb: SupabaseClient, opts: { file: File; preview?: File | null; customer_id: string | null; name?: string; colors?: number; inks?: string; notes?: string; method?: string; by?: string; /** made by the portal for an order: kept out of the customer's library until the order is sent or approved (migration 166) */ draft?: boolean }): Promise<Design> {
  // a see-through logo with empty space around it is saved cropped to the art, so it scales to its real print size
  if (!opts.preview) { const cropped = await cropFileToArt(opts.file); if (cropped) opts = { ...opts, file: cropped }; }
  const key = crypto.randomUUID();
  const orig = `designs/${key}/${safe(opts.file.name)}`;
  const up = await sb.storage.from("proofs").upload(orig, opts.file, { contentType: opts.file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  // files a browser can't draw (PDF, AI, HEIC, TIFF…) get a PNG preview made automatically when none was given
  // and cropped to the art (Oct 16, Nick: a PDF logo came in as the whole page, the art small in the middle)
  const made0 = !PREVIEWABLE.test(opts.file.type) && !opts.preview ? await makePreview(opts.file) : null;
  const made = made0 ? (await cropFileToArt(made0)) || made0 : null;
  // a preview that was handed in wins (the shirt designer saves an SVG with a PNG preview)
  const pv = opts.preview && PREVIEWABLE.test(opts.preview.type) ? opts.preview : PREVIEWABLE.test(opts.file.type) ? opts.file : made;
  let preview_path = "";
  if (pv === opts.file) preview_path = orig;
  else if (pv) {
    preview_path = `designs/${key}/preview-${safe(pv.name)}`;
    const u2 = await sb.storage.from("proofs").upload(preview_path, pv, { contentType: pv.type });
    if (u2.error) preview_path = "";
  }
  const dims = pv ? await imageSize(pv) : null;
  // a distress layer in the file (Oct 16): the logo is marked distressed (brand standards can print those as a fashion hit)
  // and a clean picture without it, for "Distress: off" in the Mockup Creator (the distress stays a layer, on or off)
  let distressed = false, cleanPreview = "";
  if (/pdf/i.test(opts.file.type) || /\.(pdf|ai)$/i.test(opts.file.name)) {
    try {
      const { parsePdf, browserInflate } = await import("./pdfVector");
      const v = await parsePdf(new Uint8Array(await opts.file.arrayBuffer()), browserInflate);
      distressed = !!v.distress?.length;
      if (distressed && v.shapes.length) {
        const { vartFile } = await import("./artPrep");
        const f0 = await vartFile({ ...v, distress: undefined }, 2400, "clean.png"), f = f0 ? (await cropFileToArt(f0)) || f0 : null;
        if (f) { const path = `designs/${key}/clean-${safe(opts.file.name.replace(/\.[^.]+$/, ""))}.png`; const u = await sb.storage.from("proofs").upload(path, f, { contentType: "image/png" }); if (!u.error) cleanPreview = path; }
      }
    } catch { /* not readable as shapes */ }
  }
  const { data, error } = await sb.from("designs").insert({
    customer_id: opts.customer_id, name: (opts.name || opts.file.name.replace(/\.[^.]+$/, "")).trim(),
    file_path: orig, file_name: opts.file.name, file_type: opts.file.type || "", preview_path,
    width_px: dims?.w || null, height_px: dims?.h || null, method: opts.method || "screen",
    colors: opts.colors || 1, inks: opts.inks || "", notes: opts.notes || "", created_by: opts.by || "", draft: !!opts.draft,
    ...(distressed ? { specs: { distressed: true, distressLayer: true, ...(cleanPreview ? { cleanPreview } : {}) } } : {}),
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
  // and each background's own picture (Edit logo → Backgrounds), keyed by its path
  const bgPaths = [...list.flatMap((d) => ((d.specs?.onShirts || []) as { path?: string }[]).map((b) => b.path || "").filter(Boolean)),
    // and the clean picture of a distressed logo (Distress: off)
    ...list.map((d) => (d.specs?.cleanPreview as string | undefined) || "").filter(Boolean)];
  if (!withPv.length && !bgPaths.length) return {};
  const { data } = await sb.storage.from("proofs").createSignedUrls([...withPv.map((d) => d.preview_path), ...bgPaths], 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((r, i) => { if (r.signedUrl) out[i < withPv.length ? withPv[i].id : bgPaths[i - withPv.length]] = r.signedUrl; });
  for (const d of list) { const cp = d.specs?.cleanPreview as string | undefined; if (cp && out[cp]) out[d.id + ":clean"] = out[cp]; }
  return out;
}

/**
 * Logos whose picture still has empty space around the art (PDF / .ai pictures made before Oct 16 were the whole page):
 * cropped to the art once, the new picture saved, the logo marked so it isn't checked again. Returns the logos changed.
 */
export async function cropPreviews(sb: SupabaseClient, list: Design[], max = 30): Promise<Design[]> {
  const todo = list.filter((d) => d.preview_path && !d.archived_at && !d.specs?.cropped && /\.png$/i.test(d.preview_path)).slice(0, max);
  const out: Design[] = [];
  for (const d of todo) {
    try {
      const { data: blob } = await sb.storage.from("proofs").download(d.preview_path);
      if (!blob) continue;
      const cropped = await cropFileToArt(new File([blob], "preview.png", { type: "image/png" }));
      const specs = { ...(d.specs || {}), cropped: true };
      if (!cropped) { await sb.from("designs").update({ specs }).eq("id", d.id); continue; }
      const path = `designs/${d.id}-${crypto.randomUUID().slice(0, 8)}/preview-cropped.png`;
      const up = await sb.storage.from("proofs").upload(path, cropped, { contentType: "image/png" });
      if (up.error) continue;
      const dims = await imageSize(cropped);
      // the original file stays as it is; only the picture (what the cards, mockups and separations show) is cropped
      const patch = { preview_path: path, width_px: dims?.w || d.width_px, height_px: dims?.h || d.height_px, art_box: null, specs };
      const { error } = await sb.from("designs").update(patch).eq("id", d.id);
      if (!error) out.push({ ...d, ...patch } as Design);
    } catch { /* leave it as it is */ }
  }
  return out;
}
