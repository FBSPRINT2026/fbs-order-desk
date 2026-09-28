"use client";
import { useRef, useState } from "react";

export type ProdFile = { id: string; name: string; url?: string; thumb?: string; mime?: string };

const isImg = (f: ProdFile) => /^image\//.test(f.mime || "") || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
const ext = (n: string) => (n.split("?")[0].split(".").pop() || "file").slice(0, 4).toUpperCase();

/**
 * Production notes & files: shop only, never shown to the customer. Laid out like Printavo's:
 * the notes on top, then the files as a grid of thumbnails you can drop more files onto.
 * Without the edit handlers it's read-only (archived orders).
 */
export default function ProductionPanel({ note, files, onNote, onUpload, onRemove, uploading = false, compact = false }: {
  note: string; files: ProdFile[];
  onNote?: (v: string) => void; onUpload?: (files: FileList) => void; onRemove?: (f: ProdFile) => void; uploading?: boolean; /** narrow side column */ compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [armed, setArmed] = useState("");
  const [zoom, setZoom] = useState<ProdFile | null>(null);
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
                  {(f.thumb || (isImg(f) && f.url)) ? <img src={f.thumb || f.url} alt={f.name} loading="lazy" /> : <span>{ext(f.name)}</span>}
                </button>
                <div className="prod-fname" title={f.name}>{f.name}</div>
                <div className="prod-facts">
                  {f.url && <a href={f.url} target="_blank" rel="noreferrer" download={f.name}>Download</a>}
                  {onRemove && <button type="button" className={"linkish" + (armed === f.id ? " armed" : "")} onClick={() => { if (armed === f.id) { onRemove(f); setArmed(""); } else { setArmed(f.id); setTimeout(() => setArmed((a) => (a === f.id ? "" : a)), 3500); } }}>{armed === f.id ? "Confirm remove" : "Remove"}</button>}
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
      </div>
      {zoom && (
        <div className="pv-zoom" role="dialog" aria-label={zoom.name} onClick={() => setZoom(null)}>
          <img src={zoom.url} alt={zoom.name} onClick={(e) => e.stopPropagation()} />
          <div className="pv-zoom-bar" onClick={(e) => e.stopPropagation()}><a href={zoom.url} target="_blank" rel="noreferrer">Open full size</a><button type="button" className="btn" onClick={() => setZoom(null)}>Close</button></div>
        </div>
      )}
    </section>
  );
}
