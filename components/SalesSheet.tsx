"use client";
/**
 * Sales sheet creator (Mockup Creator → Sales tools, Oct 22 2026, Nick: "a sales sheet creator… edit all sorts of
 * things… add any kind of text… 3 or 4 up on a page, make them tight, space between… a really nice graphic editor
 * that lets me create a cool sales sheet", so a customer can send out an image and take orders).
 *
 * The page is drawn on a canvas from the mockup's shirts (each color drawn once by the Mockup Creator, then laid out
 * here): page size and background, how many per row, spacing, shirt size, sides, color names, a header (title,
 * subtitle, our logo, their name) and free text and pictures dragged anywhere. Downloads as a PNG or a PDF. Nothing
 * is saved: it's a picture to send out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { canvasPage, imagePdf } from "@/lib/imagePdf";

export type SheetColor = { key: string; color: string; style: string };
type Sides = "both" | "front" | "back";
type Item = { id: string; kind: "text"; text: string; x: number; y: number; size: number; color: string; bold: boolean; align: CanvasTextAlign }
  | { id: string; kind: "pic"; src: string; name: string; x: number; y: number; w: number };

const PAGES = {
  landscape: { label: "Landscape (11 × 8.5)", w: 2200, h: 1700, pt: [792, 612] },
  portrait: { label: "Portrait (8.5 × 11)", w: 1700, h: 2200, pt: [612, 792] },
  square: { label: "Square (posts)", w: 2000, h: 2000, pt: [720, 720] },
  story: { label: "Tall (stories)", w: 1440, h: 2560, pt: [540, 960] },
} as const;
type PageKey = keyof typeof PAGES;
const uid = () => Math.random().toString(36).slice(2, 9);
const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => no(new Error("picture")); im.src = src; });
const dark = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 110; };

export default function SalesSheet({ colors, views, shirts, title0, customer, shop, onClose }: {
  colors: SheetColor[];
  /** the sides this mockup has prints on */ views: ("front" | "back")[];
  /** one color's shirt(s) side by side, drawn about `h` px tall */ shirts: (key: string, sides: ("front" | "back")[], h: number) => Promise<HTMLCanvasElement>;
  title0: string; customer: string;
  shop: { name: string; line: string; logoUrl: string };
  onClose: () => void;
}) {
  const [page, setPage] = useSticky<PageKey>("ss.page", "landscape");
  const [bg, setBg] = useSticky<string>("ss.bg", "#ffffff");
  const [perRow, setPerRow] = useSticky<number>("ss.perRow", 4), [autoRow, setAutoRow] = useSticky<boolean>("ss.autoRow", true);
  const [gap, setGap] = useSticky<number>("ss.gap", 3);
  const [size, setSize] = useSticky<number>("ss.size", 100);
  const [pairGap, setPairGap] = useSticky<number>("ss.pairGap", 2), [margin, setMargin] = useSticky<number>("ss.margin", 4.5);
  const [sides, setSides] = useSticky<Sides>("ss.sides", "both");
  const [names, setNames] = useSticky<boolean>("ss.names", true);
  const [styleUnder, setStyleUnder] = useSticky<boolean>("ss.style", false);
  const [labelSize, setLabelSize] = useSticky<number>("ss.labelSize", 30);
  const [ours, setOurs] = useSticky<boolean>("ss.ours", false);
  const [theirs, setTheirs] = useSticky<boolean>("ss.theirs", true);
  const [contact, setContact] = useSticky<boolean>("ss.contact", false);
  const [align, setAlign] = useSticky<"left" | "center">("ss.align", "center");
  const [title, setTitle] = useState(title0);
  const [sub, setSub] = useState("");
  const [titleSize, setTitleSize] = useSticky<number>("ss.titleSize", 64);
  const [order, setOrder] = useState<string[]>(colors.map((c) => c.key));
  const [off, setOff] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState("Drawing the shirts…");
  const [err, setErr] = useState("");
  // each color's front and back drawn on their own, then all trimmed to the same box per side (the photos' white
  // margins out, every color the same size), so "space between" is the real space between shirts
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const crop = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const pics = useRef(new Map<string, HTMLImageElement>());
  const logo = useRef<HTMLImageElement | null>(null);
  const boxes = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [tick, setTick] = useState(0);
  const sideList: ("front" | "back")[] = sides === "both" ? views : views.includes(sides) ? [sides] : views;
  const P = PAGES[page] || PAGES.landscape;
  const ink = dark(bg) ? "#ffffff" : "#141D2B", soft = dark(bg) ? "#d5dbe3" : "#5B6678";

  // every color's shirts, drawn once per set of sides
  useEffect(() => {
    let live = true;
    (async () => {
      setBusy("Drawing the shirts…");
      try {
        if (shop.logoUrl && !logo.current) logo.current = await load(shop.logoUrl).catch(() => null);
        for (const c of colors) for (const sd of views) {
          const k = `${c.key}|${sd}`;
          if (!cache.current.has(k)) cache.current.set(k, await shirts(c.key, [sd], 900));
          if (!live) return;
        }
        // the photo's white background made see-through, from the edges in (it stops at the shirt's outline, so a white
        // shirt keeps its body): shirts can overlap and sit on any page color
        for (const c of colors) for (const sd of views) {
          const key = `${c.key}|${sd}`, cv0 = cache.current.get(key); if (!cv0 || (cv0 as HTMLCanvasElement & { clear?: boolean }).clear) continue;
          const w = cv0.width, h = cv0.height, x2 = cv0.getContext("2d")!, img = x2.getImageData(0, 0, w, h), d = img.data;
          const seen = new Uint8Array(w * h), st: number[] = [];
          const bgl = (i: number) => d[i * 4] >= 250 && d[i * 4 + 1] >= 250 && d[i * 4 + 2] >= 250;
          for (let xx = 0; xx < w; xx++) { st.push(xx, (h - 1) * w + xx); }
          for (let yy = 0; yy < h; yy++) { st.push(yy * w, yy * w + w - 1); }
          while (st.length) {
            const i = st.pop()!; if (seen[i]) continue; seen[i] = 1;
            if (!bgl(i)) continue;
            d[i * 4 + 3] = 0;
            const xx = i % w, yy = (i / w) | 0;
            if (xx > 0) st.push(i - 1); if (xx < w - 1) st.push(i + 1); if (yy > 0) st.push(i - w); if (yy < h - 1) st.push(i + w);
          }
          x2.putImageData(img, 0, 0);
          (cv0 as HTMLCanvasElement & { clear?: boolean }).clear = true;
        }
        // each shirt trimmed to its own outline (the photos' white margins out; 6210 and 3001 photos are framed
        // differently, so one shared box left gaps): all drawn at one scale, standing on the same line
        for (const c of colors) for (const sd of views) {
          const key = `${c.key}|${sd}`, cv0 = cache.current.get(key); if (!cv0 || crop.current[key]) continue;
          let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
          const w = cv0.width, h = cv0.height, d = cv0.getContext("2d")!.getImageData(0, 0, w, h).data;
          for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (d[i + 3] > 20 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          const pad = 4;
          crop.current[key] = x1 > x0 && y1 > y0 ? { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(w, x1 - x0 + 2 * pad), h: Math.min(h, y1 - y0 + 2 * pad) } : { x: 0, y: 0, w, h };
        }
        setBusy(""); setTick((t) => t + 1);
      } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't draw the shirts."); setBusy(""); }
    })();
    return () => { live = false; };
  }, [colors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => order.map((k) => colors.find((c) => c.key === k)).filter((c): c is SheetColor => !!c && !off.has(c.key)), [order, off, colors]);
  const multiStyle = new Set(colors.map((c) => c.style)).size > 1;

  /** the whole page on a canvas, at full size */
  function draw(c: HTMLCanvasElement) {
    const W = P.w, H = P.h;
    c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const M = Math.round(Math.min(W, H) * (margin / 100));
    const font = (w: number, s: number) => `${w} ${s}px Helvetica, Arial, sans-serif`;
    const ax = align === "center" ? W / 2 : M;
    x.textAlign = align; x.textBaseline = "alphabetic";
    let y = M;
    // header: our logo and / or their name, the title, the subtitle
    if ((ours && logo.current) || (theirs && customer)) {
      const lh = Math.round(H * 0.045);
      const lw = ours && logo.current ? Math.min(W * 0.3, (logo.current.naturalWidth / (logo.current.naturalHeight || 1)) * lh) : 0;
      x.font = font(800, Math.round(lh * 0.8));
      const nameW = theirs && customer ? x.measureText(customer).width : 0;
      const total = lw + (lw && nameW ? lh * 0.6 : 0) + nameW;
      let lx = align === "center" ? (W - total) / 2 : M;
      if (lw && logo.current) { x.drawImage(logo.current, lx, y, lw, lh); lx += lw + (nameW ? lh * 0.6 : 0); }
      if (nameW) { x.fillStyle = ink; x.textAlign = "left"; x.fillText(customer, lx, y + lh * 0.82); x.textAlign = align; }
      y += lh + Math.round(H * 0.02);
    }
    if (title.trim()) { x.fillStyle = ink; x.font = font(800, titleSize); y += titleSize; x.fillText(title.trim(), ax, y); y += Math.round(titleSize * 0.35); }
    if (sub.trim()) { x.fillStyle = soft; x.font = font(400, Math.round(titleSize * 0.5)); y += Math.round(titleSize * 0.55); x.fillText(sub.trim(), ax, y); y += Math.round(titleSize * 0.3); }
    const footH = contact ? Math.round(H * 0.05) : 0;
    const top = y + Math.round(H * 0.025), bot = H - M - footH;
    // the grid: one unit per color (its sides side by side, trimmed), as big as fits with the spacing asked for, the
    // whole block centered on the page (Oct 22, Nick: fewer per row should mean bigger shirts, not bigger gaps)
    const n = shown.length;
    const g = (gap / 100) * W, labelH = names ? Math.round(labelSize * (styleUnder && multiStyle ? 2.4 : 1.5)) : 0;
    const pg = (pairGap / 100) * W, ns = sideList.length;
    const boxOf = (k0: string, sd: string) => crop.current[`${k0}|${sd}`] || { x: 0, y: 0, w: 600, h: 750 };
    // the widest and tallest color sets the slot every color is drawn in
    const uw0 = Math.max(1, ...shown.map((c) => sideList.reduce((t, sd) => t + boxOf(c.key, sd).w, 0)));
    const uh0 = Math.max(1, ...shown.map((c) => Math.max(...sideList.map((sd) => boxOf(c.key, sd).h))));
    const fitK = (cols: number) => {
      const rows = Math.max(1, Math.ceil(n / cols));
      const kW = (W - 2 * M - (cols - 1) * g - cols * (ns - 1) * pg) / (cols * uw0);
      const kH = (bot - top - (rows - 1) * g - rows * labelH) / (rows * uh0);
      return Math.min(kW, kH);
    };
    // per row: as asked, or (Auto) whatever makes the shirts biggest
    let cols = Math.max(1, Math.min(perRow || 1, n || 1));
    if (autoRow) { let best = 0; for (let c2 = 1; c2 <= Math.max(1, n); c2++) { const k2 = fitK(c2); if (k2 > best + 1e-6) { best = k2; cols = c2; } } }
    const rows = Math.max(1, Math.ceil(n / cols));
    const k = Math.max(0.05, fitK(cols)) * (size / 100);
    const uw = uw0 * k + (ns - 1) * pg, uh = uh0 * k, cellH = uh + labelH;
    const usedH = rows * cellH + (rows - 1) * g, oy = top + Math.max(0, (bot - top - usedH) / 2);
    x.textAlign = "center";
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
      const rowW = inRow * uw + (inRow - 1) * g, ux = (W - rowW) / 2 + col * (uw + g), uy = oy + row * (cellH + g);
      const bs = sideList.map((sd) => boxOf(shown[i].key, sd));
      const pairW = bs.reduce((t, b) => t + b.w * k, 0) + (ns - 1) * pg;
      const x0 = ux + (uw - pairW) / 2, xs: number[] = [];
      { let sx = x0; for (const b of bs) { xs.push(sx); sx += b.w * k + pg; } }
      // overlapping (front to back below zero): the back goes behind, the front on top
      const order = sideList.map((sd, j) => j);
      if (pg < 0) order.reverse();
      for (const j of order) {
        const sd = sideList[j], im = cache.current.get(`${shown[i].key}|${sd}`), b = bs[j];
        if (!im) continue;
        const dw = b.w * k, dh = b.h * k, dy = uy + (uh - dh);
        x.drawImage(im, b.x, b.y, b.w, b.h, xs[j], dy, dw, dh);
      }
      const cx = ux + uw / 2;
      if (names) {
        x.fillStyle = ink; x.font = font(700, labelSize); x.fillText(shown[i].color, cx, uy + uh + labelSize * 1.15);
        if (styleUnder && multiStyle) { x.fillStyle = soft; x.font = font(400, Math.round(labelSize * 0.72)); x.fillText(shown[i].style, cx, uy + uh + labelSize * 2.1); }
      }
    }
    if (contact && shop.line) { x.fillStyle = soft; x.font = font(600, Math.round(footH * 0.42)); x.textAlign = "center"; x.fillText(shop.line, W / 2, H - M); }
    // free text and pictures, on top
    const bx: typeof boxes.current = [];
    for (const it of items) {
      if (it.kind === "text") {
        x.font = font(it.bold ? 800 : 400, it.size); x.fillStyle = it.color; x.textAlign = it.align;
        const lines = it.text.split("\n"), lh = it.size * 1.2;
        const w = Math.max(...lines.map((l) => x.measureText(l).width), 10), px = it.x * W, py = it.y * H;
        lines.forEach((l, k) => x.fillText(l, px, py + it.size + k * lh));
        const left = it.align === "center" ? px - w / 2 : it.align === "right" ? px - w : px;
        bx.push({ id: it.id, x: left, y: py, w, h: lh * lines.length });
      } else {
        const im = pics.current.get(it.src); if (!im) continue;
        const w = it.w * W, h = w * (im.naturalHeight / (im.naturalWidth || 1));
        x.drawImage(im, it.x * W, it.y * H, w, h);
        bx.push({ id: it.id, x: it.x * W, y: it.y * H, w, h });
      }
    }
    const s = bx.find((b) => b.id === sel);
    if (s && c === cv.current) { x.setLineDash([12, 8]); x.strokeStyle = "#0E9BD8"; x.lineWidth = 3; x.strokeRect(s.x - 8, s.y - 8, s.w + 16, s.h + 16); x.setLineDash([]); }
    boxes.current = bx;
  }
  useEffect(() => { if (cv.current && !busy) draw(cv.current); });

  // drag text and pictures on the preview
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const toPage = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * P.w, y: ((e.clientY - r.top) / r.height) * P.h }; };
  const down = (e: React.PointerEvent) => {
    const p = toPage(e), hit = [...boxes.current].reverse().find((b) => p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10);
    setSel(hit?.id || "");
    if (!hit) return;
    const it = items.find((z) => z.id === hit.id)!;
    drag.current = { id: hit.id, dx: p.x - it.x * P.w, dy: p.y - it.y * P.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = toPage(e);
    setItems((xs) => xs.map((z) => (z.id === d.id ? { ...z, x: Math.max(0, Math.min(1, (p.x - d.dx) / P.w)), y: Math.max(0, Math.min(1, (p.y - d.dy) / P.h)) } : z)));
  };
  const up = () => { drag.current = null; };

  const cur = items.find((z) => z.id === sel);
  const setCur = (f: (z: Item) => Item) => setItems((xs) => xs.map((z) => (z.id === sel ? f(z) : z)));
  const addText = () => { const id = uid(); setItems((xs) => [...xs, { id, kind: "text", text: "Your text", x: 0.5, y: 0.12, size: 48, color: ink, bold: true, align: "center" }]); setSel(id); };
  const addPic = async (f: File | undefined) => {
    if (!f) return;
    const src = URL.createObjectURL(f);
    try { pics.current.set(src, await load(src)); } catch { setErr(`Couldn't open ${f.name}.`); return; }
    const id = uid(); setItems((xs) => [...xs, { id, kind: "pic", src, name: f.name, x: 0.05, y: 0.05, w: 0.18 }]); setSel(id);
  };
  const moveColor = (k: string, by: number) => setOrder((o) => { const i = o.indexOf(k), j = i + by; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function download(kind: "png" | "pdf") {
    setBusy(kind === "png" ? "Making the picture…" : "Making the PDF…");
    try {
      const c = document.createElement("canvas"); const was = sel; setSel(""); draw(c); setSel(was);
      const base = `${[customer, title || "sales sheet"].filter(Boolean).join(" ")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "sales-sheet";
      let blob: Blob;
      if (kind === "png") blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/png"));
      else blob = new Blob([imagePdf([await canvasPage(c, P.pt[0], P.pt[1], 0.95)], title || "Sales sheet") as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${base}.${kind}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make it."); }
    setBusy("");
  }

  return (
    <div className="ss-back" role="dialog" aria-modal="true" aria-label="Sales sheet creator">
      <div className="ss-box">
        <div className="ss-head">
          <div><h2>Sales sheet creator</h2><span className="faint">{shown.length} of {colors.length} colors · drag text and pictures on the sheet</span></div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void download("pdf")}>Download PDF</button>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void download("png")}>Download picture (PNG)</button>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="ss-body">
          <aside className="ss-ctl">
            <section><h3>Page</h3>
              <label className="mk-f"><span>Page margin: {margin < 2 ? "thin" : margin < 4 ? "small" : margin < 6 ? "medium" : "wide"}</span><input type="range" min={0.5} max={8} step={0.25} value={margin} onChange={(e) => setMargin(+e.target.value)} /></label>
              <label className="mk-f"><span>Size</span><select value={page} onChange={(e) => setPage(e.target.value as PageKey)}>{(Object.keys(PAGES) as PageKey[]).map((k) => <option key={k} value={k}>{PAGES[k].label}</option>)}</select></label>
              <div className="ss-row"><span>Background</span>{["#ffffff", "#f3f1ec", "#e9edf2", "#141d2b"].map((c) => <button key={c} type="button" className={"ss-sw" + (bg === c ? " on" : "")} style={{ background: c }} aria-label={`Background ${c}`} onClick={() => setBg(c)} />)}<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background color" /></div>
            </section>
            <section><h3>Shirts</h3>
              <div className="chips">{(views.length > 1 ? (["both", "front", "back"] as Sides[]) : (["front"] as Sides[])).map((k) => <button key={k} type="button" className={"chip" + (sides === k || views.length < 2 ? " on" : "")} onClick={() => setSides(k)}>{k === "both" ? "Front and back" : k === "front" ? "Front" : "Back"}</button>)}</div>
              <label className="check"><input type="checkbox" checked={autoRow} onChange={(e) => setAutoRow(e.target.checked)} /> Per row: Auto (biggest shirts)</label>
              {!autoRow && <label className="mk-f"><span>Per row: {perRow}</span><input type="range" min={1} max={8} step={1} value={perRow} onChange={(e) => setPerRow(+e.target.value)} /></label>}
              <label className="mk-f"><span>Space between: {gap === 0 ? "none" : gap < 1.5 ? "tight" : gap < 4 ? "medium" : "roomy"}</span><input type="range" min={0} max={8} step={0.25} value={gap} onChange={(e) => setGap(+e.target.value)} /></label>
              {sideList.length > 1 && <label className="mk-f"><span>Front to back: {pairGap < 0 ? "overlapping" : pairGap === 0 ? "touching" : pairGap < 1.5 ? "close" : pairGap < 3.5 ? "medium" : "apart"}</span><input type="range" min={-8} max={6} step={0.25} value={pairGap} onChange={(e) => setPairGap(+e.target.value)} /></label>}
              <label className="mk-f"><span>Shirt size: {size}%</span><input type="range" min={50} max={100} step={1} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Color names</label>
              {names && <label className="mk-f"><span>Name size: {labelSize}</span><input type="range" min={16} max={60} step={1} value={labelSize} onChange={(e) => setLabelSize(+e.target.value)} /></label>}
              {names && multiStyle && <label className="check"><input type="checkbox" checked={styleUnder} onChange={(e) => setStyleUnder(e.target.checked)} /> Style under the name</label>}
            </section>
            <section><h3>Colors</h3>
              <ul className="ss-colors">{order.map((k, i) => { const c = colors.find((z) => z.key === k); if (!c) return null; return (
                <li key={k}><label className="check"><input type="checkbox" checked={!off.has(k)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} /> {c.color}{multiStyle && <span className="faint"> · {c.style}</span>}</label>
                  <span className="ss-ord"><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} up`} disabled={i === 0} onClick={() => moveColor(k, -1)}>↑</button><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} down`} disabled={i === order.length - 1} onClick={() => moveColor(k, 1)}>↓</button></span></li>); })}</ul>
            </section>
            <section><h3>Header</h3>
              <label className="mk-f"><span>Title</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 Club Shirts" /></label>
              <label className="mk-f"><span>Subtitle</span><input type="text" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Pick your color · $25 each · order by Nov 1" /></label>
              <label className="mk-f"><span>Title size: {titleSize}</span><input type="range" min={28} max={120} step={2} value={titleSize} onChange={(e) => setTitleSize(+e.target.value)} /></label>
              <div className="chips"><button type="button" className={"chip" + (align === "center" ? " on" : "")} onClick={() => setAlign("center")}>Centered</button><button type="button" className={"chip" + (align === "left" ? " on" : "")} onClick={() => setAlign("left")}>Left</button></div>
              {customer && <label className="check"><input type="checkbox" checked={theirs} onChange={(e) => setTheirs(e.target.checked)} /> Their name ({customer})</label>}
              <label className="check"><input type="checkbox" checked={ours} onChange={(e) => setOurs(e.target.checked)} /> Our logo</label>
              <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} /> Our contact line at the bottom</label>
            </section>
            <section><h3>Text and pictures</h3>
              <div className="row" style={{ gap: 6 }}><button type="button" className="btn sm" onClick={addText}>+ Add text</button><label className="btn sm">+ Add picture<input type="file" accept="image/*" hidden onChange={(e) => { void addPic(e.target.files?.[0]); e.target.value = ""; }} /></label></div>
              {cur?.kind === "text" && (
                <div className="ss-item">
                  <textarea rows={2} value={cur.text} onChange={(e) => setCur((z) => ({ ...z, text: e.target.value }) as Item)} aria-label="Text" />
                  <label className="mk-f"><span>Size: {cur.size}</span><input type="range" min={14} max={160} step={2} value={cur.size} onChange={(e) => setCur((z) => ({ ...z, size: +e.target.value }) as Item)} /></label>
                  <div className="ss-row"><input type="color" value={cur.color} onChange={(e) => setCur((z) => ({ ...z, color: e.target.value }) as Item)} aria-label="Text color" />
                    <label className="check"><input type="checkbox" checked={cur.bold} onChange={(e) => setCur((z) => ({ ...z, bold: e.target.checked }) as Item)} /> Bold</label>
                    {(["left", "center", "right"] as CanvasTextAlign[]).map((a) => <button key={a} type="button" className={"chip" + (cur.align === a ? " on" : "")} onClick={() => setCur((z) => ({ ...z, align: a }) as Item)}>{a === "left" ? "Left" : a === "center" ? "Center" : "Right"}</button>)}</div>
                  <button type="button" className="linkbtn ss-del" onClick={() => { setItems((xs) => xs.filter((z) => z.id !== sel)); setSel(""); }}>Remove this text</button>
                </div>
              )}
              {cur?.kind === "pic" && (
                <div className="ss-item">
                  <span className="faint">{cur.name}</span>
                  <label className="mk-f"><span>Size: {Math.round(cur.w * 100)}%</span><input type="range" min={3} max={100} step={1} value={Math.round(cur.w * 100)} onChange={(e) => setCur((z) => ({ ...z, w: +e.target.value / 100 }) as Item)} /></label>
                  <button type="button" className="linkbtn ss-del" onClick={() => { setItems((xs) => xs.filter((z) => z.id !== sel)); setSel(""); }}>Remove this picture</button>
                </div>
              )}
              {!cur && items.length > 0 && <p className="faint" style={{ margin: 0 }}>Click a text or picture on the sheet to change it.</p>}
            </section>
            {err && <div className="pv-err">{err}</div>}
          </aside>
          <div className="ss-stage">
            {busy && <div className="ss-busy">{busy}</div>}
            <canvas ref={cv} className="ss-canvas" style={{ aspectRatio: `${P.w} / ${P.h}`, cursor: drag.current ? "grabbing" : "default" }} data-tick={tick}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          </div>
        </div>
      </div>
    </div>
  );
}
