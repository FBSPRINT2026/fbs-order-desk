"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The price sheet's buttons (hidden on paper). Save PDF downloads the whole sheet as ONE long PDF page, nothing split
 * (Nov 4, Nick: "just put all the pricing on one page and just say save PDF… that should just download one long PDF
 * page"): the page is drawn into a picture in the browser (html-to-image) and placed on a single page its own size
 * (pdf-lib). Print uses the paper layout: screen printing on the front, embroidery and DTF on the back.
 * ?save=1 (the portal's Save PDF button) saves as soon as the sheet is ready.
 */
export default function SheetPrint({ auto, name }: { auto: boolean; /** the file's name */ name: string }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const done = useRef(false);
  const save = useCallback(async () => {
    const page = document.querySelector(".pls-page") as HTMLElement | null;
    if (!page) return;
    setBusy(true); setErr("");
    try {
      await document.fonts?.ready;
      const [{ toPng }, { PDFDocument }] = await Promise.all([import("html-to-image"), import("pdf-lib")]);
      const w = page.offsetWidth, h = page.offsetHeight;
      // the copy is drawn without the page's centering margin and shadow, or it lands shifted half off the picture
      const png = await toPng(page, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, width: w, height: h, style: { margin: "0", boxShadow: "none", borderRadius: "0", transform: "none" } });
      const pdf = await PDFDocument.create();
      const img = await pdf.embedPng(png);
      // 96 css px = 72 pt: one page exactly the sheet's size
      const pw = (w * 72) / 96, ph = (h * 72) / 96;
      pdf.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
      pdf.setTitle(name);
      const bytes = await pdf.save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${name}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make the PDF. Try again."); }
    setBusy(false);
  }, [name]);
  useEffect(() => { if (auto && !done.current) { done.current = true; const t = setTimeout(() => void save(), 700); return () => clearTimeout(t); } }, [auto, save]);
  return (
    <div className="pls-bar">
      {err && <span className="pls-err">{err}</span>}
      <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save PDF"}</button>
    </div>
  );
}
