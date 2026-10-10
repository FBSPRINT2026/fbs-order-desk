import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Canva, CanvaError, type CanvaAccount } from "@/lib/canva/client";
import { trimPng } from "@/lib/pngTrim";
import { stripBackdrop, type Backdrop } from "@/lib/canva/backdrop";

const msgOf = (e: unknown) => String((e as Error)?.message || e);
const isPng = (b: Buffer) => b.length > 24 && b.readUInt32BE(0) === 0x89504e47;

/**
 * A Canva design → files we keep: the print-quality PDF (vector where the design is vector) and a see-through PNG of
 * page 1 (for the mockup). Both exports run at once.
 *  - The PDF is tried at "pro" quality, then "regular" (pro fails on premium elements the account hasn't bought).
 *  - A see-through PNG needs a paid Canva plan (on Canva Free the export fails). Then: no PNG when there's a PDF
 *    (`needsPreview`: the browser draws the mockup picture from the PDF with a clear page, lib/artPrep makePreview);
 *    without a PDF, a PNG with its background (`opaque`).
 * Only when nothing at all comes back is it an error (the first one, which says why: no access, needs a license…).
 */
export async function exportBoth(c: Canva, designId: string) {
  const d = await c.getDesign(designId); // also the access check: 403 / 404 when the account can't open it
  const access = (e: unknown) => e instanceof CanvaError && e.noAccess;
  const pdfP = c.exportDesign(designId, "pdf").catch((e) => (access(e) ? Promise.reject(e) : c.exportDesign(designId, "pdf", { quality: "regular" })));
  const pngP = c.exportDesign(designId, "png").catch((e) => (access(e) ? Promise.reject(e) : c.exportDesign(designId, "png", { quality: "regular" })));
  const [pdf, png0] = await Promise.allSettled([pdfP, pngP]);
  let png: PromiseSettledResult<Awaited<typeof pngP>> = png0, opaque = false;
  if (pdf.status === "rejected" && png.status === "rejected") {
    if (access(pdf.reason) || access(png.reason)) throw access(pdf.reason) ? pdf.reason : png.reason;
    // no PDF and no see-through PNG (Canva Free): a PNG with its background, so there's at least a picture
    const [flat] = await Promise.allSettled([c.exportDesign(designId, "png", { quality: "regular", transparent: false })]);
    if (flat.status === "rejected") throw pdf.reason instanceof CanvaError ? pdf.reason : flat.reason;
    png = flat; opaque = true;
  }
  return {
    title: (d.title || "").trim(),
    pages: d.page_count || 1,
    pdf: pdf.status === "fulfilled" ? pdf.value : null,
    png: png.status === "fulfilled" ? png.value : null,
    /** the PNG has the design's background (no see-through export on this Canva plan) */
    opaque,
    pdfError: pdf.status === "rejected" ? msgOf(pdf.reason) : "",
    pngError: png0.status === "rejected" ? msgOf(png0.reason) : "",
  };
}

export const fileTitle = (t: string) => (t || "Canva design").replace(/[^\w .()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Canva design";
const safe = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-100);

/**
 * Save a Canva design as one of the customer's designs, the same shape as an uploaded logo (lib/designs.ts): the file
 * is the PDF (the print file, for separations), the preview is the see-through PNG cropped to the art (so it scales to
 * its real print size on the mockup). Without a PDF, the PNG is the file too. Without a see-through PNG (Canva Free),
 * the preview is left empty and `needsPreview` is true: the Mockup Creator draws it from the PDF and sends it to
 * /api/canva/preview.
 */
export async function saveCanvaAsDesign(admin: SupabaseClient, opts: { designId: string; customerId: string | null; by: string; method?: string; note?: string; account?: CanvaAccount; backdrop?: Backdrop | null }) {
  const c = new Canva(admin, opts.account);
  if (opts.backdrop) return saveOnBackdrop(admin, c, { ...opts, backdrop: opts.backdrop });
  const x = await exportBoth(c, opts.designId);
  const name = fileTitle(x.title);
  const key = crypto.randomUUID();
  let preview_path = "", w: number | null = null, h: number | null = null;
  if (x.png) {
    let buf = x.png.buf;
    const t = x.opaque ? null : (() => { try { return trimPng(buf); } catch { return null; } })();
    if (t) { buf = t.buf; w = t.w; h = t.h; }
    else if (isPng(buf)) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
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
  const notes = [
    opts.note || "Made in Canva.",
    x.pages > 1 ? `The Canva design has ${x.pages} pages: the picture is page 1, the PDF has them all.` : "",
    x.opaque ? "The picture has the Canva design's background (the Canva account's plan can't export a see-through PNG): remove the background before printing." : "",
    !x.pdf ? `No PDF (${x.pdfError}).` : "",
  ].filter(Boolean).join(" ").slice(0, 500);
  const { data, error } = await admin.from("designs").insert({
    customer_id: opts.customerId, name, file_path, file_name, file_type, preview_path,
    width_px: w, height_px: h, method: opts.method || "screen", colors: 1, inks: "", notes, created_by: opts.by || "canva",
    canva_design_id: opts.designId,
  }).select("*").single();
  if (error || !data) throw new CanvaError(`Couldn't save the design: ${error?.message || "unknown"}`);
  return { ...(data as { id: string; number: number; name: string }), needsPreview: !preview_path && !!x.pdf };
}

/**
 * A design made on the blank's photo (Design with Canva on the shirt): only the PDF is exported (a PNG would have the
 * shirt in it), the photo is taken out of it (lib/canva/backdrop), and that PDF is the print file. The mockup picture
 * is drawn from it in the browser (`needsPreview`), which also puts the art where it was drawn on the shirt.
 */
async function saveOnBackdrop(admin: SupabaseClient, c: Canva, opts: { designId: string; customerId: string | null; by: string; method?: string; note?: string; backdrop: Backdrop }) {
  const d = await c.getDesign(opts.designId);
  const pdf = await c.exportDesign(opts.designId, "pdf").catch((e) => (e instanceof CanvaError && e.noAccess ? Promise.reject(e) : c.exportDesign(opts.designId, "pdf", { quality: "regular" })));
  const { buf, removed } = await stripBackdrop(pdf.buf, opts.backdrop);
  const name = fileTitle((d.title || "").replace(/^T-shirt · /, ""));
  const key = crypto.randomUUID();
  const file_path = `designs/${key}/${safe(name)}.pdf`;
  const up = await admin.storage.from("proofs").upload(file_path, buf, { contentType: "application/pdf" });
  if (up.error) throw new CanvaError(`Couldn't save the PDF: ${up.error.message}`);
  const notes = [
    opts.note || "Made in Canva.",
    "Designed on the blank's photo in Canva; the photo was taken out of the print file.",
    removed ? "" : "The shirt photo wasn't found in Canva's PDF (deleted or changed in Canva): check the print file has no shirt in it.",
    (d.page_count || 1) > 1 ? `The Canva design has ${d.page_count} pages: the picture is page 1, the PDF has them all.` : "",
  ].filter(Boolean).join(" ").slice(0, 500);
  const { data, error } = await admin.from("designs").insert({
    customer_id: opts.customerId, name, file_path, file_name: `${name}.pdf`, file_type: "application/pdf", preview_path: "",
    width_px: null, height_px: null, method: opts.method || "screen", colors: 1, inks: "", notes, created_by: opts.by || "canva",
    canva_design_id: opts.designId, canva_backdrop: opts.backdrop,
  }).select("*").single();
  if (error || !data) throw new CanvaError(`Couldn't save the design: ${error?.message || "unknown"}`);
  return { ...(data as { id: string; number: number; name: string }), needsPreview: true };
}
