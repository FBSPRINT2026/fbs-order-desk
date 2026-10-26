"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { PDFJS, PDFJS_WORKER } from "@/lib/artPrep";
import { DTF_DALLAS, sheetFor } from "@/lib/dtfDallas";

/**
 * Gang sheet builder (Heat press; Oct 26, Nick).
 *  - "upload a logo and also the size, and then it just repeats over and over… set the space between so that it like is
 *    easier to cut"; "add another logo… names and numbers for the back, but you have little logos too… figure out how to
 *    efficiently lay out… a button… optimize the sheet"; "you'd need to rotate for efficiency… we pay by square inch…
 *    but we also can't make it too hard to trim… we're doing it with stupid scissors"
 *  - "knock out a color… I want to knock out the white, this doesn't print"
 *  - "multiple sizes for a logo… we need 10 at 4 inches wide, and then we need 22 at 8 inches wide… blue shirt, so
 *    we're going to knock out the white… red shirt, so we're going to knock out the navy"
 *  - "we can't have a file be over 80 megabytes… split into multiple"; "we download in PDF… make sure the resolution is
 *    high enough… on a DTF"; "we use DTF Dallas… their gang sheet sizes… make a pricing tool"
 *  - "save a gang sheet and come back to it and add to it… Claudia viewed her gang sheets… they could view each other's"
 *  - the layout, rethought (Oct 26: "now that we have put on all the functionality… it just needs to just all be
 *    rethought"): a small box of the saved sheets first (the most recent, the rest under each person's name), the actions on top; art cards with a size table
 *    (W × H, how many, what for, the colors to knock out as dots); the order panel under them (the job it's for, which
 *    art, a production note: "bust that out from the logo selection itself"); the cost, then Sheet / Pieces / Files with
 *    the preview filling the space, fitted to its width as the window changes.
 *
 * The pieces are laid out in rows across the 22" sheet with the trim gap between, so the sheet cuts apart in straight
 * lines: rows first, then each piece (a small one can stack under another in its column). "Optimize sheet" tries each
 * piece turned and not, and ways of ordering the rows, and keeps the cheapest, then the least film. The PDF has each
 * version once at 300 dpi of its print size (DTF's resolution), placed as many times as it prints, so files stay small;
 * a layout longer than one file allows (250" at DTF Dallas) or bigger than the size limit is split. Cut lines are on
 * screen only (they'd print on the film). The cost is DTF Dallas's price for the sheet length you'd buy.
 */
const DPI = DTF_DALLAS.dpi;
type Ver = { id: string; wIn: number; qty: number; knock: string[]; label: string; /** a size with no art: its height */ hIn?: number };
type Logo = { id: string; name: string; /** the art (a data URL or a signed link), "" for a size with no art yet */ src: string; srcW: number; srcH: number; colors: string[]; vers: Ver[];
  /** older sheets: a size with no art's height */ hIn?: number;
  /** where the art is kept once the sheet is saved (storage proofs/gang/…) */ path?: string;
  /** older sheets: the job on the logo (now in jobs) */ job?: string };
/** the job a sheet is for: its number, which art goes to it (all when none picked) and a note for its production notes */
type Job = { id: string; job: string; logos: string[]; note: string };
type SheetRow = { id: string; name: string; owner: string; status: string; updated_at: string; ordered_at: string | null; supplier_order: string | null; expected: string | null; data: SheetData };
type SheetData = { logos?: Logo[]; jobs?: Job[]; gap?: string; sheetW?: string; maxLen?: string; plan?: Plan; files?: { path: string; name: string; length: number; at: string }[]; noted?: string[] };
/** one version, ready to lay out */
type Piece = { key: string; logo: Logo; ver: Ver; name: string; wIn: number; hIn: number; qty: number };
type Rect = { piece: number; x: number; y: number; w: number; h: number; rot: boolean };
type Layout = { rows: { y: number; h: number }[]; rects: Rect[]; length: number };
type Part = { rects: Rect[]; length: number; buy: { length: number; price: number } };
type Plan = { turn: "as is" | "flat" | "tall"; order: "height" | "area" | "added" };
const uid = () => Math.random().toString(36).slice(2, 9);
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: number) => `$${v.toFixed(2)}`;
const newVer = (wIn = 3, qty = 10, hIn?: number): Ver => ({ id: uid(), wIn, qty, knock: [], label: "", ...(hIn ? { hIn } : {}) });

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
const loadImg = async (src: string) => { const i = new Image(); i.crossOrigin = "anonymous"; i.src = src; await i.decode(); return i; };

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
// cut lines show on screen only, never in the file: they'd print on the film (Oct 26, Nick)
async function makePdf(pieces: Piece[], arts: Record<string, HTMLImageElement>, p: Part, W: number, g: number): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import("pdf-lib");
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
  }
  return doc.save();
}


const heightOf = (lg: Logo, v: Ver) => (lg.src ? r2((v.wIn * lg.srcH) / Math.max(1, lg.srcW)) : v.hIn || lg.hIn || 3);
const shortName = (n: string) => n.replace(/\.[^.]+$/, "");

export default function GangSheet() {
  const sb = useMemo(() => createClient(), []);
  const { email: me0, staffName } = useRole();
  const me = (me0 || "").toLowerCase();
  const [logos, setLogos] = useState<Logo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [arts, setArts] = useState<Record<string, HTMLImageElement>>({});
  const [err, setErr] = useState(""), [busy, setBusy] = useState(""), [done, setDone] = useState("");
  const [gap, setGap] = useSticky("gang.gap", "0.25");
  const [sheetW, setSheetW] = useSticky("gang.sheetW", "22");
  const [maxMb, setMaxMb] = useSticky("gang.maxMb", "80");
  const [maxLen, setMaxLen] = useSticky("gang.maxLen", String(DTF_DALLAS.maxFileLength));
  const [plan, setPlan] = useState<Plan>({ turn: "as is", order: "added" });
  const [optimized, setOptimized] = useState<{ before: number; beforeCost: number } | null>(null);
  const [shown, setShown] = useState(0);
  const [tab, setTab] = useSticky<"sheet" | "pieces" | "files">("gang.tab", "sheet");
  const [zoom, setZoom] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const g = Math.max(0, +gap || 0), W = Math.min(DTF_DALLAS.width, Math.max(4, +sheetW || DTF_DALLAS.width));
  const L = Math.max(10, Math.min(DTF_DALLAS.maxFileLength, +maxLen || DTF_DALLAS.maxFileLength));
  const pieces: Piece[] = useMemo(() => logos.flatMap((lg) => lg.vers.map((v) => ({
    key: v.id, logo: lg, ver: v, name: `${shortName(lg.name)}${v.label ? ` (${v.label})` : lg.vers.length > 1 ? ` ${v.wIn}"` : ""}`,
    wIn: v.wIn, hIn: heightOf(lg, v), qty: v.qty,
  }))), [logos]);
  const lay = useMemo(() => (pieces.length ? layOut(pieces, W, g, plan) : null), [pieces, W, g, plan]);
  const parts = useMemo(() => (lay ? partsOf(lay, L) : []), [lay, L]);
  const cost = costOf(parts);
  const usedSqIn = pieces.reduce((a, p) => a + p.wIn * p.hIn * p.qty, 0);
  const filmSqIn = parts.reduce((a, p) => a + p.buy.length * W, 0);
  const film = parts.reduce((a, p) => a + p.length, 0), bought = parts.reduce((a, p) => a + p.buy.length, 0);
  const n = pieces.reduce((a, p) => a + p.qty, 0);
  useEffect(() => { setOptimized(null); }, [pieces.length, W, g]);

  // each version with its knocked-out colors, for the preview
  const [verImg, setVerImg] = useState<Record<string, { want: string; img: HTMLImageElement }>>({});
  useEffect(() => {
    let live = true;
    for (const pc of pieces) {
      const img = arts[pc.logo.id]; if (!img) continue;
      const want = `${pc.logo.id}|${pc.ver.knock.join(",")}`;
      if (verImg[pc.key]?.want === want) continue;
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const url = knocked(img, pc.ver.knock, Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k))).toDataURL("image/png");
      void loadImg(url).then((im) => { if (live) setVerImg((m) => ({ ...m, [pc.key]: { want, img: im } })); });
    }
    return () => { live = false; };
  }, [pieces, arts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- art ----------
  async function add(files: FileList | File[] | null) {
    const list = files ? [...files] : [];
    if (!list.length) return;
    setErr(""); setDone("");
    for (const f of list) {
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
  const addSize = () => setLogos((xs) => [...xs, { id: uid(), name: `Size ${xs.filter((x) => !x.src).length + 1}`, src: "", srcW: 0, srcH: 0, colors: [], vers: [newVer(3, 10, 3)] }]);
  const patchLogo = (id: string, p: Partial<Logo>) => setLogos((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const patchVer = (lid: string, vid: string, p: Partial<Ver>) => setLogos((xs) => xs.map((x) => (x.id !== lid ? x : { ...x, vers: x.vers.map((v) => (v.id === vid ? { ...v, ...p } : v)) })));
  // a new size keeps the shape of the first one: 3 × 3 at 4" wide is 4 × 4, not 4 × 3 (Oct 26, Nick)
  const addVer = (lg: Logo) => {
    const last = lg.vers[lg.vers.length - 1], w = last?.wIn || 3;
    const h = lg.src ? undefined : r2((w * heightOf(lg, lg.vers[0] || last)) / Math.max(0.01, lg.vers[0]?.wIn || w));
    patchLogo(lg.id, { vers: [...lg.vers, newVer(w, 10, h)] });
  };
  /** a size with no art: the width changed, the height keeps its shape */
  const setW = (lg: Logo, v: Ver, w: number) => patchVer(lg.id, v.id, lg.src ? { wIn: w } : { wIn: w, hIn: r2((w * heightOf(lg, v)) / Math.max(0.01, v.wIn)) });
  const toggleKnock = (lg: Logo, v: Ver, h: string) => patchVer(lg.id, v.id, { knock: v.knock.includes(h) ? v.knock.filter((x) => x !== h) : [...v.knock, h] });

  // "Optimize sheet": each piece turned or not and ways of ordering the rows; the cheapest wins, then the least film
  function optimize() {
    if (!pieces.length) return;
    const before = lay ? partsOf(lay, L) : [];
    let best: { p: Plan; parts: Part[]; len: number } | null = null;
    for (const turn of ["as is", "flat", "tall"] as const) for (const order of ["height", "area", "added"] as const) {
      const l = layOut(pieces, W, g, { turn, order }); if (!l) continue;
      const ps = partsOf(l, L), len = ps.reduce((a, p) => a + p.length, 0), c = costOf(ps);
      if (!best || c < costOf(best.parts) - 0.005 || (Math.abs(c - costOf(best.parts)) < 0.005 && len < best.len - 0.01)) best = { p: { turn, order }, parts: ps, len };
    }
    if (best) { setPlan(best.p); setOptimized({ before: before.reduce((a, p) => a + p.length, 0), beforeCost: costOf(before) }); setShown(0); setTab("sheet"); }
  }

  // ---------- the preview: fits its box's width, and follows the window ----------
  const box = useRef<HTMLDivElement>(null), pv = useRef<HTMLCanvasElement>(null);
  const [boxW, setBoxW] = useState(800);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [tab, pieces.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = pv.current, p = parts[Math.min(shown, parts.length - 1)]; if (!c || !p) return;
    const fit = Math.max(4, (boxW - 18) / W);
    const k = Math.min(fit * zoom, 30000 / Math.max(1, p.buy.length) / (window.devicePixelRatio || 1));
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * k * dpr); c.height = Math.round(p.buy.length * k * dpr);
    c.style.width = `${Math.round(W * k)}px`; c.style.height = `${Math.round(p.buy.length * k)}px`;
    const x = c.getContext("2d")!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W * k, p.buy.length * k);
    // the film you buy past the layout
    x.fillStyle = "rgba(24,95,165,.07)"; x.fillRect(0, p.length * k, W * k, (p.buy.length - p.length) * k);
    for (const r of p.rects) {
      const pc = pieces[r.piece], im = verImg[pc.key]?.img;
      const bx = (r.x + g / 2) * k, by = (r.y + g / 2) * k;
      x.save();
      // turned the same way as in the PDF (its top to the left)
      if (r.rot) { x.translate(bx, by + pc.wIn * k); x.rotate(-Math.PI / 2); } else x.translate(bx, by);
      if (pc.logo.src && im) x.drawImage(im, 0, 0, pc.wIn * k, pc.hIn * k);
      else { x.fillStyle = "#d7dee7"; x.fillRect(0, 0, pc.wIn * k, pc.hIn * k); x.fillStyle = "#52637a"; x.font = `${Math.max(10, Math.min(15, pc.hIn * k * 0.22))}px sans-serif`; x.fillText(`${pc.name} ${pc.wIn}×${pc.hIn}`, 6, Math.min(pc.hIn * k - 6, 18)); }
      x.restore();
      if (g > 0) { x.save(); x.strokeStyle = "rgba(200,40,40,.7)"; x.setLineDash([5, 4]); x.lineWidth = 1; x.strokeRect(r.x * k + 0.5, r.y * k + 0.5, r.w * k - 1, r.h * k - 1); x.restore(); }
    }
  }, [parts, shown, pieces, verImg, W, g, zoom, boxW, tab]);

  // ---------- saved sheets ----------
  const [sheetId, setSheetId] = useSticky("gang.sheet", "");
  const [sheetName, setSheetName] = useState("");
  const [row, setRow] = useState<SheetRow | null>(null);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [saveState, setSaveState] = useState("");
  const loading = useRef(false), saving = useRef<Promise<string> | null>(null);
  const listSheets = async () => {
    const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, data").is("archived_at", null).order("updated_at", { ascending: false }).limit(80);
    setSheets((data || []) as SheetRow[]);
  };
  useEffect(() => { void listSheets(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function openSheet(id: string) {
    loading.current = true;
    if (!id) { setRow(null); setSheetId(""); setSheetName(""); setLogos([]); setJobs([]); setArts({}); setOptimized(null); setDone(""); setErr(""); setTimeout(() => { loading.current = false; }, 50); return; }
    const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, data").eq("id", id).maybeSingle();
    if (!data) { setSheetId(""); loading.current = false; return; }
    const r = data as SheetRow, d = r.data || {};
    const lgs = d.logos || [];
    const paths = lgs.filter((x) => x.path).map((x) => x.path!);
    const signed = paths.length ? (await sb.storage.from("proofs").createSignedUrls(paths, 3600 * 8)).data || [] : [];
    const url = new Map(signed.map((x) => [x.path, x.signedUrl]));
    // older sheets: a size with no art kept its height on the logo; the job on each logo
    const withSrc = lgs.map((x) => ({ ...x, src: x.path ? url.get(x.path) || "" : x.src || "", vers: x.vers.map((v) => (!x.path && !x.src && !v.hIn ? { ...v, hIn: x.hIn || 3 } : v)) }));
    const oldJobs: Job[] = [...new Set(lgs.map((x) => x.job).filter(Boolean) as string[])].map((j) => ({ id: uid(), job: j, logos: lgs.filter((x) => x.job === j).map((x) => x.id), note: "" }));
    const imgs: Record<string, HTMLImageElement> = {};
    await Promise.all(withSrc.filter((x) => x.src).map(async (x) => { try { imgs[x.id] = await loadImg(x.src); } catch { /* art gone */ } }));
    setRow(r); setSheetId(r.id); setSheetName(r.name);
    setArts(imgs); setLogos(withSrc); setJobs(d.jobs || oldJobs);
    if (d.gap) setGap(d.gap); if (d.sheetW) setSheetW(d.sheetW); if (d.maxLen) setMaxLen(d.maxLen); if (d.plan) setPlan(d.plan);
    setOptimized(null); setShown(0); setDone(""); setErr("");
    setTimeout(() => { loading.current = false; }, 50);
  }
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("sheet");
    if (q || sheetId) void openSheet(q || sheetId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** save now: makes the sheet the first time, keeps the art in storage, then the logos, jobs and settings */
  async function save(extra: Partial<SheetData> = {}): Promise<string> {
    if (saving.current) await saving.current.catch(() => "");
    const run = (async () => {
      setSaveState("Saving…");
      let id = sheetId;
      const first = (staffName || me.split("@")[0] || "").split(" ")[0];
      const name0 = sheetName.trim() || `${first ? first[0].toUpperCase() + first.slice(1) + "'s" : "A"} sheet · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      if (!id) {
        const { data, error } = await sb.from("gang_sheets").insert({ name: name0, owner: me, data: {} }).select("id").single();
        if (error || !data) { setSaveState("Not saved"); throw new Error(error?.message || "Couldn't save the sheet."); }
        id = data.id as string; setSheetId(id); setSheetName(name0);
      }
      const stored: Logo[] = [];
      for (const lg of logos) {
        if (lg.src && !lg.path && lg.src.startsWith("data:")) {
          const path = `gang/${id}/${lg.id}.png`;
          const up = await sb.storage.from("proofs").upload(path, await (await fetch(lg.src)).blob(), { contentType: "image/png", upsert: true });
          stored.push(up.error ? lg : { ...lg, path });
        } else stored.push(lg);
      }
      if (stored.some((x, i) => x.path !== logos[i].path)) setLogos((xs) => xs.map((x) => { const s2 = stored.find((y) => y.id === x.id); return s2?.path && !x.path ? { ...x, path: s2.path } : x; }));
      const data: SheetData = { ...(row?.data || {}), logos: stored.map(({ src, job: _j, ...x }) => (x.path ? x : { ...x, src })), jobs, gap, sheetW, maxLen, plan, ...extra };
      const nm = sheetName.trim() || name0;
      const { error } = await sb.from("gang_sheets").update({ name: nm, data, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) { setSaveState("Not saved"); throw new Error(error.message); }
      setRow((r) => (r && r.id === id ? { ...r, data, name: nm } : { id, name: nm, owner: me, status: "open", updated_at: new Date().toISOString(), ordered_at: null, supplier_order: null, expected: null, data }));
      setSaveState("Saved");
      void listSheets();
      return id;
    })();
    saving.current = run;
    return run;
  }
  useEffect(() => {
    if (loading.current || (!logos.length && !sheetId)) return;
    const t = setTimeout(() => { void save().catch((e) => setErr(e instanceof Error ? e.message : "Couldn't save the sheet.")); }, 1200);
    return () => clearTimeout(t);
  }, [logos, jobs, gap, sheetW, maxLen, plan, sheetName]); // eslint-disable-line react-hooks/exhaustive-deps
  async function markOrdered() {
    const id = await save();
    await sb.from("gang_sheets").update({ status: "ordered", ordered_at: new Date().toISOString(), ordered_by: me }).eq("id", id);
    setRow((r) => (r ? { ...r, status: "ordered", ordered_at: new Date().toISOString() } : r));
    setDone(`Marked ordered. When ${DTF_DALLAS.name}'s confirmation comes in, its order number and date go in the jobs' production notes.`);
    void listSheets();
  }
  async function pullFrom(id: string) {
    if (!id) return;
    const { data } = await sb.from("gang_sheets").select("name, data").eq("id", id).maybeSingle();
    const d = (data?.data as SheetData | null) || {}, lg = d.logos || [];
    if (!lg.length) return;
    const paths = lg.filter((x) => x.path).map((x) => x.path!);
    const signed = paths.length ? (await sb.storage.from("proofs").createSignedUrls(paths, 3600 * 8)).data || [] : [];
    const url = new Map(signed.map((x) => [x.path, x.signedUrl]));
    const ids = new Map<string, string>();
    const copies = lg.map((x) => { const nid = uid(); ids.set(x.id, nid); return { ...x, id: nid, vers: x.vers.map((v) => ({ ...v, id: uid() })), src: x.path ? url.get(x.path) || "" : x.src }; });
    const imgs: Record<string, HTMLImageElement> = {};
    await Promise.all(copies.filter((x) => x.src).map(async (x) => { try { imgs[x.id] = await loadImg(x.src); } catch { /* gone */ } }));
    setArts((m) => ({ ...m, ...imgs }));
    setLogos((xs) => [...xs, ...copies]);
    // their jobs come too, pointing at the copies
    const theirJobs = (d.jobs || []).map((j) => ({ ...j, id: uid(), logos: j.logos.map((x) => ids.get(x) || "").filter(Boolean) }));
    if (theirJobs.length) setJobs((js) => [...js, ...theirJobs]);
    setDone(`Added ${copies.length} logo${copies.length === 1 ? "" : "s"} from "${data?.name || "that sheet"}".`);
  }

  // ---------- the order it's for (Oct 26, Nick: "at the bottom, put the order information… this is for this invoice.
  // Here's the production notes… bust that out from the logo selection itself") ----------
  const jobArt = (j: Job) => (j.logos.length ? logos.filter((x) => j.logos.includes(x.id)) : logos);
  const [orderOf, setOrderOf] = useState<Record<string, { id: string; label: string } | null>>({});
  useEffect(() => {
    const want = [...new Set(jobs.map((j) => j.job).filter((x) => /^\d{3,8}$/.test(x)))].filter((x) => !(x in orderOf));
    if (!want.length) return;
    void (async () => {
      const { data } = await sb.from("orders").select("id, number, nickname, customer_id").in("number", want.map(Number));
      const got: Record<string, { id: string; label: string } | null> = {};
      for (const j of want) { const o = (data || []).find((x) => String(x.number) === j); got[j] = o ? { id: o.id as string, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}` } : null; }
      setOrderOf((m) => ({ ...m, ...got }));
    })();
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchJob = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  /** the downloaded files in each job's production files, its note in its production notes, a link back to the sheet */
  async function fileToJobs(id: string, files: { bytes: Uint8Array; name: string; length: number }[]): Promise<string[]> {
    const at = new Date().toISOString(), stored: { path: string; name: string; length: number; at: string }[] = [];
    for (const f of files) {
      const path = `gang/${id}/files/${Date.now().toString(36)}-${f.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, new Blob([f.bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf" });
      if (!up.error) stored.push({ path, name: f.name, length: f.length, at });
    }
    const noted = new Set(row?.data?.noted || []);
    const notes: string[] = [];
    for (const j of jobs.filter((x) => /^\d{3,8}$/.test(x.job))) {
      const { data: o } = await sb.from("orders").select("id, number").eq("number", +j.job).maybeSingle();
      if (!o) { notes.push(`#${j.job} isn't an order in the portal: not filed`); continue; }
      const art = new Set(jobArt(j).map((x) => x.id));
      const mine = pieces.filter((pc) => art.has(pc.logo.id)).map((pc) => `${pc.qty} × ${pc.name} ${pc.wIn}"`).join(", ");
      for (const f of stored) await sb.from("art_files").insert({ order_id: o.id, name: f.name, file_path: f.path, file_type: "application/pdf", category: "gang_sheet", note: `DTF gang sheet "${sheetName || "gang sheet"}": ${mine}. Open the sheet: /shop/gang-sheet?sheet=${id}`.slice(0, 500) });
      // the note for production, once per job and note
      const nk = `${j.job}|${j.note.trim()}`;
      if (j.note.trim() && !noted.has(nk)) {
        const { data: inn } = await sb.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle();
        const pn = String(inn?.production_notes || "").trim();
        await sb.from("order_internal").upsert({ order_id: o.id, production_notes: [pn, `Gang sheet "${sheetName || "gang sheet"}": ${j.note.trim()}`].filter(Boolean).join("\n").slice(-8000) });
        noted.add(nk);
      }
      notes.push(`filed under #${j.job}`);
    }
    await save({ files: [...(row?.data?.files || []), ...stored], noted: [...noted] }).catch(() => "");
    return notes;
  }

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
        const bytes = await makePdf(pieces, arts, p, W, g);
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
      const base = (sheetName || shortName(logos[0]?.name || "gang")).replace(/[^\w-]+/g, "-").slice(0, 30);
      const named = files.map((f, i) => ({ ...f, name: `${base}-gang-${W}x${f.p.buy.length}-${i + 1}of${files.length}.pdf` }));
      for (const f of named) {
        const u = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: "application/pdf" }));
        const a = document.createElement("a"); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 60000);
        await new Promise((r) => setTimeout(r, 400));
      }
      setBusy("Filing it under the jobs…");
      const id = await save();
      const filed = await fileToJobs(id, named.map((f) => ({ bytes: f.bytes, name: f.name, length: f.p.buy.length })));
      setBusy("");
      const big = Math.max(...files.map((f) => f.bytes.byteLength));
      setDone(`${files.length} PDF${files.length === 1 ? "" : "s"} downloaded (largest ${(big / 1048576).toFixed(1)} MB). Buy ${files.map((f) => `${W}" × ${f.p.buy.length}"`).join(", ")} at ${DTF_DALLAS.name}: ${money(costOf(files.map((f) => f.p)))}.${filed.length ? ` ${filed.join("; ")}.` : ""}`);
    } catch (e) { setBusy(""); setErr(e instanceof Error ? e.message : "The files couldn't be made."); }
  }

  const cur = parts[Math.min(shown, Math.max(0, parts.length - 1))];
  const each = (pc: Piece) => (usedSqIn ? (cost * pc.wIn * pc.hIn) / usedSqIn : 0);
  // whose sheet: "Claudia's" (Oct 26, Nick: "just have it say your name… Claudia, Nick's, Amanda's sheet")
  const who = (email: string) => { const n = (email || "").split("@")[0]; return n ? n[0].toUpperCase() + n.slice(1) : "Someone"; };
  const owners = [...new Set([me, ...sheets.map((x) => x.owner)])].filter((o) => sheets.some((x) => x.owner === o));
  const recent = sheets.slice(0, 3);
  const pcsOf = (x: SheetRow) => (x.data?.logos || []).reduce((a, l) => a + l.vers.reduce((b, v) => b + (+v.qty || 0), 0), 0);
  return (
    <>
      <div className="page-head">
        <div><h1>Gang sheet builder</h1><div className="eyebrow">Heat press: art laid out on a {DTF_DALLAS.name} sheet, priced, and filed with its jobs</div></div>
      </div>
      {/* the bar: the sheet's settings and the actions */}
      <div className="toolbar gang-bar" data-toolbar>
        <span className="spacer" />
        <div className="gang-pop">
          <button type="button" className={"btn" + (settingsOpen ? " on" : "")} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>Sheet settings</button>
          {settingsOpen && (
            <div className="gang-pop-b" role="dialog" aria-label="Sheet settings">
              <div className="gang-row2">
                <div className="field"><label htmlFor="g-g">Trim gap (in)</label><input id="g-g" type="number" min="0" step="0.05" value={gap} onChange={(e) => setGap(e.target.value)} /></div>
                <div className="field"><label htmlFor="g-sw">Sheet width (in)</label><input id="g-sw" type="number" min="4" max={DTF_DALLAS.width} step="0.5" value={sheetW} onChange={(e) => setSheetW(String(Math.min(DTF_DALLAS.width, +e.target.value || DTF_DALLAS.width)))} /></div>
                <div className="field"><label htmlFor="g-ml">Longest file (in)</label><input id="g-ml" type="number" min="10" max={DTF_DALLAS.maxFileLength} step="10" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} /></div>
                <div className="field"><label htmlFor="g-mb">Largest file (MB)</label><input id="g-mb" type="number" min="5" step="1" value={maxMb} onChange={(e) => setMaxMb(e.target.value)} /></div>
              </div>
              {g < 0.25 && <p className="gang-warn">Under 1/4&quot; between pieces is hard to cut apart with scissors.</p>}
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>{DTF_DALLAS.name}: {DTF_DALLAS.width}&quot; wide, up to {DTF_DALLAS.maxFileLength}&quot; a file, {DTF_DALLAS.dpi} dpi. Prices as of {DTF_DALLAS.checked}.</p>
            </div>
          )}
        </div>
        <a className="btn" href={DTF_DALLAS.url} target="_blank" rel="noreferrer">Open {DTF_DALLAS.name}</a>
        {sheetId && row?.status !== "ordered" && logos.length > 0 && <button type="button" className="btn" onClick={() => void markOrdered()} title={`You ordered it at ${DTF_DALLAS.name}: its confirmation is matched to this sheet`}>Mark ordered</button>}
        <button type="button" className="btn primary" disabled={!parts.length || !!busy} onClick={() => void download()}>{busy || "Download PDF"}</button>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="pv-err sow-msg" role="status">{done}</div>}
      <div className="gang2">
        {/* the art, then the order it's for */}
        <div className={"gang-left" + (dragOver ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); void add(e.dataTransfer.files); }}>
          {/* the saved sheets: a small box, the most recent few, the rest under each person's name (Oct 26, Nick: "we don't
              want that to take up too much space… most recent or more") */}
          <section className="panel gang-sheets">
            <div className="gang-sheets-h"><b>Gang sheets</b><span className="spacer" /><button type="button" className="btn sm" onClick={() => void openSheet("")}>+ New sheet</button></div>
            {recent.map((x) => (
              <button key={x.id} type="button" className={"gang-sr" + (x.id === sheetId ? " on" : "")} onClick={() => void openSheet(x.id)}>
                <span className="gang-sr-n" data-notranslate>{x.name}</span>
                <span className="gang-sr-m">{who(x.owner)}&apos;s · {pcsOf(x)} pcs{x.status === "ordered" ? ` · ordered${x.supplier_order ? ` #${x.supplier_order}` : ""}` : ""}</span>
              </button>
            ))}
            {sheets.length > recent.length && (
              <select className="gang-more" aria-label="More gang sheets" value="" onChange={(e) => void openSheet(e.target.value)}>
                <option value="">More sheets…</option>
                {owners.map((o) => (
                  <optgroup key={o} label={`${who(o)}'s sheets`}>
                    {sheets.filter((x) => x.owner === o).map((x) => <option key={x.id} value={x.id}>{x.name} · {pcsOf(x)} pcs · {new Date(x.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{x.status === "ordered" ? " · ordered" : ""}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            <div className="gang-sheets-cur">
              <input type="text" aria-label="This sheet's name" placeholder="Name this sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
              <span className="faint">{row?.status === "ordered" ? `Ordered${row.supplier_order ? ` #${row.supplier_order}` : ""}${row.expected ? ` · ${row.expected}` : ""}` : saveState || (sheetId ? "Saved" : "Saves when you add art")}</span>
            </div>
            {sheets.some((x) => x.id !== sheetId && (x.data?.logos || []).length) && (
              <select className="gang-more" aria-label="Add the art from another sheet" value="" onChange={(e) => void pullFrom(e.target.value)}>
                <option value="">Add the art from another sheet…</option>
                {owners.map((o) => <optgroup key={o} label={`${who(o)}'s sheets`}>{sheets.filter((x) => x.owner === o && x.id !== sheetId && (x.data?.logos || []).length).map((x) => <option key={x.id} value={x.id}>{x.name} · {(x.data?.logos || []).length} art</option>)}</optgroup>)}
              </select>
            )}
          </section>
          {logos.map((lg) => (
            <section key={lg.id} className="panel gang-card">
              <div className="gang-card-h">
                <div className="gang-pic">{lg.src ? <img src={lg.src} alt="" /> : <span>no art</span>}</div>
                <div className="gang-card-t">
                  {lg.src ? <b data-notranslate title={lg.name}>{shortName(lg.name)}</b> : <input type="text" value={lg.name} onChange={(e) => patchLogo(lg.id, { name: e.target.value })} aria-label="Name" />}
                  <span className="faint">{lg.src ? `${lg.colors.length} color${lg.colors.length === 1 ? "" : "s"}${Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn))) < 200 ? ` · about ${Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn)))} dpi at its biggest: may print soft` : ""}` : "a size with no art yet, for pricing"}</span>
                </div>
                <button type="button" className="btn icon ghost" aria-label="Remove this art" title="Remove this art" onClick={() => { setLogos((xs) => xs.filter((x) => x.id !== lg.id)); setJobs((js) => js.map((j) => ({ ...j, logos: j.logos.filter((x) => x !== lg.id) }))); }}>×</button>
              </div>
              <table className="gang-vt">
                <thead><tr><th>Size (W × H in)</th><th>Qty</th><th>For</th><th>{lg.src && lg.colors.length ? "Knock out" : ""}</th><th /></tr></thead>
                <tbody>{lg.vers.map((v) => (
                  <tr key={v.id}>
                    <td><span className="gang-wh">
                      <input type="number" min="0.25" step="0.05" value={v.wIn} aria-label="Width in inches" onChange={(e) => setW(lg, v, Math.max(0.25, +e.target.value || 0))} />
                      <span className="faint">×</span>
                      {lg.src ? <span className="gang-h num" title="Follows the art's shape">{heightOf(lg, v)}</span> : <input type="number" min="0.25" step="0.05" value={v.hIn || 3} aria-label="Height in inches" onChange={(e) => patchVer(lg.id, v.id, { hIn: Math.max(0.25, +e.target.value || 0) })} />}
                    </span></td>
                    <td><input className="gang-q" type="number" min="1" step="1" value={v.qty} aria-label="How many" onChange={(e) => patchVer(lg.id, v.id, { qty: Math.max(1, Math.round(+e.target.value || 1)) })} /></td>
                    <td><input type="text" value={v.label} placeholder="Youth, red…" aria-label="What it's for" onChange={(e) => patchVer(lg.id, v.id, { label: e.target.value })} /></td>
                    <td>{lg.src && lg.colors.length > 0 && <span className="gang-ko">{lg.colors.map((h) => <button key={h} type="button" className={"gang-dot" + (v.knock.includes(h) ? " off" : "")} style={{ background: h }} aria-pressed={v.knock.includes(h)} title={v.knock.includes(h) ? `${h} knocked out: click to print it again` : `Knock out ${h} on these`} onClick={() => toggleKnock(lg, v, h)} />)}</span>}</td>
                    <td>{lg.vers.length > 1 && <button type="button" className="btn icon ghost" aria-label="Remove this size" title="Remove this size" onClick={() => patchLogo(lg.id, { vers: lg.vers.filter((x) => x.id !== v.id) })}>×</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <button type="button" className="lc-link gang-add" onClick={() => addVer(lg)}>+ Add a size</button>
            </section>
          ))}
          <label className="gang-drop">
            <span><b>Drop art here</b> or <u>upload</u> · PNG, JPG, PDF, AI</span>
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,.ai,.pdf" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
          <button type="button" className="lc-link" onClick={addSize} style={{ alignSelf: "flex-start" }}>+ Add a size with no art yet (to price it)</button>
          {/* the order it's for */}
          <section className="panel">
            <div className="panel-h"><h2>Order</h2><span className="faint">the job this is for: the sheet goes in its production files</span></div>
            <div className="panel-b stack" style={{ gap: 10 }}>
              {jobs.map((j) => {
                const o = orderOf[j.job];
                return (
                  <div key={j.id} className="gang-job-row">
                    <div className="gang-job-top">
                      <div className="field"><label>Job / invoice #</label><input type="text" inputMode="numeric" value={j.job} placeholder="13767" onChange={(e) => patchJob(j.id, { job: e.target.value.replace(/\D/g, "").slice(0, 8) })} /></div>
                      <span className="gang-job-found">{!j.job ? "" : o === undefined ? "Looking…" : o ? <a href={`/shop/orders/${o.id}`} target="_blank" rel="noreferrer">{o.label}</a> : <span className="gang-warn">Not an order in the portal</span>}</span>
                      <button type="button" className="btn icon ghost" aria-label="Remove this job" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}>×</button>
                    </div>
                    {logos.length > 1 && (
                      <div className="chips gang-job-art">
                        <span className="faint">Art for it:</span>
                        <button type="button" className={"chip" + (!j.logos.length ? " on" : "")} onClick={() => patchJob(j.id, { logos: [] })}>All</button>
                        {logos.map((lg) => <button key={lg.id} type="button" className={"chip" + (j.logos.includes(lg.id) ? " on" : "")} onClick={() => patchJob(j.id, { logos: j.logos.includes(lg.id) ? j.logos.filter((x) => x !== lg.id) : [...j.logos, lg.id] })}>{shortName(lg.name)}</button>)}
                      </div>
                    )}
                    <div className="field"><label>Production note</label><textarea rows={2} value={j.note} placeholder="Added to the job's production notes when you download" onChange={(e) => patchJob(j.id, { note: e.target.value })} /></div>
                  </div>
                );
              })}
              <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setJobs((js) => [...js, { id: uid(), job: "", logos: [], note: "" }])}>{jobs.length ? "Add another job" : "Add the job it's for"}</button>
            </div>
          </section>
        </div>
        {/* the cost, then the sheet */}
        <div className="gang-right">
          <div className="stats gang-sum">
            <button type="button" className="stat"><span className="v">{money(cost)}</span><span className="k">{DTF_DALLAS.name} cost</span></button>
            <button type="button" className="stat"><span className="v">{r2(film)}&quot; of {bought}&quot;</span><span className="k">Film used of what you buy</span></button>
            <button type="button" className="stat"><span className="v">{n ? money(cost / n) : "—"}</span><span className="k">Per transfer, average</span></button>
            <button type="button" className="stat"><span className="v">{filmSqIn ? `${Math.round((usedSqIn / filmSqIn) * 100)}%` : "—"}</span><span className="k">Film covered by art</span></button>
          </div>
          <div className="toolbar gang-tabs" data-toolbar>
            <div className="chips">
              <button type="button" className={"chip" + (tab === "sheet" ? " on" : "")} onClick={() => setTab("sheet")}>Sheet</button>
              <button type="button" className={"chip" + (tab === "pieces" ? " on" : "")} onClick={() => setTab("pieces")}>Pieces <span className="pill-n">{pieces.length}</span></button>
              <button type="button" className={"chip" + (tab === "files" ? " on" : "")} onClick={() => setTab("files")}>Files <span className="pill-n">{parts.length}</span></button>
            </div>
            <span className="spacer" />
            <button type="button" className="btn primary sm" disabled={!pieces.length} onClick={optimize} title="Tries each piece turned and not, and ways of stacking them, and keeps the one that costs least">Optimize sheet</button>
            {tab === "sheet" && <span className="gang-zoom">
              <button type="button" className="btn sm" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, r2(z / 1.5)))}>−</button>
              <button type="button" className="btn sm ghost" onClick={() => setZoom(1)} title="Fit the width">{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
              <button type="button" className="btn sm" aria-label="Zoom in" disabled={zoom >= 6} onClick={() => setZoom((z) => Math.min(6, r2(z * 1.5)))}>+</button>
            </span>}
          </div>
          {optimized && (optimized.before - film > 0.05 ? <p className="puff-ok" style={{ margin: "0 0 8px" }}>Optimized: {r2(optimized.before - film)}&quot; less film{optimized.beforeCost - cost > 0.005 ? `, ${money(optimized.beforeCost - cost)} less` : ""}.</p> : <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Optimized: already as tight as it gets.</p>)}
          {!pieces.length ? <div className="gang-empty">Drop art on the left, or add a size with no art to price a job.</div> : !lay ? <p className="gang-warn">A piece is wider than the {W}&quot; sheet even turned. Make it smaller.</p> : tab === "sheet" ? (
            <>
              {parts.length > 1 && <div className="chips" style={{ marginBottom: 8 }}>{parts.map((p, i) => <button key={i} type="button" className={"chip" + (i === Math.min(shown, parts.length - 1) ? " on" : "")} onClick={() => setShown(i)}>File {i + 1} · {W}&quot;×{p.buy.length}&quot;</button>)}</div>}
              <div ref={box} className="gang-view">{cur && <canvas ref={pv} />}</div>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>Rows across the sheet with the trim gap between (the dashed lines, on screen only): cut the rows apart, then each piece. Shaded: film you buy past the layout.</p>
            </>
          ) : tab === "pieces" ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Piece</th><th className="r">Size</th><th className="r">How many</th><th className="r">Each</th><th className="r">Total</th></tr></thead>
              <tbody>{pieces.map((pc) => <tr key={pc.key}><td data-notranslate>{pc.name}{pc.ver.knock.length ? <span className="faint"> · {pc.ver.knock.length} knocked out</span> : null}</td><td className="r num">{pc.wIn}&quot; × {pc.hIn}&quot;</td><td className="r num">{pc.qty}</td><td className="r num">{money(each(pc))}</td><td className="r num">{money(each(pc) * pc.qty)}</td></tr>)}</tbody>
            </table></div>
          ) : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>File</th><th>Layout</th><th>Buy</th><th className="r">Price</th></tr></thead>
              <tbody>{parts.map((p, i) => <tr key={i}><td>{i + 1}</td><td className="num">{r2(p.length)}&quot; long · {p.rects.length} pcs</td><td className="num">{W}&quot; × {p.buy.length}&quot;</td><td className="r num">{money(p.buy.price)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
