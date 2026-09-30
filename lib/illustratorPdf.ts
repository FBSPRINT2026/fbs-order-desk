/**
 * The separation as one file for Adobe Illustrator (a PDF, which Illustrator opens directly — no Photoshop step):
 *   - every plate is its own spot color swatch (Separation color space named after the ink: "Underbase White",
 *     "PMS 186 C", "Highlight White"…), so Illustrator's Separations Preview and File → Print → Separations
 *     give one film per ink
 *   - solid plates (spot color jobs) are real vector shapes, traced from the plate
 *   - tonal plates (simulated process) are grayscale images colored with their spot ink; the RIP / Illustrator
 *     halftones them at the LPI you print with
 *   - everything overprints (each ink prints on its own screen; nothing knocks out the underbase); the tonal
 *     images are also set to Multiply so all of them show on screen (otherwise the top one hides the rest)
 *   - drawn in print order, the underbase at the bottom
 * The art is placed at its real print size.
 */
import { traceMask } from "./sepVector";
import type { Plate } from "./separate";
import type { VArt } from "./svgVector";

const enc = new TextEncoder();
const pdfName = (s: string) => "/" + s.replace(/[^A-Za-z0-9_.-]/g, (c) => "#" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase());
/** a rough CMYK for how the swatch looks on screen in Illustrator (the ink name is what prints) */
function cmyk(hex: string, kind: Plate["kind"]): [number, number, number, number] {
  if (kind !== "color") return kind === "underbase" ? [0, 0, 0, 0.18] : [0.05, 0, 0, 0];
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number];
}

export type IllustratorOpts = {
  widthIn: number; tonal: boolean; title: string;
  /** vector art (SVG): the color plates are the original shapes, each put on the plate its fill belongs to */
  vector?: { art: VArt; plateOf: (fill: string) => number | null };
};

export async function illustratorPdf(plates: Plate[], w: number, h: number, o: IllustratorOpts, z: (u8: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const W = o.widthIn * 72, H = W * (h / w), s = W / w;
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  // objects: 1 catalog, 2 pages, 3 page, 4 content, 5 ExtGState, then per plate: color space (6+2i), image (7+2i)
  let content = "";
  const cs: string[] = [], xo: string[] = [];
  const imgs: { n: number; data: Uint8Array }[] = [];
  plates.forEach((p, i) => {
    const csn = 6 + 2 * i, [c, m, y, k] = cmyk(p.hex, p.kind);
    cs.push(`/CS${i} ${csn} 0 R`);
    // name the swatch after the ink (unique per plate)
    const label = plates.filter((q, j) => j < i && q.name === p.name).length ? `${p.name} ${i + 1}` : p.name;
    obj(csn, [`[/Separation ${pdfName(label)} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c} ${m} ${y} ${k}] /N 1 >>]`]);
    if (o.tonal) {
      xo.push(`/Im${i} ${csn + 1} 0 R`);
      imgs.push({ n: csn + 1, data: p.alpha });
      content += `q /GS1 gs ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im${i} Do Q\n`;
    } else if (o.vector && p.kind !== "underbase") {
      // the original vector shapes of this plate's color, in SVG coordinates (flipped onto the page)
      const a = o.vector.art, k = W / a.w;
      const mine = a.shapes.filter((sh) => o.vector!.plateOf(sh.fill) === i);
      if (mine.length) {
        content += `q /GS0 gs ${k.toFixed(5)} 0 0 ${(-k).toFixed(5)} ${(-a.x * k).toFixed(3)} ${(H + a.y * k).toFixed(3)} cm /CS${i} cs 1 scn\n`;
        for (const sh of mine) content += sh.ops + (sh.evenodd ? "f*\n" : "f\n");
        content += "Q\n";
      }
    } else {
      const loops = traceMask(p.alpha, w, h);
      let path = "";
      for (const l of loops) {
        path += `${(l[0] * s).toFixed(2)} ${(H - l[1] * s).toFixed(2)} m\n`;
        for (let j = 2; j < l.length; j += 2) path += `${(l[j] * s).toFixed(2)} ${(H - l[j + 1] * s).toFixed(2)} l\n`;
        path += "h\n";
      }
      if (path) content += `q /GS0 gs /CS${i} cs 1 scn\n${path}f*\nQ\n`;
    }
  });
  for (const im of imgs) {
    const d = await z(im.data);
    obj(im.n, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${6 + (im.n - 7)} 0 R /BitsPerComponent 8 /Filter /FlateDecode /Length ${d.length} >>\nstream\n`, d, "\nendstream"]);
  }
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /ExtGState << /GS0 5 0 R /GS1 << /Type /ExtGState /OP true /op true /OPM 1 /BM /Multiply >> >> /ColorSpace << ${cs.join(" ")} >> /XObject << ${xo.join(" ")} >> >> /Contents 4 0 R >>`]);
  const cz = await z(enc.encode(content));
  obj(4, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
  obj(5, ["<< /Type /ExtGState /OP true /op true /OPM 1 >>"]);
  const count = 6 + 2 * plates.length, xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += offsets[i] != null ? `${String(offsets[i]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${o.title.replace(/[\\()]/g, "")}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0; for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}
