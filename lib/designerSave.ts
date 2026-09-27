"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Design } from "@/lib/pricing";
import type { DesignDoc } from "@/lib/designerArt";
import type { DesignerOut } from "@/components/ShirtDesigner";
import { uploadDesign } from "@/lib/designs";
import { uploadMyLogo } from "@/lib/customerUpload";
import { myDesignerDoc } from "@/app/portal/request-actions";

/**
 * Save what the shirt designer made as a logo on the customer's account:
 * the SVG is the art file, the PNG is the preview (mockups), and the editable layers go in their own file.
 * Staff save straight to storage; customers go through the portal's one-time upload links.
 */
export async function saveDesignerLogo(sb: SupabaseClient, out: DesignerOut, who: { portal: boolean; customerId?: string; by?: string }): Promise<{ design: Design; url: string }> {
  const layers = JSON.stringify(out.doc);
  if (who.portal) return uploadMyLogo(sb, out.svg, out.name, { preview: out.png, layers, colors: out.colors, inks: out.inks });
  if (!who.customerId) throw new Error("Pick the customer first. The design is saved to their account.");
  const d = await uploadDesign(sb, { file: out.svg, preview: out.png, customer_id: who.customerId, name: out.name, colors: out.colors, inks: out.inks, notes: "Made in the shirt designer", by: who.by });
  const path = d.file_path.replace(/\/[^/]+$/, "/layers.json");
  const up = await sb.storage.from("proofs").upload(path, new Blob([layers], { type: "application/json" }), { contentType: "application/json" });
  let design = d;
  if (!up.error) {
    const { data } = await sb.from("designs").update({ designer: { file: path } }).eq("id", d.id).select("*").single();
    if (data) design = data as Design;
  }
  const { data: sg } = await sb.storage.from("proofs").createSignedUrl(design.preview_path, 3600);
  return { design, url: sg?.signedUrl || "" };
}

/** The editable layers of a logo made in the designer (null for uploaded art). */
export async function loadDesignerDoc(sb: SupabaseClient, d: Design, portal: boolean): Promise<DesignDoc | null> {
  if (!d.designer?.file) return null;
  try {
    let url = "";
    if (portal) { const r = await myDesignerDoc(d.id); if (r.ok) url = r.url; }
    else { const { data } = await sb.storage.from("proofs").createSignedUrl(d.designer.file, 600); url = data?.signedUrl || ""; }
    if (!url) return null;
    const doc = (await (await fetch(url)).json()) as DesignDoc;
    return doc && Array.isArray(doc.layers) ? doc : null;
  } catch { return null; }
}
