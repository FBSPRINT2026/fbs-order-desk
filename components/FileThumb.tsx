"use client";
import { useEffect, useState } from "react";

const ext = (n: string) => (n.split("?")[0].split(".").pop() || "file").slice(0, 4).toUpperCase();

/**
 * A file's picture (Oct 21, Nick: "files don't show, they just show PDF and XLS"): a PDF / AI shows its first page
 * (drawn in the browser, kept for the visit), a spreadsheet a sheet icon with its type; anything else its type.
 * One piece for every file tile (Nov 2, Nick: the reorder pop-up's PDFs "aren't painting"): Production files, the
 * Create reorder file list, the proof history.
 */
const thumbCache = new Map<string, Promise<string>>();
function pdfThumb(url: string, name: string): Promise<string> {
  if (!thumbCache.has(url)) thumbCache.set(url, (async () => {
    // the first page as it is, the whole page, like a file preview (Oct 23, Nick: "the little thumbnails aren't working
    // like they should"): the art preparer cut a mockup sheet down to a speck); the art preparer stays the fallback
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      try {
        const { openPdf } = await import("@/lib/printavoArt");
        type Doc = { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> } }> };
        const doc = await openPdf(buf.slice(0)) as unknown as Doc;
        const pg = await doc.getPage(1), v1 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: 420 / Math.max(v1.width, v1.height) });
        const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(255,255,255,1)" }).promise;
        return c.toDataURL("image/jpeg", 0.85);
      } catch {
        const { makePreview } = await import("@/lib/artPrep");
        const png = await makePreview(new File([buf], name, { type: "application/pdf" }), 360);
        return png ? URL.createObjectURL(png) : "";
      }
    } catch { return ""; }
  })());
  return thumbCache.get(url)!;
}
export default function FileThumb({ name, url, mime }: { name: string; url?: string; mime?: string }) {
  const [u, setU] = useState("");
  const pdf = /\.(pdf|ai)$/i.test(name) || /pdf/i.test(mime || "");
  const pic = /\.(png|jpe?g|gif|webp|svg)$/i.test(name) || /^image\//i.test(mime || "");
  const sheet = /\.(xlsx?|csv|numbers)$/i.test(name) || /sheet|excel|csv/i.test(mime || "");
  useEffect(() => { let off = false; if (pdf && url) void pdfThumb(url, name).then((x) => { if (!off) setU(x); }); return () => { off = true; }; }, [pdf, url, name]);
  // eslint-disable-next-line @next/next/no-img-element
  if (u) return <img src={u} alt={name} className="prod-page" />;
  // a picture shows itself (Nov 2: the portal's Attachments)
  if (pic && url) return <img src={url} alt={name} className="prod-page" loading="lazy" />;
  if (sheet) return <span className="prod-sheet" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><b>{ext(name)}</b></span>;
  return <span>{ext(name)}</span>;
}
