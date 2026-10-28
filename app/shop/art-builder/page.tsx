"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import type { Customer, Design } from "@/lib/pricing";
import CustomerPick from "@/components/CustomerPick";
import SearchInput from "@/components/SearchInput";
import { uploadDesign } from "@/lib/designs";
import { nextSewCode, sewFilesOf, tajimaName, type Brand, type SewFile } from "@/lib/brands";
import { tajimaFile } from "@/components/CustomerBrands";
import { useSticky } from "@/lib/useSticky";

/**
 * Customer artwork builder, in Shop Tools (Oct 28, Nick: "call it customer artwork builder… select a customer from a
 * dropdown, have a search… once you check it, you would drop down all the files… then you can create their brand… the
 * easiest way for me to get clients onboarded"). First asked as (Oct 28, Nick: "how can we quickly bring in art… I want to be able to quickly look at all the artwork for
 * Embark… click the jobs… I select them and say, these are the arts I want you to bring in… name what type of file it is,
 * digitizing or whatever… without me having to go through and download and upload everything"). A client's Printavo jobs
 * with every attachment; tick a file, say what it is, and Bring in makes the logos (with a D-number, under the picked
 * brand) and files the sew files on them. A DST brings its EMB and sewing PDF with it (Nick: "attached to the DST is those
 * other two files… within the art you would store that").
 */
type Job = { id: string; visual_id: string; nickname: string; order_date: string; files: Record<string, string> | null; search_text?: string | null;
  /** a Dropbox folder (the builder's Dropbox source): its path there */ dbx?: string };
type DbxEntry = { id: string; name: string; folder: boolean; path: string; size?: number };
type Item = { key: string; job: Job; path: string; name: string; ext: string; kind: "art" | "sew" | "sheet" | "other"; emb?: string; sheet?: string };
type Box = [number, number, number, number];
/** a piece cut off a file (a logo off a proof or product sheet): its page and box (0–1 of the page, y down), and a picture */
type Cut = { page: number; box: Box; pic: string; /** where it prints ("Front", "Left Chest") */ loc?: string; /** how wide it prints, inches: the logo is saved at this size */ wIn?: number };
type Pick = { on: boolean; as: "logo" | "sew"; name: string; target: string; /** a sew file: where it goes ("Left Chest, Left Sleeve") */ where?: string; /** a cut off this file (the pick's key is "<file>#<n>") */ src?: string; cut?: Cut };
type D = Design & { brand_id?: string | null };

const ART = /^(pdf|ai|png|jpe?g|svg|eps|psd|tiff?|webp)$/;
const PREVIEW = /^(pdf|ai|png|jpe?g|webp|svg)$/;
const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
/** the file's own name: Printavo's copies start with a short code ("mukt3xws5-Embark-Logo.pdf") */
const nameOf = (p: string) => (p.split("/").pop() || p).replace(/^(?=[a-z0-9]*\d)[a-z0-9]{6,12}-/, "");
const baseOf = (p: string) => nameOf(p).replace(/\.[^.]+$/, "").toLowerCase();
/** a name a person gave it (not a filepicker code like "qtTHnfKGTcCccaDxZY0w") */
const realName = (p: string) => { const b = nameOf(p).replace(/\.[^.]+$/, ""); return /^[A-Za-z0-9]{18,22}$/.test(b) ? "" : b.replace(/[_-]+/g, " ").trim(); };
const typeOf = (ext: string) => ({ pdf: "application/pdf", ai: "application/illustrator", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", eps: "application/postscript", psd: "image/vnd.adobe.photoshop", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp" } as Record<string, string>)[ext] || "application/octet-stream";

/** a job's files: Printavo's thumbnails left out; each DST with its EMB and sewing PDF (same name) as one sew file */
function itemsOf(job: Job): Item[] {
  const paths = [...new Set(Object.entries(job.files || {}).filter(([k]) => !/resize=|output=format|ico-document/.test(k)).map(([, v]) => v))];
  const dsts = paths.filter((p) => extOf(p) === "dst");
  const used = new Set<string>();
  const out: Item[] = [];
  for (const d of dsts) {
    const b = baseOf(d);
    let emb = paths.find((p) => extOf(p) === "emb" && baseOf(p) === b);
    if (!emb && dsts.length === 1) { const embs = paths.filter((p) => extOf(p) === "emb"); if (embs.length === 1) emb = embs[0]; }
    const sheet = paths.find((p) => extOf(p) === "pdf" && baseOf(p) === b);
    if (emb) used.add(emb); if (sheet) used.add(sheet);
    out.push({ key: d, job, path: d, name: nameOf(d), ext: "dst", kind: "sew", ...(emb ? { emb } : {}), ...(sheet ? { sheet } : {}) });
  }
  for (const p of paths) {
    if (used.has(p) || extOf(p) === "dst") continue;
    const ext = extOf(p);
    out.push({ key: p, job, path: p, name: nameOf(p), ext, kind: ART.test(ext) ? "art" : "other" });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "art" ? -1 : b.kind === "art" ? 1 : a.kind === "sew" ? -1 : 1));
}

/* pictures of the files, a few at a time (PDF / AI drawn by pdf.js) */
const PICS = new Map<string, Promise<string>>();
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}
function picOf(sb: ReturnType<typeof createClient>, path: string): Promise<string> {
  if (!PICS.has(path)) PICS.set(path, slot(async () => {
    const ext = extOf(path);
    if (/^(png|jpe?g|webp|svg)$/.test(ext)) { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 3600); return data?.signedUrl || ""; }
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return "";
    const { pdfPicture } = await import("@/lib/printavoArt");
    const c = await pdfPicture(await data.arrayBuffer(), 420);
    return c.toDataURL("image/jpeg", 0.8);
  }).catch(() => ""));
  return PICS.get(path)!;
}
function Pic({ sb, path }: { sb: ReturnType<typeof createClient>; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let on = true;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); picOf(sb, path).then((u) => { if (on) setSrc(u); }); } }, { rootMargin: "300px" });
    if (el.current) io.observe(el.current);
    return () => { on = false; io.disconnect(); };
  }, [sb, path]);
  return <span className="bi-pic" ref={el}>{src ? <img src={src} alt="" /> : <span className="faint">{src === "" ? "No picture" : "Loading…"}</span>}</span>;
}
/* what a DST and a sewing sheet say, read once each: to put a job's sewing sheet with its DST when the names differ
   (Oct 28, Nick on #33064: "the PDF isn't going with the DST") */
type Facts = { stitches: number; wIn: number; hIn: number; colors: number };
const FACTS = new Map<string, Promise<Facts | null>>();
function factsOf(sb: ReturnType<typeof createClient>, path: string): Promise<Facts | null> {
  if (!FACTS.has(path)) FACTS.set(path, (async () => {
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return null;
    const buf = await data.arrayBuffer();
    if (extOf(path) === "dst") { const { readDst } = await import("@/lib/dst"); const i = readDst(buf); return { stitches: i.stitches, wIn: i.wIn, hIn: i.hIn, colors: i.colors }; }
    const [{ pdfText }, { parseWorksheet }] = await Promise.all([import("@/lib/printavoArt"), import("@/lib/worksheet")]);
    const w = parseWorksheet(await pdfText(buf, 3));
    return w ? { stitches: w.stitches, wIn: w.wIn, hIn: w.hIn, colors: w.colors } : null;
  })().catch(() => null));
  return FACTS.get(path)!;
}
const factLine = (f: Facts) => `${f.wIn}" × ${f.hIn}" · ${f.stitches.toLocaleString()} st · ${f.colors} color${f.colors === 1 ? "" : "s"}`;
/* where a job's embroidery went, read off its mockups and line items (Oct 28, Nick: "we have to know what the DST is…
   where it was used… last used on 33998, the location was left chest and left sleeve… the little E… on the nape") */
const LOCS: [RegExp, string][] = [[/left\s+chest/i, "Left Chest"], [/right\s+chest/i, "Right Chest"], [/left\s+(sleeve|arm)/i, "Left Sleeve"], [/right\s+(sleeve|arm)/i, "Right Sleeve"],
  [/nape|back\s+(of\s+(the\s+)?)?neck|neck\s*line|back\s+collar/i, "Nape"], [/full\s+back/i, "Full Back"], [/upper\s+back|yoke/i, "Upper Back"], [/center\s+(chest|front)|front\s+center/i, "Center Chest"],
  [/(hat|cap)\s+front|front\s+of\s+(the\s+)?(hat|cap)/i, "Hat Front"], [/left\s+hip/i, "Left Hip"], [/right\s+hip/i, "Right Hip"], [/cuff/i, "Cuff"], [/side\s+of\s+(the\s+)?(hat|cap)/i, "Hat Side"]];
const locsIn = (t: string) => LOCS.filter(([re]) => re.test(t)).map(([, n]) => n);
const TEXTS = new Map<string, Promise<string>>();
function textOf(sb: ReturnType<typeof createClient>, path: string): Promise<string> {
  if (!TEXTS.has(path)) TEXTS.set(path, (async () => {
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return "";
    const { pdfText } = await import("@/lib/printavoArt");
    return await pdfText(await data.arrayBuffer(), 4);
  })().catch(() => ""));
  return TEXTS.get(path)!;
}
const fmtDay = (d: string) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/** a job's files with each sewing sheet put with the DST it was made for (same stitches or size) */
function arrange(list: Item[], facts: Record<string, Facts | null | undefined>): Item[] {
  const sheets = list.filter((i) => i.kind === "art" && i.ext === "pdf" && facts[i.path]);
  if (!sheets.length) return list;
  const out = list.map((i) => ({ ...i })), taken = new Set<string>();
  for (const d of out.filter((i) => i.kind === "sew" && !i.sheet)) {
    const f = facts[d.path]; if (!f) continue;
    const m = sheets.find((x) => { const w = facts[x.path]!; return !taken.has(x.path) && ((f.stitches && Math.abs(w.stitches - f.stitches) / f.stitches <= 0.03) || (Math.abs(w.wIn - f.wIn) < 0.06 && Math.abs(w.hIn - f.hIn) < 0.06)); });
    if (m) { d.sheet = m.path; taken.add(m.path); }
  }
  return out.filter((i) => !taken.has(i.path)).map((i) => (i.kind === "art" && i.ext === "pdf" && facts[i.path] ? { ...i, kind: "sheet" as const } : i));
}
function DstInfo({ sb, path }: { sb: ReturnType<typeof createClient>; path: string }) {
  const [t, setT] = useState("");
  useEffect(() => { let on = true; factsOf(sb, path).then((f) => { if (on) setT(f ? factLine(f) : "Couldn't read the DST"); }); return () => { on = false; }; }, [sb, path]);
  return <span className="faint">{t || "Reading the DST…"}</span>;
}

/* ---------- picking the logo off a proof, a product sheet or a photo (Oct 28, Nick: "if it's not a direct file… pop up
   and say, what am I bringing in?… click on the element and just bring in the parts you need… on 34218 I just need the
   Embark logo") ---------- */
const VIEW_W = 1100;
async function pageCanvas(buf: ArrayBuffer, ext: string, page: number): Promise<{ c: HTMLCanvasElement; pages: number }> {
  if (/^(png|jpe?g|webp)$/.test(ext)) {
    const url = URL.createObjectURL(new Blob([buf]));
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, VIEW_W / img.naturalWidth), c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return { c, pages: 1 };
  }
  const { pdfPicture, pdfPageCount } = await import("@/lib/printavoArt");
  const [c, pages] = await Promise.all([pdfPicture(buf.slice(0), VIEW_W, page), pdfPageCount(buf.slice(0))]);
  return { c, pages };
}
/** the element under a click: the inked shapes around it (gaps of a few pixels bridged), as a box on the page */
function elementAt(c: HTMLCanvasElement, x: number, y: number): Box | null {
  const W = c.width, H = c.height, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = d[i * 4] < 238 || d[i * 4 + 1] < 238 || d[i * 4 + 2] < 238 ? 1 : 0;
  // bridge small gaps (letters of a word, a logo's parts): dilate by r
  const r = 5, row = new Uint8Array(W * H), dil = new Uint8Array(W * H);
  for (let yy = 0; yy < H; yy++) { let last = -1e9; for (let xx = 0; xx < W; xx++) { if (ink[yy * W + xx]) last = xx; if (xx - last <= r) row[yy * W + xx] = 1; } last = 1e9; for (let xx = W - 1; xx >= 0; xx--) { if (ink[yy * W + xx]) last = xx; if (last - xx <= r) row[yy * W + xx] = 1; } }
  for (let xx = 0; xx < W; xx++) { let last = -1e9; for (let yy = 0; yy < H; yy++) { if (row[yy * W + xx]) last = yy; if (yy - last <= r) dil[yy * W + xx] = 1; } last = 1e9; for (let yy = H - 1; yy >= 0; yy--) { if (row[yy * W + xx]) last = yy; if (last - yy <= r) dil[yy * W + xx] = 1; } }
  const s0 = Math.round(y) * W + Math.round(x);
  if (!dil[s0]) return null;
  const seen = new Uint8Array(W * H), st = [s0]; seen[s0] = 1;
  let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
  while (st.length) {
    const q = st.pop()!, qx = q % W, qy = (q / W) | 0; n++;
    if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
    for (const nb of [q - 1, q + 1, q - W, q + W]) if (nb >= 0 && nb < W * H && !seen[nb] && dil[nb] && Math.abs((nb % W) - qx) <= 1) { seen[nb] = 1; st.push(nb); }
  }
  void n;
  return [Math.max(0, x0 - r) / W, Math.max(0, y0 - r) / H, Math.min(W, x1 + r) / W, Math.min(H, y1 + r) / H];
}
function boxPic(c: HTMLCanvasElement, b: Box): string {
  const [x0, y0, x1, y1] = [b[0] * c.width, b[1] * c.height, b[2] * c.width, b[3] * c.height];
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), k = Math.min(1, 240 / Math.max(w, h));
  const o = document.createElement("canvas"); o.width = Math.round(w * k); o.height = Math.round(h * k);
  o.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
  return o.toDataURL("image/png");
}
/** a cut made into the logo file: PDFs and Illustrator files at print resolution (lib/setupSheet cutProduct: the white
 *  page and the spec text around it come off); a photo's piece as it is, its white taken off */
/** the bounds of a vector shape's outline ("x y m / x y l / x1 y1 x2 y2 x3 y3 c / h" lines) */
function opsBox(ops: string): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of ops.split("\n")) { const n = l.trim().split(/\s+/).slice(0, -1).map(Number); for (let i = 0; i + 1 < n.length; i += 2) { if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i]; if (n[i + 1] < y0) y0 = n[i + 1]; if (n[i + 1] > y1) y1 = n[i + 1]; } }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
/** the vector shapes inside the box, as an SVG of just them (like the Helper pulls art off a mockup): null when the
 *  box has no shapes (the logo is part of a photo) */
async function vectorCut(buf: ArrayBuffer, cut: Cut, name: string): Promise<File | null> {
  if (cut.page !== 1) return null; // the vector reader reads the first page
  const [{ parsePdf, browserInflate }, { vartSvg }] = await Promise.all([import("@/lib/pdfVector"), import("@/lib/epsVector")]);
  // strokes kept as strokes: the SVG scales their width with the art (Illustrator's Scale Strokes & Effects)
  const v = await parsePdf(new Uint8Array(buf.slice(0)), browserInflate, { strokes: true });
  if (!v.shapes.length) return null;
  const [bx0, by0, bx1, by1] = [cut.box[0] * v.w, cut.box[1] * v.h, cut.box[2] * v.w, cut.box[3] * v.h];
  const bw = bx1 - bx0, bh = by1 - by0;
  const inside = v.shapes.filter((sh) => {
    const b = opsBox(sh.ops); if (!b) return false;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    // its middle in the box, and not a big shape the box only sits on (a photo frame, the page)
    return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1 && b[2] - b[0] <= bw * 1.15 && b[3] - b[1] <= bh * 1.15;
  });
  if (!inside.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of inside) { const b = opsBox(sh.ops)!, e = (sh.stroke?.w || 0) / 2; x0 = Math.min(x0, b[0] - e); y0 = Math.min(y0, b[1] - e); x1 = Math.max(x1, b[2] + e); y1 = Math.max(y1, b[3] + e); }
  const w = Math.max(0.1, x1 - x0), h = Math.max(0.1, y1 - y0);
  // saved at the size it prints (Oct 28, Nick: "he put it really small… we need to normalize it… it was a 2-inch flag"):
  // the SVG's width and height in inches; the art inside scales to it, strokes and all
  const svg0 = vartSvg({ ok: true, x: x0, y: y0, w, h, shapes: inside });
  const wIn = cut.wIn && cut.wIn > 0 ? cut.wIn : 0;
  const svg = wIn ? svg0.replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${wIn.toFixed(3)}in" height="${((wIn * h) / w).toFixed(3)}in"`) : svg0.replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="1000" height="${Math.round((1000 * h) / w)}"`);
  return new File([svg], `${name.replace(/[^\w .-]+/g, "").trim() || "logo"}.svg`, { type: "image/svg+xml" });
}

async function cutToFile(buf: ArrayBuffer, ext: string, cut: Cut, name: string): Promise<File | null> {
  if (!/^(png|jpe?g|webp)$/.test(ext)) {
    // the vector art itself when the box holds shapes; else a print-resolution picture of it
    const vec = await vectorCut(buf, cut, name).catch(() => null);
    if (vec) return vec;
    const { cutProduct } = await import("@/lib/setupSheet");
    const r = await cutProduct(buf.slice(0), { page: cut.page, logo: cut.box, name });
    return r.art;
  }
  const url = URL.createObjectURL(new Blob([buf]));
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const [x0, y0, x1, y1] = [cut.box[0] * img.naturalWidth, cut.box[1] * img.naturalHeight, cut.box[2] * img.naturalWidth, cut.box[3] * img.naturalHeight];
  const c = document.createElement("canvas"); c.width = Math.round(x1 - x0); c.height = Math.round(y1 - y0);
  const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  const id = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) if (id.data[i] > 245 && id.data[i + 1] > 245 && id.data[i + 2] > 245) id.data[i + 3] = 0;
  g.putImageData(id, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  return blob ? new File([blob], `${name.replace(/[^\w .-]+/g, "").trim() || "logo"}.png`, { type: "image/png" }) : null;
}

/** a usual print width for a location when the page doesn't say */
const usualWidth = (loc: string) => (!loc ? 3.5 : /nape|hat side/i.test(loc) ? 2.5 : /sleeve/i.test(loc) ? 3 : /chest/i.test(loc) ? 3.5 : /hat/i.test(loc) ? 4 : /upper back/i.test(loc) ? 10 : /full|^front$|^back$/i.test(loc) ? 11 : 3.5);
/** what the page says next to the box: a width ("2 inch wide", 3.5") and a location ("left sleeve") */
async function nearBox(buf: ArrayBuffer, ext: string, page: number, box: Box): Promise<{ wIn?: number; loc?: string }> {
  if (!/^(pdf|ai)$/.test(ext)) return {};
  const { PDFJS, PDFJS_WORKER } = await import("@/lib/artPrep");
  const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; getTextContent: () => Promise<{ items: { str?: string; transform?: number[] }[] }> }> }> } };
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise, pg = await doc.getPage(page), vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const near = tc.items.filter((it) => it.str?.trim() && it.transform).map((it) => ({ t: it.str!, d: Math.hypot(it.transform![4] / vp.width - cx, 1 - it.transform![5] / vp.height - cy) })).sort((a, b) => a.d - b.d).slice(0, 12);
  const text = near.filter((x) => x.d < 0.35).map((x) => x.t).join(" ");
  const m = /(\d+(?:\.\d+)?)\s*(?:"|”|''|in\b|inch(?:es)?)\s*(?:wide|w\b|width)?/i.exec(text);
  const wIn = m ? +m[1] : undefined;
  const loc = LOCS.find(([re]) => re.test(text))?.[1];
  return { ...(wIn && wIn >= 0.5 && wIn <= 16 ? { wIn } : {}), ...(loc ? { loc } : {}) };
}
const LOC_OPTS = ["Front", "Back", "Left Chest", "Right Chest", "Center Chest", "Full Front", "Full Back", "Upper Back", "Nape", "Left Sleeve", "Right Sleeve", "Hat Front", "Hat Side", "Hat Back", "Other"];
function CutPop({ sb, it, cuts, onWhole, onCut, onClose, defName }: { sb: ReturnType<typeof createClient>; it: Item; cuts: { name: string; pic: string; loc?: string; wIn?: number }[]; onWhole: () => void; onCut: (c: Cut, name: string) => void; onClose: () => void; defName: string }) {
  // the location is optional (Oct 28, Nick: "sometimes… it's just a regular logo"; other times "2 inches… left sleeve and
  // left chest"): typed or picked, several allowed
  const [nm, setNm] = useState(defName), [loc, setLoc] = useState("");
  const [wIn, setWIn] = useState(""), [wFrom, setWFrom] = useState("");
  const [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [pic, setPic] = useState(""), [err, setErr] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const can = useRef<HTMLCanvasElement | null>(null), buf = useRef<ArrayBuffer | null>(null), drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let on = true;
    (async () => {
      setPic(""); setBox(null); setErr("");
      if (!buf.current) { const { data } = await sb.storage.from("proofs").download(it.path); if (!data) throw new Error("Couldn't open the file."); buf.current = await data.arrayBuffer(); }
      const r = await pageCanvas(buf.current, it.ext, page);
      if (!on) return;
      can.current = r.c; setPages(r.pages); setPic(r.c.toDataURL("image/jpeg", 0.9));
    })().catch((e) => setErr(e instanceof Error ? e.message : "Couldn't draw the file."));
    return () => { on = false; };
  }, [sb, it, page]);
  useEffect(() => {
    if (!box || !buf.current) return;
    let on = true;
    nearBox(buf.current, it.ext, page, box).then((r) => {
      if (!on) return;
      if (r.loc && !loc) setLoc(r.loc);
      if (r.wIn) { setWIn(String(r.wIn)); setWFrom("from the page"); } else { const l = r.loc || loc; setWIn(String(usualWidth(l))); setWFrom(l ? `usual for ${l.toLowerCase()}` : "a usual logo size: set it"); }
    }).catch(() => { if (on) { setWIn(String(usualWidth(loc))); setWFrom(loc ? `usual for ${loc.toLowerCase()}` : "a usual logo size: set it"); } });
    return () => { on = false; };
  }, [box]); // eslint-disable-line react-hooks/exhaustive-deps
  const ratio = box ? ((box[3] - box[1]) * (can.current?.height || 1)) / Math.max(1e-6, (box[2] - box[0]) * (can.current?.width || 1)) : 1;
  const at = (e: React.PointerEvent) => { const r = wrap.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="What are you bringing in?" onClick={onClose}>
      <div className="dla bi-cut" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>What are you bringing in? · {it.name}</h3>
        <p className="dla-sub">Click the logo on the page to pick it, or drag a box around it. Add each logo you want; the whole file can come in as it is too.</p>
        {pages > 1 && <div className="toolbar" data-toolbar><div className="chips">{Array.from({ length: Math.min(pages, 12) }, (_, i) => <button key={i} type="button" className={"chip" + (page === i + 1 ? " on" : "")} onClick={() => setPage(i + 1)}>Page {i + 1}</button>)}</div></div>}
        <div className="bi-cut-page" ref={wrap}
          onPointerDown={(e) => { if (!pic) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); const p = at(e); drag.current = { ...p, moved: false }; }}
          onPointerMove={(e) => { const d0 = drag.current; if (!d0) return; const p = at(e); if (Math.abs(p.x - d0.x) + Math.abs(p.y - d0.y) > 0.01) { d0.moved = true; setBox([Math.min(d0.x, p.x), Math.min(d0.y, p.y), Math.max(d0.x, p.x), Math.max(d0.y, p.y)]); } }}
          onPointerUp={(e) => { const d0 = drag.current; drag.current = null; if (!d0 || d0.moved || !can.current) return; const p = at(e); const b = elementAt(can.current, p.x * can.current.width, p.y * can.current.height); if (b && (b[2] - b[0]) * (b[3] - b[1]) < 0.5) { setBox(b); setErr(""); } else setErr(b ? "That's most of the page: drag a box around just the logo." : "Nothing there: click the logo itself."); }}>
          {pic ? <img src={pic} alt="" draggable={false} /> : <div className="aa-empty">{err || "Drawing the file…"}</div>}
          {box && <span className="bi-box" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
        </div>
        {err && pic && <p className="warnline">{err}</p>}
        {box && <div className="bi-cutform">
          <label className="field"><span>Logo name</span><input type="text" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Embark E" /></label>
          <label className="field"><span>Location (optional)</span><input type="text" list="bi-locs" value={loc} placeholder="None: just the logo" onChange={(e) => { setLoc(e.target.value); if (wFrom.startsWith("usual") && e.target.value) { setWIn(String(usualWidth(e.target.value))); setWFrom(`usual for ${e.target.value.toLowerCase()}`); } }} />
            <datalist id="bi-locs">{LOC_OPTS.map((o) => <option key={o} value={o} />)}{["Left Chest, Left Sleeve", "Front, Back"].map((o) => <option key={o} value={o} />)}</datalist></label>
          <label className="field bi-w"><span>Prints at (width, in)</span><input type="number" min="0.5" max="16" step="0.25" value={wIn} onChange={(e) => { setWIn(e.target.value); setWFrom(""); }} /></label>
          <button type="button" className="btn primary" disabled={!can.current || !nm.trim()} onClick={() => { if (box && can.current) { onCut({ page, box, pic: boxPic(can.current, box), ...(loc.trim() ? { loc: loc.trim() } : {}), ...(+wIn > 0 ? { wIn: +wIn } : {}) }, nm.trim()); setBox(null); setNm(""); setLoc(""); setWIn(""); } }}>Add this logo</button>
          {+wIn > 0 && <span className="faint bi-wnote">{(+wIn).toFixed(2).replace(/\.?0+$/, "")}&quot; × {(+wIn * ratio).toFixed(2).replace(/\.?0+$/, "")}&quot;{wFrom ? ` · ${wFrom}` : ""}</span>}
        </div>}
        {cuts.length > 0 && <div className="bi-cuts"><span className="faint">Picked off this file:</span>{cuts.map((c, i) => <span key={i} className="bi-cutitem"><span className="bi-cutpic dark" title={c.name}><img src={c.pic} alt={c.name} /></span><span><b>{c.name}</b><span className="faint">{[c.loc, c.wIn ? `${c.wIn}" wide` : ""].filter(Boolean).join(" · ")}</span></span></span>)}</div>}
        <div className="dla-acts">
          <button type="button" className="btn ghost" onClick={() => { onWhole(); onClose(); }}>Bring in the whole file</button>
          <span className="spacer" />
          {cuts.length > 0 && !box && <span className="faint">Box another spot to add another location.</span>}
          <button type="button" className={"btn" + (cuts.length && !box ? " primary" : "")} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export default function BringInArtPage() {
  return <Suspense fallback={<div className="aa-empty">Loading…</div>}><BringInArt /></Suspense>;
}

function BringInArt() {
  const sb = useMemo(() => createClient(), []);
  const qs = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cust, setCust] = useState(qs.get("customer") || "");
  const [q, setQ] = useState(qs.get("q") || "");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState(qs.get("brand") || "");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [n, setN] = useState(15);
  const [designs, setDesigns] = useState<D[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({} as Record<string, Pick>);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  /** the jobs ticked open to show their files */
  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());
  const [newBrand, setNewBrand] = useState<string | null>(null);
  /** the file whose logos are being picked off it */
  const [cutting, setCutting] = useState<Item | null>(null);
  /** where the files come from: the client's Printavo jobs, or the Dropbox embroidery / film folders */
  const [source, setSource] = useSticky<"printavo" | "dropbox">("artBuilder.source", "printavo");
  const [dbxPath, setDbxPath] = useState("/FBS Embroidery Folder/Embroidery");
  const [dbxList, setDbxList] = useState<DbxEntry[] | null>(null);
  const [dbxErr, setDbxErr] = useState("");
  /** a Dropbox folder's files, once copied in to be looked at */
  const [dbxFiles, setDbxFiles] = useState<Record<string, Record<string, string> | "loading" | string>>({});
  /** where each Printavo job's embroidery went (read off its mockups) */
  const [usage, setUsage] = useState<Record<string, string[]>>({});

  useEffect(() => { sb.from("customers").select("*").then(({ data }) => setCustomers(((data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))))); }, [sb]);
  const custOpts = useMemo(() => customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" })), [customers]);
  async function loadDesigns(id: string) {
    const { data } = await sb.from("designs").select("*").eq("customer_id", id).eq("draft", false).order("number", { ascending: false });
    setDesigns((data || []) as D[]);
  }
  useEffect(() => {
    setJobs(null); setPicks({}); setN(15); setOpenJobs(new Set()); setDbxPath("/FBS Embroidery Folder/Embroidery");
    if (!cust) { setBrands([]); setDesigns([]); return; }
    sb.from("brands").select("*").eq("customer_id", cust).is("archived_at", null).order("sort").then(({ data }) => { const bs = (data || []) as Brand[]; setBrands(bs); if (!bs.some((b) => b.id === brand)) setBrand(bs.find((b) => q && b.name.toLowerCase().includes(q.toLowerCase().trim()))?.id || ""); });
    void loadDesigns(cust);
  }, [cust]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cust) return;
    const t = setTimeout(async () => {
      let r = sb.from("archived_orders").select("id, visual_id, nickname, order_date, files, search_text").eq("customer_id", cust).gt("files_total", 0).order("order_date", { ascending: false }).limit(300);
      // anything in the job: its name, PO, line items, notes (archived_orders.search_text)
      const w = q.trim().replace(/[%,()*]/g, " ").trim();
      if (w) r = r.or(`nickname.ilike.%${w}%,search_text.ilike.%${w}%`);
      const { data } = await r;
      setJobs((data || []) as Job[]); setN(15);
    }, 300);
    return () => clearTimeout(t);
  }, [cust, q, sb]);

  // what's already been brought in (each logo / sew file keeps the Printavo file it came from)
  const done = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of designs) {
      const src = (d.specs as { source?: { path?: string } } | null)?.source?.path;
      if (src) m.set(src, `D-${d.number}`);
      for (const f of sewFilesOf(d)) { const s = (f as SewFile & { source?: string }).source; if (s) m.set(s, `${tajimaName(d.number, Number((f.code || "E1").slice(1)) || 1)} on D-${d.number}`); }
    }
    return m;
  }, [designs]);

  // Dropbox: the folder's folders and files; the client's own folder when it has one (Cedar Promo)
  useEffect(() => {
    if (source !== "dropbox") return;
    let on = true;
    setDbxList(null); setDbxErr("");
    fetch(`/api/art-builder/dropbox?${new URLSearchParams({ path: dbxPath })}`).then((r) => r.json()).then((j) => { if (!on) return; if (j.error) setDbxErr(j.error); else setDbxList(j.entries || []); }).catch(() => on && setDbxErr("Couldn't reach Dropbox."));
    return () => { on = false; };
  }, [source, dbxPath]);
  useEffect(() => {
    if (source !== "dropbox" || !cust || dbxPath !== "/FBS Embroidery Folder/Embroidery" || !dbxList) return;
    const nm = (custLabel(customers.find((c) => c.id === cust) || ({} as Customer)) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = dbxList.find((e) => e.folder && nm && (nm.startsWith(e.name.toLowerCase().replace(/[^a-z0-9]/g, "")) || e.name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(nm.slice(0, 8))));
    if (hit) setDbxPath(hit.path);
  }, [source, cust, dbxList]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openDbx(path: string) {
    if (dbxFiles[path] && dbxFiles[path] !== "loading" && typeof dbxFiles[path] === "object") return;
    setDbxFiles((x) => ({ ...x, [path]: "loading" }));
    const j = await fetch("/api/art-builder/dropbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }).then((r) => r.json()).catch(() => ({ error: "Couldn't reach Dropbox." }));
    setDbxFiles((x) => ({ ...x, [path]: j.error ? String(j.error) : Object.fromEntries(((j.files || []) as { name: string; path: string }[]).map((f) => [f.path, f.path])) }));
  }
  const dbxJobs: Job[] = useMemo(() => {
    if (source !== "dropbox" || !dbxList) return [];
    const here = dbxList.some((e) => !e.folder) ? [{ id: dbxPath, visual_id: "", nickname: `Files in ${dbxPath.split("/").pop()}`, order_date: "", files: null, dbx: dbxPath }] : [];
    return [...here, ...dbxList.filter((e) => e.folder).map((e) => ({ id: e.path, visual_id: "", nickname: e.name, order_date: "", files: null, dbx: e.path }))]
      .map((j) => { const f = dbxFiles[j.dbx!]; return typeof f === "object" ? { ...j, files: f } : j; });
  }, [source, dbxList, dbxPath, dbxFiles]);

  // a ticked job's PDFs are read: a sewing sheet goes with its DST, or shows as a sewing sheet
  const [facts, setFacts] = useState<Record<string, Facts | null>>({});
  const items = useMemo(() => (source === "dropbox" ? dbxJobs.map((j) => ({ j, list: j.files ? arrange(itemsOf(j), facts) : [] }))
    : (jobs || []).map((j) => ({ j, list: arrange(itemsOf(j), facts) })).filter((x) => x.list.some((i) => i.kind !== "other"))), [source, dbxJobs, jobs, facts]);
  // where a ticked job's embroidery went: its line items and mockups read for locations
  useEffect(() => {
    for (const { j, list } of items) {
      if (!openJobs.has(j.id) || j.dbx || j.id in usage || !list.some((i) => i.kind === "sew")) continue;
      setUsage((x) => ({ ...x, [j.id]: locsIn(j.search_text || "") }));
      Promise.all(list.filter((i) => (i.kind === "art" || i.kind === "sheet") && /^(pdf|ai)$/.test(i.ext)).map((i) => textOf(sb, i.path)))
        .then((ts) => setUsage((x) => ({ ...x, [j.id]: [...new Set([...(x[j.id] || []), ...locsIn(ts.join(" "))])] })));
    }
  }, [items, openJobs, sb]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const { j, list } of items) {
      if (!openJobs.has(j.id) || !list.some((i) => i.kind === "sew")) continue;
      for (const i of list) if ((i.kind === "sew" || (i.kind === "art" && i.ext === "pdf")) && !(i.path in facts)) factsOf(sb, i.path).then((f) => setFacts((x) => (i.path in x ? x : { ...x, [i.path]: f })));
    }
  }, [items, openJobs, sb]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = (Object.entries(picks) as [string, Pick][]).filter(([, p]) => p.on);
  const newLogos = picked.filter(([, p]) => p.as === "logo");
  const set = (key: string, p: Partial<Pick>, it?: Item) => setPicks((x) => ({ ...x, [key]: { on: true, as: it?.kind === "sew" ? "sew" : "logo", name: it ? realName(it.path) || it.job.nickname.replace(/^[^a-z]*embark[^a-z]*/i, "").slice(0, 60) || it.name : "", target: "", ...(it?.kind === "sew" ? { where: (usage[it.job.id] || []).join(", ") } : {}), ...x[key], ...p } }));
  const itemByKey = useMemo(() => new Map(items.flatMap((x) => x.list.map((i) => [i.key, i] as const))), [items]);
  const cutsOf = (key: string) => (Object.entries(picks) as [string, Pick][]).filter(([, v]) => v.on && v.src === key && v.cut);
  const addCut = (it: Item, c: Cut, name: string) => { const k = `${it.key}#${Date.now().toString(36)}`; setPicks((x) => ({ ...x, [k]: { on: true, as: "logo", name, target: "", src: it.key, cut: c } })); };
  const brandName = brands.find((b) => b.id === brand)?.name || "";

  async function makeBrand() {
    const name = (newBrand || "").trim();
    if (!name || !cust) return;
    const { data, error } = await sb.from("brands").insert({ customer_id: cust, name, sort: brands.length + 1 }).select("*").single();
    if (error) return setLog([`Couldn't make the brand: ${error.message}`]);
    setBrands([...brands, data as Brand]); setBrand((data as Brand).id); setNewBrand(null);
  }
  async function file(path: string): Promise<File> {
    const { data, error } = await sb.storage.from("proofs").download(path);
    if (!data) throw new Error(`Couldn't open ${nameOf(path)}: ${error?.message || "not found"}`);
    return new File([data], nameOf(path), { type: data.type && data.type !== "application/octet-stream" ? data.type : typeOf(extOf(path)) });
  }
  async function bringIn() {
    const missing = picked.filter(([, p]) => p.as === "sew" && !p.target);
    if (missing.length) return setLog([`Say which logo each sew file goes with (${missing.length} not set).`]);
    setBusy(true);
    const out: string[] = [];
    const made = new Map<string, D>();
    const { data: u } = await sb.auth.getUser();
    // the logos first, so a sew file can go on one made just now
    for (const [key, p] of newLogos) {
      const it = itemByKey.get(p.src || key); if (!it) continue;
      try {
        let f = await file(it.path);
        if (p.cut) { const c = await cutToFile(await f.arrayBuffer(), it.ext, p.cut, p.name || it.name); if (!c) throw new Error("couldn't cut that logo off the page"); f = c; }
        const d = (await uploadDesign(sb, { file: f, customer_id: cust, name: p.name.trim() || it.name, by: u.user?.email || "", notes: [it.job.dbx ? `From Dropbox: ${it.job.dbx}` : `Pulled from order #${it.job.visual_id} (${it.job.nickname})`, p.cut?.loc ? `Location: ${p.cut.loc}` : "", p.cut?.wIn ? `Prints ${p.cut.wIn}" wide` : ""].filter(Boolean).join(" · ") })) as D;
        // a white / very light logo shows on a dark background (Oct 28, Nick: "if it's a white logo, you'll put it on a
        // background so you can see it"): its first background is charcoal, in its own colors
        const light = f.type === "image/svg+xml" && await (async () => { const t = await f.text(); const fills = [...t.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((m) => m[1]); return fills.length > 0 && fills.every((h) => { const v = parseInt(h.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 205; }); })();
        const specs = { ...((d.specs || {}) as object), ...(light ? { onShirts: [{ shirt: "Charcoal", ink: "Original colors" }] } : {}), source: { ...(it.job.dbx ? { dropbox: it.job.dbx } : { printavo: it.job.visual_id }), path: it.path, ...(p.cut ? { page: p.cut.page, box: p.cut.box, ...(p.cut.loc ? { where: p.cut.loc } : {}) } : {}) },
          ...(p.cut?.wIn ? { printSize: { wIn: p.cut.wIn, ...(d.width_px && d.height_px ? { hIn: Math.round((p.cut.wIn * d.height_px / d.width_px) * 100) / 100 } : {}), ...(p.cut.loc ? { location: p.cut.loc } : {}) } } : {}) };
        await sb.from("designs").update({ specs, ...(brand ? { brand_id: brand } : {}) }).eq("id", d.id);
        made.set(key, { ...d, specs, brand_id: brand || null } as D);
        out.push(`D-${d.number} ${p.name || it.name}${p.cut?.loc ? ` (${p.cut.loc})` : ""}${brand ? ` · ${brands.find((b) => b.id === brand)?.name}` : ""}${f.type === "image/svg+xml" ? " · vector" : ""}`);
      } catch (e) { out.push(`${it.name}: ${e instanceof Error ? e.message : "couldn't bring it in"}`); }
    }
    for (const [key, p] of picked.filter(([, x]) => x.as === "sew")) {
      const it = itemByKey.get(key); if (!it) continue;
      try {
        const id = made.get(p.target)?.id || p.target;
        const { data: row } = await sb.from("designs").select("id, number, specs").eq("id", id).maybeSingle();
        if (!row) throw new Error("that logo isn't there");
        const sp = (row.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
        const code = nextSewCode(em.files || []), name = tajimaName(row.number as number, Number(code.slice(1)));
        const files = await Promise.all([it.path, it.emb, it.sheet].filter(Boolean).map((x) => file(x!)));
        const named = await Promise.all(files.map((f) => tajimaFile(f, name)));
        const { takeDigitized } = await import("@/lib/digitizedFiles");
        const { set: s } = await takeDigitized(sb, id, named);
        const sew = { ...s, code, kind: /hat|cap/i.test(p.where || "") ? "cap" : "flat", source: it.path, ...(p.where?.trim() ? { placement: p.where.trim() } : {}),
          lastUsed: it.job.dbx ? { dropbox: it.job.dbx } : { job: it.job.visual_id, date: it.job.order_date, name: it.job.nickname, where: p.where?.trim() || "" } } as SewFile & { source: string };
        const specs = { ...sp, embroidery: { ...em, files: [...(em.files || []), sew] } };
        const { error } = await sb.from("designs").update({ specs }).eq("id", id);
        if (error) throw new Error(error.message);
        out.push(`${name} on D-${row.number}: ${s.wIn}" × ${s.hIn}", ${s.stitches.toLocaleString()} stitches${s.emb ? ", with its EMB" : ""}${s.sheet ? " and sewing sheet" : ""}${p.where?.trim() ? ` · ${p.where.trim()}` : ""}${it.job.visual_id ? ` · last used on #${it.job.visual_id}` : ""}`);
      } catch (e) { out.push(`${it.name}: ${e instanceof Error ? e.message : "couldn't file the sew file"}`); }
    }
    setLog(out); setPicks({}); setBusy(false);
    void loadDesigns(cust);
  }

  const targets = [...newLogos.map(([k, p]) => ({ id: k, label: `New: ${p.name || itemByKey.get(p.src || k)?.name || "logo"}` })), ...designs.map((d) => ({ id: d.id, label: `D-${d.number} ${d.name || ""}`.trim() }))];

  return (
    <>
      <div className="page-head">
        <div><h1>Customer artwork builder</h1><div className="eyebrow">A client&apos;s Printavo jobs or Dropbox folders. Tick one, say what each file is, bring it in.</div></div>
        <div className="row"><Link className="btn" href="/shop/artwork">Artwork</Link><button type="button" className="btn primary" disabled={!picked.length || busy} onClick={() => void bringIn()}>{busy ? "Bringing in…" : `Bring in ${picked.length || ""}`.trim()}</button></div>
      </div>
      <div className="toolbar bi-tools">
        <div className="chips" role="group" aria-label="Where from">
          <button type="button" className={"chip" + (source === "printavo" ? " on" : "")} onClick={() => setSource("printavo")}>Printavo jobs</button>
          <button type="button" className={"chip" + (source === "dropbox" ? " on" : "")} onClick={() => setSource("dropbox")}>Dropbox</button>
        </div>
        <CustomerPick compact value={cust || null} options={custOpts} placeholder="Client: type one" ariaLabel="Client" onPick={(v) => setCust(v || "")} />
        {source === "printavo" && <label className="aa-search"><SearchInput placeholder="Anything in a job (embark, a PO, a garment)" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
        {cust && (newBrand === null
          ? <label className="bi-brand"><span className="faint">Logos go under</span><select value={brand} onChange={(e) => (e.target.value === "+" ? setNewBrand("") : setBrand(e.target.value))}><option value="">No brand (the client itself)</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="+">+ New brand…</option></select></label>
          : <span className="bi-brand"><input type="text" autoFocus placeholder="Brand name (Embark)" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void makeBrand(); if (e.key === "Escape") setNewBrand(null); }} /><button type="button" className="btn sm" disabled={!newBrand.trim()} onClick={() => void makeBrand()}>Make brand</button><button type="button" className="btn sm ghost" onClick={() => setNewBrand(null)}>Cancel</button></span>)}
      </div>
      {log.length > 0 && <div className="panel bi-log"><div className="panel-b">{log.map((l, i) => <div key={i}>{l}</div>)}</div></div>}
      {source === "dropbox" && <div className="bi-crumbs">{["", ...dbxPath.split("/").filter(Boolean)].map((seg, i, a) => { const to = "/" + a.slice(1, i + 1).join("/"); return <span key={i}>{i > 0 && <span className="faint"> / </span>}<button type="button" className="linkbtn" disabled={i === a.length - 1} onClick={() => setDbxPath(i === 0 ? "" : to)}>{i === 0 ? "Dropbox" : seg}</button></span>; })}</div>}
      {!cust ? <div className="aa-empty">Pick a client: their logos are made under them.</div>
        : source === "dropbox" ? (dbxErr ? <div className="aa-empty">{dbxErr}</div> : !dbxList ? <div className="aa-empty">Opening the folder…</div> : !items.length ? <div className="aa-empty">Nothing in this folder.</div> : null)
        : !jobs ? <div className="aa-empty">Loading their jobs…</div> : !items.length ? <div className="aa-empty">No jobs with files{q ? ` with "${q}"` : ""}.</div> : null}
      {cust && items.length > 0 && (source === "printavo" ? !!jobs : !!dbxList) && (
        <>
          <p className="faint" style={{ margin: "4px 0 10px" }}>{source === "dropbox" ? "Tick a folder to see its files; its name opens it." : `${items.length} job${items.length === 1 ? "" : "s"} with files, newest first.`}</p>
          {items.slice(0, n).map(({ j, list }) => (
            <section key={j.id} className="panel bi-job">
              <label className="panel-h bi-jh"><input type="checkbox" checked={openJobs.has(j.id)} onChange={() => { if (j.dbx && !openJobs.has(j.id)) void openDbx(j.dbx); setOpenJobs((x) => { const m = new Set(x); if (m.has(j.id)) m.delete(j.id); else m.add(j.id); return m; }); }} />
                {j.dbx ? <span className="bi-jt">{j.dbx !== dbxPath ? <button type="button" className="linkbtn bi-folder" onClick={(e) => { e.preventDefault(); setDbxPath(j.dbx!); }}>{j.nickname}</button> : j.nickname}</span>
                  : <span className="bi-jt"><span className="ordno">#{j.visual_id}</span> {j.nickname}</span>}
                <span className="faint">{j.dbx ? (dbxFiles[j.dbx] === "loading" ? "Copying its files in…" : typeof dbxFiles[j.dbx] === "string" ? String(dbxFiles[j.dbx]) : j.files ? `${list.length} file${list.length === 1 ? "" : "s"}` : "Folder") : `${fmtDay(j.order_date)} · ${list.length} file${list.length === 1 ? "" : "s"}`}{list.some((i) => done.has(i.path)) ? " · some brought in" : ""}</span>
                {(() => { const k = new Set(list.map((i) => i.key)); const c = picked.filter(([key, v]) => k.has(v.src || key)).length; return c > 0 ? <span className="bi-cnt">{c} picked</span> : null; })()}</label>
              {openJobs.has(j.id) && <div className="panel-b bi-files">
                {list.map((it) => {
                  const p = picks[it.key], had = done.get(it.path);
                  if (it.kind === "sheet") return <a key={it.key} className="bi-f other" href={`/api/files/open?${new URLSearchParams({ p: it.path })}`} target="_blank" rel="noreferrer"><Pic sb={sb} path={it.path} /><span className="bi-n">{it.name}</span><span className="faint">Sewing sheet{facts[it.path] ? `: ${factLine(facts[it.path]!)}` : ""}. Its DST isn&apos;t on this job.</span></a>;
                  if (it.kind === "other") return <a key={it.key} className="bi-f other" href={`/api/files/open?${new URLSearchParams({ p: it.path })}`} target="_blank" rel="noreferrer"><span className="bi-pic"><span className="bi-ext">{it.ext.toUpperCase() || "FILE"}</span></span><span className="bi-n">{it.name}</span></a>;
                  return (
                    <div key={it.key} className={"bi-f" + (p?.on ? " on" : "") + (had ? " had" : "")}>
                      <label className="bi-top">
                        {it.kind === "sew" ? <span className="bi-pic"><span className="bi-ext">DST</span>{it.emb && <span className="bi-ext sm">EMB</span>}{it.sheet && <span className="bi-ext sm">PDF</span>}</span> : PREVIEW.test(it.ext) ? <Pic sb={sb} path={it.path} /> : <span className="bi-pic"><span className="bi-ext">{it.ext.toUpperCase()}</span></span>}
                        <span className="bi-n"><input type="checkbox" checked={!!p?.on || cutsOf(it.key).length > 0} onChange={(e) => (e.target.checked ? (it.kind === "art" && PREVIEW.test(it.ext) && it.ext !== "svg" ? setCutting(it) : set(it.key, { on: true }, it)) : setPicks((x) => Object.fromEntries((Object.entries(x) as [string, Pick][]).map(([k, v]) => [k, k === it.key || v.src === it.key ? { ...v, on: false } : v]))))} /> {it.name}</span>
                      </label>
                      {it.kind === "sew" && <DstInfo sb={sb} path={it.path} />}
                      {it.kind === "sew" && (it.job.dbx ? <span className="faint">From Dropbox: {it.job.dbx.split("/").slice(-2).join(" / ")}</span>
                        : <span className="bi-used">Last used on #{it.job.visual_id} · {fmtDay(it.job.order_date)}{usage[it.job.id]?.length ? ` · ${usage[it.job.id].join(", ")}` : ""}</span>)}
                      {it.kind === "sew" && (it.emb || it.sheet) && <span className="faint">with {[it.emb && nameOf(it.emb), it.sheet && nameOf(it.sheet)].filter(Boolean).join(" and ")}</span>}
                      {had && !p?.on && <span className="bi-had">Brought in: {had}</span>}
                      {it.kind === "art" && PREVIEW.test(it.ext) && it.ext !== "svg" && <button type="button" className="linkbtn bi-pickoff" onClick={() => setCutting(it)}>{cutsOf(it.key).length ? "Pick another logo off it" : "Pick the logo off it"}</button>}
                      {cutsOf(it.key).map(([k, c]) => (
                        <span key={k} className="bi-cutrow"><span className="bi-cutpic dark" title={c.cut!.loc || ""}><img src={c.cut!.pic} alt="" /></span><input type="text" aria-label="Logo name" placeholder="Logo name" value={c.name} onChange={(e) => set(k, { name: e.target.value })} /><button type="button" className="linkbtn" aria-label="Take this logo off" onClick={() => setPicks((x) => { const m = { ...x }; delete m[k]; return m; })}>×</button></span>
                      ))}
                      {p?.on && (it.kind === "sew" ? (
                        <select aria-label="Sew file for" value={p.target} onChange={(e) => set(it.key, { target: e.target.value })}>
                          <option value="">Sew file for which logo?</option>
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      ) : null)}
                      {p?.on && it.kind === "sew" && <input type="text" aria-label="Where it goes" placeholder="Where it goes (Left Chest, Nape…)" value={p.where || ""} onChange={(e) => set(it.key, { where: e.target.value })} />}
                      {p?.on && (it.kind === "sew" ? null : (
                        <input type="text" aria-label="Logo name" placeholder="Logo name" value={p.name} onChange={(e) => set(it.key, { name: e.target.value })} />
                      ))}
                    </div>
                  );
                })}
              </div>}
            </section>
          ))}
          {items.length > n && <button type="button" className="btn" style={{ display: "block", margin: "8px auto" }} onClick={() => setN(n + 15)}>Show more jobs ({items.length - n} more)</button>}
        </>
      )}
      {cutting && <CutPop sb={sb} it={cutting} defName={brandName ? `${brandName} logo` : ""} cuts={cutsOf(cutting.key).map(([, v]) => ({ name: v.name, pic: v.cut!.pic, loc: v.cut!.loc, wIn: v.cut!.wIn }))} onWhole={() => set(cutting.key, { on: true }, cutting)} onCut={(c, nm) => addCut(cutting, c, nm)} onClose={() => setCutting(null)} />}
    </>
  );
}
