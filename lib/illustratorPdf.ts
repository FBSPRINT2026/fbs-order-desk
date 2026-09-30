/**
 * The separation as one file for Adobe Illustrator (a PDF, which Illustrator opens directly: no Photoshop step).
 *
 *   - Every plate is its own spot color, named in print order like Separo ("1 - Underbase White", "2 - PMS 102 C",
 *     "5 - Black"), so Illustrator's Separations Preview and File → Print → Separations give one film per ink. The
 *     number also keeps a plate called "Black" or "Yellow" from being mistaken for a process plate.
 *   - Plates from a picture (solid or halftone) go into ONE multi-ink image (DeviceN, one channel per ink), the way
 *     Photoshop saves channel separations as PDF, which Illustrator opens with the spot colors in Swatches. No blend
 *     modes or transparency (Illustrator would flatten those when printing separations). Solid plates are 0 or 100%
 *     pixel for pixel (like Separo, which keeps the art's own pixels); halftone plates keep their shades for the RIP.
 *   - Solid plates can instead be smooth Bézier outlines traced from the plate ("vector"), for low-resolution art.
 *   - Vector art (SVG / EPS / .ai / PDF) keeps its original shapes: each shape is filled with its ink, or with tints
 *     of the inks that mix its color; its underbase (choked, so it can't come from the shapes) is traced as curves.
 *   - Shapes overprint (each ink prints on its own screen; nothing knocks out the underbase).
 * The art is placed at its real print size.
 */
import { traceCurves } from "./sepVector";
import type { Plate } from "./separate";
import type { VArt } from "./svgVector";

const enc = new TextEncoder();
const pdfName = (s: string) => "/" + s.replace(/[^A-Za-z0-9_.-]/g, (c) => "#" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase());
/** a CMYK for how the swatch looks on screen in Illustrator (the ink name is what prints) */
function cmyk(hex: string, kind: Plate["kind"]): [number, number, number, number] {
  if (kind !== "color") return kind === "underbase" ? [0, 0, 0, 0.18] : [0.05, 0, 0, 0];
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number];
}

export type IllustratorOpts = {
  widthIn: number; tonal: boolean; title: string;
  /** solid plates from a picture: "pixels" (default, exact) or "vector" (traced curves) */
  solid?: "pixels" | "vector";
  /** vector art: the color plates are the original shapes; each fill goes on the plates that print it, as a tint (1 = solid) */
  vector?: { art: VArt; mixOf: (fill: string) => { plate: number; tint: number }[] };
};

/** the plate names as they appear in Illustrator: "1 - Underbase White" … (print order) */
export const plateLabel = (p: Plate, i: number) => `${i + 1} - ${p.name}`;

export async function illustratorPdf(plates: Plate[], w: number, h: number, o: IllustratorOpts, z: (u8: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const W = o.widthIn * 72, H = W * (h / w), s = W / w, N = plates.length;
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  // objects: 1 catalog, 2 pages, 3 page, 4 content, 5 ExtGState (overprint), 6..6+N-1 one Separation per plate,
  // then (if any plate is a picture) 6+N the DeviceN color space, 7+N its tint function, 8+N the image
  const CS_DN = 6 + N, FN_DN = 7 + N, IM_DN = 8 + N;
  const cs: string[] = [];
  const looks = plates.map((p) => cmyk(p.hex, p.kind));
  plates.forEach((p, i) => {
    const [c, m, y, k] = looks[i];
    cs.push(`/CS${i} ${6 + i} 0 R`);
    obj(6 + i, [`[/Separation ${pdfName(plateLabel(p, i))} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c} ${m} ${y} ${k}] /N 1 >>]`]);
  });

  // which plates are pictures (in the multi-ink image) and which are shapes
  const raster = plates.map((p) => {
    if (o.vector) return !!(o.tonal && p.kind !== "underbase") || (o.tonal && p.kind === "underbase");
    return o.tonal || !!p.tonal || o.solid !== "vector";
  });
  const ri = plates.map((_, i) => i).filter((i) => raster[i]);

  let content = "";
  if (ri.length) content += `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /ImDN Do Q\n`;
  plates.forEach((p, i) => {
    if (raster[i]) return;
    if (o.vector && p.kind !== "underbase") {
      // the original vector shapes that print on this plate, at their tint, in SVG coordinates (flipped onto the page)
      const a = o.vector.art, k = W / a.w;
      const mine = a.shapes.map((sh) => ({ sh, t: o.vector!.mixOf(sh.fill).find((m) => m.plate === i)?.tint || 0 })).filter((x) => x.t > 0.02);
      if (mine.length) {
        content += `q /GS0 gs ${k.toFixed(5)} 0 0 ${(-k).toFixed(5)} ${(-a.x * k).toFixed(3)} ${(H + a.y * k).toFixed(3)} cm /CS${i} cs\n`;
        for (const { sh, t } of mine) content += `${Math.min(1, t).toFixed(3)} scn\n` + sh.ops + (sh.evenodd ? "f*\n" : "f\n");
        content += "Q\n";
      }
      // fine detail: the color made fatter over the base's edge (small type), traced as curves around those parts
      if (p.bump) {
        const near = new Uint8Array(p.alpha.length), R = 3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (!p.bump[y * w + x]) continue;
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) near[Y * w + X] = 1; }
        }
        const m = new Uint8Array(p.alpha.length); for (let j = 0; j < m.length; j++) if (near[j]) m[j] = p.alpha[j];
        const path = traceCurves(m, w, h, s, H);
        if (path) content += `q /GS0 gs /CS${i} cs 1 scn\n${path}f*\nQ\n`;
      }
    } else {
      // smooth curves: vector art's underbase, or a solid plate traced on request
      const path = traceCurves(p.alpha, w, h, s, H);
      if (path) content += `q /GS0 gs /CS${i} cs 1 scn\n${path}f*\nQ\n`;
    }
  });

  if (ri.length) {
    const M = ri.length;
    // the multi-ink image: one byte per ink per pixel; solid plates are 0 or 255, halftone plates keep their shades
    const data = new Uint8Array(w * h * M);
    ri.forEach((pi, c) => {
      const a = plates[pi].alpha, solid = !(o.tonal || plates[pi].tonal);
      for (let j = 0, q = c; j < a.length; j++, q += M) data[q] = solid ? (a[j] >= 128 ? 255 : 0) : a[j];
    });
    // how it looks on screen: the inks laid down in print order, each covering what's under it by its amount
    // (acc = acc + t·(ink − acc)), like on the press; it only affects the screen, each ink prints on its own plate
    let fn = "{ ";
    for (let out = 0; out < 4; out++) {
      fn += "0 ";
      ri.forEach((pi, c) => { const coef = looks[pi][out]; fn += `${out + 1 + (M - 1 - c)} index exch dup ${coef} exch sub 3 -1 roll mul add `; });
    }
    fn += `${M + 4} 4 roll ` + "pop ".repeat(M) + "}";
    const fnz = enc.encode(fn);
    obj(FN_DN, [`<< /FunctionType 4 /Domain [${ri.map(() => "0 1").join(" ")}] /Range [0 1 0 1 0 1 0 1] /Length ${fnz.length} >>\nstream\n`, fnz, "\nendstream"]);
    const names = ri.map((pi) => pdfName(plateLabel(plates[pi], pi))).join(" ");
    obj(CS_DN, [`[/DeviceN [${names}] /DeviceCMYK ${FN_DN} 0 R << /Colorants << ${ri.map((pi) => `${pdfName(plateLabel(plates[pi], pi))} ${6 + pi} 0 R`).join(" ")} >> >>]`]);
    const d = await z(data);
    obj(IM_DN, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${CS_DN} 0 R /BitsPerComponent 8 /Filter /FlateDecode /Length ${d.length} >>\nstream\n`, d, "\nendstream"]);
  }
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /ExtGState << /GS0 5 0 R >> /ColorSpace << ${cs.join(" ")} >>${ri.length ? ` /XObject << /ImDN ${IM_DN} 0 R >>` : ""} >> /Contents 4 0 R >>`]);
  const cz = await z(enc.encode(content));
  obj(4, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
  obj(5, ["<< /Type /ExtGState /OP true /op true /OPM 1 >>"]);
  const count = ri.length ? IM_DN + 1 : 6 + N, xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += offsets[i] != null ? `${String(offsets[i]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${o.title.replace(/[\\()]/g, "")}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0; for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}
