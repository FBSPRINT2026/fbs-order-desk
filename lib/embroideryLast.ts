import type { SupabaseClient } from "@supabase/supabase-js";
import type { Imprint } from "@/lib/pricing";

/**
 * What an embroidered logo was last sewn with, kept on the logo (designs.specs.embroidery.last) so a reorder starts from
 * it (Oct 23, Nick: "hey, we need to redo this Gateway Church logo. Oh, we did it 2 weeks ago. What thread did we use?
 * And, you know, what backing?"). Written when the order is saved from the Mockup Creator.
 */
export type EmbLast = { order: number; at: string; location: string; size: string; threads: string; stitches?: number; backing?: string; topping?: string; puff?: boolean; metallic?: boolean; line?: string; garment?: string; file?: string };
export async function rememberEmbroidery(sb: SupabaseClient, im: Imprint, orderNumber: number, garment: string) {
  if (im.method !== "embroidery" || !im.design_id) return;
  const { data } = await sb.from("designs").select("specs").eq("id", im.design_id).maybeSingle();
  const sp = (data?.specs || {}) as Record<string, unknown>;
  const emb = (sp.embroidery || {}) as Record<string, unknown>;
  const e = im.emb || {};
  const last: EmbLast = { order: orderNumber, at: new Date().toISOString(), location: im.location, size: im.size || "", threads: im.inks || "", stitches: im.stitches, backing: e.backing, topping: e.topping, puff: e.puff, metallic: e.metallic, line: e.line, garment, file: e.file?.name };
  await sb.from("designs").update({ specs: { ...sp, embroidery: { ...emb, last } } }).eq("id", im.design_id);
}
export const lastOf = (specs: unknown): EmbLast | null => ((specs as { embroidery?: { last?: EmbLast } } | null)?.embroidery?.last) || null;
