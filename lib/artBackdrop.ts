/**
 * A picture's white: background to leave off, or art to print? Plain math on RGBA, so the page and a test run the same code.
 *
 * Near-white around the art used to be cropped off and flooded away on every picture. On a see-through file that ate
 * real art: a white silhouette, keyline, sticker outline or white lettering at the outside of a logo (Nov 5, S-75: "Missing
 * white Silhouette"; the plates lost it, and the gold was blown up to fill the print width it had shared with it).
 *
 * The rule, from the file itself:
 *   - no see-through around the picture (a JPG, a PNG on a white page): it has a background, and near-white reaching the
 *     edge is that background;
 *   - see-through around the picture: whoever made it already took the background out, so its white is art. The one
 *     exception is a white box left inside the clear margin (a pasted white page): white runs all the way around the
 *     art's own bounding box, which a shape's outline only touches here and there.
 */
export type Rgba = Uint8ClampedArray | Uint8Array;

const CLEAR = 12;
/** see-through on more of the picture's outer edge than stray corners explain */
const CLEAR_EDGE = 0.05;
/** white around this much of the art's bounding box is a box, not a shape (under 100% for rounded corners, art that touches it) */
const BOX_WHITE = 0.75;

const isNearWhite = (d: Rgba, o: number) => d[o] > 242 && d[o + 1] > 242 && d[o + 2] > 242;

/** walks a rectangle's outline, calling `at` with each pixel index once */
function outline(x0: number, y0: number, x1: number, y1: number, w: number, at: (i: number) => void) {
  for (let x = x0; x <= x1; x++) { at(y0 * w + x); if (y1 > y0) at(y1 * w + x); }
  for (let y = y0 + 1; y < y1; y++) { at(y * w + x0); if (x1 > x0) at(y * w + x1); }
}

/** does near-white in this picture count as a background to leave off? */
export function whiteIsBackdrop(d: Rgba, w: number, h: number): boolean {
  let edge = 0, clear = 0;
  outline(0, 0, w - 1, h - 1, w, (i) => { edge++; if (d[i * 4 + 3] < CLEAR) clear++; });
  if (!edge || clear / edge < CLEAR_EDGE) return true;
  const b = artCropBox(d, w, h, false, 0);
  if (!b) return false;
  // a little inside the box: a soft edge's half-clear pixels aren't what's being asked about
  const inset = Math.min(2, Math.floor((Math.min(b.w, b.h) - 1) / 2));
  let all = 0, white = 0;
  outline(b.x + inset, b.y + inset, b.x + b.w - 1 - inset, b.y + b.h - 1 - inset, w, (i) => { all++; if (d[i * 4 + 3] > 200 && isNearWhite(d, i * 4)) white++; });
  return all > 0 && white / all >= BOX_WHITE;
}

/** the box around the art (plus `pad`): past see-through always, past near-white too when `white`. Null when there's nothing. */
export function artCropBox(d: Rgba, W: number, H: number, white: boolean, pad = 2) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const o = (y * W + X) * 4;
    if (d[o + 3] < CLEAR || (white && isNearWhite(d, o))) continue;
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (y < y0) y0 = y; y1 = y;
  }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(W - x, x1 - x0 + 1 + pad * 2), h: Math.min(H - y, y1 - y0 + 1 + pad * 2) };
}

/**
 * The white background made see-through, in place: flooded in from the picture's edges through opaque near-white, and
 * the soft pixels along the art's edge have the white taken back out of them (color-to-alpha), so no pale fringe prints
 * around the outline.
 */
export function takeOutWhite(data: Rgba, w: number, h: number) {
  const n = w * h;
  // flood from the edges through near-white, opaque pixels (each pixel is marked when it's queued, so it's queued once)
  const near = (i: number) => data[i * 4 + 3] > 200 && isNearWhite(data, i * 4);
  const gone = new Uint8Array(n), stack = new Int32Array(n); let sp = 0, removed = 0;
  const seed = (i: number) => { if (!gone[i] && near(i)) { gone[i] = 1; stack[sp++] = i; } };
  for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
  while (sp) {
    const i = stack[--sp]; data[i * 4 + 3] = 0; removed++;
    const xx = i % w, yy = (i - xx) / w;
    if (xx > 0) seed(i - 1); if (xx < w - 1) seed(i + 1); if (yy > 0) seed(i - w); if (yy < h - 1) seed(i + w);
  }
  // the edge ring (within 2 px of the removed background): take the white back out. Found by growing the removed
  // area 2 px (across, then down), and only if anything was removed
  const ring = new Uint8Array(n);
  if (removed) {
    const tmp = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (gone[i]) for (let k = Math.max(0, x - 2); k <= Math.min(w - 1, x + 2); k++) tmp[y * w + k] = 1; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!tmp[y * w + x]) continue; for (let k = Math.max(0, y - 2); k <= Math.min(h - 1, y + 2); k++) ring[k * w + x] = 1; }
  }
  for (let i = 0; i < n; i++) {
    if (!ring[i] || gone[i]) continue;
    const xx = i % w, yy = (i - xx) / w;
    const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    // the art's own color here: the strongest (farthest from white) pixel close by that isn't background
    let F = [r, g, b], fd = (255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const X = xx + dx, Y = yy + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (gone[j]) continue;
      const q = j * 4, d = (255 - data[q]) ** 2 + (255 - data[q + 1]) ** 2 + (255 - data[q + 2]) ** 2; if (d > fd) { fd = d; F = [data[q], data[q + 1], data[q + 2]]; }
    }
    if (fd < 30 * 30) continue; // a pale color: nothing to take out
    // how much of the pixel is that color (the rest is the white it was blended with)
    const a = Math.max(0, Math.min(1, ((255 - r) * (255 - F[0]) + (255 - g) * (255 - F[1]) + (255 - b) * (255 - F[2])) / fd));
    if (a >= 0.98) continue;
    if (a < 0.02) { data[o + 3] = 0; continue; }
    data[o] = Math.round((r - (1 - a) * 255) / a); data[o + 1] = Math.round((g - (1 - a) * 255) / a); data[o + 2] = Math.round((b - (1 - a) * 255) / a);
    data[o + 3] = Math.round(data[o + 3] * a);
  }
}

/**
 * An SVG cropped to a box (in the picture's own pixels, `W` × `H`) and still an SVG: only its window moves, so it draws
 * sharp at any size. Cropping through a canvas froze it at its small on-screen size (#40435's back: 690 × 1200 px for a
 * 9" print, blown back up for the film, with lumpy letters). Null when there's no <svg> in it.
 */
export function cropSvg(text: string, box: { x: number; y: number; w: number; h: number }, W: number, H: number): string | null {
  const m = /<svg\b[^>]*>/i.exec(text);
  if (!m || !(W > 0 && H > 0)) return null;
  const vb = /\sviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/i.exec(m[0]);
  const [vx, vy, vw, vh] = vb ? vb.slice(1).map(Number) : [0, 0, W, H];
  if (!(vw > 0 && vh > 0)) return null;
  // how the file's own units land on the picture's pixels: fitted and centered, unless it asks to be stretched
  const stretch = /\spreserveAspectRatio\s*=\s*["']\s*none/i.test(m[0]);
  const sx = stretch ? W / vw : Math.min(W / vw, H / vh), sy = stretch ? H / vh : sx;
  const ox = stretch ? 0 : (W - vw * sx) / 2, oy = stretch ? 0 : (H - vh * sy) / 2;
  const n = (v: number) => +v.toFixed(4);
  const view = [vx + (box.x - ox) / sx, vy + (box.y - oy) / sy, box.w / sx, box.h / sy].map(n).join(" ");
  const open = m[0].replace(/\s(width|height|viewBox)\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/\s*\/?>$/, "");
  return text.slice(0, m.index) + `${open} width="${box.w}" height="${box.h}" viewBox="${view}">` + text.slice(m.index + m[0].length);
}
