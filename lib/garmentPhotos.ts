import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A garment's photos that someone chose on purpose are kept when its supplier is looked up again (Nick, Nov 18 2026:
 * A4N3165 / A4NW3002 got A4.com's own photos in place of SanMar's, "the A4.com images are so much better"). A refresh
 * from S&S, SanMar or One Stop brings new colors, sizes and prices, and replaces a color's photos only when they came
 * from that same supplier. Kept as they are: a color whose photos came from somewhere else (`from`: a4, upload, picked…),
 * a back found or drawn by hand (`back_from` other than the supplier), and the work done on a photo (a traced hood,
 * backs found on the web, when the back was checked).
 */
type Photo = { front?: string; back?: string; side?: string; hex?: string; from?: string; back_from?: string; [k: string]: unknown };
type Photos = Record<string, Photo>;

/** what was done to a photo by hand that a supplier refresh never knows about */
const HAND_KEYS = ["hoodBack", "web_backs", "back_checked"];

export function keepChosenPhotos(cur: Photos | null | undefined, incoming: Photos | null | undefined, supplier: string): { photos: Photos; kept: string[] } {
  const out: Photos = { ...(incoming || {}) }, kept: string[] = [];
  const mine = (from?: string) => !!from && from.toLowerCase() !== supplier.toLowerCase();
  for (const [c, o] of Object.entries(cur || {})) {
    if (!o) continue;
    const n = out[c];
    if (mine(o.from)) { out[c] = { ...(n || {}), ...o }; kept.push(c); continue; }
    if (!n) continue;
    const add: Photo = {};
    if (mine(o.back_from) && o.back) { add.back = o.back; add.back_from = o.back_from; }
    // a traced hood belongs to the back photo it was traced on
    const sameBack = (add.back ?? n.back) === o.back;
    for (const k of HAND_KEYS) if (o[k] != null && n[k] == null && (k !== "hoodBack" || sameBack)) add[k] = o[k];
    if (Object.keys(add).length) out[c] = { ...n, ...add };
  }
  return { photos: out, kept };
}

/**
 * A supplier's garment row about to be saved over the one we have: its color photos merged with the ones chosen on
 * purpose (`keepChosenPhotos`), and the main picture kept when it's one of those. Every supplier refresh goes through it.
 */
export async function withChosenPhotos<T extends Record<string, unknown>>(admin: SupabaseClient, id: string | null | undefined, row: T): Promise<T> {
  if (!id || !row.color_images) return row;
  const { data: g } = await admin.from("garments").select("color_images, image").eq("id", id).maybeSingle();
  if (!g?.color_images) return row;
  const supplier = String(row.supplier || "");
  const { photos, kept } = keepChosenPhotos(g.color_images as Photos, row.color_images as Photos, supplier);
  const curImg = String(g.image || "");
  const keepImg = !!curImg && kept.some((c) => Object.values(photos[c] || {}).includes(curImg));
  return { ...row, color_images: photos, ...(keepImg ? { image: curImg } : {}) };
}
