/**
 * Films as a PDF: one page per plate, the plate at its real print size, registration marks at the four sides, and a
 * label (job, location, plate, ink, mesh, print order). Written by hand (no library): 1-bit images, Flate-compressed,
 * Helvetica for the text. Print it to the film printer at 100% (no "fit to page").
 */
export type FilmPage = { W: number; H: number; bits: Uint8Array; widthIn: number; heightIn: number; label: string; sub: string;
  /** the ink this film prints ("PMS 623 C", "Super Gold"), printed big right next to the top registration mark */
  ink?: string };

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
