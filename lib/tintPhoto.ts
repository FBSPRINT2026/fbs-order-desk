"use client";
/**
 * A garment color the supplier has no photo of (Oct 22, Nick, #40105: Gildan 64400 in Neon Blue showed as a gray drawn
 * tee, and a short-sleeve one for a long sleeve): the same style's photo in a light color, dyed to that color. The
 * background (flood-filled in from the corners) stays as it is; the garment keeps its folds and shadows (each pixel's
 * lightness against the garment's average carries over onto the new color).
 */
export async function tintPhoto(url: string, hex: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H), px = d.data;
  // the background: everything reached from the corners through pixels close to the corner color
  const bg = new Uint8Array(W * H);
  const near = (i: number, r: number, g: number, b: number) => Math.abs(px[i * 4] - r) + Math.abs(px[i * 4 + 1] - g) + Math.abs(px[i * 4 + 2] - b) < 36;
  const stack: number[] = [];
  for (const s of [0, W - 1, (H - 1) * W, H * W - 1]) {
    const r = px[s * 4], g = px[s * 4 + 1], b = px[s * 4 + 2];
    if (bg[s]) continue;
    stack.push(s); bg[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, px0 = p % W, py = (p - px0) / W;
      for (const q of [px0 > 0 ? p - 1 : -1, px0 < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]) {
        if (q < 0 || bg[q] || !near(q, r, g, b)) continue;
        bg[q] = 1; stack.push(q);
      }
    }
  }
  // the garment's average lightness, then each pixel's lightness against it onto the new color
  const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  let sum = 0, n = 0;
  for (let p = 0; p < W * H; p++) if (!bg[p]) { sum += lum(p * 4); n++; }
  if (!n) return url;
  const mean = Math.max(1, sum / n);
  const h = hex.replace("#", ""), R = parseInt(h.slice(0, 2), 16), G = parseInt(h.slice(2, 4), 16), B = parseInt(h.slice(4, 6), 16);
  for (let p = 0; p < W * H; p++) {
    if (bg[p]) continue;
    const i = p * 4, k = lum(i) / mean;
    // highlights lift toward white a little, shadows go darker
    const lift = k > 1 ? (k - 1) * 0.6 : 0;
    px[i] = Math.min(255, R * Math.min(k, 1) + (255 - R) * lift);
    px[i + 1] = Math.min(255, G * Math.min(k, 1) + (255 - G) * lift);
    px[i + 2] = Math.min(255, B * Math.min(k, 1) + (255 - B) * lift);
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL("image/jpeg", 0.9);
}

/** the style's photo to dye: a light gray (stands apart from the photo's white background) first, else white, else any */
export function tintBase(images: Record<string, { front?: string; back?: string; hex?: string }>): string | null {
  const lum = (hex?: string) => { const h = (hex || "").replace("#", ""); if (!/^[0-9a-f]{6}$/i.test(h)) return -1; return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255; };
  const withPics = Object.entries(images).filter(([, v]) => v?.front);
  if (!withPics.length) return null;
  const gray = withPics.filter(([k, v]) => !/heather/i.test(k) && lum(v.hex) >= 0.55 && lum(v.hex) <= 0.88).sort((a, b) => lum(b[1].hex) - lum(a[1].hex))[0];
  if (gray) return gray[0];
  const named = withPics.find(([k]) => /^(sport grey|ash|ice grey|light grey|silver)$/i.test(k.trim()));
  if (named) return named[0];
  const white = withPics.find(([k]) => /^white$/i.test(k.trim()));
  if (white) return white[0];
  return withPics.sort((a, b) => lum(b[1].hex) - lum(a[1].hex))[0][0];
}
