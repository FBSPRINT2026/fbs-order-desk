import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Canva } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Owner-only test bench (Oct 10) for putting the blank's photo on a Canva design: how Canva places a picture given
 * at create time, and what comes back in the PDF and PNG exports. Nothing here is used by the app.
 *   POST multipart { action: "create", file: PNG }  → asset upload + design the picture's size with it
 *   POST json { action: "inspect", design_id }      → PDF + PNG exports saved under proofs/tmp/canva-lab, with
 *                                                      the PDF's page size and pictures (pdf.js), signed links
 */
async function pdfjs() {
  const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
  return await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<unknown> }> }; OPS: Record<string, number> };
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 401 });
  const admin = createAdminClient();
  const c = new Canva(admin);
  try {
    if ((req.headers.get("content-type") || "").includes("multipart")) {
      const fd = await req.formData();
      const f = fd.get("file") as File | null;
      if (!f) return NextResponse.json({ error: "no file" }, { status: 400 });
      const buf = Buffer.from(await f.arrayBuffer());
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      const t0 = Date.now();
      const assetId = await c.uploadAsset(buf, String(fd.get("name") || "blank"));
      const d = await c.createDesign(w, h, String(fd.get("title") || "Canva lab"), assetId);
      return NextResponse.json({ assetId, w, h, ms: Date.now() - t0, design_id: d.id, edit_url: d.urls?.edit_url });
    }
    const b = (await req.json()) as { action?: string; design_id?: string };
    if (b.action === "content" && b.design_id) {
      // every content stream in the PDF (page and form drawings), decoded: how Canva draws the page
      const pl = await import("pdf-lib");
      const pdf = await c.exportDesign(b.design_id, "pdf");
      const doc = await pl.PDFDocument.load(pdf.buf, { updateMetadata: false });
      const out: { ref: string; kind: string; dict: string; text: string }[] = [];
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof pl.PDFRawStream)) continue;
        const st = obj.dict.get(pl.PDFName.of("Subtype"))?.toString() || "", ty = obj.dict.get(pl.PDFName.of("Type"))?.toString() || "";
        if (st === "/Image" || /Font|Metadata|XRef|ObjStm/.test(ty) || obj.dict.get(pl.PDFName.of("Length1"))) continue;
        let text = "";
        try { text = Buffer.from(pl.decodePDFRawStream(obj).decode()).toString("latin1"); } catch (e) { text = "ERR " + String(e); }
        if (/^\s*$/.test(text)) continue;
        out.push({ ref: ref.toString(), kind: `${ty} ${st}`, dict: obj.dict.toString().slice(0, 300), text: text.slice(0, 2500) });
      }
      return NextResponse.json({ streams: out });
    }
    if (b.action !== "inspect" || !b.design_id) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const [pdf, png] = await Promise.all([c.exportDesign(b.design_id, "pdf"), c.exportDesign(b.design_id, "png")]);
    const key = `tmp/canva-lab/${Date.now()}`;
    await admin.storage.from("proofs").upload(`${key}.pdf`, pdf.buf, { contentType: "application/pdf" });
    await admin.storage.from("proofs").upload(`${key}.png`, png.buf, { contentType: "image/png" });
    const sign = async (p: string) => (await admin.storage.from("proofs").createSignedUrl(p, 3600)).data?.signedUrl || "";
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(pdf.buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const page = await doc.getPage(1) as { view: number[]; getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: { get: (id: string, cb?: (v: unknown) => void) => unknown } };
    const ol = await page.getOperatorList();
    const ops: Record<string, number> = {};
    const images: { i: number; op: string; id: string; w?: number; h?: number; kind?: number; ctm?: number[] }[] = [];
    let ctm: number[] = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const mul = (a: number[], m: number[]) => [a[0] * m[0] + a[1] * m[2], a[0] * m[1] + a[1] * m[3], a[2] * m[0] + a[3] * m[2], a[2] * m[1] + a[3] * m[3], a[4] * m[0] + a[5] * m[2] + m[4], a[4] * m[1] + a[5] * m[3] + m[5]];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const name = Object.keys(lib.OPS).find((k) => lib.OPS[k] === ol.fnArray[i]) || String(ol.fnArray[i]);
      ops[name] = (ops[name] || 0) + 1;
      if (name === "save") stack.push(ctm); else if (name === "restore") ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (name === "transform") ctm = mul(ol.argsArray[i] as number[], ctm);
      if (!/paintImage|paintInlineImage|paintJpeg|ImageMask/.test(name)) continue;
      const id = String((ol.argsArray[i] || [])[0] ?? "");
      const row: (typeof images)[number] = { i, op: name, id, ctm: ctm.map((x) => Math.round(x * 100) / 100) };
      try { const o = await new Promise<{ width: number; height: number; kind: number }>((res, rej) => { const tm = setTimeout(() => rej(new Error("timeout")), 8000); page.objs.get(id, (x) => { clearTimeout(tm); res(x as never); }); }); row.w = o.width; row.h = o.height; row.kind = o.kind; } catch { /* listed without size */ }
      images.push(row);
    }
    return NextResponse.json({ pages: doc.numPages, view: page.view, pdfBytes: pdf.buf.length, pngBytes: png.buf.length, pngW: png.buf.readUInt32BE(16), pngH: png.buf.readUInt32BE(20), ops, images, pdfUrl: await sign(`${key}.pdf`), pngUrl: await sign(`${key}.png`) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.stack || e.message : String(e) }, { status: 500 }); }
}
