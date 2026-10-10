import "server-only";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

/** The blank's photo under a Canva design (Design with Canva on the shirt), as the Mockup Creator made it. */
export type Backdrop = { w: number; h: number; k: number; view: "front" | "back"; z: number; tx: number; ty: number };

/** A backdrop sent by the browser, checked (numbers in range), or null. */
export function backdropOf(v: unknown): Backdrop | null {
  const b = (v || {}) as Record<string, unknown>;
  const n = (k: string, lo: number, hi: number) => { const x = Number(b[k]); return Number.isFinite(x) && x >= lo && x <= hi ? x : NaN; };
  const o = { w: n("w", 40, 8000), h: n("h", 40, 8000), k: n("k", 0.1, 20), z: n("z", 0.1, 10), tx: n("tx", -10000, 10000), ty: n("ty", -10000, 10000) };
  if (Object.values(o).some((x) => Number.isNaN(x)) || (b.view !== "front" && b.view !== "back")) return null;
  return { ...o, w: Math.round(o.w), h: Math.round(o.h), view: b.view };
}

/**
 * Take the blank's photo out of Canva's PDF of the design, leaving only what the customer made (vector stays vector).
 * Canva puts the picture we gave it in the PDF as one image the same size in pixels (seen Oct 10: 2000 × 2500 in,
 * 2000 × 2500 image out); that image is swapped for an empty drawing, so nothing else in the file moves. If Canva
 * scaled it, an image of the same shape at least half the size counts. Returns how many were taken out (0: the
 * customer deleted the shirt, or Canva merged it into something else: the PDF is returned as it was).
 */
export async function stripBackdrop(pdf: Buffer, bd: { w: number; h: number }): Promise<{ buf: Buffer; removed: number }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;
  const num = (v: unknown) => { const x = v instanceof PDFRef ? ctx.lookup(v) : v; return x instanceof PDFNumber ? x.asNumber() : NaN; };
  const hits: PDFRef[] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const st = obj.dict.get(PDFName.of("Subtype"));
    if (!st || st.toString() !== "/Image") continue;
    const w = num(obj.dict.get(PDFName.of("Width"))), h = num(obj.dict.get(PDFName.of("Height")));
    const exact = w === bd.w && h === bd.h;
    const same = w >= bd.w / 2 && Math.abs(w / h - bd.w / bd.h) < 0.005;
    if (exact || same) hits.push(ref);
  }
  // exact matches first; a scaled one only when there's no exact one
  const exact = hits.filter((r) => { const o = ctx.lookup(r) as PDFRawStream; return num(o.dict.get(PDFName.of("Width"))) === bd.w && num(o.dict.get(PDFName.of("Height"))) === bd.h; });
  const take = exact.length ? exact : hits.slice(0, 1);
  if (!take.length) return { buf: pdf, removed: 0 };
  for (const ref of take) ctx.assign(ref, ctx.stream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1] }));
  // Canva's page background: a rectangle exactly the canvas size, filled (white unless they picked a color), drawn
  // under everything ("0 0 3000 3750 re f", seen Oct 10). The shirt is the background now, so it's not painted.
  const W = String(bd.w), H = String(bd.h);
  const pageRect = new RegExp(`(^|\\s)0 0 ${W}(?:\\.0+)? ${H}(?:\\.0+)? re(\\s+)f\\*?(?=\\s)`, "g");
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const st = obj.dict.get(PDFName.of("Subtype"))?.toString() || "", ty = obj.dict.get(PDFName.of("Type"))?.toString() || "";
    if (st === "/Image" || /Font|Metadata|XRef|ObjStm/.test(ty) || obj.dict.get(PDFName.of("Length1"))) continue;
    let text: string;
    try { text = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1"); } catch { continue; }
    if (!text.includes(" re")) continue;
    const next = text.replace(pageRect, "$10 0 " + W + " " + H + " re$2n");
    if (next === text) continue;
    const ns = ctx.flateStream(Buffer.from(next, "latin1"));
    for (const [k, v] of obj.dict.entries()) if (!["/Length", "/Filter", "/DecodeParms"].includes(k.toString())) ns.dict.set(k, v);
    ctx.assign(ref, ns);
  }
  return { buf: Buffer.from(await doc.save({ useObjectStreams: false })), removed: take.length };
}
