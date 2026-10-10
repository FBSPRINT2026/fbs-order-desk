import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Canva, CanvaError } from "@/lib/canva/client";
import { trimPng } from "@/lib/pngTrim";

/**
 * A Canva design → files we keep: the print-quality PDF (vector where the design is vector) and a see-through PNG of
 * page 1 (for the mockup). Both exports run at once; either one alone is still useful, so only when both fail is it an
 * error (the first error, which says why: no access, needs a license…).
 */
export async function exportBoth(c: Canva, designId: string) {
  const d = await c.getDesign(designId); // also the access check: 403 / 404 when Nick's account can't open it
  const [pdf, png] = await Promise.allSettled([c.exportDesign(designId, "pdf"), c.exportDesign(designId, "png")]);
  if (pdf.status === "rejected" && png.status === "rejected") throw pdf.reason instanceof CanvaError ? pdf.reason : png.reason;
  return {
    title: (d.title || "").trim(),
    pages: d.page_count || 1,
    pdf: pdf.status === "fulfilled" ? pdf.value : null,
    png: png.status === "fulfilled" ? png.value : null,
    pdfError: pdf.status === "rejected" ? String((pdf.reason as Error)?.message || pdf.reason) : "",
    pngError: png.status === "rejected" ? String((png.reason as Error)?.message || png.reason) : "",
  };
}

export const fileTitle = (t: string) => (t || "Canva design").replace(/[^\w .()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Canva design";
const safe = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-100);

/**
 * Save a Canva design as one of the customer's designs, the same shape as an uploaded logo (lib/designs.ts): the file
 * is the PDF (the print file, for separations), the preview is the see-through PNG cropped to the art (so it scales to
 * its real print size on the mockup). Without a PDF, the PNG is the file too.
 */
export async function saveCanvaAsDesign(admin: SupabaseClient, opts: { designId: string; customerId: string | null; by: string; method?: string; note?: string }) {
  const c = new Canva(admin);
  const x = await exportBoth(c, opts.designId);
  const name = fileTitle(x.title);
  const key = crypto.randomUUID();
  let preview_path = "", w: number | null = null, h: number | null = null;
  if (x.png) {
    let buf = x.png.buf;
    const t = (() => { try { return trimPng(buf); } catch { return null; } })();
    if (t) { buf = t.buf; w = t.w; h = t.h; }
    else if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
    preview_path = `designs/${key}/${safe(name)}.png`;
    const up = await admin.storage.from("proofs").upload(preview_path, buf, { contentType: "image/png" });
    if (up.error) throw new CanvaError(`Couldn't save the picture: ${up.error.message}`);
  }
  let file_path = preview_path, file_name = `${name}.png`, file_type = "image/png";
  if (x.pdf) {
    file_path = `designs/${key}/${safe(name)}.pdf`; file_name = `${name}.pdf`; file_type = "application/pdf";
    const up = await admin.storage.from("proofs").upload(file_path, x.pdf.buf, { contentType: "application/pdf" });
    if (up.error) throw new CanvaError(`Couldn't save the PDF: ${up.error.message}`);
  }
  const notes = [opts.note || "Made in Canva.", x.pages > 1 ? `The Canva design has ${x.pages} pages: the picture is page 1, the PDF has them all.` : "", !x.pdf ? `No PDF (${x.pdfError}).` : ""].filter(Boolean).join(" ").slice(0, 500);
  const { data, error } = await admin.from("designs").insert({
    customer_id: opts.customerId, name, file_path, file_name, file_type, preview_path,
    width_px: w, height_px: h, method: opts.method || "screen", colors: 1, inks: "", notes, created_by: opts.by || "canva",
    canva_design_id: opts.designId,
  }).select("*").single();
  if (error || !data) throw new CanvaError(`Couldn't save the design: ${error?.message || "unknown"}`);
  return data as { id: string; number: number; name: string };
}
