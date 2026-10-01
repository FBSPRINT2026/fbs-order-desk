/**
 * Separations for a RIP such as FilmMaker (CADlink): one page per screen, made the way RIPs most reliably read them.
 *   - Each page is one plate, as an image in its own named spot color (a /Separation colorspace called
 *     "1 - Underbase White", "2 - PMS 102 C"…), so the RIP sees one ink per page and applies that ink's halftone
 *     settings (frequency, angle, dot shape) and its calibration curves. No multi-ink images, no blend modes.
 *   - Solid plates are 0 / 100%; halftone plates are gray in tones the mesh holds, with solid edges cut sharp
 *     (`ripPlate`), and the RIP makes the dots.
 *   - Every page is the art at its real print size with a 1" margin: registration targets on the four sides and crop
 *     marks at the corners (in /All, the registration color), the ink's name right of the top target, and the job
 *     line at the top left. The same marks in the same place on every page, so the films line up.
 */
import { ripPlate, plateLabel } from "./illustratorPdf";
import type { Plate } from "./separate";

const enc = new TextEncoder();
const pdfName = (s: string) => "/" + s.replace(/[^A-Za-z0-9_.-]/g, (c) => "#" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase());
const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");

export type RipOpts = { widthIn: number; title: string; tonal: boolean; minDot?: number[]; sub?: (p: Plate, i: number) => string };

export async function ripPdf(plates: Plate[], w: number, h: number, o: RipOpts, z: (u8: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const W = o.widthIn * 72, H = W * (h / w), M = 72, PW = W + 2 * M, PH = H + 2 * M, N = plates.length;
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, 4 /All, 5 the spot's look (ink → black gray); then 4 objects a page: page, content, image, colorspace
  const pageObj = (i: number) => 6 + i * 4;
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${plates.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${N} >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
  obj(4, ["[/Separation /All /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]"]);
  const target = (x: number, y: number) => { const r = 7, k = r * 0.5523; return `${x - 14} ${y} m ${x + 14} ${y} l S ${x} ${y - 14} m ${x} ${y + 14} l S ${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S\n`; };
  const crop = (x: number, y: number, dx: number, dy: number) => `${x + dx * 6} ${y} m ${x + dx * 30} ${y} l S ${x} ${y + dy * 6} m ${x} ${y + dy * 30} l S\n`;
  for (let i = 0; i < N; i++) {
    const p = plates[i], n = pageObj(i), label = plateLabel(p, i);
    const tx = M + W / 2, ty = M + H + M / 2;
    const ink = `${p.name}  (${i + 1}/${N})`, size = 13, tw = ink.length * size * 0.6;
    let lx = tx + 20; if (lx + tw > PW - 6) lx = Math.max(6, tx - 20 - tw);
    const content =
      `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} ${M} ${M} cm /Im0 Do Q\n` +
      `q /CSA CS 1 SCN /CSA cs 1 scn 0.5 w\n` + target(tx, ty) + target(tx, M / 2) + target(M / 2, M + H / 2) + target(M + W + M / 2, M + H / 2) +
      crop(M, M, -1, -1) + crop(M + W, M, 1, -1) + crop(M, M + H, -1, 1) + crop(M + W, M + H, 1, 1) +
      `BT /F1 ${size} Tf ${lx.toFixed(2)} ${(ty - 4.5).toFixed(2)} Td (${esc(ink)}) Tj ET\n` +
      `BT /F1 8 Tf 18 ${(PH - 18).toFixed(2)} Td (${esc(`${o.title} - ${label}${o.sub ? " - " + o.sub(p, i) : ""}`)}) Tj ET\nQ\n`;
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /TrimBox [${M} ${M} ${(M + W).toFixed(2)} ${(M + H).toFixed(2)}] /Resources << /Font << /F1 3 0 R >> /ColorSpace << /CSA 4 0 R >> /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`]);
    const cz = await z(enc.encode(content));
    obj(n + 1, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
    const g = ripPlate(p.alpha, w, h, !(o.tonal || p.tonal), o.minDot?.[i] || 0);
    const iz = await z(g);
    obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${n + 3} 0 R /BitsPerComponent 8 /Filter /FlateDecode /Length ${iz.length} >>\nstream\n`, iz, "\nendstream"]);
    // the plate's own spot color: 100% shows black on screen
    obj(n + 3, [`[/Separation ${pdfName(label)} /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]`]);
  }
  obj(5, ["<< >>"]);
  const count = pageObj(N), xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += offsets[i] != null ? `${String(offsets[i]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(o.title)}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0; for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}
