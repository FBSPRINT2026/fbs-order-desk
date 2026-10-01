/**
 * Illustrator EPS → vector art (the same shapes-per-color form as lib/svgVector.ts), so a logo saved as EPS from
 * Illustrator separates from its real shapes and comes back into Illustrator as the original vectors.
 *
 * Illustrator writes the page with a small, regular set of operators (its AGM procset):
 *   x y mo / li, x1 y1 x2 y2 x3 y3 cv, cp (close), np (new path), f / ef (fill, even-odd fill), clp / eclp (clip),
 *   c m y k cmyk / r g b rgb / g gry (fill color), [a b c d e f] ct (transform), gsave / grestore / pgsv / pgrs
 * after "%%EndPageSetup" and before "%%PageTrailer". This reads just that. Anything it can't turn into flat filled
 * shapes (placed images, gradients, strokes that weren't outlined, live text, spot-color swatches it can't read)
 * sets `ok: false` with the reason, and the Studio asks for an SVG or PNG instead.
 *
 * CMYK colors are shown as the press would print them (a blend of the standard coated-ink colors, within about 5 ΔE of
 * a real color profile), not the naive 255·(1−c)(1−k), which turns 0/98/39/0 into a neon pink.
 */
import type { VArt, VShape } from "./svgVector";

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/* ---------- CMYK → sRGB (coated press) ---------- */
const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// the 8 overprints of C, M, Y at 100% on coated stock, as Illustrator shows them
const CORNERS: [number, number, number, number[]][] = [
  [0, 0, 0, hx("#FFFFFF")], [1, 0, 0, hx("#00AEEF")], [0, 1, 0, hx("#EC008C")], [0, 0, 1, hx("#FFF200")],
  [1, 1, 0, hx("#2E3192")], [1, 0, 1, hx("#00A651")], [0, 1, 1, hx("#ED1C24")], [1, 1, 1, hx("#231F20")],
];
const lin = (v: number) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
const K100 = lin(0x23 / 255);
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
export function cmykHex(c: number, m: number, y: number, k: number): string {
  const acc = [0, 0, 0];
  for (const [cc, mm, yy, rgb] of CORNERS) {
    const w = (cc ? c : 1 - c) * (mm ? m : 1 - m) * (yy ? y : 1 - y);
    for (let i = 0; i < 3; i++) acc[i] += w * rgb[i];
  }
  const kf = 1 - k + k * K100;
  return hex(...(acc.map((v) => gam(lin(v) * kf)) as [number, number, number]));
}

/* ---------- the page ---------- */
function tokens(src: string): string[] {
  const out: string[] = [];
  const re = /%[^\n\r]*|\((?:\\.|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|[[\]{}]|\/?[^\s[\]{}()<>/%]+/g;
  for (const m of src.matchAll(re)) if (m[0][0] !== "%") out.push(m[0]);
  return out;
}

export function parseEps(text: string): VArt {
  const bb = text.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) || text.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  const fail = (why: string): VArt => ({ ok: false, why, x: 0, y: 0, w: 1, h: 1, shapes: [] });
  if (!bb) return fail("has no bounding box");
  const [llx, lly, urx, ury] = bb.slice(1).map(Number);
  const W = urx - llx, H = ury - lly;
  if (!(W > 0 && H > 0)) return fail("has an empty bounding box");
  const a = text.indexOf("%%EndPageSetup"), b = text.indexOf("%%PageTrailer", a);
  if (a < 0 || b < 0 || !/Adobe Illustrator/i.test(text.slice(0, 4000))) return fail("isn't an Illustrator EPS");
  const tk = tokens(text.slice(a + 14, b));

  let ctm: M = [1, 0, 0, 1, 0, 0], fill: string | null = "#000000";
  const saved: { ctm: M; fill: string | null }[] = [];
  const stack: (number | string | number[])[] = [];
  let path = "", arrOpen: number[] | null = null;
  const shapes: VShape[] = [];
  const num = () => { const v = stack.pop(); return typeof v === "number" ? v : NaN; };
  const nums = (n: number) => { const r: number[] = []; for (let i = 0; i < n; i++) r.unshift(num()); return r; };
  // page space (PostScript, y up) → art space (SVG, y down, from the bounding box's top-left)
  const pt = (x: number, y: number) => { const px = ctm[0] * x + ctm[2] * y + ctm[4], py = ctm[1] * x + ctm[3] * y + ctm[5]; return `${(px - llx).toFixed(3)} ${(ury - py).toFixed(3)}`; };
  let why = "";
  const STROKE = new Set(["@", "S", "s", "stroke", "cstk"]);
  const IMAGE = new Set(["image", "imagemask", "colorimage", "sh", "shfill", "doimage", "xs", "show", "ashow", "widthshow", "glyphshow"]);

  for (const t of tk) {
    if (arrOpen) { if (t === "]") { stack.push(arrOpen); arrOpen = null; } else { const v = Number(t); if (!Number.isNaN(v)) arrOpen.push(v); } continue; }
    if (t === "[") { arrOpen = []; continue; }
    const v = Number(t);
    if (!Number.isNaN(v) && t !== "") { stack.push(v); continue; }
    switch (t) {
      case "mo": { const [x, y] = nums(2); path += `${pt(x, y)} m\n`; break; }
      case "li": { const [x, y] = nums(2); path += `${pt(x, y)} l\n`; break; }
      case "cv": { const [x1, y1, x2, y2, x3, y3] = nums(6); path += `${pt(x1, y1)} ${pt(x2, y2)} ${pt(x3, y3)} c\n`; break; }
      case "cp": path += "h\n"; break;
      case "np": case "clp": case "eclp": case "N": path = ""; stack.length = 0; break;
      case "f": case "ef": {
        if (path) {
          if (!fill) why ||= "uses a color it can't read (a spot-color swatch?)";
          else shapes.push({ fill, evenodd: t === "ef", ops: path });
        }
        path = ""; stack.length = 0; break;
      }
      case "cmyk": { const [c, m, y, k] = nums(4); fill = cmykHex(c, m, y, k); break; }
      case "rgb": { const [r, g, bb2] = nums(3); fill = hex(r, g, bb2); break; }
      case "gry": { const [g] = nums(1); fill = hex(g, g, g); break; }
      case "ct": { const m = stack.pop(); if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m as M); break; }
      case "scale": { const [sx, sy] = nums(2); ctm = mul(ctm, [sx, 0, 0, sy, 0, 0]); break; }
      case "translate": { const [tx, ty] = nums(2); ctm = mul(ctm, [1, 0, 0, 1, tx, ty]); break; }
      case "gsave": case "pgsv": saved.push({ ctm, fill }); break;
      case "grestore": case "pgrs": { const s = saved.pop(); if (s) { ctm = s.ctm; fill = s.fill; } break; }
      case "cs": case "setcolorspace": stack.length = 0; break;
      case "sc": case "scn": case "setcolor": {
        // 4 numbers = CMYK, 3 = RGB, 1 = a tint of a spot color (not read yet)
        const top = stack[stack.length - 1], c = Array.isArray(top) ? top : stack.filter((x): x is number => typeof x === "number");
        fill = c.length === 4 ? cmykHex(c[0], c[1], c[2], c[3]) : c.length === 3 ? hex(c[0], c[1], c[2]) : null;
        stack.length = 0; break;
      }
      default:
        if (STROKE.has(t)) { if (path) why ||= "has strokes (outline them in Illustrator: Object → Path → Outline Stroke)"; path = ""; }
        else if (IMAGE.has(t)) why ||= t === "sh" || t === "shfill" ? "has gradients" : /show/.test(t) ? "has live text (outline it: Type → Create Outlines)" : "has a placed image";
        stack.length = 0;
    }
  }
  if (!shapes.length) return fail(why || "has no filled shapes");
  if (why) return { ok: false, why, x: 0, y: 0, w: W, h: H, shapes };
  return { ok: true, x: 0, y: 0, w: W, h: H, shapes };
}

/** vector art as an SVG file (to draw it as pixels for the separation, and for thumbnails) */
/** a shape's outline (PDF path operators) as SVG path data, for an SVG or a canvas Path2D */
export const vpathD = (ops: string) => ops.trim().split("\n").map((l) => { const p = l.trim().split(/\s+/), op = p.pop(); return op === "m" ? `M${p.join(" ")}` : op === "l" ? `L${p.join(" ")}` : op === "c" ? `C${p.join(" ")}` : "Z"; }).join("");
export function vartSvg(v: VArt): string {
  const d = vpathD;
  const body = v.shapes.map((s) => `<path fill="${s.fill}"${s.evenodd ? ' fill-rule="evenodd"' : ""} d="${d(s.ops)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" width="${v.w}" height="${v.h}">${body}</svg>`;
}
