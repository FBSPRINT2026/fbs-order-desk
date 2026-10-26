"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { PDFJS, PDFJS_WORKER } from "@/lib/artPrep";

/**
 * Gang sheet builder (Oct 26, Nick: "under heat press… make another whole page that says gang sheet builder. Someone
 * needs to be able to upload a logo and also the size, and then it just repeats over and over again so that we can
 * upload it to our DTF company. You can set the space between so that it like is easier to cut or not").
 *
 * One logo, its width (the height follows), how many, the space between and the sheet (22" wide, 24 / 60 / 120" long or
 * your own). It packs as many across and down as fit, trims the last sheet to what's on it, and downloads 300 dpi PNGs
 * with a clear background. No file goes over the DTF company's limit (Nick: "we can't have a file be over 80 megabytes…
 * after it gets over 80 megabytes, it needs to split into multiple gang sheet options"): a sheet that would be bigger is
 * split into more files. Cut lines are on screen only, or printed on the file.
 */
const DPI = 300;
/** a canvas this tall is the most browsers draw */
const MAX_PX = 30000;
type Logo = { name: string; img: HTMLImageElement; w: number; h: number };
type File1 = { rows: number; count: number; lengthIn: number };

async function loadLogo(f: File): Promise<Logo> {
  if (/pdf|illustrator|postscript/i.test(f.type) || /\.(pdf|ai)$/i.test(f.name)) {
    const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> } }> }> } };
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(16, 6000 / Math.max(v1.width, v1.height)) });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(0,0,0,0)" }).promise;
    const t = trim(c);
    const img = new Image(); img.src = t.toDataURL("image/png"); await img.decode();
    return { name: f.name, img, w: t.width, h: t.height };
  }
  const url = URL.createObjectURL(f);
  const img0 = new Image(); img0.src = url; await img0.decode();
  const c = document.createElement("canvas"); c.width = img0.naturalWidth; c.height = img0.naturalHeight;
  c.getContext("2d")!.drawImage(img0, 0, 0);
  const t = trim(c);
  const img = new Image(); img.src = t.toDataURL("image/png"); await img.decode();
  URL.revokeObjectURL(url);
  return { name: f.name, img, w: t.width, h: t.height };
}
/** cut to the art (clear margins off) */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = c, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function GangSheet() {
  const [logo, setLogo] = useState<Logo | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [wIn, setWIn] = useSticky("gang.width", "3.5");
  const [qty, setQty] = useSticky("gang.qty", "48");
  const [gap, setGap] = useSticky("gang.gap", "0.25");
  const [sheetW, setSheetW] = useSticky("gang.sheetW", "22");
  const [len, setLen] = useSticky<string>("gang.len", "60");
  const [customLen, setCustomLen] = useSticky("gang.customLen", "36");
  const [lines, setLines] = useSticky<"screen" | "print">("gang.lines", "screen");
  const [maxMb, setMaxMb] = useSticky("gang.maxMb", "80");
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState("");

  const w = Math.max(0.25, +wIn || 0), h = logo ? r2((w * logo.h) / logo.w) : 0;
  const g = Math.max(0, +gap || 0), SW = Math.max(4, +sheetW || 22), n = Math.max(1, Math.round(+qty || 0));
  const L = Math.max(4, len === "custom" ? +customLen || 0 : +len);
  // the layout: a gap's width all around, then logos a gap apart
  const lay = useMemo(() => {
    if (!logo || !(w > 0) || !(h > 0)) return null;
    const cols = Math.floor((SW - g) / (w + g));
    const rowsPer = Math.floor((L - g) / (h + g));
    if (cols < 1 || rowsPer < 1) return { cols, rowsPer, sheets: [] as File1[], fit: 0 };
    const perSheet = cols * rowsPer, sheets: File1[] = [];
    let left = n;
    while (left > 0) { const c = Math.min(left, perSheet), rows = Math.ceil(c / cols); sheets.push({ rows, count: c, lengthIn: Math.ceil(g + rows * (h + g)) }); left -= c; }
    return { cols, rowsPer, sheets, fit: perSheet };
  }, [logo, w, h, g, SW, L, n]);

  // the preview: the sheet picked, small
  const pv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = pv.current; if (!c || !logo || !lay?.sheets.length) return;
    const s = lay.sheets[Math.min(shown, lay.sheets.length - 1)];
    const k = Math.min(30, 640 / SW);
    c.width = Math.round(SW * k); c.height = Math.round(s.lengthIn * k);
    const x = c.getContext("2d")!; x.clearRect(0, 0, c.width, c.height);
    drawSheet(x, logo, s, lay.cols, { w, h, g, k, lines: true });
  }, [logo, lay, shown, SW, w, h, g]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(""); setBusy("Reading the logo…");
    try { const l = await loadLogo(f); setLogo(l); setShown(0); } catch { setErr("That file couldn't be read. Use a PNG, JPG, PDF or AI file."); }
    setBusy("");
  }

  async function download() {
    if (!logo || !lay?.sheets.length) return;
    const limit = Math.max(5, +maxMb || 80) * 1024 * 1024;
    setErr(""); setBusy("Making the files…");
    try {
      // each sheet becomes one or more files: never taller than a browser draws, never bigger than the limit
      const out: { blob: Blob; name: string; len: number }[] = [];
      const base = logo.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 40) || "logo";
      const parts: File1[] = [];
      for (const s of lay.sheets) {
        const rowsMax = Math.max(1, Math.floor((MAX_PX / DPI - g) / (h + g)));
        let left = s.count;
        while (left > 0) { const c = Math.min(left, rowsMax * lay.cols), rows = Math.ceil(c / lay.cols); parts.push({ rows, count: c, lengthIn: Math.ceil(g + rows * (h + g)) }); left -= c; }
      }
      // over the size limit: the same logos over more, shorter files
      const queue = [...parts];
      while (queue.length) {
        const p = queue.shift()!;
        setBusy(`Making file ${out.length + 1}…`);
        const c = document.createElement("canvas"); c.width = Math.round(SW * DPI); c.height = Math.round(p.lengthIn * DPI);
        drawSheet(c.getContext("2d")!, logo, p, lay.cols, { w, h, g, k: DPI, lines: lines === "print" });
        const b = await toBlob(c);
        c.width = c.height = 0;
        if (!b) throw new Error("The file couldn't be made.");
        if (b.size > limit && p.rows > 1) {
          const half = Math.ceil(p.rows / 2), c1 = Math.min(p.count, half * lay.cols);
          queue.unshift({ rows: half, count: c1, lengthIn: Math.ceil(g + half * (h + g)) }, { rows: Math.ceil((p.count - c1) / lay.cols), count: p.count - c1, lengthIn: Math.ceil(g + Math.ceil((p.count - c1) / lay.cols) * (h + g)) });
          continue;
        }
        out.push({ blob: b, name: "", len: p.lengthIn });
      }
      out.forEach((o, i) => { o.name = `${base}-gang-${SW}x${o.len}-${i + 1}of${out.length}.png`; });
      for (const o of out) {
        const u = URL.createObjectURL(o.blob);
        const a = document.createElement("a"); a.href = u; a.download = o.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 60000);
        await new Promise((r) => setTimeout(r, 400));
      }
      setBusy(""); setErr("");
      setDone(`${out.length} file${out.length === 1 ? "" : "s"} downloaded${out.length > lay.sheets.length ? `: split to stay under ${Math.round(limit / 1048576)} MB each` : ""} (largest ${Math.round(Math.max(...out.map((o) => o.blob.size)) / 104857.6) / 10} MB).`);
    } catch (e) { setBusy(""); setErr(e instanceof Error ? e.message : "The files couldn't be made."); }
  }
  const dpiAt = logo && w ? Math.round(logo.w / w) : 0;
  const sheetsN = lay?.sheets.length || 0;
  return (
    <>
      <div className="page-head">
        <div><h1>Gang sheet builder</h1><div className="eyebrow">Heat press: one logo repeated across a DTF sheet, ready to upload to the transfer company</div></div>
        <div className="row" style={{ gap: 8 }}>
          {logo && <button type="button" className="btn" onClick={() => { setLogo(null); setDone(""); }}>Clear</button>}
          <button type="button" className="btn primary" disabled={!logo || !sheetsN || !!busy} onClick={() => void download()}>{busy || "Download PNG"}</button>
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="pv-err sow-msg" role="status">{done}</div>}
      <div className="gang">
        <section className="panel">
          <div className="panel-h"><h2>Logo and sheet</h2></div>
          <div className="panel-b stack" style={{ gap: 12 }}>
            <label className="gang-up">
              {logo ? <><img src={logo.img.src} alt="" /><span><b data-notranslate>{logo.name}</b><span className="faint">Replace</span></span></> : <span>Upload a logo <span className="faint">PNG, JPG, PDF or AI</span></span>}
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.ai,.pdf" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {logo && dpiAt > 0 && dpiAt < 200 && <p className="gang-warn">This logo is only about {dpiAt} dpi at {w}" wide: it may print soft. A bigger file or a vector (PDF, AI) prints sharper.</p>}
            <div className="gang-row">
              <div className="field"><label htmlFor="g-w">Width (in)</label><input id="g-w" type="number" step="0.05" min="0.25" value={wIn} onChange={(e) => setWIn(e.target.value)} /></div>
              <div className="field"><label>Height (in)</label><input type="text" readOnly value={h ? String(h) : ""} placeholder="follows the logo" /></div>
            </div>
            <div className="gang-row">
              <div className="field"><label htmlFor="g-n">How many</label><input id="g-n" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label htmlFor="g-g">Space between (in)</label><input id="g-g" type="number" min="0" step="0.05" value={gap} onChange={(e) => setGap(e.target.value)} /></div>
            </div>
            <div className="field">
              <label>Sheet</label>
              <div className="gang-row">
                <div className="field"><label htmlFor="g-sw">Width (in)</label><input id="g-sw" type="number" min="4" step="0.5" value={sheetW} onChange={(e) => setSheetW(e.target.value)} /></div>
                {len === "custom" && <div className="field"><label htmlFor="g-sl">Length (in)</label><input id="g-sl" type="number" min="4" step="1" value={customLen} onChange={(e) => setCustomLen(e.target.value)} /></div>}
              </div>
              <div className="chips" style={{ marginTop: 6 }}>
                {["24", "60", "120", "custom"].map((v) => <button key={v} type="button" className={"chip" + (len === v ? " on" : "")} onClick={() => setLen(v)}>{v === "custom" ? "Custom" : `${SW}" × ${v}"`}</button>)}
              </div>
            </div>
            <div className="field">
              <label>Cut lines</label>
              <div className="chips">
                <button type="button" className={"chip" + (lines === "screen" ? " on" : "")} onClick={() => setLines("screen")}>Show on screen only</button>
                <button type="button" className={"chip" + (lines === "print" ? " on" : "")} onClick={() => setLines("print")}>Print them</button>
              </div>
            </div>
            <div className="field" style={{ maxWidth: 200 }}>
              <label htmlFor="g-mb">Largest file (MB)</label>
              <input id="g-mb" type="number" min="5" step="1" value={maxMb} onChange={(e) => setMaxMb(e.target.value)} />
              <span className="faint" style={{ fontSize: 12 }}>The DTF company&apos;s limit: a bigger sheet is split into more files.</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Sheet preview</h2><span className="faint">{sheetsN ? `${SW}" × ${lay!.sheets[Math.min(shown, sheetsN - 1)].lengthIn}"` : ""}</span></div>
          <div className="panel-b">
            {!logo ? <p className="faint">Upload a logo to see the sheet.</p> : !lay || !sheetsN ? <p className="gang-warn">The logo doesn&apos;t fit on a {SW}" × {L}" sheet at {w}" wide with {g}" between.</p> : (
              <>
                {sheetsN > 1 && <div className="chips" style={{ marginBottom: 8 }}>{lay.sheets.map((s, i) => <button key={i} type="button" className={"chip" + (i === Math.min(shown, sheetsN - 1) ? " on" : "")} onClick={() => setShown(i)}>Sheet {i + 1} <span className="pill-n">{s.count}</span></button>)}</div>}
                <div className="gang-sheet"><canvas ref={pv} /></div>
                <div className="gang-stats">
                  <span><b>{lay.fit}</b> fit on a sheet · {lay.cols} across × {lay.rowsPer} down</span>
                  <span><b>{n}</b> logo{n === 1 ? "" : "s"} on {sheetsN} sheet{sheetsN === 1 ? "" : "s"}{lay.sheets[sheetsN - 1].lengthIn < L ? ` (the last one trimmed to ${lay.sheets[sheetsN - 1].lengthIn}")` : ""}</span>
                  <span className="faint">{DPI} dpi PNG, clear background, each file under {Math.max(5, +maxMb || 80)} MB{lay.sheets.some((x) => x.lengthIn * DPI > MAX_PX) ? `; a sheet longer than ${Math.floor(MAX_PX / DPI)}" comes as two files (the most a browser can draw)` : ""}</span>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

/** one sheet: logos `g` apart with `g` all around; k = pixels per inch */
function drawSheet(x: CanvasRenderingContext2D, logo: Logo, s: File1, cols: number, o: { w: number; h: number; g: number; k: number; lines: boolean }) {
  const { w, h, g, k } = o;
  x.imageSmoothingQuality = "high";
  for (let i = 0; i < s.count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const X = (g + c * (w + g)) * k, Y = (g + r * (h + g)) * k;
    x.drawImage(logo.img, X, Y, w * k, h * k);
    if (o.lines && g > 0) {
      x.save(); x.strokeStyle = "rgba(200,40,40,.8)"; x.lineWidth = Math.max(1, k / 100); x.setLineDash([k / 12, k / 16]);
      x.strokeRect(X - (g * k) / 2, Y - (g * k) / 2, (w + g) * k, (h + g) * k); x.restore();
    }
  }
}
