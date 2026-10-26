"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { PDFJS, PDFJS_WORKER } from "@/lib/artPrep";
import { DTF_DALLAS, sheetFor } from "@/lib/dtfDallas";

/**
 * Gang sheet builder (Heat press; Oct 26, Nick).
 *  - "upload a logo and also the size, and then it just repeats over and over… set the space between so that it like is
 *    easier to cut"; "add another logo… names and numbers for the back, but you have little logos too… figure out how to
 *    efficiently lay out… a button… optimize the sheet"; "you'd need to rotate for efficiency… we pay by square inch…
 *    but we also can't make it too hard to trim… we're doing it with stupid scissors"
 *  - "knock out a color… I want to knock out the white, this doesn't print"
 *  - "multiple sizes for a logo… we need 10 at 4 inches wide, and then we need 22 at 8 inches wide, and then these are
 *    going on a blue shirt, so we're going to knock out the white, and then these are going on a red shirt, so we're
 *    going to knock out the navy"
 *  - "we can't have a file be over 80 megabytes… split into multiple"; "we download in PDF… make sure the resolution is
 *    high enough… on a DTF"; "we use DTF Dallas… their gang sheet sizes… make a pricing tool"
 *
 * Each logo has its versions: a width, how many, the colors knocked out for that shirt, and what it's for (youth, the
 * blue shirts). A size with no art yet prices a job before the art is in. The pieces are laid out in rows across the
 * 22" sheet with the trim gap between, so the sheet cuts apart in straight lines: rows first, then each piece (a small
 * one can stack under another in its column). "Lay it out tightest" tries each piece turned and not, and ways of ordering
 * the rows, and keeps the cheapest, then the least film. The PDF has each version once at 300 dpi of its print size
 * (DTF's resolution), placed as many times as it prints, so files stay small; a layout longer than one file allows (250"
 * at DTF Dallas) or bigger than the size limit is split. The cost is DTF Dallas's price for the sheet length you'd buy.
 */
const DPI = DTF_DALLAS.dpi;
type Ver = { id: string; wIn: number; qty: number; knock: string[]; label: string };
type Logo = { id: string; name: string; /** the art as uploaded (a data URL), "" for a size with no art yet */ src: string; srcW: number; srcH: number; colors: string[]; vers: Ver[];
  /** a size with no art: its own height */ hIn?: number };
/** one version, ready to lay out */
type Piece = { key: string; logo: Logo; ver: Ver; name: string; wIn: number; hIn: number; qty: number };
type Rect = { piece: number; x: number; y: number; w: number; h: number; rot: boolean };
type Layout = { rows: { y: number; h: number }[]; rects: Rect[]; length: number };
type Part = { rects: Rect[]; length: number; buy: { length: number; price: number } };
type Plan = { turn: "as is" | "flat" | "tall"; order: "height" | "area" | "added" };
const uid = () => Math.random().toString(36).slice(2, 9);
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: number) => `$${v.toFixed(2)}`;
const newVer = (wIn = 3, qty = 10): Ver => ({ id: uid(), wIn, qty, knock: [], label: "" });

// ---------- reading a logo ----------
async function readLogo(f: File): Promise<HTMLCanvasElement> {
  if (/pdf|illustrator|postscript/i.test(f.type) || /\.(pdf|ai)$/i.test(f.name)) {
    const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> } }> }> } };
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const page = await (await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise).getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(16, 6000 / Math.max(v1.width, v1.height)) });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(0,0,0,0)" }).promise;
    return trim(c);
  }
  const url = URL.createObjectURL(f);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return trim(c);
  } finally { URL.revokeObjectURL(url); }
}
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = c, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
const hex2 = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
/** the logo's main colors (to knock one out) */
function colorsOf(c: HTMLCanvasElement): string[] {
  const k = Math.min(1, 300 / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  const x = s.getContext("2d", { willReadFrequently: true })!; x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = new Map<number, { k: number; r: number; g: number; b: number }>();
  let tot = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue; tot++;
    const q = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = n.get(q) || { k: 0, r: 0, g: 0, b: 0 }; e.k++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; n.set(q, e);
  }
  return [...n.values()].filter((e) => e.k > tot * 0.015).sort((a, b) => b.k - a.k).slice(0, 8).map((e) => hex2(Math.round(e.r / e.k), Math.round(e.g / e.k), Math.round(e.b / e.k)));
}
/** the art with the knocked-out colors taken out (a soft edge, so no fringe) */
function knocked(img: HTMLImageElement, hexes: string[], w = img.naturalWidth, h = img.naturalHeight): HTMLCanvasElement {
  const o = document.createElement("canvas"); o.width = w; o.height = h;
  const x = o.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
  if (!hexes.length) return o;
  const im = x.getImageData(0, 0, w, h), d = im.data;
  const ks = hexes.map((hx) => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)]);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let best = 1e9; for (const [r, g, b] of ks) best = Math.min(best, Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b));
    if (best < 40) d[i + 3] = 0; else if (best < 70) d[i + 3] = Math.round(d[i + 3] * ((best - 40) / 30));
  }
  x.putImageData(im, 0, 0);
  return o;
}
const loadImg = async (src: string) => { const i = new Image(); i.src = src; await i.decode(); return i; };

// ---------- laying out ----------
/**
 * Rows across the sheet, each piece taking its size plus the gap. In a row pieces sit side by side, and a piece that
 * fits under another in its column stacks there, so the sheet cuts apart in straight lines.
 */
function layOut(ps0: Piece[], W: number, g: number, opt: Plan): Layout | null {
  type P = { piece: number; w: number; h: number; rot: boolean };
  const ps: P[] = [];
  for (let i = 0; i < ps0.length; i++) {
    const it = ps0[i];
    const a = { w: it.wIn + g, h: it.hIn + g }, b = { w: it.hIn + g, h: it.wIn + g };
    const fitA = a.w <= W + 1e-6, fitB = b.w <= W + 1e-6;
    if (!fitA && !fitB) return null;
    const wantRot = opt.turn === "flat" ? it.hIn > it.wIn : opt.turn === "tall" ? it.wIn > it.hIn : false;
    const rot = wantRot ? fitB : !fitA;
    for (let k = 0; k < it.qty; k++) ps.push({ piece: i, w: rot ? b.w : a.w, h: rot ? b.h : a.h, rot });
  }
  if (opt.order === "height") ps.sort((p, q) => q.h - p.h || q.w - p.w);
  else if (opt.order === "area") ps.sort((p, q) => q.w * q.h - p.w * p.h || q.h - p.h);
  type Col = { x: number; w: number; used: number };
  const rows: { y: number; h: number; used: number; cols: Col[] }[] = [], rects: Rect[] = [];
  let length = 0;
  for (const p of ps) {
    let placed = false;
    for (const r of rows) {
      if (p.h > r.h + 1e-6) continue;
      const col = r.cols.find((c) => p.w <= c.w + 1e-6 && c.used + p.h <= r.h + 1e-6);
      if (col) { rects.push({ piece: p.piece, x: col.x, y: r.y + col.used, w: p.w, h: p.h, rot: p.rot }); col.used += p.h; placed = true; break; }
      if (r.used + p.w <= W + 1e-6) { r.cols.push({ x: r.used, w: p.w, used: p.h }); rects.push({ piece: p.piece, x: r.used, y: r.y, w: p.w, h: p.h, rot: p.rot }); r.used += p.w; placed = true; break; }
    }
    if (!placed) {
      rows.push({ y: length, h: p.h, used: p.w, cols: [{ x: 0, w: p.w, used: p.h }] });
      rects.push({ piece: p.piece, x: 0, y: length, w: p.w, h: p.h, rot: p.rot }); length += p.h;
    }
  }
  return { rows: rows.map((r) => ({ y: r.y, h: r.h })), rects, length };
}
/** the files: whole rows, each file no longer than maxLen */
function partsOf(l: Layout, maxLen: number): Part[] {
  const out: Part[] = [];
  let cur: Rect[] = [], start = 0, end = 0;
  for (const r of l.rows) {
    if (cur.length && r.y + r.h - start > maxLen + 1e-6) { out.push({ rects: cur, length: end - start, buy: sheetFor(end - start) }); cur = []; start = r.y; }
    cur.push(...l.rects.filter((x) => x.y >= r.y - 1e-6 && x.y < r.y + r.h - 1e-6).map((x) => ({ ...x, y: x.y - start })));
    end = r.y + r.h;
  }
  if (cur.length) out.push({ rects: cur, length: end - start, buy: sheetFor(end - start) });
  return out;
}
const costOf = (ps: Part[]) => ps.reduce((a, p) => a + p.buy.price, 0);

// ---------- the PDF ----------
async function makePdf(pieces: Piece[], arts: Record<string, HTMLImageElement>, p: Part, W: number, g: number, cutLines: boolean): Promise<Uint8Array> {
  const { PDFDocument, degrees, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const L = p.buy.length, pt = 72;
  const page = doc.addPage([W * pt, L * pt]);
  const emb = new Map<number, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const i of new Set(p.rects.map((r) => r.piece))) {
    const pc = pieces[i];
    // the version at 300 dpi of its print size, its knocked-out colors taken out
    const c = knocked(arts[pc.logo.id], pc.ver.knock, Math.max(1, Math.round(pc.wIn * DPI)), Math.max(1, Math.round(pc.hIn * DPI)));
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!b) throw new Error("A logo couldn't be prepared.");
    emb.set(i, await doc.embedPng(new Uint8Array(await b.arrayBuffer())));
  }
  for (const r of p.rects) {
    const pc = pieces[r.piece], im = emb.get(r.piece)!;
    const bx = r.x + g / 2, by = r.y + g / 2;
    if (!r.rot) page.drawImage(im, { x: bx * pt, y: (L - by - pc.hIn) * pt, width: pc.wIn * pt, height: pc.hIn * pt });
    // turned a quarter: it covers hIn across and wIn down
    else page.drawImage(im, { x: (bx + pc.hIn) * pt, y: (L - by - pc.wIn) * pt, width: pc.wIn * pt, height: pc.hIn * pt, rotate: degrees(90) });
    if (cutLines && g > 0) page.drawRectangle({ x: r.x * pt, y: (L - r.y - r.h) * pt, width: r.w * pt, height: r.h * pt, borderColor: rgb(0.8, 0.15, 0.15), borderWidth: 0.5, borderDashArray: [4, 3] });
  }
  return doc.save();
}

export default function GangSheet() {
  const [logos, setLogos] = useState<Logo[]>([]);
  const [arts, setArts] = useState<Record<string, HTMLImageElement>>({});
  const [err, setErr] = useState(""), [busy, setBusy] = useState(""), [done, setDone] = useState("");
  const [gap, setGap] = useSticky("gang.gap", "0.25");
  const [sheetW, setSheetW] = useSticky("gang.sheetW", "22");
  const [lines, setLines] = useSticky<"screen" | "print">("gang.lines", "screen");
  const [maxMb, setMaxMb] = useSticky("gang.maxMb", "80");
  const [maxLen, setMaxLen] = useSticky("gang.maxLen", String(DTF_DALLAS.maxFileLength));
  const [plan, setPlan] = useState<Plan>({ turn: "as is", order: "added" });
  const [optimized, setOptimized] = useState<{ before: number; beforeCost: number } | null>(null);
  const [shown, setShown] = useState(0);
  const [knockFor, setKnockFor] = useState<string | null>(null);

  const g = Math.max(0, +gap || 0), W = Math.min(DTF_DALLAS.width, Math.max(4, +sheetW || DTF_DALLAS.width));
  const L = Math.max(10, Math.min(DTF_DALLAS.maxFileLength, +maxLen || DTF_DALLAS.maxFileLength));
  const pieces: Piece[] = useMemo(() => logos.flatMap((lg) => lg.vers.map((v) => ({
    key: v.id, logo: lg, ver: v, name: `${lg.name.replace(/\.[^.]+$/, "")}${v.label ? ` (${v.label})` : lg.vers.length > 1 ? ` ${v.wIn}"` : ""}`,
    wIn: v.wIn, hIn: lg.src ? r2((v.wIn * lg.srcH) / lg.srcW) : (lg.hIn || 3), qty: v.qty,
  }))), [logos]);
  const lay = useMemo(() => (pieces.length ? layOut(pieces, W, g, plan) : null), [pieces, W, g, plan]);
  const parts = useMemo(() => (lay ? partsOf(lay, L) : []), [lay, L]);
  const cost = costOf(parts);
  const usedSqIn = pieces.reduce((a, p) => a + p.wIn * p.hIn * p.qty, 0);
  const filmSqIn = parts.reduce((a, p) => a + p.buy.length * W, 0);
  useEffect(() => { setOptimized(null); }, [pieces.length, W, g]);
  // each version drawn with its knocked-out colors, for the preview
  const [verArt, setVerArt] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const pc of pieces) {
      const img = arts[pc.logo.id]; if (!img) continue;
      const want = `${pc.logo.id}|${pc.ver.knock.join(",")}`;
      if (verArt[pc.key]?.startsWith(want + "#")) continue;
      const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const url = knocked(img, pc.ver.knock, Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k))).toDataURL("image/png");
      setVerArt((m) => ({ ...m, [pc.key]: `${want}#${url}` }));
    }
  }, [pieces, arts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [verImg, setVerImg] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => { for (const [k, v] of Object.entries(verArt)) { const url = v.slice(v.indexOf("#") + 1); if (verImg[k]?.src !== url) void loadImg(url).then((im) => setVerImg((m) => ({ ...m, [k]: im }))); } }, [verArt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr(""); setDone("");
    for (const f of [...files]) {
      setBusy(`Reading ${f.name}…`);
      try {
        const c = await readLogo(f);
        const src = c.toDataURL("image/png");
        const lg: Logo = { id: uid(), name: f.name, src, srcW: c.width, srcH: c.height, colors: colorsOf(c), vers: [newVer()] };
        const img = await loadImg(src);
        setArts((m) => ({ ...m, [lg.id]: img }));
        setLogos((xs) => [...xs, lg]);
      } catch { setErr(`${f.name} couldn't be read. Use a PNG, JPG, PDF or AI file.`); }
    }
    setBusy("");
  }
  const addSize = () => setLogos((xs) => [...xs, { id: uid(), name: `Size ${xs.filter((x) => !x.src).length + 1}`, src: "", srcW: 0, srcH: 0, colors: [], vers: [newVer()], hIn: 3 }]);
  const patchLogo = (id: string, p: Partial<Logo>) => setLogos((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const patchVer = (lid: string, vid: string, p: Partial<Ver>) => setLogos((xs) => xs.map((x) => (x.id !== lid ? x : { ...x, vers: x.vers.map((v) => (v.id === vid ? { ...v, ...p } : v)) })));

  // "Lay it out tightest": each piece turned or not and ways of ordering the rows; the cheapest wins, then the least film
  function tightest() {
    if (!pieces.length) return;
    const before = lay ? partsOf(lay, L) : [];
    let best: { p: Plan; parts: Part[]; len: number } | null = null;
    for (const turn of ["as is", "flat", "tall"] as const) for (const order of ["height", "area", "added"] as const) {
      const l = layOut(pieces, W, g, { turn, order }); if (!l) continue;
      const ps = partsOf(l, L), len = ps.reduce((a, p) => a + p.length, 0), c = costOf(ps);
      if (!best || c < costOf(best.parts) - 0.005 || (Math.abs(c - costOf(best.parts)) < 0.005 && len < best.len - 0.01)) best = { p: { turn, order }, parts: ps, len };
    }
    if (best) { setPlan(best.p); setOptimized({ before: before.reduce((a, p) => a + p.length, 0), beforeCost: costOf(before) }); setShown(0); }
  }

  // the preview: the file picked, small
  const pv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = pv.current, p = parts[Math.min(shown, parts.length - 1)]; if (!c || !p) return;
    const k = Math.min(30, 620 / W);
    c.width = Math.round(W * k); c.height = Math.round(p.buy.length * k);
    const x = c.getContext("2d")!; x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = "rgba(24,95,165,.07)"; x.fillRect(0, p.length * k, c.width, (p.buy.length - p.length) * k);
    for (const r of p.rects) {
      const pc = pieces[r.piece], im = verImg[pc.key];
      const bx = (r.x + g / 2) * k, by = (r.y + g / 2) * k;
      x.save();
      // turned the same way as in the PDF (its top to the left)
      if (r.rot) { x.translate(bx, by + pc.wIn * k); x.rotate(-Math.PI / 2); } else x.translate(bx, by);
      if (pc.logo.src && im) x.drawImage(im, 0, 0, pc.wIn * k, pc.hIn * k);
      else { x.fillStyle = "#c9d3df"; x.fillRect(0, 0, pc.wIn * k, pc.hIn * k); x.fillStyle = "#52637a"; x.font = `${Math.max(9, Math.min(13, pc.hIn * k * 0.3))}px sans-serif`; x.fillText(pc.name, 4, Math.min(pc.hIn * k - 4, 15)); }
      x.restore();
      if (g > 0) { x.save(); x.strokeStyle = "rgba(200,40,40,.75)"; x.setLineDash([4, 3]); x.lineWidth = 1; x.strokeRect(r.x * k + 0.5, r.y * k + 0.5, r.w * k - 1, r.h * k - 1); x.restore(); }
    }
  }, [parts, shown, pieces, verImg, W, g]);

  async function download() {
    if (!parts.length) return;
    const blank = logos.find((x) => !x.src);
    if (blank) { setErr(`"${blank.name}" is just a size: upload its art to make the file.`); return; }
    const limit = Math.max(5, +maxMb || 80) * 1048576;
    setErr(""); setDone("");
    try {
      const files: { bytes: Uint8Array; p: Part }[] = [];
      const queue = [...parts];
      while (queue.length) {
        const p = queue.shift()!;
        setBusy(`Making file ${files.length + 1} of ${files.length + queue.length + 1}…`);
        const bytes = await makePdf(pieces, arts, p, W, g, lines === "print");
        // over the size limit: its rows in two files
        const rowsY = [...new Set(p.rects.map((r) => r.y))].sort((a, b) => a - b);
        if (bytes.byteLength > limit && rowsY.length > 1) {
          const cut = rowsY[Math.ceil(rowsY.length / 2)];
          const a = p.rects.filter((r) => r.y < cut), b = p.rects.filter((r) => r.y >= cut).map((r) => ({ ...r, y: r.y - cut }));
          const la = Math.max(...a.map((r) => r.y + r.h)), lb = Math.max(...b.map((r) => r.y + r.h));
          queue.unshift({ rects: a, length: la, buy: sheetFor(la) }, { rects: b, length: lb, buy: sheetFor(lb) });
          continue;
        }
        files.push({ bytes, p });
      }
      const base = (logos[0]?.name || "gang").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 30);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const u = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: "application/pdf" }));
        const a = document.createElement("a"); a.href = u; a.download = `${base}-gang-${W}x${f.p.buy.length}-${i + 1}of${files.length}.pdf`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 60000);
        await new Promise((r) => setTimeout(r, 400));
      }
      setBusy("");
      const big = Math.max(...files.map((f) => f.bytes.byteLength));
      setDone(`${files.length} PDF${files.length === 1 ? "" : "s"} downloaded (largest ${(big / 1048576).toFixed(1)} MB). Buy ${files.map((f) => `${W}" × ${f.p.buy.length}"`).join(", ")} at ${DTF_DALLAS.name}: ${money(costOf(files.map((f) => f.p)))}.`);
    } catch (e) { setBusy(""); setErr(e instanceof Error ? e.message : "The files couldn't be made."); }
  }

  const film = parts.reduce((a, p) => a + p.length, 0);
  const n = pieces.reduce((a, p) => a + p.qty, 0);
  const cur = parts[Math.min(shown, Math.max(0, parts.length - 1))];
  const each = (pc: Piece) => (usedSqIn ? (cost * pc.wIn * pc.hIn) / usedSqIn : 0);
  return (
    <>
      <div className="page-head">
        <div><h1>Gang sheet builder</h1><div className="eyebrow">Heat press: logos laid out on a DTF sheet, priced and ready to upload to {DTF_DALLAS.name}</div></div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href={DTF_DALLAS.url} target="_blank" rel="noreferrer">Open {DTF_DALLAS.name}</a>
          {logos.length > 0 && <button type="button" className="btn" onClick={() => { setLogos([]); setOptimized(null); setDone(""); setErr(""); }}>Clear</button>}
          <button type="button" className="btn primary" disabled={!parts.length || !!busy} onClick={() => void download()}>{busy || "Download PDF"}</button>
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="pv-err sow-msg" role="status">{done}</div>}
      <div className="gang">
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Logos</h2><span className="faint">each size or color you need is its own line</span></div>
            <div className="panel-b stack" style={{ gap: 12 }}>
              {logos.map((lg) => (
                <div key={lg.id} className="gang-item">
                  <div className="gang-item-h">
                    <div className="gang-pic">{lg.src ? <img src={lg.src} alt="" /> : <span className="faint">Size only</span>}</div>
                    {lg.src ? <b data-notranslate title={lg.name}>{lg.name}</b> : <input type="text" value={lg.name} onChange={(e) => patchLogo(lg.id, { name: e.target.value })} aria-label="Name" />}
                    <span className="spacer" />
                    <button type="button" className="btn icon ghost" aria-label="Remove this logo" title="Remove this logo" onClick={() => setLogos((xs) => xs.filter((x) => x.id !== lg.id))}>×</button>
                  </div>
                  {lg.src && Math.max(...lg.vers.map((v) => v.wIn)) > 0 && Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn))) < 200 && <p className="gang-warn">About {Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn)))} dpi at {Math.max(...lg.vers.map((v) => v.wIn))}&quot; wide (DTF wants 300): it may print soft. A bigger file or a vector prints sharper.</p>}
                  <div className="gang-vers">
                    <div className="gang-ver gang-ver-h"><span>Width (in)</span><span>Height</span><span>How many</span><span>For</span><span /></div>
                    {lg.vers.map((v) => (
                      <div key={v.id}>
                        <div className="gang-ver">
                          <input type="number" min="0.25" step="0.05" value={v.wIn} aria-label="Width in inches" onChange={(e) => patchVer(lg.id, v.id, { wIn: Math.max(0.25, +e.target.value || 0) })} />
                          {lg.src ? <span className="num">{r2((v.wIn * lg.srcH) / lg.srcW)}&quot;</span> : <input type="number" min="0.25" step="0.05" value={lg.hIn || 3} aria-label="Height in inches" onChange={(e) => patchLogo(lg.id, { hIn: Math.max(0.25, +e.target.value || 0) })} />}
                          <input type="number" min="1" step="1" value={v.qty} aria-label="How many" onChange={(e) => patchVer(lg.id, v.id, { qty: Math.max(1, Math.round(+e.target.value || 1)) })} />
                          <input type="text" value={v.label} placeholder="Youth, blue shirts…" aria-label="What it's for" onChange={(e) => patchVer(lg.id, v.id, { label: e.target.value })} />
                          {lg.vers.length > 1 ? <button type="button" className="btn icon ghost" aria-label="Remove this size" title="Remove this size" onClick={() => patchLogo(lg.id, { vers: lg.vers.filter((x) => x.id !== v.id) })}>×</button> : <span />}
                        </div>
                        {lg.src && lg.colors.length > 0 && (
                          <div className="gang-knock">
                            <button type="button" className="lc-link" onClick={() => setKnockFor(knockFor === v.id ? null : v.id)}>{v.knock.length ? `Knocked out: ${v.knock.length} color${v.knock.length === 1 ? "" : "s"}` : "Knock out a color"}</button>
                            {v.knock.map((h) => <i key={h} className="gang-sw sm on" style={{ background: h }} title={`${h} knocked out`} />)}
                            {knockFor === v.id && (
                              <div className="gang-knock-row">
                                <span className="faint">Click a color that doesn&apos;t print on this shirt:</span>
                                {lg.colors.map((h) => <button key={h} type="button" className={"gang-sw" + (v.knock.includes(h) ? " on" : "")} style={{ background: h }} title={v.knock.includes(h) ? `${h}: knocked out (click to put it back)` : `Knock out ${h}`} aria-pressed={v.knock.includes(h)} onClick={() => patchVer(lg.id, v.id, { knock: v.knock.includes(h) ? v.knock.filter((x) => x !== h) : [...v.knock, h] })} />)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    <button type="button" className="lc-link" onClick={() => patchLogo(lg.id, { vers: [...lg.vers, newVer(lg.vers[lg.vers.length - 1]?.wIn || 3, 10)] })}>+ Another size or color of this logo</button>
                  </div>
                </div>
              ))}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="btn">{logos.length ? "Add another logo" : "Upload a logo"}<input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,.ai,.pdf" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} /></label>
                <button type="button" className="btn ghost" onClick={addSize} title="Price a job before the art is in">Add a size (no art yet)</button>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Sheet</h2><span className="faint">{DTF_DALLAS.name}: {DTF_DALLAS.width}&quot; wide, {DTF_DALLAS.dpi} dpi</span></div>
            <div className="panel-b stack" style={{ gap: 10 }}>
              <div className="gang-row3">
                <div className="field"><label htmlFor="g-g">Trim gap (in)</label><input id="g-g" type="number" min="0" step="0.05" value={gap} onChange={(e) => setGap(e.target.value)} /></div>
                <div className="field"><label htmlFor="g-sw">Sheet width (in)</label><input id="g-sw" type="number" min="4" max={DTF_DALLAS.width} step="0.5" value={sheetW} onChange={(e) => setSheetW(String(Math.min(DTF_DALLAS.width, +e.target.value || DTF_DALLAS.width)))} /></div>
                <div className="field"><label htmlFor="g-ml">Longest file (in)</label><input id="g-ml" type="number" min="10" max={DTF_DALLAS.maxFileLength} step="10" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} /></div>
              </div>
              {g < 0.25 && <p className="gang-warn">Under 1/4&quot; between pieces is hard to cut apart with scissors.</p>}
              <div className="gang-row3">
                <div className="field"><label htmlFor="g-mb">Largest file (MB)</label><input id="g-mb" type="number" min="5" step="1" value={maxMb} onChange={(e) => setMaxMb(e.target.value)} /></div>
                <div className="field" style={{ gridColumn: "span 2" }}><label>Cut lines</label>
                  <div className="chips">
                    <button type="button" className={"chip" + (lines === "screen" ? " on" : "")} onClick={() => setLines("screen")}>On screen only</button>
                    <button type="button" className={"chip" + (lines === "print" ? " on" : "")} onClick={() => setLines("print")}>Print them</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="panel-h"><h2>Layout and cost</h2>
            <button type="button" className="btn sm" disabled={!pieces.length} onClick={tightest} title="Tries each piece turned and not, and ways of stacking them, and keeps the one that costs least">Lay it out tightest</button>
          </div>
          <div className="panel-b">
            {!pieces.length ? <p className="faint">Upload a logo, or add a size to price a job before the art is in.</p> : !lay ? <p className="gang-warn">A piece is wider than the {W}&quot; sheet even turned. Make it smaller.</p> : (
              <>
                <div className="stats gang-sum">
                  <button type="button" className="stat"><span className="v">{money(cost)}</span><span className="k">{DTF_DALLAS.name} cost</span></button>
                  <button type="button" className="stat"><span className="v">{r2(film)}&quot;</span><span className="k">Film used</span></button>
                  <button type="button" className="stat"><span className="v">{n ? money(cost / n) : "—"}</span><span className="k">Per transfer, average</span></button>
                  <button type="button" className="stat"><span className="v">{filmSqIn ? `${Math.round((usedSqIn / filmSqIn) * 100)}%` : "—"}</span><span className="k">Film covered by art</span></button>
                </div>
                {optimized && (optimized.before - film > 0.05 ? <p className="puff-ok">Laid out tightest: {r2(optimized.before - film)}&quot; less film{optimized.beforeCost - cost > 0.005 ? `, ${money(optimized.beforeCost - cost)} less` : ""}.</p> : <p className="faint" style={{ fontSize: 12.5 }}>Already as tight as it gets.</p>)}
                <div className="tbl-wrap" style={{ margin: "10px 0" }}><table className="tbl">
                  <thead><tr><th>Piece</th><th className="r">Size</th><th className="r">How many</th><th className="r">Each</th></tr></thead>
                  <tbody>{pieces.map((pc) => <tr key={pc.key}><td data-notranslate>{pc.name}</td><td className="r num">{pc.wIn}&quot; × {pc.hIn}&quot;</td><td className="r num">{pc.qty}</td><td className="r num">{money(each(pc))}</td></tr>)}</tbody>
                </table></div>
                <div className="tbl-wrap" style={{ margin: "10px 0" }}><table className="tbl">
                  <thead><tr><th>File</th><th>Layout</th><th>Buy</th><th className="r">Price</th></tr></thead>
                  <tbody>{parts.map((p, i) => <tr key={i} onClick={() => setShown(i)} style={{ cursor: "pointer", fontWeight: i === Math.min(shown, parts.length - 1) && parts.length > 1 ? 700 : undefined }}><td>{i + 1}</td><td className="num">{r2(p.length)}&quot; long · {p.rects.length} pcs</td><td className="num">{W}&quot; × {p.buy.length}&quot;</td><td className="r num">{money(p.buy.price)}</td></tr>)}</tbody>
                </table></div>
                {cur && <div className="gang-sheet"><canvas ref={pv} /></div>}
                <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Rows across the sheet with the trim gap between: cut the rows apart, then each piece. The PDF has each version once at {DPI} dpi of its print size, so files stay small. Prices: {DTF_DALLAS.name}&apos;s gang sheets, {DTF_DALLAS.checked}. Ordering is on their site: download, then upload it there.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
