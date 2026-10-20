"use client";
import { useEffect, useState } from "react";

/**
 * Save PDF / Print for the invoice, work order and art proof. "Save PDF" makes the file right here (each letter page
 * pictured and put in a PDF) and downloads it under one tidy name: "40072 - Methodist Dallas - 2026 Donor Shirts -
 * Proof v1" (Oct 20, Nick: "save to PDF isn't working… normalize the way the PDF is named"). Print uses the same name
 * (the browser's Save as PDF takes it from the page title).
 */
export default function PrintButton({ fileName }: { fileName?: string }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // on a phone the letter-size sheets are shrunk to fit the screen (printing is unchanged)
  useEffect(() => {
    const fit = () => {
      const k = Math.min(1, (window.innerWidth - 16) / 816);
      document.querySelectorAll<HTMLElement>(".pdoc .sheet").forEach((el) => { el.style.zoom = k < 1 ? String(k) : ""; });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => { if (fileName) document.title = fileName; }, [fileName]);

  async function save() {
    setBusy("Making the PDF…"); setErr("");
    const sheets = [...document.querySelectorAll<HTMLElement>(".pdoc .sheet")];
    const zooms = sheets.map((el) => el.style.zoom);
    try {
      // every picture loaded first (the close-ups are repainted in their inks a moment after the page opens)
      await Promise.all([...document.querySelectorAll<HTMLImageElement>(".pdoc img")].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = () => r(null); }))));
      await new Promise((r) => setTimeout(r, 400));
      sheets.forEach((el) => { el.style.zoom = ""; });
      const [{ toJpeg }, { PDFDocument }] = await Promise.all([import("html-to-image"), import("pdf-lib")]);
      const pdf = await PDFDocument.create();
      pdf.setTitle(fileName || document.title);
      for (const [i, el] of sheets.entries()) {
        setBusy(`Page ${i + 1} of ${sheets.length}…`);
        const url = await toJpeg(el, { quality: 0.92, pixelRatio: 2, backgroundColor: "#ffffff", style: { boxShadow: "none", margin: "0" } });
        const img = await pdf.embedJpg(await (await fetch(url)).arrayBuffer());
        // letter (612 × 792 pt); a sheet taller than a page is fitted on it
        const page = pdf.addPage([612, 792]);
        const k = Math.min(612 / img.width, 792 / img.height);
        page.drawImage(img, { x: (612 - img.width * k) / 2, y: 792 - img.height * k, width: img.width * k, height: img.height * k });
      }
      const bytes = await pdf.save();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      a.download = `${fileName || document.title || "document"}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    } catch (e) {
      setErr(`Couldn't make the PDF here (${e instanceof Error ? e.message : String(e)}). Use Print and pick "Save as PDF".`);
    } finally {
      sheets.forEach((el, i) => { el.style.zoom = zooms[i]; });
      setBusy("");
    }
  }

  return (
    <>
      <button className="btn primary" type="button" onClick={save} disabled={!!busy}>{busy || "Save PDF"}</button>
      <button className="btn" type="button" onClick={() => window.print()}>Print</button>
      <button className="btn ghost" type="button" onClick={() => window.close()}>Close</button>
      {err && <span style={{ color: "#b3261e", fontSize: 13, alignSelf: "center" }}>{err}</span>}
    </>
  );
}
