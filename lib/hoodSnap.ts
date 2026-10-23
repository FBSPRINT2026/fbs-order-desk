"use client";
import { PHOTO_H, PHOTO_W } from "@/lib/mockup";

/**
 * The hood's edge on a hoodie's back photo, traced roughly by hand and snapped to the color change right there, like
 * Photoshop's magnetic lasso (Oct 23, Nick: "help me find hoodie seams… I can draw around the seam… I'm not going to be
 * able to draw it perfectly with my mouse… snap to the change in color that's right there"). Points are photo pixels
 * (PHOTO_W × PHOTO_H). Along the line, every few pixels, the strongest light/dark change within a short reach up or down
 * is taken, then smoothed so a stray fleck doesn't pull it.
 */
export async function snapToEdge(photoUrl: string, rough: [number, number][]): Promise<[number, number][]> {
  if (rough.length < 2) return rough;
  const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = photoUrl; });
  const c = document.createElement("canvas"); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, PHOTO_W, PHOTO_H);
  const k = Math.min(PHOTO_W / im.naturalWidth, PHOTO_H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
  x.drawImage(im, (PHOTO_W - w) / 2, (PHOTO_H - h) / 2, w, h);
  const d = x.getImageData(0, 0, PHOTO_W, PHOTO_H).data;
  // brightness, softened over a small patch (a heather's flecks don't count as an edge)
  const lum = (X: number, y: number) => {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = Math.min(PHOTO_W - 1, Math.max(0, X + dx)), yy = Math.min(PHOTO_H - 1, Math.max(0, y + dy)), q = (yy * PHOTO_W + xx) * 4;
      s += d[q] + d[q + 1] + d[q + 2]; n++;
    }
    return s / n / 3;
  };
  // the rough line as y at each x (drawn either way)
  const pts = [...rough].sort((a, b) => a[0] - b[0]);
  const yAt = (X: number) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; if (X >= x0 && X <= x1) return x1 === x0 ? y0 : y0 + ((y1 - y0) * (X - x0)) / (x1 - x0); } return X < pts[0][0] ? pts[0][1] : pts[pts.length - 1][1]; };
  const out: [number, number][] = [], reach = 28;
  for (let X = Math.round(pts[0][0]); X <= Math.round(pts[pts.length - 1][0]); X += 4) {
    const y0 = Math.round(yAt(X));
    let best = y0, bs = -Infinity;
    for (let y = y0 - reach; y <= y0 + reach; y++) {
      if (y < 4 || y > PHOTO_H - 5) continue;
      const g = Math.abs(lum(X, y + 3) - lum(X, y - 3)) - 0.25 * Math.abs(y - y0);
      if (g > bs) { bs = g; best = y; }
    }
    out.push([X, best]);
  }
  // smoothed: the middle of each few, then an average (no jumps off the edge)
  const ys = out.map((p) => p[1]);
  const med = ys.map((_, i) => { const w2 = ys.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b); return w2[w2.length >> 1]; });
  const avg = med.map((_, i) => { const w2 = med.slice(Math.max(0, i - 2), i + 3); return w2.reduce((a, b) => a + b, 0) / w2.length; });
  return out.map((p, i) => [p[0], Math.round(avg[i])]);
}

/** the shirt's outline (a mask picture) with everything above the hood's edge taken out: prints go behind the hood */
export async function maskBehindHood(mask: string, edge: [number, number][]): Promise<string> {
  const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = mask; });
  const c = document.createElement("canvas"); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext("2d")!;
  x.drawImage(im, 0, 0, PHOTO_W, PHOTO_H);
  const pts = [...edge].sort((a, b) => a[0] - b[0]);
  if (pts.length >= 2) {
    x.globalCompositeOperation = "destination-out";
    x.beginPath(); x.moveTo(pts[0][0], 0);
    for (const [px, py] of pts) x.lineTo(px, py);
    x.lineTo(pts[pts.length - 1][0], 0); x.closePath(); x.fill();
  }
  return c.toDataURL("image/png");
}
