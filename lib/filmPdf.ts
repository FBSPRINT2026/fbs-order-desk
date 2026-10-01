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
export async function filmRollPdf(pages: FilmPage[], rollIn: number, title: string, z: (u8: Uint8Array) => Promise<Uint8Array> = deflate): Promise<Uint8Array> {
  const N = pages.length, m = 36, aw = pages[0].widthIn * 72, ah = pages[0].heightIn * 72, iw = aw + 2 * m, ih = ah + 2 * m;
  const L = rollLayout(N, aw, ah, rollIn, m);
  const bw = L.rotate ? ih : iw, bh = L.rotate ? iw : ih, PW = L.widthIn * 72, PH = L.lengthIn * 72;
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
    const c = i % L.cols, r = Math.floor(i / L.cols), x = c * (bw + 18), y = PH - 22 - (r + 1) * bh - r * 18;
    const tx = m + aw / 2, ty = m + ah + m / 2, ink = `${pages[i].ink || pages[i].label}  ${job}`, tw = ink.length * 11 * 0.6;
    let lx = tx + 20; if (lx + tw > iw - 4) lx = Math.max(4, tx - 20 - tw);
    content += (L.rotate ? `q 0 1 -1 0 ${(x + ih).toFixed(2)} ${y.toFixed(2)} cm\n` : `q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm\n`) +
      `q ${aw.toFixed(2)} 0 0 ${ah.toFixed(2)} ${m} ${m} cm /Im${i} Do Q\n` +
      `0 G 0 g 0.5 w\n` + target(tx, ty) + target(tx, m / 2) + target(m / 2, m + ah / 2) + target(m + aw + m / 2, m + ah / 2) +
      crop(m, m, -1, -1) + crop(m + aw, m, 1, -1) + crop(m, m + ah, -1, 1) + crop(m + aw, m + ah, 1, 1) +
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
