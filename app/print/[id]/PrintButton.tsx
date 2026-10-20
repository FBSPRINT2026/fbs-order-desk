"use client";
import { useEffect, useState } from "react";

/**
 * Save PDF / Print for the invoice, work order and art proof. "Save PDF" makes the file right here (each letter page
 * pictured and put in a PDF) and downloads it under one tidy name: "40072 - Methodist Dallas - 2026 Donor Shirts -
 * Proof v1" (Oct 20, Nick: "save to PDF isn't working… normalize the way the PDF is named"). Print uses the same name
 * (the browser's Save as PDF takes it from the page title).
 */
/** where an image's picture really shows (object-fit: contain, cropped by a box around it), in page pixels, and which
 *  part of the picture that is (fractions of its natural size) */
function visibleRect(im: HTMLImageElement) {
  const b = im.getBoundingClientRect();
  const nw = im.naturalWidth, nh = im.naturalHeight;
  let x = b.left, y = b.top, w = b.width, h = b.height;
  if (getComputedStyle(im).objectFit === "contain") { const k = Math.min(b.width / nw, b.height / nh); w = nw * k; h = nh * k; x = b.left + (b.width - w) / 2; y = b.top + (b.height - h) / 2; }
  // cut by an ancestor that hides what's outside it (the art cropped to its art box)
  let cx0 = x, cy0 = y, cx1 = x + w, cy1 = y + h;
  for (let p = im.parentElement; p && !p.classList.contains("sheet"); p = p.parentElement) {
    if (getComputedStyle(p).overflow === "hidden") { const q = p.getBoundingClientRect(); cx0 = Math.max(cx0, q.left); cy0 = Math.max(cy0, q.top); cx1 = Math.min(cx1, q.right); cy1 = Math.min(cy1, q.bottom); }
  }
  if (cx1 - cx0 < 2 || cy1 - cy0 < 2) return null;
  return { dest: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 }, src: { fx: (cx0 - x) / w, fy: (cy0 - y) / h, fw: (cx1 - cx0) / w, fh: (cy1 - cy0) / h } };
}
const hiresCache = new Map<string, Promise<HTMLImageElement | null>>();
const loadImage = (src: string, cors = true) => new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); if (cors && !src.startsWith("data:") && !src.startsWith("blob:")) x.crossOrigin = "anonymous"; x.onload = () => res(x); x.onerror = rej; x.src = src; });
/** vector art drawn from its own file, big (4,800 px), in the inks picked for it; null when it can't be */
function hiresArt(url: string, name: string, inkJson: string, shown: HTMLImageElement) {
  const key = url + "|" + inkJson;
  if (!hiresCache.has(key)) hiresCache.set(key, (async () => {
    try {
      const { makePreview } = await import("@/lib/artPrep");
      const blob = await (await fetch(url)).blob();
      const png = await makePreview(new File([blob], name || "art.eps", { type: blob.type }), 4800);
      if (!png) { console.warn("[pdf] no picture from", name); return null; }
      const u = URL.createObjectURL(png);
      let img = await loadImage(u, false);
      // cut to the art (the page shows the logo trimmed of its empty margins), at full size
      const { trimClear } = await import("@/lib/artPrep");
      const t = trimClear(img);
      if (t) {
        const c = document.createElement("canvas"); c.width = t.box.w; c.height = t.box.h;
        c.getContext("2d")!.drawImage(img, t.box.x, t.box.y, t.box.w, t.box.h, 0, 0, t.box.w, t.box.h);
        img = await loadImage(c.toDataURL("image/png"), false);
      }
      // the same picture as the page shows (same proportions), else it isn't the same crop: keep the page's
      if (Math.abs(img.naturalWidth / img.naturalHeight - shown.naturalWidth / shown.naturalHeight) > 0.015) { console.warn("[pdf] different proportions", img.naturalWidth, img.naturalHeight, shown.naturalWidth, shown.naturalHeight); return null; }
      if (inkJson) { const { repaintLogo } = await import("@/lib/inkColors"); img = await loadImage(repaintLogo(img, JSON.parse(inkJson), 4800), false); }
      return img;
    } catch (e) { console.warn("[pdf] full-size art failed", e); return null; }
  })());
  return hiresCache.get(key)!;
}
/** that part of the picture at its full resolution (vector art drawn again from its file), as PNG (art, which has
 *  see-through parts) or JPEG (photos and mockups) bytes */
async function cropAtFullSize(src: string, shown: HTMLImageElement, r: NonNullable<ReturnType<typeof visibleRect>>): Promise<{ bytes: ArrayBuffer; png: boolean } | null> {
  const art = !!shown.closest(".art, .pf-tile-art");
  const hi = shown.dataset.hires ? await hiresArt(shown.dataset.hires, shown.dataset.hiresName || "", shown.dataset.inkmap || "", shown) : null;
  // a raster logo shown repainted in its inks: repainted again from the original at its full size
  let img: HTMLImageElement | null = hi;
  if (!img && shown.dataset.orig && shown.dataset.inkmap) {
    try { const o = await loadImage(shown.dataset.orig); const { repaintLogo } = await import("@/lib/inkColors"); img = await loadImage(repaintLogo(o, JSON.parse(shown.dataset.inkmap), 5000), false); } catch { img = null; }
  }
  if (!img) img = src.startsWith("data:") || src.startsWith("blob:") ? shown : await loadImage(src);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const sx = r.src.fx * nw, sy = r.src.fy * nh, sw = r.src.fw * nw, sh = r.src.fh * nh;
  // up to ~600 dpi on the page for art (proofreading small type), ~300 for photos; never more than 5,000 px a side
  const dpi = art ? 600 : 300;
  const cap = Math.min(1, 5000 / Math.max(sw, sh), ((r.dest.w / 96) * dpi) / sw);
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * cap)); c.height = Math.max(1, Math.round(sh * cap));
  const g = c.getContext("2d"); if (!g) return null;
  g.imageSmoothingQuality = "high";
  if (!art) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, art ? "image/png" : "image/jpeg", 0.92));
  return blob ? { bytes: await blob.arrayBuffer(), png: art } : null;
}

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
  // the page title is the file name (the browser's Save as PDF uses it); kept when the app sets its own title after loading
  useEffect(() => {
    if (!fileName) return;
    const set = () => { if (document.title !== fileName) document.title = fileName; };
    set();
    const mo = new MutationObserver(set);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [fileName]);

  async function save() {
    setBusy("Making the PDF…"); setErr("");
    const sheets = [...document.querySelectorAll<HTMLElement>(".pdoc .sheet")];
    const zooms = sheets.map((el) => el.style.zoom);
    try {
      // every picture loaded first (the close-ups are repainted in their inks a moment after the page opens)
      await Promise.all([...document.querySelectorAll<HTMLImageElement>(".pdoc img")].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = () => r(null); }))));
      await new Promise((r) => setTimeout(r, 400));
      sheets.forEach((el) => { el.style.zoom = ""; });
      const [{ toJpeg }, { PDFDocument, StandardFonts }] = await Promise.all([import("html-to-image"), import("pdf-lib")]);
      const pdf = await PDFDocument.create();
      pdf.setTitle(fileName || document.title);
      const form = pdf.getForm();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const [i, el] of sheets.entries()) {
        setBusy(`Page ${i + 1} of ${sheets.length}…`);
        const box = el.getBoundingClientRect();
        // the pictures go in at their own full resolution (Oct 20, Nick: "the blown-up art… has got to be a really
        // high-resolution version so that people can proofread it"); the page around them is pictured without them
        const imgs = [...el.querySelectorAll<HTMLImageElement>("img")].filter((im) => im.naturalWidth > 0 && im.getBoundingClientRect().width > 40);
        const shots = imgs.map((im) => ({ im, src: im.currentSrc || im.src, r: visibleRect(im) }));
        imgs.forEach((im) => { im.style.visibility = "hidden"; });
        let url = "";
        try { url = await toJpeg(el, { quality: 0.9, pixelRatio: 2, backgroundColor: "#ffffff", style: { boxShadow: "none", margin: "0" } }); }
        finally { imgs.forEach((im) => { im.style.visibility = ""; }); }
        const bg = await pdf.embedJpg(await (await fetch(url)).arrayBuffer());
        // letter (612 × 792 pt); a sheet taller than a page is fitted on it
        const page = pdf.addPage([612, 792]);
        const k = Math.min(612 / box.width, 792 / box.height), ox = (612 - box.width * k) / 2;
        const at = (r: { x: number; y: number; w: number; h: number }) => ({ x: ox + (r.x - box.left) * k, y: 792 - (r.y - box.top + r.h) * k, width: r.w * k, height: r.h * k });
        page.drawImage(bg, { x: ox, y: 792 - box.height * k, width: box.width * k, height: box.height * k });
        for (const s of shots) {
          if (!s.r) continue;
          try {
            const got = await cropAtFullSize(s.src, s.im, s.r);
            if (!got) continue;
            const pi = got.png ? await pdf.embedPng(got.bytes) : await pdf.embedJpg(got.bytes);
            page.drawImage(pi, at(s.r.dest));
          } catch { /* the pictured copy stays */ }
        }
        // fillable boxes: approve / changes checkboxes, the changes note, signature, name, date
        for (const c of el.querySelectorAll<HTMLElement>("[data-pdf-check]")) {
          const r = c.getBoundingClientRect();
          const f = form.createCheckBox(`${c.dataset.pdfCheck}-p${i + 1}`);
          f.addToPage(page, { ...at({ x: r.left, y: r.top, w: r.width, h: r.height }), borderWidth: 0 });
        }
        for (const t of el.querySelectorAll<HTMLElement>("[data-pdf-text]")) {
          const r = t.getBoundingClientRect();
          const line = !!t.closest(".pf-sign");
          // a signature / name / date goes on the line (above its label); the note fills its box under the label
          const rr = line ? { x: r.left, y: r.top - 25, w: r.width, h: 23 } : { x: r.left + 3, y: r.top + 16, w: r.width - 6, h: r.height - 19 };
          const f = form.createTextField(`${t.dataset.pdfText}-p${i + 1}`);
          if (t.dataset.pdfMulti) f.enableMultiline();
          f.addToPage(page, { ...at(rr), borderWidth: 0, font });
          f.setFontSize(t.dataset.pdfMulti ? 10 : 12);
        }
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
