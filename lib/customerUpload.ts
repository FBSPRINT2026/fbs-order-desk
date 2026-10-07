"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PREVIEWABLE_TYPES, type Design } from "@/lib/pricing";
import { cropFileToArt, makePreview } from "@/lib/artPrep";
import { logoUploadUrl, saveMyLogo } from "@/app/portal/request-actions";

function imageSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const u = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); };
    im.onerror = () => { res(null); URL.revokeObjectURL(u); };
    im.src = u;
  });
}

/**
 * A customer uploads a logo from their portal: the original goes straight to storage with a one-time link,
 * files a browser can't show (PDF, AI, HEIC…) get a PNG preview made and uploaded too, then the server records it.
 */
export async function uploadMyLogo(sb: SupabaseClient, f: File, name?: string, opts: { preview?: File; layers?: string; colors?: number; inks?: string } = {}): Promise<{ design: Design; url: string }> {
  // a see-through logo with empty space around it is saved cropped to the art (not designer saves, which bring a preview)
  if (!opts.preview && !opts.layers) f = (await cropFileToArt(f)) || f;
  const t = await logoUploadUrl(f.name);
  if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload failed");
  const up = await sb.storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const direct = PREVIEWABLE_TYPES.test(f.type) && !opts.preview;
  let previewPath: string | undefined;
  let dims = direct ? await imageSize(f) : null;
  if (!direct) {
    const pv = opts.preview || await makePreview(f);
    if (pv) {
      const t2 = await logoUploadUrl(pv.name);
      if (t2.ok && t2.path && t2.token) {
        const u2 = await sb.storage.from("proofs").uploadToSignedUrl(t2.path, t2.token, pv, { contentType: "image/png" });
        if (!u2.error) { previewPath = t2.path; dims = await imageSize(pv); }
      }
    }
  }
  // shirt designer: the editable layers go up as their own file
  let layersPath: string | undefined;
  if (opts.layers) {
    const t3 = await logoUploadUrl("layers.json");
    if (t3.ok && t3.path && t3.token) {
      const u3 = await sb.storage.from("proofs").uploadToSignedUrl(t3.path, t3.token, new Blob([opts.layers], { type: "application/json" }), { contentType: "application/json" });
      if (!u3.error) layersPath = t3.path;
    }
  }
  const r = await saveMyLogo({ path: t.path, fileName: f.name, fileType: f.type, name: name || f.name.replace(/\.[^.]+$/, ""), previewable: direct, previewPath, w: dims?.w, h: dims?.h, layersPath, colors: opts.colors, inks: opts.inks });
  if (!r.ok) throw new Error(r.error);
  return { design: r.design as Design, url: r.url };
}
