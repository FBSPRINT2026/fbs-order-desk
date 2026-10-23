"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { downloadUrl } from "@/lib/printavoNames";
import { PROD_KINDS, fileTypeOf, guessProdKind, prodKindLabel } from "@/lib/productionFileKinds";

/** `fileName`: what a download saves as (defaults to `name`) */
export type ProdFile = { id: string; name: string; url?: string; /** a stamped customer mockup: their file without the stamp (hold to see it) */ plain?: string; thumb?: string; mime?: string; fileName?: string; /** what it is (lib/productionFileKinds.ts) */ category?: string | null; /** what the AI thinks it is, to confirm */ guess?: string | null; /** e.g. "Amazon barcodes for The Bottles" */ note?: string | null; /** shown, not labeled or removed here (a job photo) */ readOnly?: boolean };

const isImg = (f: ProdFile) => /^image\//.test(f.mime || "") || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
const ext = (n: string) => (n.split("?")[0].split(".").pop() || "file").slice(0, 4).toUpperCase();

/**
 * Production notes & files: shop only, never shown to the customer. Laid out like Printavo's:
 * the notes on top, then the files as a grid of thumbnails you can drop more files onto.
 * Without the edit handlers it's read-only (archived orders).
 */
export default function ProductionPanel({ note, files, onNote, onUpload, onRemove, onCategory, onFileNote, uploading = false, compact = false, children }: {
  note: string; files: ProdFile[]; /** more below the files: the job's notes & photos added in the portal (Oct 15: was a second "Production files & notes") */ children?: ReactNode;
  onNote?: (v: string) => void; onUpload?: (files: FileList) => void; onRemove?: (f: ProdFile) => void; /** label a file: barcodes, film, mailing list… (Oct 20) */ onCategory?: (f: ProdFile, category: string | null) => void; /** a note on one file */ onFileNote?: (f: ProdFile, note: string) => void; uploading?: boolean; /** narrow side column */ compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [armed, setArmed] = useState("");
  const [zoom, setZoom] = useState<ProdFile | null>(null);
  const [peek, setPeek] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const edit = !!onNote;
  return (
    <section className={"panel prod" + (compact ? " prod-compact" : "")}>
      <div className="panel-h"><h2>Production notes &amp; files</h2><span className="prod-lock" title="Only your team sees these. They never show on the customer's quote, invoice or portal.">Shop only</span></div>
      <div className="panel-b stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="prod-note">Production notes</label>
          {edit
            ? <textarea id="prod-note" rows={4} placeholder="Ink colors, PMS matches, mesh counts, placement, who's shipping the garments…" value={note} onChange={(e) => onNote!(e.target.value)} />
            : <div className="prod-note">{note || <span className="faint">No production notes.</span>}</div>}
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 6 }}>Production files{files.length ? ` (${files.length})` : ""}</div>
          <div className={"prod-files" + (over ? " over" : "")}
            onDragOver={onUpload ? (e) => { e.preventDefault(); setOver(true); } : undefined}
            onDragLeave={onUpload ? () => setOver(false) : undefined}
            onDrop={onUpload ? (e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files); } : undefined}>
            {files.map((f) => (
              <div key={f.id} className="prod-file">
                <button type="button" className="prod-thumb" title={f.name} onClick={() => (isImg(f) && f.url ? setZoom(f) : f.url && window.open(f.url, "_blank", "noopener"))}>
                  {(f.thumb || (isImg(f) && f.url)) ? <img src={f.thumb || f.url} alt={f.name} loading="lazy" /> : <FileThumb f={f} />}
                </button>
                <div className="prod-fname" title={f.name}>{f.name}</div>
                {!f.readOnly && onCategory && !f.category && f.guess && f.guess !== "?" && (
                  <div className="prod-guess">Looks like <b>{prodKindLabel(f.guess)}</b> <button type="button" className="linkish ok" onClick={() => onCategory(f, f.guess!)}>Yes</button></div>
                )}
                {f.readOnly ? <div className="prod-kind set">Photo</div> : onCategory ? (() => { const g = !f.category ? (f.guess && f.guess !== "?" ? f.guess : guessProdKind(f.name)) : ""; return (
                  <select className={"prod-kind" + (f.category ? " set" : "")} value={f.category || ""} onChange={(e) => onCategory(f, e.target.value || null)} aria-label={`What ${f.name} is`} title={f.category ? PROD_KINDS.find((x) => x.k === f.category)?.hint : g ? `Looks like: ${prodKindLabel(g)}` : "Say what this file is"}>
                    <option value="">{g ? `Label it (${prodKindLabel(g)}?)` : "Label it…"}</option>
                    {PROD_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
                  </select>); })() : f.category ? <div className="prod-kind set">{prodKindLabel(f.category)}</div> : null}
                <div className="prod-type faint">{fileTypeOf(f.name, f.mime)}</div>
                {onFileNote && !f.readOnly ? <input className="prod-fnote" defaultValue={f.note || ""} placeholder="Add a note…" aria-label={`Note on ${f.name}`} onBlur={(e) => { const t = e.target.value.trim(); if (t !== (f.note || "")) onFileNote(f, t); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  : f.note ? <div className="prod-fnote ro">{f.note}</div> : null}
                <div className="prod-facts">
                  {f.url && <a href={downloadUrl(f.url, f.fileName || f.name)} target="_blank" rel="noreferrer" download={f.fileName || f.name}>Download</a>}
                  {onRemove && !f.readOnly && <button type="button" className={"linkish" + (armed === f.id ? " armed" : "")} onClick={() => { if (armed === f.id) { onRemove(f); setArmed(""); } else { setArmed(f.id); setTimeout(() => setArmed((a) => (a === f.id ? "" : a)), 3500); } }}>{armed === f.id ? "Confirm remove" : "Remove"}</button>}
                </div>
              </div>
            ))}
            {onUpload && (
              <button type="button" className="prod-drop" onClick={() => input.current?.click()} disabled={uploading}>
                <b>{uploading ? "Uploading…" : "+ Add files"}</b><span>{uploading ? "" : "or drop them here"}</span>
              </button>
            )}
            {!onUpload && !files.length && <div className="faint" style={{ fontSize: 13 }}>No production files.</div>}
          </div>
          {onUpload && <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ""; }} />}
          {onUpload && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Separations, vector art, placement sheets, customer files… any file type.</div>}
        </div>
        {children}
      </div>
      {zoom && (
        <div className="pv-zoom" role="dialog" aria-label={zoom.name} onClick={() => setZoom(null)}>
          <img src={peek && zoom.plain ? zoom.plain : zoom.url} alt={zoom.name} onClick={(e) => e.stopPropagation()} />
          {zoom.plain && <img src={zoom.plain} alt="" hidden />}
          <div className="pv-zoom-bar" onClick={(e) => e.stopPropagation()}>{zoom.plain && <button type="button" className={"pv-peek" + (peek ? " on" : "")} title="Hold to see it without the Customer supplied mockup stamp; let go and the stamp comes back"
            onPointerDown={(e) => { e.preventDefault(); setPeek(true); }} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPeek(true); } }} onKeyUp={() => setPeek(false)} onBlur={() => setPeek(false)}>{peek ? "Showing it without the stamp" : "Hold to hide the stamp"}</button>}<a href={zoom.url} target="_blank" rel="noreferrer">Open full size</a><a href={downloadUrl(zoom.url, zoom.fileName || zoom.name)} target="_blank" rel="noreferrer">Download</a><button type="button" className="btn" onClick={() => setZoom(null)}>Close</button></div>
        </div>
      )}
    </section>
  );
}

/**
 * A file's picture (Oct 21, Nick: "files don't show, they just show PDF and XLS"): a PDF / AI shows its first page
 * (drawn in the browser, kept for the visit), a spreadsheet a sheet icon with its type; anything else its type.
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
function FileThumb({ f }: { f: ProdFile }) {
  const [u, setU] = useState("");
  const pdf = /\.(pdf|ai)$/i.test(f.name) || /pdf/i.test(f.mime || "");
  const sheet = /\.(xlsx?|csv|numbers)$/i.test(f.name) || /sheet|excel|csv/i.test(f.mime || "");
  useEffect(() => { let off = false; if (pdf && f.url) void pdfThumb(f.url, f.name).then((x) => { if (!off) setU(x); }); return () => { off = true; }; }, [pdf, f.url, f.name]);
  // eslint-disable-next-line @next/next/no-img-element
  if (u) return <img src={u} alt={f.name} className="prod-page" />;
  if (sheet) return <span className="prod-sheet" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><b>{ext(f.name)}</b></span>;
  return <span>{ext(f.name)}</span>;
}
