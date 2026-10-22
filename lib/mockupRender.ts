"use client";
import { PHOTO_H, PHOTO_W, basePlacement, measureGarment, printWidth, spotFor, type View } from "@/lib/mockup";

/**
 * One product mockup, made in the browser: the blank's photo with the design placed where it prints (the same
 * measuring and placement the Mockup Creator uses), cut to the shirt's outline. Returns a PNG.
 */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("Couldn't load a picture")); im.src = src; });
}

/**
 * The art made ready to print on the shirt (Oct 22, Nick's Workbench mockups came out with a gray box on the chest):
 * - a logo on a solid background (white, gray: all four corners the same) gets that background taken out, softly at
 *   the edges, like the Mockup Builder does for raster logos;
 * - `ink` (a hex color): printed as that one ink. Dark art prints where it's dark (light details like a white inside
 *   stay open), light art (a white logo) where it's light, so a one-color print never becomes a solid blob.
 */
function prepArt(art: HTMLImageElement, ink?: string): HTMLCanvasElement | HTMLImageElement {
  const w = art.naturalWidth, h = art.naturalHeight;
  if (!w || !h || w * h > 16e6) return art;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return art;
  x.drawImage(art, 0, 0);
  let d: ImageData;
  try { d = x.getImageData(0, 0, w, h); } catch { return art; }
  const px = d.data, at = (cx: number, cy: number) => (cy * w + cx) * 4;
  const corners = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)].map((i) => [px[i], px[i + 1], px[i + 2], px[i + 3]]);
  const solid = corners.every((k) => k[3] > 245) && corners.every((k) => Math.max(...[0, 1, 2].map((j) => Math.abs(k[j] - corners[0][j]))) < 24);
  if (solid) {
    const bg = [0, 1, 2].map((j) => corners.reduce((t, k) => t + k[j], 0) / 4);
    for (let i = 0; i < px.length; i += 4) {
      const dist = Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
      if (dist < 36) px[i + 3] = 0;
      else if (dist < 72) px[i + 3] = Math.round(px[i + 3] * ((dist - 36) / 36));
    }
  }
  const m = ink && /^#[0-9a-f]{6}$/i.test(ink) ? ink : "";
  if (m) {
    const r = parseInt(m.slice(1, 3), 16), g = parseInt(m.slice(3, 5), 16), b = parseInt(m.slice(5, 7), 16);
    let lum = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) if (px[i + 3] > 128) { lum += (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255; n++; }
    const lightArt = n > 0 && lum / n > 0.62;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const cover = lightArt ? l : 1 - l;
      px[i + 3] = Math.round(px[i + 3] * Math.min(1, Math.max(0, (cover - 0.08) / 0.6)));
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
  if (!solid && !m) return art;
  x.putImageData(d, 0, 0);
  return c;
}

export async function renderMockup(o: { photo: string; art: string; location: string; widthIn?: number; artRatio?: number; youth?: boolean; size?: number; /** print the art as this one ink (hex) */ ink?: string }): Promise<Blob> {
  const spot = spotFor(o.location);
  const view: View = spot.view === "back" ? "back" : "front";
  const [bg, raw] = await Promise.all([load(o.photo), load(o.art)]);
  const art = prepArt(raw, o.ink);
  const ratio = o.artRatio || (raw.naturalWidth ? raw.naturalHeight / raw.naturalWidth : 1);
  const fit = measureGarment(bg, view);
  const wIn = o.widthIn ? Math.min(o.widthIn, printWidth("MAX", o.location, ratio)) : printWidth(spot.defW ? `${spot.defW}` : "11", o.location, ratio);
  const p = basePlacement(o.location, wIn, ratio, null, o.youth ? 22 / 18 : 1, view, fit);
  const out = o.size || 900, k = out / PHOTO_W;
  const c = document.createElement("canvas");
  c.width = out; c.height = Math.round(PHOTO_H * k);
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bg, 0, 0, c.width, c.height);
  // the art on its own layer, then cut to the shirt's outline
  const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
  const lx = layer.getContext("2d")!;
  lx.save();
  lx.translate((p.x + p.w / 2) * k, (p.y + p.h / 2) * k);
  if (p.rot) lx.rotate((p.rot * Math.PI) / 180);
  lx.drawImage(art, (-p.w / 2) * k, (-p.h / 2) * k, p.w * k, p.h * k);
  lx.restore();
  if (fit?.mask) {
    const m = await load(fit.mask).catch(() => null);
    if (m) { lx.globalCompositeOperation = "destination-in"; lx.drawImage(m, 0, 0, c.width, c.height); }
  }
  x.drawImage(layer, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture"))), "image/png"));
}
