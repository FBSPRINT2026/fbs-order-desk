"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectColors } from "@/lib/inkColors";

/**
 * Art fixes an account manager asks for in plain words, made without Illustrator (Oct 23, Nick on McKenna's HUD 102026:
 * "there's that gray black, it's not the same black… and when you zoom in, there's an extra white line around the
 * interior circle… I don't want my account manager to have to open up Illustrator"). Each one works on the logo's
 * picture and saves it as the logo's file; the file it came from is kept (specs.original), and what was done is listed
 * (specs.artFixes) so the proof and the work order can say it.
 *   - one_black: every near-black (a gray-black like #231F20 next to pure black) becomes one solid black
 *   - flatten: every pixel becomes one of the logo's own solid colors, or the shirt (left out); no shading, no soft edge
 *   - remove_hairline: a line or gap too thin to print (under about 0.025" at the print's size) is filled in with what's
 *     around it
 */
export type ArtAction = "one_black" | "flatten" | "remove_hairline" | "distress";

const hexRgb = (h: string) => { const v = h.replace("#", ""); return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0]; };

/** any of a mask's pixels within r (a square) */
function dilate(m: Uint8Array, W: number, H: number, r: number) {
  const a = new Uint8Array(W * H), b = new Uint8Array(W * H), pre = new Int32Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    pre[0] = 0; for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + m[y * W + x];
    for (let x = 0; x < W; x++) a[y * W + x] = pre[Math.min(W, x + r + 1)] - pre[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < W; x++) {
    pre[0] = 0; for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + a[y * W + x];
    for (let y = 0; y < H; y++) b[y * W + x] = pre[Math.min(H, y + r + 1)] - pre[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return b;
}
/** what's left of a mask after an opening of r: anything thinner than about 2r is gone */
function opened(m: Uint8Array, W: number, H: number, r: number) {
  const inv = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const er = dilate(inv, W, H, r); for (let i = 0; i < er.length; i++) er[i] = er[i] ? 0 : 1; // eroded
  return dilate(er, W, H, r);
}

/** the fixes on a picture (in place); palette = the logo's colors, shirt = the shirt's (left out) */
export function fixPixels(img: ImageData, actions: ArtAction[], o: { palette: string[]; shirt?: string; ppi: number }) {
  const { width: W, height: H, data: d } = img;
  const pal = o.palette.map(hexRgb);
  // one black: near-blacks are pure black (and black is one of the colors)
  if (actions.includes("one_black")) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx < 70 && mx - mn < 24) { d[i] = d[i + 1] = d[i + 2] = 0; }
    }
    for (const p of pal) { const mx = Math.max(...p), mn = Math.min(...p); if (mx < 70 && mx - mn < 24) { p[0] = p[1] = p[2] = 0; } }
    if (!pal.some((p) => p[0] + p[1] + p[2] === 0) && pal.some((p) => Math.max(...p) < 70)) pal.push([0, 0, 0]);
  }
  if (!actions.includes("flatten") && !actions.includes("remove_hairline")) return;
  // every pixel one of the colors (or the shirt / see-through: -1)
  const cand = pal.map((p, k) => ({ p, k }));
  const shirt = o.shirt && /^#?[0-9a-f]{6}$/i.test(o.shirt) ? hexRgb(o.shirt) : null;
  const cls = new Int16Array(W * H), cache = new Map<number, number>();
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (d[i + 3] < 128) { cls[j] = -1; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let c = cache.get(key);
    if (c === undefined) {
      let best = -1, bd = Infinity;
      for (const { p, k } of cand) { const dd = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
      if (shirt) { const dd = (d[i] - shirt[0]) ** 2 + (d[i + 1] - shirt[1]) ** 2 + (d[i + 2] - shirt[2]) ** 2; if (dd < bd) best = -1; }
      c = best; cache.set(key, c);
    }
    cls[j] = c;
  }
  // a hairline: any color (or gap) thinner than about 0.025" at the print's size is given what's around it
  if (actions.includes("remove_hairline")) {
    // up to about 0.025" wide (Oct 23: Hudson's white outline was 6 px at 292 px an inch, 0.02", and 0.008 left it)
    const r = Math.max(1, Math.round(0.0125 * o.ppi));
    const gone = new Uint8Array(W * H);
    for (let k = -1; k < pal.length; k++) {
      const m = new Uint8Array(W * H); let any = false;
      for (let j = 0; j < m.length; j++) if (cls[j] === k) { m[j] = 1; any = true; }
      if (!any) continue;
      const op = opened(m, W, H, r);
      for (let j = 0; j < m.length; j++) if (m[j] && !op[j]) gone[j] = 1;
    }
    const out = cls.slice();
    const R = r + 1;
    for (let j = 0; j < gone.length; j++) {
      if (!gone[j]) continue;
      const x = j % W, y = (j / W) | 0, cnt = new Map<number, number>();
      for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
        const q = yy * W + xx; if (gone[q] || cls[q] === cls[j]) continue;
        cnt.set(cls[q], (cnt.get(cls[q]) || 0) + 1);
      }
      let best = cls[j], bn = 0; for (const [c, n] of cnt) if (n > bn) { bn = n; best = c; }
      out[j] = best;
    }
    cls.set(out);
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const c = cls[j];
    if (c < 0) { d[i + 3] = 0; continue; }
    const p = pal[c]; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
}

/** the fixes on a logo (a design), saved as its file; the file before is kept */
export async function fixDesignArt(sb: SupabaseClient, designId: string, actions: ArtAction[], o: { shirt?: string; widthIn?: number; say?: string[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: d, error } = await sb.from("designs").select("id, customer_id, name, file_path, file_name, file_type, preview_path, width_px, height_px, print_plan, specs").eq("id", designId).maybeSingle();
  if (error || !d) return { ok: false, error: "The logo wasn't found." };
  const path = (d.preview_path as string) || (d.file_path as string);
  if (!/\.(png|jpe?g|webp)$/i.test(path)) return { ok: false, error: "This logo has no picture to change here; the art department can do it." };
  const { data: su } = await sb.storage.from("proofs").createSignedUrl(path, 600);
  if (!su?.signedUrl) return { ok: false, error: "Couldn't open the logo." };
  const im = new Image(); im.crossOrigin = "anonymous"; im.src = su.signedUrl;
  try { await im.decode(); } catch { return { ok: false, error: "Couldn't open the logo." }; }
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(im, 0, 0);
  const img = x.getImageData(0, 0, W, H);
  // the logo's own colors: its print plan's inks (the colors in the art), else the main colors found in it
  const plan = d.print_plan as { inks?: { hex: string }[] } | null;
  let palette = (plan?.inks || []).map((k) => k.hex).filter((h) => /^#?[0-9a-f]{6}$/i.test(h || ""));
  if (!palette.length) palette = detectColors(im, 6).filter((k) => k.share > 0.02).map((k) => k.hex);
  if (!palette.length) return { ok: false, error: "Couldn't tell the logo's colors." };
  fixPixels(img, actions, { palette, shirt: o.shirt, ppi: W / Math.max(1, o.widthIn || 11) });
  x.putImageData(img, 0, 0);
  let blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) return { ok: false, error: "Couldn't save the changed logo." };
  // the customer's own distress texture laid over it, the shirt showing through (Oct 23, Nick on Peticolas: "apply the
  // Peticolas Distressed mask to this mockup"); their mask is in their brand standards (Mockup Creator → save it)
  let clean: string | null = null;
  if (actions.includes("distress")) {
    const { data: cu } = await sb.from("customers").select("brand_print").eq("id", d.customer_id as string).maybeSingle();
    const dm = ((cu?.brand_print || {}) as { distress?: { path?: string } }).distress;
    if (!dm?.path) return { ok: false, error: "This customer has no distress mask saved yet. Save one from a distressed logo in the Mockup Creator (Helper → save as their mask)." };
    const { data: ms } = await sb.storage.from("proofs").createSignedUrl(dm.path, 600);
    if (!ms?.signedUrl) return { ok: false, error: "Couldn't open their distress mask." };
    const { applyDistress } = await import("@/lib/distress");
    clean = path;
    blob = await applyDistress(blob, ms.signedUrl, { layers: 1, fit: "cover", name: "distressed.png" });
  }
  const base = String(d.file_name || d.name || "art").replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "art";
  const fp = `designs/${crypto.randomUUID()}/${base}-fixed.png`;
  const up = await sb.storage.from("proofs").upload(fp, blob, { contentType: "image/png" });
  if (up.error) return { ok: false, error: up.error.message };
  const specs = (d.specs || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const next = { ...specs,
    original: specs.original || { path: d.file_path, name: d.file_name, type: d.file_type, preview: d.preview_path },
    artFixes: [...((specs.artFixes as unknown[]) || []), { at: now, actions, say: o.say || [] }].slice(-10),
    ...(clean ? { distressed: true, cleanPreview: (specs.cleanPreview as string) || clean } : {}) };
  const { error: e2 } = await sb.from("designs").update({ file_path: fp, file_name: `${base}-fixed.png`, file_type: "image/png", preview_path: fp, width_px: W, height_px: H, art_box: null, print_plan: null, specs: next }).eq("id", designId);
  if (e2) return { ok: false, error: e2.message };
  return { ok: true };
}
