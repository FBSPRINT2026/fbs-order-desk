"use client";
import { PHOTO_H, PHOTO_W } from "@/lib/mockup";

/**
 * A sweatshirt's or hoodie's back photo drawn at the front photo's size (Oct 23, Nick on the Bella 3945: "look how much
 * lower the seam is… the bottom seam, not the arms… brought up so it's the same height as the bottom seam on the left").
 * S&S shoots some backs closer than the fronts, so the garment, and every print on it, looked bigger on the back. Down
 * the middle of each photo: the top of the collar and the bottom of the hem. The back is redrawn, anchored at its collar,
 * so its collar-to-hem matches the front's (a blob URL), or null when they already match (within 2%).
 */
const draw = (im: HTMLImageElement) => {
  const c = document.createElement("canvas"); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, PHOTO_W, PHOTO_H);
  const k = Math.min(PHOTO_W / im.naturalWidth, PHOTO_H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
  x.drawImage(im, (PHOTO_W - w) / 2, (PHOTO_H - h) / 2, w, h);
  return c;
};
/** the garment down its middle: its center, the top of the collar and the bottom of the hem (photo px) */
function middle(c: HTMLCanvasElement) {
  const W = c.width, H = c.height, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const ink = (X: number, y: number) => { const q = (y * W + X) * 4; return Math.min(d[q], d[q + 1], d[q + 2]) < 245; };
  let T = -1, B = -1;
  for (let y = 0; y < H; y++) { let n = 0; for (let X = 0; X < W; X += 3) if (ink(X, y)) n++; if (n > 4) { if (T < 0) T = y; B = y; } }
  if (T < 0) return null;
  const yy = Math.round(T + 0.55 * (B - T));
  let L = -1, R = -1; for (let X = 0; X < W; X++) if (ink(X, yy)) { if (L < 0) L = X; R = X; }
  if (L < 0) return null;
  const cx = Math.round((L + R) / 2);
  // a few columns around the middle, the median (a zipper or a print down the middle doesn't sway it)
  const tops: number[] = [], hems: number[] = [];
  for (let X = cx - 20; X <= cx + 20; X += 5) { let t = -1, b = -1; for (let y = 0; y < H; y++) if (ink(X, y)) { if (t < 0) t = y; b = y; } if (t >= 0) { tops.push(t); hems.push(b); } }
  if (tops.length < 3) return null;
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return { cx, top: med(tops), hem: med(hems) };
}
const load = (u: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = u; });

export async function levelBack(frontUrl: string, backUrl: string): Promise<string | null> {
  const [fi, bi] = await Promise.all([load(frontUrl), load(backUrl)]);
  const fc = draw(fi), bc = draw(bi), f = middle(fc), b = middle(bc);
  if (!f || !b || f.hem - f.top < 300 || b.hem - b.top < 300) return null;
  const r = (f.hem - f.top) / (b.hem - b.top);
  if (Math.abs(r - 1) < 0.02 || r < 0.8 || r > 1.2) return null;
  const c = document.createElement("canvas"); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, PHOTO_W, PHOTO_H);
  // anchored at the back's collar (its center top stays put), then the whole photo set where the front's collar is
  x.drawImage(bc, 0, 0, PHOTO_W, PHOTO_H, b.cx - b.cx * r, f.top - b.top * r, PHOTO_W * r, PHOTO_H * r);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.92));
  return blob ? URL.createObjectURL(blob) : null;
}
