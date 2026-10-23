"use client";
/**
 * Where a logo should be centered when its box's middle isn't its middle (Oct 22, Nick, Hudson Band #40104: "a circle
 * image… the customer is going to want that circle exactly in the center. But then you've got that little tail that
 * sticks out… we should center the circle, and the tail should be off center… when you're making the film and the crop
 * marks, the circle's in the center… you've got to do the same thing in the Mockup Creator… something you should
 * detect… a little check mark… so that if you don't detect it, I can tell you to").
 *
 * Finds a round badge that fills the art's height (or width) with something sticking out one side: the circle's top and
 * bottom points line up, one side of the circle is the edge of the art, and the outline is round all the way around
 * except where the tail is. Returns the circle's center as a share of the picture (0.5, 0.5 = the picture's middle), or
 * null when there's no such circle. `loose` (the person ticked it themselves): the middle between its top and bottom
 * points, no roundness check.
 */
export type Center = { x: number; y: number };

export function inkMask(img: CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }, max = 360) {
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  if (!W0 || !H0) return null;
  const k = Math.min(1, max / Math.max(W0, H0)), W = Math.max(1, Math.round(W0 * k)), H = Math.max(1, Math.round(H0 * k));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, W, H);
  const px = x.getImageData(0, 0, W, H).data;
  // see-through art: ink = not clear; a flat picture: ink = not the corners' color
  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 20) clear++;
  const seeThrough = clear > W * H * 0.02;
  const bg = [px[0], px[1], px[2]];
  const m = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < m.length; i += 4, j++) {
    m[j] = seeThrough ? (px[i + 3] > 60 ? 1 : 0) : (px[i + 3] > 60 && Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60 ? 1 : 0);
  }
  return { m, W, H };
}

export function findCenter(mk: { m: Uint8Array; W: number; H: number }, loose = false): Center | null {
  const { m, W, H } = mk;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // the middle of the ink in a band of rows (or columns)
  const midRows = (a: number, b: number) => { let s = 0, n = 0; for (let y = a; y <= b; y++) for (let x = x0; x <= x1; x++) if (m[y * W + x]) { s += x; n++; } return n ? s / n : NaN; };
  const midCols = (a: number, b: number) => { let s = 0, n = 0; for (let x = a; x <= b; x++) for (let y = y0; y <= y1; y++) if (m[y * W + x]) { s += y; n++; } return n ? s / n : NaN; };
  const band = (n: number) => Math.max(1, Math.round(n * 0.025));
  const round = (cx: number, cy: number, r: number) => {
    // the outermost ink along 16 rays sits on the circle, except a few (the tail)
    let on = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let far = 0;
      for (let t = r * 1.6; t > 0; t -= 0.5) { const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t); if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) { far = t; break; } }
      if (Math.abs(far - r) <= r * 0.07) on++;
    }
    return on >= 11;
  };
  const out: Center = { x: 0.5, y: 0.5 };
  let hit = false;
  // wider than tall: a circle the art's full height, a tail out the left or right
  if (bw > bh * 1.04) {
    const t = midRows(y0, y0 + band(bh)), b = midRows(y1 - band(bh), y1);
    const cx = (t + b) / 2, r = bh / 2, cy = y0 + bh / 2;
    if (Math.abs(t - b) < bw * 0.04 && (loose || ((Math.abs(cx - r - x0) < bw * 0.04 || Math.abs(cx + r - x1) < bw * 0.04) && round(cx, cy, r)))) { out.x = (cx + 0.5) / W; hit = true; }
  }
  // taller than wide: a circle the art's full width, a tail out the top or bottom
  if (bh > bw * 1.04) {
    const l = midCols(x0, x0 + band(bw)), rr = midCols(x1 - band(bw), x1);
    const cy = (l + rr) / 2, r = bw / 2, cx = x0 + bw / 2;
    if (Math.abs(l - rr) < bh * 0.04 && (loose || ((Math.abs(cy - r - y0) < bh * 0.04 || Math.abs(cy + r - y1) < bh * 0.04) && round(cx, cy, r)))) { out.y = (cy + 0.5) / H; hit = true; }
  }
  if (!hit) return null;
  // a hair off isn't worth moving for
  if (Math.abs(out.x - 0.5) < 0.02 && Math.abs(out.y - 0.5) < 0.02) return null;
  return { x: Math.round(out.x * 1000) / 1000, y: Math.round(out.y * 1000) / 1000 };
}

/** the art's center to use, from its picture (url) */
export async function detectCenter(url: string, loose = false): Promise<Center | null> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const mk = inkMask(img);
  return mk ? findCenter(mk, loose) : null;
}
