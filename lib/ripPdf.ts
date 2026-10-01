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

export type RipOpts = { widthIn: number; title: string; tonal: boolean; minDot?: number[]; sub?: (p: Plate, i: number) => string;
  /** film on a roll this wide (inches): every screen on one sheet, turned and placed side by side to use the least film */
  rollIn?: number };

/** how the screens go on a roll: each turned or not (all the same way), side by side across, as few rows as possible */
export type RollLayout = { rotate: boolean; cols: number; rows: number; widthIn: number; lengthIn: number; fits: boolean; savedIn: number };
const HEADER = 22, GAP = 18, ROLL_EDGE = 0.4; // pt, pt, in (left for the printer's own margins)
export function rollLayout(n: number, artW: number, artH: number, rollIn: number, m = 36): RollLayout {
  const iw = artW + 2 * m, ih = artH + 2 * m, P = (rollIn - ROLL_EDGE) * 72;
  const opts = [false, true].map((rotate) => {
    const w = rotate ? ih : iw, h = rotate ? iw : ih;
    const cols = Math.min(n, Math.floor((P + GAP) / (w + GAP)));
    if (cols < 1) return null;
    const rows = Math.ceil(n / cols);
    return { rotate, cols, rows, widthIn: (cols * w + (cols - 1) * GAP) / 72, lengthIn: (HEADER + rows * h + (rows - 1) * GAP) / 72, fits: true, savedIn: 0 };
  }).filter((x): x is RollLayout => !!x);
  if (!opts.length) return { rotate: false, cols: 1, rows: n, widthIn: iw / 72, lengthIn: (HEADER + n * ih + (n - 1) * GAP) / 72, fits: false, savedIn: 0 };
  opts.sort((x, y) => x.lengthIn - y.lengthIn || +x.rotate - +y.rotate);
  const best = opts[0], straight = (HEADER + n * ih + (n - 1) * GAP) / 72;
  return { ...best, savedIn: Math.max(0, straight - best.lengthIn) };
}

export async function ripPdf(plates: Plate[], w: number, h: number, o: RipOpts, z: (u8: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const W = o.widthIn * 72, H = W * (h / w), N = plates.length, roll = !!o.rollIn;
  // each screen is a box: the art at real size, a margin with the marks and the ink's name around it
  const m = roll ? 36 : 72, iw = W + 2 * m, ih = H + 2 * m;
  const L = roll ? rollLayout(N, W, H, o.rollIn!, m) : null;
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, 4 /All; then 2 objects a screen (image, its spot colorspace); then the pages (page, content)
  const imgObj = (i: number) => 6 + i * 2, pageObj = (k: number) => 6 + N * 2 + k * 2;
  const pages = roll ? 1 : N;
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, k) => `${pageObj(k)} 0 R`).join(" ")}] /Count ${pages} >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
  obj(4, ["[/Separation /All /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]"]);
  obj(5, ["<< >>"]);
  for (let i = 0; i < N; i++) {
    const p = plates[i], g = ripPlate(p.alpha, w, h, !(o.tonal || p.tonal), o.minDot?.[i] || 0), iz = await z(g);
    obj(imgObj(i), [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${imgObj(i) + 1} 0 R /BitsPerComponent 8 /Filter /FlateDecode /Length ${iz.length} >>\nstream\n`, iz, "\nendstream"]);
    // the plate's own spot color: 100% shows black on screen
    obj(imgObj(i) + 1, [`[/Separation ${pdfName(plateLabel(p, i))} /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]`]);
  }
  const target = (x: number, y: number) => { const r = 7, k = r * 0.5523; return `${x - 14} ${y} m ${x + 14} ${y} l S ${x} ${y - 14} m ${x} ${y + 14} l S ${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S\n`; };
  const crop = (x: number, y: number, dx: number, dy: number) => `${x + dx * 6} ${y} m ${x + dx * 30} ${y} l S ${x} ${y + dy * 6} m ${x} ${y + dy * 30} l S\n`;
  /** one screen in its own box (0…iw × 0…ih): the art, registration targets on four sides, crop marks, the ink's name */
  const box = (i: number) => {
    const p = plates[i], tx = m + W / 2, ty = m + H + m / 2;
    const ink = `${p.name}  (${i + 1}/${N})${roll ? "  " + o.title.split(" ")[0] : ""}`, size = roll ? 11 : 13, tw = ink.length * size * 0.6;
    let lx = tx + 20; if (lx + tw > iw - 4) lx = Math.max(4, tx - 20 - tw);
    return `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} ${m} ${m} cm /Im${i} Do Q\n` +
      `q /CSA CS 1 SCN /CSA cs 1 scn 0.5 w\n` + target(tx, ty) + target(tx, m / 2) + target(m / 2, m + H / 2) + target(m + W + m / 2, m + H / 2) +
      crop(m, m, -1, -1) + crop(m + W, m, 1, -1) + crop(m, m + H, -1, 1) + crop(m + W, m + H, 1, 1) +
      `BT /F1 ${size} Tf ${lx.toFixed(2)} ${(ty - size / 3).toFixed(2)} Td (${esc(ink)}) Tj ET\nQ\n`;
  };
  const xobjects = plates.map((_, i) => `/Im${i} ${imgObj(i)} 0 R`).join(" ");
  const page = async (k: number, PW: number, PH: number, content: string, trim?: string) => {
    const n = pageObj(k), cz = await z(enc.encode(content));
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}]${trim ? ` /TrimBox [${trim}]` : ""} /Resources << /Font << /F1 3 0 R >> /ColorSpace << /CSA 4 0 R >> /XObject << ${xobjects} >> >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
  };
  if (L) {
    // every screen on one sheet for the roll, row by row from the top; turned a quarter turn when that's shorter
    const bw = L.rotate ? ih : iw, bh = L.rotate ? iw : ih, PW = L.widthIn * 72, PH = L.lengthIn * 72;
    let content = `q /CSA cs 1 scn BT /F1 8 Tf 2 ${(PH - 12).toFixed(2)} Td (${esc(`${o.title} - ${N} screen${N === 1 ? "" : "s"} - print at 100% - ${o.widthIn}" wide art`)}) Tj ET Q\n`;
    for (let i = 0; i < N; i++) {
      const c = i % L.cols, r = Math.floor(i / L.cols), x = c * (bw + GAP), y = PH - HEADER - (r + 1) * bh - r * GAP;
      // a quarter turn: (u, v) → (x + ih − v, y + u)
      content += (L.rotate ? `q 0 1 -1 0 ${(x + ih).toFixed(2)} ${y.toFixed(2)} cm\n` : `q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm\n`) + box(i) + "Q\n";
    }
    await page(0, PW, PH, content);
  } else {
    for (let k = 0; k < N; k++) {
      const p = plates[k], PW = iw, PH = ih;
      const head = `q /CSA cs 1 scn BT /F1 8 Tf 18 ${(PH - 18).toFixed(2)} Td (${esc(`${o.title} - ${plateLabel(p, k)}${o.sub ? " - " + o.sub(p, k) : ""}`)}) Tj ET Q\n`;
      await page(k, PW, PH, box(k) + head, `${m} ${m} ${(m + W).toFixed(2)} ${(m + H).toFixed(2)}`);
    }
  }
  const count = pageObj(pages), xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += offsets[i] != null ? `${String(offsets[i]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(o.title)}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0; for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}
