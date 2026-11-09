/**
 * Art copied out of Illustrator that holds a picture (Nov 9, #40407's E78: "it's cutting off the 8 every time in the
 * bottom right corner"). Illustrator writes the picture's scale rounded to two places (scale(.13) for 0.12706), so the
 * picture comes out a little bigger than the art's box and its own clip cuts off the right and bottom edges. A picture
 * that nearly fills the box (within 8%) is set to exactly the box again. Pure, so it can be tested.
 */
const n = (s: string | undefined) => (s == null || s === "" ? NaN : +s);
const attr = (tag: string, k: string) => new RegExp(`\\s${k}\\s*=\\s*["']\\s*([-\\d.eE]+)`, "i").exec(tag)?.[1];

/** the scale a transform gives (x, y) and where it moves to, or null for anything else (rotation, skew) */
function scaleOf(t: string): { sx: number; sy: number; tx: number; ty: number } | null {
  let sx = 1, sy = 1, tx = 0, ty = 0;
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null, left = t;
  while ((m = re.exec(t))) {
    left = left.replace(m[0], "");
    const v = m[2].trim().split(/[\s,]+/).map(Number);
    if (v.some((x) => !isFinite(x))) return null;
    if (/^translate$/i.test(m[1])) { tx += (v[0] || 0) * sx; ty += (v[1] || 0) * sy; }
    else if (/^scale$/i.test(m[1])) { sx *= v[0]; sy *= v.length > 1 ? v[1] : v[0]; }
    else { if (Math.abs(v[1]) > 1e-6 || Math.abs(v[2]) > 1e-6) return null; tx += (v[4] || 0) * sx; ty += (v[5] || 0) * sy; sx *= v[0]; sy *= v[3]; }
  }
  return left.trim() ? null : { sx, sy, tx, ty };
}

export function fitRoundedImages(svg: string): { svg: string; changed: number } {
  const open = svg.slice(0, svg.indexOf(">") + 1);
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/i.exec(open);
  if (!vb) return { svg, changed: 0 };
  const [bx, by, bw, bh] = [+vb[1], +vb[2], +vb[3], +vb[4]];
  if (!(bw > 0 && bh > 0)) return { svg, changed: 0 };
  let changed = 0;
  const out = svg.replace(/<image\b[^>]*>/gi, (tag) => {
    const w = n(attr(tag, "width")), h = n(attr(tag, "height"));
    if (!(w > 0 && h > 0)) return tag;
    const x = n(attr(tag, "x")) || 0, y = n(attr(tag, "y")) || 0;
    const tm = /\stransform\s*=\s*["']([^"']*)["']/i.exec(tag);
    const s = tm ? scaleOf(tm[1]) : { sx: 1, sy: 1, tx: 0, ty: 0 };
    if (!s || !(s.sx > 0 && s.sy > 0)) return tag;
    const left = s.tx + x * s.sx, top = s.ty + y * s.sy, dw = w * s.sx, dh = h * s.sy;
    // it starts at the box's corner and is the box's size give or take the rounding: fit it exactly
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.08 * b;
    const off = (a: number, b: number) => Math.abs(a - b) <= 0.02 * Math.max(bw, bh);
    if (!off(left, bx) || !off(top, by) || !near(dw, bw) || !near(dh, bh)) return tag;
    if (Math.abs(dw - bw) < 1e-3 && Math.abs(dh - bh) < 1e-3) return tag;
    changed++;
    const fit = `matrix(${+(bw / w).toFixed(6)} 0 0 ${+(bh / h).toFixed(6)} ${bx} ${by})`;
    const clean = tag.replace(/\s(x|y)\s*=\s*["'][^"']*["']/gi, "");
    return tm ? clean.replace(/\stransform\s*=\s*["'][^"']*["']/i, ` transform="${fit}"`) : clean.replace(/<image\b/i, `<image transform="${fit}"`);
  });
  return { svg: out, changed };
}
