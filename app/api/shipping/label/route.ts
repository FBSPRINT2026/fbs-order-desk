import { NextResponse } from "next/server";
import { PDFDocument, degrees } from "pdf-lib";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { labelPng, shipmentIdByTracking } from "@/lib/easypost";
import type { Box } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const W = 288, H = 432; // 4 × 6 inches in points

/**
 * A bought label as a 4×6 PDF (Nick, Nov 19 2026: "just make the PDF actually 4 x 6"): FedEx's PDF is a letter page with
 * the label in its top-left corner. Made from the label's 4×6 picture; when there isn't one, the letter page's top-left
 * corner is cut out to 4×6. GET ?s=<shipment id>&b=<box, from 1>. Costs nothing.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const u = new URL(req.url), sid = u.searchParams.get("s") || "", n = Math.max(1, Math.round(+(u.searchParams.get("b") || 1)));
  const admin = createAdminClient();
  const { data: sh } = await admin.from("shipments").select("id, boxes").eq("id", sid).maybeSingle();
  const boxes = ((sh?.boxes || []) as Box[]).filter((x) => (x.tracking || "").trim());
  const box = boxes[n - 1];
  if (!sh || !box) return NextResponse.json({ error: "No label for that box." }, { status: 404 });
  const out = await PDFDocument.create();
  const page = out.addPage([W, H]);
  try {
    // the 4×6 picture of the label
    const epId = box.ep_id || (await shipmentIdByTracking(box.tracking!));
    if (epId && !box.ep_id) { const nb = ((sh.boxes || []) as Box[]).map((x) => (x.tracking === box.tracking ? { ...x, ep_id: epId } : x)); await admin.from("shipments").update({ boxes: nb }).eq("id", sid); }
    const png = epId ? await labelPng(epId) : null;
    if (png) {
      const img = await out.embedPng(png);
      if (img.width > img.height) page.drawImage(img, { x: W, y: 0, width: H, height: W, rotate: degrees(90) });
      else page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    } else {
      // no picture: the PDF's top-left corner, cut to 4×6 (the label sits there on FedEx's letter page)
      if (!box.label_url) throw new Error("No label file for that box.");
      const src = await PDFDocument.load(await (await fetch(box.label_url, { cache: "no-store" })).arrayBuffer());
      const p0 = src.getPage(0), { width: pw, height: ph } = p0.getSize();
      if (pw <= W + 20 && ph <= H + 20) { const [e] = await out.embedPdf(src, [0]); page.drawPage(e, { x: 0, y: 0, width: W, height: H }); }
      else {
        // the label's 4×6 plus the page's quarter-inch margin, scaled to fit
        const bw = 4.5 * 72, bh = 6.5 * 72;
        const e = await out.embedPage(p0, { left: 0, bottom: ph - bh, right: bw, top: ph });
        const k = Math.min(W / bw, H / bh);
        page.drawPage(e, { x: (W - bw * k) / 2, y: (H - bh * k) / 2, width: bw * k, height: bh * k });
      }
    }
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  const bytes = await out.save();
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-${box.tracking}.pdf"`, "Cache-Control": "private, max-age=300" } });
}
