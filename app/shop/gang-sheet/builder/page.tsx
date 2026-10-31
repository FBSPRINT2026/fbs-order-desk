"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { PDFJS, PDFJS_WORKER } from "@/lib/artPrep";
import { DTF_DALLAS, sheetFor } from "@/lib/dtfDallas";
import CustomerPick from "@/components/CustomerPick";
import BackLink from "@/components/BackLink";
import { packFill, type PackItem } from "@/lib/gangPack";
import { lineQty, orderGroups, type Order } from "@/lib/pricing";
import { heldFiles } from "@/lib/heldFiles";
import { rosterPieces, type RosterSpec } from "@/lib/rosterArt";

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
type Ver = { id: string; wIn: number; qty: number; knock: string[]; label: string; /** the part of the art left after the knock-out (0–1 of its width/height): the piece is cut to it */ box?: [number, number, number, number]; /** a size with no art: its height */ hIn?: number };
type Logo = { id: string; name: string; /** the art (a data URL or a signed link), "" for a size with no art yet */ src: string; srcW: number; srcH: number; colors: string[]; vers: Ver[];
  /** older sheets: a size with no art's height */ hIn?: number;
  /** where the art is kept once the sheet is saved (storage proofs/gang/…) */ path?: string;
  /** older sheets: the job on the logo (now in jobs) */ job?: string };
/** the job a sheet is for: its number, which art goes to it (all when none picked) and a note for its production notes */
type Job = { id: string; job: string; logos: string[]; note: string };
type SheetRow = { id: string; name: string; owner: string; status: string; customer_id?: string | null; updated_at: string; ordered_at: string | null; supplier_order: string | null; expected: string | null; data: SheetData };
type SheetData = { logos?: Logo[]; jobs?: Job[]; gap?: string; sheetW?: string; maxLen?: string; plan?: Plan; files?: { path: string; name: string; length: number; at: string }[]; noted?: string[] };
/** one version, ready to lay out */
type Piece = { key: string; logo: Logo; ver: Ver; name: string; wIn: number; hIn: number; qty: number };
type Rect = { piece: number; x: number; y: number; w: number; h: number; rot: boolean };
type Layout = { rows: { y: number; h: number }[]; rects: Rect[]; length: number };
type Part = { rects: Rect[]; length: number; buy: { length: number; price: number } };
/**
 * How the sheet is laid out. `rows`: straight rows (the first layout). `fill`: each piece in the open space nearest the
 * top, small ones tucked beside and under big ones (lib/gangPack). Optimize may save the exact order and turn of each
 * size it found best (`seq`, `modes`: "a" as drawn, "b" turned a quarter, "any" either), so the sheet comes back the same.
 */
type Plan = { turn: "as is" | "flat" | "tall"; order: "height" | "area" | "added" | "width"; algo?: "rows" | "fill" | "grouped"; seq?: string[]; modes?: Record<string, "a" | "b" | "any"> };
const uid = () => Math.random().toString(36).slice(2, 9);
/** a print to put on the sheet from an order */
type Want = { src: string; name: string; size: string; qty: number; where: string };
type OrderLite = { id: string; number: number; customer_id: string | null };
/** a screen print asked about: its art as uploaded (orig) or as the Mockup Creator shows it (mock) */
type AskRow = { key: string; want: Want; orig: string; mock: string; origPic: string; pick: "orig" | "mock"; changed: boolean; label: string; inks: string };
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
/** where the art is once its knocked-out colors are gone (Oct 26, Nick: "it needs to shrink to fit the art… automatically
 * clip it to fit the art, and then we set the spacing between"): a white background knocked out leaves empty corners */
function boxOf(c: HTMLCanvasElement): [number, number, number, number] {
  const { width: w, height: h } = c, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return [0, 0, 1, 1];
  const q = (v: number) => Math.round(v * 10000) / 10000;
  return [q(x0 / w), q(y0 / h), q((x1 + 1) / w), q((y1 + 1) / h)];
}
const boxFor = (v: Ver): [number, number, number, number] => (v.knock.length && v.box ? v.box : [0, 0, 1, 1]);
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
function layOut(ps0: Piece[], W: number, g: number, opt: Plan, L = DTF_DALLAS.maxFileLength): Layout | null {
  if (opt.algo === "fill") return layFill(ps0, W, g, opt, L);
  if (opt.algo === "grouped") return layGrouped(ps0, W, g);
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
/**
 * Grouped layout (Oct 26, Nick: "all the same sizes are together, easy to cut like one by one… sometimes it's going to
 * get weird if you don't"): each size in its own full rows, the biggest first, turned when that takes less film; the
 * next size starts on a fresh row, so every size cuts off the sheet in one straight line.
 */
function layGrouped(ps0: Piece[], W: number, g: number): Layout | null {
  const idx = ps0.map((_, i) => i).filter((i) => ps0[i].qty > 0).sort((a, b) => ps0[b].wIn * ps0[b].hIn - ps0[a].wIn * ps0[a].hIn);
  const rows: { y: number; h: number }[] = [], rects: Rect[] = [];
  let y = 0;
  for (const i of idx) {
    const it = ps0[i];
    const opts = [{ w: it.wIn + g, h: it.hIn + g, rot: false }, { w: it.hIn + g, h: it.wIn + g, rot: true }]
      .filter((o) => o.w <= W + 1e-6)
      .map((o) => { const per = Math.max(1, Math.floor((W + 1e-6) / o.w)); return { ...o, per, len: Math.ceil(it.qty / per) * o.h }; })
      .sort((a, b) => a.len - b.len || (a.rot ? 1 : -1));
    const o = opts[0]; if (!o) return null;
    for (let k = 0; k < it.qty; k += o.per) {
      for (let j = 0; j < o.per && k + j < it.qty; j++) rects.push({ piece: i, x: j * o.w, y, w: o.w, h: o.h, rot: o.rot });
      rows.push({ y, h: o.h }); y += o.h;
    }
  }
  return { rows, rects, length: y };
}
/** the open-space fill: each size as drawn, turned, or either (Optimize's pick), in the plan's order */
function layFill(ps0: Piece[], W: number, g: number, opt: Plan, L: number): Layout | null {
  const big = (i: number) => Math.max(ps0[i].wIn, ps0[i].hIn);
  let idx = ps0.map((_, i) => i);
  if (opt.seq?.length) { const at = new Map(opt.seq.map((k, i) => [k, i])); idx.sort((a, b) => (at.get(ps0[a].key) ?? 1e6 + big(b)) - (at.get(ps0[b].key) ?? 1e6 + big(a))); }
  else if (opt.order === "height") idx.sort((a, b) => ps0[b].hIn - ps0[a].hIn || ps0[b].wIn - ps0[a].wIn);
  else if (opt.order === "width") idx.sort((a, b) => ps0[b].wIn - ps0[a].wIn || ps0[b].hIn - ps0[a].hIn);
  else if (opt.order === "area") idx.sort((a, b) => ps0[b].wIn * ps0[b].hIn - ps0[a].wIn * ps0[a].hIn);
  idx = idx.filter((i) => ps0[i].qty > 0);
  const items: PackItem[] = [];
  for (const i of idx) {
    const it = ps0[i], w = it.wIn + g, h = it.hIn + g;
    const m = opt.modes?.[it.key] || (opt.turn === "flat" ? (it.hIn > it.wIn ? "b" : "a") : opt.turn === "tall" ? (it.wIn > it.hIn ? "b" : "a") : "a");
    let rot = m === "b";
    if (!rot && w > W + 1e-6) rot = true; else if (rot && h > W + 1e-6) rot = false;
    for (let k = 0; k < it.qty; k++) items.push({ piece: i, w: rot ? h : w, h: rot ? w : h, rot, turn: m === "any" });
  }
  const r = packFill(items, W, L);
  if (!r) return null;
  return { rows: r.bins, rects: r.rects, length: r.bins.reduce((a, b) => a + b.h, 0) };
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
// no cut lines: they'd print on the film (Oct 26, Nick). Each piece is its art cut to what's left after the knock-out.
async function makePdf(pieces: Piece[], arts: Record<string, HTMLImageElement>, p: Part, W: number, g: number): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const L = p.buy.length, pt = 72;
  const page = doc.addPage([W * pt, L * pt]);
  const emb = new Map<number, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const i of new Set(p.rects.map((r) => r.piece))) {
    const pc = pieces[i];
    // the version at 300 dpi of its print size, its knocked-out colors taken out
    const img = arts[pc.logo.id], bx = boxFor(pc.ver), ow = Math.max(1, Math.round(pc.wIn * DPI)), oh = Math.max(1, Math.round(pc.hIn * DPI));
    const fw = Math.max(1, Math.round(ow / Math.max(0.01, bx[2] - bx[0]))), fh = Math.max(1, Math.round(oh / Math.max(0.01, bx[3] - bx[1])));
    const full = knocked(img, pc.ver.knock, fw, fh);
    const c = document.createElement("canvas"); c.width = ow; c.height = oh;
    c.getContext("2d")!.drawImage(full, Math.round(bx[0] * fw), Math.round(bx[1] * fh), ow, oh, 0, 0, ow, oh);
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


const heightOf = (lg: Logo, v: Ver) => { if (!lg.src) return v.hIn || lg.hIn || 3; const b = boxFor(v); return r2((v.wIn * (b[3] - b[1]) * lg.srcH) / Math.max(1, (b[2] - b[0]) * lg.srcW)); };
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
  const [plan, setPlan] = useState<Plan>({ turn: "as is", order: "height", algo: "fill" });
  const [optimized, setOptimized] = useState<{ before: number; beforeCost: number } | null>(null);
  const [shown, setShown] = useState(0);
  const [tab, setTab] = useSticky<"sheet" | "pieces" | "files">("gang.tab", "sheet");
  const [zoom, setZoom] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const g = Math.max(0, +gap || 0), W = Math.min(DTF_DALLAS.width, Math.max(4, +sheetW || DTF_DALLAS.width));
  const L = Math.max(10, Math.min(DTF_DALLAS.maxFileLength, +maxLen || DTF_DALLAS.maxFileLength));
  const pieces: Piece[] = useMemo(() => logos.flatMap((lg) => lg.vers.map((v) => ({
    key: v.id, logo: lg, ver: v, name: `${shortName(lg.name)}${v.label ? ` (${v.label})` : lg.vers.length > 1 ? ` ${r2(v.wIn)}"` : ""}`,
    wIn: v.wIn, hIn: heightOf(lg, v), qty: v.qty,
  }))), [logos]);
  const lay = useMemo(() => (pieces.length ? layOut(pieces, W, g, plan, L) : null), [pieces, W, g, plan, L]);
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
      const kc = knocked(img, pc.ver.knock, Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k)));
      // the piece cut to what's left (a knocked-out background leaves empty corners)
      if (pc.ver.knock.length) {
        const bx = boxOf(kc), old = pc.ver.box;
        if (!old || old.some((v, i) => Math.abs(v - bx[i]) > 0.0005)) patchVer(pc.logo.id, pc.ver.id, { box: bx });
      }
      const url = kc.toDataURL("image/png");
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
  /** art: the height typed, the width follows so the art keeps its shape (Oct 26, Nick: "fill in the width or the height…
   * it keeps… the perspective") */
  const setH = (lg: Logo, v: Ver, h: number) => { const cur = heightOf(lg, v); if (cur > 0) patchVer(lg.id, v.id, { wIn: Math.round(((h * v.wIn) / cur) * 1000) / 1000 }); };
  const toggleKnock = (lg: Logo, v: Ver, h: string) => patchVer(lg.id, v.id, { knock: v.knock.includes(h) ? v.knock.filter((x) => x !== h) : [...v.knock, h] });

  // "Optimize sheet" (Oct 26, Nick: "you should have moved the small [ones] under the other small ones… the big logos all
  // to be on one side… if you had… a really skinny, narrow one, it should know to move it around"): straight rows and the
  // open-space fill, each size as drawn, turned, or either, in several orders; then shuffled orders and turns for
  // a moment longer. The cheapest wins, then the least film; the current layout is kept when nothing beats it.
  function optimize() {
    if (!pieces.length) return;
    const before = lay ? partsOf(lay, L) : [];
    let best: { p: Plan; parts: Part[]; len: number } | null = null;
    const tryPlan = (p: Plan) => {
      const l = layOut(pieces, W, g, p, L); if (!l) return;
      const ps = partsOf(l, L), len = ps.reduce((a, x) => a + x.length, 0), c = costOf(ps);
      if (!best || c < costOf(best.parts) - 0.005 || (Math.abs(c - costOf(best.parts)) < 0.005 && len < best.len - 0.01)) best = { p, parts: ps, len };
    };
    tryPlan(plan);
    for (const turn of ["as is", "flat", "tall"] as const) for (const order of ["height", "area", "added", "width"] as const) {
      if (order !== "width") tryPlan({ turn, order, algo: "rows" });
      tryPlan({ turn, order, algo: "fill" });
    }
    const keys = pieces.map((pc) => pc.key);
    for (const order of ["height", "area", "width"] as const) tryPlan({ turn: "as is", order, algo: "fill", modes: Object.fromEntries(keys.map((k) => [k, "any" as const])) });
    // shuffled: the sizes in a random order, each as drawn, turned or either
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const t0 = performance.now();
    while (performance.now() - t0 < 700) {
      const seq = [...keys].sort(() => rnd() - 0.5);
      const modes = Object.fromEntries(keys.map((k) => { const x = rnd(); return [k, x < 0.34 ? "a" : x < 0.67 ? "b" : "any"] as const; }));
      tryPlan({ turn: "as is", order: "added", algo: "fill", seq, modes });
      if (keys.length < 2 && performance.now() - t0 > 150) break;
    }
    const won = best as { p: Plan; parts: Part[]; len: number } | null;
    if (won) { setPlan(won.p); setOptimized({ before: before.reduce((a, p) => a + p.length, 0), beforeCost: costOf(before) }); setShown(0); setTab("sheet"); }
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
      if (pc.logo.src && im) { const b = boxFor(pc.ver), iw = im.naturalWidth, ih = im.naturalHeight; x.drawImage(im, b[0] * iw, b[1] * ih, (b[2] - b[0]) * iw, (b[3] - b[1]) * ih, 0, 0, pc.wIn * k, pc.hIn * k); }
      else { x.fillStyle = "#d7dee7"; x.fillRect(0, 0, pc.wIn * k, pc.hIn * k); x.fillStyle = "#52637a"; x.font = `${Math.max(10, Math.min(15, pc.hIn * k * 0.22))}px sans-serif`; x.fillText(`${pc.name} ${pc.wIn}×${pc.hIn}`, 6, Math.min(pc.hIn * k - 6, 18)); }
      x.restore();
      // where it gets cut apart (on screen only, never in the PDF)
      if (g > 0) { x.save(); x.strokeStyle = "rgba(200,40,40,.7)"; x.setLineDash([5, 4]); x.lineWidth = 1; x.strokeRect(r.x * k + 0.5, r.y * k + 0.5, r.w * k - 1, r.h * k - 1); x.restore(); }
    }
  }, [parts, shown, pieces, verImg, W, g, zoom, boxW, tab]);

  // ---------- saved sheets ----------
  const [sheetId, setSheetId] = useSticky("gang.sheet", "");
  const [sheetName, setSheetName] = useState("");
  const [row, setRow] = useState<SheetRow | null>(null);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [saveState, setSaveState] = useState("");
  // the customer it's for (Oct 26, Nick: "not only be for an invoice, it should also just be for a customer… see them by
  // customer"): on their page under Artwork, staff only
  const [custFor, setCustFor] = useState<{ id: string; label: string } | null>(null);
  const loading = useRef(false), saving = useRef<Promise<string> | null>(null);
  const listSheets = async () => {
    const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, data, customer_id").is("archived_at", null).order("updated_at", { ascending: false }).limit(80);
    setSheets((data || []) as SheetRow[]);
  };
  useEffect(() => { void listSheets(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // delete takes two clicks (Oct 26, Nick: "make a delete button… you have to double click it"); the sheet is put away
  // (archived), never erased, so its files and production notes stay
  const [armed, setArmed] = useState("");
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(""), 4000); return () => clearTimeout(t); }, [armed]);
  async function delSheet(id: string) {
    if (armed !== id) { setArmed(id); return; }
    setArmed("");
    const { error } = await sb.from("gang_sheets").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) { setErr(error.message); return; }
    if (id === sheetId) await openSheet("");
    setSheets((xs) => xs.filter((x) => x.id !== id));
    void listSheets();
  }
  async function openSheet(id: string) {
    loading.current = true;
    if (!id) { setCustFor(null); setRow(null); setSheetId(""); setSheetName(""); setLogos([]); setJobs([]); setArts({}); setOptimized(null); setDone(""); setErr(""); setTimeout(() => { loading.current = false; }, 50); return; }
    const { data } = await sb.from("gang_sheets").select("id, name, owner, status, updated_at, ordered_at, supplier_order, expected, data, customer_id").eq("id", id).maybeSingle();
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
    if (r.customer_id) { const { data: c } = await sb.from("customers").select("id, company, name").eq("id", r.customer_id).maybeSingle(); setCustFor(c ? { id: c.id as string, label: String(c.company || c.name || "Customer") } : null); } else setCustFor(null);
    setArts(imgs); setLogos(withSrc); setJobs(d.jobs || oldJobs);
    if (d.gap) setGap(d.gap); if (d.sheetW) setSheetW(d.sheetW); if (d.maxLen) setMaxLen(d.maxLen); if (d.plan) setPlan(d.plan);
    setOptimized(null); setShown(0); setDone(""); setErr("");
    setTimeout(() => { loading.current = false; }, 50);
  }
  useEffect(() => {
    // "+ New gang sheet" on the Gang sheets page opens a blank one; a sheet's link opens it; otherwise the last one open
    const sp = new URLSearchParams(window.location.search), q = sp.get("sheet");
    if (sp.get("order")) void fromOrder(sp.get("order")!);
    else if (sp.get("new")) void openSheet("");
    else if (q || sheetId) void openSheet(q || sheetId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** a new sheet from an order's prints: one logo per art, one size per width, the pieces added up; filed with the job */
  async function makeFrom(o: OrderLite, want: Want[]) {
    // one logo per art; one size per width, the pieces added up
    const byArt = new Map<string, Want[]>();
    for (const w of want) { const k = w.src; byArt.set(k, [...(byArt.get(k) || []), w]); }
    const lgs: Logo[] = [], imgs: Record<string, HTMLImageElement> = {};
    for (const [src, ws] of byArt) {
      setBusy(`Getting ${ws[0].name}…`);
      const { data: blob } = await sb.storage.from("proofs").download(src);
      if (!blob) continue;
      const ext = (src.match(/\.([a-z0-9]+)$/i)?.[1] || "png").toLowerCase();
      const c = await readLogo(new File([blob], `${ws[0].name}.${ext}`, { type: blob.type || (ext === "pdf" || ext === "ai" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`) }));
      const url = c.toDataURL("image/png"), colors = colorsOf(c);
      // a white box around the art (no background taken off): knock the white out
      const x = c.getContext("2d", { willReadFrequently: true })!, px = (a: number, b: number) => x.getImageData(a, b, 1, 1).data;
      const corners = [px(0, 0), px(c.width - 1, 0), px(0, c.height - 1), px(c.width - 1, c.height - 1)];
      const whiteBox = corners.every((q) => q[3] > 200 && q[0] > 235 && q[1] > 235 && q[2] > 235);
      const white = whiteBox ? colors.find((h) => parseInt(h.slice(1, 3), 16) > 225 && parseInt(h.slice(3, 5), 16) > 225 && parseInt(h.slice(5, 7), 16) > 225) : undefined;
      const ratio = c.height / Math.max(1, c.width);
      const vers: Ver[] = [];
      for (const w of ws) {
        const n = parseFloat((w.size.match(/[\d.]+/) || [])[0] || "");
        const wIn = n > 0 ? r2(/tall|high/i.test(w.size) ? n / Math.max(0.01, ratio) : n) : 3;
        const same = vers.find((v) => Math.abs(v.wIn - wIn) < 0.01);
        if (same) { same.qty += w.qty; same.label = [...new Set([...same.label.split("; "), w.where])].filter(Boolean).join("; ").slice(0, 80); }
        else vers.push({ ...newVer(wIn, w.qty), label: w.where.slice(0, 80), knock: white ? [white] : [] });
      }
      const lg: Logo = { id: uid(), name: ws[0].name, src: url, srcW: c.width, srcH: c.height, colors, vers };
      lgs.push(lg);
      imgs[lg.id] = await loadImg(url);
    }
    if (!lgs.length) throw new Error("The order's art couldn't be read.");
    if (o.customer_id) { const { data: cu } = await sb.from("customers").select("id, company, name").eq("id", o.customer_id).maybeSingle(); if (cu) setCustFor({ id: cu.id as string, label: String(cu.company || cu.name || "Customer") }); }
    setSheetName(`Order #${o.number} transfers`);
    setArts(imgs); setLogos(lgs);
    setJobs([{ id: uid(), job: String(o.number), logos: lgs.map((l) => l.id), note: "" }]);
    setDone(`Brought in ${lgs.length} logo${lgs.length === 1 ? "" : "s"} and ${lgs.reduce((a, l) => a + l.vers.reduce((b, v) => b + v.qty, 0), 0)} transfers from order #${o.number}. Check the sizes and the white knocked out, then Optimize sheet.`);
    window.history.replaceState(null, "", "/shop/gang-sheet/builder");
  }
  const [artAsk, setArtAsk] = useState<{ o: OrderLite; rows: (AskRow & { mockUrl: string; origUrl: string })[] } | null>(null);
  /**
   * An order's names & numbers (Imprint.roster, the Mockup Creator's Name & number builder; Oct 31, Nick: "put all the names
   * together, put the names and numbers together… sometimes we order just names and then numbers so that we can manually
   * put them together because it's cheaper on the gang sheet. Sometimes if it's not a lot… already spaced out and ready").
   * Asked which, then every shirt's pieces go on the sheet (lib/rosterArt.ts rosterPieces), with the order's other prints.
   */
  const [rosterAsk, setRosterAsk] = useState<{ o: OrderLite; specs: { spec: RosterSpec; where: string }[]; rest: Want[] } | null>(null);
  async function addRoster(apart: boolean) {
    const ask = rosterAsk; if (!ask) return;
    setRosterAsk(null); setErr("");
    try {
      if (ask.rest.length) await makeFrom(ask.o, ask.rest);
      const lgs: Logo[] = [], imgs: Record<string, HTMLImageElement> = {};
      for (const { spec, where } of ask.specs) {
        setBusy(`Making the names and numbers for the ${where}…`);
        for (const pc of await rosterPieces(spec, apart)) {
          const lg: Logo = { id: uid(), name: pc.label, src: pc.png, srcW: pc.px[0], srcH: pc.px[1], colors: [spec.color, ...(spec.outline ? [spec.outline] : [])], vers: [{ ...newVer(pc.wIn, pc.qty), label: where.slice(0, 80) }] };
          lgs.push(lg); imgs[lg.id] = await loadImg(pc.png);
        }
      }
      const n = lgs.reduce((a, l) => a + l.vers.reduce((b, v) => b + v.qty, 0), 0);
      if (ask.rest.length) {
        setLogos((x) => [...x, ...lgs]); setArts((x) => ({ ...x, ...imgs }));
        setJobs((js) => js.map((j) => ({ ...j, logos: [...j.logos, ...lgs.map((l) => l.id)] })));
      } else {
        if (ask.o.customer_id) { const { data: cu } = await sb.from("customers").select("id, company, name").eq("id", ask.o.customer_id).maybeSingle(); if (cu) setCustFor({ id: cu.id as string, label: String(cu.company || cu.name || "Customer") }); }
        setSheetName(`Order #${ask.o.number} names & numbers`);
        setArts(imgs); setLogos(lgs);
        setJobs([{ id: uid(), job: String(ask.o.number), logos: lgs.map((l) => l.id), note: apart ? "Names and numbers apart: put each shirt's together on press" : "Each shirt's name and number together" }]);
        window.history.replaceState(null, "", "/shop/gang-sheet/builder");
      }
      setDone(`Names & numbers from order #${ask.o.number}: ${n} transfer${n === 1 ? "" : "s"}${apart ? ", the names and the numbers apart" : ", each shirt's together"}. Check the sizes, then Optimize sheet.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make the names and numbers."); }
    setBusy("");
  }
  /**
   * Create DTF gang sheet, on an order's Ask AI (Oct 26, Nick: "you've made an order, it's going to be heat [press]… we need 10 of these and 12
   * of these shirts, and then you click it, brings in the art for both, drops them in here, knows whether the background
   * is removed… orders the exact same quantities"). Every heat press print on the order: its art as the Mockup Creator
   * showed it (background off), at its size, as many as the garments in its group; the same art at the same size adds
   * up. A new sheet for the order's customer, filed with the job.
   */
  async function fromOrder(orderId: string) {
    await openSheet("");
    setBusy("Bringing in the order's prints…"); setErr("");
    try {
      const { data: o } = await sb.from("orders").select("id, number, customer_id, groups, lines").eq("id", orderId).maybeSingle();
      if (!o) throw new Error("That order wasn't found.");
      // the order already has a sheet: open it instead of making another
      const { data: had } = await sb.from("gang_sheets").select("id").is("archived_at", null).contains("data", { jobs: [{ job: String(o.number) }] }).order("updated_at", { ascending: false }).limit(1);
      if (had?.[0]) { setBusy(""); await openSheet(had[0].id as string); setDone(`Order #${o.number}'s gang sheet. Add to it here, or make another from the Gang sheets page.`); window.history.replaceState(null, "", `/shop/gang-sheet/builder?sheet=${had[0].id}`); return; }
      const groups = orderGroups(o as Pick<Order, "groups" | "lines">);
      const want: Want[] = [], asks: AskRow[] = [];
      const designIds = [...new Set(groups.flatMap((g) => g.imprints.filter((im) => (im.method === "dtf" || im.method === "screen") && im.design_id).map((im) => im.design_id!)))];
      const { data: ds } = designIds.length ? await sb.from("designs").select("id, number, name, file_path, preview_path").in("id", designIds) : { data: [] };
      const dById = new Map((ds || []).map((d) => [d.id as string, d as { id: string; number: number; name: string; file_path: string; preview_path: string }]));
      const rosters: { spec: RosterSpec; where: string }[] = [];
      for (const g of groups) {
        const qty = g.lines.reduce((a, l) => a + lineQty(l), 0);
        if (!qty) continue;
        for (const im of g.imprints) {
          // names & numbers: every shirt's, asked how (apart or together) below
          if (im.roster?.rows?.length) { rosters.push({ spec: im.roster, where: [im.location, g.name].filter(Boolean).join(", ") }); continue; }
          if (im.method !== "dtf" && im.method !== "screen") continue;
          const d = im.design_id ? dById.get(im.design_id) : undefined;
          const orig = (d && /\.(png|jpe?g|webp|pdf|ai)$/i.test(d.file_path || "") ? d.file_path : d?.preview_path) || "";
          const garment = [g.lines[0]?.color, g.lines[0]?.garment || g.lines[0]?.style].filter(Boolean).join(" ");
          const base = { name: d ? `D-${d.number}${d.name ? ` ${d.name}` : ""}` : im.location, size: im.size || "", qty, where: [im.location, garment].filter(Boolean).join(", ") };
          if (im.method === "dtf") { const src = im.shownArt || orig; if (src) want.push({ ...base, src }); continue; }
          // a screen print: the art as uploaded, or as the Mockup Creator shows it (its inks, knock-outs)
          if (!orig && !im.shownArt) continue;
          const m = im.inkMap?.design === im.design_id ? im.inkMap?.map || {} : {};
          const near = (a: string, b: string) => { const q = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); const x = q(a), y = q(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 40; };
          const changed = Object.entries(m).some(([k, v]) => v && (v.name === "none" || !near(k, v.hex || k)));
          asks.push({ key: `${g.id}|${im.id}`, want: { ...base, src: orig || im.shownArt! }, orig: orig || "", mock: im.shownArt || "", origPic: d?.preview_path || orig, pick: im.shownArt && (changed || !orig) ? "mock" : "orig", changed, label: `${im.location}${d ? ` · D-${d.number}${d.name ? ` ${d.name}` : ""}` : ""}`, inks: im.inks || "" });
        }
      }
      if (rosters.length) { setRosterAsk({ o: o as OrderLite, specs: rosters, rest: want }); setBusy(""); return; }
      // heat press prints: their art as the Mockup Creator shows it, straight in
      if (want.length) { await makeFrom(o as OrderLite, want); setBusy(""); return; }
      // a screen printed order (Oct 26, Nick: "do you want to use the art as originally it was brought in, or… as you
      // have it on the mock-up now?… if you uploaded like a full color image and we told it the 9 colors"): both
      // pictures for each print, pick one
      if (!asks.length) { setErr(`Order #${o.number} has no prints with art to make transfers from.`); setBusy(""); return; }
      if (!asks.some((a) => a.mock && a.orig)) { await makeFrom(o as OrderLite, asks.map((a) => ({ ...a.want, src: a.orig || a.mock }))); setBusy(""); return; }
      const pics = [...new Set(asks.flatMap((a) => [a.mock, a.origPic]).filter(Boolean))];
      const { data: su } = await sb.storage.from("proofs").createSignedUrls(pics, 3600);
      const url = new Map((su || []).map((x) => [x.path, x.signedUrl]));
      setArtAsk({ o: o as OrderLite, rows: asks.map((a) => ({ ...a, mockUrl: url.get(a.mock) || "", origUrl: url.get(a.origPic) || "" })) });
      setBusy(""); return;
      await makeFrom(o as OrderLite, want);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't bring in the order."); }
    setBusy("");
  }
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
      const { error } = await sb.from("gang_sheets").update({ name: nm, data, customer_id: custFor?.id || null, updated_at: new Date().toISOString() }).eq("id", id);
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
  }, [logos, jobs, gap, sheetW, maxLen, plan, sheetName, custFor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
      // the job's customer is the sheet's, when none is set yet
      const cid = (data || []).find((x) => x.customer_id)?.customer_id as string | undefined;
      if (cid && !custFor) { const { data: c } = await sb.from("customers").select("id, company, name").eq("id", cid).maybeSingle(); if (c) setCustFor({ id: c.id as string, label: String(c.company || c.name || "Customer") }); }
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
      for (const f of stored) await sb.from("art_files").insert({ order_id: o.id, name: f.name, file_path: f.path, file_type: "application/pdf", category: "gang_sheet", note: `DTF gang sheet "${sheetName || "gang sheet"}": ${mine}. Open the sheet: /shop/gang-sheet/builder?sheet=${id}`.slice(0, 500) });
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
  // ---------- a customer's artwork (Oct 26, Nick: "select from customers files… go into a customer's artwork… this is
  // MEI, this logo, I need to just put it in there") ----------
  const [cust, setCust] = useState<{ id: string; label: string } | null>(null);
  const [custArt, setCustArt] = useState<{ id: string; number: number; name: string; file_path: string | null; file_type: string | null; preview_path: string | null; pv?: string }[] | null>(null);
  const [custQ, setCustQ] = useState("");
  useEffect(() => {
    if (!cust) { setCustArt(null); return; }
    let live = true;
    void (async () => {
      setCustArt(null);
      const { data } = await sb.from("designs").select("id, number, name, file_path, file_type, preview_path").eq("customer_id", cust.id).is("archived_at", null).order("created_at", { ascending: false }).limit(60);
      const list = (data || []) as NonNullable<typeof custArt>;
      const pvs = list.filter((d) => d.preview_path).map((d) => d.preview_path!);
      const signed = pvs.length ? (await sb.storage.from("proofs").createSignedUrls(pvs, 3600)).data || [] : [];
      const m = new Map(signed.map((x) => [x.path, x.signedUrl]));
      if (live) setCustArt(list.map((d) => ({ ...d, pv: d.preview_path ? m.get(d.preview_path) || "" : "" })));
    })();
    return () => { live = false; };
  }, [cust?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function addDesign(d: NonNullable<typeof custArt>[number]) {
    setBusy(`Getting D-${d.number}…`); setErr("");
    try {
      // the print file when it's one we can read (PDF, AI, PNG, JPG, SVG), else its picture
      const usable = d.file_path && /\.(pdf|ai|png|jpe?g|webp|svg)$/i.test(d.file_path) ? d.file_path : d.preview_path;
      if (!usable) throw new Error("no file");
      const { data: blob, error } = await sb.storage.from("proofs").download(usable);
      if (error || !blob) throw new Error("no file");
      const ext = (usable.match(/\.([a-z0-9]+)$/i)?.[1] || "png").toLowerCase();
      const type = blob.type || (ext === "pdf" || ext === "ai" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`);
      await add([new File([blob], `D-${d.number}${d.name ? ` ${d.name}` : ""}.${ext}`, { type })]);
    } catch { setErr(`D-${d.number} couldn't be read. Download it from Artwork and drop it here.`); setBusy(""); }
  }

  return (
    <>
      {/* back to where you came from (the order, the customer, the Gang sheets page): the usual breadcrumb (Oct 26, Nick) */}
      <BackLink href="/shop/gang-sheet" label="Gang sheets" />
      <div className="page-head">
        <div><h1>Gang sheet builder</h1><div className="eyebrow">Heat press: art laid out on a {DTF_DALLAS.name} sheet, priced, and filed with its jobs</div></div>
        <div className="row gang-acts">
          <div className="gang-pop">
            <button type="button" className={"btn" + (settingsOpen ? " on" : "")} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>Sheet settings</button>
            {settingsOpen && (
              <div className="gang-pop-b" role="dialog" aria-label="Sheet settings">
                <div className="gang-row2">
                  <div className="field"><label htmlFor="g-sw">Sheet width (in)</label><input id="g-sw" type="number" min="4" max={DTF_DALLAS.width} step="0.5" value={sheetW} onChange={(e) => setSheetW(String(Math.min(DTF_DALLAS.width, +e.target.value || DTF_DALLAS.width)))} /></div>
                  <div className="field"><label htmlFor="g-ml">Longest file (in)</label><input id="g-ml" type="number" min="10" max={DTF_DALLAS.maxFileLength} step="10" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} /></div>
                  <div className="field"><label htmlFor="g-mb">Largest file (MB)</label><input id="g-mb" type="number" min="5" step="1" value={maxMb} onChange={(e) => setMaxMb(e.target.value)} /></div>
                </div>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>{DTF_DALLAS.name}: {DTF_DALLAS.width}&quot; wide, up to {DTF_DALLAS.maxFileLength}&quot; a file, {DTF_DALLAS.dpi} dpi. Prices as of {DTF_DALLAS.checked}.</p>
              </div>
            )}
          </div>
          <a className="btn" href={DTF_DALLAS.url} target="_blank" rel="noreferrer">Open {DTF_DALLAS.name}</a>
          {sheetId && row?.status !== "ordered" && logos.length > 0 && <button type="button" className="btn" onClick={() => void markOrdered()} title={`You ordered it at ${DTF_DALLAS.name}: its confirmation is matched to this sheet`}>Mark ordered</button>}
          <button type="button" className="btn primary" disabled={!parts.length || !!busy} onClick={() => void download()}>{busy || "Download PDF"}</button>
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="pv-err sow-msg" role="status">{done}</div>}
      <div className="gang2">
        <div className="gang-left">
          {/* 1. the saved sheets: a small box, the most recent few, the rest under each person's name */}
          <section className="panel">
            <div className="panel-h gang-ph"><div className="gang-pt"><h2>Gang sheets</h2><span className="faint">saved as you go, anyone&apos;s can be opened</span></div><span className="spacer" /><button type="button" className="btn sm" onClick={() => void openSheet("")}>+ New</button></div>
            <div className="panel-b gang-sheets">
              {!sheets.length && <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Your sheet saves as soon as you add art.</p>}
              {recent.map((x) => (
                <div key={x.id} className={"gang-sr-row" + (x.id === sheetId ? " on" : "")}>
                  <button type="button" className={"gang-sr" + (x.id === sheetId ? " on" : "")} onClick={() => void openSheet(x.id)}>
                    <span className="gang-sr-n" data-notranslate>{x.name}</span>
                    <span className="gang-sr-m">{who(x.owner)}&apos;s · {pcsOf(x)} pcs{x.status === "ordered" ? ` · ordered${x.supplier_order ? ` #${x.supplier_order}` : ""}` : ""}</span>
                  </button>
                  <button type="button" className={"gang-del" + (armed === x.id ? " armed" : "")} aria-label={armed === x.id ? `Click again to delete ${x.name}` : `Delete ${x.name}`} title={armed === x.id ? "Click again to delete" : "Delete (click twice)"} onClick={() => void delSheet(x.id)}>{armed === x.id ? "Delete?" : "×"}</button>
                </div>
              ))}
              {sheets.length > recent.length && (
                <select className="gang-more" aria-label="More gang sheets" value="" onChange={(e) => void openSheet(e.target.value)}>
                  <option value="">More sheets…</option>
                  {owners.map((o) => <optgroup key={o} label={`${who(o)}'s sheets`}>{sheets.filter((x) => x.owner === o).map((x) => <option key={x.id} value={x.id}>{x.name} · {pcsOf(x)} pcs · {new Date(x.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{x.status === "ordered" ? " · ordered" : ""}</option>)}</optgroup>)}
                </select>
              )}
              <div className="gang-sheets-cur">
                <input type="text" aria-label="This sheet's name" placeholder="Name this sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
                <span className="faint">{row?.status === "ordered" ? `Ordered${row.supplier_order ? ` #${row.supplier_order}` : ""}${row.expected ? ` · ${row.expected}` : ""}` : saveState || (sheetId ? "Saved" : "")}</span>
              </div>
              {sheets.some((x) => x.id !== sheetId && (x.data?.logos || []).length) && (
                <select className="gang-more" aria-label="Add the art from another sheet" value="" onChange={(e) => void pullFrom(e.target.value)}>
                  <option value="">Add the art from another sheet…</option>
                  {owners.map((o) => <optgroup key={o} label={`${who(o)}'s sheets`}>{sheets.filter((x) => x.owner === o && x.id !== sheetId && (x.data?.logos || []).length).map((x) => <option key={x.id} value={x.id}>{x.name} · {(x.data?.logos || []).length} art</option>)}</optgroup>)}
                </select>
              )}
            </div>
          </section>
          {/* 2. the art: always here; drop or upload, or a customer's artwork */}
          <section className={"panel gang-art" + (dragOver ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); void add(e.dataTransfer.files); }}>
            <div className="panel-h gang-ph"><div className="gang-pt"><h2>Art</h2><span className="faint">sizes, how many, colors to knock out</span></div><span className="spacer" />
              <label className="btn sm">Upload<input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,.ai,.pdf" hidden onChange={(e) => { void add(heldFiles(e.target.files)); e.target.value = ""; }} /></label>
            </div>
            <div className="panel-b stack" style={{ gap: 10 }}>
              {logos.map((lg) => (
                <div key={lg.id} className="gang-card">
                  <div className="gang-card-h">
                    <div className="gang-pic">{lg.src ? <img src={lg.src} alt="" /> : <span>no art</span>}</div>
                    <div className="gang-card-t">
                      {lg.src ? <b data-notranslate title={lg.name}>{shortName(lg.name)}</b> : <input type="text" value={lg.name} onChange={(e) => patchLogo(lg.id, { name: e.target.value })} aria-label="Name" />}
                      <span className="faint">{lg.src ? `${lg.colors.length} color${lg.colors.length === 1 ? "" : "s"}${Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn))) < 200 ? ` · about ${Math.round(lg.srcW / Math.max(...lg.vers.map((v) => v.wIn)))} dpi at its biggest: may print soft` : ""}` : "a size with no art yet, to price it"}</span>
                    </div>
                    {/* how many, right by the art (Oct 26, Nick: "the quantity… in line with the logo… a box that stands out more"); with
                        several sizes each size keeps its own */}
                    {lg.vers.length === 1 ? (
                      <label className="gang-qbox"><span>Qty</span><input type="number" min="1" step="1" value={lg.vers[0].qty} aria-label="How many" onChange={(e) => patchVer(lg.id, lg.vers[0].id, { qty: Math.max(1, Math.round(+e.target.value || 1)) })} /></label>
                    ) : <span className="gang-qtot num">{lg.vers.reduce((a, v) => a + v.qty, 0)} pcs</span>}
                    <button type="button" className="btn icon ghost" aria-label="Remove this art" title="Remove this art" onClick={() => { setLogos((xs) => xs.filter((x) => x.id !== lg.id)); setJobs((js) => js.map((j) => ({ ...j, logos: j.logos.filter((x) => x !== lg.id) }))); }}>×</button>
                  </div>
                  <table className="gang-vt">
                    <thead><tr><th>Size (W × H in)</th>{lg.vers.length > 1 && <th>Qty</th>}<th>For</th><th /></tr></thead>
                    <tbody>{lg.vers.map((v) => (
                      <Fragment key={v.id}>
                      <tr>
                        <td><span className="gang-wh">
                          <input type="number" min="0.25" step="0.05" value={r2(v.wIn)} aria-label="Width in inches" onChange={(e) => setW(lg, v, Math.max(0.25, +e.target.value || 0))} />
                          <span className="faint">×</span>
                          {lg.src ? <input type="number" min="0.25" step="0.05" value={heightOf(lg, v)} aria-label="Height in inches" title="Type either one: the other follows the art's shape" onChange={(e) => { const h = +e.target.value; if (h > 0) setH(lg, v, Math.max(0.25, h)); }} /> : <input type="number" min="0.25" step="0.05" value={v.hIn || 3} aria-label="Height in inches" onChange={(e) => patchVer(lg.id, v.id, { hIn: Math.max(0.25, +e.target.value || 0) })} />}
                        </span></td>
                        {lg.vers.length > 1 && <td><input className="gang-q" type="number" min="1" step="1" value={v.qty} aria-label="How many" onChange={(e) => patchVer(lg.id, v.id, { qty: Math.max(1, Math.round(+e.target.value || 1)) })} /></td>}
                        <td><input type="text" value={v.label} placeholder="Youth, red…" aria-label="What it's for" onChange={(e) => patchVer(lg.id, v.id, { label: e.target.value })} /></td>
                        <td>{lg.vers.length > 1 && <button type="button" className="btn icon ghost" aria-label="Remove this size" title="Remove this size" onClick={() => patchLogo(lg.id, { vers: lg.vers.filter((x) => x.id !== v.id) })}>×</button>}</td>
                      </tr>
                      {/* the colors to knock out on their own line under the size (Oct 28, Nick: with a lot of colors they
                          squeezed the size boxes so the numbers couldn't be read) */}
                      {lg.src && lg.colors.length > 0 && <tr className="gang-kor"><td colSpan={lg.vers.length > 1 ? 4 : 3}><div className="gang-korow">
                        <span className="gang-kol">Knock out</span>
                        <span className="gang-ko">{lg.colors.map((h) => <button key={h} type="button" className={"gang-dot" + (v.knock.includes(h) ? " off" : "")} style={{ background: h }} aria-pressed={v.knock.includes(h)} title={v.knock.includes(h) ? `${h} knocked out: click to print it again` : `Knock out ${h} on these`} onClick={() => toggleKnock(lg, v, h)} />)}</span>
                        {v.knock.length > 0 && <span className="faint">{v.knock.length} off</span>}
                      </div></td></tr>}
                      </Fragment>
                    ))}</tbody>
                  </table>
                  <button type="button" className="lc-link gang-add" onClick={() => addVer(lg)}>+ Add a size</button>
                </div>
              ))}
              <label className={"gang-drop" + (logos.length ? "" : " big")}>
                <span><b>Drop or upload art here</b><br /><span className="faint">PNG, JPG, PDF, AI</span></span>
                <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,.ai,.pdf" hidden onChange={(e) => { void add(heldFiles(e.target.files)); e.target.value = ""; }} />
              </label>
              <div className="gang-cust">
                <span className="faint">or pick from a customer&apos;s artwork</span>
                <CustomerPick value={cust?.id || null} label={cust?.label} field ariaLabel="Customer whose artwork to use" onPick={(id, label) => { setCust(id ? { id, label } : null); setCustQ(""); }} />
                {cust && (custArt === null ? <p className="faint" style={{ fontSize: 12.5 }}>Loading their artwork…</p> : !custArt.length ? <p className="faint" style={{ fontSize: 12.5 }}>No artwork saved for {cust.label}.</p> : (
                  <>
                    {custArt.length > 8 && <input type="search" className="gang-cust-q" placeholder="Find a logo" value={custQ} onChange={(e) => setCustQ(e.target.value)} aria-label="Find a logo" />}
                    <div className="gang-cust-grid">
                      {custArt.filter((d) => !custQ.trim() || `D-${d.number} ${d.name}`.toLowerCase().includes(custQ.trim().toLowerCase())).slice(0, 24).map((d) => (
                        <button key={d.id} type="button" className="gang-cust-d" disabled={!!busy} onClick={() => void addDesign(d)} title={`Add D-${d.number}${d.name ? ` ${d.name}` : ""}`}>
                          {d.pv ? <img src={d.pv} alt="" /> : <span className="faint">D-{d.number}</span>}
                          <span>D-{d.number}{d.name ? ` · ${d.name}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ))}
              </div>
              <button type="button" className="lc-link" onClick={addSize} style={{ alignSelf: "flex-start" }}>+ Add a size with no art yet (to price it)</button>
            </div>
          </section>
          {/* 3. the order it's for */}
          <section className="panel">
            <div className="panel-h gang-ph"><div className="gang-pt"><h2>Order</h2><span className="faint">who and which job it&apos;s for: the sheet goes in its production files</span></div></div>
            <div className="panel-b stack" style={{ gap: 10 }}>
              <div className="field"><label>Customer</label><CustomerPick value={custFor?.id || null} label={custFor?.label} field ariaLabel="The customer this sheet is for" onPick={(cid, label) => setCustFor(cid ? { id: cid, label } : null)} />
                <span className="faint" style={{ fontSize: 12 }}>{custFor ? `On ${custFor.label}'s page under Artwork (staff only).` : "Saved under the customer's Artwork (staff only)."}</span></div>
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
              <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setJobs((js) => [...js, { id: uid(), job: "", logos: [], note: "" }])}>{jobs.length ? "+ Another job" : "+ Add the job it's for"}</button>
            </div>
          </section>
        </div>
        {/* the cost, then the sheet */}
        <div className="gang-right">
          <div className="stats gang-sum">
              <button type="button" className="stat"><span className="v">{money(cost)}</span><span className="k">{DTF_DALLAS.name} cost</span></button>
              <button type="button" className="stat"><span className="v">{r2(film)}&quot; / {bought}&quot;</span><span className="k">Film used / bought</span></button>
              <button type="button" className="stat"><span className="v">{n ? money(cost / n) : "—"}</span><span className="k">Per transfer, average</span></button>
              <button type="button" className="stat"><span className="v">{filmSqIn ? `${Math.round((usedSqIn / filmSqIn) * 100)}%` : "—"}</span><span className="k">Film covered by art</span></button>
          </div>
          <section className="panel gang-sheet-p">
            <div className="panel-h gang-tabs">
              <div className="chips">
                <button type="button" className={"chip" + (tab === "sheet" ? " on" : "")} onClick={() => setTab("sheet")}>Sheet</button>
                <button type="button" className={"chip" + (tab === "pieces" ? " on" : "")} onClick={() => setTab("pieces")}>Pieces <span className="pill-n">{pieces.length}</span></button>
                <button type="button" className={"chip" + (tab === "files" ? " on" : "")} onClick={() => setTab("files")}>Files <span className="pill-n">{parts.length}</span></button>
              </div>
              <span className="spacer" />
              <button type="button" className={"btn sm" + (plan.algo === "grouped" ? " on" : "")} disabled={!pieces.length} aria-pressed={plan.algo === "grouped"} onClick={() => { setPlan({ turn: "as is", order: "area", algo: "grouped" }); setOptimized(null); setShown(0); setTab("sheet"); }} title="Each size together in its own rows, so they cut apart one size at a time">Grouped layout</button>
              <button type="button" className="btn primary sm" disabled={!pieces.length} onClick={optimize} title="Tries each piece turned and not, and ways of stacking them, and keeps the one that costs least">Optimize sheet</button>
              {tab === "sheet" && <span className="gang-zoom">
                <button type="button" className="btn sm" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, r2(z / 1.5)))}>−</button>
                <button type="button" className="btn sm ghost" onClick={() => setZoom(1)} title="Fit the width">{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
                <button type="button" className="btn sm" aria-label="Zoom in" disabled={zoom >= 6} onClick={() => setZoom((z) => Math.min(6, r2(z * 1.5)))}>+</button>
              </span>}
            </div>
            <div className="panel-b">
              {/* the space between pieces, right over the sheet (Oct 26, Nick: "put that above the image preview so that you can slide that") */}
              <div className="gang-gap">
                <label htmlFor="g-gap">Space between</label>
                <input id="g-gap" type="range" min="0" max="1" step="0.0625" value={g} onChange={(e) => setGap(e.target.value)} />
                <b className="num">{+g.toFixed(3)}&quot;</b>
                <div className="chips">{([[0.125, "1/8"], [0.25, "1/4"], [0.5, "1/2"]] as const).map(([v, t]) => <button key={v} type="button" className={"chip" + (Math.abs(g - v) < 0.001 ? " on" : "")} onClick={() => setGap(String(v))}>{t}&quot;</button>)}</div>
                <span className="spacer" />
                {/* the size to buy (Oct 26, Nick: DTF Dallas "rounds up to the nearest 10 inches… say current size") */}
                {pieces.length > 0 && lay && <span className="gang-size num">Sheet size: <b>{parts.map((p) => `${W}" × ${p.buy.length}"`).join(" + ")}</b><span className="faint"> · {r2(film)}&quot; used</span></span>}
              </div>
              {g < 0.25 && pieces.length > 0 && <p className="gang-warn" style={{ margin: "0 0 8px" }}>Under 1/4&quot; between pieces is hard to cut apart with scissors.</p>}
              {plan.algo === "grouped" && <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Grouped: each size in its own rows, biggest first. Optimize sheet packs them tighter.</p>}
              {optimized && (optimized.before - film > 0.05 ? <p className="puff-ok" style={{ margin: "0 0 8px" }}>Optimized: {r2(optimized.before - film)}&quot; less film{optimized.beforeCost - cost > 0.005 ? `, ${money(optimized.beforeCost - cost)} less` : ""}.</p> : <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Optimized: {r2(film)}&quot; is already the shortest it gets for these sizes.</p>)}
              {!pieces.length ? <div className="gang-empty">Add art on the left (drop it, upload it, or pick a customer&apos;s), or a size with no art to price a job.</div> : !lay ? <p className="gang-warn">A piece is wider than the {W}&quot; sheet even turned. Make it smaller.</p> : tab === "sheet" ? (
                <>
                  {parts.length > 1 && <div className="chips" style={{ marginBottom: 8 }}>{parts.map((p, i) => <button key={i} type="button" className={"chip" + (i === Math.min(shown, parts.length - 1) ? " on" : "")} onClick={() => setShown(i)}>File {i + 1} · {W}&quot;×{p.buy.length}&quot;</button>)}</div>}
                  <div ref={box} className="gang-view">{cur && <canvas ref={pv} />}</div>
                  <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>Dashed lines: where to cut (on screen only). Shaded: film you buy past the layout.</p>
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
          </section>
        </div>
      </div>
      {rosterAsk && (() => { const n = rosterAsk.specs.reduce((a, x) => a + x.spec.rows.length, 0), both = rosterAsk.specs.some((x) => x.spec.show === "both"); return (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Names and numbers on the sheet" onClick={() => setRosterAsk(null)}>
          <div className="dla" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3>Names &amp; numbers · order #{rosterAsk.o.number}</h3>
            <p className="dla-sub">{n} shirt{n === 1 ? "" : "s"} on the {rosterAsk.specs.map((x) => x.where).join(", ")}{rosterAsk.rest.length ? `, with the order's other ${rosterAsk.rest.length === 1 ? "print" : "prints"}` : ""}. {both ? "How should they go on the sheet?" : ""}</p>
            {both ? (
              <div className="gang-rs">
                <button type="button" className="gang-rs-o" onClick={() => void addRoster(true)}><b>Names and numbers apart</b><span>Every name and every number its own transfer; the same ones add up. Less film: put each shirt&apos;s together on press.</span></button>
                <button type="button" className="gang-rs-o" onClick={() => void addRoster(false)}><b>Each shirt&apos;s together</b><span>The name over the number, spaced and ready to press. Best for a short list.</span></button>
              </div>
            ) : null}
            <div className="dla-acts"><span className="spacer" /><button type="button" className="btn ghost" onClick={() => setRosterAsk(null)}>Cancel</button>{!both && <button type="button" className="btn primary" onClick={() => void addRoster(true)}>Put them on the sheet</button>}</div>
          </div>
        </div>
      ); })()}
      {artAsk && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Which art goes on the transfers" onClick={() => setArtAsk(null)}>
          <div className="dla grd" onClick={(e) => e.stopPropagation()}>
            <div className="panel-h gang-ph">
              <div className="gang-pt"><h2>Create DTF gang sheet</h2><span className="faint">Order #{artAsk.o.number} is screen printed. Which art goes on the transfers?</span></div>
              <span className="spacer" />
              <button type="button" className="btn icon ghost" aria-label="Close" onClick={() => setArtAsk(null)}>×</button>
            </div>
            <div className="grd-b">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn sm" onClick={() => setArtAsk((a) => a && { ...a, rows: a.rows.map((r) => ({ ...r, pick: r.orig ? "orig" : "mock" })) })}>All: art as uploaded</button>
                <button type="button" className="btn sm" onClick={() => setArtAsk((a) => a && { ...a, rows: a.rows.map((r) => ({ ...r, pick: r.mock ? "mock" : "orig" })) })}>All: as on the mockup</button>
              </div>
              {artAsk.rows.map((r) => (
                <div key={r.key} className="grd-card">
                  <b className="gang-ask-n" data-notranslate>{r.label}</b>
                  <span className="faint gang-ask-s">{r.inks ? `Inks: ${r.inks}` : "No inks set"}{!r.changed ? " · both look the same" : ""}</span>
                  <div className="gang-ask-two">
                    {(["orig", "mock"] as const).map((k) => {
                      const has = k === "orig" ? !!r.orig : !!r.mock, u = k === "orig" ? r.origUrl : r.mockUrl;
                      return (
                        <button key={k} type="button" className={"gang-ask-o" + (r.pick === k ? " on" : "")} disabled={!has} aria-pressed={r.pick === k} onClick={() => setArtAsk((a) => a && { ...a, rows: a.rows.map((x) => (x.key === r.key ? { ...x, pick: k } : x)) })}>
                          <span className="gang-ask-pic">{u ? <img src={u} alt="" /> : <span className="faint">{has ? "No picture" : "Not saved from the Mockup Creator"}</span>}</span>
                          <b>{k === "orig" ? "Art as uploaded" : "As on the mockup"}</b>
                          <span className="faint">{k === "orig" ? "Full color, every shade" : "The inks picked, knock-outs"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="grd-f">
              <span className="faint" style={{ flex: 1, whiteSpace: "normal" }}>Sizes and counts come from the order either way.</span>
              <button type="button" className="btn primary" disabled={!!busy} onClick={async () => {
                const a = artAsk; setArtAsk(null); setBusy("Bringing in the art…");
                try { await makeFrom(a.o, a.rows.map((r) => ({ ...r.want, src: r.pick === "mock" && r.mock ? r.mock : r.orig || r.mock }))); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't bring in the order."); }
                setBusy("");
              }}>Make the sheet</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
