/**
 * Films as a PDF: one page per plate, the plate at its real print size, registration marks at the four sides, and a
 * label (job, location, plate, ink, mesh, print order). Written by hand (no library): 1-bit images, Flate-compressed,
 * Helvetica for the text. Print it to the film printer at 100% (no "fit to page").
 */
export type FilmPage = { W: number; H: number; bits: Uint8Array; widthIn: number; heightIn: number; label: string; sub: string;
  /** the ink this film prints ("PMS 623 C", "Super Gold"), printed big right next to the top registration mark */
  ink?: string };

import { rollLayout } from "./ripPdf";

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");

/** deflate (zlib format, what PDF's FlateDecode expects) with the browser's CompressionStream */
export async function deflate(u8: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const buf = await new Response(new Blob([u8 as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function filmPdf(pages: FilmPage[], z: (u8: Uint8Array) => Promise<Uint8Array> = deflate): Promise<Uint8Array> {
  const M = 72; // 1" margin around the art for marks and the label
  const parts: (Uint8Array | string)[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, then 3 objects per page (page, content, image)
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(" ");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i], n = 4 + i * 3;
    const aw = p.widthIn * 72, ah = p.heightIn * 72, pw = aw + 2 * M, ph = ah + 2 * M + 24;
    const reg = (x: number, y: number) => `q 0.6 w ${x - 14} ${y} m ${x + 14} ${y} l S ${x} ${y - 14} m ${x} ${y + 14} l S ${x + 8} ${y} m ${x + 8} ${y + 4.4} ${x + 4.4} ${y + 8} ${x} ${y + 8} c ${x - 4.4} ${y + 8} ${x - 8} ${y + 4.4} ${x - 8} ${y} c ${x - 8} ${y - 4.4} ${x - 4.4} ${y - 8} ${x} ${y - 8} c ${x + 4.4} ${y - 8} ${x + 8} ${y - 4.4} ${x + 8} ${y} c S Q\n`;
    const cx = M + aw / 2, cy = M + ah / 2;
    const content =
      `q ${aw.toFixed(2)} 0 0 ${ah.toFixed(2)} ${M} ${M} cm /Im0 Do Q\n` +
      reg(cx, M - 36) + reg(cx, M + ah + 36) + reg(M - 36, cy) + reg(M + aw + 36, cy) +
      `BT /F1 11 Tf ${M} ${ph - 30} Td (${esc(p.label)}) Tj ET\n` +
      `BT /F1 8 Tf ${M} ${ph - 44} Td (${esc(p.sub)}) Tj ET\n` +
      // the ink, right of the top registration mark (bold: filled and outlined)
      (p.ink ? `BT 2 Tr 0.35 w /F1 13 Tf ${(cx + 20).toFixed(2)} ${(M + ah + 31.5).toFixed(2)} Td (${esc(p.ink)}) Tj ET\n` : "");
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`]);
    const cbytes = enc.encode(content);
    obj(n + 1, [`<< /Length ${cbytes.length} >>\nstream\n`, cbytes, "\nendstream"]);
    // 1-bit image, 1 = black: Decode [1 0] turns the set bits into ink
    const img = await z(p.bits);
    obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.W} /Height ${p.H} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, img, "\nendstream"]);
  }
  const xref = pos, count = 4 + pages.length * 3;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const b of parts as Uint8Array[]) { out.set(b, o); o += b.length; }
  return out;
}

/**
 * Every film on one sheet for a roll film printer: the same black films (our dots, nothing left for the RIP to
 * separate or screen), each with its marks and ink name, turned a quarter turn when that uses less film, side by side
 * across the roll (see `rollLayout`). Print it as one composite black job at 100%.
 */
/** which marks go around each film (the shop can turn them off) */
export type FilmMarks = { crop?: boolean; targets?: boolean };
export async function filmRollPdf(pages: FilmPage[], rollIn: number, title: string, z: (u8: Uint8Array) => Promise<Uint8Array> = deflate, marks: FilmMarks = {}): Promise<Uint8Array> {
  const N = pages.length, m = 36, aw = pages[0].widthIn * 72, ah = pages[0].heightIn * 72, iw = aw + 2 * m, ih = ah + 2 * m;
  const L = rollLayout(N, aw, ah, rollIn, m);
  const PW = L.widthIn * 72, PH = L.lengthIn * 72;
  const parts: Uint8Array[] = [], offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, 4 page, 5 content, then one image per film
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [4 0 R] /Count 1 >>"]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
  const target = (x: number, y: number) => { const r = 7, k = r * 0.5523; return `${x - 14} ${y} m ${x + 14} ${y} l S ${x} ${y - 14} m ${x} ${y + 14} l S ${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S\n`; };
  const crop = (x: number, y: number, dx: number, dy: number) => `${x + dx * 6} ${y} m ${x + dx * 30} ${y} l S ${x} ${y + dy * 6} m ${x} ${y + dy * 30} l S\n`;
  const job = title.split(" ")[0];
  let content = `q 0 g BT /F1 8 Tf 2 ${(PH - 12).toFixed(2)} Td (${esc(`${title} - ${N} film${N === 1 ? "" : "s"} - print at 100%, no fit to page - art ${pages[0].widthIn}" wide`)}) Tj ET Q\n`;
  for (let i = 0; i < N; i++) {
    const p = L.place[i], x = p.x, y = PH - 22 - p.y - (p.rot ? iw : ih);
    const tx = m + aw / 2, ty = m + ah + m / 2, ink = `${pages[i].ink || pages[i].label}  ${job}`, tw = ink.length * 11 * 0.6;
    let lx = tx + 20; if (lx + tw > iw - 4) lx = Math.max(4, tx - 20 - tw);
    content += (p.rot ? `q 0 1 -1 0 ${(x + ih).toFixed(2)} ${y.toFixed(2)} cm\n` : `q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm\n`) +
      `q ${aw.toFixed(2)} 0 0 ${ah.toFixed(2)} ${m} ${m} cm /Im${i} Do Q\n` +
      `0 G 0 g 0.5 w\n` + (marks.targets === false ? "" : target(tx, ty) + target(tx, m / 2) + target(m / 2, m + ah / 2) + target(m + aw + m / 2, m + ah / 2)) +
      (marks.crop === false ? "" : crop(m, m, -1, -1) + crop(m + aw, m, 1, -1) + crop(m, m + ah, -1, 1) + crop(m + aw, m + ah, 1, 1)) +
      `BT /F1 11 Tf ${lx.toFixed(2)} ${(ty - 11 / 3).toFixed(2)} Td (${esc(ink)}) Tj ET\nQ\n`;
  }
  const cz = await z(enc.encode(content));
  obj(4, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> /XObject << ${pages.map((_, i) => `/Im${i} ${6 + i} 0 R`).join(" ")} >> >> /Contents 5 0 R >>`]);
  obj(5, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
  for (let i = 0; i < N; i++) {
    const p = pages[i], img = await z(p.bits);
    obj(6 + i, [`<< /Type /XObject /Subtype /Image /Width ${p.W} /Height ${p.H} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, img, "\nendstream"]);
  }
  const xref = pos, count = 6 + N;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(title)}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/**
 * One film per file, the way the shop's FilmMaker queue trims (Layout Manager: Auto Page, white space removed, so the
 * Epson cuts after every job). The page is just the film: the art at real size, upright unless it's too wide for the
 * roll, with a registration target centered above and below it (¾" clear of the art, 1.5× the old size) and one line
 * right of the top target: the ink, the job # and the location ("PMS 2745 C  #1467 Full Front"). Nothing else on the
 * film: no job line, no corner crop marks, nothing at the sides (Nicholas, Oct 7 2026).
 */
export const FILM_GAP = 54;           // pt: ¾" from the art's edge to where a target starts
export const FILM_TARGET = 21;        // pt: target arm (crosshair half-length); the circle is half of it
export const FILM_SIDE = 18;          // pt: ¼" at the sides (no marks there)
const ROLL_EDGE_IN = 0.4;             // in: the printer's own margins
/** the page one film needs: upright if it fits across the roll, else a quarter turn */
export function filmBox(artW: number, artH: number, rollIn: number) {
  const mt = FILM_GAP + 2 * FILM_TARGET + 6, bw = artW + 2 * FILM_SIDE, bh = artH + 2 * mt, P = (rollIn - ROLL_EDGE_IN) * 72;
  const rot = bw > P, w = rot ? bh : bw, h = rot ? bw : bh;
  return { rot, mt, w, h, fits: w <= P, widthIn: w / 72, lengthIn: h / 72 };
}
/** one film's marks, label and art, in its own frame (art at FILM_SIDE, mt), drawing image /Im{i} */
function filmDraw(p: FilmPage, tag: string, marks: FilmMarks, i: number, mt: number) {
  const aw = p.widthIn * 72, ah = p.heightIn * 72, ms = FILM_SIDE, bw = aw + 2 * ms;
  const r = FILM_TARGET / 2, k = r * 0.5523, a = FILM_TARGET;
  const target = (x: number, y: number) => `${x - a} ${y} m ${x + a} ${y} l S ${x} ${y - a} m ${x} ${y + a} l S ${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S\n`;
  // targets centered, their near edge ¾" from the art
  const tx = ms + aw / 2, tTop = mt + ah + FILM_GAP + a, tBot = mt - FILM_GAP - a;
  // the label beside the top target: one line on the right when it fits ("PMS 2745 C  #1467 Full Front"); on a narrow
  // film (a sleeve) the ink goes on the left and the job # + location on the right, smaller only if it still won't fit
  const name = p.ink || p.label, one = `${name}  ${tag}`, side = bw / 2 - a - 12, wid = (t: string, f: number) => t.length * f * 0.6;
  const txt = (t: string, x: number, f: number) => `BT /F1 ${f.toFixed(2)} Tf ${x.toFixed(2)} ${(tTop - f / 3).toFixed(2)} Td (${esc(t)}) Tj ET\n`;
  let label: string;
  if (wid(one, 11) <= side) label = txt(one, tx + a + 8, 11);
  else {
    const f = Math.max(6, Math.min(11, side / (Math.max(name.length, tag.length) * 0.6)));
    label = txt(name, tx - a - 8 - wid(name, f), f) + txt(tag, tx + a + 8, f);
  }
  return `q ${aw.toFixed(2)} 0 0 ${ah.toFixed(2)} ${ms} ${mt} cm /Im${i} Do Q\n0 G 0 g 0.75 w\n` +
    (marks.targets === false ? "" : target(tx, tTop) + target(tx, tBot)) + label;
}
/** a PDF of pages, each its size, content and 1-bit images (/Im0…/ImN on that page) */
type Sheet = { W: number; H: number; content: string; imgs: FilmPage[] };
async function sheetsPdf(sheets: Sheet[], title: string, z: (u8: Uint8Array) => Promise<Uint8Array>) {
  const parts: Uint8Array[] = [], offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, then per sheet: page, content, its images
  const first: number[] = []; let next = 4;
  for (const sh of sheets) { first.push(next); next += 2 + sh.imgs.length; }
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${first.map((n) => `${n} 0 R`).join(" ")}] /Count ${sheets.length} >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
  for (let s2 = 0; s2 < sheets.length; s2++) {
    const sh = sheets[s2], n = first[s2], cz = await z(enc.encode(sh.content));
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sh.W.toFixed(2)} ${sh.H.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> /XObject << ${sh.imgs.map((_, i) => `/Im${i} ${n + 2 + i} 0 R`).join(" ")} >> >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
    for (let i = 0; i < sh.imgs.length; i++) {
      const p = sh.imgs[i], img = await z(p.bits);
      obj(n + 2 + i, [`<< /Type /XObject /Subtype /Image /Width ${p.W} /Height ${p.H} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, img, "\nendstream"]);
    }
  }
  const xref = pos, count = next;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(title)}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}
const sheetPdf = (W: number, H: number, content: string, imgs: FilmPage[], title: string, z: (u8: Uint8Array) => Promise<Uint8Array>) => sheetsPdf([{ W, H, content, imgs }], title, z);
/** one film as a page: just the film, upright unless too wide for the roll */
function filmSheet(p: FilmPage, rollIn: number, tag: string, marks: FilmMarks): Sheet {
  const B = filmBox(p.widthIn * 72, p.heightIn * 72, rollIn);
  const place = B.rot ? `q 0 1 -1 0 ${(B.w).toFixed(2)} 0 cm\n` : `q 1 0 0 1 0 0 cm\n`;
  return { W: B.w, H: B.h, content: place + filmDraw(p, tag, marks, 0, B.mt) + "Q\n", imgs: [p] };
}
/** every film in one PDF, a page each in print order, the same films Print films sends (the Films PDF download) */
export async function filmPagesPdf(pages: FilmPage[], rollIn: number, tag: string, z: (u8: Uint8Array) => Promise<Uint8Array> = deflate, marks: FilmMarks = {}): Promise<Uint8Array> {
  return sheetsPdf(pages.map((p) => filmSheet(p, rollIn, tag, marks)), `${tag} - ${pages.length} films`, z);
}
export async function filmSinglePdf(p: FilmPage, rollIn: number, tag: string, z: (u8: Uint8Array) => Promise<Uint8Array> = deflate, marks: FilmMarks = {}): Promise<Uint8Array> {
  return sheetsPdf([filmSheet(p, rollIn, tag, marks)], `${p.ink || p.label} ${tag}`, z);
}

/**
 * "Nest instead of trim" (an override on Print films): every film of the job on one sheet, side by side across the roll
 * with a ¼" gap to cut by hand, for small prints (a sleeve, a nape) that would waste film trimmed one by one. Each
 * film keeps its own marks and label; all upright, or all turned only when that saves at least 15% of the film.
 */
export const NEST_GAP = 18; // pt: ¼" between films
export function nestLayout(n: number, artW: number, artH: number, rollIn: number) {
  const one = filmBox(artW, artH, 1000), P = (rollIn - ROLL_EDGE_IN) * 72, G = NEST_GAP;
  const bw = artW + 2 * FILM_SIDE, bh = artH + 2 * one.mt;
  let best: { rot: boolean; cols: number; rows: number; w: number; h: number; fw: number; fh: number } | null = null;
  for (const rot of [false, true]) {
    const fw = rot ? bh : bw, fh = rot ? bw : bh;
    if (fw > P) continue;
    const cols = Math.max(1, Math.min(n, Math.floor((P + G) / (fw + G)))), rows = Math.ceil(n / cols);
    const w = cols * fw + (cols - 1) * G, h = rows * fh + (rows - 1) * G;
    // upright unless turned is the only way, or saves at least 15% of the film (labels and targets stay readable)
    if (!best || h < best.h * 0.85) best = { rot, cols, rows, w, h, fw, fh };
  }
  if (!best) return { fits: false, rot: false, cols: 1, rows: n, w: bw, h: n * bh, fw: bw, fh: bh, mt: one.mt, widthIn: bw / 72, lengthIn: (n * bh) / 72, place: [] as { x: number; y: number }[] };
  // place from the top: row by row, left to right (PDF y runs up, so the first row is at the top)
  const place = Array.from({ length: n }, (_, i) => { const c = i % best!.cols, r = Math.floor(i / best!.cols); return { x: c * (best!.fw + G), y: best!.h - (r + 1) * best!.fh - r * G }; });
  return { fits: true, ...best, mt: one.mt, widthIn: best.w / 72, lengthIn: best.h / 72, place };
}
export async function filmNestPdf(pages: FilmPage[], rollIn: number, tag: string, z: (u8: Uint8Array) => Promise<Uint8Array> = deflate, marks: FilmMarks = {}): Promise<Uint8Array> {
  const L = nestLayout(pages.length, pages[0].widthIn * 72, pages[0].heightIn * 72, rollIn);
  let content = "";
  pages.forEach((p, i) => {
    const at = L.place[i];
    content += (L.rot ? `q 0 1 -1 0 ${(at.x + L.fw).toFixed(2)} ${at.y.toFixed(2)} cm\n` : `q 1 0 0 1 ${at.x.toFixed(2)} ${at.y.toFixed(2)} cm\n`) + filmDraw(p, tag, marks, i, L.mt) + "Q\n";
  });
  return sheetPdf(L.w, L.h, content, pages, `${tag} - ${pages.length} films nested`, z);
}
