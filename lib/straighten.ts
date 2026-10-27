"use client";

/**
 * Square up a logo pulled off a photo (Oct 27, Nick on the Keslow Fallout jacket: "I want to pull the back off, but it's
 * rotated… square it up, or unrotate the logo"). Works on the cut-out art (a PNG with the background gone):
 *   - straightAngle: the turn that sets it square: its edges' tilt off level (within ±22°)
 *   - rotateArt: the art turned by that many degrees, on a canvas just big enough, empty edges trimmed
 */

/** the art's alpha, at most `max` pixels across, turned by `deg` */
function alphaOf(img: ImageBitmap, deg = 0, max = 500): { a: Float32Array; w: number; h: number } {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const t = (deg * Math.PI) / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
  const iw = img.width * k, ih = img.height * k;
  const w = Math.max(3, Math.ceil(iw * cs + ih * sn)), h = Math.max(3, Math.ceil(iw * sn + ih * cs));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.translate(w / 2, h / 2); x.rotate(t); x.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  const d = x.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] / 255;
  return { a, w, h };
}

/**
 * the turn (degrees, clockwise) that squares the art up: the art's edges mostly run level and upright when it's square,
 * so each edge votes for its tilt (Sobel on the art's outline, angles folded to a quarter turn, weighted by how sharp
 * the edge is); a round badge has no say. 0 when it's already square (under 0.5°) or there's too little edge to tell.
 */
export async function straightAngle(f: Blob): Promise<number> {
  const img = await createImageBitmap(f);
  // measured, turned by that, measured again: the pixel grid pulls a big tilt's reading, a small one reads true
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const m = tiltOf(alphaOf(img, total));
    if (m == null) break;
    total += m;
    if (Math.abs(m) < 0.2) break;
  }
  img.close();
  const turn = Math.round(total * 10) / 10;
  return Math.abs(turn) < 0.5 ? 0 : turn;
}

/** the turn that sets these edges level (null: no edge direction stands out) */
function tiltOf({ a, w, h }: { a: Float32Array; w: number; h: number }): number | null {
  let C = 0, S = 0, M = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = (dx: number, dy: number) => a[(y + dy) * w + x + dx];
    const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
    const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
    const m = Math.hypot(gx, gy);
    if (m < 0.5) continue;
    const t = Math.atan2(gy, gx) * 4;
    C += m * Math.cos(t); S += m * Math.sin(t); M += m;
  }
  if (M < 50 || Math.hypot(C, S) / M < 0.08) return null; // round, or noise
  return -(Math.atan2(S, C) / 4) * (180 / Math.PI); // how far the edges sit off level, -22.5…22.5, undone
}

/** the art turned by `deg` degrees clockwise, trimmed to the art */
export async function rotateArt(f: File, deg: number): Promise<File> {
  if (!deg) return f;
  const img = await createImageBitmap(f);
  const t = (deg * Math.PI) / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
  const w = Math.ceil(img.width * cs + img.height * sn), h = Math.ceil(img.width * sn + img.height * cs);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  x.translate(w / 2, h / 2); x.rotate(t); x.drawImage(img, -img.width / 2, -img.height / 2);
  img.close();
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  if (!blob) return f;
  const out = new File([blob], f.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  const { cropFileToArt } = await import("@/lib/artPrep");
  return (await cropFileToArt(out)) || out;
}
